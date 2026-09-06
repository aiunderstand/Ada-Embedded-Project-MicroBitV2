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
//
//  It is also the Codespace end of F5. Cortex-Debug starts arm-eabi-gdb here,
//  in the Codespace, where the ELF is; gdb connects to the TCP port this file
//  opens; and every packet gdb sends is forwarded, as one VS Code command, to
//  the flasher in the browser, which answers it over the board's USB
//  connection. VS Code routes a command to whichever extension host registered
//  it, so the two halves need nothing else to meet.

const vscode = require("vscode");
const net = require("net");

const FLASHER = "AIUnderstand.microbit-flasher";
const DOCS = "https://github.com/aiunderstand/Ada-Embedded-Project-MicroBitV2/blob/main/setup/codespace.md";
const DONE_KEY = "microbit.flasherInstalled";
const GDB_PORT = 3333; // what Cortex-Debug's gdbTarget names; OpenOCD's habit

let output = null;

function log(line) {
  if (output) output.appendLine(line);
}

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

// ------------------------------------------------------------- the gdb relay
//
// This end only frames. The GDB Remote Serial Protocol puts a packet body
// between '$' and '#' followed by two checksum digits, and expects '+' back
// for each packet until gdb agrees to do without (QStartNoAckMode). Bodies
// travel to the browser as strings whose char codes are the raw bytes; the
// server there does the unescaping. gdb's Ctrl-C (the pause button) is a
// bare 0x03 byte outside any packet, and it must get through while a
// `continue` is still waiting for its reply, so it takes its own command.

const RSP_INTERRUPT = 0x03;

function rspChecksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return sum;
}

function rspFrame(body) {
  const bytes = Buffer.from(body, "latin1");
  return Buffer.concat([
    Buffer.from("$"),
    bytes,
    Buffer.from("#" + rspChecksum(bytes).toString(16).padStart(2, "0")),
  ]);
}

/** Turn the browser's refusal into what the student should do. */
function explainAttachFailure(err) {
  const message = err && err.message ? err.message : String(err);
  if (/not found/i.test(message)) {
    return "The micro:bit flasher is not running in this browser, so there is nothing to debug " +
      "through. Run \"micro:bit: Install the flasher in this browser\" from the command palette, " +
      "then start debugging again.";
  }
  return `micro:bit: ${message}`;
}

/** One gdb connection, start to finish. */
async function serveGdb(socket, { commands, log: logLine, showError }) {
  socket.setNoDelay(true);
  const t0 = Date.now();
  try {
    await commands.executeCommand("microbit.gdb.attach");
  } catch (err) {
    const message = explainAttachFailure(err);
    logLine(message);
    showError(message);
    socket.destroy();
    return;
  }
  logLine(`gdb connected; the browser answered in ${Date.now() - t0} ms`);

  let buffer = Buffer.alloc(0);
  let noAck = false;
  let lastReply = null;            // resent when gdb answers '-'
  let queue = Promise.resolve();   // packets are answered in order; a `continue` blocks the rest
  const send = (bytes) => {
    if (!socket.destroyed) socket.write(bytes);
  };
  const handle = (body) => {
    queue = queue.then(async () => {
      let reply;
      try {
        reply = await commands.executeCommand("microbit.gdb.packet", body);
      } catch (err) {
        logLine(`gdb: "${body.slice(0, 20)}" failed in the browser: ${err.message}`);
        reply = "E01";
      }
      if (reply === null || reply === undefined) return; // "k": gdb expects silence
      lastReply = rspFrame(reply);
      send(lastReply);
      if (body === "QStartNoAckMode" && reply === "OK") noAck = true;
    });
  };

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length === 0) return;
      const c = buffer[0];
      if (c === RSP_INTERRUPT) {
        buffer = buffer.subarray(1);
        commands.executeCommand("microbit.gdb.interrupt").catch((err) => logLine(`interrupt: ${err.message}`));
        continue;
      }
      if (c === 0x2b) { buffer = buffer.subarray(1); continue; }                   // '+': noted
      if (c === 0x2d) { buffer = buffer.subarray(1); if (lastReply) send(lastReply); continue; } // '-'
      if (c !== 0x24) { buffer = buffer.subarray(1); continue; }                   // not '$': noise
      // '#' never occurs unescaped inside a body, so the first one ends it.
      const hash = buffer.indexOf(0x23);
      if (hash < 0 || buffer.length < hash + 3) return;                            // wait for the rest
      const body = buffer.subarray(1, hash);
      const claimed = parseInt(buffer.subarray(hash + 1, hash + 3).toString("latin1"), 16);
      buffer = buffer.subarray(hash + 3);
      if (claimed !== rspChecksum(body)) {
        logLine("gdb: a packet arrived with a bad checksum");
        if (!noAck) send(Buffer.from("-"));
        continue;
      }
      if (!noAck) send(Buffer.from("+"));
      handle(body.toString("latin1"));
    }
  });

  await new Promise((resolve) => {
    socket.on("error", (err) => logLine(`gdb socket: ${err.message}`));
    socket.on("close", resolve);
  });
  await queue.catch(() => {});
  await commands.executeCommand("microbit.gdb.detach").catch((err) => logLine(`detach: ${err.message}`));
  logLine("gdb disconnected");
}

