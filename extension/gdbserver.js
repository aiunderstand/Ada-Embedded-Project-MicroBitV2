//  GDB remote-protocol server for the micro:bit v2 -- the half of debugging
//  that runs in the browser.
//
//  arm-eabi-gdb runs in the Codespace, where the ELF and the sources are, and
//  speaks the GDB Remote Serial Protocol to a TCP port that the companion
//  extension opens there. The companion forwards each packet, unchanged, as one
//  VS Code command into this extension, which runs in the browser and holds the
//  board over WebUSB. So one gdb packet costs one round trip between the
//  Codespace and the browser, and the dozens of SWD transfers a packet needs
//  stay local to the browser, where each costs about a millisecond.
//
//  The alternative -- pyocd's gdbserver in the Codespace with the browser as a
//  remote probe -- would put that round trip on every SWD transfer instead:
//  fifty to a hundred of them per breakpoint hit, seconds per step.
//
//  No VS Code, no library: the board is reached through the small `target`
//  interface documented on the class, which extension.js implements on the
//  bundled library and tools/test_gdbserver.mjs on a fake board. tools/mb.py
//  bundles this file into extension.js.
//
//  References: ARMv7-M Architecture Reference Manual, C1.6 (debug system
//  registers) and C1.11 (Flash Patch and Breakpoint unit); GDB manual,
//  appendix E (Remote Protocol).

// The largest packet gdb may send, as hex for qSupported. Bigger packets mean
// fewer round trips for `load` and for memory reads.
const GDB_PACKET_SIZE = 0x4000;

// Cortex-M debug system registers.
const DHCSR = 0xe000edf0;       // Debug Halting Control and Status
const DEMCR = 0xe000edfc;       // Debug Exception and Monitor Control
const AIRCR = 0xe000ed0c;       // Application Interrupt and Reset Control
const DBGKEY = 0xa05f0000;      // must accompany every DHCSR write
const C_DEBUGEN = 1 << 0;
const C_HALT = 1 << 1;
const C_STEP = 1 << 2;
const C_MASKINTS = 1 << 3;
const S_HALT = 1 << 17;
const S_RESET_ST = 1 << 25;     // sticky: a reset happened since the last DHCSR read
const VC_CORERESET = 1 << 0;    // DEMCR: halt at the reset vector
const AIRCR_VECTKEY = 0x05fa0000;
const AIRCR_SYSRESETREQ = 1 << 2;

// Flash Patch and Breakpoint unit, version 1 as on the Cortex-M4.
const FP_CTRL = 0xe0002000;
const FP_COMP0 = 0xe0002008;
const FP_CTRL_ENABLE = 1 << 0;
const FP_CTRL_KEY = 1 << 1;     // must be 1 for the write to take effect
const FP_MAX_COMPARATORS = 16;

// DCRSR selectors for the registers gdb asks for. gdb's own numbering has
// r0-r15 at 0-15 and xpsr at 25; 16-24 are the FPA registers of a 1990s ARM,
// which is why a target description is served (see GDB_TARGET_XML).
const GDB_REGS = 17;
const DCRSR_XPSR = 16;
const GDB_REG_XPSR = 25;

// nRF52833.
const FLASH_BASE = 0x00000000;
const FLASH_SIZE = 0x80000;
const FLASH_PAGE = 0x1000;
const RAM_BASE = 0x20000000;
const RAM_SIZE = 0x20000;
const CODE_REGION_END = 0x20000000; // the FPB matches addresses below this only

const SIGINT = 2;
const SIGTRAP = 5;

const GDB_TARGET_XML = `<?xml version="1.0"?>
<!DOCTYPE target SYSTEM "gdb-target.dtd">
<target version="1.0">
  <architecture>arm</architecture>
  <feature name="org.gnu.gdb.arm.m-profile">
${Array.from({ length: 13 }, (_, i) => `    <reg name="r${i}" bitsize="32" regnum="${i}" type="uint32"/>`).join("\n")}
    <reg name="sp" bitsize="32" regnum="13" type="data_ptr"/>
    <reg name="lr" bitsize="32" regnum="14" type="uint32"/>
    <reg name="pc" bitsize="32" regnum="15" type="code_ptr"/>
    <reg name="xpsr" bitsize="32" regnum="${GDB_REG_XPSR}" type="uint32"/>
  </feature>
</target>
`;

