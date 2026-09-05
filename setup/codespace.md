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
> because it is a VS Code **web extension**: VS Code loads it into your
> *browser*, on your own laptop, where the board is actually plugged in.

The extension is built and installed automatically when the Codespace starts.

1. Plug the micro:bit in with a **data** USB cable — some cables only carry power.
2. Click **Flash micro:bit** in the status bar, at the bottom of the window.
   (Or press **Ctrl+Alt+F** — **Cmd+Alt+F** on a Mac.)
3. The first time only, your browser asks which device to use — choose the
   micro:bit.

That one action **builds and flashes**. You do not need to build first, and it
can never flash yesterday's firmware by mistake.

A progress notification shows the flash, and `Put_Line` output appears in the
**micro:bit** output channel. After the first time, the board reconnects by
itself when the Codespace opens, so there is no device prompt again.

Change your code and click the same button.

**Use Chrome, Edge or Opera.** Safari and Firefox do not implement WebUSB.

### If that does not work

Right-click **`build/main.hex`** in the Explorer, choose **Download**, and drop
it onto <https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/>. That
page also has ready-built examples for checking your board and cable.

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
