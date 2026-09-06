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
const { startGdbRelay, browserProbeProvider, explainAttachFailure, GDB_PORT } = mod.exports._gdb;

// ------------------------------------------------------- the browser end
// What the flasher answers, keyed by packet body.
let attachError = null;
let releaseContinue = null;
const executed = [];
const commands = {
  async executeCommand(id, arg) {
    executed.push(arg === undefined ? id : `${id} ${arg}`);
    if (id === "microbit.gdb.attach" && attachError) throw new Error(attachError);
    if (id === "microbit.gdb.interrupt" && releaseContinue) releaseContinue("T02thread:1;");
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
const server = startGdbRelay({ port: 0, commands, log: (l) => logged.push(l), showError: (m) => errors.push(m) });
await new Promise((r) => server.on("listening", r));
const port = server.address().port;
check(server.address().address === "127.0.0.1", "the relay listens on loopback only");

// ---------------------------------------------------------- a gdb client
const checksum = (s) => Buffer.from(s, "latin1").reduce((a, b) => (a + b) & 0xff, 0).toString(16).padStart(2, "0");
const frame = (body) => `$${body}#${checksum(body)}`;
async function client() {
  const sock = net.connect(port, "127.0.0.1");
  await new Promise((r) => sock.on("connect", r));
  let received = "";
  sock.on("data", (d) => { received += d.toString("latin1"); });
  return {
    sock,
    send: (s) => sock.write(Buffer.from(s, "latin1")),
    take: async (ms = 60) => { await sleep(ms); const r = received; received = ""; return r; },
  };
}

const gdb = await client();
await sleep(30);
check(executed.includes("microbit.gdb.attach"), "a connection attaches in the browser first");
check(logged.some((l) => /gdb connected; the browser answered in \d+ ms/.test(l)), "and the round trip is logged");

gdb.send(frame("qSupported"));
check(await gdb.take() === "+" + frame("PacketSize=4000;QStartNoAckMode+"),
      "a packet is acknowledged, forwarded, and its reply framed with a checksum");
check(executed.includes("microbit.gdb.packet qSupported"), "the body goes to the browser unchanged");

executed.length = 0;
gdb.send("$qSupported#00");
check(await gdb.take() === "-" && executed.length === 0, "a bad checksum is refused and never forwarded");

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

executed.length = 0;
gdb.send(frame("c"));
check(await gdb.take() === "", "continue waits for the core");
gdb.send("\x03");
check(await gdb.take() === frame("T02thread:1;") && executed.includes("microbit.gdb.interrupt"),
      "the 0x03 byte is an interrupt command even while continue is pending");

gdb.send(frame("boom"));
check(await gdb.take() === frame("E01") && !gdb.sock.destroyed, "an error in the browser is E01, not the end of the session");

gdb.send(frame("k"));
check(await gdb.take() === "", "kill gets no reply");

const second = await client();
await sleep(30);
check(second.sock.destroyed || second.sock.readyState !== "open" || (await second.take(30)) === "",
      "a second gdb is refused while one is connected");
check(logged.some((l) => /second connection was refused/.test(l)), "and says so");
second.sock.destroy();

executed.length = 0;
gdb.sock.destroy();
await sleep(50);
check(executed.includes("microbit.gdb.detach"), "when gdb goes, the browser detaches: breakpoints out, program running");

// -------------------------------------------------- when there is no board
attachError = "command 'microbit.gdb.attach' not found";
const noFlasher = await client();
await sleep(50);
check(noFlasher.sock.destroyed || noFlasher.sock.readyState === "closed", "with no flasher in the browser the socket is closed");
check(errors.some((e) => /not running in this browser/.test(e) && /Install the flasher/.test(e)),
      "and the student is told to install it");
attachError = "Connect the micro:bit first: press Connect";
errors.length = 0;
const noBoard = await client();
await sleep(50);
check(noBoard.sock.destroyed || noBoard.sock.readyState === "closed", "with no board the socket is closed too");
check(errors.some((e) => /Connect the micro:bit first/.test(e)), "with the browser's own instruction");
attachError = null;
check(/not running in this browser/.test(explainAttachFailure(new Error("command 'x' not found"))), "explainAttachFailure: missing command");
check(explainAttachFailure(new Error("no board")) === "micro:bit: no board", "explainAttachFailure: anything else, verbatim");

// -------------------------------------------- the launch configuration
const local = { name: "Debug (PyOCD)", type: "cortex-debug", request: "launch", servertype: "pyocd", executable: "x.elf" };
const rewritten = browserProbeProvider.resolveDebugConfiguration(undefined, local);
check(rewritten.servertype === "external" && rewritten.gdbTarget === `localhost:${GDB_PORT}` && rewritten.executable === "x.elf",
      "in the browser, the pyocd configuration becomes the external server on the relay's port");
check(local.servertype === "pyocd", "without touching the original");
const other = { name: "Other", servertype: "openocd" };
check(browserProbeProvider.resolveDebugConfiguration(undefined, other) === other, "any other configuration passes through");

server.close();

if (fail.length) {
  console.error("FAIL");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS  companion: framing, acks, interrupt, errors, detach, refusals, launch rewrite");
