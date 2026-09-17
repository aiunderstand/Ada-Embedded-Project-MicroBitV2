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

// The keys: Ctrl+Shift+B builds (the default build task), Ctrl+F5 builds and
// flashes, F5 debugs. Ctrl+F5 is VS Code's "run without debugging" chord, taken
// over on purpose, on both paths: the flash command runs the Build & Flash
// task on a desktop and flashes over WebUSB in the browser.
const flashKey = (pkg.contributes.keybindings || []).find((k) => k.command === "microbit.flash");
check(flashKey && flashKey.key === "ctrl+f5" && !flashKey.mac && !flashKey.when,
      "flash is bound to ctrl+f5 on every platform, on both paths");
const tasks = JSON.parse(fs.readFileSync(path.join(root, ".vscode/tasks.json"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
check(tasks.tasks.some((t) => t.label === "Build" && t.group && t.group.isDefault) && !tasks.tasks.some((t) => t.label !== "Build" && t.group && t.group.isDefault),
      "Ctrl+Shift+B is the Build task alone: the flash has its own key");
check(!(pkg.contributes.keybindings || []).some((k) => /alt\+f/i.test(k.key || "")),
      "the old chord is gone from the manifest");
// A chord VS Code already uses is a regression unless it is taken over on
// purpose, and the purpose is written down here: the first pick, cmd+alt+f,
// was Replace on a Mac. VS Code writes modifiers as ctrl, shift, alt, cmd;
// both spellings are listed so a manifest typo cannot slip past.
const DELIBERATE = { "microbit.flash": "ctrl+f5" }; // run without debugging = flash
const TAKEN = new Set([
  "cmd+alt+f", "alt+cmd+f",        // Replace (mac)
  "ctrl+h",                        // Replace (win/linux)
  "shift+alt+f",                   // Format Document
  "ctrl+shift+f", "shift+cmd+f", "cmd+shift+f", // Search
  "ctrl+f", "cmd+f", "alt+f", "f1", "f5", "ctrl+f5",
]);
for (const kb of pkg.contributes.keybindings || []) {
  if (DELIBERATE[kb.command] === kb.key) continue;
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
check(!src.includes("Ctrl+Alt+F"), "the old chord is gone from every message in the bundle");
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
// Ctrl+Shift+B runs the default build task at once, so the picker for
// examples is reachable only through Tasks: Run Task -- unless the extension
// offers it: a status-bar item naming the chosen project, click to choose.
check((pkg.contributes.commands || []).some((c) => c.command === "microbit.chooseProject"),
      "a command must open the project picker");
check(src.includes('"Choose project..."') && /runTask",\s*CHOOSE_TASK/.test(src),
      "the picker runs the Choose project... task through the workbench");
check(/build\/project\.txt/.test(src), "the status-bar item reads build/project.txt, what mb.py will build");
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
const debugProviders = {};
const executed = [];
const handlers = {};
const vscode = {
  EventEmitter,
  env: { uiKind: 2 }, UIKind: { Web: 2, Desktop: 1 },
  debug: { registerDebugConfigurationProvider: (type, p) => { debugProviders[type] = p; return { dispose() {} }; } },
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
  activated = subs.length >= 6;
} catch (e) {
  fail.push(`activate() threw in a DOM-less host: ${e.message}`);
}
check(activated, "activate() should register its commands without a DOM");
check(typeof mod.exports.deactivate === "function", "deactivate should be exported");

// ---------------------------------------------------------------- debugging
// The gdb server (extension/gdbserver.js) is bundled ahead of the extension
// and reached through five commands the companion calls across hosts. They
// are contributed, so a call activates the extension, and hidden from the
// palette, since they are not for people.
check(src.includes("class GdbServer") && src.indexOf("class GdbServer") < src.indexOf("async function cmdGdbAttach"),
      "gdbserver.js is bundled, before the code that uses it");
for (const id of ["attach", "packet", "interrupt", "detach", "ping"]) {
  check(typeof handlers[`microbit.gdb.${id}`] === "function", `microbit.gdb.${id} must be registered`);
  check((pkg.contributes.commands || []).some((c) => c.command === `microbit.gdb.${id}`), `microbit.gdb.${id} must be contributed`);
  check(((pkg.contributes.menus || {}).commandPalette || []).some((m) => m.command === `microbit.gdb.${id}` && m.when === "false"),
        `microbit.gdb.${id} must be hidden from the command palette`);
}
check(await handlers["microbit.gdb.ping"]() === "pong", "ping answers");
let packetError = "";
try { await handlers["microbit.gdb.packet"]("?"); } catch (e) { packetError = e.message; }
check(/no debug session/.test(packetError), "a packet outside a session is refused");
try {
  await handlers["microbit.gdb.interrupt"]();
  await handlers["microbit.gdb.detach"]();
} catch (e) {
  check(false, `interrupt and detach outside a session must be harmless: ${e.message}`);
}
// The stale-connection, flash-guard and attach checks run further down, after
// the serial section and runFlash's fakeDevice/runFlash exist (see below).

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
await new Promise((r) => setTimeout(r, 120));
check(sentToBoard.join("") === "hi\r\n", "Send transmits the line with CR LF");
// A whole line at once overran the board's UART FIFO and wedged a Get loop
// after two characters; the board has no flow control, so the sender paces.
check(sentToBoard.length === 4 && sentToBoard.every((c) => c.length === 1),
      "characters must go out one at a time, so the board's UART is never overrun");
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
  const reached = [], errors = [], commands = [], contexts = {};
  let handler;
  const vs = {
    ...vscode,
    // Own registries: this throwaway instance must not overwrite the first
    // instance's serial view or debug provider in the shared mock.
    debug: { registerDebugConfigurationProvider: () => ({ dispose() {} }) },
    window: { ...vscode.window, showErrorMessage: (m) => { errors.push(m); },
              createOutputChannel: () => chan, createStatusBarItem: () => bar,
              registerWebviewViewProvider: () => ({ dispose() {} }) },
    commands: {
      registerCommand: (id, fn) => { if (id === "microbit.flash") handler = fn; return { dispose() {} }; },
      executeCommand: async (id, ...args) => {
        if (id === "setContext") { contexts[args[0]] = args[1]; return; }
        commands.push(id); authorised = true;
      },
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
  return { reached: reached.length, errors, commands, contexts };
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
check(withDevice.contexts["microbit.usbHost"] === true,
      "in a browser with WebUSB the view's Connect button is offered (microbit.usbHost)");

// ------------------------------------------------------------ desktop VS Code
// Desktop VS Code loads web extensions too (this one is a workspace
// recommendation, so a student on their own PC has it), in a worker whose
// Electron-backed navigator.usb exists and answers getDevices() with nothing.
// So "is there WebUSB" said yes on a Windows PC, and the next call was to the
// workbench's device picker, which only the browser build registers:
//   Error: command 'workbench.experimental.requestUsbDevice' not found
// There the board belongs to pyocd: the flash runs the Build & Flash task.
async function runDesktop({ command = "microbit.flash", tasks = ["Build & Flash", "Build"], exitCode = 0, remoteName } = {}) {
  const commands = [], errors = [], listeners = [], handlersHere = {};
  const vs = {
    ...vscode,
    env: { uiKind: 1, remoteName },
    debug: { registerDebugConfigurationProvider: () => ({ dispose() {} }) },
    window: { ...vscode.window, showErrorMessage: (m) => { errors.push(m); },
              createOutputChannel: () => chan, createStatusBarItem: () => bar,
              registerWebviewViewProvider: () => ({ dispose() {} }) },
    commands: {
      registerCommand: (id, fn) => { handlersHere[id] = fn; return { dispose() {} }; },
      executeCommand: async (id, ...args) => {
        commands.push([id, ...args].join(" "));
        if (id === "workbench.experimental.requestUsbDevice") {
          throw new Error("command 'workbench.experimental.requestUsbDevice' not found");
        }
        if (id === "workbench.action.tasks.runTask") {
          // The task ends later, as an ordinary task event.
          setTimeout(() => { for (const fn of listeners) fn({ execution: { task: { name: args[0] } }, exitCode }); }, 0);
        }
      },
    },
    tasks: { fetchTasks: async () => tasks.map((name) => ({ name })),
             onDidEndTaskProcess: (fn) => { listeners.push(fn); return { dispose() {} }; } },
    workspace: { workspaceFolders: [{ uri: {} }],
                 fs: { stat: async () => ({}), readFile: async () => { throw new Error("missing"); } } },
  };
  // Electron's worker: navigator.usb is there, with no authorised device and no picker.
  const nav = { usb: { getDevices: async () => [], addEventListener() {}, removeEventListener() {} } };
  const m = { exports: {} };
  new Function("require", "module", "exports", "navigator", src)(
    (n) => { if (n === "vscode") return vs; throw new Error("unknown " + n); }, m, m.exports, nav);
  m.exports.activate({ subscriptions: [] });
  await handlersHere[command]();
  return { commands, errors };
}
const desktopFlash = await runDesktop();
check(desktopFlash.commands.includes("setContext microbit.usbHost false"),
      "on a desktop there is no Connect button: the companion's list replaces it");
check(desktopFlash.commands.includes("workbench.action.tasks.runTask Build & Flash"),
      "on the desktop the flash runs the Build & Flash task: pyocd has the board there");
check(!desktopFlash.commands.some((c) => /requestUsbDevice/.test(c)) && !desktopFlash.errors.length,
      `on the desktop the workbench picker must never be asked for, it does not exist there (got: ${desktopFlash.errors})`);
const desktopFailed = await runDesktop({ exitCode: 1 });
check(desktopFailed.errors.some((e) => /terminal/.test(e)),
      "a failed Build & Flash is reported, pointing at the terminal");
const desktopNoTask = await runDesktop({ tasks: [] });
check(!desktopNoTask.commands.some((c) => /runTask|requestUsbDevice/.test(c)) && desktopNoTask.errors.some((e) => /mb\.py flash/.test(e)),
      "outside the template, with no Build & Flash task, the desktop is told to use mb.py flash");
const desktopRemote = await runDesktop({ remoteName: "codespaces" });
check(!desktopRemote.commands.some((c) => /runTask|requestUsbDevice/.test(c)) && desktopRemote.errors.some((e) => /browser/.test(e)),
      "desktop VS Code attached to a Codespace: the task would answer 'press Ctrl+Shift+B'; say to open the Codespace in the browser instead");
const desktopConnect = await runDesktop({ command: "microbit.connect" });
check(!desktopConnect.commands.some((c) => /requestUsbDevice/.test(c)) && desktopConnect.errors.some((e) => /mb\.py flash/.test(e)),
      "Connect on the desktop explains itself instead of asking for a picker that is not there");

// ------------------------------------------------------------ boards
// Which micro:bit, and whether it is a v2: the USB serial number's first four
// digits are the board id. The view lists them, the choice follows in both
// hosts, "Show serial" really stops the reading, and an unplugged board is
// let go of.
const boardsApi = mod.exports._boards;
check(boardsApi.boardVersion("9904360200052820ab3ba4b3") === "v2" && boardsApi.boardVersion("9906aa") === "v2",
      "board ids 9903-9906 are a v2");
check(boardsApi.boardVersion("990036020005") === "v1" && boardsApi.boardVersion("") === null && boardsApi.boardVersion(undefined) === null,
      "9900/9901 are a v1; anything else is unknown, not a v2");
check(/micro:bit v2 · 9901 \(COM3\)/.test(boardsApi.boardLabel({ id: "9904360200052820ab3ba4b3000000000000000097969901", version: "v2", port: "COM3" })),
      "a board is labelled by version, the last four digits of its id, and its port");
check(/not supported/.test(boardsApi.boardLabel({ id: "99000001", version: "v1" })), "a v1 says it is not supported");

const usbDevice = (serial, opened) => ({ ...fakeDevice(opened), serialNumber: serial });
async function runBoards({ uiKind = 2, devices = [], companionBoards = [] }) {
  const posted = [], executed = [], written = [], usbListeners = {}, handlers = {}, reached = [];
  let viewHandler = null, provider = null;
  const vs = {
    ...vscode,
    env: { uiKind },
    debug: { registerDebugConfigurationProvider: () => ({ dispose() {} }) },
    window: { ...vscode.window, showErrorMessage() {}, createOutputChannel: () => chan, createStatusBarItem: () => bar,
              registerWebviewViewProvider: (id, p) => { provider = p; return { dispose() {} }; } },
    commands: {
      registerCommand: (id, fn) => { handlers[id] = fn; return { dispose() {} }; },
      executeCommand: async (id, arg) => {
        executed.push([id, arg]);
        if (id === "microbit.companion.boards") return companionBoards;
        if (id === "workbench.experimental.requestUsbDevice") return;
      },
    },
    workspace: { workspaceFolders: [{ uri: { path: "/ws" } }],
                 fs: { stat: async () => ({}), readFile: async () => { throw new Error("missing"); },
                       writeFile: async (uri, bytes) => { written.push([String(uri.path || uri), new TextDecoder().decode(bytes)]); } } },
    Uri: { joinPath: (base, ...parts) => ({ path: [base.path, ...parts].join("/") }) },
  };
  // Several listeners per event, as the real API has: the library registers
  // its own "disconnect" handler on connect, next to the extension's.
  const nav = { usb: { getDevices: async () => devices.filter((d) => !d.gone),
                       addEventListener: (type, fn) => { (usbListeners[type] = usbListeners[type] || []).push(fn); }, removeEventListener() {} } };
  const m = { exports: {} };
  new Function("require", "module", "exports", "navigator", src)(
    (n) => { if (n === "vscode") return vs; throw new Error("unknown " + n); }, m, m.exports, nav);
  m.exports.activate({ subscriptions: [] });
  await new Promise((r) => setTimeout(r, 30));
  const view = { webview: { options: {}, html: "", cspSource: "x", postMessage: (msg) => { posted.push(msg); },
                            onDidReceiveMessage: (fn) => { viewHandler = fn; } }, onDidDispose() {}, show() {} };
  provider.resolveWebviewView(view);
  viewHandler({ type: "ready" });
  await new Promise((r) => setTimeout(r, 30));
  const lastBoards = () => [...posted].reverse().find((msg) => msg.type === "boards");
  const send = async (msg) => { await viewHandler(msg); await new Promise((r) => setTimeout(r, 30)); };
  return { posted, executed, written, usbListeners, handlers, reached, lastBoards, send, api: m.exports };
}

// The browser: authorised devices, a v1 among them.
{
  const opened = [];
  const v1 = usbDevice("9900360200052820ab3ba4b30000000000000000979699aa", opened);
  const a = usbDevice("9904360200052820ab3ba4b3000000000000000097969901", opened);
  const b = usbDevice("9905360200052820ab3ba4b3000000000000000097969902", opened);
  const r = await runBoards({ devices: [v1, a, b] });
  let msg = r.lastBoards();
  check(msg && msg.host === "browser" && msg.boards.length === 3, `the view lists every authorised micro:bit (got ${JSON.stringify(msg && msg.boards)})`);
  check(msg && msg.boards.some((x) => x.version === "v1" && !x.selectable) && msg.boards.filter((x) => x.selectable).length === 2,
        "the v1 is listed but cannot be chosen; the v2s can");
  check(msg && msg.selected === a.serialNumber, "the first v2 is chosen by default");
  check(r.written.some(([path, text]) => /build\/board\.txt$/.test(path) && text.trim() === a.serialNumber),
        "the choice is written to build/board.txt, where mb.py flash reads it");
  await r.send({ type: "select", id: b.serialNumber });
  check(r.lastBoards().selected === b.serialNumber && b.opened === false && opened.length >= 1,
        "choosing another board connects to that one");
  // Show serial off: the serialdata listener goes, which stops the library's polling.
  const events = [];
  const conn = { status: "Connected", device: b, addEventListener: (t) => events.push("+" + t), removeEventListener: (t) => events.push("-" + t),
                 disconnect: async () => { events.push("disconnect"); }, dispose() {} };
  r.api._serial.setConnection(conn);
  await r.send({ type: "read", on: false });
  check(events.includes("-serialdata") && !events.includes("+serialdata") && r.lastBoards().reading === false,
        `Show serial off removes the serialdata listener (got ${events})`);
  r.posted.length = 0;
  r.api._serial.received("noise\n");
  check(!r.posted.some((x) => x.type === "data"), "and what still arrives is not shown");
  await r.send({ type: "read", on: true });
  check(events.filter((e) => e === "+serialdata").length === 1, "Show serial on adds it back");
  // Unplugging the connected board lets go of it and drops it from the list.
  b.gone = true;
  for (const fn of r.usbListeners.disconnect) await fn({ device: b });
  await new Promise((res) => setTimeout(res, 30));
  check(events.includes("disconnect") && r.lastBoards().boards.length === 2 && r.lastBoards().selected === a.serialNumber,
        `an unplugged board is disconnected and the choice moves on (got ${JSON.stringify(r.lastBoards())})`);
  check((r.usbListeners.connect || []).length >= 1, "plugging a board in refreshes the list too");
}

// A desktop: the companion's list, its serial, and requests back to it.
{
  const A = "9904360200052820ab3ba4b3000000000000000097969901";
  const r = await runBoards({ uiKind: 1 });
  for (const id of ["microbit.boards.update", "microbit.serial.received", "microbit.boards.state"]) {
    check(typeof r.handlers[id] === "function", `${id} is registered for the companion`);
  }
  check(r.executed.some(([id]) => id === "microbit.companion.boards"), "at activation the companion is asked for the boards it already knows");
  await r.handlers["microbit.boards.update"]([{ id: A, version: "v2", port: "COM3" }, { id: "990000000001", version: "v1", port: "COM4" }]);
  await new Promise((res) => setTimeout(res, 30));
  const msg = r.lastBoards();
  check(msg && msg.host === "desktop" && msg.boards.length === 2 && msg.selected === A,
        `the companion's list is shown, the v2 chosen (got ${JSON.stringify(msg)})`);
  check(r.executed.some(([id, arg]) => id === "microbit.companion.serial" && arg.op === "open" && arg.id === A),
        "and the bridge is asked to read it, since Show serial is on");
  check(r.written.some(([path, text]) => /build\/board\.txt$/.test(path) && text.trim() === A), "the choice is recorded for pyocd");
  r.handlers["microbit.boards.state"]({ event: "opened", id: A });
  check(r.lastBoards().connected === true, "opened means connected");
  r.posted.length = 0;
  r.handlers["microbit.serial.received"]("hello\r\n");
  check(r.posted.some((x) => x.type === "data" && x.text === "hello\r\n"), "serial from the bridge reaches the view");
  await r.send({ type: "read", on: false });
  check(r.executed.some(([id, arg]) => id === "microbit.companion.serial" && arg.op === "close"), "Show serial off closes the port");
  r.posted.length = 0;
  r.handlers["microbit.serial.received"]("late\r\n");
  check(!r.posted.some((x) => x.type === "data"), "and nothing is shown after that");
  await r.send({ type: "send", text: "hi" });
  check(r.executed.some(([id, arg]) => id === "microbit.companion.serial" && arg.op === "send" && arg.text === "hi"),
        "a typed line goes to the bridge");
  r.handlers["microbit.boards.state"]({ event: "closed", id: A, reason: "unplugged" });
  check(r.lastBoards().connected === false && /unplugged/.test(r.lastBoards().note), "an unplugged board is reported as such");
}

// -------------------------------------------------------------- debugging, on the board
// These use the first module instance (`mod`/`handlers`), and run here rather
// than up by the command-registration checks because they need runFlash's
// fakeDevice; they also spin up fresh instances, so they must not run before
// the serial section, whose provider they would otherwise overwrite.
//
// An unplugged board leaves the library's object behind with another status;
// it must be dropped, not handed to gdb (or to Connect) as if it were live.
let disposed = 0;
mod.exports._serial.setConnection({ status: "NoAuthorizedDevice", dispose() { disposed++; } });
executed.length = 0;
let staleError = "";
try { await handlers["microbit.gdb.attach"](); } catch (e) { staleError = e.message; }
check(/Connect the micro:bit first/.test(staleError) && disposed === 1,
      "a connection whose status is not Connected is disposed and not used");
check(executed.includes("setContext microbit.connected false"), "and the header buttons are told");
// Flashing under a debug session would answer gdb's continue mid-flash;
// disconnecting would leave breakpoints armed that nothing can clear.
let detached = 0;
mod.exports._debug.setSession({ running: false, detach: async () => { detached++; } });
const shown = [];
vscode.window.showErrorMessage = (m) => { shown.push(m); };
await handlers["microbit.flash"]();
check(shown.some((m) => /Stop it first/.test(m)), "a flash during a debug session is refused, with the way out");
await handlers["microbit.disconnect"]();
check(detached === 1, "Disconnect ends the debug session first");
try { await handlers["microbit.gdb.packet"]("?"); check(false, "the session must be gone after Disconnect"); }
catch (e) { check(/no debug session/.test(e.message), "the session is gone after Disconnect"); }

// F5 reaches the browser with no user gesture to spend on the USB picker: with
// USB present but no authorised board, attach must fail with an instruction
// and never call the picker; with an authorised board it must connect. Each
// run is its own module instance with an isolated view registry, so it does
// not disturb the serial provider resolved above.
async function runAttach({ authorised }) {
  const reached = [], commands = [];
  let attach;
  const vs = {
    ...vscode,
    debug: { registerDebugConfigurationProvider: () => ({ dispose() {} }) },
    window: { ...vscode.window, showErrorMessage() {}, createOutputChannel: () => chan,
              createStatusBarItem: () => bar, registerWebviewViewProvider: () => ({ dispose() {} }) },
    commands: {
      registerCommand: (id, fn) => { if (id === "microbit.gdb.attach") attach = fn; return { dispose() {} }; },
      executeCommand: async (id) => { commands.push(id); },
    },
  };
  const nav = { usb: { getDevices: async () => (authorised ? [fakeDevice(reached)] : []),
                       addEventListener() {}, removeEventListener() {} } };
  const m = { exports: {} };
  new Function("require", "module", "exports", "navigator", src)(
    (n) => { if (n === "vscode") return vs; throw new Error("unknown " + n); }, m, m.exports, nav);
  m.exports.activate({ subscriptions: [] });
  let error = "";
  try { await attach(); } catch (e) { error = e.message; }
  return { error, commands, reached: reached.length };
}
const unauthorised = await runAttach({ authorised: false });
check(/Connect the micro:bit first/.test(unauthorised.error) && /Serial view/.test(unauthorised.error),
      "attach with USB but no authorised board tells the student what to press");
check(!unauthorised.commands.includes("workbench.experimental.requestUsbDevice"),
      "and never asks for the picker, which cannot appear without a gesture");
const authorisedRun = await runAttach({ authorised: true });
check(authorisedRun.reached >= 1 && /reached the fake device/.test(authorisedRun.error),
      "attach with an authorised board connects to it, silently");
check(!authorisedRun.commands.includes("workbench.experimental.requestUsbDevice"), "still without the picker");

// ------------------------------------------------------ F5 asks for the board
// The attach cannot show the picker (no gesture reaches it), but F5 is a
// gesture and VS Code resolves the debug configuration before it builds: a
// provider in the browser asks for the board right there, as Ctrl+Shift+B does.
check(debugProviders["cortex-debug"] && typeof debugProviders["cortex-debug"].resolveDebugConfiguration === "function",
      "the flasher registers a debug-configuration provider for cortex-debug");
check((pkg.activationEvents || []).includes("onDebugResolve:cortex-debug"),
      "and activates on onDebugResolve:cortex-debug, so an early F5 still finds it");
{
  const cfg = { name: "Debug (PyOCD)", type: "cortex-debug", servertype: "pyocd" };
  check(await debugProviders["cortex-debug"].resolveDebugConfiguration(undefined, cfg) === cfg,
        "with no WebUSB at all the configuration passes through untouched");
}
async function runResolve({ uiKind = 2, authorised = false, pickAuthorises = false, usb = true }) {
  const reached = [], commands = [], errors = [];
  let provider;
  const vs = {
    ...vscode,
    env: { uiKind },
    window: { ...vscode.window, showErrorMessage: (m) => { errors.push(m); }, createOutputChannel: () => chan,
              createStatusBarItem: () => bar, registerWebviewViewProvider: () => ({ dispose() {} }) },
    commands: {
      registerCommand: () => ({ dispose() {} }),
      executeCommand: async (id) => {
        commands.push(id);
        if (id === "workbench.experimental.requestUsbDevice" && pickAuthorises) authorised = true;
      },
    },
    debug: { registerDebugConfigurationProvider: (type, p) => { if (type === "cortex-debug") provider = p; return { dispose() {} }; } },
  };
  const nav = usb
    ? { usb: { getDevices: async () => (authorised ? [fakeDevice(reached)] : []), addEventListener() {}, removeEventListener() {} } }
    : {};
  const m = { exports: {} };
  new Function("require", "module", "exports", "navigator", src)(
    (n) => { if (n === "vscode") return vs; throw new Error("unknown " + n); }, m, m.exports, nav);
  m.exports.activate({ subscriptions: [] });
  const config = { name: "Debug (PyOCD)", type: "cortex-debug", request: "launch", servertype: "pyocd" };
  const result = await provider.resolveDebugConfiguration(undefined, config);
  return { result, config, commands, errors, reached: reached.length };
}
const desktopResolve = await runResolve({ uiKind: 1, authorised: true });
check(desktopResolve.result === desktopResolve.config && !desktopResolve.commands.includes("workbench.experimental.requestUsbDevice"),
      "on the desktop the provider passes the configuration through: pyocd owns the board there, and WebUSB must not take it");
const noUsbResolve = await runResolve({ usb: false });
check(noUsbResolve.result === noUsbResolve.config, "without WebUSB it passes through too");
const dismissed = await runResolve({ authorised: false, pickAuthorises: false });
check(dismissed.commands.includes("workbench.experimental.requestUsbDevice"),
      "F5 with no authorised board opens the picker, inside the keypress's gesture window");
check(dismissed.result === undefined && dismissed.errors.some((e) => /No micro:bit was selected/.test(e) && /press F5 again/.test(e)),
      "a dismissed picker cancels the launch with a message, rather than starting gdb at nothing");
const picked = await runResolve({ authorised: false, pickAuthorises: true });
check(picked.commands.includes("workbench.experimental.requestUsbDevice") && picked.reached >= 1,
      "a chosen board is connected before the build starts");
const known = await runResolve({ authorised: true });
check(!known.commands.includes("workbench.experimental.requestUsbDevice") && known.reached >= 1,
      "an already-authorised board connects silently: the picker appears once per browser, not once per F5");

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
  const executed = [], messages = [], listening = [], debugProviders = [];
  const state = {};
  const handlers = {};
  const vs = {
    env: { uiKind, openExternal() {} }, UIKind: { Web: 2, Desktop: 1 },
    Uri: { parse: (u) => u },
    extensions: { getExtension: () => (present ? { id: "AIUnderstand.microbit-flasher" } : undefined) },
    commands: { registerCommand: (id, fn) => { handlers[id] = fn; return { dispose() {} }; },
                executeCommand: async (...a) => { executed.push(a.join(" ")); } },
    window: { showInformationMessage: async (m) => { messages.push(m); }, showWarningMessage: async () => undefined,
              createOutputChannel: () => chan, showErrorMessage() {} },
    debug: { registerDebugConfigurationProvider: (type) => { debugProviders.push(type); return { dispose() {} }; } },
  };
  // No real socket here: tools/test_companion.mjs drives the relay for real.
  const fakeNet = { createServer: () => ({ listen: (port, host) => { listening.push(`${host}:${port}`); }, on() {}, close() {} }) };
  const m = { exports: {} };
  new Function("require", "module", "exports", csrc)((n) => (n === "net" ? fakeNet : vs), m, m.exports);
  const ctx = { subscriptions: [], globalState: { get: (k) => state[k], update: async (k, v) => { state[k] = v; } } };
  const result = await m.exports.activate(ctx);
  if (force) await handlers["microbit.companion.install"]();
  return { result, executed, messages, state, listening, debugProviders, handlers };
}
const fresh = await runCompanion({ uiKind: 2, present: false });
check(fresh.executed.includes("workbench.extensions.installExtension AIUnderstand.microbit-flasher"),
      "in the browser, with no flasher, the companion asks the workbench to install it");
check(fresh.result === "installed" && fresh.state["microbit.flasherInstalled"] === true,
      "a successful install is remembered, so it is not repeated on every attach");
check(fresh.messages.some((m) => /Ctrl\+F5/.test(m)), "and the student is told what to do next");
const already = await runCompanion({ uiKind: 2, present: true });
check(already.result === "present" && !already.executed.some((e) => /installExtension/.test(e)),
      "with the flasher present, nothing is installed");
const desktop = await runCompanion({ uiKind: 1, present: false });
check(desktop.result === "desktop" && !desktop.executed.some((e) => /installExtension/.test(e)),
      "desktop VS Code has no WebUSB: the companion does nothing there");
const forcedRun = await runCompanion({ uiKind: 2, present: true, force: true });
check(forcedRun.executed.some((e) => /installExtension/.test(e)), "the command installs even when a copy is present");
// F5: gdb runs in the Codespace and reaches the board through the browser.
// The companion is the Codespace end -- a loopback port for gdb, and the
// launch configuration steered at it -- but only where the browser is the UI.
check(already.listening.includes("127.0.0.1:3333"), "in the browser, the companion listens for gdb on loopback port 3333");
check(already.debugProviders.includes("cortex-debug"), "and steers Cortex-Debug launches at it");
check(!desktop.listening.length && !desktop.debugProviders.length, "on the desktop it does neither: pyocd has the board there");
check(typeof already.handlers["microbit.companion.ping"] === "function", "the flasher's round-trip check has something to call");
check((cpkg.contributes.commands || []).some((c) => c.command === "microbit.companion.ping"),
      "the ping is a contributed command, so a call from the browser activates the companion if needed");
fs.rmSync(cout, { recursive: true, force: true });

if (fail.length) {
  console.error("FAIL");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS  extension: folder, manifest, keybinding, worker-safe bundle, activation, delivery wiring, companion");
