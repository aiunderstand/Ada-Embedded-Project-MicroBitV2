# CLAUDE.md

Working notes for this repository. Most of what follows was learned by something
breaking; the reasons are recorded so they are not rediscovered the hard way.

## What this is

A **GitHub template** that Bachelor CS students instantiate to write Ada for the
BBC micro:bit v2 (nRF52833, Cortex-M4F). Students click *Use this template*, get
their own repository, and work either in a browser Codespace or on their own
machine.

It is a *teaching* repository maintained by one lecturer. Prefer the boring,
low-maintenance option over the clever one.

```
Code/src/main.adb                 the student's program -- the file they edit
Code/itrs.gpr                     the template project
Code/libs/Ada_Drivers_Library     git submodule -> aiunderstand/Ada_Drivers_Library (a fork we own)
tools/mb.py                       the one driver: build / flash / prove / serve / setup / extension
docs/                             the GitHub Pages flasher (index.html + app.mjs + vendor/)
extension/                        VS Code *web* extension: flashing from a Codespace
setup/                            per-path student guides
```

## Everything goes through `tools/mb.py`

```shell
python3 tools/mb.py setup          # make a fresh machine ready (idempotent)
python3 tools/mb.py doctor         # is the toolchain usable?
python3 tools/mb.py list           # every buildable project (47 today)
python3 tools/mb.py build [--use ID | --use-dir DIR | --all]
python3 tools/mb.py flash | erase
python3 tools/mb.py prove --all-spark --mode=prove --level=1
python3 tools/mb.py serve          # serve the flasher with the current build
python3 tools/mb.py extension --install
python3 tools/mb.py gallery --out site/firmware
```

Builds run `alr exec -- gprbuild -P <gpr> --root-dir=. --relocate-build-tree=build/obj`
from the repository root. That is what lets any project build without
changing the VS Code folder, and keeps object files out of the submodule.
Firmware is always staged at `build/main.elf/.hex/.bin`.

**Alire supplies the environment.** Nothing here requires editing `PATH`.

## Pinned versions, and why

| | | |
|---|---|---|
| `gnat_arm_elf` | **15.1.2** | **Not 16.1.0** — it fails to link with `.eh_frame LMA overlaps .data`, reproduced with plain `gprbuild`, so it is the bundled linker script, not Alire. |
| `gprbuild` | **25.0.1** | **Not 22.0.1** — that has *no aarch64 build at all*, so it breaks Apple Silicon and both arm64 CI legs. |
| `gnatprove` | **15.1.0** | Matches the compiler generation; has all five platform origins including linux/aarch64. |
| `alr` | **2.1.1** | SHA-256 of each platform archive is pinned in `mb.py`; Alire publishes no checksums. |

Alire *crate* versions do not match GNAT-FSF *tarball* names — crate
`gnat_arm_elf 15.1.2` lives in release `gnat-15.1.0-2`. Never hardcode tarball
URLs; let Alire resolve them.

## Testing

```shell
python3 tools/mb.py build --all      # every project PASS, 0 FAIL, 0 XPASS
python3 tools/mb.py prove --all-spark --mode=prove --level=1
node tools/test_flasher.mjs          # the browser flasher
node tools/test_extension.mjs        # the VS Code extension
```

**Prove that a new test can fail.** Break the thing deliberately, watch the
suite go red, restore. Several assertions here were written before anyone knew
whether they could fail — and `gnatprove` needs `--checks-as-errors=on`, because
it reports an unproved check and still exits 0.

`tools/known_failures.txt` uses XFAIL/XPASS: a quarantined project that starts
passing **fails** the run, so the list can only shrink. It is currently empty.

## The submodule is a fork we own

Fixes to examples go to `aiunderstand/Ada_Drivers_Library` first, then the
pointer is bumped here. Two repositories, two PRs. Never edit the submodule
in place and forget to push it — the parent will point at a commit that exists
only locally.

Batch fork work: it is the slowest part of any change.

## Traps that have actually bitten

**Filename case.** GNAT expects all-lowercase filenames. Four ADL files carried a
capital `RT` (`microbit-displayRT.ads`), which macOS and Windows resolve and
**Linux does not** — so every display example failed in the devcontainer,
Codespaces and CI. Caught by the CI matrix on its first run.

**Windows long paths.** The submodule carries a bundled Unity project with
171-character paths. Without `git config --global core.longpaths true` the clone
truncates and looks like a corrupt download.

**Windows on ARM is unsupported.** Alire publishes no ARM64 Windows build, and
the x64 one crashes on startup (`0xC0000005`). `mb.py setup` detects and says so.

**`$ada` is not a problem matcher.** The Ada extension contributes
`ada-error` / `ada-warning` / `ada-info`. Using `$ada` leaves the Problems panel
empty and toasts an error on every build.

