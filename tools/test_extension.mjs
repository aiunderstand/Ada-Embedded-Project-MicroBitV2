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
// Connect, Disconnect and Flash are native buttons in the view's header: a
// click there is a real user gesture, which the USB picker requires.
const titleMenu = (pkg.contributes.menus || {})["view/title"] || [];
const menuFor = (id) => titleMenu.find((m) => m.command === id);
check(menuFor("microbit.connect") && /!microbit\.connected/.test(menuFor("microbit.connect").when),
      "Connect is a header button, shown while not connected");
check(menuFor("microbit.disconnect") && /microbit\.connected/.test(menuFor("microbit.disconnect").when)
      && !/!microbit\.connected/.test(menuFor("microbit.disconnect").when),
      "Disconnect is a header button, shown while connected");
check(menuFor("microbit.flash"), "Flash is a header button too");
for (const id of ["microbit.connect", "microbit.disconnect", "microbit.flash"]) {
  const c = pkg.contributes.commands.find((x) => x.command === id);
  check(c && /^\$\(.+\)$/.test(c.icon || ""), `${id} needs a codicon, or it lands in the overflow menu`);
}
const views = Object.values(pkg.contributes.views || {}).flat();
check(views.some((v) => v.id === "microbitSerial" && v.type === "webview"),
      "the serial console is a webview view (input field, Send, Clear), not just an output channel");
check(Object.keys(pkg.contributes.viewsContainers || {}).includes("panel"),
      "the console lives in the bottom panel, next to Terminal and Output");
// A web extension cannot be listed for the container (#144513), but it can be
// a workspace recommendation, which VS Code offers to install on the browser side.
const recs = JSON.parse(fs.readFileSync(path.join(root, ".vscode/extensions.json"), "utf8")).recommendations;
check(recs.includes("AIUnderstand.microbit-flasher"), ".vscode/extensions.json must recommend the flasher");

// Load it exactly as the worker host would: no window, no document.
const chan = { appendLine() {}, append() {}, show() {}, dispose() {} };
const bar = { show() {}, dispose() {}, set text(_v) {}, get text() { return ""; } };
class EventEmitter { constructor() { this.listeners = []; this.event = (fn) => { this.listeners.push(fn); return { dispose() {} }; }; } fire(v) { for (const fn of this.listeners) fn(v); } }
const providers = {};
const executed = [];
const handlers = {};
const vscode = {
  EventEmitter,
  window: { createOutputChannel: () => chan, createStatusBarItem: () => bar,
            showErrorMessage() {}, showInformationMessage() {},
            withProgress: async (_o, f) => f({ report() {} }),
            registerWebviewViewProvider: (id, provider) => { providers[id] = provider; return { dispose() {} }; } },
  commands: { registerCommand: (id, fn) => { handlers[id] = fn; return { dispose() {} }; },
              executeCommand: async (id, ...args) => { executed.push([id, ...args].join(" ")); } },
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
  activated = subs.length >= 5;
} catch (e) {
  fail.push(`activate() threw in a DOM-less host: ${e.message}`);
}
check(activated, "activate() should register its commands without a DOM");
check(typeof mod.exports.deactivate === "function", "deactivate should be exported");

// ---------------------------------------------------------- serial console
// The board's UART arrives as serialdata events; the console is a webview view
// with an input field, Send and Clear. Bytes that arrive before the view exists
// must be replayed into it, Enter must send CR LF, Clear must forget the
// backlog, and showing the view again must not steal focus from the editor.
check(providers.microbitSerial, "activate() must register the serial view provider");
const posted = [], sentToBoard = [];
let onMessage = null, onDispose = null, html = "";
const fakeView = {
  webview: { cspSource: "vscode-webview://x", options: null,
             set html(h) { html = h; }, get html() { return html; },
             postMessage(m) { posted.push(m); },
             onDidReceiveMessage(cb) { onMessage = cb; return { dispose() {} }; } },
  onDidDispose(cb) { onDispose = cb; return { dispose() {} }; },
  shown: [], show(p) { this.shown.push(p); },
};
mod.exports._serial.received("boot line\n");                 // before the view exists
mod.exports._serial.open();
check(executed.includes("microbitSerial.focus"), "opening the console before it exists focuses the view, which resolves it");
check(typeof handlers["microbit.disconnect"] === "function", "a Disconnect command must exist for the header button");
providers.microbitSerial.resolveWebviewView(fakeView);
check(fakeView.webview.options && fakeView.webview.options.enableScripts === true, "the view needs scripts");
check(/<input[^>]*id="in"/.test(html) && /id="send"/.test(html) && /id="clear"/.test(html),
      "the console has an input field, a Send button and a Clear button");
check(/Content-Security-Policy[^>]*script-src 'nonce-[0-9a-f]+'/.test(html), "scripts run only with the nonce");
// The HTML is built from a template literal, where "\n" is interpreted: a real
// line break landed inside a string in the view's script, which then never
// ran -- no Send, no status, and Enter submitted the form for real.
const inlineScript = /<script nonce="[0-9a-f]+">([\s\S]*?)<\/script>/.exec(html);
check(inlineScript, "the view has one nonce'd inline script");
try { new Function(inlineScript ? inlineScript[1] : "throw 1"); check(true, ""); }
catch (e) { check(false, `the view's script must parse: ${e.message}`); }
onMessage({ type: "ready" });
check(posted.some((m) => m.type === "status" && m.connected === false), "ready tells the view it is not connected");
check(posted.some((m) => m.type === "data" && m.text === "boot line\n"), "output from before the view existed is replayed on ready");
mod.exports._serial.received("a\n");
check(posted[posted.length - 1].text === "a\n", "live output is posted to the view");
let disconnected = 0;
mod.exports._serial.setConnection({ serialWrite: async (t) => { sentToBoard.push(t); }, disconnect: async () => { disconnected++; } });
onMessage({ type: "send", text: "hi" });
check(sentToBoard.join("") === "hi\r\n", "Send transmits the line with CR LF");
executed.length = 0;
await handlers["microbit.disconnect"]();
check(disconnected === 1, "Disconnect closes the connection");
check(executed.includes("setContext microbit.connected false"),
      "Disconnect flips the microbit.connected context key, which swaps the header buttons");
