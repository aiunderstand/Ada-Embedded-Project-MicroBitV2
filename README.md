<!-- No build badge here on purpose: a template is copied verbatim, so a badge
     pointing at the upstream repository would report the lecturer's build
     status inside every student's project. Check your own build under the
     Actions tab of your repository. -->

# Ada-Embedded-Project-MicroBitV2

Template for the USN BSc **Intelligent Real-Time Systems** course: Ada on the
BBC micro:bit v2.

## 1. Make your own copy

Click the green **Use this template** button at the top of this page and choose
**Create a new repository**. Give it a sensible name — it is your project for
the semester.

Everything below assumes you are working in *your* repository, not this one.

## 2. Pick how you want to work

| | Path | You install | Flashing | Debugging (F5) |
|---|---|---|---|---|
| 🟢 | **[In your browser](setup/codespace.md)** | **nothing** | from the browser | **[yes, from the browser](setup/debugging.md)** |
| 🔵 | **[On your own machine](setup/local.md)** | VS Code + Python, then one command | plugged in, or browser | **[yes](setup/debugging.md)** |

**Not sure?** Start with the browser. It needs nothing installed, works on a
school laptop or a Chromebook, and you can move to a local install later without
changing any code.

You need a **Chrome, Edge or Opera** browser to flash from the browser — Safari
and Firefox do not support WebUSB. Any browser works for editing.

## 3. Flash and read output

**<https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/>**

Connect the board, pick a firmware, flash it, and read `Put_Line` output at
115200 — all in one browser tab, nothing installed.

There are ready-built examples in the picker, so you can flash `music` or
`accelerometer` and see the board do something before writing any code.

**Working in a Codespace?** You do not have to download anything. Run the
**Flash from here (serve flasher)** task and open the forwarded port — the page
is then served from your Codespace with your own build already loaded.

## The keys, on both paths

The same keys do the same things on your own machine and in a Codespace:

| Key | Does | On your machine | In a Codespace |
|---|---|---|---|
| **Ctrl+Shift+B** (Cmd+Shift+B on a Mac) | Build | gprbuild, through Alire | the same, in the Codespace |
| **Ctrl+F5** | Build and flash | pyocd, over USB | the micro:bit flasher in your browser; the first time it asks which board |
| **F5** | Build, flash, and debug with breakpoints | pyocd | the flasher, through the companion |
| **Shift+F5** | Stop debugging | | |
| **Ctrl+Shift+P** → *Tasks: Run Task* | *Choose project…*, *Build & Flash*, *Prove (SPARK)*, *Erase*, *Doctor* | | |
| status bar, bottom left | **Flash micro:bit** (same as Ctrl+F5) and the chosen project (click to change) | | |

Serial output (`Put_Line`, 115200 baud) is the **micro:bit › Serial** view
in the panel, on both paths: it lists the micro:bit v2 boards it can see
(a v1 is shown but cannot be chosen), reads the one you pick, sends what you
type, and its **Show serial** box stops the reading when a program floods
the port. Unplug a board and it is dropped from the list.

## Debug with breakpoints

Set a breakpoint in `main.adb`, press **F5**, and step through your program on
the real board — on **both** paths, including in a browser Codespace. See
**[Debug with breakpoints](setup/debugging.md)** for the keys, the limits, and
how it works.

## What is in here

```
Code/src/main.adb           your program -- this is the file you edit
Code/itrs.gpr              the project file
Code/libs/Ada_Drivers_Library   drivers and 46 examples (a git submodule)
mb.py, tools/mb.py         the one tool: python mb.py setup | build | flash | prove ...
```

Common commands, from the repository root:

```shell
python3 mb.py doctor              # is my setup working?
python3 mb.py list                # what can I build?
python3 mb.py build               # build your project
python3 mb.py flash               # build and flash (needs a plugged-in board)
python3 mb.py build --use ravenscar/music   # build any example
python3 mb.py prove --use spark/bounded_queue
```

In VS Code, **Ctrl+Shift+B** builds, **Ctrl+F5** builds and flashes, **F5**
debugs, and *Tasks: Run Task* has the rest — including **Choose project…** for
building and flashing any of the 46 examples without closing the folder.

## Examples

`Code/libs/Ada_Drivers_Library/examples/MicroBit_v2/` has three families:

* **`ravenscar/`** — 27 examples using the full runtime: display, accelerometer,
  radio, motors, tasking.
* **`zfp/`** — 15 smaller examples on the light runtime.
* **`spark/`** — 4 examples that are *formally proved* with GNATprove, not just
  tested. Start with `spark/bounded_queue`.

## Automation in this template

* GitHub Actions builds your code on every push and publishes `main.hex` as a
  downloadable artifact.
* The same workflow checks the build on Linux, macOS and Windows, builds all 47
  projects, and proves the SPARK examples.
* Dependabot keeps the drivers submodule up to date, monthly.

## This template uses

Three extensions: the Ada language server (**AdaCore.ada**), the micro:bit
flasher (**AIUnderstand.microbit-flasher**), which a Codespace installs into
your browser by itself, and **Cortex-Debug** for F5 — installed in a Codespace,
offered locally the first time you press F5. [Alire](https://alire.ada.dev/)
supplies the toolchain.

## Working on the template (maintainers)

Building, testing and publishing the flasher and companion extensions is
documented in **[setup/extensions.md](setup/extensions.md)**. Repository-wide
working notes — the toolchain pins, the traps, the CI layout — are in
`CLAUDE.md`.

