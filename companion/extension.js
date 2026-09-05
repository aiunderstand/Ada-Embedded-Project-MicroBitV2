//  micro:bit Companion -- the half of the flasher that lives in the Codespace.
//
//  The flasher itself is a *web* extension: it must run in the student's
//  browser, where the USB port is, and an extension installed into a Codespace
//  never starts there (microsoft/vscode#144513). Nothing in a repository can
//  install an extension into a browser -- except an extension that is already
//  running and asks the workbench to. devcontainer.json installs *this* one
//  into the container automatically, like the Ada extension; on startup it
//  asks the workbench to install the flasher, and the workbench puts a
//  web-only extension in the browser, exactly as a click on Install would.

const vscode = require("vscode");

const FLASHER = "AIUnderstand.microbit-flasher";
const DOCS = "https://github.com/aiunderstand/Ada-Embedded-Project-MicroBitV2/blob/main/setup/codespace.md";
const DONE_KEY = "microbit.flasherInstalled";

async function ensureFlasher(context, { force = false } = {}) {
  // Desktop VS Code has no WebUSB; there the course flashes with mb.py flash.
  if (vscode.env.uiKind !== vscode.UIKind.Web) {
    if (force) {
      vscode.window.showInformationMessage(
        "The micro:bit flasher is for VS Code in the browser. Here, flash with: python3 tools/mb.py flash"
      );
    }
    return "desktop";
  }
  // vscode.extensions.all spans every extension host, so a copy that runs in
  // the browser is visible from here; the flag covers the case where it is not.
  if (!force && (vscode.extensions.getExtension(FLASHER) || context.globalState.get(DONE_KEY))) {
    return "present";
  }
  try {
    await vscode.commands.executeCommand("workbench.extensions.installExtension", FLASHER);
    await context.globalState.update(DONE_KEY, true);
    vscode.window.showInformationMessage(
      "micro:bit flasher installed in your browser. Plug the board in and press Ctrl+Alt+F to build and flash."
    );
    return "installed";
  } catch (err) {
    const choice = await vscode.window.showWarningMessage(
      `The micro:bit flasher could not be installed automatically: ${err.message}`,
      "Try again",
      "How to install it"
    );
    if (choice === "Try again") return ensureFlasher(context, { force: true });
    if (choice === "How to install it") vscode.env.openExternal(vscode.Uri.parse(DOCS));
    return "failed";
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("microbit.companion.install", () =>
      ensureFlasher(context, { force: true }))
  );
  return ensureFlasher(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
