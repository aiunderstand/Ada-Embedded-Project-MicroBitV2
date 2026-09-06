//  Regression test for the companion's gdb relay (companion/extension.js).
//  Node built-ins only: a real TCP client plays gdb, a stand-in for
//  vscode.commands plays the flasher in the browser.
import fs from "fs";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const check = (c, w) => { if (!c) fail.push(w); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = fs.readFileSync(path.join(root, "companion/extension.js"), "utf8");
const vscodeStub = {
  env: { uiKind: 2 }, UIKind: { Web: 2, Desktop: 1 },
  window: { createOutputChannel: () => ({ appendLine() {}, dispose() {} }), showErrorMessage() {} },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} },
  debug: { registerDebugConfigurationProvider: () => ({ dispose() {} }) },
  extensions: { getExtension: () => ({}) },
};
const mod = { exports: {} };
new Function("require", "module", "exports", src)(
  (n) => (n === "net" ? net : n === "vscode" ? vscodeStub : (() => { throw new Error("unknown " + n); })()),
  mod, mod.exports);
const { startGdbRelay, makeBrowserProbeProvider, explainAttachFailure, GDB_PORT } = mod.exports._gdb;

// ------------------------------------------------------- the browser end
// What the flasher answers, keyed by packet body. A pending `c` resolves on
// an interrupt (T02) or when the server is detached (empty reply), exactly
// as GdbServer.continueAndWait does.
const browser = { attachError: null, attachDelay: 0, attached: false };
let releaseContinue = null;
const executed = [];
const commands = {
  async executeCommand(id, arg) {
    executed.push(arg === undefined ? id : `${id} ${arg}`);
    if (id === "microbit.gdb.attach") {
      if (browser.attachDelay) await sleep(browser.attachDelay);
      if (browser.attachError) throw new Error(browser.attachError);
      browser.attached = true;
      return "attached";
    }
    if (id === "microbit.gdb.detach") {
      browser.attached = false;
      if (releaseContinue) { releaseContinue(""); releaseContinue = null; }
      return;
    }
    if (id === "microbit.gdb.interrupt") {
      if (releaseContinue) { releaseContinue("T02thread:1;"); releaseContinue = null; }
      return;
    }
    if (id !== "microbit.gdb.packet") return undefined;
    switch (arg) {
      case "qSupported": return "PacketSize=4000;QStartNoAckMode+";
      case "QStartNoAckMode": return "OK";
      case "?": return "T05thread:1;";
      case "c": return new Promise((resolve) => { releaseContinue = resolve; });
      case "k": return null;
      case "boom": throw new Error("the board fell off");
      default: return "";
    }
  },
};
const logged = [];
const errors = [];
const relay = startGdbRelay({ port: 0, commands, log: (l) => logged.push(l), showError: (m) => errors.push(m) });
const port = await relay.ready;
check(relay.server.address().address === "127.0.0.1", "the relay listens on loopback only");

// ---------------------------------------------------------- a gdb client
const checksum = (s) => Buffer.from(s, "latin1").reduce((a, b) => (a + b) & 0xff, 0).toString(16).padStart(2, "0");
const frame = (body) => `$${body}#${checksum(body)}`;
async function client() {
  const sock = net.connect(port, "127.0.0.1");
  await new Promise((r) => sock.on("connect", r));
  // A refused client is destroyed by the relay; that lands here as ECONNRESET,
  // which is an uncaught exception in Node without a listener. It is expected.
  sock.on("error", () => {});
  let received = "";
  sock.on("data", (d) => { received += d.toString("latin1"); });
  let closedFlag = false;
  sock.on("close", () => { closedFlag = true; });
  return {
    sock,
    send: (s) => sock.write(Buffer.from(s, "latin1")),
    take: async (ms = 60) => { await sleep(ms); const r = received; received = ""; return r; },
    closed: () => closedFlag,
  };
}
const since = (n) => executed.slice(n);

const gdb = await client();
await sleep(30);
check(executed.includes("microbit.gdb.attach"), "a connection attaches in the browser first");
check(logged.some((l) => /gdb connected; the browser attached in \d+ ms/.test(l)), "and the round trip is logged");

