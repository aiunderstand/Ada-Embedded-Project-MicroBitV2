//  Regression test for the VS Code web extension (extension/ + mb.py extension).
//  Node built-ins only. Assembles the publishable folder, then loads the bundled
//  script the way the web extension host does: a classic script,
//  require('vscode'), no DOM.
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const check = (c, w) => { if (!c) fail.push(w); };

const out = fs.mkdtempSync(path.join(os.tmpdir(), "ext-"));
execFileSync("python3", ["tools/mb.py", "extension", "--out", out], { cwd: root, stdio: "pipe" });

for (const f of ["package.json", "extension.js", "README.md", "LICENSE"]) {
  check(fs.existsSync(path.join(out, f)), `the assembled folder should contain ${f}`);
}
const pkg = JSON.parse(fs.readFileSync(path.join(out, "package.json"), "utf8"));
const srcPkg = JSON.parse(fs.readFileSync(path.join(root, "extension/package.json"), "utf8"));

// ------------------------------------------------------------- manifest
// The Marketplace identity: students install "AIUnderstand.microbit-flasher"
// in the browser. It is the lecturer's work, so it carries his publisher.
check(pkg.publisher === "AIUnderstand", "publisher must be AIUnderstand, exactly as created on the Marketplace");
check(pkg.name === "microbit-flasher", "name must be microbit-flasher");
check(pkg.browser && !pkg.main,
      "a browser entry and no main: the only host with USB is the browser's");
// A GitHub URL, not this repository's name: the template-hygiene lint rightly
// refuses any path that bakes in the upstream name, and vsce only needs a
// repository to fill the Marketplace links from.
check(pkg.repository && /^https:\/\/github\.com\/[^/]+\/[^/]+\.git$/.test(pkg.repository.url),
      "repository must be a GitHub URL (vsce fills the Marketplace links from it)");
check(!("private" in pkg), "no 'private' flag: it is published");
check(pkg.version === srcPkg.version, "without --version the source version is used");
const forced = fs.mkdtempSync(path.join(os.tmpdir(), "ext-v-"));
execFileSync("python3", ["tools/mb.py", "extension", "--out", forced, "--version", "0.1.4242"], { cwd: root, stdio: "pipe" });
check(JSON.parse(fs.readFileSync(path.join(forced, "package.json"), "utf8")).version === "0.1.4242",
      "--version must override the version, so CI can publish a monotonic one");
fs.rmSync(forced, { recursive: true, force: true });

check((pkg.contributes.keybindings || []).some((k) => k.command === "microbit.flash"),
      "flash must have a keybinding, so it needs no command palette");
// A chord VS Code already uses is a regression, not a feature: the first pick,
// cmd+alt+f, was Replace on a Mac. VS Code writes modifiers as ctrl, shift,
// alt, cmd; both spellings are listed so a manifest typo cannot slip past.
const TAKEN = new Set([
  "cmd+alt+f", "alt+cmd+f",        // Replace (mac)
  "ctrl+h",                        // Replace (win/linux)
  "shift+alt+f",                   // Format Document
  "ctrl+shift+f", "shift+cmd+f", "cmd+shift+f", // Search
  "ctrl+f", "cmd+f", "alt+f", "f1", "f5",
]);
for (const kb of pkg.contributes.keybindings || []) {
  for (const chord of [kb.key, kb.mac, kb.win, kb.linux].filter(Boolean)) {
    check(!TAKEN.has(chord.toLowerCase()),
          `keybinding "${chord}" is a VS Code default on some platform`);
  }
}

// -------------------------------------------------------------- bundle
const src = fs.readFileSync(path.join(out, "extension.js"), "utf8");
check(src.includes("globalThis.createUSBConnection"),
      "the library must be bundled and exposed as a global");
