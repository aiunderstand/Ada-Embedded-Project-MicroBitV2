//  Regression test for the VS Code web extension (extension/ + mb.py extension).
//  Node built-ins only. Packages the vsix, then loads the bundled script the way
//  the web extension host does: a classic script, require('vscode'), no DOM.
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const check = (c, w) => { if (!c) fail.push(w); };

execFileSync("python3", ["tools/mb.py", "extension"], { cwd: root, stdio: "pipe" });

const pkg = JSON.parse(fs.readFileSync(path.join(root, "extension/package.json"), "utf8"));
const vsix = path.join(root, "build", `${pkg.name}-${pkg.version}.vsix`);
check(fs.existsSync(vsix), "mb.py extension should produce a .vsix");

// Unzip without a zip library: python is already a dependency.
const tmp = fs.mkdtempSync("/tmp/vsix-");
execFileSync("python3", ["-c",
  `import zipfile;zipfile.ZipFile(${JSON.stringify(vsix)}).extractall(${JSON.stringify(tmp)})`]);

for (const f of ["extension.vsixmanifest", "[Content_Types].xml",
                 "extension/package.json", "extension/extension.js"]) {
  check(fs.existsSync(path.join(tmp, f)), `the vsix should contain ${f}`);
}

const manifest = fs.readFileSync(path.join(tmp, "extension.vsixmanifest"), "utf8");
// Without ExtensionKind=web, VS Code will not load it into the browser host,
// which is the only host with USB access.
check(/ExtensionKind"\s+Value="web"/.test(manifest),
      "the manifest must declare ExtensionKind=web");

const src = fs.readFileSync(path.join(tmp, "extension/extension.js"), "utf8");
check(src.includes("globalThis.createUSBConnection"),
      "the library must be bundled and exposed as a global");
check(!/^\s*export[\s{]/m.test(src),
      "no ESM export may survive: the web extension host loads a classic script");
check(src.includes("workbench.experimental.requestUsbDevice"),
      "device authorisation must go through the VS Code command");
check(src.includes("partial: false"),
      "flashing must force a full flash; partial flashing is MakeCode-only");

// Load it exactly as the worker host would: no window, no document.
const chan = { appendLine() {}, append() {}, show() {}, dispose() {} };
const bar = { show() {}, dispose() {}, set text(_v) {}, get text() { return ""; } };
const vscode = {
  window: { createOutputChannel: () => chan, createStatusBarItem: () => bar,
            showErrorMessage() {}, showInformationMessage() {},
            withProgress: async (_o, f) => f({ report() {} }) },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} },
  StatusBarAlignment: { Left: 1 }, ProgressLocation: { Notification: 15 },
  Uri: { joinPath: () => ({}) },
  workspace: { workspaceFolders: undefined,
               fs: { readFile: async () => { throw new Error("missing"); } } },
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

fs.rmSync(tmp, { recursive: true, force: true });
if (fail.length) {
  console.error("FAIL");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS  extension: packaging, web manifest, worker-safe bundle, activation");
