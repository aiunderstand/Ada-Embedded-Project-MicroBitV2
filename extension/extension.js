//  micro:bit v2 flasher -- a VS Code *web* extension.
//
//  Why a web extension: in a Codespace the terminal, the build and the files all
//  live on a remote machine with no USB port. A web extension is different --
//  VS Code loads it into the web extension host running in *your browser*, on
//  your own laptop, where the board is actually plugged in. So navigator.usb is
//  reachable from here even though it is not reachable from the Codespace shell.
//
//  Authorising a device needs a user gesture, which an extension does not have.
//  VS Code exposes a built-in command for exactly this:
//
//      workbench.experimental.requestUsbDevice({ filters: [...] })
//
//  It is marked experimental but is present in current VS Code, and is the same
//  mechanism the ESP-IDF Web extension uses. After the user picks the board,
//  navigator.usb.getDevices() returns it here and flashing proceeds normally.

/* global createUSBConnection */

const vscode = require("vscode");

const MICROBIT_VID = 0x0d28; // DAPLink interface chip on the micro:bit v2
const HEX_PATH = "build/main.hex";

let output;
let connection = null;
let status;

function log(line) {
  output.appendLine(line);
}

function setStatus(text, busy) {
  status.text = busy ? `$(sync~spin) ${text}` : `$(circuit-board) ${text}`;
  status.show();
}

let connected = false;

/** One place for "are we connected": the view's buttons, its status line, the status bar. */
function setConnected(value) {
  connected = value;
  vscode.commands.executeCommand("setContext", "microbit.connected", value);
  setStatus(value ? "Flash micro:bit (connected)" : "Flash micro:bit", false);
  if (serialView) {
    serialView.webview.postMessage({ type: "status", connected: value });
  }
}

// ---------------------------------------------------------------- serial
//
// The board's UART comes over the same authorised USB device: DAPLink bridges
// it through the CMSIS-DAP interface, and the bundled library delivers it as
// "serialdata" events and accepts text back through serialWrite(). The console
// is a webview view in the bottom panel -- an output area, an input field,
// Send and Clear. The extension holds the USB connection; the view only shows
// and asks, so a webview's lack of USB access does not matter here.

const SERIAL_VIEW = "microbitSerial"; // contributes.views id; VS Code adds "<id>.focus"
const SERIAL_BACKLOG_MAX = 64 * 1024;
let serialView = null;  // the WebviewView while it exists
let serialBacklog = ""; // what has been shown, so a re-created view can redraw

function serialReceived(data) {
  serialBacklog = (serialBacklog + data).slice(-SERIAL_BACKLOG_MAX);
  if (serialView) {
    serialView.webview.postMessage({ type: "data", text: data });
  }
}

function serialSend(text) {
  if (!connection) {
    log("serial: not connected, nothing sent");
    return;
  }
  connection.serialWrite(text).catch((err) => log(`serial write failed: ${err.message}`));
}

/** Show the console. The first time this resolves the view; never steals focus after that. */
function openSerialConsole() {
  if (serialView) {
    serialView.show(true);
    return;
  }
  vscode.commands.executeCommand(`${SERIAL_VIEW}.focus`);
}

