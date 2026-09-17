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
//
//  Desktop VS Code loads this extension as well (it is a workspace
//  recommendation, so a student on their own PC has it). There the picker
//  command does not exist, and the board belongs to pyocd: the flash runs the
//  workspace's "Build & Flash" task instead, and the Serial view cannot connect;
//  Microsoft's Serial Monitor extension is the desktop's console.
//
//  One key on every path: Ctrl+Shift+B. It is VS Code's build chord, which
//  runs the "Build & Flash" task (mb.py flash, pyocd) on a desktop. In the
//  browser this extension takes the chord over ("when": microbit.usbHost, a
//  context set at activation), because there the board is reachable only
//  from here, and the picker only inside the keypress's gesture window.

/* global createUSBConnection, GdbServer */

const vscode = require("vscode");

const MICROBIT_VID = 0x0d28; // DAPLink interface chip on the micro:bit v2
const HEX_PATH = "build/main.hex";

let output;
let connection = null;
let status;
let projectItem; // status bar: which project the flash builds

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
  postBoards();
}

// ---------------------------------------------------------------- boards
//
// Which micro:bit, when there are several, and whether it is a v2 at all.
// DAPLink's USB serial number starts with the board id: 9900 and 9901 are a
// v1, 9903 to 9906 a v2. The same string is pyocd's unique id for the probe,
// so the choice made here serves the flash on a desktop (build/board.txt).
//
// In the browser the list is navigator.usb.getDevices(), the boards this
// browser has authorised, kept fresh by WebUSB's connect and disconnect
// events. On a desktop this host has no USB: the companion runs
// "mb.py boards --watch" next to the board and sends the list, the serial
// data and the port's state here as commands, and takes open, close and
// send back through microbit.companion.serial.

const V1_IDS = ["9900", "9901"];
const V2_IDS = ["9903", "9904", "9905", "9906"];

function boardVersion(serialNumber) {
  const prefix = (serialNumber || "").slice(0, 4);
  return V2_IDS.includes(prefix) ? "v2" : V1_IDS.includes(prefix) ? "v1" : null;
}

function boardLabel(b) {
  const which = b.version === "v2" ? "micro:bit v2" : b.version === "v1" ? "micro:bit v1 (not supported)" : "micro:bit?";
  return `${which} \u00b7 ${b.id.slice(-4)}${b.port ? ` (${b.port})` : ""}`;
}

let boards = [];        // {id, version, port?, device?} -- device in the browser only
let selectedId = null;  // the board the view chose
let reading = true;     // the view's "Show serial" box: read the port, or leave it alone
let boardNote = "";     // the desktop bridge's last word (opened, closed, an error)

const isBrowser = () => vscode.env.uiKind === vscode.UIKind.Web && usbAvailable();

function selectedBoard() {
  return boards.find((b) => b.id === selectedId) || null;
}

/** What the view shows: the list without the device objects, and the state around it. */
function postBoards() {
  if (!serialView) return;
  serialView.webview.postMessage({
    type: "boards",
    host: isBrowser() ? "browser" : "desktop",
    boards: boards.map((b) => ({ id: b.id, version: b.version, port: b.port || "", label: boardLabel(b), selectable: b.version === "v2" })),
    selected: selectedId,
    reading,
    connected,
    note: boardNote,
  });
}

/** Keep the choice, and pick one when there is none: the first v2. */
async function settleSelection() {
  if (!selectedBoard()) {
    const first = boards.find((b) => b.version === "v2");
    selectedId = first ? first.id : null;
    await rememberBoard();
    if (selectedId && !isBrowser() && reading && !connected) {
      // A desktop: a newly picked board is read at once, as the view says.
      await bridge({ op: "open", id: selectedId }).catch((err) => { boardNote = err.message; });
    }
  }
  postBoards();
}

/** build/board.txt: the desktop flash (mb.py flash, pyocd -u) follows the view's choice. */
async function rememberBoard() {
  const root = workspaceRoot();
  if (!root) return;
  try {
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, "build", "board.txt"),
      new TextEncoder().encode((selectedId || "") + "\n"));
  } catch (err) {
    log(`(could not record the chosen board: ${err.message})`);
  }
}

