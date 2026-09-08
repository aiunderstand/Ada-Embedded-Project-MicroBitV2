# Integrated implementation plan — Ada-Embedded-Project-MicroBitV2

Five features were designed in parallel and adversarially reviewed. Every reviewer returned
`NEEDS_CORRECTION`. This document merges them into one sequenced plan, applies the corrections
that were *verified*, and drops the parts that were shown to be broken or not worth the
maintenance for a repo owned by one lecturer.

---

## 0. Executive summary

**The shape of the integrated design:**

| Concern | Decision |
|---|---|
| Build entry point | One small Python driver `tools/mb.py`. **Not** Alire (`alr build`), **not** shell scripts. |
| Where objects go | `gprbuild --root-dir=. --relocate-build-tree=build/obj`, run from repo root. |
| Where firmware goes | Always `build/main.elf` / `build/main.hex` / `build/main.bin`, regardless of which project was built. |
| Examples | Built **in place** from the repo root. No copying, no per-example `.vscode`, no folder reopening. |
| Toolchain | Pinned via Alire (`alr` = downloader only), located by `mb.py`. **gprbuild 25.0.1**, never 22.0.1. |
| CI | Stays self-contained (no GHCR image dependency). Adds `objcopy -O ihex`. Matrix + example gate is maintainer-gated. |
| Container | Bug fixes only. **No GHCR multi-arch image.** |
| Browser | **Web Serial console only.** No WebUSB/dapjs flasher. |

**Five things fix ~90% of the reported pain, and they are all in Phases 0–2:**

1. CI emits a `.hex` (drag-and-drop has never actually worked).
2. `.vscode/tasks.json` stops hardcoding `zsh -c 'source /root/.zshrc'`.
3. A project picker means students never close and reopen a folder.
4. The devcontainer stops `cd`-ing into a hardcoded repo name.
5. The README stops telling people to edit `~/.zshrc` and reboot.

Everything after Phase 2 is optional hardening.

---

## 1. Conflict resolution

The five designs contradicted each other in six places. Resolutions, with reasoning.

### 1.1 Build system: `alr build` vs `mb.py` vs `tools/build.sh` → **`mb.py`**

Three mutually exclusive proposals existed for the same job.

* **`alr build` + `alire.toml`** (*platagnostic*) is theoretically cleanest — Alire supplies PATH,
  which deletes the README's PATH section outright. But verification found: on a machine with no
  Alire history, the first `alr build` **auto-downloads a native GNAT (~2 GB) nobody needs**; the
  AdaCore extension changes behaviour when it sees `alire.toml` (contributes duplicate build tasks,
  and loses the project entirely if the solve fails); and it makes a package manager load-bearing on
  the critical path of every student build. The verified prize (no PATH editing) is obtainable
  without any of that.
* **`tools/env.sh` + `build.sh`** (*docker*) had two reproduced bugs: `env.sh` aborts the whole build
  with exit 1 and no output under `set -euo pipefail` when a toolchain root exists but one glob
  misses; and both `env.sh` and `env.ps1` select the *newest* toolchain on disk rather than the
  pinned one (on Windows, `Sort-Object Name` picks 9.x over 14.x), silently defeating the pin.
  It also needs two parallel implementations (sh + ps1) that will drift.
* **`tools/mb.py`** (*buildorch*) had the only mechanic that was actually executed by a verifier:
  27 ravenscar examples built from the repo root into a shared relocated tree in 9 s, working tree
  byte-clean, executable paths exactly where the code predicted.

**Resolution: `mb.py`, cut to ~200 lines.** One implementation for all four platforms; Python is
already a hard requirement because pyocd is a pip package. The `python3` vs `python` naming problem
is solved by VS Code's per-OS task overrides (documented and verified behaviour), not by a wrapper.

`alr` keeps exactly the role it has today: a *toolchain downloader*, run once per machine. There is
no `alire.toml`, no `alr build`, no lockfile, no solver on the build path.

### 1.2 Root `.vscode/tasks.json` → **one owner, `mb.py`-driven**

Four of the five designs rewrote this file. It has one owner now. Every task is
`"type": "process"` invoking `python3`/`python` on `tools/mb.py`. `pyocd` is never invoked directly
from a task — it goes through `mb.py`, which is the only thing that knows how to find it
(`pipx`/`pip --user` put `pyocd` in `~/.local/bin`, which is frequently not on PATH; the *docker*
design's Flash task would have failed with `pyocd: command not found` on exactly the machines where
Build succeeded).

Corrections applied:
* `"problemMatcher": ["$ada"]` → `["$ada-error", "$ada-warning"]`. **`$ada` does not exist** — the
  AdaCore extension contributes only `ada-error`, `ada-warning`, `ada-info`. This is a pre-existing
  bug in the current file that three designs copied forward while claiming to fix the tasks.
  Consequence today: the Problems panel is empty and VS Code toasts an error on every build.
* No `runOn: folderOpen` bootstrap task, and no `"task.allowAutomaticTasks": "on"` in workspace
  settings — that setting is **APPLICATION-scoped** (`scope:1`, verified in the shipped
  `workbench.desktop.main.js`), so a workspace value is ignored outright, and the repo's own README
  currently trains students to decline Workspace Trust, which disables automatic tasks anyway.

### 1.3 Who owns the examples → **built in place, from the root, hand-maintained picker**

