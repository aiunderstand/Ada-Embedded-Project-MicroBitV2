# Modernising the Ada / micro:bit v2 student template

## Context

`aiunderstand/Ada-Embedded-Project-MicroBitV2` is a **public GitHub template** that Bachelor CS
students instantiate to write Ada for the BBC micro:bit v2 (nRF52833, Cortex-M4F). The goal is that
a student can go from "click Use this template" to "LED blinking" with as close to zero setup
friction as possible, on macOS, Linux, Windows, or entirely in the browser.

Today that goal is not met. Five problems were raised:

1. The README setup is long, manual and error-prone (hand-editing `PATH`, rebooting the machine).
2. Building an example requires closing the VS Code folder and reopening at another root; 27
   `tasks.json` files have been sprinkled around to work around it.
3. The tasks themselves are not platform-agnostic — macOS or Windows builds break and get hand-patched.
4. There is no regression protection.
5. Browser-based flashing/debugging (as MakeCode has via WebUSB/WebSerial) does not exist.

A sixth goal was added during planning: **ship SPARK examples**, proved with `gnatprove`, so the
course ladder becomes build → flash → test → prove.

Investigation confirmed all five problems, and found that several are worse than assumed. The
verified findings below are the basis for the plan.

---

## Verified findings

*Everything in this section was checked against the working tree, the live Alire index, the GitHub
API, and vendor documentation during planning. These are facts, not assumptions.*

### Repository shape

- First-party tree is tiny: `Code/itrs.gpr`, `Code/src/main.adb` (the only first-party Ada source),
  `.vscode/`, `.devcontainer/devcontainer.json`, `.github/workflows/ada.yml`, `README.md`.
- Everything else is one git submodule, `Code/libs/Ada_Drivers_Library` →
  `aiunderstand/Ada_Drivers_Library` @ `2a5119c7`. **This is a fork the maintainer owns**, which is
  what makes fixing it feasible. It holds 153 `.gpr` files; 42 are micro:bit v2 examples
  (27 `ravenscar/`, 15 `zfp/`).
- There are **zero `alire.toml` files anywhere**. Alire is used only as a manual toolchain
  *downloader*; every build is raw `gprbuild` relying on a hand-edited global `PATH`. That single
  fact is the root cause of the entire "edit your PATH and reboot" section of the README.

### Why Mac and Windows builds break (problem 3 — root cause found)

- **All 15 `zfp` examples contain hard-coded Windows backslash paths**; 14 of them in the linker
  script argument itself:
  `for Switches ("ada") use ("-T", "..\..\..\..\boards\MicroBit_v2\src\zfp\link.ld", ...)`.
  On macOS/Linux those backslashes are literal filename characters, so the link fails.
  (`zfp/motor_drive_calibration` uses forward slashes there but still has backslashes in its `with`
  clause — and the relative depth is measured from the *object* dir, so it is short by one level
  regardless.) This is exactly the "adjust the files for that platform" churn.
- **No micro:bit v2 example sets `Create_Missing_Dirs`**, and the VS Code Build task does not pass
  `-p`, so a first build in a clean checkout can fail on a missing `obj/`. (The MicroBit v1 and
  NRF52_DK examples *do* set it — the v2 ones regressed.)
- Two ravenscar examples (`motor_drive_dfr0548/default.gpr`, `pin_interrupt_example/pin_interrupt.gpr`)
  use `limited with` instead of `with` for the board library.
- `boards/MicroBit_v2/microbit_v2_sfp.gpr` points at `src/sfp/`, **which does not exist** — the
  project is unbuildable and referenced by nothing.
- `testsuite/tests/bitbang_PWM_microbit_v2/bitbang_pwm.gpr` hard-codes an absolute developer path
  (`C://Users//maxde//...`).
- No `.gitattributes` at the repo root, so Windows students get CRLF checkouts of `.adb`/`.gpr` with
  no normalisation.

### Why the root build task is devcontainer-only (problem 3, second cause)

`.vscode/tasks.json` "Build" is:

```json
{"type":"shell","command":"zsh -c 'source /root/.zshrc && gprbuild -P Code/itrs.gpr Code/src/main.adb -cargs:ada -gnatef'"}
```

`zsh` and `/root/.zshrc` exist only inside the devcontainer. **`Ctrl+Shift+B` on a native Windows or
macOS host fails outright**, while the README still presents native setup as the primary path.
Git history shows commit `6362cd2` replaced a previously portable `"type":"ada"` task with this.
The 27 example `tasks.json` still use the portable form.

### The 28 `.vscode` directories (problems 2 and 3)

- 1 at the root, 27 inside the **submodule** under `examples/MicroBit_v2/ravenscar/**`.
- All 27 `tasks.json` are byte-identical to each other; likewise all 27 `launch.json` and all 27
  `settings.json`. So there are only **two distinct variants**, not 28 — the cleanup is far smaller
  than it looks.
- All 27 example `launch.json` are **broken**: they set
  `"executable": "${workspaceFolder}/Code/obj/main"` (copy-pasted from the root) but examples build
  to `obj/main`. F5 debugging fails for every example.
- The 15 `zfp` examples have no `.vscode` at all.

### Devcontainer (problem 1)

