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
const GDB_PORT = 3333; // OpenOCD's habit, so it reads familiarly; any free port will do

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
const DRAIN_MS = 2000;   // how long a closing session waits for the browser's last reply
const ATTACH_MS = 15000; // how long a closing session waits for an attach still in flight

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  let buffer = Buffer.alloc(0);
  let noAck = false;
  let lastReply = null;            // resent when gdb answers '-'
  let closed = false;
  // Listeners go on first: a socket that dies while the browser is still
  // attaching must neither throw (an 'error' with no listener is an uncaught
  // exception in the extension host) nor be missed.
  const gone = new Promise((resolve) => {
    socket.on("error", (err) => logLine(`gdb socket: ${err.message}`));
    socket.on("close", () => { closed = true; resolve(); });
  });
  const send = (bytes) => {
    if (!socket.destroyed) socket.write(bytes);
  };

  // The browser attaches first (it may have to open the USB device, halt the
  // core and arm the breakpoint unit), and every reply waits behind that.
  // Acks do not: gdb gets its '+' at once, so it never retransmits while the
  // attach is under way, and only its wait for the first reply spans it.
  const t0 = Date.now();
  const attached = commands.executeCommand("microbit.gdb.attach").then(
    () => {
      logLine(`gdb connected; the browser attached in ${Date.now() - t0} ms`);
      return true;
    },
    (err) => {
      const message = explainAttachFailure(err);
      logLine(message);
      showError(message);
      socket.destroy();
      return false;
    }
  );
  let queue = attached;            // packets are answered in order; a `continue` blocks the rest
  const handle = (body) => {
    queue = queue.then(async (ok) => {
      if (ok === false || closed) return ok;
      let reply;
      try {
        reply = await commands.executeCommand("microbit.gdb.packet", body);
      } catch (err) {
        logLine(`gdb: "${body.slice(0, 20)}" failed in the browser: ${err.message}`);
        reply = "E01";
      }
      if (reply === null || reply === undefined) return ok; // "k": gdb expects silence
      lastReply = rspFrame(reply);
      send(lastReply);
      if (body === "QStartNoAckMode" && reply === "OK") noAck = true;
      return ok;
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

  await gone;
  // Release the browser BEFORE draining the queue. A pending `continue`
  // returns only when the core halts, gdb interrupts, or the server detaches;
  // gdb is gone, so detach is the only one of those that will ever happen,
  // and waiting for the queue first would wait forever -- with this session
  // never ending and every later gdb refused as "a second connection".
  const didAttach = await Promise.race([attached, sleep(ATTACH_MS).then(() => false)]);
  if (didAttach) {
    await commands.executeCommand("microbit.gdb.detach").catch((err) => logLine(`detach: ${err.message}`));
  }
  await Promise.race([queue.catch(() => {}), sleep(DRAIN_MS)]);
  logLine("gdb disconnected");
}

/**
 * Listen for gdb on the loopback interface, on GDB_PORT when it is free and
 * on any free port otherwise: a reloaded browser tab gets a new extension
 * host while the old one, port and all, lingers for minutes. Whichever port
 * it is, the launch configuration is pointed at it (see the provider below).
 *
 * The arguments exist so that tools/test_companion.mjs can hand in a port of
 * its own and a stand-in for vscode.commands; the extension passes nothing.
 * Returns { server, ready }: ready resolves to the port actually bound.
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
  const ready = new Promise((resolve, reject) => {
    let fellBack = false;
    server.on("listening", () => {
      const bound = server.address().port;
      logLine(`gdb server listening on 127.0.0.1:${bound}`);
      resolve(bound);
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && !fellBack) {
        fellBack = true;
        logLine(`port ${port} is taken (another window of this Codespace, most likely); using a free port instead`);
        server.listen(0, "127.0.0.1");
        return;
      }
      logLine(`gdb server: ${err.message}`);
      showError(`micro:bit: could not open a port for gdb (${err.message}); F5 will not work in this window.`);
      reject(err);
    });
  });
  ready.catch(() => {}); // the provider reports it when F5 is pressed; nobody else need
  server.listen(port, "127.0.0.1");
  return { server, ready };
}

/**
 * F5 in the browser means the browser is the probe. The one launch
 * configuration in .vscode/launch.json says pyocd, which is right on a
 * student's own machine; here it is rewritten to the external server above,
 * on whatever port it got, so launch.json needs no second entry and the
 * student nothing to choose.
 */
function makeBrowserProbeProvider(ready, {
  log: logLine = log,
  showError = (m) => vscode.window.showErrorMessage(m),
} = {}) {
  return {
    async resolveDebugConfiguration(folder, config) {
      if (!config || config.servertype !== "pyocd") return config;
      let port;
      try {
        port = await ready;
      } catch (err) {
        showError(`micro:bit: F5 needs the companion's gdb port, which could not be opened (${err.message}).`);
        return undefined; // cancels the launch quietly; the message says why
      }
      logLine(`"${config.name}": using the board in your browser as the probe (gdb server on port ${port})`);
      return {
        ...config,
        servertype: "external",
        gdbTarget: `localhost:${port}`,
        // gdb gives a reply two seconds, three times over, before it gives
        // up. Every reply here crosses to the browser and back, and the
        // first one waits for the USB device to open, so give it room.
        debuggerArgs: [...(config.debuggerArgs || []), "-ex", "set remotetimeout 20"],
      };
    },
  };
}

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
    const relay = startGdbRelay();
    context.subscriptions.push(
      { dispose: () => relay.server.close() },
      vscode.debug.registerDebugConfigurationProvider("cortex-debug", makeBrowserProbeProvider(relay.ready))
    );
  }
  return ensureFlasher(context);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  // For tools/test_companion.mjs.
  _gdb: { startGdbRelay, makeBrowserProbeProvider, explainAttachFailure, rspFrame, GDB_PORT },
};