/** The browser's list: the authorised devices, classified. */
async function refreshBrowserBoards() {
  const devices = await navigator.usb.getDevices();
  boards = devices
    .filter((d) => d.vendorId === MICROBIT_VID)
    .map((d) => ({ id: d.serialNumber || `${d.vendorId}:${d.productId}`, version: boardVersion(d.serialNumber), device: d }));
  await settleSelection();
}

/** The view chose a board: connect to it (browser) or have the bridge read it (desktop). */
async function selectBoard(id) {
  if (id === selectedId) return;
  selectedId = id;
  await rememberBoard();
  postBoards();
  const board = selectedBoard();
  if (!board || board.version !== "v2") return;
  try {
    if (isBrowser()) {
      if (connection && connection.device && connection.device !== board.device) {
        await cmdDisconnect();
      }
      if (!liveConnection()) {
        await connectTo(board.device);
      }
    } else if (reading) {
      await bridge({ op: "open", id });
    }
  } catch (err) {
    log(`board ${id.slice(-4)}: ${err.message}`);
    boardNote = err.message;
    postBoards();
  }
}

/**
 * The "Show serial" box. Not cosmetic: off means the port is not read. In the
 * browser the library polls DAPLink for serial only while a "serialdata"
 * listener exists, so the listener comes and goes; on the desktop the bridge
 * closes the port.
 */
async function setReading(on) {
  reading = !!on;
  try {
    if (isBrowser()) {
      const usb = liveConnection();
      if (usb) {
        usb.removeEventListener("serialdata", onSerialData);
        if (reading) usb.addEventListener("serialdata", onSerialData);
      }
    } else if (reading && selectedBoard()) {
      await bridge({ op: "open", id: selectedId });
    } else {
      await bridge({ op: "close" });
    }
  } catch (err) {
    boardNote = err.message;
  }
  postBoards();
}

const onSerialData = ({ data }) => serialReceived(data);

/** A request to the companion's bridge, on a desktop. */
async function bridge(req) {
  try {
    await vscode.commands.executeCommand("microbit.companion.serial", req);
  } catch (err) {
    throw new Error(/not found/i.test(err.message)
      ? "The micro:bit companion extension is not installed on this machine; it lists the boards and reads their serial output. Install AIUnderstand.microbit-companion."
      : err.message);
  }
}

// What the companion sends, on a desktop.
function cmdBoardsUpdate(list) {
  boards = (list || []).map((b) => ({ id: b.id, version: b.version, port: b.port }));
  return settleSelection();
}

function cmdSerialReceived(text) {
  if (reading) serialReceived(text);
}