- **`postCreateCommand` hard-codes `cd /workspaces/Ada-Embedded-Project-MicroBitV2`.** Because this
  is a *template*, every student's repo has a different name, so the `cd` fails, the `&&` chain
  aborts, and neither the submodule nor the toolchain is ever installed. **This breaks the
  devcontainer for essentially every student.**
- There is **no Dockerfile**. The full ~1 GB toolchain install (apt + pip + Alire + `alr toolchain`)
  runs at container-create time on every fresh container/Codespace. Nothing is cached in a layer.
- The toolchain selection is unpinned (`alr toolchain --select gnat_arm_elf gprbuild`), so it drifts
  to whatever the index resolves to today.
- `PATH` is written only to `/root/.zshrc`, which is precisely why the root task needs the `zsh -c`
  hack.
- Git history: added 2025-09-03 and edited ~35 times in one week via the GitHub web editor, all
  fighting USB passthrough and a submodule-init race.

### CI (problems 4 and 5)

- `.github/workflows/ada.yml` builds **only** the template stub, on ubuntu x86_64 only, with no
  caching. **None of the 42 examples is ever compiled**, so every defect listed above is invisible
  to CI.
- **The uploaded artifact `Code/obj/main` is a bare ELF.** micro:bit v2 DAPLink mass-storage
  drag-and-drop accepts Intel HEX or raw `.bin` — **not ELF**. Verified by grep that *nothing in the
  entire repo runs `objcopy` or produces a `.hex`*. The "download the artifact and drag it onto the
  MICROBIT drive" flow therefore cannot work as described; an `objcopy -O ihex` step is missing.
- Version drift across the three provisioning paths: README says gnat_arm_elf 14.1.3+ / gprbuild
  22.0.1+; CI pins 14.2.0-1 / **22.0.0-1 (below the README's own stated minimum)**; the devcontainer
  is unpinned latest.
- The submodule carries a byte-identical **copy** of this workflow that references `Code/itrs.gpr`,
  a path that does not exist there — permanently broken, and it displaced upstream ADL's own
  example-building CI.
- Existing test infrastructure in the submodule is unused and broken: `scripts/build_all_examples.py`
  imports `distutils` (removed in Python 3.12+, and the devcontainer installs 3.13.7), has stale
  paths for this fork's `zfp/`+`ravenscar/` reorganisation, and has a missing-comma bug that
  silently concatenates two project paths. `testsuite/run.py` (9 native golden-output tests) is
  invoked by nothing.

### Verified on this machine (`gnat_arm_elf_15.1.2`, Apple Silicon)

These were checked directly against the installed toolchain, not inferred:

- **`zfp-cortex-m4f` no longer exists.** GNAT renamed the `zfp-*` runtimes to `light-*`; the
  toolchain ships 71 runtimes and not one contains "zfp". **All 15 `zfp` examples therefore cannot
  build on any modern toolchain at all**, independently of the backslash-path bug. They need
  `for Runtime ("ada") use "light-cortex-m4f";`. Half the example set is dead and nobody noticed,
  because CI never builds examples.
- `embedded-nrf52833` **is** bundled (so the template and the 27 ravenscar examples are fine, and
  moving to 15.x is safe — the runtime is not unbundled at this version).
- `light-nrf52833` is present, so `microbit_v2_sfp.gpr` would work if its missing `src/sfp/` existed.
- **The objcopy binary is `arm-eabi-objcopy`, not `arm-none-eabi-objcopy`** — the toolchain prefix is
  `arm-eabi-`. It is present, so producing a `.hex` needs no new tooling.
- `arm-eabi-gcc` is a **native arm64 Mach-O binary** — Apple Silicon already runs the toolchain
  natively, no Rosetta.
- Installed locally: `alr` 2.1.0, `gprbuild` 25.0.1, `gnat_arm_elf` 15.1.2, `pyocd`, Docker.
  Note this is **15.1.2 while CI pins 14.2.0** — another instance of the version drift.

### Toolchain availability (enables the Docker plan)

- `alr` 2.1.1 ships binaries for x86_64/aarch64 on Linux, macOS and x86_64 Windows.
- **From `gnat_arm_elf` 14.2.1 onward the Alire index has native origins for `linux/aarch64` and
  `macos/aarch64`.** So Apple Silicon and `linux/arm64` containers run natively — **no Rosetta, no
  QEMU emulation**. Older versions were x86_64-only, which is the likely source of past Mac pain.
- Caution: `embedded-nrf52833` is currently a runtime *bundled inside* the gnat-arm-elf 14.2.0
  tarball (CI is green, which proves it). Alire also publishes standalone `embedded_nrf52833`
  runtime crates, but only from 15.2.0, and those are *source* runtimes requiring the `.gpr` to
  `with "ravenscar_build.gpr"` and use `Runtime_Build'Runtime`. **Bumping the compiler past 14.x may
  unbundle the runtime and break the build.** Pin versions deliberately.

### Version choices (all confirmed against the live index / build specs)

- **`gnat_arm_elf` 16.1.0 is safe.** `specs/embedded-runtimes.anod` at `16.1.0-1` lists `nrf52833`
  **and** `cortex-m4f` in the arm-elf board list, so `embedded-nrf52833` (template + 27 ravenscar
  examples) and `light-cortex-m4f` (the zfp fix) are both bundled. The `zfp-*` names are gone for
  good — confirming the rename rather than a packaging accident.
- **`gprbuild` must be 25.0.1, not 22.0.1.** `gprbuild-22.0.1` has origins for linux/x86-64,
  macos/x86-64 and windows/x86-64 **only — no aarch64 of any kind**. Pinning it would break the
  Apple Silicon native path and both arm64 container legs. 25.0.1 is the first with all five
  platforms, and is already installed here.
- **`gnatprove` 16.1.0 has all five platforms**, including `linux/aarch64` and `macos/aarch64`
  (older 13.x/14.x lack linux-aarch64). It version-matches the chosen compiler.

### PR #6 on the fork already contains the right zfp fix

`aiunderstand/Ada_Drivers_Library` **PR #6 "Microbit v2 dp"** (by `danieleperi`, mergeable, clean)
independently arrives at exactly the fix pattern the MicroBit **v1** examples already use:

- `microbit_v2_zfp.gpr`: `zfp-cortex-m4f` → **`light-cortex-m4f`**
- examples: `for Runtime ("Ada") use MicroBit_v2_ZFP'Runtime ("Ada");` instead of hardcoding
- examples: `MicroBit_v2_ZFP.Linker_Switches & (…)` instead of the hardcoded backslash `-T` path
- `with "..\..\..\..\…"` → forward slashes

**But it only covers 4 of the 15 zfp examples** (accelerometer, music, BLE_beacon, text_scrolling).
The other 11 need the identical mechanical treatment — with PR #6 as the reference.

### Browser flashing (problem 5)

- micro:bit v2 DAPLink (firmware 0249+) exposes CMSIS-DAP over WebUSB. Chrome/Edge/Opera only; no
  Safari, no Firefox; secure context required.
- Full-hex WebUSB flashing is **program-agnostic** — it flashes any Intel HEX, so it works with
  GNAT output. MakeCode's *partial* flashing is **not** applicable (it depends on the MakeCode
  DAL/user-program flash layout and a BLE service).