check(posted.some((m) => m.type === "status" && m.connected === false), "the view is told about the disconnect");
onMessage({ type: "clear" });
posted.length = 0;
onMessage({ type: "ready" });
check(!posted.some((m) => m.type === "data"), "after Clear, a re-created view starts empty");
mod.exports._serial.open();
check(fakeView.shown[0] === true, "showing the console again must preserve focus, so the chord keeps working");
onDispose();
mod.exports._serial.received("later\n");
posted.length = 0;
executed.length = 0;
mod.exports._serial.open();
check(executed.includes("microbitSerial.focus"), "after the view is disposed, opening resolves a new one");

// The picker only appears while the keypress is still a fresh user gesture,
// and a full build outlasts it: the device must be asked for before building.
const flashBody = src.slice(src.indexOf("async function cmdFlash"), src.indexOf("async function cmdStatus"));
check(flashBody.indexOf("ensureConnected()") < flashBody.indexOf("runBuildTask()"),
      "cmdFlash must connect (and show the picker) before it builds");

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

// ------------------------------------------------------------ the companion
// A web extension cannot be installed into a student's browser by anything in
// a repository -- except an extension already running in the container that
// asks the workbench to. That is the companion: a plain Node extension,
// listed in devcontainer.json, which installs the flasher on startup.
const cout = fs.mkdtempSync(path.join(os.tmpdir(), "companion-"));
execFileSync("python3", ["tools/mb.py", "companion", "--out", cout], { cwd: root, stdio: "pipe" });
const cpkg = JSON.parse(fs.readFileSync(path.join(cout, "package.json"), "utf8"));
check(cpkg.publisher === "AIUnderstand" && cpkg.name === "microbit-companion", "companion identity");
check(cpkg.main && !cpkg.browser, "the companion is a Node extension: it must run in the container");
check(Array.isArray(cpkg.extensionKind) && cpkg.extensionKind[0] === "workspace",
      "extensionKind workspace, so a Codespace runs it in the container");
check((cpkg.activationEvents || []).includes("onStartupFinished"), "the companion runs at startup");
check(/AIUnderstand\.microbit-companion/.test(devcontainer) && !/microbit-flasher/.test(devcontainer.replace(/\/\/.*$/gm, "")),
      "devcontainer.json must list the companion and never the flasher");
const csrc = fs.readFileSync(path.join(cout, "extension.js"), "utf8");
async function runCompanion({ uiKind, present, force = false }) {
  const executed = [], messages = [];
  const state = {};
  let handler;
  const vs = {
    env: { uiKind, openExternal() {} }, UIKind: { Web: 2, Desktop: 1 },
    Uri: { parse: (u) => u },
    extensions: { getExtension: () => (present ? { id: "AIUnderstand.microbit-flasher" } : undefined) },
    commands: { registerCommand: (id, fn) => { handler = fn; return { dispose() {} }; },
                executeCommand: async (...a) => { executed.push(a.join(" ")); } },
    window: { showInformationMessage: async (m) => { messages.push(m); }, showWarningMessage: async () => undefined },
  };
  const m = { exports: {} };
  new Function("require", "module", "exports", csrc)((n) => vs, m, m.exports);
  const ctx = { subscriptions: [], globalState: { get: (k) => state[k], update: async (k, v) => { state[k] = v; } } };
  const result = await m.exports.activate(ctx);
  if (force) await handler();
  return { result, executed, messages, state };
}
const fresh = await runCompanion({ uiKind: 2, present: false });
check(fresh.executed.includes("workbench.extensions.installExtension AIUnderstand.microbit-flasher"),
      "in the browser, with no flasher, the companion asks the workbench to install it");
check(fresh.result === "installed" && fresh.state["microbit.flasherInstalled"] === true,
      "a successful install is remembered, so it is not repeated on every attach");
check(fresh.messages.some((m) => /Ctrl\+Alt\+F/.test(m)), "and the student is told what to do next");
const already = await runCompanion({ uiKind: 2, present: true });
check(already.result === "present" && !already.executed.some((e) => /installExtension/.test(e)),
      "with the flasher present, nothing is installed");
const desktop = await runCompanion({ uiKind: 1, present: false });
check(desktop.result === "desktop" && !desktop.executed.some((e) => /installExtension/.test(e)),
      "desktop VS Code has no WebUSB: the companion does nothing there");
const forcedRun = await runCompanion({ uiKind: 2, present: true, force: true });
check(forcedRun.executed.some((e) => /installExtension/.test(e)), "the command installs even when a copy is present");
fs.rmSync(cout, { recursive: true, force: true });

if (fail.length) {
  console.error("FAIL");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS  extension: folder, manifest, keybinding, worker-safe bundle, activation, delivery wiring, companion");
