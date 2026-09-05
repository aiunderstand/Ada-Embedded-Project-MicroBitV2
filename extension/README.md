# micro:bit v2 Flasher (VS Code web extension)

Flashes `build/main.hex` to a micro:bit v2 over WebUSB, from inside VS Code —
including a **Codespace**, which has no USB port of its own.

## Why this exists

A Codespace runs in a data centre. Its terminal, its filesystem and `pyocd` are
all on a remote machine that cannot see your board. Port forwarding does not
solve it either.

A VS Code **web** extension is different: VS Code loads it into the *web
extension host running in your browser*, on your own laptop, where the board is
plugged in. So `navigator.usb` is reachable from here even though it is not
reachable from the Codespace shell.

Authorising a device needs a user gesture, which an extension does not have, so
the picker is opened through a VS Code built-in:

```js
vscode.commands.executeCommand("workbench.experimental.requestUsbDevice",
                              { filters: [{ vendorId: 0x0d28 }] });
```

It is marked experimental but is present in current VS Code, and is the same
mechanism the ESP-IDF Web extension uses.

## Commands

| Command | Does |
|---|---|
| `micro:bit: Flash build/main.hex` | flashes the current build |
| `micro:bit: Connect board` | connects and starts streaming serial output |
| `micro:bit: Show connection status` | reports whether WebUSB is reachable |

## Building it

```shell
python3 tools/mb.py extension            # packages build/microbit-flasher-*.vsix
python3 tools/mb.py extension --install  # ...and installs it into this VS Code
```

There is deliberately **no npm build**. A `.vsix` is a zip with a manifest, so
`mb.py` writes one with Python's `zipfile` — the container has no node, npm or
vsce, and this way it does not need them. The devcontainer runs the install
command on every attach.

`extension.js` is bundled at package time with the library from
`docs/vendor/microbit-connection-usb.mjs`, so the browser flasher and this
extension share one copy. The ESM `export` clause is rewritten to `globalThis`
assignments, because the web extension host loads a **classic** worker script.

## Limitations

* **Chromium browsers only** — Chrome, Edge, Opera. WebUSB is not in Safari or
  Firefox.
* **Not in desktop VS Code.** There the extension host is Node, which has no
  `navigator.usb`; it says so and points you at `python3 tools/mb.py flash`.
* Partial flashing is never used: it is a MakeCode feature that depends on that
  toolchain's flash layout.
