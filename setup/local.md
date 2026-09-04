# Path 🔵 — work on your own machine

The full setup. It takes about 15 minutes and roughly 2 GB of disk, and it is
the **only** path where you can flash directly and use breakpoint debugging
(F5).

Tested on Windows 11, Ubuntu 22.04+, and macOS 15+ (Intel and Apple Silicon).

---

## 1. Install four things

| | Where |
|---|---|
| **VS Code** | <https://code.visualstudio.com/download> |
| **Python 3.12+** | <https://www.python.org/downloads/> |
| **Git** | <https://git-scm.com/downloads> or [GitHub Desktop](https://github.com/apps/desktop) |
| **Alire 2.1+** | <https://alire.ada.dev/> |

> **Windows:** when installing Python, tick **"Add python.exe to PATH"** on the
> first screen. Do not use the Microsoft Store version — it is sandboxed and the
> build tools cannot see it.

You do **not** need to install a compiler. Alire does that in step 3.

## 2. Get the code

Clone **your** repository — the one you made with *Use this template* — with its
submodules:

```shell
git clone --recurse-submodules https://github.com/YOUR_NAME/YOUR_REPO.git
cd YOUR_REPO
```

> Do **not** download the repository as a ZIP. GitHub's ZIP does not contain
> submodules, so the drivers would be missing and nothing would build.

> **Windows:** if the clone fails part way through with `Filename too long`,
> run `git config --global core.longpaths true`, delete the folder and clone
> again. The drivers library contains a bundled Unity project with paths longer
> than Windows allows by default. (The setup command below sets this for you,
> but the clone happens first.)

## 3. Run the setup command

```shell
python3 tools/mb.py setup
```

On Windows, use `python` instead of `python3`.

That is the whole installation. It:

* installs **Alire** if you do not have it, verifying the download against a
  pinned checksum;
* installs the pinned compiler (`gnat_arm_elf` 15.1.2) and `gprbuild` 25.0.1 —
  about 550 MB, unpacking to roughly 2 GB, so it takes a few minutes;
* fetches the drivers submodule if it is missing;
* sets the two Windows settings this project needs;
* installs `pyocd` so you can flash and debug over USB (skip with `--no-pyocd`);
* finishes by checking everything.

**You do not edit `PATH`, and you do not reboot.** Every build runs through
Alire, which sets the environment itself.

It is safe to run again — it skips whatever is already done, so it doubles as a
repair command.

You should see:

```
  OK       alr: alr 2.1.1
  OK       gprbuild: GPRBUILD 25.0.1
  OK       arm-eabi-gcc: 15.1.0
  OK       arm-eabi-objcopy: GNU objcopy (GNU Binutils) 2.44

Build environment looks good.
```

> **Windows on ARM does not work.** Alire publishes no ARM64 Windows build, and
> the x86-64 one crashes under Windows' emulation (verified on Windows 11
> ARM64). Use the [browser path](codespace.md) instead — it needs nothing
> installed — or an x86-64 Windows machine, a Mac, or Linux. The setup command
> detects this and tells you rather than failing strangely.

## 4. Open the project

Open VS Code and use **File → Open Folder** on the **root** of the repository —
the folder containing `README.md`. Not `Code/`, and not an example folder.

* Answer **Yes, I trust the authors** when asked. Declining puts VS Code in
  Restricted Mode, which disables the Ada extension and the build tasks.
* Install the recommended extensions when prompted.

You never need to close this folder again — you can build any of the 46 examples
from here.

## 5. Edit and build

Open **`Code/src/main.adb`**, change the message, and press **Ctrl+Shift+B**
(**Cmd+Shift+B** on a Mac).

```
Memory region         Used Size  Region Size  %age Used
           flash:      136528 B       512 KB     26.04%
mb: firmware: build/main.elf, build/main.hex, build/main.bin
```

## 6. Flash the board

Plug in the micro:bit with a **data** USB cable — some cables only carry power.

**Ctrl+Shift+B** already builds *and* flashes. If flashing times out, run the
**Erase** task (Ctrl+Shift+P → *Tasks: Run Task* → **Erase**) and try again.

For flashing to work you need pyocd:

```shell
pip install -U pyocd
```

> **Linux:** install the udev rule once, or your user cannot open the device:
>
> ```shell
> sudo cp tools/udev/50-microbit.rules /etc/udev/rules.d/
> sudo udevadm control --reload-rules && sudo udevadm trigger
> ```
>
> Unplug and replug the board afterwards.

**Don't want to install pyocd?** You do not have to. Flash `build/main.hex` from
the browser instead:
<https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/>

## 7. Read the output

`Put_Line` writes to the USB serial port at **115200**. Either:

* the **Serial Monitor** panel in VS Code (it is in the recommended extensions), or
* the **Output** panel of the [browser flasher](https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/).

Only one of them can hold the port at a time.

## 8. Debug with breakpoints

This is what the local setup buys you.

Click in the margin of `main.adb` to set a breakpoint, then press **F5**. The
program stops there and you can inspect variables and step through.

F5 always debugs whatever you built last.

## 9. Commit your work

Use the **Source Control** panel in VS Code: write a message, **Commit**, then
**Sync Changes**. GitHub Actions then builds your code and publishes `main.hex`
under the **Actions** tab.

---

## Building the examples

You do not need to open a different folder. Press **Ctrl+Shift+P**, choose
*Tasks: Run Task*, then:

* **Choose project…** — pick any of the 46 examples from a list.
* **Build the file I'm looking at** — builds whichever example the open file
  belongs to.

To point Ada go-to-definition and error checking at an example:

```shell
python3 tools/mb.py als --use ravenscar/buttons
```

## Troubleshooting

**`alr: command not found`.** Close and reopen your terminal after installing
Alire, so it picks up the new PATH.

**`mb.py doctor` says a build tool is MISSING.** Re-run step 3. If it still
fails, delete `~/.config/alire` and try once more.

**The build cannot find the drivers.** Your submodule is missing — run
`git submodule update --init --recursive`.

**Windows: the clone failed with `Filename too long`.** Run the `core.longpaths`
command in step 2, delete the folder, and clone again.

**Flashing times out.** Run the **Erase** task, try a different USB port, and
check the cable carries data.