/**
 * Listen for gdb on 127.0.0.1:port. The arguments exist so that
 * tools/test_companion.mjs can hand in a port of its own and a stand-in for
 * vscode.commands; the extension passes nothing.
 */
function startGdbRelay({
  port = GDB_PORT,
  commands = vscode.commands,
  log: logLine = log,
  showError = (m) => vscode.window.showErrorMessage(m),
} = {}) {
  let client = null;
  const server = net.createServer((socket) => {
    if (client) {
      logLine("gdb: a second connection was refused; one debug session at a time");
      socket.destroy();
      return;
    }
    client = socket;
    serveGdb(socket, { commands, log: logLine, showError }).finally(() => {
      if (client === socket) client = null;
    });
  });
  server.on("error", (err) => {
    logLine(`gdb server: ${err.message}`);
    showError(`micro:bit: could not open port ${port} for gdb (${err.message}); F5 will not work until it is free.`);
  });
  server.listen(port, "127.0.0.1", () => logLine(`gdb server listening on 127.0.0.1:${server.address().port}`));
  return server;
}

/**
 * F5 in the browser means the browser is the probe. The one launch
 * configuration in .vscode/launch.json says pyocd, which is right on a
 * student's own machine; here it is rewritten to the external server above,
 * so launch.json needs no second entry and the student nothing to choose.
 */
const browserProbeProvider = {
  resolveDebugConfiguration(folder, config) {
    if (config && config.servertype === "pyocd") {
      log(`"${config.name}": using the board in your browser as the probe (gdb server on port ${GDB_PORT})`);
      return { ...config, servertype: "external", gdbTarget: `localhost:${GDB_PORT}` };
    }
    return config;
  },
};

function activate(context) {
  output = vscode.window.createOutputChannel("micro:bit companion");
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand("microbit.companion.install", () =>
      ensureFlasher(context, { force: true })),
    // The flasher measures its round trip to the Codespace with this.
    vscode.commands.registerCommand("microbit.companion.ping", () => "pong")
  );
  if (vscode.env.uiKind === vscode.UIKind.Web) {
    const server = startGdbRelay();
    context.subscriptions.push(
      { dispose: () => server.close() },
      vscode.debug.registerDebugConfigurationProvider("cortex-debug", browserProbeProvider)
    );
  }
  return ensureFlasher(context);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  // For tools/test_companion.mjs.
  _gdb: { startGdbRelay, browserProbeProvider, explainAttachFailure, rspFrame, GDB_PORT },
};
