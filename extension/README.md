# micro:bit v2 Flasher

Build your program and flash it to a BBC micro:bit v2 over WebUSB, from inside
VS Code — including a **GitHub Codespace**, which has no USB port of its own.

One key does the whole job: **Ctrl+Alt+F** (Control+Option+F on a Mac), or the
**Flash micro:bit** button in the status bar. It runs the workspace **Build**
task, then flashes `build/main.hex`. The first time, the browser asks which USB
device to use — choose the micro:bit. Serial output from the board appears in
the **micro:bit** output channel.

Made for the [Ada micro:bit course template](https://github.com/aiunderstand/Ada-Embedded-Project-MicroBitV2);
it flashes any Intel HEX at `build/main.hex`, whatever produced it.

## Where it runs

This is a *web* extension: VS Code runs it in the **browser**, on your own
machine, where the board is plugged in — not in the Codespace, which cannot see
your USB ports. Install it from the Extensions view of a Codespace opened in the
browser (or vscode.dev / github.dev); if VS Code offers a choice, pick *Install
in Browser*. Installed *into* the Codespace it can never start.

It needs a Chromium browser — Chrome, Edge or Opera. Safari and Firefox have no
WebUSB. In desktop VS Code there is no WebUSB either; flash with
`python3 tools/mb.py flash` from the course template instead.

## Commands

| Command | |
|---|---|
| `micro:bit: Build and flash` | **Ctrl+Alt+F** — build, then flash `build/main.hex` |
| `micro:bit: Connect board` | authorise the board and start the serial console |
| `micro:bit: Show connection status` | what the extension can see |

## Source

`extension/` in the template repository. `python3 tools/mb.py extension`
assembles this folder, bundling
[@microbit/microbit-connection](https://github.com/microbit-foundation/microbit-connection)
into it; it is published with `vsce` by the repository's workflow.