function cmdBoardsState(ev) {
  if (!ev) return;
  if (ev.event === "opened") {
    boardNote = "";
    setConnected(true);
  } else if (ev.event === "closed") {
    boardNote = ev.reason ? `${ev.reason}` : "";
    setConnected(false);
  } else if (ev.event === "error") {
    boardNote = ev.message || "error";
    postBoards();
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
  if (!reading) return; // not shown, and on the desktop not read either
  serialBacklog = (serialBacklog + data).slice(-SERIAL_BACKLOG_MAX);
  if (serialView) {
    serialView.webview.postMessage({ type: "data", text: data });
  }
}

const SERIAL_CHAR_GAP_MS = 10;
let serialQueue = Promise.resolve();

/**
 * Send to the board one character at a time, a few milliseconds apart.
 *
 * There is no flow control between DAPLink and the nRF52, and the board's
 * UART driver polls a FIFO of a few bytes. A whole line arrives in under a
 * millisecond at 115200 baud; a program that prints something per character
 * cannot keep up, and the first real session ended with the program wedged
 * after two characters of "hello". Keystrokes from a terminal never came that
 * fast, which is why the earlier console looked fine.
 */
function serialSend(text) {
  if (!connection) {
    if (!isBrowser()) {
      // A desktop: the bridge holds the port, not this host.
      return bridge({ op: "send", text: text.replace(/\r?\n$/, "") }).catch((err) => log(`serial: ${err.message}`));
    }
    log("serial: not connected, nothing sent");
    return Promise.resolve();
  }
  const usb = connection;
  serialQueue = serialQueue
    .then(async () => {
      for (const ch of text) {
        await usb.serialWrite(ch);
        await new Promise((resolve) => setTimeout(resolve, SERIAL_CHAR_GAP_MS));
      }
    })
    .catch((err) => log(`serial write failed: ${err.message}`));
  return serialQueue;
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
  #bar { display: flex; gap: 10px; align-items: center; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border, #444); flex-wrap: wrap; }
  #bar select { font: inherit; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background);
                border: 1px solid var(--vscode-dropdown-border, transparent); padding: 2px 4px; max-width: 60%; }
  #bar label { display: flex; gap: 4px; align-items: center; cursor: pointer; }
  #host { opacity: 0.6; font-size: 90%; margin-left: auto; }
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
<div id="bar">
  <select id="board" aria-label="Which micro:bit"><option value="">no micro:bit v2 found</option></select>
  <label><input type="checkbox" id="read" checked> Show serial</label>
  <span id="host"></span>
</div>
<div id="status" class="off">Not connected \u2014 press Ctrl+Shift+B, or Connect in this view's header</div>
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
  const boardSel = document.getElementById("board");
  const readBox = document.getElementById("read");
  let host = "browser";
  function showStatus(connected, note) {
    const el = document.getElementById("status");
    el.className = connected ? "on" : "off";
    const idle = host === "browser"
      ? "Not connected \u2014 press Ctrl+Shift+B, or Connect in this view's header"
      : (readBox.checked ? "Not reading \u2014 plug in a micro:bit v2 and pick it above"
                         : "Serial off \u2014 tick Show serial to read the board");
    el.textContent = (connected ? (readBox.checked ? "Reading the micro:bit" : "Connected; serial off") : idle)
      + (note ? " \u2014 " + note : "");
  }
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "data") append(m.text);
    else if (m.type === "clear") out.textContent = "";
    else if (m.type === "status") showStatus(m.connected, "");
    else if (m.type === "boards") {
      host = m.host;
      document.getElementById("host").textContent = host === "browser" ? "boards: this browser (WebUSB)" : "boards: this machine (pyocd, serial)";
      boardSel.textContent = "";
      if (!m.boards.length) {
        boardSel.appendChild(Object.assign(document.createElement("option"), { value: "", textContent: "no micro:bit v2 found" }));
      }
      for (const b of m.boards) {
        const o = Object.assign(document.createElement("option"), { value: b.id, textContent: b.label, disabled: !b.selectable });
        if (b.id === m.selected) o.selected = true;
        boardSel.appendChild(o);
      }
      readBox.checked = !!m.reading;
      showStatus(m.connected, m.note);
    }
  });
  boardSel.addEventListener("change", () => vscode.postMessage({ type: "select", id: boardSel.value }));
  readBox.addEventListener("change", () => vscode.postMessage({ type: "read", on: readBox.checked }));
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
        postBoards();
      } else if (m.type === "send") {
        // Enter sends CR LF, the terminator Put_Line itself writes, so a Get
        // loop that stops on either character works.
        serialSend(`${m.text}\r\n`);
      } else if (m.type === "clear") {
        serialBacklog = "";
      } else if (m.type === "select") {
        selectBoard(m.id);
      } else if (m.type === "read") {
        setReading(m.on);
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

async function readTextIfPresent(relPath) {
  const root = workspaceRoot();
  if (!root) return "";
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...relPath.split("/")));
    return new TextDecoder().decode(bytes).trim();
  } catch {
    return "";
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

const usbAvailable = () => typeof navigator !== "undefined" && !!navigator.usb;

/** The micro:bit this browser has already authorised, if any. Never prompts. */
async function authorisedDevice() {
  await refreshBrowserBoards();
  const chosen = selectedBoard();
  if (chosen && chosen.device) return chosen.device;
  return (boards.find((b) => b.version === "v2") || boards[0] || {}).device;
}

/**
 * The connection, if it still is one. Unplugging the board leaves the
 * library's object behind with a status other than "Connected" -- its
 * disconnect handler, installed by initialize(), records that -- and a
 * re-plugged board is a new USBDevice, so such an object is dropped here and
 * the next use reconnects instead of failing on a device Chrome has closed.
 */
function liveConnection() {
  if (connection && connection.status !== "Connected") {
    log(`the previous connection is ${connection.status}; it will be re-made`);
    try {
      connection.dispose?.();
    } catch {
      // nothing left to release
    }
    connection = null;
    setConnected(false);
  }
  return connection;
}

/** Ensure we have a USB connection, authorising a device if needed. */
async function ensureConnected() {
  if (liveConnection()) {
    return connection;
  }
  if (vscode.env.uiKind !== vscode.UIKind.Web) {
    // Desktop VS Code runs this web extension in a worker whose
    // Electron-backed navigator.usb exists and answers getDevices() with
    // nothing -- so the usbAvailable() check below said yes on a Windows PC,
    // and the next call, the workbench's device picker, is registered by the
    // browser build only:
    //   Error: command 'workbench.experimental.requestUsbDevice' not found
    // The picker is a browser thing, and so is everything past this point.
    throw new Error(desktopAdvice());
  }
  if (!usbAvailable()) {
    throw new Error(
      "This browser has no WebUSB. Flashing from here needs a Chromium-based " +
        "browser (Chrome, Edge or Opera)."
    );
  }

  // Already-authorised devices need no prompt.
  let device = await authorisedDevice();
  if (!device) {
    log("Asking you to choose the micro:bit...");
    await vscode.commands.executeCommand(
      "workbench.experimental.requestUsbDevice",
      { filters: [{ vendorId: MICROBIT_VID }] }
    );
    device = await authorisedDevice();
  }
  if (!device) {
    throw new Error("No micro:bit was selected.");
  }
  return connectTo(device);
}

/**
 * Connect to a board this browser has already authorised, or return null.
 * For the places that have no user gesture to spend on the picker: the
 * reconnect at activation, and a debug session arriving through gdb.
 */
async function connectIfAuthorised() {
  if (liveConnection()) {
    return connection;
  }
  if (vscode.env.uiKind !== vscode.UIKind.Web || !usbAvailable()) {
    return null;
  }
  const device = await authorisedDevice();
  return device ? connectTo(device) : null;
}

/** What to do on a desktop, where this extension cannot reach the board. */
function desktopAdvice() {
  if (vscode.env.remoteName) {
    // Desktop VS Code attached to a Codespace: the board is on this machine,
    // pyocd in the Codespace cannot see it, and mb.py's own hint for that
    // case says "press Ctrl+Shift+B" -- which is what just failed.
    return (
      "This VS Code runs on your machine, which has no USB picker, and the " +
        "Codespace it is attached to has no USB at all. Open the Codespace in the " +
        "browser (Chrome or Edge) and press Ctrl+Shift+B there, or download build/main.hex " +
        "and drop it on https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/"
    );
  }
  return (
    "Desktop VS Code cannot open the board over WebUSB; here pyocd flashes it: " +
      "press Ctrl+Shift+B (the Build & Flash task), or run python3 tools/mb.py flash. " +
      "Serial output: Microsoft's Serial Monitor extension, on the board's port at 115200 baud."
  );
}

async function connectTo(device) {
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
  // The serial listener is what makes the library poll DAPLink for serial;
  // the "Show serial" box adds and removes it (setReading).
  if (reading) usb.addEventListener("serialdata", onSerialData);
  usb.addEventListener("serialreset", () => serialReceived("\n--- program restarted ---\n"));
  // Installs the library's WebUSB "disconnect" handler, which is what turns
  // an unplugged board into a status other than "Connected" (worker-safe: it
  // touches window only where one exists). Without it the object would
  // claim to be connected to a device that no longer is.
  await usb.initialize?.();
  await usb.connect();
  connection = usb;
  if (device.serialNumber && selectedId !== device.serialNumber) {
    selectedId = device.serialNumber; // the picker's choice is the choice
    await rememberBoard();
  }
  postBoards();
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
  if (gdb) {
    // Otherwise the core is left halted on breakpoints nothing can clear.
    log("Ending the debug session first.");
    await cmdGdbDetach();
  }
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
const CHOOSE_TASK = "Choose project..."; // tasks.json label; its input shows the list

/** What mb.py will build next: build/project.txt, or the template. */
async function refreshProjectItem() {
  const chosen = (await readTextIfPresent("build/project.txt")) || "template";
  projectItem.text = `$(folder) ${chosen}`;
  projectItem.tooltip = `Ctrl+Shift+B builds and flashes: ${chosen}. Click to choose another project, or 'template' for your own program.`;
  projectItem.show();
}

/**
 * Run the "Choose project..." task and refresh the item when it ends. Run
 * Build Task (Ctrl+Shift+B) would not show it: with a default build task VS
 * Code runs that at once, no picker, and nobody finds "Tasks: Run Task".
 */
async function cmdChooseProject() {
  const sub = vscode.tasks.onDidEndTaskProcess((e) => {
    if (e.execution.task.name === CHOOSE_TASK) {
      sub.dispose();
      refreshProjectItem();
    }
  });
  await vscode.commands.executeCommand("workbench.action.tasks.runTask", CHOOSE_TASK);
}
const FLASH_TASK = "Build & Flash"; // tasks.json: mb.py flash, i.e. pyocd
const BUILD_TIMEOUT_MS = 10 * 60 * 1000; // a cold Codespace build can take minutes

/** Run the workspace "Build" task and wait for it; null when there is none. */
const runBuildTask = () => runTask(BUILD_TASK, "Building...");

/** Run a workspace task by name and wait for it: its success, or null when there is none. */
async function runTask(name, doing) {
  let task;
  try {
    const all = await vscode.tasks.fetchTasks();
    task = all.find((t) => t.name === name);
  } catch {
    return null;
  }
  if (!task) {
    return null; // no task to run; the caller decides what that means
  }
  log(doing);
  setStatus("building", true);
  // Not vscode.tasks.executeTask: in the *web worker* extension host that only
  // accepts CustomExecution tasks and throws NotSupported for a shell/process
  // task, which is what "Build" is. The workbench command runs any task, on the
  // remote, from any host; completion arrives as an ordinary task event.
  const finished = new Promise((resolve) => {
    const timer = setTimeout(() => { sub.dispose(); resolve(null); }, BUILD_TIMEOUT_MS);
    const sub = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution.task.name === name) {
        clearTimeout(timer);
        sub.dispose();
        resolve(e.exitCode === 0);
      }
    });
  });
  await vscode.commands.executeCommand("workbench.action.tasks.runTask", name);
  log(`Task "${name}" started; waiting for it to finish...`);
  const result = await finished;
  refreshProjectItem();
  return result;
}