function nonce() {
  const bytes = new Uint8Array(16);
  (globalThis.crypto || {}).getRandomValues?.(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") || String(Date.now());
}

function serialHtml(cspSource) {
  const n = nonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${n}';">
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; font-family: var(--vscode-editor-font-family, monospace);
         font-size: var(--vscode-editor-font-size, 13px); color: var(--vscode-editor-foreground);
         background: var(--vscode-editor-background); }
  #status { padding: 3px 8px; font-size: 90%; opacity: 0.8; border-bottom: 1px solid var(--vscode-panel-border, #444); }
  #status.on::before { content: "\u25cf "; color: var(--vscode-testing-iconPassed, #3c3); }
  #status.off::before { content: "\u25cb "; }
  #out { flex: 1; margin: 0; padding: 6px 8px; overflow: auto; white-space: pre-wrap; word-break: break-all; }
  #out .sent { opacity: 0.6; }
  form { display: flex; gap: 6px; padding: 6px 8px; border-top: 1px solid var(--vscode-panel-border, #444); }
  input { flex: 1; font: inherit; padding: 4px 6px; color: var(--vscode-input-foreground);
          background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
  input:focus { outline: 1px solid var(--vscode-focusBorder); }
  button { font: inherit; padding: 4px 12px; border: none; cursor: pointer;
           color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
</style>
</head>
<body>
<div id="status" class="off">Not connected \u2014 press Ctrl+Alt+F, or Connect in this view's header</div>
<pre id="out" aria-live="polite"></pre>
<form id="form" autocomplete="off">
  <input id="in" type="text" placeholder="Type a line and press Enter to send it to the micro:bit" aria-label="Text to send">
  <button type="submit" id="send">Send</button>
  <button type="button" id="clear" class="secondary">Clear</button>
</form>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const out = document.getElementById("out");
  const form = document.getElementById("form");
  const input = document.getElementById("in");
  const MAX = 200 * 1024;
  function append(text, cls) {
    const atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 24;
    const node = cls ? Object.assign(document.createElement("span"), { className: cls, textContent: text })
                     : document.createTextNode(text);
    out.appendChild(node);
    while (out.textContent.length > MAX && out.firstChild) out.removeChild(out.firstChild);
    if (atBottom) out.scrollTop = out.scrollHeight;
  }
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "data") append(m.text);
    else if (m.type === "clear") out.textContent = "";
    else if (m.type === "status") {
      const el = document.getElementById("status");
      el.className = m.connected ? "on" : "off";
      el.textContent = m.connected ? "Connected to the micro:bit"
        : "Not connected \u2014 press Ctrl+Alt+F, or Connect in this view's header";
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = "";
    append("\u203a " + text + "\\n", "sent");
    vscode.postMessage({ type: "send", text });
    input.focus();
  });
  document.getElementById("clear").addEventListener("click", () => {
    out.textContent = "";
    vscode.postMessage({ type: "clear" });
    input.focus();
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}

const serialViewProvider = {
  resolveWebviewView(view) {
    serialView = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = serialHtml(view.webview.cspSource);
    view.webview.onDidReceiveMessage((m) => {
      if (m.type === "ready") {
        // A new view (first open, or re-created after the panel was closed)
        // starts from what has been received so far.
        view.webview.postMessage({ type: "status", connected });
        if (serialBacklog) view.webview.postMessage({ type: "data", text: serialBacklog });
      } else if (m.type === "send") {
        // Enter sends CR LF, the terminator Put_Line itself writes, so a Get
        // loop that stops on either character works.
        serialSend(`${m.text}\r\n`);
      } else if (m.type === "clear") {
        serialBacklog = "";
      }
    });
    view.onDidDispose(() => {
      if (serialView === view) serialView = null;
    });
  },
};

/** The first workspace folder, or undefined when no folder is open. */
function workspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri : undefined;
}

async function hexExists() {
  const root = workspaceRoot();
  if (!root) return false;
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, ...HEX_PATH.split("/")));
    return true;
  } catch {
    return false;
  }
}

async function readHex() {
  const root = workspaceRoot();
  if (!root) {
    throw new Error("No folder is open.");
  }
  const uri = vscode.Uri.joinPath(root, ...HEX_PATH.split("/"));
  let bytes;
  try {
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch {
    throw new Error(
      `${HEX_PATH} not found. Build first: press Ctrl+Shift+B, or run ` +
        "python3 tools/mb.py build"
    );
  }
  const text = new TextDecoder().decode(bytes);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length || !lines[0].startsWith(":")) {
    throw new Error(`${HEX_PATH} is not an Intel HEX file.`);
  }
  if (lines[lines.length - 1].toUpperCase() !== ":00000001FF") {
    throw new Error(`${HEX_PATH} is truncated (no end-of-file record).`);
  }
  return text;
}

