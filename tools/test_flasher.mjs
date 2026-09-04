//  Regression tests for the browser flasher (docs/app.mjs + docs/index.html).
//
//  Run:  node tools/test_flasher.mjs
//
//  Node built-ins only -- no npm install. createApp() takes its dependencies as
//  arguments, so the real application logic runs here against a mock USB
//  connection that mimics @microbit/microbit-connection.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createApp, validateHex } from "../docs/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const check = (cond, what) => { if (!cond) failures.push(what); };

// ---------------------------------------------------------------- DOM stub
const handlers = {};
const mkEl = (id) => ({
  id, _t: "", disabled: false, hidden: false, value: 0, files: null,
  scrollTop: 0, clientHeight: 0, scrollHeight: 0,
  children: [], options: [], selectedIndex: -1, dataset: {}, label: "",
  classList: { add() {}, remove() {} },
  removeAttribute() { this.value = undefined; },
  set textContent(v) { this._t = String(v); },
  get textContent() { return this._t; },
  appendChild(c) {
    this.children.push(c);
    // A <select> exposes every descendant <option>, including those in groups.
    this.options.push(...(c.children?.length ? c.children : [c]));
    return c;
  },
  addEventListener(ev, fn) { (handlers[id] ??= {})[ev] = fn; },
});
const IDS = ["connect", "disconnect", "status", "file", "drop", "firmware",
             "flash", "bar", "phase", "out", "clear", "unsupported",
             "gallery", "examples"];
const els = {};
for (const id of IDS) els[id] = mkEl(id);
const doc = {
  getElementById: (id) => els[id],
  createElement: (tag) => mkEl(`__${tag}`),
};
const click = (id) => handlers[id]?.click?.({});

// ------------------------------------------------------- mock USB connection
const listeners = {};
const flashCalls = [];
const usb = {
  status: "NoAuthorizedDevice",
  addEventListener(t, fn) { (listeners[t] ??= []).push(fn); },
  removeEventListener() {},
  emit(t, d) { (listeners[t] ?? []).forEach((fn) => fn(d)); },
  async connect() {
    if (this.status === "Connected") throw new Error("already connected");
    this.status = "Connected";
    this.emit("status", { status: "Connected", previousStatus: "Disconnected" });
  },
  async disconnect() {
    this.status = "Disconnected";
    this.emit("status", { status: "Disconnected", previousStatus: "Connected" });
  },
  async flash(dataSource, options) {
    const data = await dataSource("V2");
    flashCalls.push({ data, options });
    options.progress?.("Connecting", undefined);
    options.progress?.("FullFlashing", 0.5);
    options.progress?.("FullFlashing", 1);
    // Real hardware restarts the user program, resetting the serial session.
    this.emit("serialreset");
  },
};

const GOOD_HEX = ":10000000783A0020091E0100541E0100541E010010\n:00000001FF\n";

const MANIFEST = {
  commit: "abc1234", built: "2026-09-04T20:00:00Z",
  projects: [
    { id: "template", family: "template", label: "template", hex: "template.hex",
      bytes: 390000, summary: "" },
    { id: "ravenscar/music", family: "ravenscar", label: "music",
      hex: "ravenscar-music.hex", bytes: 450000, summary: "Music Example" },
    { id: "spark/bounded_queue", family: "spark", label: "bounded queue",
      hex: "spark-bounded_queue.hex", bytes: 519000, summary: "A proved queue" },
  ],
};
let fetchRoutes = {
  "./firmware/index.json": { ok: true, json: MANIFEST },
  "./firmware/ravenscar-music.hex": { ok: true, text: GOOD_HEX },
  "./firmware/spark-bounded_queue.hex": { ok: true, text: "not a hex at all" },
};
const fetchFn = async (url) => {
  const r = fetchRoutes[url];
  if (!r) return { ok: false, status: 404 };
  return {
    ok: r.ok, status: r.ok ? 200 : 404,
    json: async () => r.json,
    text: async () => r.text,
  };
};

const app = createApp({
  createUSBConnection: () => usb,
  doc,
  raf: (fn) => fn(),
  usbSupported: true,
  fetchFn,
});

const settle = () => new Promise((r) => setTimeout(r, 5));
const out = () => els.out.textContent;
const mkFile = (name, text) => ({ name, size: text.length, text: async () => text });

const ELF_MAGIC = "ELF binary, not hex";

// ---------------------------------------------------------------- hex checks
check(validateHex(GOOD_HEX) === null, "a valid hex should be accepted");
check(/not an Intel HEX/.test(validateHex(ELF_MAGIC) ?? ""),
      "an ELF should be rejected with a helpful message");
check(validateHex(":10000000783A0020091E0100541E0100541E010010\n") !== null,
      "a hex with no end-of-file record should be rejected as truncated");
