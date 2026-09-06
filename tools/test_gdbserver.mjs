//  Regression test for the GDB remote-protocol server (extension/gdbserver.js).
//  Node built-ins only. The board is a fake: a word-addressed memory with the
//  Cortex-M debug registers modelled just far enough to halt, step, reset and
//  hit a breakpoint, and a flash() that records the hex it was given.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const check = (c, w) => { if (!c) fail.push(w); };

// Load it the way the bundle does: a classic script with a `module`.
const src = fs.readFileSync(path.join(root, "extension/gdbserver.js"), "utf8");
const mod = { exports: {} };
new Function("module", "exports", src)(mod, mod.exports);
const { GdbServer, gdbInternals } = mod.exports;
const { intelHex, fpComparator, hex32, parseHex32, rspEscape, rspUnescape } = gdbInternals;

const DHCSR = 0xe000edf0, DEMCR = 0xe000edfc, DFSR = 0xe000ed30, AIRCR = 0xe000ed0c;
const FP_CTRL = 0xe0002000, FP_COMP0 = 0xe0002008;
const S_HALT = 1 << 17, S_RESET_ST = 1 << 25, DFSR_BKPT = 1 << 1;

class FakeBoard {
  constructor({ comparators = 6, faultOnResetRequest = false, ignoreReset = false } = {}) {
    this.mem = new Map();
    this.regs = new Array(17).fill(0);
    this.regs[13] = 0x20010000;
    this.regs[15] = 0x1000;
    this.halted = false;
    this.resetSeen = false;
    this.fpEnabled = false;
    this.dfsr = 0;            // sticky halt reasons, write-one-to-clear
    this.comparators = comparators;
    this.faultOnResetRequest = faultOnResetRequest; // the AIRCR write resets, then faults
    this.ignoreReset = ignoreReset;                 // the AIRCR write does nothing
    this.writes = [];        // every [addr, value] written, in order
    this.flashed = null;     // the hex handed to flash()
    this.stopOnResume = null; // "a breakpoint at this address": halt as soon as the core runs
  }
  fault(addr) {
    return !(addr < 0x80000 || (addr >= 0x20000000 && addr < 0x20020000) || addr >= 0xe0000000);
  }
  async readMem32(addr) {
    if (this.fault(addr)) throw new Error(`bus fault at 0x${addr.toString(16)}`);
    if (addr === DHCSR) {
      const v = (this.halted ? S_HALT : 0) | (this.resetSeen ? S_RESET_ST : 0);
      this.resetSeen = false;
      return v;
    }
    if (addr === FP_CTRL) {
      // NUM_CODE[3:0] in bits 7:4, NUM_CODE[6:4] in bits 14:12 (ARMv7-M C1.11).
      return ((this.comparators & 0xf) << 4) | (((this.comparators >> 4) & 7) << 12) | (this.fpEnabled ? 1 : 0);
    }
    if (addr === DFSR) return this.dfsr;
    return this.mem.get(addr) ?? 0;
  }
  async writeMem32(addr, v) {
    if (this.fault(addr)) throw new Error(`bus fault at 0x${addr.toString(16)}`);
    v >>>= 0;
    this.writes.push([addr, v]);
    if (addr === DHCSR) {
      if ((v >>> 16) !== 0xa05f) return;          // no key, no effect
      if (v & 2) this.halted = true;
      else if (v & 4) { this.regs[15] += 2; this.halted = true; }
      else {
        this.halted = false;
        if (this.stopOnResume !== null) {
          this.regs[15] = this.stopOnResume; this.stopOnResume = null;
          this.halted = true; this.dfsr |= DFSR_BKPT;
        }
      }
      return;
    }
    if (addr === DFSR) { this.dfsr &= ~v; return; }
    if (addr === AIRCR) {
      if ((v >>> 16) === 0x05fa && (v & 4) && !this.ignoreReset) {
        this.resetSeen = true;
        this.regs[15] = 0x100;
        this.halted = ((this.mem.get(DEMCR) ?? 0) & 1) !== 0;   // VC_CORERESET
        this.fpEnabled = false;
        if (this.faultOnResetRequest) throw new Error("transfer fault: the DP reset under the write");
      }
      return;
    }
    if (addr === FP_CTRL) { if (v & 2) this.fpEnabled = (v & 1) !== 0; return; }
    this.mem.set(addr, v);
  }
  async readBlock(addr, words) {
    const out = new Uint32Array(words);
    for (let i = 0; i < words; i++) out[i] = await this.readMem32(addr + 4 * i);
    return out;
  }
  async writeBlock(addr, words) {
    for (let i = 0; i < words.length; i++) await this.writeMem32(addr + 4 * i, words[i]);
  }
  async readCoreRegister(sel) {
    if (sel < 0 || sel > 16) throw new Error(`bad selector ${sel}`);
    return this.regs[sel];
  }
  async writeCoreRegister(sel, v) { this.regs[sel] = v >>> 0; }
  async flash(hex) { this.flashed = hex; this.halted = false; } // the library resets to run
  wrote(addr, value) { return this.writes.some(([a, v]) => a === addr && v === (value >>> 0)); }
}

