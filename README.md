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
| 🟢 | **[In your browser](setup/codespace.md)** | **nothing** | from the browser | no |
| 🔵 | **[On your own machine](setup/local.md)** | VS Code + Python, then one command | plugged in, or browser | **yes** |

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

## What is in here

```
Code/src/main.adb           your program -- this is the file you edit
Code/itrs.gpr              the project file
Code/libs/Ada_Drivers_Library   drivers and 46 examples (a git submodule)
tools/mb.py                build / flash / prove driver
```

Common commands, from the repository root:

```shell
python3 tools/mb.py doctor              # is my setup working?
python3 tools/mb.py list                # what can I build?
python3 tools/mb.py build               # build your project
python3 tools/mb.py flash               # build and flash (needs a plugged-in board)
python3 tools/mb.py build --use ravenscar/music   # build any example
python3 tools/mb.py prove --use spark/bounded_queue
```

In VS Code, **Ctrl+Shift+B** does the common one, and *Tasks: Run Task* has the
rest — including **Choose project…** for building any of the 46 examples without
closing the folder.

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

Ada Language Server, EditorConfig, Cortex-Debug, CPPtools, VS Code Serial
Monitor, and [Alire](https://alire.ada.dev/) for the toolchain.
