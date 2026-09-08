# Breakpoint debugging from a Codespace

## Context

A Codespace has no USB, so `setup/codespace.md` says F5 does not work there. The flasher
extension already holds a WebUSB CMSIS-DAP connection to the board *in the student's
browser*; this feature reuses it so F5 works on the browser path too. Decisions taken with
Steven on 2026-09-06: gdbserver lives in the browser extension (A), front end is
Cortex-Debug, F5 builds, flashes and then debugs.

Handoff from the sibling session (verified facts): flasher 0.1.6 works in a real Codespace
(flash, serial in/out); companion 0.1.0 awaits his test; the vendored library exposes
`connection.device.{cortexM, adi, dap}` with halt/resume/reset/readCoreRegister/
writeCoreRegister/readMem32/writeMem32/readBlock/writeBlock, no step and no FPB code; the
transport's `send()` runs through a `sendQueue`, so serial polling and debug transfers
cannot interleave on USB. Cross-host `executeCommand` (Node host to web host) has never been
exercised. `arm-eabi-gdb` 16.3 ships in the gnat_arm_elf crate and the Dockerfile symlinks
it to `/usr/local/bin`; builds already carry `-g`.

## Design

```
arm-eabi-gdb (container) --TCP 127.0.0.1:3333--> companion (Node host)
   --executeCommand("microbit.gdb.packet", text), one call per gdb packet-->
flasher web extension (browser): RSP server on the existing WebUSB connection
   --CMSIS-DAP--> DAPLink --SWD--> nRF52833
```

Why the packet boundary: gdb sends ~5-15 packets per stop and the browser does the dozens
of SWD transfers each one needs locally. Relaying at the SWD level (pyocd remote probe)
would cost 50-100 cross-host round trips per stop.

- **Cortex-Debug** with `servertype: external`, `gdbTarget: localhost:3333`. On launch it
  sends `target-select extended-remote`, `load`, `monitor reset halt` (checked in its
  `external.ts`), then breakpoints and `continue`. No `loadFiles` tricks needed.
- **One launch config.** The companion registers a `DebugConfigurationProvider` for
  `cortex-debug` that, only when `env.uiKind === Web`, rewrites `servertype: pyocd` to
  `external` + `gdbTarget`. Locals keep pyocd untouched, Codespace students press F5.
  (Fallback if this feels too magic: a second config "Debug (Codespace)".)
- **Flash = gdb `load`.** The stub serves a memory map (flash 0-0x80000, 4 KB pages; RAM
  0x20000000, 128 KB), so gdb uses `vFlashErase/Write/Done`; the stub buffers the image,
  converts it to Intel HEX and calls the library's proven `flash()` (`partial: false`).
  That routine reconnects USB, so the stub must re-read `connection.device` afterwards.
- **Breakpoints are FPB hardware breakpoints** (6 comparators on this Cortex-M4). `Z0` is
  treated as `Z1`, as OpenOCD's `gdb_breakpoint_override hard` does; the 7th returns an
  error. Step uses DHCSR `C_STEP | C_MASKINTS`, or Ravenscar's timer interrupts drag every
  step into the runtime.
- **target.xml** (`org.gnu.gdb.arm.m-profile`) via `qXfer:features:read`; without it gdb
  assumes FPA registers in the `g` packet.
- **Long-running `c`**: the packet command resolves when the browser sees `S_HALT`
  (poll `isHalted()` every ~20 ms). gdb's `0x03` becomes a separate
  `microbit.gdb.interrupt` command. Serial keeps polling during a session.
- **Board not connected when gdb arrives**: no user gesture is available, so the companion
  closes the socket and shows "Connect the micro:bit first (Serial view header)". The
  extension already auto-reconnects an authorised board on activation.

## Work

Branch `debug-from-codespace` from f1821e2 (head of `serial-view-and-companion`); PR after
#25 merges. Do not touch the submodule.

1. **RSP server** — new `extension/gdbserver.js`, bundled as "Part 3" by `write_extension`
   in `tools/mb.py` (`extension/extension.js` registers `microbit.gdb.packet|interrupt|
   ping` and passes it `() => connection`). Packets: `qSupported` (PacketSize,
   `QStartNoAckMode`, features, memory-map, `vContSupported`), `?`, `g/G/p/P`, `m/M/X`,
   `c/s/vCont`, `Z0/Z1/z0/z1`, `vFlash*`, `qRcmd` (`reset halt`, `halt`, `reset`),
   `D/k`, `H/qC/qAttached/qfThreadInfo`. Registers via `cortexM.readCoreRegister`,
   memory via `adi.readBlock/writeBlock`, reset via `cortexM.reset(true)`.
   Test: `tools/test_gdbserver.mjs`, Node only, fake `cortexM`/`adi` over a Map-backed
   memory: framing and checksums, `g` layout, FPB comparator encoding, 7th breakpoint
   rejected, `vFlash*` reassembles to the bytes given, `c` resolves on halt, interrupt.
2. **Companion relay** — `companion/extension.js`: `net.createServer` on 127.0.0.1:3333 at
   activation (web UI only), one gdb client at a time, RSP framing, `+/-` until
   `QStartNoAckMode`, `0x03` → interrupt, socket close → `D`. Plus the launch-config
   provider above and a startup `microbit.gdb.ping` whose round trip is logged (the RTT
   number, and proof the cross-host route works). Test: `tools/test_companion.mjs`, a real
   TCP client against a mocked `vscode.commands`. Wire both tests into `ada.yml` beside
   `test_extension.mjs`; break each once to see it fail.
3. **Config and docs** — `.devcontainer/devcontainer.json`: add `marus25.cortex-debug`
   (its mcu-debug dependencies install automatically) and `portsAttributes` 3333
   `onAutoForward: ignore`. `.vscode/launch.json`: comment on the rewrite. `README.md`
   table cell "Debugging (F5): from the browser"; `setup/codespace.md` replaces the
   "does not work here" paragraph with a five-line how-to (plug in, Connect, F5); short
   sections in `extension/README.md`, `companion/README.md`, `CLAUDE.md` (architecture
   and the traps: packet boundary, FPA layout, C_MASKINTS, flash reconnect). Versions:
   flasher 0.1.7, companion 0.1.1; Steven publishes by hand as usual.
4. **Only if line-stepping is measured slow**: `vCont;r` range stepping in the stub.

Out of scope now: DWT watchpoints, FPU registers, Ada task switching (`info tasks` works,
switching does not), SVD peripheral view, desktop VS Code (keeps pyocd).

## Verification

- `node tools/test_gdbserver.mjs`, `node tools/test_companion.mjs`,
  `node tools/test_extension.mjs`, `python3 tools/mb.py build --all` still green.
- Real board on this Mac through the `code serve-web` rig (`verify-ui` skill recipe): same
  VS Code build as Codespaces, companion in the Node host, flasher in the browser,
  `arm-eabi-gdb` from the Alire toolchain. First check: the cross-host command route.
  Then the real F5 flow: breakpoint in `main.adb`, hit, step, variables, call stack,
  continue, pause, restart, and serial still flowing. Halting the core while serial polls
  is untested (handoff) and gets checked here.
- Steven, in a real Codespace with the published 0.1.7 + 0.1.1: F5 end to end, and the
  RTT line from `micro:bit: Show connection status`. That is the only place Codespace
  latency and the companion's auto-install get tested; say so in the PR.