gdb.send(frame("qSupported"));
check(await gdb.take() === "+" + frame("PacketSize=4000;QStartNoAckMode+"),
      "a packet is acknowledged, forwarded, and its reply framed with a checksum");
check(executed.includes("microbit.gdb.packet qSupported"), "the body goes to the browser unchanged");

let mark = executed.length;
gdb.send("$qSupported#00");
check(await gdb.take() === "-" && since(mark).length === 0, "a bad checksum is refused and never forwarded");

gdb.send("-");
check(await gdb.take() === frame("PacketSize=4000;QStartNoAckMode+"), "'-' from gdb repeats the last reply");

gdb.send(frame("QStartNoAckMode"));
check(await gdb.take() === "+" + frame("OK"), "no-ack mode is agreed");
gdb.send("+" + frame("?"));
check(await gdb.take() === frame("T05thread:1;"), "after which nothing is acknowledged, and gdb's own '+' is ignored");

// Two packets in one chunk, and one split across two.
gdb.send(frame("?") + frame("?").slice(0, 2));
await sleep(20);
gdb.send(frame("?").slice(2));
check(await gdb.take() === frame("T05thread:1;") + frame("T05thread:1;"), "packets are delimited by '#' plus two digits, whatever the chunking");

mark = executed.length;
gdb.send(frame("c"));
check(await gdb.take() === "", "continue waits for the core");
gdb.send("\x03");
check(await gdb.take() === frame("T02thread:1;") && since(mark).includes("microbit.gdb.interrupt"),
      "the 0x03 byte is an interrupt command even while continue is pending");

gdb.send(frame("boom"));
check(await gdb.take() === frame("E01") && !gdb.sock.destroyed, "an error in the browser is E01, not the end of the session");

gdb.send(frame("k"));
check(await gdb.take() === "", "kill gets no reply");

// A second gdb: refused for real -- its socket closes, and nothing it sends
// reaches the browser.
mark = executed.length;
const second = await client();
second.send(frame("qSupported"));
await sleep(100);
check(second.closed(), "a second gdb is refused: its socket is closed");
check(!since(mark).some((e) => /microbit\.gdb\.packet/.test(e)), "and its packet never reaches the browser");
check(logged.some((l) => /second connection was refused/.test(l)), "and the log says so");

mark = executed.length;
gdb.sock.destroy();
await sleep(50);
check(since(mark).includes("microbit.gdb.detach"), "when gdb goes, the browser detaches: breakpoints out, program running");

// ------------------------------------------ gdb goes away mid-continue
// The pending `c` ends only when the server detaches; the relay must detach
// first and drain after, or it waits forever and refuses every later gdb.
{
  const g = await client();
  await sleep(30);
  g.send(frame("QStartNoAckMode"));
  await g.take();
  mark = executed.length;
  g.send(frame("c"));
  await sleep(20);
  check(releaseContinue !== null, "continue is pending in the browser");
  g.sock.destroy();
  await sleep(150);
  check(since(mark).includes("microbit.gdb.detach"), "closing the socket with a continue pending detaches the browser promptly");
  check(!browser.attached, "so the browser session is over");
  mark = executed.length;
  const next = await client();
  await sleep(50);
  check(since(mark).includes("microbit.gdb.attach") && !next.closed(), "and the next gdb is served, not refused as a second connection");
  next.send(frame("QStartNoAckMode"));
  check(await next.take() === "+" + frame("OK"), "in full");
  next.sock.destroy();
  await sleep(50);
}

// ------------------------------------------ gdb goes away during attach
// Listeners are on the socket before the attach round trip, so a close in
// that window neither throws nor is missed, and the late attach is undone.
{
  browser.attachDelay = 150;
  mark = executed.length;
  const g = await client();
  await sleep(20);
  g.sock.destroy();
  await sleep(400);
  check(since(mark).includes("microbit.gdb.attach") && since(mark).includes("microbit.gdb.detach"),
        "a socket closed while the browser was still attaching is detached once the attach lands");
  check(!browser.attached, "leaving no orphaned session in the browser");
  const again = await client();
  await sleep(250);
  check(!again.closed(), "and the relay is free for the next gdb");
  again.sock.destroy();
  await sleep(50);
  browser.attachDelay = 0;
}