/** Just enough Intel HEX parsing to check what flash() was given. */
function parseHex(text) {
  const out = new Map(); // address -> byte
  let upper = 0;
  for (const line of text.split("\n").filter(Boolean)) {
    check(line.startsWith(":"), `hex record must start with ':' -- ${line}`);
    const bytes = [];
    for (let i = 1; i < line.length; i += 2) bytes.push(parseInt(line.substr(i, 2), 16));
    check(bytes.reduce((a, b) => a + b, 0) % 256 === 0, `hex record checksum -- ${line}`);
    const [count, hi, lo, type] = bytes;
    const data = bytes.slice(4, 4 + count);
    if (type === 4) upper = (data[0] << 8) | data[1];
    else if (type === 0) data.forEach((b, i) => out.set(upper * 0x10000 + (hi << 8) + lo + i, b));
    else check(type === 1, `unexpected record type ${type}`);
  }
  return out;
}

const hexOf = (s) => Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
const latin1 = (bytes) => String.fromCharCode(...bytes);

// ------------------------------------------------------------- encoding
check(hex32(0x12345678) === "78563412", "hex32 is little-endian");
check(parseHex32("78563412") === 0x12345678, "parseHex32 undoes it");
check(parseHex32(hex32(0xfffffffe)) === 0xfffffffe, "the top bit survives the round trip");
const nasty = Uint8Array.from([0x23, 0x24, 0x7d, 0x2a, 0x00, 0x41, 0xff]);
check(rspEscape(nasty) === "}\x03}\x04}\x5d}\x0a\x00A\xff", "the four special bytes are escaped, nothing else");
check(latin1(rspUnescape(rspEscape(nasty))) === latin1(nasty), "unescape undoes escape");
{
  const a = Uint8Array.from({ length: 20 }, (_, i) => i);
  const b = Uint8Array.from({ length: 16 }, (_, i) => 0x80 + i);
  const hex = intelHex([{ addr: 0, data: a }, { addr: 0x1fff8, data: b }]);
  const bytes = parseHex(hex);
  check(bytes.size === 36, "every byte is in the hex once");
  check(a.every((v, i) => bytes.get(i) === v) && b.every((v, i) => bytes.get(0x1fff8 + i) === v),
        "the bytes come back at their addresses");
  const lines = hex.trim().split("\n");
  check(lines[0] === ":020000040000FA" && lines.filter((l) => l.startsWith(":02000004")).length === 3,
        "an extended linear address record opens each 64 KB segment (0, 1 and 2 here)");
  check(lines.some((l) => l.startsWith(":08FFF800")), "a record stops at the 64 KB boundary rather than crossing it");
  check(lines[lines.length - 1] === ":00000001FF", "and the file ends with the end-of-file record");
}
check(fpComparator(0x1234) === 0x40001235, "FPBv1 comparator: lower halfword, address bits 28:2, enable");
check(fpComparator(0x1236) === 0x80001235, "FPBv1 comparator: upper halfword for an address with bit 1 set");

// ------------------------------------------------------------ lifecycle
const logged = [];
const board = new FakeBoard();
const gdb = new GdbServer(board, { log: (l) => logged.push(l), pollMs: 1 });
await gdb.attach();
check(board.halted, "attach halts the core: gdb assumes a stopped target");
check(board.wrote(FP_CTRL, 3), "attach arms the breakpoint unit (KEY | ENABLE)");
check(gdb.numComparators === 6, "the comparator count is read from FP_CTRL");
check(logged.some((l) => /6 hardware breakpoints/.test(l)), "and reported");

