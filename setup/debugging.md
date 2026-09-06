# Debug with breakpoints

Set a breakpoint, press **F5**, and your program stops on that line so you can
look at variables and step through it. This works on **both** paths — in a
browser Codespace and on your own machine — with the same keys. Only how the
debugger reaches the board differs, and that difference is handled for you.

## What you get

- **Breakpoints.** Click in the left margin of `main.adb` (a red dot appears),
  or press **F9** on a line.
- **Step and run.** **F10** steps over a line, **F11** steps into a call,
  **Shift+F11** steps out, **F5** continues, the pause button stops a running
  program.
- **Inspect.** The *Run and Debug* view (the play-with-a-bug icon in the left
  bar) shows local variables, the call stack, and a *Watch* box where you can
  type an expression. Hover over a variable in the editor to see its value.
- **Serial keeps flowing.** `Put_Line` output still appears — in the
  **micro:bit › Serial** view in a Codespace, or your serial terminal locally —
  while the program is stopped.

**F5 always debugs whatever you built last**, staged at `build/main.elf`. Pick a
different project with **Choose project…** (or `mb.py build --use …`) and F5
follows it. There is nothing to edit in `.vscode/launch.json`.

## In a browser Codespace

Set a breakpoint and press **F5**. The first time, the browser asks which USB
device to use — choose the micro:bit, as for Ctrl+Alt+F; after that the board
is remembered and F5 goes straight ahead. It builds, flashes, and stops at the
breakpoint.

> The board is asked for at the keypress, before the build, because the browser
> shows its device picker only while it is handling a real click or key. Dismiss
> the picker and nothing starts.

> **How it reaches the board.** The debugger (`arm-eabi-gdb`) runs in the
> Codespace, where your program's symbols are; the board is plugged into your
> own laptop. The flasher carries every debugger request between the two over
> the same USB connection it flashes with. So each step travels to the data
> centre and back — slower than on a local machine, but fine for stepping
> through a program. *micro:bit: Show connection status* prints the round-trip
> time if you are curious why a step takes a moment.

## On your own machine

Debugging uses the **Cortex-Debug** extension. The first time you press **F5**,
VS Code offers to install it — accept. (Locally the board is on your own USB
port through `pyocd`, so there is no data-centre round trip and stepping is
snappier.)

Set a breakpoint and press **F5**. The program stops there.

## Limits

The chip's debug unit sets these, on **both** paths:

- **Six hardware breakpoints.** Stepping *over* a procedure call borrows one
  while it runs, so keep your own to **five** to be safe. A seventh breakpoint,
  or stepping over a call with six already set, fails with *Cannot insert
  breakpoint*.
- **No watchpoints.** Stopping when a variable *changes* is not available; use a
  breakpoint on the line that changes it.

## Troubleshooting

**F5 says "Connect the micro:bit first" (Codespace).** The picker was
dismissed, or the flasher had not finished starting when you pressed F5. Press
F5 again and choose the board; or press the **plug** button in the Serial view's
header first.

**F5 says the flasher is not running in this browser (Codespace).** The flasher
has to be installed in your **browser**, not in the Codespace — see
[section 4 of the browser guide](codespace.md#4-flash-the-board-straight-from-the-codespace).

**Stepping is slow (Codespace).** Expected: every step crosses to your browser
and back. Set fewer breakpoints and use *Continue* (F5) between points of
interest rather than single-stepping long stretches. The
[local install](local.md) is faster if you have a machine to use.

**"Cannot insert breakpoint 0" / a step fails.** You have six breakpoints set
and a step-over needs a seventh. Remove one; see [Limits](#limits).

**F5 does nothing / no *Run and Debug* configuration (local).** Accept the
Cortex-Debug install prompt, or install **marus25.cortex-debug** from the
Extensions view, then press F5 again.