check(!/^\s*export[\s{]/m.test(src),
      "no ESM export may survive: the web extension host loads a classic script");
check(src.includes("workbench.experimental.requestUsbDevice"),
      "device authorisation must go through the VS Code command");
check(src.includes("partial: false"),
      "flashing must force a full flash; partial flashing is MakeCode-only");
// One action must do the whole job: flashing a stale hex silently was the main
// complaint about the old flow.
check(src.includes("runBuildTask"),
      "flash must build first, so it cannot flash a stale hex");
// The web worker extension host's tasks API throws NotSupported for anything
// but a CustomExecution task, so executeTask() on the process task "Build"
// fails before reaching the board. Found in a real VS Code Server; the
// workbench command runs any task from any host.
check(!/tasks\.executeTask\s*\(/.test(src),
      "must not call vscode.tasks.executeTask: NotSupported in the web worker host");
check(src.includes('"workbench.action.tasks.runTask"'),
      "the build must run through workbench.action.tasks.runTask");

check((pkg.contributes.commands || []).some((c) => c.command === "microbit.serial"),
      "a command must open the serial console");

// Load it exactly as the worker host would: no window, no document.
const chan = { appendLine() {}, append() {}, show() {}, dispose() {} };
const bar = { show() {}, dispose() {}, set text(_v) {}, get text() { return ""; } };
class EventEmitter { constructor() { this.listeners = []; this.event = (fn) => { this.listeners.push(fn); return { dispose() {} }; }; } fire(v) { for (const fn of this.listeners) fn(v); } }
const terminals = [];
const vscode = {
  EventEmitter,
  window: { createOutputChannel: () => chan, createStatusBarItem: () => bar,
            showErrorMessage() {}, showInformationMessage() {},
            withProgress: async (_o, f) => f({ report() {} }),
            createTerminal: (opts) => { const t = { opts, shown: [], show(p) { this.shown.push(p); } }; terminals.push(t); return t; } },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} },
  tasks: { fetchTasks: async () => [], onDidEndTaskProcess: () => ({ dispose() {} }) },
  StatusBarAlignment: { Left: 1 }, ProgressLocation: { Notification: 15 },
  Uri: { joinPath: () => ({}) },
  workspace: { workspaceFolders: undefined,
               fs: { readFile: async () => { throw new Error("missing"); },
                     stat: async () => { throw new Error("missing"); } } },
};
const mod = { exports: {} };
let activated = false;
try {
  new Function("require", "module", "exports", "navigator", src)(
    (n) => { if (n === "vscode") return vscode; throw new Error("unknown " + n); },
    mod, mod.exports, undefined);
  const subs = [];
  mod.exports.activate({ subscriptions: subs });
  activated = subs.length >= 4;
} catch (e) {
  fail.push(`activate() threw in a DOM-less host: ${e.message}`);
}
check(activated, "activate() should register its commands without a DOM");
check(typeof mod.exports.deactivate === "function", "deactivate should be exported");

// ---------------------------------------------------------- serial console
// The board's UART arrives as serialdata events; the console is a
// pseudoterminal. Bytes that arrive before it is open must not be lost, LF
// must become CR LF for xterm, typing must be echoed (Get does not echo) and
// sent with CR LF on Enter, and the console must never take focus, or the
// next Ctrl+Alt+F would type into it instead of flashing.
const written = [];
mod.exports._serial.received("boot line\n");                 // before any console
mod.exports._serial.open();
check(terminals.length === 1 && terminals[0].opts.name === "micro:bit serial",
      "opening the console creates a pseudoterminal named micro:bit serial");
const t0 = terminals[0];
check(t0.shown[0] === true, "the console must be shown with preserveFocus, so the chord keeps working");
t0.opts.pty.onDidWrite((d) => written.push(d));
t0.opts.pty.open();
check(written.join("") === "boot line\r\n", "output that arrived before the console opened is replayed, LF as CR LF");
mod.exports._serial.received("a\r\nb\n");
check(written.join("") === "boot line\r\na\r\nb\r\n", "CR LF is passed through, bare LF becomes CR LF");
mod.exports._serial.received("\n--- program restarted ---\n");
check(/restarted/.test(written.join("")), "a reset shows a divider in the console");
written.length = 0;
t0.opts.pty.handleInput("x\r");
check(written.join("") === "x\r\n", "typing is echoed, Enter as CR LF");
t0.opts.pty.handleInput("\x1b[A");
check(written.join("") === "x\r\n", "escape sequences are dropped, not echoed or sent");
mod.exports._serial.open();
check(terminals.length === 1 && t0.shown.length === 2, "opening again brings the same console forward");
t0.opts.pty.close();
mod.exports._serial.open();
check(terminals.length === 2, "after the student closes it, the next open creates a fresh console");