// ------------------------------------------------- acks precede the attach
// gdb resends a packet it gets no '+' for within two seconds; the browser may
// take longer than that to open the USB device. So the ack goes out at once
// and only the reply waits for the attach.
{
  browser.attachDelay = 200;
  const g = await client();
  g.send(frame("qSupported"));
  check(await g.take(60) === "+", "the ack arrives while the browser is still attaching");
  check(await g.take(300) === frame("PacketSize=4000;QStartNoAckMode+"), "the reply follows the attach");
  g.sock.destroy();
  await sleep(50);
  browser.attachDelay = 0;
}

// -------------------------------------------------- when there is no board
browser.attachError = "command 'microbit.gdb.attach' not found";
const noFlasher = await client();
await sleep(50);
check(noFlasher.closed(), "with no flasher in the browser the socket is closed");
check(errors.some((e) => /not running in this browser/.test(e) && /Install the flasher/.test(e)),
      "and the student is told to install it");
browser.attachError = "Connect the micro:bit first: press Connect";
errors.length = 0;
const noBoard = await client();
await sleep(50);
check(noBoard.closed(), "with no board the socket is closed too");
check(errors.some((e) => /Connect the micro:bit first/.test(e)), "with the browser's own instruction");
browser.attachError = null;
check(/not running in this browser/.test(explainAttachFailure(new Error("command 'x' not found"))), "explainAttachFailure: missing command");
check(explainAttachFailure(new Error("no board")) === "micro:bit: no board", "explainAttachFailure: anything else, verbatim");

// ------------------------------------------------------ the port is taken
// A reloaded Codespace tab starts a new extension host while the old one,
// port and all, lingers for minutes. The relay must not sit dead behind it.
{
  const squatter = net.createServer();
  await new Promise((r) => squatter.listen(0, "127.0.0.1", r));
  const taken = squatter.address().port;
  const lines = [];
  const other = startGdbRelay({ port: taken, commands, log: (l) => lines.push(l), showError: (m) => errors.push(m) });
  const got = await other.ready;
  check(got !== taken && got > 0, "when the preferred port is taken, the relay listens on a free one instead");
  check(lines.some((l) => new RegExp(`port ${taken} is taken`).test(l)), "and says so");
  other.server.close();
  squatter.close();
}

// -------------------------------------------- the launch configuration
{
  const lines = [];
  const provider = makeBrowserProbeProvider(Promise.resolve(4242), { log: (l) => lines.push(l), showError: (m) => errors.push(m) });
  const local = { name: "Debug (PyOCD)", type: "cortex-debug", request: "launch", servertype: "pyocd", executable: "x.elf" };
  const rewritten = await provider.resolveDebugConfiguration(undefined, local);
  check(rewritten.servertype === "external" && rewritten.gdbTarget === "localhost:4242" && rewritten.executable === "x.elf",
        "in the browser, the pyocd configuration becomes the external server on the port the relay actually got");
  check(rewritten.debuggerArgs.join(" ") === "-ex set remotetimeout 20",
        "and gdb is given more than its two-second default per reply, since every reply crosses to the browser");
  check(local.servertype === "pyocd" && !local.debuggerArgs, "without touching the original");
  const other = { name: "Other", servertype: "openocd" };
  check(await provider.resolveDebugConfiguration(undefined, other) === other, "any other configuration passes through");
  check(GDB_PORT === 3333, "the preferred port stays the one the docs and devcontainer name");
  errors.length = 0;
  const broken = makeBrowserProbeProvider(Promise.reject(new Error("EACCES")), { log: (l) => lines.push(l), showError: (m) => errors.push(m) });
  check(await broken.resolveDebugConfiguration(undefined, local) === undefined && errors.some((e) => /EACCES/.test(e)),
        "with no port, F5 is cancelled with a message rather than launched at nothing");
}

relay.server.close();

if (fail.length) {
  console.error("FAIL");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS  companion: framing, acks, interrupt, errors, detach, close mid-continue, close mid-attach, early acks, refusals, port fallback, launch rewrite");