- Cloud Codespaces have **no USB passthrough**, so the container can never flash — but a browser tab
  on the student's own laptop can. A static web page is therefore the only route for Codespace users.
- The repo is `is_template: true`, `visibility: public`, `has_pages: false`. Pages is free for
  public repos.

---

## Decisions taken

| Decision | Choice |
|---|---|
| Where examples live | **Stay in the `Ada_Drivers_Library` fork submodule.** Fixes go to the fork, then the pointer is bumped. |
| Build driver | **Full Alire** — an `alire.toml` crate at the root, `alr build` for the template. |
| Toolchain pin | **`gnat_arm_elf` 16.1.0 + `gprbuild` 25.0.1 + `gnatprove` 16.1.0.** |
| zfp examples | **Merge fork PR #6**, then apply the same pattern to the remaining 11. |
| Container role | **Build-only, with a tiered flashing story** (see the flashing matrix below — this answers the `usbipd-win` question). |
| Browser | **Web Serial console first, WebUSB flasher second.** |
| Flasher hosting | **Both** — one shared instructor-hosted page, plus optional per-repo GitHub Pages deploy. |
| Formal verification | **Add a `spark/` example family** proved with `gnatprove` — build → flash → test → **prove**. |
| SPARK examples location | **`examples/MicroBit_v2/spark/` in the fork**, a sibling of `zfp/` and `ravenscar/`. |
| Native GNAT | **Welcome, not waste.** Some students dabble in desktop Ada, so Alire pulling `gnat_native` is a feature. |

### The two key mechanisms

**1. Alire supplies the environment.** `alr exec` (confirmed present in the installed `alr` 2.1.0)
*"sets up the environment variables (GPR_PROJECT_PATH, PATH, etc.) and then spawns the given
command"*. The template itself builds with `alr build`; examples — which are not crates — build with
`alr exec -- gprbuild -P <example>.gpr`. Either way **no global `PATH` editing and no reboot**, so
the whole README section disappears on all three OSes (problem 1).

**2. `--relocate-build-tree` builds any example from the repo root.** A verifier *executed* this:
all 27 ravenscar examples built from the repo root in **9 seconds** into a shared relocated tree,
with the working tree left byte-clean.

```
alr exec -- gprbuild -j0 -p -P <example>.gpr \
    --root-dir=. --relocate-build-tree=build/obj -cargs:ada -gnatef
```

- The workspace root never changes → **no closing and reopening the folder** (problem 2), and the 27
  duplicate `tasks.json` become unnecessary rather than something to maintain.
- Object files land in `build/obj/…` instead of scattering `obj/` dirs through the submodule, so
  `git status` stays clean in both repos.
- `-p` also covers the missing `Create_Missing_Dirs` on every example.
- Combined with VS Code `"type": "process"` (no shell at all), there is no `zsh`/`cmd`/PowerShell
  quoting left to differ per platform (problem 3).

Firmware is always copied to **`build/main.elf` / `.hex` / `.bin`** regardless of which project was
built, which makes `launch.json` a single static config and the CI artifact a stable name.

A thin `tools/mb.py` owns the picker, the relocate flags, the objcopy and flash/erase — but it
**shells out to `alr`** and never guesses toolchain paths itself.

**Native GNAT is wanted, not a cost.** The main objection raised against full Alire was that a fresh
machine may also download `gnat_native`. Since some students dabble in desktop Ada, that is a
feature: `alr toolchain --select` can install `gnat_native` alongside `gnat_arm_elf`, and a student
who runs `alr init` for a desktop project gets a working native compiler with no extra setup. The
template crate itself depends on `gnat_arm_elf`, so the cross compiler is what builds the firmware.

