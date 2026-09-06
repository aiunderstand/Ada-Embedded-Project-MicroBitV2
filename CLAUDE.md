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
tools/mb.py                       the one driver: build / flash / prove / serve / setup / extension / companion
docs/                             the GitHub Pages flasher (index.html + app.mjs + vendor/)
extension/                        VS Code *web* extension: flashing from a Codespace (runs in the browser)
extension/gdbserver.js            ... and a GDB remote-protocol server, so F5 works there too
companion/                        its Codespace-side helper: installs the flasher into the browser, relays gdb to it
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
python3 tools/mb.py extension [--out DIR] [--version V]   # the web extension, as a folder
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
node tools/test_gdbserver.mjs        # the gdb server, on a fake board
node tools/test_companion.mjs        # the companion's gdb relay, over a real socket
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

**A template literal interprets `\n`.** The Serial view's HTML is a template
literal in `extension.js`; a `"\n"` meant for the view's own script arrived as
a real line break inside a string, the script died with a syntax error, and the
view sat at "Not connected" while the extension posted into it. Write `\\n`
there, and run the view's script for real: `tools/test_extension.mjs` parses
it, and the `verify-ui` skill drives the HTML in Chromium.

**Check a new keybinding against VS Code's defaults, per platform.** The
extension's first chord, `cmd+alt+f`, is *Replace* on a Mac; VS Code writes it
as `alt+cmd+f` (modifier order ctrl, shift, alt, cmd), so a grep for the chord
as you typed it finds nothing. Read the real tables out of a running VS Code:
`Preferences: Open Default Keyboard Shortcuts (JSON)`, or the `verify-ui` skill's
test-web recipe with a spoofed user agent for Windows and Linux.

**Never install the extension into the Codespace, and only the Marketplace can
deliver it.** Installed into the Codespace, it cannot run in the browser client:
the web worker host lives on another origin (`assets.github.dev`), its fetch of
`extension.js` bypasses GitHub's routing for the page and gets a 404, and the
worker logs `Activating extension … failed: Error:` with nothing after it
(HTTP/2 has no status text) — microsoft/vscode **#144513**, open since 2022.
Served from anywhere else (GitHub Pages, *Install Extension from Location*),
the page's `connect-src` blocks it: the Codespaces allow-list has the
Marketplace CDNs and not `github.io`. A day went into the attach-time `.vsix`
install — hot-swap rules, a one-year cache, `__metadata`, `.obsolete`, file
modes — all real, all beside the point. `code serve-web` shows neither: its
worker is same-origin and its policy allows any `https:`.

**`vscode.tasks.executeTask` is NotSupported in the web worker host.** The
worker's `ExtHostTask` only accepts `CustomExecution` tasks; a shell or process
task like "Build" throws `NotSupported` before anything runs. Use
`workbench.action.tasks.runTask` (any host, runs on the remote) and wait for
`tasks.onDidEndTaskProcess` by task name. `@vscode/test-web` did not show this,
because without a remote `fetchTasks()` returns nothing and the build is
skipped; `code serve-web` did.

## Codespaces

A Codespace has **no USB**. Five consequences:

1. `mb.py flash` cannot work there; it detects this and says so.
2. Flashing goes through the **VS Code web extension** in `extension/`. It is a
   *web* extension, so VS Code loads it into the browser's extension host — on
   the student's machine, where the board is — and reaches `navigator.usb` there.
   Device authorisation uses `workbench.experimental.requestUsbDevice`, filtered
   to vendor `0x0d28`.
3. A **VS Code webview cannot do this**: webview iframes are not granted
   `allow="usb"`. Rendering-only integrations work in a webview; device access
   does not. The serial console *is* a webview view — the extension holds the
   device and the view only shows and asks.

4. The extension must be **installed in the browser, from the Marketplace** —
   Never listed in `devcontainer.json`, which installs into the container.
   Nothing in a repository can put it into a student's browser -- except an
   extension already running: `companion/` is a plain Node extension, listed
   in `devcontainer.json`, that on startup runs
   `workbench.extensions.installExtension` for the flasher, and the workbench
   installs a web-only extension in the browser (the same path as clicking
   Install). `.vscode/extensions.json` recommends the flasher as well.
   Settings Sync is off by default in the Codespaces web client, so without
   the companion the recommendation prompt is the floor. The USB picker only
   appears within a few
   seconds of a user gesture, so `cmdFlash` asks for the device *before* it
   builds, and Connect/Disconnect/Flash are native view-header buttons rather
   than buttons inside the webview.

   `AIUnderstand.microbit-flasher` — never into the Codespace (see the trap
   above). `setup/publishing.md` is the lecturer's publishing procedure.

5. **F5 debugs through the browser.** Cortex-Debug (installed in the
   container) starts `arm-eabi-gdb` there and connects it to the companion's
   loopback port (3333 when free; a reloaded tab leaves the old extension
   host holding it for minutes, so any free port otherwise, and the launch
   rewrite carries the real one). Every gdb packet is forwarded, as one
   cross-host `executeCommand`, to the flasher, whose `GdbServer`
   (`extension/gdbserver.js`) answers it over the board's USB connection.
   The relay sits at the *packet* boundary on purpose: one round trip per
   gdb packet, with the dozens of SWD transfers each needs staying in the
   browser. pyocd in the container with the browser as a remote probe would
   pay that round trip per SWD transfer, 50-100 times per stop.

   The one launch configuration says `pyocd`; the companion rewrites it to
   `external` when the UI is a browser, so locals and Codespaces share it.
   Breakpoints are FPB comparators — six on this Cortex-M4, and `Z0` is
   served as hardware too, the code being in flash. Single-steps mask
   interrupts (`C_MASKINTS`), or Ravenscar's timer drags every step into the
   runtime. gdb's `load` is served through the library's own `flash()`, which
   ends by resetting the board to *run*, so the server halts it again. A
   target description is served because without one gdb assumes FPA
   registers in the `g` packet. No user gesture reaches an attach, so the
   board must already be connected; the attach says which button to press.
   The relay detaches the browser *before* it drains its packet queue: a
   pending `continue` ends only when the server detaches, so the other order
   deadlocked and refused every later gdb as "a second connection". And the
   FPB's NUM_CODE is split across bits 14:12 and 7:4 -- decoding it from the
   wrong bits went unnoticed on silicon because this chip's high bits are 0.

`python3 tools/mb.py extension` assembles the publishable folder (bundling the
vendored library into `extension.js`); `ada.yml` proves it packages with `vsce`
on every push, and `publish-extension.yml` publishes it by hand as
`0.1.<run number>`. **Do not add node/npm to the container image** for any of
this; the runners have node, the container does not need it.

Port forwarding (`mb.py serve`) exists and works locally, but was unreliable in a
real Codespace. Keep it as a fallback, not the documented path.

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
