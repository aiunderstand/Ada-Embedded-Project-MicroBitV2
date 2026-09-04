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

## 4. Flash the board, straight from the Codespace

You do not need to download anything.

> A Codespace runs in a data centre and has **no USB port**, so it cannot reach
> your board itself. What it *can* do is serve the flasher page to your own
> browser, which then talks to the board for it.

1. Press **Ctrl+Shift+P**, choose **Tasks: Run Task**, then
   **Flash from here (serve flasher)**.
2. VS Code shows a notification that port **8080** is available. Open the
   **PORTS** panel at the bottom, find *micro:bit flasher*, and click the
   **globe** icon to open it in your browser.
3. Plug the micro:bit in with a **data** USB cable — some cables only carry power.
4. Click **Connect**, pick the board, then **Flash**.

Your build is already selected under **Your latest build** — the page is being
served from the same Codespace that produced it.

`Put_Line` output appears in the **Output** panel of that page.

> It must be a real browser tab. VS Code's built-in **Simple Browser** is an
> iframe, and WebUSB does not work inside one. Use the globe icon, which opens a
> proper tab.

Rebuild, then just click **Flash** again — the page always serves the current
`build/main.hex`.

### If you would rather not run a server

Right-click **`build/main.hex`** in the Explorer, choose **Download**, and drop
it onto <https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/>.
That page also has ready-built examples if you just want to check your board and
cable work.

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
