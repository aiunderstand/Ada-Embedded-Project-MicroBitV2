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
// The Marketplace identity: students install "aiunderstand.microbit-flasher"
// in the browser. It is the lecturer's work, so it carries his publisher.
check(pkg.publisher === "aiunderstand", "publisher must be aiunderstand");
check(pkg.name === "microbit-flasher", "name must be microbit-flasher");
check(pkg.browser && !pkg.main,
      "a browser entry and no main: the only host with USB is the browser's");
check(pkg.repository && /aiunderstand\/Ada-Embedded-Project-MicroBitV2/.test(pkg.repository.url),
      "repository must point at this repo (vsce warns without it)");
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

// Load it exactly as the worker host would: no window, no document.
const chan = { appendLine() {}, append() {}, show() {}, dispose() {} };
const bar = { show() {}, dispose() {}, set text(_v) {}, get text() { return ""; } };
const vscode = {
  window: { createOutputChannel: () => chan, createStatusBarItem: () => bar,
            showErrorMessage() {}, showInformationMessage() {},
            withProgress: async (_o, f) => f({ report() {} }) },
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