/**
 * The flash on a desktop. The board belongs to pyocd there, and the
 * workspace already has a task for exactly that, so the one key does the
 * same job on every path -- as F5 does through the one launch.json entry.
 */
async function flashWithPyocd() {
  if (vscode.env.remoteName) {
    throw new Error(desktopAdvice());
  }
  const result = await runTask(FLASH_TASK, "Desktop VS Code: building and flashing with pyocd...");
  if (result === null) {
    throw new Error(
      `Desktop VS Code cannot open the board over WebUSB, and this workspace has no ` +
        `"${FLASH_TASK}" task to run instead. In the course template: python3 tools/mb.py flash`
    );
  }
  if (result === false) {
    throw new Error(`"${FLASH_TASK}" failed; see the terminal. Nothing was flashed.`);
  }
  log(`Flashed with pyocd (the "${FLASH_TASK}" task).`);
}

/** Flash an Intel HEX text, with a progress notification. The flash and gdb's `load` both end here. */
function flashHex(usb, hex) {
  return vscode.window.withProgress(
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
}

async function cmdFlash() {
  output.show(true);
  try {
    // Flashing under gdb's feet would answer its pending `continue` with a
    // stop mid-flash and leave it debugging a program that is no longer there.
    if (gdb) {
      throw new Error("A debug session is running. Stop it first (Shift+F5); F5 rebuilds and reflashes.");
    }
    if (vscode.env.uiKind !== vscode.UIKind.Web) {
      await flashWithPyocd();
      return;
    }
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
    await flashHex(usb, hex);
    // mb.py records which project it staged; with "Choose project..." in
    // play, the student needs to see what actually went to the board.
    const project = await readTextIfPresent("build/last-project.txt");
    const what = project ? `${HEX_PATH} (${project})` : HEX_PATH;
    log(`Flashed ${what}.`);
    openSerialConsole();
    vscode.window.showInformationMessage(`micro:bit flashed: ${project || "build/main.hex"}.`);
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

// ------------------------------------------------------------- debugging
//
// F5 in a Codespace. arm-eabi-gdb runs in the Codespace, where the ELF is,
// and talks to a TCP port the companion extension opens there. The companion
// forwards every gdb packet to microbit.gdb.packet, and GdbServer
// (gdbserver.js, bundled ahead of this file) answers it over the USB
// connection the flasher already holds. VS Code routes a command to whichever
// extension host registered it, which is how the Codespace half reaches the
// browser half.

let gdb = null; // the GdbServer while gdb is attached

/**
 * What GdbServer needs from the board, looked up on every call: the library
 * replaces its device object when it reconnects to flash.
 */
function debugTarget() {
  const dev = () => {
    if (!connection || !connection.device) {
      throw new Error("the micro:bit is not connected");
    }
    return connection.device;
  };
  return {
    readMem32: (addr) => dev().adi.readMem32(addr),
    writeMem32: (addr, value) => dev().adi.writeMem32(addr, value),
    readBlock: (addr, words) => dev().adi.readBlock(addr, words),
    writeBlock: (addr, words) => dev().adi.writeBlock(addr, words),
    readCoreRegister: (sel) => dev().cortexM.readCoreRegister(sel),
    writeCoreRegister: (sel, value) => dev().cortexM.writeCoreRegister(sel, value),
    flash: (hex) => {
      dev(); // the same "not connected" error as the others, before any toast
      return flashHex(connection, hex);
    },
  };
}

async function cmdGdbAttach() {
  output.show(true);
  // No user gesture reaches this point -- F5 went through gdb, a socket and
  // the companion -- so the picker cannot be shown from here. Normally the
  // debug-configuration provider above already connected the board at the
  // keypress; this is the fallback for a dismissed picker, or a flasher that
  // had not finished starting when F5 was pressed.
  if (!(await connectIfAuthorised())) {
    throw new Error(
      "Connect the micro:bit first: press F5 again and choose the board in the " +
        "picker, or press Connect in the Serial view's header."
    );
  }
  if (gdb) {
    await gdb.detach();
  }
  gdb = new GdbServer(debugTarget(), { log });
  await gdb.attach();
  return "attached";
}

function cmdGdbPacket(body) {
  if (!gdb) {
    throw new Error("no debug session");
  }
  return gdb.handle(body);
}

async function cmdGdbInterrupt() {
  if (gdb) {
    await gdb.interrupt();
  }
}

async function cmdGdbDetach() {
  const session = gdb;
  gdb = null;
  if (session) {
    await session.detach();
  }
}

// The attach above arrives through gdb, the companion and a socket, seconds
// after the keypress, and Chrome shows the USB picker only while it is
// handling a gesture -- so the attach cannot ask for the board. F5 itself is
// a gesture, though. VS Code asks every debug-configuration provider for the
// type to resolve the configuration before it builds or starts anything, and
// a provider registered here, in the browser, runs inside that window. So the
// board is asked for at F5, exactly as Ctrl+Shift+B asks before building; by
// the time gdb attaches, the connection already exists.
const debugConfigurationProvider = {
  async resolveDebugConfiguration(folder, config) {
    // Desktop VS Code, or a browser without WebUSB: pyocd owns the board
    // there, and holding it over WebUSB would take it away from pyocd.
    if (!config || vscode.env.uiKind !== vscode.UIKind.Web || !usbAvailable()) {
      return config;
    }
    try {
      await ensureConnected();
    } catch (err) {
      log(`F5: ${err.message}`);
      vscode.window.showErrorMessage(
        `micro:bit: ${err.message} Debugging needs the board: plug it in and press F5 again.`
      );
      return undefined; // cancels the launch; the message says why
    }
    return config;
  },
};

async function cmdStatus() {
  output.show(true);
  log("--- status ---");
  log(`host: ${vscode.env.uiKind === vscode.UIKind.Web ? "browser" : "desktop VS Code"}` +
      (vscode.env.remoteName ? ` attached to ${vscode.env.remoteName}` : ""));
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
  log(`boards: ${boards.length ? boards.map((b) => `${boardLabel(b)}${b.id === selectedId ? " [chosen]" : ""}`).join(", ") : "none"}; serial ${reading ? "on" : "off"}`);
  log(`gdb: ${gdb ? (gdb.running ? "attached, program running" : "attached, program stopped") : "not attached"}`);
  // The companion lives in the Codespace; this round trip is what every gdb
  // packet costs, so it is the number to quote when stepping feels slow.
  try {
    const t0 = Date.now();
    await vscode.commands.executeCommand("microbit.companion.ping");
    log(`companion round trip: ${Date.now() - t0} ms`);
  } catch {
    log("companion: not reachable (desktop VS Code, or the companion is not installed)");
  }
}

function activate(context) {
  output = vscode.window.createOutputChannel("micro:bit");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "microbit.flash";
  status.tooltip = "Build and flash to the micro:bit (Ctrl+Shift+B)";
  setStatus("Flash micro:bit", false);
  // The build chord is this extension's only in the browser; see the header.
  vscode.commands.executeCommand("setContext", "microbit.usbHost",
    vscode.env.uiKind === vscode.UIKind.Web && usbAvailable());
  projectItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  projectItem.command = "microbit.chooseProject";
  refreshProjectItem();

  context.subscriptions.push(
    output,
    status,
    projectItem,
    vscode.commands.registerCommand("microbit.connect", cmdConnect),
    vscode.commands.registerCommand("microbit.disconnect", cmdDisconnect),
    vscode.commands.registerCommand("microbit.flash", cmdFlash),
    vscode.commands.registerCommand("microbit.status", cmdStatus),
    vscode.commands.registerCommand("microbit.serial", openSerialConsole),
    vscode.commands.registerCommand("microbit.chooseProject", cmdChooseProject),
    // For the companion, not for people: hidden from the command palette.
    vscode.commands.registerCommand("microbit.gdb.attach", cmdGdbAttach),
    vscode.commands.registerCommand("microbit.gdb.packet", cmdGdbPacket),
    vscode.commands.registerCommand("microbit.gdb.interrupt", cmdGdbInterrupt),
    vscode.commands.registerCommand("microbit.gdb.detach", cmdGdbDetach),
    vscode.commands.registerCommand("microbit.gdb.ping", () => "pong"),
    // From the companion, on a desktop: the boards next to this machine.
    vscode.commands.registerCommand("microbit.boards.update", cmdBoardsUpdate),
    vscode.commands.registerCommand("microbit.serial.received", cmdSerialReceived),
    vscode.commands.registerCommand("microbit.boards.state", cmdBoardsState),
    // Asks for the board at F5, inside the keypress's gesture window.
    vscode.debug.registerDebugConfigurationProvider("cortex-debug", debugConfigurationProvider),
    vscode.window.registerWebviewViewProvider(SERIAL_VIEW, serialViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } })
  );

  // Reconnect silently if the board was authorised earlier in this browser, so
  // the device picker appears once ever rather than once per session, and serial
  // output starts flowing without the student doing anything.
  (async () => {
    try {
      if (isBrowser()) {
        // Plugging and unplugging: the list follows, and an unplugged board
        // that was the connection is let go of, not kept as if it were there.
        navigator.usb.addEventListener?.("connect", () => refreshBrowserBoards().catch(() => {}));
        navigator.usb.addEventListener?.("disconnect", async (e) => {
          if (connection && connection.device && e.device === connection.device) {
            log("The connected micro:bit was unplugged.");
            await cmdDisconnect();
          }
          await refreshBrowserBoards();
        });
        if (await authorisedDevice()) {
          log("Board already authorised; connecting...");
          await connectIfAuthorised();
        }
      } else {
        // The companion may be up already, with the list; otherwise it will send it.
        const list = await vscode.commands.executeCommand("microbit.companion.boards");
        if (Array.isArray(list)) await cmdBoardsUpdate(list);
        if (reading && selectedBoard()) await bridge({ op: "open", id: selectedId });
      }
    } catch (err) {
      log(`(boards: ${err.message})`);
    }
  })();

  log("micro:bit flasher ready.");
  if (vscode.env.uiKind !== vscode.UIKind.Web) {
    log(
      `note: this is desktop VS Code, which has no USB picker. Ctrl+Shift+B and the Flash button run the ` +
        `"${FLASH_TASK}" task (pyocd) here; the Serial view cannot connect, ` +
        `Microsoft's Serial Monitor extension shows the output (115200 baud).`
    );
  } else if (!usbAvailable()) {
    log(
      "note: navigator.usb is not available in this browser, so this extension " +
        "cannot flash here. Use Chrome, Edge or Opera."
    );
  }
}

function deactivate() {
  if (gdb) {
    gdb.detach().catch(() => {});
  }
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
  _boards: { boardVersion, boardLabel, list: () => boards, selected: () => selectedId, reading: () => reading },
  _debug: {
    setSession: (s) => { gdb = s; },
  },
};