// Tells gdb where flash is, so `load` arrives as vFlash packets rather than
// as plain memory writes, which the flash would silently ignore.
const GDB_MEMORY_MAP_XML = `<?xml version="1.0"?>
<!DOCTYPE memory-map PUBLIC "+//IDN gnu.org//DTD GDB Memory Map V1.0//EN" "http://sourceware.org/gdb/gdb-memory-map.dtd">
<memory-map>
  <memory type="flash" start="0x${FLASH_BASE.toString(16)}" length="0x${FLASH_SIZE.toString(16)}">
    <property name="blocksize">0x${FLASH_PAGE.toString(16)}</property>
  </memory>
  <memory type="ram" start="0x${RAM_BASE.toString(16)}" length="0x${RAM_SIZE.toString(16)}"/>
</memory-map>
`;

// ------------------------------------------------------------ encoding
//
// Packet bodies travel as strings whose char codes are the raw bytes (latin1),
// since the companion hands them over as JSON. Binary packets (X, vFlashWrite,
// qXfer replies) use the protocol's own escaping on top of that.

const hex2 = (n) => (n & 0xff).toString(16).padStart(2, "0");

/** A 32-bit value as gdb wants it: eight hex digits, least significant byte first. */
function hex32(v) {
  return hex2(v) + hex2(v >>> 8) + hex2(v >>> 16) + hex2(v >>> 24);
}

function parseHex32(s) {
  return (parseInt(s.slice(6, 8) + s.slice(4, 6) + s.slice(2, 4) + s.slice(0, 2), 16)) >>> 0;
}

function hexEncode(bytes) {
  let out = "";
  for (const b of bytes) out += hex2(b);
  return out;
}

function hexDecode(s) {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(2 * i, 2), 16);
  return out;
}

function stringToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function bytesToString(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** Binary-packet escaping: '#', '$', '}' and '*' become '}' followed by the byte xor 0x20. */
function rspEscape(bytes) {
  let s = "";
  for (const b of bytes) {
    if (b === 0x23 || b === 0x24 || b === 0x7d || b === 0x2a) s += "}" + String.fromCharCode(b ^ 0x20);
    else s += String.fromCharCode(b);
  }
  return s;
}

function rspUnescape(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i) & 0xff;
    if (c === 0x7d && i + 1 < s.length) out.push((s.charCodeAt(++i) & 0xff) ^ 0x20);
    else out.push(c);
  }
  return Uint8Array.from(out);
}

function wordsToBytes(words) {
  const out = new Uint8Array(words.length * 4);
  const view = new DataView(out.buffer);
  words.forEach((w, i) => view.setUint32(4 * i, w, true));
  return out;
}