// -------------------------------------------------------------- queries
const supported = await gdb.handle("qSupported:multiprocess+;swbreak+;xmlRegisters=i386");
for (const f of ["PacketSize=4000", "QStartNoAckMode+", "qXfer:features:read+", "qXfer:memory-map:read+", "vContSupported+", "hwbreak+"]) {
  check(supported.split(";").includes(f), `qSupported advertises ${f}`);
}
check(await gdb.handle("QStartNoAckMode") === "OK", "no-ack mode is accepted");
check(await gdb.handle("!") === "OK" && await gdb.handle("Hg0") === "OK" && await gdb.handle("qC") === "QC1",
      "extended mode, thread selection and the current thread");
check(await gdb.handle("vMustReplyEmpty") === "", "an unknown packet gets the empty reply, as the protocol requires");
check(await gdb.handle("qAttached") === "1", "attached, so quitting gdb detaches rather than kills");
check(await gdb.handle("?") === "T05thread:1;", "the initial stop reason is a trap");
check(await gdb.handle("vCont?") === "vCont;c;C;s;S", "vCont offers continue and step");

const xml = await gdb.handle("qXfer:features:read:target.xml:0,fff");
check(xml.startsWith("l") && /org\.gnu\.gdb\.arm\.m-profile/.test(xml), "the target description is the Cortex-M profile");
check(/<reg name="xpsr" bitsize="32" regnum="25"/.test(xml), "xpsr carries gdb's own number 25, so the g packet needs no FPA padding");
check((xml.match(/<reg /g) || []).length === 17, "seventeen registers, the ones in the g packet");
const part1 = await gdb.handle("qXfer:features:read:target.xml:0,40");
const part2 = await gdb.handle("qXfer:features:read:target.xml:40,fff");
check(part1.startsWith("m") && part1.length === 65 && part1.slice(1) + part2.slice(1) === xml.slice(1),
      "a description too big for one packet comes in pieces");
const map = await gdb.handle("qXfer:memory-map:read::0,fff");
check(/type="flash" start="0x0" length="0x80000"/.test(map) && /blocksize">0x1000</.test(map) && /type="ram" start="0x20000000" length="0x20000"/.test(map),
      "the memory map has the nRF52833's flash, its 4 KB pages, and its RAM");

// ------------------------------------------------------------ registers
board.regs[0] = 0x11223344;
board.regs[15] = 0x00001000;
board.regs[16] = 0x01000000;
const g = await gdb.handle("g");
check(g.length === 17 * 8, "g carries r0-r15 and xpsr, nothing else");
check(g.startsWith("44332211"), "each register is little-endian");
check(g.slice(15 * 8, 16 * 8) === "00100000" && g.slice(16 * 8) === "00000001", "pc is 16th, xpsr 17th");
check(await gdb.handle("pf") === "00100000", "p reads a single register by gdb number");
check(await gdb.handle("p19") === "00000001", "gdb's register 25 is xpsr (DCRSR selector 16)");
check(await gdb.handle("p10") === "E01", "the FPA registers do not exist here");
check(await gdb.handle("Pf=00200000") === "OK" && board.regs[15] === 0x2000, "P writes one register");
check(await gdb.handle("G" + "01000000".repeat(17)) === "OK" && board.regs[16] === 1 && board.regs[0] === 1, "G writes them all");

// --------------------------------------------------------------- memory
board.mem.set(0x20000000, 0x44332211);
board.mem.set(0x20000004, 0x88776655);
check(await gdb.handle("m20000001,5") === "2233445566", "an unaligned read slices the covering words");
check(await gdb.handle("m20000000,4") === "11223344", "an aligned word");
check(await gdb.handle("M20000001,2:aabb") === "OK" && board.mem.get(0x20000000) === 0x44bbaa11,
      "a partial write keeps the neighbouring bytes");
check(await gdb.handle("X20000004,4:" + rspEscape(Uint8Array.from([0x23, 0x24, 0x7d, 0x2a]))) === "OK"
      && board.mem.get(0x20000004) === 0x2a7d2423, "X takes escaped binary");
