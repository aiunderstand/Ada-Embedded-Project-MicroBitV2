# Feature 2 — Build orchestration (one tasks.json, any example, no folder switching)

## Verified this session (on this Mac, gprbuild 25.0.0 + gnat_arm_elf 15.1.2)

- `gprbuild -P <example>.gpr --relocate-build-tree=<root>/build/obj --root-dir=<root>` builds
  `ravenscar/buttons` **from the repo root** and writes **nothing** into the working tree.
  `git status` (root and submodule) stayed empty after two builds.
- Artefact lands at `build/obj/<gpr dir relative to root>/obj/main`.
- The relocated board library `boards/MicroBit_v2/obj/full_lib_Debug/libada_drivers_library.a`
  is **shared** across every project using the same relocate root: after buttons,
  a full `Code/itrs.gpr` build took **0.24 s**.
- `arm-eabi-objcopy -O ihex|binary` produces valid `main.hex` / `main.bin`.
- All 42 example `.gpr` are uniform: `Object_Dir "obj"`, `Source_Dirs ("src")`,
  `Main ("main.adb")`, exactly one `.gpr` per directory.
- The AdaCore extension (`adacore.ada-2026.3`) ships `schemas/als-settings-schema.json`
  for `.als.json` with keys `projectFile`, `relocateBuildTree`, `rootDir`, and a
  `**/.als.json` FileSystemWatcher that proposes a language-server restart on change.
- `ada.gprProjectArgs` is a real (non-palette) command; `als-reload-project` exists.
- **All 15 zfp examples are dead on any modern toolchain**: they ask for runtime
  `zfp-cortex-m4f`, renamed to `light-cortex-m4f` years ago; 4 of them also have
  Windows backslash `with` paths that fail to parse on macOS/Linux; all 15 pass a
  backslash `-T .../link.ld` to the linker. `boards/MicroBit_v2/microbit_v2_zfp.gpr`
  also declares `zfp-cortex-m4f`.
- No `.svd` files are tracked (submodule `.gitignore` has `*.svd`) → no `svdFile` in launch.json.

## Design

`tools/mb.py` is the single entry point. `build/` is the single output dir.
`build/target.json` is the pinned selection; `.als.json` (gitignored) points ALS at it.
One root `.vscode/tasks.json` (9 tasks, `type: process`, per-OS python), one static
`launch.json` on `build/main.elf`. The 27 submodule `.vscode` dirs get removed in the
fork; that removal is cleanliness, **not** a prerequisite — mb.py ignores them.

Details are in the structured answer returned to the orchestrator.