* Copying examples into a first-party `examples/` tree (*buildorch*'s `mb.py copy` + overlay):
  **dropped**. It creates two copies of every `main.adb` in a checkout and a divergence-management
  problem, for a benefit (students editing an example they own) that `git` already provides badly
  and that nobody asked for.
* Generating the picker list (`mb.py gen-tasks` + a CI `--check` gate): **dropped**. It splices
  JSONC between sentinel comments; it sorts case-sensitively on POSIX and case-folded on Windows, so
  regenerating on Windows makes CI fail with a diff that looks like nothing changed; it rewrites the
  file with `os.linesep`; and it turns every Dependabot submodule bump into a manual
  "regenerate, commit, re-push" chore. A hand-written 27-entry `pickString` that goes stale produces
  a clean `no project matches 'x' — try: mb.py list` error. That is a perfectly good failure mode.
* Deleting the 27 `.vscode` dirs in the submodule: **downgraded from "required" to optional
  cleanup** (Phase 5). `mb.py` ignores them entirely, so the feature works against today's submodule
  pointer. Making a cross-repo change a prerequisite for a `tasks.json` fix is backwards.

### 1.4 CI → **stays self-contained; `ada.yml` keeps its name**

*docker* proposed pointing `ada.yml` at `container: ghcr.io/aiunderstand/ada-microbit-v2:2026.09`.
**Dropped.** Verified failure modes: the tag is hardcoded in three files but generated by
`date -u +%Y.%m` in the publish job, so a first merge in October mints `:2026.10` and the pin is
permanently dead; the GHCR package is private by default and must be manually made public (irreversibly) or
every student fork's CI 401s *and* every "Reopen in Container" fails at image pull; and the image
workflow itself is copied into every student repo by "Use this template" (template instances are not
forks, so `schedule:` crons are **not** disabled), where it would monthly build and push a
two-architecture ~2 GB image to each student's own GHCR namespace using their own token.

Today's CI is green, has zero external dependencies, and works in every student repo. Keep that
property. Also keep the **filename `ada.yml`**, so the README badge URL never needs to change.

### 1.5 Toolchain pin → **gprbuild 25.0.1, never 22.0.1**

Three designs pinned `gprbuild=22.0.1`. Both *docker* verifiers and both *platagnostic* verifiers
independently read the live Alire index and found the same thing:

> `gprbuild-22.0.1.toml` has origins for **linux/x86-64, macos/x86-64, windows/x86-64 only**.
> There is no aarch64 origin of any kind. One verifier ran the command and got
> `ERROR: Release within requested versions not found: gprbuild=22.0.1`.

The first gprbuild crate with aarch64 is 24.0.1 (aarch64-only); **25.0.1 is the first with all five
platforms**, and is what the maintainer already has installed. Pinning 22.0.1 would have broken the
Apple Silicon native path — the headline claim — and both arm64 container legs.

Compiler: `gnat_arm_elf` 14.2.1 and 15.1.2 were both verified on disk to bundle
`embedded-nrf52833` (and `arm-eabi-gnatls --RTS=embedded-nrf52833 -v` resolves on 15.1.2). The
"bumping past 14.x unbundles the runtime" fear that drove the 14.2.1 pin is **refuted at 15.1.2**.
See Decision D1.

### 1.6 Firmware output path → **`build/main.{elf,hex,bin}`, one convention everywhere**

Three conventions were in play (`Code/obj/main`, `<example>/obj/main`, `dist/<name>.hex`). One wins:
every build lands in `build/`. This is what makes `launch.json` a single static config, makes the CI
artifact stable, and gives the console/flasher page a fixed name. `Code/obj/` becomes legacy and is
kept in `.gitignore` for one term.

---

## 2. Dropped outright — and why

| Dropped | Reason |
|---|---|
| **GHCR multi-arch devcontainer image** (whole *docker* feature core) | Three independent fatal flaws (gprbuild 22.0.1 has no aarch64; pyocd 0.36.0 pulls `capstone<5.0` which has **no aarch64 and no cp312 wheels**, so the arm64 image dies in the pip layer before the runtime assertion ever runs; the `date`-derived tag never matches the hardcoded pin). Plus a manual, forgettable, irreversible "make package public" step that bricks the entire cohort's containers if missed, with no `build:` fallback. The devcontainer's actual bugs are 5 lines of JSON. |
| **`alire.toml` + `alr build`** | See §1.1. First build auto-downloads ~2 GB of native GNAT; makes a solver load-bearing; changes ALS project-detection behaviour. Revisit after a cohort has used the simple version. |
| **`tools/env.sh` / `env.ps1` / `build.sh` / `build.ps1`** | Two reproduced bugs (silent `set -e` abort; picks newest-not-pinned toolchain, and lexicographic on Windows picks *oldest*). Superseded by `mb.py`. |
| **`tools/doctor.sh`** | `if out=$("$@" 2>&1 \| head -n 1); then` tests **`head`'s** exit status, which is always 0. Reproduced: a missing tool prints `OK  gprbuild  command not found`. It ran as `postCreateCommand` and was advertised as the thing students paste for support — it would certify a completely broken container as healthy. Replaced by `mb.py doctor` (Python; the bug class does not exist). |
| **`mb.py gen-tasks` + CI `--check` gate** | See §1.3. |
| **`mb.py copy` + first-party `examples/` overlay** | See §1.3. |
| **`tools/check_firmware.py`'s hand-written Intel-HEX parser + ELF vector-table decoder + hard 90 % flash/RAM gate** | ~200 lines guarding a failure mode (objcopy emitting malformed hex) that has never occurred. The hard 90 % gate had no CLI flag on the driver, so a legitimately large example would redden the whole examples job. Kept: `objcopy -O ihex`, `objcopy -O binary`, the `:00000001FF` EOF assertion, and a **report-only** size line. Note `itrs.gpr` already passes `-Wl,--print-memory-usage`, so `arm-eabi-size` is near-redundant. |
| **`.github/workflows/adl-testsuite.yml`** | A `continue-on-error: true` weekly cron testing FAT/bitmap/monitor middleware micro:bit students never touch — a permanently-yellow job nobody reads, running in every student repo. |
| **`tools/check_template_portability.py`** | Every one of its rules fires against the repo as it stands, so the very first PR is red on a job no code change in its own feature could fix. Its `REQUIRED: remoteEnv` rule also contradicts its own `BANNED: /workspaces/...` rule and would fail a *correct* Dockerfile-`ENV` config. Its one genuinely valuable rule (ban `zsh`/`/root/.zshrc` under `.vscode/`) is preserved as a 3-line grep in Phase 3. |
| **WebUSB / dapjs browser flasher** | See §5 Phase 4. Fatal: the page holds an exclusive claim on the CMSIS-DAP interface for the life of the tab and *deliberately never disconnects*, so a student who flashes once in the browser then presses Ctrl+Shift+B gets an opaque pyocd probe error caused by a background tab. Plus: no Linux setup at all (snap Chromium needs `snap connect chromium:raw-usb`; others need a udev rule) and the "fallback" never triggers for that case; and the ZIP reader takes the *first* `*.hex`, so it silently flashes the wrong program the moment CI produces more than one. |
| **`file://` single-file downloadable flasher** | Chrome does not expose `navigator.usb` on `file://`, and `window.isSecureContext` is *true* there — so the page's own guard would not catch it. |
| **`?hex=<url>` fetch parameter** | Unverified CORS, zero day-one users, opt-in complexity. |
| **`workspaceFolder: "${containerWorkspaceFolder}"`** | Circular — `containerWorkspaceFolder` is *derived from* `workspaceFolder`. Deleting the hardcoded `cd` is the entire fix; lifecycle commands already run from `workspaceFolder` (containers.dev spec). |

---

## 3. Decisions for the lecturer

Six things where reasonable people differ and the answer changes the work.

### D1. Toolchain pin: `gnat_arm_elf` 14.2.1 or 15.1.2?

Both verified to bundle `embedded-nrf52833`. `gprbuild=25.0.1` either way (non-negotiable, §1.5).

* **14.2.1** — byte-identical to the `gnat-14.2.0-1` tarball CI is green on today; zero build risk;
  aarch64 origins exist from that same release.
* **15.1.2** — what your machine already runs; verified to build the template *and* all 27 ravenscar
  examples natively on Apple Silicon; better `-gnat2022` support (which `itrs.gpr` requests).

> **Recommendation: 15.1.2.** It is the one a verifier actually built the whole example set with,
> and it is already on your disk so you can validate immediately. Do **not** go to 16.x — unverified.
> Whichever you pick, it is a ~1.9 GB download for anyone who has the other one.
> **Bump between semesters, never mid-course**, and say so in the README.

### D2. Are the 15 `zfp` examples still taught?

They are provably dead and have been for years — three independent defects, all verified:
`zfp-cortex-m4f` does not exist in any current toolchain (renamed `light-cortex-m4f`); 4 have
backslash `with` paths; **all 15** (not 14) pass a `-T` linker-script path that is both
backslash-separated *and* one directory level short, so they fail on Windows too.

* **Fix** — 3 mechanical edits in the fork (`light-cortex-m4f`, forward slashes,
  `MicroBit_v2_ZFP.Linker_Switches`). ~30 min plus a submodule bump. Verified that with
  `--RTS=light-cortex-m4f` everything *compiles* and only the link fails on the bad `-T`.
* **Delete** — halves the example maintenance surface and shrinks the picker from 42 to 27.

> **Recommendation: quarantine now (Phase 1), decide in Phase 5.** If the course teaches the
> light/ZFP runtime, fix them; if it is Ravenscar/Jorvik only, delete them. Nobody has built one in
> years either way, so this is not urgent.

### D3. Do `mb.py` and the CI example gate ship in the *student's* copy?

The template's first-party tree is currently one `.adb` and one `.gpr`. `mb.py` (~200 lines) has to
ship — it *is* the build. The question is the CI.

> **Recommendation: student repos run exactly one CI job** — `ubuntu-latest`, build `Code/itrs.gpr`,
> objcopy, upload `main.hex`. Everything else (OS matrix, 27-example regression gate,
> renamed-checkout test, the `zsh` grep) is gated with
> `if: github.repository == 'aiunderstand/Ada-Embedded-Project-MicroBitV2'`.
> This matters more than it sounds: on a **private** student repo (normal for academic integrity),
> Actions minutes bill at Linux 1×, Windows 2×, **macOS 10×**. Two macOS legs per push would lock a
> student out of Actions in roughly ten commits, for failures that are not about their code.

### D4. Keep the CI badge in the template README?

`![...](https://github.com/aiunderstand/Ada-Embedded-Project-MicroBitV2/.../ada.yml/badge.svg)` is
copied verbatim into every student repo, where it reports **your** build status, not theirs.

> **Recommendation: remove it from the template README**, replace with one line pointing at the
> student's own Actions tab. Actively misleading is worse than absent.

### D5. Dependabot: daily submodule bumps?

`.github/dependabot.yml` also ships to students, so every student repo gets daily ADL bump PRs that
can move the submodule under them mid-semester.

> **Recommendation: pin the submodule for the semester.** Delete `dependabot.yml` from the template
> default branch, or set `interval: monthly`. Do the bumps deliberately, between terms.

### D6. Browser page: Web Serial console, or nothing?

WebUSB flashing is dropped (§2). What remains genuinely unavailable to a Codespaces student is the
**serial console** — the container has no USB, so `Put_Line` output is invisible to them.

> **Recommendation: ship a ~60-line Web Serial console page (Phase 4), no library, no flasher.**
> `navigator.serial.requestPort({filters:[{usbVendorId:0x0d28}]})` at 115200 claims the DAPLink
> **CDC** interface, *not* the CMSIS-DAP interface — so it does **not** contend with pyocd the way
> dapjs would. Verified in-repo that `MicroBit.Console` drives P0.06/P1.08 at Baud115200 in both the
> `full` and `zfp` variants, which are exactly the DAPLink-bridged pins, so output arrives with no
> driver change. Codespaces students flash by downloading `main.hex` and dragging it.

---

## 4. Cross-cutting corrections applied everywhere

Verified findings that touch more than one phase:

1. **`$ada` is not a problem matcher.** Use `["$ada-error", "$ada-warning"]`.
2. **`gprbuild=22.0.1` has no aarch64 origin.** Use `25.0.1`.
3. **`pyocd` must be ≥ 0.44** (0.36.0 pins `capstone>=4.0,<5.0`, which has no aarch64 and no cp312
   wheels). `nrf52833` is a **built-in** pyocd target — no `pyocd pack install` needed (verified in
   `pyocd/target/builtin/__init__.py`). `pyocd load --format hex` is valid (verified in `--help`).
4. **Alire's toolchain dir differs per OS and per alr version.** Do not guess. Set it explicitly:
   `alr settings --global --set toolchain.dir <path>` — verified as a documented key in
   `alr settings --help` on alr 2.1.0. This removes all OS branching and the whole class of
   Windows-only cache/PATH failures. (For reference, the README's Windows path with the `cache/`
   segment is right for Windows and the macOS/Linux ones without it are right for alr 2.x — but
   after this change nobody needs to know that.)
5. **`git status --porcelain` always exits 0.** Any "the tree stayed clean" CI guard must be
   `test -z "$(git status --porcelain -uall)"`. Note this also means a `.gitignore`d `obj/` would
   mask a relocation failure — assert on the *presence* of `build/obj/.../obj/main` instead.
6. **Lifecycle commands already run in `${containerWorkspaceFolder}`** (containers.dev spec).
   Delete the `cd`; add nothing.
7. **The devcontainer's `postCreateCommand` ends in `|| true`**, which in shell binds the *whole*
   preceding `&&` chain — so it always exits 0 and the container reports a clean create with no
   toolchain and no submodule. This is why the bug survived ~35 web-editor commits. Any smoke test
   must assert on *outcomes*, never on postCreate's exit code.
8. **`ada.projectFile` must be removed from `.devcontainer/devcontainer.json` too** — a VS Code
   setting in any scope overrides `.als.json`, and the container's `customizations.vscode.settings`
   currently sets it. Missing this makes the whole language-server story inert in Codespaces.
9. **Root `.gitattributes` does not reach the submodule.** It is still worth adding for the ~6
   first-party files, but it does *not* protect the 42 example `.gpr` files or the testsuite golden
   `.out` files — the submodule has its own `* text eol=lf` (with a corrupt UTF-16 trailing line).
   Land it with `git add --renormalize .` in the same commit.
10. **`Path`-based relative paths must be normalised.**
    `PurePosixPath(p.relative_to(REPO)).as_posix()` returns *backslashes* on Windows (the wrapper is
    what breaks it). Use `p.relative_to(REPO).as_posix()`.
11. **`--relocate-build-tree` requires `--root-dir`** and the root must be a parent of every artifact
    dir — satisfied here. Both switches predate gprbuild 22 (documented in the 22.0 GPR user guide).

---

## 5. Phases

Each phase leaves the repo in a working, shippable state.

---

### Phase 0 — Emit a flashable `.hex` (½ hour, zero risk)

**Why first:** this is the single highest-value change in the entire plan. Every student is told to
drag the CI artifact onto the MICROBIT drive; the artifact is a bare **ELF**, which DAPLink rejects
(it writes `FAIL.TXT`). This has never worked. Two lines fix it, for 100 % of students, on every OS
and every browser, with no new dependencies. **Merge this on its own, this week.**

**Files:**

| File | Action |
|---|---|
| `.github/workflows/ada.yml` | modify — add objcopy step + `-Wl,--print-memory-usage` is already there; upload `main.hex` alongside the ELF |
| `README.md` | modify — one section: "the artifact contains `main.hex` (flash this) and `main` (ELF, for pyocd/gdb)" |

**`ada.yml` — new step between Build and Upload:**

```yaml
      - name: Convert ELF to Intel HEX
        run: |
          arm-eabi-objcopy -O ihex   Code/obj/main Code/obj/main.hex
          arm-eabi-objcopy -O binary Code/obj/main Code/obj/main.bin
          test -s Code/obj/main.hex
          head -c 1 Code/obj/main.hex | grep -q ':'
          tail -n 1 Code/obj/main.hex | grep -q '^:00000001FF'
```

Upload path becomes `Code/obj/main.hex`, `Code/obj/main.bin`, `Code/obj/main`.
Keep the workflow **name and filename** unchanged so the badge does not break.

**Verified facts behind this:** the GNAT-FSF arm-elf tarball ships full binutils under the
`arm-eabi-` prefix; the runtime's `memory-map.ld` declares only `flash @0x0 512K` and
`sram12 @0x20000000 128K` (no UICR, no bootloader region), so the hex is flash-only; DAPLink's
`intelhex.c` ignores the type-05 start-address record binutils appends; and `objcopy` writes EOF
last.

**Do NOT** add the `grep -c '^:02000004'` sanity check that the *testing* design proposed — objcopy
emits one extended-linear-address record **per 64 KiB**, so a normal >64 KB image already yields
several. It would raise a false alarm on the very first run.

**Exit criteria:** download the artifact, drag `main.hex` onto the MICROBIT drive, board runs.
Repeat with the bare ELF and confirm `FAIL.TXT` appears — worth seeing once.

---

### Phase 1 — Platform-agnostic build + no more folder reopening (the main event)

**Why:** kills the `zsh -c 'source /root/.zshrc'` bug (which breaks native macOS, native Linux and
Windows outright), kills the close-and-reopen-the-folder workflow, kills the README's
"edit `~/.zshrc` and reboot" section, and gives `launch.json` a fixed executable. **No submodule
change required** — this is the key sequencing insight and it de-risks everything.

#### Files

| File | Action |
|---|---|
| `tools/mb.py` | **create** (~200 lines) |
| `tools/known_failures.txt` | **create** (quarantines the 15 zfp examples) |
| `.vscode/tasks.json` | modify — full rewrite |
| `.vscode/launch.json` | modify — one static config |
| `.vscode/settings.json` | modify — **remove `ada.projectFile`**, keep the rest |
| `.als.json` | **create** — committed, `{"projectFile": "Code/itrs.gpr"}` |
| `.gitattributes` | **create** (+ `git add --renormalize .` in the same commit) |
| `.gitignore` | modify — add `build/` |
| `Code/src/main.adb` | modify — comment only (delete the stale "runtime profiles" folder instruction) |
| `README.md` | modify — replace the entire PATH section |

#### `tools/mb.py` — scope

Commands: `list`, `build [--use ID | --use-dir DIR] [--all]`, `flash [--no-build]`, `erase`,
`clean`, `doctor`, `als` (repoint the language server at the selected project).

Core mechanic — **verified by execution**:

```
gprbuild -j0 -p -P <project.gpr> --root-dir=. --relocate-build-tree=<repo>/build/obj \
         -cargs:ada -gnatef
```

run with `cwd` = repo root. Then copy the resulting `build/obj/<proj-dir>/obj/main` to
`build/main.elf` and `objcopy` it to `.hex`/`.bin`.

Design constraints, all of which are corrections from the reviews:

* **Toolchain lookup honours the pin.** Read `GNAT_VERSION`/`GPRBUILD_VERSION` from a single
  `tools/toolchain.env`; prefer an exact `gnat_arm_elf_<VERSION>_*` match; fall back to
  highest-version-installed **with a printed warning naming what was selected**. Never
  newest-by-mtime (nondeterministic on a machine with two toolchains — this one has two) and never
  lexicographic.
* Search roots: `$MB_TOOLCHAIN_DIR`, `~/.local/share/alire/toolchains`,
  `~/.local/share/alire/cache/toolchains`, `%LOCALAPPDATA%/alire/cache/toolchains`,
  `~/AppData/Local/alire/cache/toolchains`, `~/.cache/alire/toolchains`. Plus `~/.local/bin` on
  PATH for `pyocd`.
* **`doctor` exits 0 when only flash/debug tools are missing** (pyocd, arm-eabi-gdb), non-zero only
  for build-critical ones. It reports honestly (the shell version's `chk()` could never report a
  failure).
* `rel()` = `p.relative_to(REPO).as_posix()`, **no `PurePosixPath` wrapper**.
* Project discovery filter tests `gpr.relative_to(base).parts`, **not** the absolute path — otherwise
  a student whose checkout sits under any directory named `lib` or `obj` silently gets an empty
  picker.
* `resolve_dir()` (the "build the file I'm looking at" path) **skips `.gpr` files with no
  `for Main`** and anything under `boards/`, then walks to the parent. Otherwise Go-to-Definition
  into a driver source followed by that task builds the board *library* and dies with
  "no executable was found".
* `--all` uses `tools/known_failures.txt` with XFAIL/XPASS semantics (a quarantined project that
  starts passing **fails** the run, so the list can only shrink). Size reporting is
  **report-only** — no hard budget gate.
* Guard `shutil.rmtree` on `--build-dir`: refuse anything not under the repo root.
* `als` writes `.als.json` **only if the content differs** (the extension has a `**/.als.json`
  watcher that pops "restart language servers" on every write).

#### `.vscode/tasks.json` — the six tasks

```jsonc
{
  "version": "2.0.0",
  "inputs": [{
    "id": "project", "type": "pickString",
    "description": "Which project?",
    "default": "my-project",
    "options": [ /* hand-maintained: my-project + 27 ravenscar + 15 zfp */ ]
  }],
  "tasks": [
    // "micro:bit: Build & Flash"   (default build task)  -> mb.py flash
    // "micro:bit: Build"                                 -> mb.py build
    // "micro:bit: Choose project..."                     -> mb.py build --use ${input:project}
    // "micro:bit: Use the file I'm looking at"           -> mb.py build --use-dir ${fileDirname}
    // "micro:bit: Erase"                                 -> mb.py erase
    // "micro:bit: Doctor"                                -> mb.py doctor
  ]
}
```

Every task: `"type": "process"`, `"command": "python3"` with
`"windows": { "command": "python" }`, `"options": { "cwd": "${workspaceFolder}" }`,
`"problemMatcher": ["$ada-error", "$ada-warning"]`.

`${fileDirname}` is deliberately **not** the default task — VS Code refuses to run a task with an
unresolvable variable, so with no editor focused it pops
"Variable ${fileDirname} can not be resolved" and the build never starts.

`Build & Flash` as the default is correct for laptop users but always ends in a `pyocd`-not-found
message in a Codespace. `mb.py flash` should detect "no pyocd / no probe" and print
*"Built OK. No debug probe here (Codespace?) — download `build/main.hex` and drag it onto the
MICROBIT drive."* rather than a stack trace.

#### `.als.json` — committed, static

```json
{ "projectFile": "Code/itrs.gpr" }
```

* **Committed**, not gitignored. Both `buildorch` verifiers independently called the gitignored
  version a fresh-clone regression: with `ada.projectFile` deleted from settings.json, no `.als.json`,
  and a bootstrap task that provably cannot run, a brand-new student repo opens with **no Ada
  project at all** — and there is no `.gpr` at the repo root for ALS to auto-detect, so every file
  shows errors on minute one. That is strictly worse than today.
* Only `projectFile`. **Deliberately no `relocateBuildTree`/`rootDir`** — ALS's resolution of
  relative paths in those keys is undocumented and was the one load-bearing unknown neither verifier
  could settle. ALS only needs to *parse* the project; missing object dirs are fine.
* It is **not** rewritten by every build. A separate explicit task/command
  (`mb.py als --use <id>`) repoints it. This avoids restart-popup spam and per-build git churn while
  keeping the capability.
* README pins **`AdaCore.ada` ≥ 26.0.202412190** (the release that added `.als.json` support,
  confirmed in the extension CHANGELOG). On anything older `.als.json` is inert.
  *Fallback if this bites a cohort:* re-add `ada.projectFile` to settings.json and drop
  example-switching for the language server (builds are unaffected).

#### `.vscode/launch.json`

One `cortex-debug` config, `"executable": "${workspaceFolder}/build/main.elf"`,
`"preLaunchTask": "micro:bit: Build"`. Because every build rewrites that path, F5 automatically
debugs whichever example was last built — which also makes the 27 broken example `launch.json`
files (they point at `${workspaceFolder}/Code/obj/main` while examples build to `obj/main`)
irrelevant rather than something to fix.

**Must verify:** GDB source resolution against the *copied* ELF. `DW_AT_comp_dir` records the
compilation directory (repo root, since gprbuild runs from there), not the ELF's location, so moving
the file should be harmless — but "breakpoint set but source not found" is undiagnosable for a
first-year, so hit a breakpoint once before shipping.

#### README — replace the PATH section

Delete lines ~26–59 entirely ("Update global environment variables", "reboot computer", the warning
that a mistake stops your terminal running `ls`, and the macOS/Linux/Windows `cache/`-segment
inconsistency). Replace with:

```
1. Install Alire 2.1.1+
2. alr --non-interactive toolchain --select gnat_arm_elf=<D1> gprbuild=25.0.1
3. pipx install pyocd     (or: python3 -m pip install --user pyocd)
4. Install the VS Code extensions (AdaCore.ada >= 26.0.202412190, marus25.cortex-debug)
5. Open the folder, press Ctrl+Shift+B.
```

Also fix in the same pass:
* "Open a folder at the root of the example" → "use the *Choose project…* task".
* **Remove "Decline any question of VScode trying to be helpful"** — declining Workspace Trust
  disables the Ada extension.
* Linux: `sudo cp tools/udev/50-microbit.rules /etc/udev/rules.d/` (Phase 2 ships the file).
* Decision D4 (badge).

**Exit criteria:** on a machine with **nothing** on PATH, `python3 tools/mb.py doctor` finds the
toolchain; Ctrl+Shift+B builds; `Choose project… → ravenscar/buttons` builds and flashes **without
closing the folder**; switching back to `my-project` takes well under a second (shared relocated
board library); `git status --porcelain -uall` is empty in both the root repo and the submodule;
`grep -rn 'zshrc\|\$ada"' .vscode` returns nothing.

---

### Phase 2 — Devcontainer / Codespaces fixes (~15 lines of JSON)

**Why:** the hardcoded `cd /workspaces/Ada-Embedded-Project-MicroBitV2` breaks the container for
**every** student, because a template instance has a different name — and the trailing `|| true`
means it fails *silently* with a clean-looking create.

**Files:** `.devcontainer/devcontainer.json` (modify), `tools/udev/50-microbit.rules` (create).

Changes:

1. **Delete `cd /workspaces/Ada-Embedded-Project-MicroBitV2 &&`.** Nothing replaces it.
2. **Move `git submodule update --init --recursive` into `onCreateCommand`** (or
   `updateContentCommand`) so Codespaces **prebuilds** cache it — `postCreateCommand` does **not**
   run during a prebuild.
3. **Delete the trailing `|| true`** so a failed create is visible.
4. **Pin the toolchain**: `alr --non-interactive toolchain --select gnat_arm_elf=<D1> gprbuild=25.0.1`
   (currently unpinned, drifts to whatever the index resolves to today).
5. **Install `alr` to `/usr/local/bin`** instead of `/workspaces/alr`.
6. **Export PATH via `remoteEnv`/`containerEnv`**, not `/root/.zshrc`. This is what makes
   `arm-eabi-gdb` and `pyocd` findable by cortex-debug, which spawns them directly and never sources
   a shell rc — F5 is broken in the container today even after the build is fixed.
7. **Remove `"ada.projectFile": "Code/itrs.gpr"`** from `customizations.vscode.settings`
   (§4.8 — otherwise `.als.json` is inert in every Codespace).
8. **Pin pyocd** to ≥ 0.44 in the pip install.
9. Ship `tools/udev/50-microbit.rules` for the **host**. The rule the container writes into its own
   `/etc/udev/rules.d` has always been a no-op — udev runs on the host.
10. Add `git config --global --add safe.directory '*'` — the workspace is checked out by a different
    uid than the container user, so `git submodule update` would otherwise refuse with
    "dubious ownership" (and the `|| true` would have swallowed it).

Also worth saying plainly in the README: **Docker Desktop on macOS/Windows cannot pass USB through**,
and Codespaces has no USB. Those containers **build**; you flash by dragging `build/main.hex`. Do
*not* claim `source=/dev` "hard-fails" on macOS — `/dev` exists inside the Moby VM, so it most
likely binds the VM's own `/dev`, which never contains the board. Being wrong about *why* something
does not work is its own support cost.

*(Not doing: a two-config split, a Dockerfile, GHCR. The single existing config with these fixes is
correct on Linux hosts and harmlessly build-only elsewhere.)*

**Exit criteria:** click "Use this template" into a repo named something else entirely
(`itrs-group-07`), open a Codespace: submodule initialised, `bash -lc 'gprbuild --version'` works
(bash, not zsh — proves PATH is not rc-file-bound), Ctrl+Shift+B builds, `mb.py doctor` reports
pyocd present but no probe.

---

### Phase 3 — CI hardening (maintainer-gated)

**Why:** today CI is x86-64-Linux-only, builds only the stub, and gives the 42 examples **zero**
regression protection. But per D3 this must not land on students.

**Files:** `.github/workflows/ada.yml` (modify), `.github/dependabot.yml` (modify or delete).

Structure — **one file**, so the badge URL never changes:

```yaml
jobs:
  # Runs everywhere, including student repos. The only student-facing job.
  build:
    runs-on: ubuntu-latest
    # keep the existing pinned-tarball toolchain download: self-contained,
    # currently green, works in every fork with zero external dependency
    steps: [ checkout(submodules), toolchain, mb.py build, upload main.hex ]

  matrix:
    if: github.repository == 'aiunderstand/Ada-Embedded-Project-MicroBitV2'
    strategy: { matrix: { os: [ubuntu-24.04, macos-15, windows-2022] } }
    # pinned toolchain via alr, with an explicit toolchain.dir (see §4.4)

  examples:
    if: github.repository == 'aiunderstand/...'
    runs-on: ubuntu-24.04
    steps: [ ..., python tools/mb.py build --all ]     # 27 PASS, 15 XFAIL

  renamed:
    if: github.repository == 'aiunderstand/...'
    # actions/checkout with path: My-Student-Project-2026 -> build from there
    # this is the regression test for the template-rename bug

  lint:
    if: github.repository == 'aiunderstand/...'
    # 3-line grep: no 'zsh'/'/root/.zshrc' in .vscode, no repo name in .devcontainer
```

Toolchain install for the matrix legs (composite action or inline):

```bash
alr settings --global --set toolchain.dir "$RUNNER_TEMP/adl-toolchain"   # kills all OS branching
alr --non-interactive toolchain --select gnat_arm_elf=<D1> gprbuild=25.0.1
```

Cache `$RUNNER_TEMP/adl-toolchain` **and `~/.config/alire`** (which holds the ~14 MB community-index
clone and the selection state — otherwise every run re-clones the index even on a cache hit).
Budget honestly: the pinned pair is ~**2.05 GB extracted** (measured: 1.9 GB + 142 MB), not the
"~1.2 GB" one design claimed, against a 10 GB per-repo cache with LRU eviction.

Windows-specific: `alr` will try to install msys2 unless `pacman` is on PATH. Decide explicitly —
`alr settings --global --set msys2.do_not_install true` before the first `alr` call is the low-risk
option, since the runner already has curl/tar.

Do **not** use `alire-project/setup-alire@v4` — **that tag does not exist** (v1, v6, `latest` do).

Also: replace the CI cleanliness guard with `test -z "$(git status --porcelain -uall)"` (§4.5), and
assert relocation actually worked by checking `build/obj/.../obj/main` exists rather than relying on
a clean `git status` that `.gitignore` would mask anyway.

Dependabot: per D5.

**Exit criteria:** all matrix legs green; `examples` reports `27 PASS, 15 XFAIL`; deliberately
un-quarantining a working example produces XPASS and fails the job; the `renamed` job is green;
a fresh template instantiation runs exactly **one** job.

---

### Phase 4 — Web Serial console (optional, ~60 lines)

Only worth doing if Codespaces is a real workflow for your cohort. Local students already have
`ms-vscode.vscode-serial-monitor` (already in `extensions.json`, and `main.adb` already tells them to
open a serial port at 115200) — so this buys **only** the Codespaces case.

**Files:** `docs/index.html`, `docs/.nojekyll`, `.github/workflows/pages.yml`.

* `navigator.serial.requestPort({ filters: [{ usbVendorId: 0x0d28 }] })`, 115200, append-to-`<pre>`
  **with a size cap** (naive `textContent +=` on a 50 ms poll is O(n²) and will pin the tab for
  anyone printing in a loop — which is exactly what the verification step tells them to do).
* No dapjs, no vendored bundle, no ZIP parser, no flashing.
* Fallback content visible by default; hidden only once `navigator.serial` is confirmed.
* **Linux note is mandatory**: `dialout` group membership, and snap Chromium cannot do Web Serial at
  all. Detect the failure and print the remedy rather than a raw `DOMException`.
* Deploy via **an Actions workflow** (`actions/checkout` with `submodules: false` →
  `upload-pages-artifact path: docs` → `deploy-pages`), **not** branch deployment: branch deploys run
  `git submodule update --init --force --depth=1 --recursive`, and this repo's submodule pointer
  (`2a5119c7`) is not a branch tip — a documented failure mode, and pure waste for a 4 KB page.
* Gate the workflow with `if: github.repository == 'aiunderstand/...'` (D3).

---

### Phase 5 — Submodule cleanup (fork PR + pointer bump)

Only after Phases 0–3 are green. Each item is independent; do them as separate commits so a bisect
stays useful.

In `aiunderstand/Ada_Drivers_Library`:

1. **Delete `.github/workflows/ada.yml`.** It is a byte-identical copy of the template's workflow
   referencing `Code/itrs.gpr`, a path that does not exist in ADL — permanently red, and it displaced
   upstream ADL's own example CI.
2. **Delete the 27 `.vscode` directories** under `examples/MicroBit_v2/ravenscar/**`. All 27
   `tasks.json` are byte-identical, all 27 `launch.json` are byte-identical **and broken**, and the
   root tasks make them dead weight. Purely cosmetic now.
3. **zfp**, per D2 — fix or delete.
4. Optional: repair the corrupt UTF-16 trailing line in the submodule's `.gitattributes`.

Then in the template: bump the pointer, and **delete the zfp line from `tools/known_failures.txt` in
the same commit** — the XPASS rule fails CI if you forget, which is the mechanism working.
Reconcile/close the open `origin/dependabot/submodules/...-c720a8b` PR at that point.

**Say this out loud in the README:** a repo created from a template has **no upstream link**, so
students who already instantiated will **not** receive the pointer bump. They keep the old SHA with
27 stale `.vscode` dirs — inert under the new root tasks, merely untidy. This is precisely why
step 2 must not be a prerequisite for anything.

---

## 6. End-to-end verification

Run in this order; each block is a gate for the next.

**Phase 0 — the hex**
1. `arm-eabi-objcopy -O ihex Code/obj/main Code/obj/main.hex`; `head -c1` is `:`; last line is
   `:00000001FF`.
2. `pyocd load -t nrf52833 --format hex Code/obj/main.hex` — proves the hex itself is good,
   independent of any browser.
3. Drag `main.hex` onto MICROBIT → runs. Drag the bare `main` → `FAIL.TXT`. *(This is the bug.)*

**Phase 1 — build & switching**
4. On a machine with **nothing** on PATH: `python3 tools/mb.py doctor` locates everything and names
   the toolchain version it selected.
5. Repo root open in VS Code, Ctrl+Shift+B → `build/main.elf|hex|bin`. Then
   `test -z "$(git status --porcelain -uall)"` in root **and** in the submodule; and
   `ls build/obj/Code/obj/main` exists (asserting relocation, not just a clean `.gitignore`).
6. **The core test, folder never closed:** *Choose project…* → `ravenscar/buttons` → builds and
   flashes. Then open `ravenscar/music/src/main.adb`, run *Use the file I'm looking at* → builds
   music. Then back to `my-project` — well under a second.
7. F5 with **no edit to launch.json** → breakpoint hits in the example you last built, **and the
   source file opens** (the copied-ELF / `DW_AT_comp_dir` check).
8. Deliberate syntax error → clickable entry in the **Problems** panel (proves `$ada-error`).
9. Windows: PowerShell profile, then Command Prompt, then Git Bash — identical behaviour
   (`type: process` never consults the shell). `git ls-files --eol tools/mb.py` → `i/lf w/lf`.
10. `python3 tools/mb.py build --all` → `27 PASS, 15 XFAIL`, exit 0.
    `--no-quarantine` → 15 FAIL, exit 1, showing all three distinct zfp errors.
11. Fresh clone, open in VS Code, **do not build**: no red squiggles in `Code/src/main.adb`
    (proves the committed `.als.json` works on your minimum extension version).

**Phase 2 — container**
12. "Use this template" → a repo with a *different* name → open a Codespace. Submodule initialised,
    `bash -lc 'gprbuild --version'` works, Ctrl+Shift+B builds, `main.hex` downloadable.
    *(This fails today at the very first `cd`.)*
13. Linux Docker host + host udev rule: `pyocd list` shows the board, Ctrl+Shift+B flashes.
14. macOS Docker: container starts, builds cleanly, `pyocd list` is **empty** — and the README
    documents that as the expected result.

**Phase 3 — CI**
15. Throwaway PR: all matrix legs green (macOS is the first-ever aarch64 exercise);
    `examples` green; `renamed` green; second run shows cache hits.
16. Instantiate the template into a **private** repo → exactly **one** job runs.

**Phase 5 — submodule**
17. After the fork PR + bump: `--all` turns 15 XFAIL into 15 PASS **and fails with XPASS** until
    `known_failures.txt` is edited. That failure is the design working.

---

## 7. Honest assessment — what is not worth doing

* **The GHCR image.** ~2 GB pulled instead of ~1 GB downloaded; the real wins are reproducibility and
  a reviewable pin, both of which a pinned `alr toolchain --select` in `devcontainer.json` already
  gives. Against that: a multi-arch buildx pipeline, a manifest-merge job, an irreversible package
  visibility setting, a dated-tag policy, and a workflow that ships to every student. Not for one
  lecturer.
* **WebUSB flashing.** Net new benefit over drag-and-drop is *skipping the unzip*. Cost: a
  hand-rolled ZIP central-directory parser, a vendored 39 KB minified bundle of a library with no
  release since December 2020, a Pages deployment, an instructor URL hardcoded into two files that
  propagate to every student copy, an unhandled Linux permission story, and a device-contention bug
  that breaks the *default* pyocd workflow. Wrong ratio.
* **Emulation (QEMU / Renode).** QEMU's `-M microbit` is the nRF51822 (v1); there is no nRF52833
  machine. A Renode platform would be a bespoke `.repl` only you can debug, to assert one
  `Put_Line`. Skip.
* **A browser debugger.** dapjs exposes no `step` and no `setBreakpoint` (verified: zero hits in the
  bundle). You would be programming FPB comparators and parsing DWARF to reproduce what
  `arm-eabi-gdb` + `pyocd gdbserver` already do.
* **`-XADL_BUILD_CHECKS=Enabled`.** Turns all warnings into errors; modern GNAT emits
  obsolescent-aggregate and unreferenced-formal warnings throughout ADL's own components. Every
  example would be red for reasons unrelated to student code.
* **Patching the submodule's `scripts/build_all_examples.py`.** It has four defects, not three — the
  fourth is `ret = ret or gprbuild(...)`, which short-circuits so **no project is built after the
  first failure**. It is an upstream file; patching deepens fork divergence for zero gain once
  `mb.py --all` exists. Leave a deprecation comment at most.
* **A multi-root `.code-workspace`.** It genuinely solves per-folder tasks, but re-creates 43
  `tasks.json` files, makes `${workspaceFolder}` ambiguous in `launch.json`, and — fatally for a
  template — a student who clicks *Open Folder* instead of *Open Workspace from File* silently gets
  none of it, with no error explaining why.
* **The Intel-HEX/vector-table verifier, the portability linter, and the ADL testsuite job.** All
  three were designed before anyone knew they could pass; two of them fail against the repo as it
  stands. See §2.
