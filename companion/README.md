# micro:bit Companion (Codespaces)

The half of the [micro:bit v2 Flasher](https://marketplace.visualstudio.com/items?itemName=AIUnderstand.microbit-flasher)
that lives inside a GitHub Codespace.

The flasher is a *web* extension: it runs in your browser, where the USB port
is. A Codespace can install extensions into its container automatically, but
not into your browser — except by asking. This extension is installed into the
container by the course template's `devcontainer.json`; when the Codespace
opens, it asks VS Code to install the flasher, and VS Code puts it in the
browser. You then plug the board in and press **Ctrl+Alt+F**.

If that ever fails, run `micro:bit: Install the flasher in this browser` from
the command palette. In desktop VS Code it does nothing: flash with
`python3 tools/mb.py flash` there.

It is also the Codespace end of **F5**. Cortex-Debug starts `arm-eabi-gdb`
inside the Codespace; this extension opens a loopback port for it and forwards
each gdb packet to the flasher in your browser, where the board is. The
template's launch configuration says pyocd, which is right on a local machine;
in the browser it is steered at that port automatically.

Made for the [Ada micro:bit course template](https://github.com/aiunderstand/Ada-Embedded-Project-MicroBitV2).