> Note the two cannot both be listed in `[[depends-on]]` — `gnat_native` and `gnat_arm_elf` each
> `provide` `gnat`, so declaring both in one crate is an unsolvable conflict. The cross compiler is
> the crate dependency; the native one comes from the machine-wide toolchain selection.

> **Small spike (Phase 1).** Confirm the AdaCore extension behaves with an `alire.toml` present —
> it may contribute duplicate build tasks or lose the project if a solve fails. If it bites, the
> fallback is `alr exec -- gprbuild` for the template too, which leaves the rest of this plan
> unchanged.

---

## Plan

Sequenced so every phase leaves the repo working, highest-pain/lowest-risk first. Phases 0–3 fix
roughly 90% of the student-facing pain and need **no submodule change at all** — that is the key
sequencing insight, and it is why the fork work is never a prerequisite for the build fixes.

**Two phases touch the fork, and they should be batched:** Phase 6 (cleanup + PR #6) and Phase 4
(the new `spark/` family). Do **Phase 6 before Phase 4** so the new examples are written against a
clean fork, with the inherited-`Runtime`/`Linker_Switches` pattern already established to copy. The
numbering below is by theme, not by execution order; the recommended order is
**0 → 1 → 2 → 3 → 6 → 4 → 5**.

### Phase 0 — Emit a flashable `.hex` (half an hour, zero risk)

The highest-value change in the plan, and independent of everything else. **Merge it on its own.**

Files: `.github/workflows/ada.yml` (modify), `README.md` (modify). Keep the workflow *filename* so
the badge URL never changes.

```yaml
- name: Convert ELF to Intel HEX
  run: |
    arm-eabi-objcopy -O ihex   Code/obj/main Code/obj/main.hex
    arm-eabi-objcopy -O binary Code/obj/main Code/obj/main.bin
    test -s Code/obj/main.hex
    head -c 1 Code/obj/main.hex | grep -q ':'
    tail -n 1 Code/obj/main.hex | grep -q '^:00000001FF'
```

Upload `main.hex`, `main.bin` and the ELF. Note the prefix is **`arm-eabi-objcopy`**, not
`arm-none-eabi-objcopy`.

Do *not* also assert a single `^:02000004` record — objcopy emits one extended-linear-address record
per 64 KiB, so a normal image already has several.

**Exit:** dragging `main.hex` onto the MICROBIT drive runs the program; dragging the bare ELF
produces `FAIL.TXT` (which is what students get today).

### Phase 1 — Alire crate, platform-agnostic build, no folder reopening

The main event. Kills the `zsh`/`/root/.zshrc` task, the close-and-reopen workflow, and the README
PATH section together.

**Run the Alire spike first** (see above) before committing to `alr build`.

| File | Action |
|---|---|
| `alire.toml` | **create** — the crate + the single source of truth for the pin |
| `tools/mb.py` | **create** (~200 lines) — picker, relocate flags, objcopy, flash/erase; shells out to `alr` |
| `tools/known_failures.txt` | **create** — quarantines the 15 zfp examples until Phase 6 |
| `.vscode/tasks.json` | rewrite |
| `.vscode/launch.json` | rewrite — one static config |
| `.vscode/settings.json` | modify — **remove `ada.projectFile`** |
| `.als.json` | **create**, committed — `{"projectFile": "Code/itrs.gpr"}` |
| `.gitattributes` | **create** (+ `git add --renormalize .` in the same commit) |
| `.gitignore` | add `build/` |
| `Code/src/main.adb` | delete the stale "runtime profiles" header comment |
| `README.md` | replace the whole PATH section with a 5-step install |

```toml
name = "itrs"
version = "1.0.0"
description = "USN ITRS project template for the BBC micro:bit v2"
project-files = ["Code/itrs.gpr"]
auto-gpr-with = false

[[depends-on]]
gnat_arm_elf = "=16.1.0"
gnatprove    = "^16.1"      # Phase 4

[configuration]
disabled = true             # no generated config .gpr; itrs.gpr is hand-written
```

`gprbuild` is pinned to **25.0.1** via `alr toolchain --select` (22.0.1 has no aarch64 build at all).
The same selection also installs **`gnat_native`**, so a student who wants to try desktop Ada can
`alr init` a project and build it with no further setup.

**`mb.py` scope:** `list`, `build [--use ID | --use-dir DIR] [--all]`, `flash`, `erase`, `prove`,
`clean`, `doctor`, `als`. Design constraints, all from review findings:

- `--all` uses `known_failures.txt` with XFAIL/XPASS semantics — a quarantined example that starts
  passing **fails** the run, so the list can only shrink.
- Skip `.gpr` files with no `for Main`, and anything under `boards/`, then walk to the parent —
  otherwise "build the file I'm looking at" tries to build the board *library* and dies with
  "no executable was found".
- `doctor` exits 0 when only flash/debug tools are missing (pyocd, gdb), non-zero only for
  build-critical ones. Test the real command's status, not a pipeline's last stage.
- `flash` must detect "no probe" and print *"Built OK. No debug probe here (Codespace?) — download
  `build/main.hex` and drag it onto the MICROBIT drive"* rather than a stack trace.
- Guard `shutil.rmtree` to paths under the repo. Use `p.relative_to(REPO).as_posix()`.

**`tasks.json` — all `"type": "process"`**, `command: python3` with `"windows": {"command": "python"}`,
`cwd: ${workspaceFolder}`, and `problemMatcher: ["$ada-error", "$ada-warning"]`.

> **`$ada` is not a real problem matcher** — the extension contributes only `ada-error`,
> `ada-warning` and `ada-info`. The current file uses `$ada`, so the Problems panel is empty and
> VS Code toasts an error on every build. Three of the five designs copied this bug forward.

Tasks: `Build & Flash` (default) · `Build` · `Choose project…` (`${input:project}` pickString) ·
`Use the file I'm looking at` (`${fileDirname}`) · `Prove` · `Erase` · `Doctor`.
`${fileDirname}` is deliberately **not** the default — with no editor focused VS Code refuses to run
the task at all with "Variable ${fileDirname} can not be resolved".

**`launch.json`:** one cortex-debug config, `"executable": "${workspaceFolder}/build/main.elf"`. F5
then debugs whatever was last built, which makes the 27 broken example `launch.json` files
*irrelevant* rather than something to fix. Verify GDB still resolves sources against the copied ELF.

**`.als.json` committed, static.** With `ada.projectFile` removed and no `.als.json`, a fresh clone
would open with no Ada project at all and red squiggles everywhere — strictly worse than today.
A separate `mb.py als --use <id>` repoints it, writing only when content actually changes (the
extension watches `**/.als.json` and pops "restart language servers" on every write). Requires
`AdaCore.ada` ≥ 26.0.202412190; if it misbehaves, fall back to `ada.projectFile` and drop
ALS example-switching — builds are unaffected either way.

**README:** delete the PATH editing, the reboot instruction and the "a mistake will prevent your
terminal from running `ls`" warning. Also remove *"Decline any question of VScode trying to be
helpful"* — declining Workspace Trust disables the Ada extension.

**Exit:** with nothing on `PATH`, `mb.py doctor` finds the toolchain and names the version;
`Ctrl+Shift+B` builds; *Choose project…* → `ravenscar/buttons` builds **and flashes without closing
the folder**; `git status --porcelain -uall` is empty in root **and** submodule.

### Phase 2 — Devcontainer / Codespaces fixes (~15 lines of JSON)

No Dockerfile, no GHCR image — see "not worth doing".

Files: `.devcontainer/devcontainer.json` (modify), `tools/udev/50-microbit.rules` (create).

1. **Delete the hardcoded `cd /workspaces/Ada-Embedded-Project-MicroBitV2`.** Nothing replaces it —
   lifecycle commands already run in `${containerWorkspaceFolder}`.
2. **Delete the trailing `|| true`.** It binds the *whole* preceding `&&` chain, so the container
   always reports a clean create with no toolchain and no submodule. That is why this bug survived
   ~35 commits.
3. Move `git submodule update --init --recursive` to `onCreateCommand`/`updateContentCommand` —
   `postCreateCommand` does not run during a Codespaces prebuild.
4. Pin: `alr --non-interactive toolchain --select gnat_arm_elf=16.1.0 gprbuild=25.0.1`.
5. Install `alr` to `/usr/local/bin`, not `/workspaces/alr`.
6. **`PATH` via `remoteEnv`/`containerEnv`**, not `/root/.zshrc` — cortex-debug spawns
   `arm-eabi-gdb` and `pyocd` directly and never sources a shell rc, so F5 is broken in the
   container today even once the build is fixed.
7. Remove `ada.projectFile` from `customizations.vscode.settings` too, or it overrides `.als.json`
   in every Codespace.
8. Pin **pyocd ≥ 0.44** (0.36 pins `capstone<5.0`, which has no aarch64 and no cp312 wheels).
9. Ship `tools/udev/50-microbit.rules` for the **host** — the rule the container writes into its own
   `/etc/udev/rules.d` has always been a no-op, because udev runs on the host.
10. Add `git config --global --add safe.directory '*'` — the workspace is checked out by a different
    uid, so the submodule update would otherwise refuse with "dubious ownership".

**Exit:** "Use this template" into a *differently-named* repo → Codespace initialises the submodule
and `Ctrl+Shift+B` builds. This fails today at the first `cd`.

### Phase 3 — CI and the regression set

One workflow file, so the badge URL never changes:

```yaml
build:     # runs everywhere INCLUDING student repos — the only student-facing job
matrix:    # if: github.repository == 'aiunderstand/...'  → ubuntu, macos (arm64), windows
examples:  # if: maintainer → python tools/mb.py build --all   (27 PASS, 15 XFAIL)
renamed:   # if: maintainer → checkout into My-Student-Project-2026 and build from there
lint:      # if: maintainer → grep: no zsh//root/.zshrc in .vscode, no repo name in .devcontainer
```

Everything except `build` is gated on the repository name. **Template instances are not forks**, so
`schedule:` crons are *not* auto-disabled in student copies, and on a private student repo minutes
bill Linux 1× / Windows 2× / **macOS 10×** — two macOS legs per push would lock a student out of
Actions in about ten commits for failures unrelated to their code.

Toolchain install for the matrix legs:

```bash
alr settings --global --set toolchain.dir "$RUNNER_TEMP/adl-toolchain"   # removes all OS branching
alr settings --global --set msys2.do_not_install true                    # Windows: else alr installs msys2
alr --non-interactive toolchain --select gnat_arm_elf=16.1.0 gprbuild=25.0.1
```

Cache that directory **and `~/.config/alire`** (the index clone and selection state, else every run
re-clones the index even on a cache hit). Budget honestly: the pinned pair is ~2 GB extracted.

Do **not** use `alire-project/setup-alire@v4` — that tag does not exist (v1, v6 and `latest` do).
Use `test -z "$(git status --porcelain -uall)"` for cleanliness guards, since `git status` always
exits 0.

Also apply: **remove the CI badge** (it reports *your* build status inside every student repo — point
at their own Actions tab instead) and **pin the submodule for the semester** (Dependabot's daily
bumps also ship to students and can move the submodule under them mid-course).

**Exit:** all matrix legs green (macOS is the first-ever aarch64 exercise); `examples` reports
`27 PASS, 15 XFAIL`; un-quarantining a working example turns it XPASS and *fails* the job;
a fresh private template instantiation runs exactly one job.

### Phase 4 — SPARK examples (a third example family)

The goal is **teaching material**: a `spark/` family sitting alongside `ravenscar/` and `zfp/`, so
the ladder becomes **build → flash → test → prove**. `gnatprove` is the tool; the examples are the
deliverable.

**Toolchain.** `gnatprove = "^16.1"` in `alire.toml`. It version-matches the compiler and has all
five platform origins **including `linux/aarch64`**, so it works on Apple Silicon, arm64 CI and the
container. (13.x/14.x lack linux-aarch64 — another reason the 16.1.0 pin is the right one.)
`mb.py prove [--use ID]` → `alr exec -- gnatprove -P <project>.gpr -j0 --report=all`, plus a
**Prove** task and a CI job. No new install for students: Alire fetches it like everything else.

**The one design constraint that decides everything: the ADL is not SPARK.** Proving a whole example
that touches `MicroBit.Display` or the nRF SVD bindings will drown a first-year in noise. Every
example therefore uses the standard boundary pattern:

- a **pure, provable core** — `SPARK_Mode => On`, no hardware, all contracts;
- a **thin hardware shell** — `SPARK_Mode => Off`, calls the ADL, does I/O;
- `main.adb` wires the two together.

That boundary is itself the lesson, and it is what makes the examples provable at all.

**Proposed examples**, each mirroring an existing non-SPARK example so students can diff them:

| Example | Mirrors | What is proved |
|---|---|---|
| `spark/bounded_queue` | `containers` | No overflow/underflow; `Pre`/`Post`; type invariant on the buffer |
| `spark/saturating_math` | `math_functions` | Absence of run-time errors; no overflow in fixed-point scaling |
| `spark/line_follower` | `tasking_project_linetracker` | Controller core proved; sensor/motor shell is `SPARK_Mode => Off` |
| `spark/sense_think_act` | `tasking_project_sense_think_act` | Protected-object invariants; Ravenscar/Jorvik tasking, no data races |

Start with the first two — they prove cleanly at `--level=1` and need no tasking.

**Ladder the effort, do not start at `--level=4`:**
`--mode=flow` first (fast; catches uninitialised variables, aliasing and missing `Global` contracts,
and is the right first lesson), then `--mode=prove --level=1`, and only then higher levels on the
one or two examples that warrant it. Record the intended level per example in its README.

**CI.** A `prove` job running `mb.py prove --all-spark`, asserting **0 unproved checks** on this
family. That number is the regression gate — a contract that silently stops proving is exactly the
kind of rot this whole plan exists to catch. Keep it **report-only on the student-facing job** so a
half-finished proof never blocks a student's build.

> **Spike before writing the examples:** confirm `gnatprove` accepts a cross project
> (`for Target use "arm-eabi"`, `for Runtime ("ada") use "embedded-nrf52833"`). SPARK analysis is
> target-independent, but the project must be parseable and gnatprove may need `--RTS`/target
> arguments passed through. Prove one trivial package before investing in four examples.

**Where they live: `examples/MicroBit_v2/spark/` in the fork**, a sibling of `zfp/` and `ravenscar/`.
The three families then read as the three runtime/assurance levels of the course, and `mb.py list`
picks them up by discovery with no extra wiring.

**Sequencing consequence:** this phase lands in the fork, so it shares the commit-then-bump mechanics
of Phase 6. Do the **Phase 6 fork work first** (or at least merge PR #6), so the fork is already
clean and the inherited-`Runtime`/`Linker_Switches` pattern is established for the new `spark/`
projects to copy. Authoring these against a fork that still has 15 broken `zfp` examples would make
`mb.py build --all` results hard to read while the family is being written.

### Phase 5 — Browser: Web Serial console, then the WebUSB flasher

**Increment A — Web Serial console (~60 lines, no library).**
`docs/index.html` + `docs/.nojekyll` + a Pages workflow.
`navigator.serial.requestPort({filters:[{usbVendorId:0x0d28}]})` at 115200, appending into a `<pre>`
**with a size cap** — a naive `textContent +=` on a poll is O(n²) and will pin the tab for anyone
printing in a loop, which is exactly what the verification step asks them to do.
This claims the DAPLink **CDC** interface, *not* CMSIS-DAP, so it does **not** contend with pyocd.
Mandatory Linux note: `dialout` group membership, and snap Chromium cannot do Web Serial at all —
detect it and print the remedy rather than a raw `DOMException`.

**Increment B — WebUSB flasher.** Use the micro:bit Foundation's **`microbit-connection`**
(maintained, updated May 2026), not `dapjs` (no release since Dec 2020). Have CI publish a **raw
`firmware.hex`** to Pages so the page never needs to parse an Actions artifact `.zip`. Flash with a
progress bar; document that WebUSB holds the CMSIS-DAP interface while connected, so pyocd cannot be
used at the same time.

Deploy with an **Actions** workflow (`checkout` with `submodules: false` → `upload-pages-artifact
path: docs` → `deploy-pages`), **not** branch deployment: branch deploys run a recursive submodule
init, and this pointer is not a branch tip — a documented failure mode, and pure waste for a small
page. Gate the deploy on the repository name.

Hosting, as chosen: **both** — one shared instructor-hosted page that accepts a drag-dropped `.hex`
(works for everyone, including students whose repos are private, where Pages is not free), plus the
optional per-repo deploy carrying that student's own freshly built firmware.

**Scope honestly:** full-hex WebUSB flashing is program-agnostic and works fine with GNAT output.
MakeCode's *partial* flashing does **not** apply — it depends on the MakeCode DAL/user-program flash
layout and a BLE service. Chrome/Edge/Opera only, secure context; no Safari, no Firefox; drag-and-drop
`.hex` is the fallback. This is the only flashing route for a student working purely in a Codespace.

### Phase 6 — Submodule cleanup (fork PR + pointer bump)

Only after 0–3 are green, in separate commits so a bisect stays useful. In
`aiunderstand/Ada_Drivers_Library`:

1. **Merge PR #6 "Microbit v2 dp"** — it is mergeable and clean, and already does the right thing:
   `light-cortex-m4f`, inherited `Runtime`/`Linker_Switches`, forward slashes. It covers
   **accelerometer, music, BLE_beacon, text_scrolling**.
2. **Apply PR #6's exact pattern to the remaining 11 zfp examples** (analog_in, analog_out, buttons,
   digital_in, digital_out, motor_drive_calibration, motor_drive_dfr0548, motor_drive_four_wheels,
   servos, ultrasonic, wireless_radio). Mechanical, with a worked reference in the same repo.
3. Fix the 2 ravenscar `limited with` → `with`.
4. Delete `microbit_v2_sfp.gpr` (references a `src/sfp/` that does not exist; used by nothing) and
   the absolute `C://Users//maxde//…` path in `bitbang_pwm.gpr`.
5. **Delete `.github/workflows/ada.yml`** from the fork — a byte-identical copy referencing
   `Code/itrs.gpr`, a path that does not exist there, so it is permanently red, and it displaced
   upstream ADL's own example CI.
6. Delete the 27 `.vscode` dirs — cosmetic by now, since the root tasks already ignore them.

Then bump the pointer **and delete the zfp entries from `known_failures.txt` in the same commit** —
the XPASS rule fails CI if you forget, which is the design working.

With the fork clean, **Phase 4's `spark/` family is written next**, as a sibling of `zfp/` and
`ravenscar/`, reusing the inherited-`Runtime`/`Linker_Switches` pattern this phase establishes.

**Say this in the README:** a template instance has **no upstream link**, so students who already
instantiated will *not* receive the pointer bump. They keep the 27 stale `.vscode` dirs, which are
inert under the new root tasks. That is precisely why step 6 must not be a prerequisite for Phase 1.

## Flashing matrix — and the answer on `usbipd-win`

`dorssel/usbipd-win` is real and it does work, but it solves **Windows only**, and it is the most
fragile of the options for a classroom:

- Docker Desktop 4.35.0+ added native USB/IP support, so on Windows a probe can reach a container
  via `usbipd bind --busid …` then `usbipd attach`.
- It needs **`winget install usbipd` plus an elevated PowerShell** for `bind`.
- **The micro:bit re-enumerates after a mass-erase and after some flashes**, and USB/IP devices must
  be re-attached when the device resets — `--auto-attach` mitigates this but leaves a background
  process running. In a lab of students this is a recurring support ticket.
- **It does not help macOS.** Docker Desktop's USB/IP needs a USB/IP *server* on the host, and macOS
  has no complete implementation — only the experimental `pyusbip`, which its own proponents
  describe as flaky and partially implemented.

So `usbipd-win` is worth **documenting as an option for Windows students who want everything inside
the container**, but it cannot be the primary story. A better cross-platform option exists and is
worth documenting alongside it: **pyOCD's remote probe server**. `pyocd server` on the host (a single
`pip install`, no admin, no drivers) and `--uid=remote:host:5555` from the container. Its one
documented caveat — you must always pass `--target` explicitly for a remote probe — costs nothing
here, because every existing task already passes `-t nrf52833`.