check(await gdb.handle("X20000000,0:") === "OK", "gdb's empty X probe is fine");
check(await gdb.handle("X0,0:") === "OK", "even at address 0, which is flash: nothing is written");
check(await gdb.handle("M100,4:00000000") === "E01", "flash is not writable as memory: load does that");
check(await gdb.handle("m30000000,4") === "E01", "a bus fault becomes an error reply, not a dead session");
check(await gdb.handle("mfffffffc,8") === "E01", "a read past the end of the address space is refused, not wrapped");

// ---------------------------------------------------------- breakpoints
check(await gdb.handle("Z0,1234,2") === "OK" && board.wrote(FP_COMP0, 0x40001235), "Z0 lands in a comparator: the code is in flash");
check(await gdb.handle("Z0,1234,2") === "OK" && gdb.breakpoints.size === 1, "inserting it again is a no-op");
check(await gdb.handle("Z1,1236,2") === "OK" && board.wrote(FP_COMP0 + 4, 0x80001235), "Z1 too, in the next comparator");
for (const a of ["2000", "2004", "2008", "200c"]) check(await gdb.handle(`Z0,${a},2`) === "OK", `breakpoint at 0x${a}`);
check(await gdb.handle("Z0,3000,2") === "E01", "the seventh breakpoint is refused: six comparators");
check(logged.some((l) => /6 hardware breakpoints and all are in use/.test(l)), "and the log says why");
check(await gdb.handle("z0,1234,2") === "OK" && board.wrote(FP_COMP0, 0) && gdb.breakpoints.size === 5, "z0 frees the comparator");
check(await gdb.handle("Z0,3000,2") === "OK" && gdb.breakpoints.get(0x3000) === 0, "which the next breakpoint reuses");
check(await gdb.handle("Z0,20000100,2") === "E01", "no breakpoints in RAM: the FPB cannot match there");
check(await gdb.handle("Z2,20000100,4") === "", "watchpoints are not offered");
for (const a of ["3000", "1236", "2000", "2004", "2008", "200c"]) await gdb.handle(`z0,${a},2`);
check(gdb.breakpoints.size === 0, "all removed");

// ------------------------------------------------------------ execution
board.stopOnResume = 0x1240;
check(await gdb.handle("c") === "T05hwbreak:;thread:1;" && board.regs[15] === 0x1240 && board.halted,
      "continue returns when the core halts at a breakpoint, and says a breakpoint did it (hwbreak+ was promised)");
check(!gdb.running, "and the server knows it is stopped");
check(await gdb.handle("?") === "T05hwbreak:;thread:1;", "? repeats that");
board.writes.length = 0;
check(await gdb.handle("s") === "T05thread:1;" && board.regs[15] === 0x1242,
      "a step moves one instruction, and is not reported as a breakpoint: the halt reasons were cleared first");
{
  const dhcsr = board.writes.filter(([a]) => a === DHCSR).map(([, v]) => v & 0xf);
  check(dhcsr.join(",") === "11,13,3", "step: mask interrupts while halted, step with them masked, unmask");
}
check(await gdb.handle("vCont;s:1") === "T05thread:1;" && board.regs[15] === 0x1244, "vCont;s steps too");
{
  const pending = gdb.handle("vCont;c");
  await new Promise((r) => setTimeout(r, 15));
  check(gdb.running && !board.halted, "continue with nothing to hit keeps running");
  await gdb.interrupt();
  check(await pending === "T02thread:1;" && board.halted, "the pause button halts the core and reports SIGINT");
}
check(await gdb.handle("?") === "T02thread:1;", "? repeats the last stop reason");

// ---------------------------------------------------------------- resets
board.mem.set(DEMCR, 0x01000000);
await gdb.handle("Z0,1240,2");
board.writes.length = 0;
check(await gdb.handle("qRcmd," + hexOf("reset halt")) === "OK", "monitor reset halt");
check(board.halted && board.regs[15] === 0x100, "the core is caught at the reset vector");
check(board.mem.get(DEMCR) === 0x01000000, "DEMCR is put back afterwards (VC_CORERESET off)");
check([0, 1, 2, 3, 4, 5].every((i) => board.wrote(FP_COMP0 + 4 * i, 0)) && gdb.breakpoints.size === 0,
      "every comparator is cleared after a reset: the hardware is made to match the empty table, not assumed to");