**Alire chatter pollutes version probes.** `alr exec -- gprbuild --version` is
preceded by `Note: Synchronizing workspace...` and dependency-solve lines that
*contain digits*. `alr -q` suppresses the command's own output too, so `mb.py`
filters explicitly.

**Alire settings are per user.** The container is built as root and runs as
`vscode`; without a shared `ALIRE_SETTINGS_DIR` the toolchain selection made at
build time is invisible at runtime.

**Delete inside the layer that created the files.** The toolchain image strips 66
unused runtimes in the *same* `RUN` as the install. In a later layer the files
remain and the pull is unchanged — the image merely *looks* smaller.

**`git status` always exits 0.** Cleanliness guards must be
`test -z "$(git status --porcelain -uall)"`.

**Check a new keybinding against VS Code's defaults, per platform.** The
extension's first chord, `cmd+alt+f`, is *Replace* on a Mac; VS Code writes it
as `alt+cmd+f` (modifier order ctrl, shift, alt, cmd), so a grep for the chord
as you typed it finds nothing. Read the real tables out of a running VS Code:
`Preferences: Open Default Keyboard Shortcuts (JSON)`, or the `verify-ui` skill's
test-web recipe with a spoofed user agent for Windows and Linux.

**VS Code will not hot-swap a running extension.** `canRemoveExtension` is
false once activation has started, so reinstalling the same version into a
live window leaves it with a stale mix -- the new manifest's keybinding, no
command handler: `command 'microbit.flash' not found`. `postAttachCommand`
runs on *every* attach -- and a window reload *is* an attach -- so `mb.py
extension --install` compares the installed copy with what it would install and
touches nothing when identical; when it does replace one it says to run
`Developer: Reload Window`. VS Code appends `__metadata` to the installed
`package.json`, so that comparison is JSON-with-the-key-dropped, not bytes.

**The extension's version is derived from its content.** VS Code Server serves
anything under its extensions folder with `Cache-Control: public,
max-age=31536000` (`remoteExtensionHostAgentServer.ts`, when built -- i.e. in
every Codespace), at a URL that contains only `<publisher>.<name>-<version>`.
Reinstall changed code under the same version and, after a reload, the manifest
arrives fresh over RPC while the worker's `extension.js` comes from the browser
cache: a year-old file with a new keybinding pointing at it. So `mb.py
extension` sets the patch number from a hash of the package; `extension/
package.json` keeps `0.1.0` and only its major.minor are used. Do not "fix" the
odd-looking version.

**`vscode.tasks.executeTask` is NotSupported in the web worker host.** The
worker's `ExtHostTask` only accepts `CustomExecution` tasks; a shell or process
task like "Build" throws `NotSupported` before anything runs. Use
`workbench.action.tasks.runTask` (any host, runs on the remote) and wait for
`tasks.onDidEndTaskProcess` by task name. `@vscode/test-web` did not show this,
because without a remote `fetchTasks()` returns nothing and the build is
skipped; `code serve-web` did.

## Codespaces

A Codespace has **no USB**. Three consequences:

1. `mb.py flash` cannot work there; it detects this and says so.
2. Flashing goes through the **VS Code web extension** in `extension/`. It is a
   *web* extension, so VS Code loads it into the browser's extension host — on
   the student's machine, where the board is — and reaches `navigator.usb` there.
   Device authorisation uses `workbench.experimental.requestUsbDevice`, filtered
   to vendor `0x0d28`.
3. A **VS Code webview cannot do this**: webview iframes are not granted
   `allow="usb"`. Rendering-only integrations (e.g. Surfer) work in a webview;
   device access does not.

Port forwarding (`mb.py serve`) exists and works locally, but was unreliable in a
real Codespace. Keep it as a fallback, not the documented path.

The extension is packaged by `mb.py` with Python's `zipfile` — a `.vsix` is a zip
with a manifest. **Do not add node/npm to the image** for this; it would cost
~120 MB and an `npm ci` on every attach.

## CI

One workflow, `ada.yml`. Only the `build` job runs in student repositories —
everything else is gated on `github.repository`, because a template instance is
**not a fork**, so `schedule:` crons are not auto-disabled and macOS minutes bill
at 10×.

`examples` runs in the prebuilt toolchain image. `build`, `matrix` and `prove`
deliberately do not: `build` must never depend on the registry, `matrix` exists
to prove the *native* install still works, and `prove` needs gnatprove, which is
an Alire crate rather than a toolchain component.

## Conventions

- Comments explain **why**, not what. Especially where the obvious approach was
  tried and failed.
- No committed build artifacts. `build/` and `__pycache__/` are ignored.
- Student-facing text should name the actual mistake ("use `main.hex`, not
  `main`, which is an ELF"), not just report failure.