function bytesToWords(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(bytes.length >> 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getUint32(4 * i, true);
  return out;
}

const align4 = (a) => (a & ~3) >>> 0;
const alignUp4 = (a) => ((a + 3) & ~3) >>> 0;

/**
 * Intel HEX for a list of {addr, data} segments, sorted by address. Records
 * never cross a 64 KB boundary, where the extended linear address changes.
 */
function intelHex(segments) {
  const lines = [];
  const record = (type, addr, data) => {
    const bytes = [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data];
    const sum = bytes.reduce((a, b) => a + b, 0);
    bytes.push((-sum) & 0xff);
    lines.push(":" + bytes.map((b) => hex2(b).toUpperCase()).join(""));
  };
  let upper = -1;
  for (const { addr, data } of segments) {
    for (let i = 0; i < data.length; ) {
      const a = addr + i;
      if (a >>> 16 !== upper) {
        upper = a >>> 16;
        record(4, 0, [(upper >> 8) & 0xff, upper & 0xff]);
      }
      const n = Math.min(16, data.length - i, 0x10000 - (a & 0xffff));
      record(0, a & 0xffff, Array.from(data.subarray(i, i + n)));
      i += n;
    }
  }
  record(1, 0, []);
  return lines.join("\n") + "\n";
}

/** FPBv1 comparator: address bits 28:2, which halfword to patch, enable. */
function fpComparator(addr) {
  return ((addr & 0x1ffffffc) | (addr & 2 ? 0x80000000 : 0x40000000) | 1) >>> 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// -------------------------------------------------------------- server

class GdbServer {
  /**
   * @param target  the board, all methods async:
   *   readMem32(addr) -> number             writeMem32(addr, value)
   *   readBlock(addr, words) -> Uint32Array  writeBlock(addr, Uint32Array)
   *   readCoreRegister(selector) -> number   writeCoreRegister(selector, value)
   *   flash(intelHexText)                    -- the library's own full flash
   * @param options { log(line), pollMs }  pollMs: how often a running core is
   *   asked whether it has halted; one USB command per poll.
   */
  constructor(target, { log = () => {}, pollMs = 20 } = {}) {
    this.t = target;
    this.log = log;
    this.pollMs = pollMs;
    this.attached = false;
    this.numComparators = 0;
    this.breakpoints = new Map(); // address -> comparator index
    this.interruptRequested = false;
    this.running = false;
    this.flashSegments = [];       // {addr, data} from vFlashWrite, until vFlashDone
    this.stopSignal = SIGTRAP;
  }

  // ----------------------------------------------------------- lifecycle

  /** gdb has connected: halt the core, size and arm the breakpoint unit. */
  async attach() {
    await this.halt();
    const ctrl = await this.t.readMem32(FP_CTRL);
    this.numComparators = Math.min(((ctrl >>> 12) & 0x70) | ((ctrl >>> 4) & 0xf), FP_MAX_COMPARATORS);
    await this.t.writeMem32(FP_CTRL, FP_CTRL_KEY | FP_CTRL_ENABLE);
    for (let i = 0; i < this.numComparators; i++) await this.t.writeMem32(FP_COMP0 + 4 * i, 0);
    this.breakpoints.clear();
    this.attached = true;
    this.stopSignal = SIGTRAP;
    this.log(`gdb attached; ${this.numComparators} hardware breakpoints available`);
  }

  /** gdb has gone: remove every breakpoint and let the program run. */
  async detach() {
    if (!this.attached) return;
    this.attached = false; // also ends a pending `c` without halting the core
    try {
      for (const i of this.breakpoints.values()) await this.t.writeMem32(FP_COMP0 + 4 * i, 0);
      this.breakpoints.clear();
      await this.resume();
    } finally {
      this.log("gdb detached; program running");
    }
  }

  /** gdb pressed Ctrl-C (the pause button): stop a running core. */
  async interrupt() {
    this.interruptRequested = true;
  }

  // -------------------------------------------------------------- core

  async isHalted() {
    return ((await this.t.readMem32(DHCSR)) & S_HALT) !== 0;
  }

  async halt() {
    await this.t.writeMem32(DHCSR, DBGKEY | C_DEBUGEN | C_HALT);
    await this.waitHalted(1000, "halt");
  }

  async resume() {
    await this.t.writeMem32(DHCSR, DBGKEY | C_DEBUGEN);
  }

  async waitHalted(timeoutMs, what) {
    const t0 = Date.now();
    while (!(await this.isHalted())) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`the core did not halt after ${what}`);
      await sleep(this.pollMs);
    }
  }

  /**
   * One instruction, with interrupts masked meanwhile: otherwise the
   * Ravenscar runtime's timer interrupt is pending on nearly every step and
   * the step lands in the runtime instead of on the next line.
   */
  async step() {
    await this.t.writeMem32(DHCSR, DBGKEY | C_DEBUGEN | C_HALT | C_MASKINTS);
    await this.t.writeMem32(DHCSR, DBGKEY | C_DEBUGEN | C_MASKINTS | C_STEP);
    await this.waitHalted(2000, "a single step");
    await this.t.writeMem32(DHCSR, DBGKEY | C_DEBUGEN | C_HALT);
    return this.stopReply(SIGTRAP);
  }

  /** Run until a breakpoint halts the core or gdb interrupts. */
  async continueAndWait() {
    this.interruptRequested = false;
    await this.resume();
    this.running = true;
    try {
      for (;;) {
        if (!this.attached) return "";
        if (await this.isHalted()) return this.stopReply(SIGTRAP);
        if (this.interruptRequested) {
          await this.t.writeMem32(DHCSR, DBGKEY | C_DEBUGEN | C_HALT);
          await this.waitHalted(1000, "an interrupt");
          return this.stopReply(SIGINT);
        }
        await sleep(this.pollMs);
      }
    } finally {
      this.running = false;
    }
  }

  /** System reset with the core caught at the reset vector. */
  async resetHalt() {
    await this.halt();
    const demcr = await this.t.readMem32(DEMCR);
    await this.t.writeMem32(DEMCR, (demcr | VC_CORERESET) >>> 0);
    await this.t.writeMem32(AIRCR, AIRCR_VECTKEY | AIRCR_SYSRESETREQ);
    const t0 = Date.now();
    while (!((await this.t.readMem32(DHCSR)) & S_RESET_ST)) {
      if (Date.now() - t0 > 1000) throw new Error("the core did not reset");
      await sleep(this.pollMs);
    }
    await this.waitHalted(1000, "reset");
    await this.t.writeMem32(DEMCR, (demcr & ~VC_CORERESET) >>> 0);
    // A reset may clear the breakpoint unit; gdb re-inserts its breakpoints
    // before resuming, and insertBreakpoint re-enables the unit each time.
    this.breakpoints.clear();
  }

  /** System reset with the program running. */
  async resetRun() {
    const demcr = await this.t.readMem32(DEMCR);
    await this.t.writeMem32(DEMCR, (demcr & ~VC_CORERESET) >>> 0);
    await this.t.writeMem32(AIRCR, AIRCR_VECTKEY | AIRCR_SYSRESETREQ);
    this.breakpoints.clear();
  }

  stopReply(signal) {
    this.stopSignal = signal;
    return `T${hex2(signal)}thread:1;`;
  }

  // ------------------------------------------------------------ memory

  async readMemory(addr, len) {
    if (len === 0) return new Uint8Array(0);
    const start = align4(addr);
    const words = (alignUp4(addr + len) - start) / 4;
    const data = words === 1
      ? Uint32Array.of(await this.t.readMem32(start))
      : await this.t.readBlock(start, words);
    return wordsToBytes(data).slice(addr - start, addr - start + len);
  }

  async writeMemory(addr, bytes) {
    if (bytes.length === 0) return;
    if (addr < FLASH_BASE + FLASH_SIZE) {
      throw new Error("flash is programmed by `load`, not by memory writes");
    }
    const start = align4(addr);
    const end = alignUp4(addr + bytes.length);
    const buf = new Uint8Array(end - start);
    // Keep the bytes around a partial first or last word.
    if (addr !== start) buf.set(await this.readMemory(start, 4), 0);
    if (end !== addr + bytes.length) buf.set(await this.readMemory(end - 4, 4), end - 4 - start);
    buf.set(bytes, addr - start);
    const words = bytesToWords(buf);
    if (words.length === 1) await this.t.writeMem32(start, words[0]);
    else await this.t.writeBlock(start, words);
  }

  // ------------------------------------------------------- breakpoints

  async insertBreakpoint(addr) {
    if (this.breakpoints.has(addr)) return;
    if (addr >= CODE_REGION_END) {
      throw new Error("hardware breakpoints work in flash only");
    }
    const used = new Set(this.breakpoints.values());
    let slot = 0;
    while (slot < this.numComparators && used.has(slot)) slot++;
    if (slot === this.numComparators) {
      throw new Error(`this board has ${this.numComparators} hardware breakpoints and all are in use`);
    }
    // Re-armed on every insert: a reset clears the unit's enable bit.
    await this.t.writeMem32(FP_CTRL, FP_CTRL_KEY | FP_CTRL_ENABLE);
    await this.t.writeMem32(FP_COMP0 + 4 * slot, fpComparator(addr));
    this.breakpoints.set(addr, slot);
  }

  async removeBreakpoint(addr) {
    const slot = this.breakpoints.get(addr);
    if (slot === undefined) return;
    await this.t.writeMem32(FP_COMP0 + 4 * slot, 0);
    this.breakpoints.delete(addr);
  }

  // ------------------------------------------------------------- flash
  //
  // gdb's `load` arrives as vFlashErase / vFlashWrite / vFlashDone because the
  // memory map marks flash. The writes are collected and handed to the
  // library's full flash as Intel HEX -- the same routine Ctrl+Alt+F uses, so
  // there is one way of programming the board, not two.

  async flashDone() {
    if (!this.flashSegments.length) return;
    const segments = this.flashSegments.sort((a, b) => a.addr - b.addr);
    this.flashSegments = [];
    const total = segments.reduce((n, s) => n + s.data.length, 0);
    this.log(`Flashing ${total} bytes from gdb load...`);
    await this.t.flash(intelHex(segments));
    // The library's flash ends by resetting the board to run the program;
    // gdb believes the core is still stopped, so make that true again.
    await this.halt();
    this.breakpoints.clear();
    this.log("Flashed.");
  }

  // ---------------------------------------------------------- packets

  /**
   * One packet body in, one reply body out (null: send nothing). Errors
   * become "E01": gdb reports them and carries on.
   */
  async handle(body) {
    try {
      return await this.dispatch(body);
    } catch (err) {
      this.log(`gdb: ${body.slice(0, 24)}${body.length > 24 ? "..." : ""} failed: ${err.message}`);
      return "E01";
    }
  }

  async dispatch(body) {
    const cmd = body[0];
    const rest = body.slice(1);
    switch (cmd) {
      case "!": return "OK";
      case "?": return this.stopReply(this.stopSignal);
      case "H": return "OK";
      case "T": return "OK";
      case "D": await this.detach(); return "OK";
      case "k": await this.detach(); return null;
      case "g": return this.readAllRegisters();
      case "G": return this.writeAllRegisters(rest);
      case "p": return hex32(await this.readRegister(parseInt(rest, 16)));
      case "P": {
        const [n, v] = rest.split("=");
        await this.writeRegister(parseInt(n, 16), parseHex32(v));
        return "OK";
      }
      case "m": {
        const [a, n] = rest.split(",");
        return hexEncode(await this.readMemory(parseInt(a, 16), parseInt(n, 16)));
      }
      case "M": {
        const [head, data] = splitOnce(rest, ":");
        const [a] = head.split(",");
        await this.writeMemory(parseInt(a, 16), hexDecode(data));
        return "OK";
      }
      case "X": {
        const [head, data] = splitOnce(rest, ":");
        const [a] = head.split(",");
        await this.writeMemory(parseInt(a, 16), rspUnescape(data));
        return "OK";
      }
      case "c": case "C": return this.continueAndWait();
      case "s": case "S": return this.step();
      case "Z": case "z": return this.breakpointPacket(cmd, rest);
      case "q": return this.query(rest);
      case "Q": return rest === "StartNoAckMode" ? "OK" : ""; // the companion drops the acks
      case "v": return this.vPacket(rest);
      default: return "";
    }
  }

  async readAllRegisters() {
    let out = "";
    for (let sel = 0; sel < GDB_REGS; sel++) out += hex32(await this.t.readCoreRegister(sel));
    return out;
  }

  async writeAllRegisters(hex) {
    for (let sel = 0; sel < GDB_REGS && 8 * sel + 8 <= hex.length; sel++) {
      await this.t.writeCoreRegister(sel, parseHex32(hex.slice(8 * sel, 8 * sel + 8)));
    }
    return "OK";
  }

  selector(gdbReg) {
    if (gdbReg >= 0 && gdbReg <= 15) return gdbReg;
    if (gdbReg === GDB_REG_XPSR) return DCRSR_XPSR;
    throw new Error(`no such register: ${gdbReg}`);
  }

  readRegister(gdbReg) {
    return this.t.readCoreRegister(this.selector(gdbReg));
  }

  writeRegister(gdbReg, value) {
    return this.t.writeCoreRegister(this.selector(gdbReg), value);
  }

  /** Z0 (software) and Z1 (hardware) are both hardware: the code is in flash. */
  async breakpointPacket(cmd, rest) {
    const [type, addrHex] = rest.split(",");
    if (type !== "0" && type !== "1") return ""; // watchpoints: not supported
    const addr = parseInt(addrHex, 16);
    if (cmd === "Z") await this.insertBreakpoint(addr);
    else await this.removeBreakpoint(addr);
    return "OK";
  }

  async query(q) {
    if (q.startsWith("Supported")) {
      return [
        `PacketSize=${GDB_PACKET_SIZE.toString(16)}`,
        "QStartNoAckMode+",
        "qXfer:features:read+",
        "qXfer:memory-map:read+",
        "vContSupported+",
        "hwbreak+",
      ].join(";");
    }
    if (q.startsWith("Xfer:features:read:target.xml:")) {
      return xferChunk(GDB_TARGET_XML, q.slice("Xfer:features:read:target.xml:".length));
    }
    if (q.startsWith("Xfer:memory-map:read::")) {
      return xferChunk(GDB_MEMORY_MAP_XML, q.slice("Xfer:memory-map:read::".length));
    }
    if (q.startsWith("Rcmd,")) return this.monitor(bytesToString(hexDecode(q.slice(5))).trim());
    if (q === "C") return "QC1";
    if (q === "Attached") return "1";            // detach on quit rather than kill
    if (q === "fThreadInfo") return "m1";
    if (q === "sThreadInfo") return "l";
    if (q.startsWith("ThreadExtraInfo")) return hexEncode(stringToBytes("Cortex-M4"));
    if (q.startsWith("Symbol")) return "OK";
    return "";
  }

  /** `monitor ...` from gdb, which Cortex-Debug uses for resets. */
  async monitor(command) {
    switch (command) {
      case "reset halt": case "reset init": await this.resetHalt(); return "OK";
      case "reset": case "reset run": await this.resetRun(); return "OK";
      case "halt": await this.halt(); return "OK";
      default: return hexEncode(stringToBytes(`unknown monitor command: ${command}\n`));
    }
  }

  async vPacket(v) {
    if (v === "Cont?") return "vCont;c;C;s;S";
    if (v.startsWith("Cont;")) {
      const action = v[5];
      if (action === "c" || action === "C") return this.continueAndWait();
      if (action === "s" || action === "S") return this.step();
      return "E01";
    }
    if (v.startsWith("FlashErase:")) return "OK";     // the flash routine erases itself
    if (v.startsWith("FlashWrite:")) {
      const [addrHex, data] = splitOnce(v.slice("FlashWrite:".length), ":");
      this.flashSegments.push({ addr: parseInt(addrHex, 16), data: rspUnescape(data) });
      return "OK";
    }
    if (v === "FlashDone") { await this.flashDone(); return "OK"; }
    if (v.startsWith("Kill")) { await this.detach(); return "OK"; }
    return "";                                          // vMustReplyEmpty, and the rest
  }
}

function splitOnce(s, sep) {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

/** One qXfer reply: "m" + a piece, or "l" + the last piece. */
function xferChunk(text, range) {
  const [offset, length] = range.split(",").map((x) => parseInt(x, 16));
  const piece = text.slice(offset, offset + length);
  const last = offset + length >= text.length;
  return (last ? "l" : "m") + rspEscape(stringToBytes(piece));
}

// Loaded on its own by tools/test_gdbserver.mjs; inside the bundle,
// extension.js replaces module.exports afterwards.
if (typeof module !== "undefined") {
  module.exports.GdbServer = GdbServer;
  module.exports.gdbInternals = {
    intelHex, fpComparator, hex32, parseHex32, rspEscape, rspUnescape, GDB_TARGET_XML, GDB_MEMORY_MAP_XML,
  };
}