check(await gdb.handle("qRcmd," + hexOf("reset")) === "OK" && !board.halted, "monitor reset lets it run");
check(await gdb.handle("qRcmd," + hexOf("halt")) === "OK" && board.halted, "monitor halt");
check(/unknown monitor command: frobnicate/.test(Buffer.from(await gdb.handle("qRcmd," + hexOf("frobnicate")), "hex").toString()),
      "an unknown monitor command explains itself");

// ----------------------------------------------------------------- load
check(await gdb.handle("vFlashErase:0,1000") === "OK", "vFlashErase is accepted");
const img1 = Uint8Array.from({ length: 24 }, (_, i) => i * 3);
const img2 = Uint8Array.from([0x23, 0x24, 0x7d, 0x2a]);
check(await gdb.handle("vFlashWrite:20:" + rspEscape(img2)) === "OK", "vFlashWrite, out of order");
check(await gdb.handle("vFlashWrite:0:" + rspEscape(img1)) === "OK", "vFlashWrite");
await gdb.handle("Z0,1240,2");
check(board.flashed === null, "nothing is flashed before vFlashDone");
check(await gdb.handle("vFlashDone") === "OK" && board.flashed !== null, "vFlashDone flashes through the library");
{
  const bytes = parseHex(board.flashed);
  check(bytes.size === 28 && img1.every((v, i) => bytes.get(i) === v) && img2.every((v, i) => bytes.get(0x20 + i) === v),
        "the image handed to flash() is what gdb sent, as Intel HEX");
}
check(board.halted, "the core is halted again after the flash, which resets it to run");
check(gdb.breakpoints.size === 0, "breakpoints are forgotten: gdb re-inserts them before continuing");

// --------------------------------------------------------------- detach
board.writes.length = 0;
await gdb.handle("Z0,1240,2");
{
  const pending = gdb.handle("c");
  await new Promise((r) => setTimeout(r, 10));
  check(await gdb.handle("D") === "OK", "detach while running");
  check(await pending === "", "ends the pending continue");
}
check(!gdb.attached && !board.halted && board.wrote(FP_COMP0, 0), "detach clears the comparators and leaves the program running");
check(await gdb.handle("k") === null, "kill gets no reply");

const second = new GdbServer(new FakeBoard({ comparators: 0 }), { log: () => {} });
await second.attach();
check(await second.handle("Z0,1000,2") === "E01", "a unit with no comparators refuses cleanly");

// FP_CTRL splits NUM_CODE across bits 14:12 and 7:4. This chip has 6, so the
// high bits are zero and a wrong decode of them passed on real silicon.
const wide = new GdbServer(new FakeBoard({ comparators: 18 }), { log: () => {} });
await wide.attach();
check(wide.numComparators === 16, `NUM_CODE[6:4] is decoded from bits 14:12 (18 comparators, capped at 16; got ${wide.numComparators})`);

// A reset can fault the very transfer that requests it; the reset still
// happens, and the server must carry on to the poll rather than give up.
{
  const lines = [];
  const b = new FakeBoard({ faultOnResetRequest: true });
  const g = new GdbServer(b, { log: (l) => lines.push(l), pollMs: 1 });
  await g.attach();
  b.mem.set(DEMCR, 0x01000000);
  check(await g.handle("qRcmd," + hexOf("reset halt")) === "OK", "a faulting reset request is tolerated");
  check(b.halted && b.regs[15] === 0x100 && b.mem.get(DEMCR) === 0x01000000, "the core is at the vector and DEMCR is restored");
  check(lines.some((l) => /reset request faulted/.test(l)), "and the fault is logged, not hidden");
}
// And when the reset never happens, the error must not leave the halt-at-vector bit set.
{
  const b = new FakeBoard({ ignoreReset: true });
  const g = new GdbServer(b, { log: () => {}, pollMs: 1 });
  await g.attach();
  b.mem.set(DEMCR, 0x01000000);
  check(await g.handle("qRcmd," + hexOf("reset halt")) === "E01", "a reset that never happens is an error");
  check(b.mem.get(DEMCR) === 0x01000000, "with VC_CORERESET cleared again, so the next plain reset runs the program");
}

if (fail.length) {
  console.error("FAIL");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS  gdbserver: encoding, attach, queries, registers, memory, breakpoints, execution, resets, load, detach");