check(validateHex("") !== null, "an empty file should be rejected");

// ------------------------------------------------------------------ connect
click("connect"); await settle();
check(usb.status === "Connected", "connect should connect");
check(els.status.textContent === "connected", "status should read connected");
check(els.flash.disabled, "flash must stay disabled until a file is chosen");

// ------------------------------------------------------------ choose + flash
await app.useFile(mkFile("main.hex", GOOD_HEX));
check(!els.flash.disabled, "flash should be enabled once a valid hex is loaded");

await app.useFile(mkFile("main", ELF_MAGIC));
check(els.flash.disabled, "an ELF must not be flashable");
check(/rejected/.test(els.firmware.textContent), "the ELF rejection should be shown");

await app.useFile(mkFile("main.hex", GOOD_HEX));
click("flash"); await settle();
check(flashCalls.length === 1, "flash should be called once");
check(flashCalls[0].data === GOOD_HEX, "the chosen hex should be what gets flashed");
// Partial flashing is a MakeCode feature and is wrong for a GNAT-built hex.
check(flashCalls[0].options.partial === false, "flash must force a full flash (partial:false)");
check(/flashed main\.hex/.test(out()), "a successful flash should be reported");

// ------------------------------------------------------------------- serial
usb.emit("serialdata", { data: "hello from Ada\n" });
await settle();
check(out().includes("hello from Ada"), "serial data should be displayed");
usb.emit("serialreset");
await settle();
check(!out().includes("hello from Ada"), "serialreset should clear stale output");

// --------------------------------------------- disconnect / reconnect cycle
// Guards the class of bug fixed in the previous serial console: a disconnect
// that does not really disconnect makes the next connect fail.
click("disconnect"); await settle();
check(usb.status === "Disconnected", "disconnect should disconnect");
check(!els.connect.disabled, "connect should be re-enabled after disconnecting");

click("connect"); await settle();
check(usb.status === "Connected", "reconnecting to the same board must work");
check(els.status.textContent === "connected", "status should read connected again");

// ---------------------------------------------------------------- gallery
await settle();
check(els.gallery.hidden === false, "the example gallery should be shown when the manifest loads");
check(els.examples.options.length === MANIFEST.projects.length,
      "every project in the manifest should appear in the picker");
check(els.examples.children.some((g) => g.label === "SPARK (proved)"),
      "examples should be grouped by family");

await app.useExample("ravenscar-music.hex", "ravenscar/music");
check(app.hex !== null, "a gallery example should load as firmware");
check(/ready-built/.test(els.firmware.textContent), "the gallery selection should be shown");

// A corrupt published hex must be caught by the same validation as a local file.
await app.useExample("spark-bounded_queue.hex", "spark/bounded_queue");
check(app.hex === null, "an invalid gallery hex must be rejected");
check(/could not load/.test(els.firmware.textContent), "the rejection should be shown");

// A fork without the CI publishing step has no manifest: hide, do not error.
const els3 = {};
for (const id of IDS) els3[id] = mkEl(id);
const app3 = createApp({
  createUSBConnection: () => usb,
  doc: { getElementById: (id) => els3[id], createElement: (t) => mkEl(`__${t}`) },
  raf: (fn) => fn(), usbSupported: true,
  fetchFn: async () => ({ ok: false, status: 404 }),
});
await app3.loadGallery();
check(els3.gallery.hidden === true, "a missing manifest should hide the gallery, not error");

// ------------------------------------------------------- unsupported browser
const els2 = {};
for (const id of IDS) els2[id] = mkEl(id);
createApp({
  createUSBConnection: () => { throw new Error("must not be constructed"); },
  doc: { getElementById: (id) => els2[id] },
  raf: (fn) => fn(),
  usbSupported: false,
});
check(els2.unsupported.hidden === false, "a browser without WebUSB should see the notice");
check(els2.connect.disabled, "connect should be disabled without WebUSB");

// -------------------------------------------------------------- page wiring
const html = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
for (const id of IDS) {
  check(html.includes(`id="${id}"`), `index.html is missing #${id}, which app.mjs expects`);
}
const vendor = fs.readFileSync(
  path.join(root, "docs", "vendor", "microbit-connection-usb.mjs"), "utf8");
check(!/^\s*(import|export)[^;]*from\s*"/m.test(vendor.replace(/^\/\*[\s\S]*?\*\//, "")),
      "the vendored bundle must be self-contained (no external imports)");
check(/createUSBConnection/.test(vendor), "the vendored bundle must export createUSBConnection");

// ------------------------------------------------------------------ report
if (failures.length) {
  console.error("FAIL");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS  flasher: hex validation, connect, flash, serial, reconnect, gallery, page wiring");
