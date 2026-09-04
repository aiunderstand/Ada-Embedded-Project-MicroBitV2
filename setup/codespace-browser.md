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

VS Code opens in your browser. The first start takes a couple of minutes while
it prepares the toolchain — you only pay this once per Codespace.

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

> A Codespace runs on a machine in a data centre, so it has **no USB port** and
> cannot flash your board directly. That is what the next step is for.

## 4. Get the firmware onto your computer

In the **Explorer** panel on the left, open the `build` folder, right-click
**`main.hex`** and choose **Download**.

It lands in your browser's Downloads folder.

## 5. Flash the board

Plug the micro:bit into your computer with a **data** USB cable — some cables
only carry power.

Open the flasher:

**<https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/>**

1. Click **Connect** and pick the micro:bit from the list.
2. Drop in the `main.hex` you just downloaded.
3. Click **Flash**.

Your program runs, and its `Put_Line` output appears in the **Output** panel of
that page.

> **In a hurry?** The same page has ready-built examples in a dropdown. Flash
> `music` or `accelerometer` to check your board and cable work, before worrying
> about your own code.

## 6. Commit your work

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