Recommended order presented to students:

| Route | Install needed | Windows | macOS | Linux | Codespace |
|---|---|---|---|---|---|
| **WebUSB page** (default) | none | yes | yes | yes | **yes** |
| Drag-and-drop `.hex` | none | yes | yes | yes | download first |
| Native `pyocd` on host (gdb/F5 debugging) | `pip install pyocd` | yes | yes | yes | no |
| `pyocd server` + container client | `pip install pyocd` on host | yes | yes | yes | no |
| `usbipd-win` → container | winget + admin | yes | **no** | n/a | no |
| Direct USB into container | — | no | no | yes | no |

---

## Verification

Numbered so each can be ticked off. Several are *negative* tests — they must fail before the fix.

**Phase 0 (hex)**
1. `main.hex` starts with `:` and its last line is `:00000001FF`.
2. `pyocd load -t nrf52833 --format hex build/main.hex` succeeds — proves the hex independent of any browser.
3. Drag `main.hex` onto MICROBIT → runs. Drag the bare ELF → `FAIL.TXT` (today's behaviour).

**Phase 1 (build)**
4. With nothing on `PATH`, `mb.py doctor` locates the toolchain and names the pinned version.
5. `Ctrl+Shift+B` produces `build/main.elf/.hex/.bin`; `test -z "$(git status --porcelain -uall)"`
   passes in **both** the root repo and the submodule.
6. **The core test, folder never closed:** *Choose project…* → `ravenscar/buttons` builds and
   flashes; open `ravenscar/music/src/main.adb` → *Use the file I'm looking at* → builds music;
   switch back sub-second.
7. F5 with no `launch.json` edit hits a breakpoint **and the source file opens**.
8. A deliberate syntax error produces a clickable entry in the Problems panel (this is the
   `$ada` → `$ada-error` fix; it does not work today).
9. Windows: identical results from PowerShell, cmd and Git Bash. `git ls-files --eol tools/mb.py`
   reports `i/lf w/lf`.
10. `mb.py build --all` → `27 PASS, 15 XFAIL`. With quarantine disabled, 15 FAIL.
11. Fresh clone, **without building**: no red squiggles — proves the committed `.als.json` works on
    the pinned extension version.

**Phase 2 (container)**
12. "Use this template" into a **differently-named** repo → Codespace: submodule initialised,
    `bash -lc 'gprbuild --version'` works, `Ctrl+Shift+B` builds. *This fails today at the first `cd`.*
13. Linux host with the shipped host udev rule: `pyocd list` shows the board.
14. macOS Docker: container starts and builds; `pyocd list` is **empty** — documented as expected,
    not a bug.

**Phase 3 (CI)**
15. All matrix legs green — macOS is the first-ever aarch64 exercise of this toolchain.
16. `renamed` job green; second run shows cache hits.
17. A fresh **private** template instantiation runs exactly **one** job.

**Phase 4 (SPARK examples)**
18. `mb.py prove` completes on all three OSes, and `prove --all-spark` reports **0 unproved checks**.
19. Deliberately weaken a `Pre` (or remove an initialisation) → gnatprove reports the unproved check
    and the CI `prove` job goes red. A proof gate that cannot fail is not a gate.
20. Each `spark/` example still **builds and flashes** like any other — proving is an extra rung, not
    a replacement for running it on hardware.

**Phase 5 (browser)**
21. From Chrome: open the page, connect, see `Put_Line` output at 115200 — with pyocd *not* running.
22. Flash the CI-produced `.hex` over WebUSB and see the program run. Repeat the whole loop from a
    Codespace with nothing installed locally.

**Phase 6 (submodule)**
23. After the pointer bump, `mb.py build --all` turns 15 XFAIL into PASS **and fails with XPASS**
    until `known_failures.txt` is updated. That failure is the design working.

---

## Deliberately not doing

Each of these was designed and then rejected on evidence:

- **A GHCR multi-arch image.** ~2 GB pulled instead of ~1 GB downloaded, and the real wins
  (reproducibility, a reviewable pin) already come from a pinned `alr toolchain --select` in
  `devcontainer.json`. Against that: a buildx pipeline, a manifest-merge job, a GHCR package that is
  private by default and must be *irreversibly* made public or every student fork 401s, and a
  workflow that ships into every student repo where `schedule:` crons are **not** disabled. Not for
  one lecturer to run.
- **Emulation in CI.** QEMU's `-M microbit` is the nRF51822 (v1); there is no nRF52833 machine. A
  Renode `.repl` would be bespoke and only you could debug it, to assert one `Put_Line`.
- **A browser debugger.** dapjs exposes no `step` and no `setBreakpoint`; you would be programming
  FPB comparators and parsing DWARF to reproduce `arm-eabi-gdb` + `pyocd gdbserver`.
- **Patching the submodule's `build_all_examples.py`.** It has four defects, not the three visible at
  first — the fourth is `ret = ret or gprbuild(...)`, which short-circuits so **nothing is built
  after the first failure**. It is an upstream file; patching deepens divergence for zero gain once
  `mb.py --all` exists.
- **A multi-root `.code-workspace`.** It genuinely solves per-folder tasks, but re-creates 43
  `tasks.json`, makes `${workspaceFolder}` ambiguous in `launch.json`, and — fatally for a template —
  a student who clicks *Open Folder* instead of *Open Workspace from File* silently gets none of it,
  with no error explaining why.
- **`-XADL_BUILD_CHECKS=Enabled`** in CI. It turns warnings into errors, and modern GNAT emits
  obsolescent-aggregate and unreferenced-formal warnings throughout ADL's own components — every
  example would go red for reasons unrelated to student code.
- **Generating the example picker from disk.** Sorting differs case-sensitively on POSIX and
  case-folded on Windows, so a regenerate-and-check CI step fails on Windows with a diff that looks
  like nothing changed. A stale hand-written entry just prints
  `no project matches 'x' — try: mb.py list`, which is good enough.
