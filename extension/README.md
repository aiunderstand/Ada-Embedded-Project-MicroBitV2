# micro:bit v2 Flasher

Build your program and flash it to a BBC micro:bit v2 over WebUSB, from inside
VS Code — including a **GitHub Codespace**, which has no USB port of its own.

One key does the whole job: **Ctrl+Shift+B** (Cmd+Shift+B on a Mac), the same
key that builds and flashes on your own machine, or the **Flash micro:bit**
button in the status bar. It runs the workspace **Build**
task, then flashes `build/main.hex`. The first time, the browser asks which USB
device to use — choose the micro:bit. Then the **micro:bit › Serial** view
opens in the bottom panel: your program's output over the same USB connection,
an input field to send it a line (Enter sends CR LF), **Clear**, and header
buttons to **connect**, **flash** and **disconnect**. The **micro:bit** output
channel carries the extension's own log.

Made for the [Ada micro:bit course template](https://github.com/aiunderstand/Ada-Embedded-Project-MicroBitV2);
it flashes any Intel HEX at `build/main.hex`, whatever produced it.

## Debugging with breakpoints

In a Codespace, **F5** works through this extension as well. `arm-eabi-gdb`
runs in the Codespace, where the program's symbols are; the companion
extension there opens a port for it and forwards every gdb packet to this
extension, which answers over the board's USB connection: halting, stepping,
registers, memory, six hardware breakpoints, and gdb's `load`, which flashes.
The first time, F5 asks which USB device to use, just as Ctrl+Shift+B does; after
that the board is remembered. The `micro:bit: (internal) gdb …` commands are
the companion's end of that conversation, not for people.

## Where it runs

This is a *web* extension: VS Code runs it in the **browser**, on your own
machine, where the board is plugged in — not in the Codespace, which cannot see
your USB ports. Install it from the Extensions view of a Codespace opened in the
browser (or vscode.dev / github.dev); if VS Code offers a choice, pick *Install
in Browser*. Installed *into* the Codespace it can never start.

It needs a Chromium browser — Chrome, Edge or Opera. Safari and Firefox have no
WebUSB. Desktop VS Code has no USB picker, so there the **Flash micro:bit** button runs the
workspace's **Build & Flash** task instead, which flashes with pyocd (the course
template's `python3 tools/mb.py flash`); the Serial view cannot connect there,
so the output is read with Microsoft's Serial Monitor extension at 115200 baud.

## Commands

| Command | |
|---|---|
| `micro:bit: Build and flash` | **Ctrl+Shift+B** in the browser — build, then flash `build/main.hex` |
| `micro:bit: Connect board` | authorise the board and open the Serial view |
| `micro:bit: Disconnect board` | let go of the board, e.g. before another tab uses it |
| `micro:bit: Open serial console` | the Serial view: output, an input field, Send, Clear |
| `micro:bit: Show connection status` | what the extension can see |

## Source

`extension/` in the template repository. `python3 tools/mb.py extension`
assembles this folder, bundling
[@microbit/microbit-connection](https://github.com/microbit-foundation/microbit-connection)
into it; it is published with `vsce` by the repository's workflow.
