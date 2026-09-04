//  Regression test for docs/index.html, the browser serial console.
//
//  Run:  node tools/test_serial_console.mjs
//
//  Uses only Node built-ins -- no npm install, no dependencies. It loads the
//  real inline script out of docs/index.html and drives it against a mock that
//  reproduces Chrome's SerialPort semantics, in particular:
//
//    * open() on an already-open port throws InvalidStateError;
//    * close() rejects while port.readable is still locked by a pipe.
//
//  Those two together caused a reported bug: disconnect appeared to succeed,
//  but the port was never closed, so reconnecting to the same board without
//  unplugging it failed with
//  "InvalidStateError: Failed to execute 'open' on 'SerialPort': The port is
//  already open."

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class MockPort {
  constructor() { this.isOpen = false; this.readable = null; this._ctl = null; this.closeAttempts = 0; }
  async open({ baudRate }) {
    if (this.isOpen) {
      const e = new Error("Failed to execute 'open' on 'SerialPort': The port is already open.");
      e.name = "InvalidStateError";
      throw e;
    }
    this.isOpen = true;
    this.baudRate = baudRate;
    this.readable = new ReadableStream({ start: (c) => { this._ctl = c; } });
  }
  async close() {
    this.closeAttempts++;
    if (this.readable && this.readable.locked) {
      const e = new Error("Cannot cancel a locked stream");
      e.name = "InvalidStateError";
      throw e;
    }
    this.isOpen = false;
    this.readable = null;
  }
  emit(text) { this._ctl?.enqueue(new TextEncoder().encode(text)); }
}

const port = new MockPort();
const handlers = {};
const mkEl = (id) => ({
  _t: "",
  set textContent(v) { this._t = v; }, get textContent() { return this._t; },
  disabled: false, hidden: false, value: "115200",
  scrollTop: 0, clientHeight: 0, scrollHeight: 0,
  addEventListener: (_ev, fn) => { handlers[id] = fn; },
});
const els = {};
for (const id of ["out", "status", "connect", "disconnect", "clear", "baud", "unsupported"]) els[id] = mkEl(id);

globalThis.document = { getElementById: (id) => els[id] };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
Object.defineProperty(globalThis, "navigator", {
  value: { serial: { requestPort: async () => port } }, configurable: true,
});

const html = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new Function(script)();

const settle = () => new Promise((r) => setTimeout(r, 20));
const output = () => els.out._t;
const failures = [];
const check = (cond, what) => { if (!cond) failures.push(what); };

await handlers.connect();
await settle();
port.emit("hello from Ada\n");
await settle();
check(port.isOpen, "connect should open the port");
check(output().includes("hello from Ada"), "received data should be displayed");

await handlers.disconnect();
await settle();
check(!port.isOpen, "disconnect must actually close the port, not just say so");
check(!output().includes("disconnect failed"), "disconnect should not report a failure");

// The regression: same board, no unplug.
await handlers.connect();
await settle();
check(port.isOpen, "reconnecting to the same board must work without unplugging");
check(!output().includes("already open"), "must not report 'the port is already open'");

if (failures.length) {
  console.error("FAIL");
  for (const f of failures) console.error("  - " + f);
  console.error("\n--- console output ---\n" + output().trim());
  process.exit(1);
}
console.log(`PASS  connect / disconnect / reconnect (close attempts: ${port.closeAttempts})`);