// ------------------------------------------------------ the flash, in a worker
// A worker's navigator.usb has getDevices() but no requestDevice(). The first
// real flash from a Codespace died on exactly that, inside the bundled library,
// after VS Code's own picker had already authorised the board. So: with an
// authorised device present, the flow must reach that device and must never
// call requestDevice; and with none, it must use the workbench picker.
const fakeDevice = (opened) => ({
  vendorId: 0x0d28, productId: 0x0204, manufacturerName: "Arm", productName: "DAPLink CMSIS-DAP",
  serialNumber: "0000", opened: false, configurations: [],
  open: async () => { opened.push(1); throw new Error("reached the fake device"); },
  close: async () => {}, addEventListener() {}, removeEventListener() {},
});
async function runFlash({ authorised }) {
  const reached = [], errors = [], commands = [];
  let handler;
  const vs = {
    ...vscode,
    window: { ...vscode.window, showErrorMessage: (m) => { errors.push(m); },
              createOutputChannel: () => chan, createStatusBarItem: () => bar },
    commands: {
      registerCommand: (id, fn) => { if (id === "microbit.flash") handler = fn; return { dispose() {} }; },
      executeCommand: async (id) => { commands.push(id); authorised = true; },
    },
    workspace: { workspaceFolders: [{ uri: {} }],
                 fs: { stat: async () => ({}), readFile: async () => new TextEncoder().encode(":10000000783A0020091E0100541E0100541E010010\n:00000001FF\n") } },
  };
  const nav = { usb: { getDevices: async () => (authorised ? [fakeDevice(reached)] : []),
                       addEventListener() {}, removeEventListener() {} } };
  const m = { exports: {} };
  new Function("require", "module", "exports", "navigator", src)(
    (n) => { if (n === "vscode") return vs; throw new Error("unknown " + n); }, m, m.exports, nav);
  m.exports.activate({ subscriptions: [] });
  await handler();
  return { reached: reached.length, errors, commands };
}
// activate() also reconnects to an authorised device on its own, so the device
// is opened twice here: once at activation, once by the flash.
const withDevice = await runFlash({ authorised: true });
check(withDevice.reached >= 1, "an authorised device must be handed to the library and opened");
check(!withDevice.commands.includes("workbench.experimental.requestUsbDevice"),
      "no picker when a device is already authorised");
check(!withDevice.errors.some((e) => /requestDevice/.test(e)),
      `the library must never call navigator.usb.requestDevice in a worker (got: ${withDevice.errors})`);
check(withDevice.errors.some((e) => /reached the fake device/.test(e)),
      "a failed connection must surface the device's own error, not be swallowed");
const withoutDevice = await runFlash({ authorised: false });
check(withoutDevice.commands.includes("workbench.experimental.requestUsbDevice"),
      "with no authorised device, the workbench picker must be used");
check(withoutDevice.reached >= 1, "the device the picker authorised must then be used");

// -------------------------------------------------------------- delivery
// An extension installed *into* a Codespace never runs in the browser client
// (microsoft/vscode#144513): the worker host fetches its code from another
// origin and gets a 404. And the Codespaces page policy admits only the
// Marketplace CDNs, so Pages cannot serve it either. So nothing may install it
// on attach, nothing may publish it to the site, and CI must prove the folder
// is Marketplace-valid.
const devcontainer = fs.readFileSync(path.join(root, ".devcontainer/devcontainer.json"), "utf8");
check(!/postAttachCommand[^\n]*extension/.test(devcontainer),
      "devcontainer.json must not install the extension on attach: it cannot load in the browser client");
check(!/"extensions":[^\]]*microbit-flasher/.test(devcontainer),
      "devcontainer.json must not list the extension for the container: it would install on the remote");
const pages = fs.readFileSync(path.join(root, ".github/workflows/pages.yml"), "utf8");
check(!/mb\.py extension/.test(pages),
      "pages.yml must not publish the extension: the Codespaces page policy blocks github.io");
const ci = fs.readFileSync(path.join(root, ".github/workflows/ada.yml"), "utf8");
check(/vsce/.test(ci), "ada.yml must validate the folder with vsce, so a publish never fails on the manifest");
check(fs.existsSync(path.join(root, ".github/workflows/publish-extension.yml")),
      "a publishing workflow must exist");

fs.rmSync(out, { recursive: true, force: true });
if (fail.length) {
  console.error("FAIL");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS  extension: folder, manifest, keybinding, worker-safe bundle, activation, delivery wiring");
