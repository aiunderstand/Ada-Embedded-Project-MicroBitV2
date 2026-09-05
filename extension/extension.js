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
  let devices = await navigator.usb.getDevices();
  if (!devices.some((d) => d.vendorId === MICROBIT_VID)) {
    log("Asking you to choose the micro:bit...");
    await vscode.commands.executeCommand(
      "workbench.experimental.requestUsbDevice",
      { filters: [{ vendorId: MICROBIT_VID }] }
    );
    devices = await navigator.usb.getDevices();
  }
  if (!devices.some((d) => d.vendorId === MICROBIT_VID)) {
    throw new Error("No micro:bit was selected.");
  }

  // pauseOnHidden touches window/document, which do not exist in a worker.
  const usb = createUSBConnection({ pauseOnHidden: false });
  usb.addEventListener("status", ({ status: s }) => {
    log(`connection: ${s}`);
    setStatus(s === "Connected" ? "Flash micro:bit (connected)" : "Flash micro:bit", false);
  });
  usb.addEventListener("serialdata", ({ data }) => output.append(data));
  usb.addEventListener("serialreset", () => log("\n--- program restarted ---"));
  await usb.connect();
  connection = usb;
  return usb;
}

async function cmdConnect() {
  output.show(true);
  try {
    setStatus("connecting", true);
    await ensureConnected();
    log("Connected. Serial output appears below.");
    setStatus("Flash micro:bit (connected)", false);
  } catch (err) {
    setStatus("Flash micro:bit", false);
    log(`Error: ${err.message}`);
    vscode.window.showErrorMessage(`micro:bit: ${err.message}`);
  }
}

/** Run the workspace "Build" task and wait for it. */
async function runBuildTask() {
  let task;
  try {
    const all = await vscode.tasks.fetchTasks();
    task = all.find((t) => t.name === "Build");
  } catch {
    return false;
  }
  if (!task) {
    return false; // no task to run; fall back to whatever is already built
  }
  log("Building...");
  setStatus("building", true);
  const exec = await vscode.tasks.executeTask(task);
  return new Promise((resolve) => {
    const sub = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === exec) {
        sub.dispose();
        resolve(e.exitCode === 0);
      }
    });
  });
}

async function cmdFlash() {
  output.show(true);
  try {
    // Build first, so one action does the whole job and a stale hex can never
    // be flashed silently. Previously this failed with "build first" if you
    // forgot, and the status-bar button could flash yesterday's firmware.
    const built = await runBuildTask();
    if (built === false && !(await hexExists())) {
      throw new Error(
        "Nothing to flash. Build first: Ctrl+Shift+B, or python3 tools/mb.py build"
      );
    }
    const hex = await readHex();
    const usb = await ensureConnected();
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
    setStatus("Flash micro:bit (connected)", false);
    log(`Flashed ${HEX_PATH}.`);
    vscode.window.showInformationMessage("micro:bit flashed.");
  } catch (err) {
    log(`Error: ${err.message}`);
    vscode.window.showErrorMessage(`micro:bit: ${err.message}`);
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
    vscode.commands.registerCommand("microbit.flash", cmdFlash),
    vscode.commands.registerCommand("microbit.status", cmdStatus)
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

module.exports = { activate, deactivate };
