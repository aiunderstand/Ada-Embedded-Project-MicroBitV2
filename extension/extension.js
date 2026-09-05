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
    setStatus(s === "Connected" ? "micro:bit connected" : "micro:bit", false);
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
    setStatus("micro:bit connected", false);
  } catch (err) {
    setStatus("micro:bit", false);
    log(`Error: ${err.message}`);
    vscode.window.showErrorMessage(`micro:bit: ${err.message}`);
  }
}

async function cmdFlash() {
  output.show(true);
  try {
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
  status.tooltip = "Flash build/main.hex to the micro:bit";
  setStatus("micro:bit", false);

  context.subscriptions.push(
    output,
    status,
    vscode.commands.registerCommand("microbit.connect", cmdConnect),
    vscode.commands.registerCommand("microbit.flash", cmdFlash),
    vscode.commands.registerCommand("microbit.status", cmdStatus)
  );

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