/** Ensure we have a USB connection, authorising a device if needed. */
async function ensureConnected() {
  if (connection) {
    return connection;
  }
  if (typeof navigator === "undefined" || !navigator.usb) {
    throw new Error(
      "This VS Code cannot reach USB devices. Flashing from here needs a " +
        "Chromium-based browser (Chrome, Edge or Opera). In desktop VS Code, " +
        "flash with: python3 tools/mb.py flash"
    );
  }

  // Already-authorised devices need no prompt.
  const find = (list) => list.find((d) => d.vendorId === MICROBIT_VID);
  let device = find(await navigator.usb.getDevices());
  if (!device) {
    log("Asking you to choose the micro:bit...");
    await vscode.commands.executeCommand(
      "workbench.experimental.requestUsbDevice",
      { filters: [{ vendorId: MICROBIT_VID }] }
    );
    device = find(await navigator.usb.getDevices());
  }
  if (!device) {
    throw new Error("No micro:bit was selected.");
  }

  // pauseOnHidden touches window/document, which do not exist in a worker.
  //
  // Left to itself the library asks for a device with
  // navigator.usb.requestDevice(), which exists on a page and not in a worker
  // ("navigator.usb.requestDevice is not a function", from a real Codespace).
  // The workbench has just authorised one, so hand it over -- that path also
  // reports a failed connection instead of swallowing it and asking again --
  // and route the library's own log into the output channel.
  const usb = createUSBConnection({
    pauseOnHidden: false,
    deviceSelectionMode: "UseAnyAllowed",
    logging: { log: (m) => log(`  [usb] ${m}`), event: () => {} },
  });
  usb.usbDevice = device;
  usb.addEventListener("status", ({ status: s }) => {
    log(`connection: ${s}`);
    setConnected(s === "Connected");
  });
  usb.addEventListener("serialdata", ({ data }) => serialReceived(data));
  usb.addEventListener("serialreset", () => serialReceived("\n--- program restarted ---\n"));
  await usb.connect();
  connection = usb;
  return usb;
}

async function cmdConnect() {
  output.show(true);
  try {
    setStatus("connecting", true);
    await ensureConnected();
    log("Connected. Serial output is in the micro:bit Serial view.");
    openSerialConsole();
    setConnected(true);
  } catch (err) {
    setConnected(false);
    log(`Error: ${err.message}`);
    vscode.window.showErrorMessage(`micro:bit: ${err.message}`);
  }
}

async function cmdDisconnect() {
  const usb = connection;
  connection = null;
  setConnected(false);
  if (usb) {
    try {
      await usb.disconnect();
      log("Disconnected.");
    } catch (err) {
      log(`disconnect: ${err.message}`);
    }
  }
}

const BUILD_TASK = "Build";
const BUILD_TIMEOUT_MS = 10 * 60 * 1000; // a cold Codespace build can take minutes

/** Run the workspace "Build" task and wait for it; null when there is none. */
async function runBuildTask() {
  let task;
  try {
    const all = await vscode.tasks.fetchTasks();
    task = all.find((t) => t.name === BUILD_TASK);
  } catch {
    return null;
  }
  if (!task) {
    return null; // no task to run; fall back to whatever is already built
  }
  log("Building...");
  setStatus("building", true);
  // Not vscode.tasks.executeTask: in the *web worker* extension host that only
  // accepts CustomExecution tasks and throws NotSupported for a shell/process
  // task, which is what "Build" is. The workbench command runs any task, on the
  // remote, from any host; completion arrives as an ordinary task event.
  const finished = new Promise((resolve) => {
    const timer = setTimeout(() => { sub.dispose(); resolve(null); }, BUILD_TIMEOUT_MS);
    const sub = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution.task.name === BUILD_TASK) {
        clearTimeout(timer);
        sub.dispose();
        resolve(e.exitCode === 0);
      }
    });
  });
  await vscode.commands.executeCommand("workbench.action.tasks.runTask", BUILD_TASK);
  log(`Task "${BUILD_TASK}" started; waiting for it to finish...`);
  return finished;
}

