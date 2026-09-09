# Path 🔵 — work on your own machine

The full setup. It takes about 15 minutes and roughly 2 GB of disk, and it is
the **only** path where you can flash directly and use breakpoint debugging
(F5).

Tested on Windows 11, Ubuntu 22.04+, and macOS 15+ (Intel and Apple Silicon).

---

## 1. What you need first

Two things. Everything else is installed for you in step 3.

| | |
|---|---|
| **Python 3.12+** | <https://www.python.org/downloads/> |
| **VS Code** | <https://code.visualstudio.com/download> |

> **Windows:** when installing Python, tick **"Add python.exe to PATH"** on the
> first screen. Do not use the Microsoft Store version — it is sandboxed and the
> build tools cannot see it.

**Git** is needed too, but it is already there on most machines: macOS ships it
with the Xcode Command Line Tools, and most Linux installations include it.

The setup command in step 3 checks for git and VS Code and, if either is
missing, **asks** before installing it — with `winget` on Windows, `brew` on
macOS, `apt`/`snap` on Linux. It never installs anything without asking, because
a tool installed somewhere unusual can be missed by the check.

If it says something is missing that you know you have, just say no and carry
on.

**Everything else is handled for you.** Step 3 installs the Ada compiler, the
build system and the flashing tool. You do not need to find, choose or configure
any of them.

## 2. Get the code

**The short way.** One file does the whole of steps 2 and 3: it installs git if
you do not have it, clones your repository with its drivers, and runs the setup
below. Download it, then run it with the address of **your** repository, the one
you made with *Use this template*.

macOS and Linux:

```shell
curl -fsSLO https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/get.py
python3 get.py https://github.com/YOUR_NAME/YOUR_REPO.git
```

Windows, in PowerShell:

```powershell
irm https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/get.py -OutFile get.py
py get.py https://github.com/YOUR_NAME/YOUR_REPO.git
```

Run it without the address and it asks for one. When it finishes, skip to step 4.

> **Private repository?** On Windows, git opens a sign-in window by itself.
> Elsewhere the script uses the GitHub command-line tool (`gh`) to sign you in
> through the browser if it is installed, and otherwise tells you how. When git
> asks for a *password*, it wants a
> [personal access token](https://github.com/settings/tokens), never your
> account password.

**By hand**, if you already have git and would rather see each step. Clone with
its submodules:

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
Alire, which sets the environment itself, and setup records where Alire is so
VS Code finds it even when it was started from the desktop rather than a
terminal.

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

Flashing needs pyocd, which the setup command in step 3 already installed.

> **Linux:** install the udev rule once, or nothing can open the device -- not
> pyocd, and not the browser flasher either. A raw USB device belongs to root
> until a rule says otherwise:
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

* the **serial console** of the [browser flasher](https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/)
  (Chrome, Edge or Opera), or
* any serial terminal you already like, at 115200 baud.

Only one program can hold the port at a time.

## 8. Debug with breakpoints

Set a breakpoint in `main.adb` and press **F5**. The first time, VS Code offers
to install the **Cortex-Debug** extension — accept. The program stops on the
line; F5 always debugs whatever you built last. Locally the board is on your own
USB port, so stepping is faster than in a Codespace.

Full guide, keys, limits and troubleshooting: **[Debug with
breakpoints](debugging.md)**.

## 9. Commit your work

Use the **Source Control** panel in VS Code: write a message, **Commit**, then
**Sync Changes**. GitHub Actions then builds your code and publishes `main.hex`
under the **Actions** tab.

---

## Building the examples

You do not need to open a different folder. Press **Ctrl+Shift+P**, choose
*Tasks: Run Task*, then:

* **Choose project…** — pick any of the 46 examples from a list (it is under
  **Tasks: Run Task**, not Ctrl+Shift+B, which runs *Build & Flash* straight
  away). The choice sticks: **Build & Flash** and plain **Build** then use it,
  until you choose **template** again.
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

**Windows: setup stops dead with no message.** Alire is asking "Do you want to
install msys2?" where you cannot see the question, so it waits for ever. Press
Ctrl+C and run this once, in the same terminal:

```
alr settings --global --set msys2.do_not_install true
```

Then run setup again. This project cross-compiles and needs nothing from msys2.
The setting is per user, not per project, so you only ever do it once — and
current versions of `mb.py` do it for you before Alire can ask. If an earlier
attempt left an `msys64` folder in `%USERPROFILE%\.config\alire`, it is unused
and you can delete it.

**Linux: the build fails with `alr not found`, but it works in the terminal.**
VS Code started from the dock or the applications menu does not inherit the
PATH your terminal has, so it cannot see a tool you installed into your home
directory. Run `python3 tools/mb.py setup` once in a terminal where
`alr --version` works: it writes down where Alire is, and the tasks then use
that. Starting VS Code with `code .` from that same terminal also works. The
**Doctor** task prints the `alr` it resolved, so you can see which one it found.

**Linux: `pyocd` did not install.** Ubuntu 23.04 and later refuse
`pip install --user` and ship `python3` without `pip`. Setup now installs pyocd
into its own environment instead, which needs `python3-venv`:

```shell
sudo apt install python3-venv
python3 tools/mb.py setup
```

Flashing from the browser needs none of this.

**Flashing says pyocd is missing, or that no micro:bit is visible.** Those are
different problems and the message says which one you have. "pyocd is not
installed" is fixed by running setup again. "No micro:bit is visible" usually
means the cable carries power but not data, so the board never appears as a
MICROBIT drive.

**Windows: the build works but `alr` is not recognised in a terminal.** Setup
installs Alire into your user folder rather than editing PATH. It offers to add
it; if you said no, add this folder to PATH by hand, or just keep using the
tasks and `python3 tools/mb.py`:
`%USERPROFILE%\.local\share\ada-microbit\alr\bin`. Close and reopen VS Code
afterwards, or it keeps the PATH it started with.

**Linux: the browser says it cannot connect, and the console shows a security
error.** WebUSB was refused permission to open the device. Install the udev rule
in step 6, then unplug and replug the board. Check the board is visible at all
with `lsusb`, which should list `0d28:0204`.

**Linux: still refused, and Chromium came from the Ubuntu App Centre.** The
Chromium snap has no raw USB access unless it is granted:

```shell
sudo snap connect chromium:raw-usb
```

Installing Chrome from its `.deb` avoids this entirely. Firefox has no WebUSB
at all, and the page says so rather than failing to connect.

**Flashing from VS Code does nothing on my own machine.** The flasher extension
is for the browser. On your own machine flashing goes through pyocd instead:
Ctrl+Shift+B, or `python3 tools/mb.py flash`. The extension says the same in its
output panel.

**Flashing times out.** Run the **Erase** task, try a different USB port, and
check the cable carries data.
