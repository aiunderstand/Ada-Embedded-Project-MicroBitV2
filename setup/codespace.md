# Path 🟢 — work entirely in your browser

Nothing to install. Works on a school laptop, a Chromebook, or a machine where
you cannot install software.

You need a **Chrome, Edge or Opera** browser to flash the board. Editing works in
any browser.

---

## 1. Open a Codespace

In **your** repository (the one you made with *Use this template*):

1. Click the green **Code** button.
2. Choose the **Codespaces** tab.
3. Click **Create codespace on main**.

VS Code opens in your browser. The first start takes a few minutes while it
downloads the prebuilt toolchain image (about 600 MB), so it depends on the
connection.

**You only pay that once per Codespace.** Stopping and reopening the same one
costs nothing — it is only *creating* a Codespace that downloads anything.

When it is ready, the terminal at the bottom shows the setup check:

```
Build tools (required):
  OK       alr: alr 2.1.1
  OK       gprbuild: GPRBUILD 25.0.1
  OK       arm-eabi-gcc: 15.1.0
```

If anything says `MISSING`, see [Troubleshooting](#troubleshooting).

## 2. Edit your program

Open **`Code/src/main.adb`**. That is your program — the rest of the repository
is drivers and examples.

Fill in your name at the top, and change the message:

```ada
Put_Line ("Hello from <your name>!");
```

## 3. Build it

Press **Ctrl+Shift+B** (**Cmd+Shift+B** on a Mac).

The terminal shows the build and finishes with something like:

```
Memory region         Used Size  Region Size  %age Used
           flash:      136528 B       512 KB     26.04%
mb: firmware: build/main.elf, build/main.hex, build/main.bin
```

`build/main.hex` is the file you flash.

## 4. Flash the board, straight from the Codespace

No download, no file to drag.

> A Codespace runs in a data centre and has **no USB port**. The flasher works
> because it is a VS Code **web extension**: VS Code runs it in your
> *browser*, on your own laptop, where the board is actually plugged in.

**The flasher installs itself into your browser** the first time the Codespace
opens — a small companion extension inside the Codespace asks VS Code to do it,
and a message says so. Give it a minute; **Flash micro:bit** then sits at the
bottom-left of the window.

If it never appears: run `micro:bit: Install the flasher in this browser` from
the command palette (**Ctrl+Shift+P**, **Cmd+Shift+P** on a Mac). Failing that,
open the Extensions view (**Ctrl+Shift+X**), type `AIUnderstand.microbit-flasher`
in its search box, and click **Install** on *micro:bit v2 Flasher*.

> Why does this one need help when the Ada extension just appears? Those run
> *inside* the Codespace; the flasher has to run in your **browser**, where the
> USB port is, and only something already running in VS Code can put it there.

Then, every time:

1. Plug the micro:bit in with a **data** USB cable — some cables only carry power.
2. Click **Flash micro:bit** in the status bar, at the bottom of the window.
   (Or press **Ctrl+Alt+F** — on a Mac that is **Control+Option+F**, not Command.)
3. The first time only, your browser asks which device to use — choose the
   micro:bit.

That one action **builds and flashes**. You do not need to build first, and it
can never flash yesterday's firmware by mistake.

After the flash, a **micro:bit › Serial** view opens in the bottom panel, next
to *Terminal*: everything your program `Put_Line`s appears there, over the same
USB connection. Type a line in the field at the bottom and press **Enter** (or
**Send**) to send it to your program — `MicroBit.Console.Get` receives it one
character at a time, ending in CR LF, the same line ending `Put_Line` writes.
**Clear** empties the view. Its header has three buttons: **plug** connects
to the board, **⚡** builds and flashes (the same as Ctrl+Alt+F), and, once
connected, **disconnect** lets go of the board — do that before using the
board from another program or tab. Closed the view? Run `micro:bit: Open
serial console` from the command palette.

A progress notification shows the flash, and `Put_Line` output appears in the
**micro:bit** output channel. After the first time, the board reconnects by
itself when the Codespace opens, so there is no device prompt again.

Change your code and click the same button.

**Use Chrome, Edge or Opera.** Safari and Firefox do not implement WebUSB.

### If that does not work

Right-click **`build/main.hex`** in the Explorer, choose **Download**, and drop
it onto <https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/>. That
page also has ready-built examples for checking your board and cable.

## 4½. Try one of the examples

The drivers library ships 46 example programs. Press **Ctrl+Shift+B**, pick
**Choose project…**, and choose one — say `ravenscar/buttons`. That builds it
and *remembers* it: from then on **Ctrl+Alt+F** builds and flashes that example,
and the message after the flash names it. To go back to your own program,
choose **template**. (*Build the file I'm looking at* does the same for whatever
example's `main.adb` is open in the editor.)

## 5. Commit your work

Codespaces are not backups. Commit whenever you finish something:

1. Click the **Source Control** icon in the left bar (the branching arrows).
2. Type a short message describing what you changed.
3. Click **Commit**, then **Sync Changes**.

You are already signed in, so there is no password to enter. Your code is now on
GitHub, and Actions will build it and publish `main.hex` under the **Actions**
tab as well.

---

## Good to know

**Stop your Codespace when you finish.** It keeps running otherwise and uses
your free monthly hours. Go to <https://github.com/codespaces> and click the
**…** next to yours, then **Stop codespace**. Your files are kept.

**You can come back to it.** The same menu reopens it with everything as you
left it.

**Debugging with breakpoints (F5) does not work here** — that needs a real USB
connection to the board. Use `Put_Line` to print what is happening, or move to
the [local install](local.md) later in the course.

## Troubleshooting

**The setup check shows `MISSING`.** Rebuild the container: press
**Ctrl+Shift+P**, type `Rebuild Container`, and run it.

**Ctrl+Shift+B does nothing.** Make sure a file is open and that you accepted the
"Do you trust the authors of this folder?" prompt. Declining puts VS Code in
Restricted Mode, which disables the build tasks.

**The flasher says no devices found.** Use a data cable, not a charge-only one,
and use Chrome, Edge or Opera. On Linux see the note on the flasher page about
the udev rule.

**The flasher shows "Activating…" forever, or Ctrl+Alt+F says
`command 'microbit.flash' not found`.** The extension ended up installed *in the
Codespace* instead of in your browser, and there it can never start — a
long-standing VS Code limitation, not something you did. In the Extensions
view, find *micro:bit v2 Flasher*; if it says it is installed in the Codespace,
uninstall it there and use **Install in Browser** instead.

**The first flash says "Must be handling a user gesture".** The browser shows
the USB picker only right after your keypress. Press Ctrl+Alt+F again; the
board is asked for first, before the build, and once chosen it is remembered.

**Flash micro:bit never appears after installing.** Use Chrome, Edge or Opera —
Safari and Firefox have no WebUSB. Then check *Show Running Extensions* in the
command palette: the flasher should be listed under **web worker** with an
activation time.
