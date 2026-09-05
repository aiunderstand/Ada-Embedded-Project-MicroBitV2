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

const packaged = () => {
  const out = execFileSync("python3", ["tools/mb.py", "extension"], { cwd: root, encoding: "utf8" });
  const m = /packaged (build\/\S+\.vsix)/.exec(out);
  return m ? path.join(root, m[1]) : null;
};
const vsix = packaged();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "extension/package.json"), "utf8"));
check(vsix && fs.existsSync(vsix), "mb.py extension should produce a .vsix");

// The version is content-derived, because VS Code Server serves extension.js
// with a one-year max-age at a URL that contains only the version: same
// version + new code = the browser keeps running the old code after a reload.
const packagedVersion = (file) => execFileSync("python3", ["-c",
  `import zipfile,json;print(json.loads(zipfile.ZipFile(${JSON.stringify(file)}).read("extension/package.json"))["version"])`],
  { encoding: "utf8" }).trim();
const v1 = packagedVersion(vsix);
check(v1 !== pkg.version && v1.startsWith(pkg.version.split(".").slice(0, 2).join(".") + "."),
      `the packaged version should be major.minor.<content hash>, got ${v1}`);
check(packaged() === vsix && packagedVersion(vsix) === v1, "packaging twice must give the same version");
const extSrc = path.join(root, "extension/extension.js");
const original = fs.readFileSync(extSrc, "utf8");
fs.writeFileSync(extSrc, original + "\n// cache-busting probe\n");
let probe = null;
try { probe = packaged(); } finally { fs.writeFileSync(extSrc, original); }
check(probe !== vsix && packagedVersion(probe) !== v1,
      "a change to extension.js must change the packaged version (new URL for the browser)");
check(packaged() === vsix, "restoring the source restores the version");
check(fs.readdirSync(path.join(root, "build")).filter((f) => /^microbit-flasher-.*\.vsix$/.test(f)).length === 1,
      "build/ must hold exactly one package, so nobody installs a stale one");

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
const manifestPkg = JSON.parse(fs.readFileSync(path.join(tmp, "extension/package.json"), "utf8"));
check((manifestPkg.contributes.keybindings || []).some(k => k.command === "microbit.flash"),
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
for (const kb of manifestPkg.contributes.keybindings || []) {
  for (const chord of [kb.key, kb.mac, kb.win, kb.linux].filter(Boolean)) {
    check(!TAKEN.has(chord.toLowerCase()),
          `keybinding "${chord}" is a VS Code default on some platform`);
  }
}

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

// --install runs on every Codespace attach. VS Code will not swap out a running
// extension, so reinstalling an identical copy must be a no-op, and replacing
// a changed one must tell the student to reload. Exercised against a fake
// "code" on PATH and VSCODE_EXTENSIONS pointing at a scratch directory.
if (process.platform !== "win32") {
  const fake = fs.mkdtempSync("/tmp/fakecode-");
  const log = path.join(fake, "calls.log");
  fs.writeFileSync(path.join(fake, "code"), `#!/bin/sh\necho "$@" >> "${log}"\n`, { mode: 0o755 });
  const extDir = fs.mkdtempSync("/tmp/vscode-ext-");
  const env = { ...process.env, PATH: `${fake}:${process.env.PATH}`,
                VSCODE_EXTENSIONS: extDir, HOME: fake };
  const install = () => execFileSync("python3", ["tools/mb.py", "extension", "--install"],
                                     { cwd: root, env, encoding: "utf8", stdio: "pipe" });
  const calls = () => fs.existsSync(log)
    ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : [];

  let out = install();
  check(calls().length === 1 && /--install-extension .*--force/.test(calls()[0]),
        "a first install should call code --install-extension --force");

  // Pretend VS Code unpacked it: the vsix's extension/ subtree becomes the
  // root, and package.json gains a "__metadata" object -- a real install does
  // both, and a byte comparison of the manifest never matched because of it.
  const unpacked = path.join(extDir, `${pkg.publisher}.${pkg.name}-${v1}`);
  execFileSync("python3", ["-c", [
    "import zipfile, pathlib, json",
    `z = zipfile.ZipFile(${JSON.stringify(vsix)})`,
    `root = pathlib.Path(${JSON.stringify(unpacked)})`,
    "for m in z.namelist():",
    "    if m.startswith('extension/'):",
    "        dest = root / m[len('extension/'):]",
    "        dest.parent.mkdir(parents=True, exist_ok=True)",
    "        dest.write_bytes(z.read(m))",
    "p = root / 'package.json'; d = json.loads(p.read_text())",
    "d['__metadata'] = {'installedTimestamp': 1788619298564, 'targetPlatform': 'undefined', 'size': 63834}",
    "p.write_text(json.dumps(d, indent=2) + '\\n')",
  ].join("\n")]);

  out = install();
  check(calls().length === 1,
        "reinstalling an identical copy must not touch VS Code: it invalidates a running window");
  check(/up to date/.test(out), "an identical copy should be reported as up to date");

  // VS Code keeps a superseded folder around, listed in .obsolete, until a
  // later start removes it. Identical content there is not "installed".
  fs.writeFileSync(path.join(extDir, ".obsolete"), JSON.stringify({ [path.basename(unpacked)]: true }));
  out = install();
  check(calls().length === 2, "a folder listed in .obsolete must not count as installed");
  fs.unlinkSync(path.join(extDir, ".obsolete"));

  fs.appendFileSync(path.join(unpacked, "extension.js"), "\n// stale\n");
  out = install();
  check(calls().length === 3, "a changed copy must be reinstalled");
  check(/Reload Window/.test(out),
        "replacing a copy a window may have loaded must say how to reload");

  fs.rmSync(fake, { recursive: true, force: true });
  fs.rmSync(extDir, { recursive: true, force: true });
}

if (fail.length) {
  console.error("FAIL");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS  extension: packaging, web manifest, worker-safe bundle, activation, keybinding, idempotent install");
