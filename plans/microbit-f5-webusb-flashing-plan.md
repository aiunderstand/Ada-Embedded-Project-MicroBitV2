# Feature 5 — WebUSB / WebSerial browser flashing for micro:bit v2 Ada

## Verified this session (not assumptions)

| Fact | Evidence |
|---|---|
| dapjs `DAPLink.flash()` streams through DAPLink's **MSD vendor commands** (OPEN 0x8A / WRITE 0x8C / CLOSE 0x8B / RESET 0x89) with a `streamType` flag: **0 = binary, 1 = hex** | read `src/daplink/index.ts` + `enums.ts` |
| So WebUSB flashing uses the **exact same DAPLink hex parser as drag-and-drop**. Intel HEX just works. | same |
| `isBufferBinary()` auto-detects text vs binary — no need to tell it which | same |
| dapjs 2.3.0 `dist/dap.umd.js` is **38,978 bytes, zero external requires**, sets global `DAPjs` | executed the UMD in node |
| Runtime exports: `WebUSB`, `DAPLink`, `CmsisDAP`, `CortexM`, `ADI`, `HID`, `USB`, `FPBCtrlMask` | `Object.keys()` on the loaded module |
| **`DAPjs.DAPInfoRequest` is `undefined` at runtime** — it is a TS `const enum`, inlined at build time. Must use numeric literals. | executed |
| `DAPLink.EVENT_PROGRESS === "progress"`, `EVENT_SERIAL_DATA === "serial"` | executed |
| `CmsisDAP.prototype` has a **`sendMutex`** — concurrent serial polling + flashing is serialised, not corrupting | read `cmsis-dap.ts:112,171,203` |
| `CortexM.prototype` = enableDebug, getState, isHalted, halt, resume, readCoreRegister(s), writeCoreRegister, execute, softReset, setTargetResetState. **No `step`. No `setBreakpoint`.** | executed |
| `@microbit/microbit-connection` is **ESM-only with subpath exports** (`/usb`, `/bluetooth`) → needs a bundler | README + package layout |
| **`MB_UART_TX` = P0.06 (`UART_INT_TX`), `MB_UART_RX` = P1.08 (`UART_INT_RX`)** — exactly the DAPLink-bridged pins | `boards/MicroBit_v2/src/full/microbit.ads:91-92` |
| `MicroBit.Console` configures `Baud115200` | `boards/MicroBit_v2/src/full/microbit-console.adb:108` |
| → **`Put_Line` output physically reaches DAPLink's USB serial.** The console feature will work. | the two above |
| WebUSB supported in DAPLink since **0247**; micro:bit **V2 ships 0255 (V2.00) / 0257 (V2.2x) from the factory** | tech.microbit.org/software/daplink-interface |
| → a firmware-version gate is **near-dead code for v2**. The useful gate is V1-vs-V2. | inference from above |
| Board ID = **first 4 chars of USB serial number**; 9900/9901 = V1, 9903+ = V2 | support.microbit.org |
| `arm-eabi-objcopy` **is present** in the GNAT arm-elf toolchain (and on this Mac's PATH) | `which arm-eabi-objcopy` |
| WebUSB in VS Code webviews: still an **open feature request** (microsoft/vscode#116761) → not viable | GitHub issue |
| UICR is only touched at **runtime** in ADL, never as a linker output section | grep of board dir |

## Recommendation in one line

Vendor **dapjs 2.3.0 UMD** into a **no-build static page** at `docs/`, served from **GitHub Pages on the instructor's public template repo**, fed by a **local file drop** (`.hex` *or* the Actions `.zip`, unzipped in-browser via `DecompressionStream('deflate-raw')`). Add **one `arm-eabi-objcopy -O ihex` step** to CI — which is a prerequisite for drag-and-drop too, and is the single highest-value change here.

## Decisions

1. **dapjs over microbit-connection.** dapjs = one 39 KB self-contained UMD `<script>`, no build step, no npm, no node_modules in a teaching repo. microbit-connection is ESM-only → forces Vite/npm/CI-to-Pages. Also microbit-connection is shaped around MakeCode/Python-editor workflows (universal hex, partial flashing) that don't apply to a GNAT ELF.
2. **One instructor-hosted page, not per-student Pages.** Works identically for **private** student repos. Nobody has to enable Pages. `has_pages` flips once, on `aiunderstand/Ada-Embedded-Project-MicroBitV2`, Settings → Pages → branch `main`, folder `/docs`.
3. **Local file drop is the only universally-working transport.** Actions artifacts need auth; Release assets need auth on private repos. Route (ii) is offered as an opt-in `?hex=<url>` for public repos, with a CORS caveat.
4. **Accept the `.zip` directly.** Actions always hands students a zip. Chrome-only is already a given, so `DecompressionStream('deflate-raw')` is free — a ~45-line zip reader removes a real support-generating step. Round-trip tested byte-exact.
5. **Plain Intel HEX, not Universal Hex.** Universal Hex exists only to carry v1+v2 in one file. This build is `embedded-nrf52833` / `microbit_v2_full.gpr` — v2-only.
6. **HEX only, no `.bin`.** Hex is gap-safe and is what DAPLink's parser wants.
7. **No browser debugger.** dapjs has no `step` and no `setBreakpoint`; you'd implement FPB comparators and DHCSR C_STEP yourself, then DWARF parsing for source lines. `arm-eabi-gdb` + `pyocd gdbserver` already ships in the toolchain. Build flash + console only.

## Landmines encoded in the code

- `firmware.bytes.slice().buffer` — dapjs `flash()` does `isView(b) ? b.buffer : b`. A `subarray` from the zip reader would send the **whole backing store**. `.slice()` forces exact length at offset 0.
- `startSerialRead()` is an **infinite loop** returning a promise — never `await` it.
- `startSerialRead(50, false)` with `autoConnect: false`, and we **never disconnect after flashing** — otherwise it SWD-connects/disconnects 20×/sec.
- `stopSerialRead()` before flash, restart after.
- Use `0x04` literal for `CMSIS_DAP_FW_VERSION`, not `DAPjs.DAPInfoRequest.*`.
- `#unsupported` visible by default in HTML, `#app` `hidden` by default → if JS dies entirely, students still see the drag-and-drop fallback.

## Files

- create `docs/index.html`, `docs/flasher.js`, `docs/vendor/dap.umd.js` (sha256 `1c70fd51…db3f1`), `docs/.nojekyll`
- modify `.github/workflows/ada.yml` (objcopy + hex artifact + job summary)
- modify `README.md` (flashing section)

## Deferred / colliding with other features

`.vscode/tasks.json` could gain a "Build + HEX" task, but that file is being rewritten by the tasks.json feature (the `zsh -c 'source /root/.zshrc'` bug). Sequence after it.