async function cmdFlash() {
  output.show(true);
  try {
    // The board first: Chrome shows the USB picker only while it is handling
    // the user's gesture, a window of about five seconds, and a full build is
    // longer than that. Asking now, straight from the keypress, keeps the first
    // flash on a machine inside it; once authorised there is no picker at all.
    const usb = await ensureConnected();
    // Then build, so one action does the whole job and a stale hex can never
    // be flashed silently. Previously this failed with "build first" if you
    // forgot, and the status-bar button could flash yesterday's firmware.
    const built = await runBuildTask();
    if (built === false) {
      throw new Error("The build failed; see the terminal. Nothing was flashed.");
    }
    if (built === null && !(await hexExists())) {
      throw new Error(
        "Nothing to flash. Build first: Ctrl+Shift+B, or python3 tools/mb.py build"
      );
    }
    const hex = await readHex();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Flashing micro:bit" },
      async (progress) => {
        let last = 0;
        await usb.flash(async () => hex, {
          // Partial flashing is a MakeCode feature that relies on that
          // toolchain's flash layout; a GNAT-built hex must be flashed in full.
          partial: false,
          progress: (stage, fraction) => {
            const pct = Math.round((fraction ?? 0) * 100);
            progress.report({ increment: pct - last, message: String(stage) });
            last = pct;
          },
        });
      }
    );
    log(`Flashed ${HEX_PATH}.`);
    openSerialConsole();
    vscode.window.showInformationMessage("micro:bit flashed.");
  } catch (err) {
    // The stack goes to the output channel: "NotSupported" alone says nothing
    // about which VS Code API refused, and that is the question in a web host.
    log(`Error: ${err.stack || err.message}`);
    vscode.window.showErrorMessage(`micro:bit: ${err.message}`);
  } finally {
    // Never leave the "building" spinner behind after a failure.
    const connected = connection && connection.status === "Connected";
    setStatus(connected ? "Flash micro:bit (connected)" : "Flash micro:bit", false);
  }
}

async function cmdStatus() {
  output.show(true);
  log("--- status ---");
  log(`navigator.usb available: ${typeof navigator !== "undefined" && !!navigator.usb}`);
  if (typeof navigator !== "undefined" && navigator.usb) {
    const devices = await navigator.usb.getDevices();
    log(`authorised devices: ${devices.length}`);
    for (const d of devices) {
      log(
        `  ${d.productName || "(unnamed)"} ` +
          `vid=0x${d.vendorId.toString(16)} pid=0x${d.productId.toString(16)}`
      );
    }
  }
  log(`connection: ${connection ? connection.status : "none"}`);
}

function activate(context) {
  output = vscode.window.createOutputChannel("micro:bit");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "microbit.flash";
  status.tooltip = "Build and flash to the micro:bit";
  setStatus("Flash micro:bit", false);

  context.subscriptions.push(
    output,
    status,
    vscode.commands.registerCommand("microbit.connect", cmdConnect),
    vscode.commands.registerCommand("microbit.disconnect", cmdDisconnect),
    vscode.commands.registerCommand("microbit.flash", cmdFlash),
    vscode.commands.registerCommand("microbit.status", cmdStatus),
    vscode.commands.registerCommand("microbit.serial", openSerialConsole),
    vscode.window.registerWebviewViewProvider(SERIAL_VIEW, serialViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } })
  );

  // Reconnect silently if the board was authorised earlier in this browser, so
  // the device picker appears once ever rather than once per session, and serial
  // output starts flowing without the student doing anything.
  (async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.usb) {
        const devices = await navigator.usb.getDevices();
        if (devices.some((d) => d.vendorId === MICROBIT_VID)) {
          log("Board already authorised; connecting...");
          await ensureConnected();
        }
      }
    } catch (err) {
      log(`(could not reconnect automatically: ${err.message})`);
    }
  })();

  log("micro:bit flasher ready.");
  if (typeof navigator === "undefined" || !navigator.usb) {
    log(
      "note: navigator.usb is not available in this extension host, so this " +
        "extension cannot flash here. That is expected in desktop VS Code; use " +
        "python3 tools/mb.py flash instead."
    );
  }
}

function deactivate() {
  if (connection) {
    connection.disconnect().catch(() => {});
  }
}

module.exports = {
  activate,
  deactivate,
  // For tools/test_extension.mjs, which has no board to emit serial data.
  _serial: {
    received: serialReceived,
    open: openSerialConsole,
    setConnection: (c) => { connection = c; },
  },
};
