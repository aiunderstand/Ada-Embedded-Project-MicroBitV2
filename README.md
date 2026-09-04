<!-- No build badge here on purpose: a template is copied verbatim, so a badge
     pointing at the upstream repository would report the lecturer's build
     status inside every student's project. Check your own build under the
     Actions tab of your repository. -->

# Ada-Embedded-Project-MicroBitV2
Template for USN BSc intelligent real-time systems course.

# Requirements Windows / Mac / Linux
Before using this template, the following should be installed:
* vscode from https://code.visualstudio.com/download
* python 3.12+ from https://www.python.org/downloads/ **make sure to check "Add python.exe to path". Don't use the Windows/App Store version**.
* alire 2.1.0+ from https://alire.ada.dev/ or from https://github.com/alire-project/alire/releases
* github desktop from https://github.com/apps/desktop OR git scm 2.46.0+ from https://git-scm.com/downloads
* pyocd, only if you want to flash and debug from your own machine: `pip install -U pyocd`

# Install the toolchain
Alire downloads and manages the Ada compiler for you. Open a terminal in the
project folder and run:

```shell
alr toolchain --select gnat_arm_elf=15.1.2 gprbuild=25.0.1
```

That is the whole installation. **You do not need to edit PATH, and you do not
need to reboot.** Every build in this template runs through Alire, which sets
the environment itself.

To check everything is in place:

```shell
python3 tools/mb.py doctor
```

It reports the build tools separately from the flashing tools, because flashing
is optional - it is not available in a browser-based Codespace.

# Start
* Make sure that you are logged in to your GitHub.com account
* Click on the green "Use This Template" button and choose "create a new repository". This will create a unique repository under your github username with the contents of this template. Remember To choose a suitable name for your project
* Clone your newly created repositry with submodules by opening a command prompt and typing
```shell
git clone --recurse-submodules https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git.
```
You can also first clone the project and then initialize the submodules afterwards using
```shell
git submodule update --init --recursive
```

## Windows: enable long paths first

The bundled Unity example has paths over 170 characters, and Windows' default
limit is 260 including where you cloned to. Without this, `git clone` fails part
way through with `Filename too long` and you get an incomplete checkout:

```shell
git config --global core.longpaths true
```

Run it **before** cloning. If you already cloned and saw that error, run it and
then `git submodule update --init --recursive` again.

# Open VScode
Open **the root of the project** as your folder - and leave it open. You never
need to close it and reopen an example folder.

When VS Code asks whether you trust the authors, choose **Yes, I trust the
authors**. Declining puts the window in Restricted Mode, which disables the Ada
extension and the build tasks.

Press `Ctrl+Shift+B` to build and flash the template.

To work on one of the bundled examples, press `Ctrl+Shift+P`, choose
**Tasks: Run Task**, and pick either:

* **Choose project...** - pick any example from a list, or
* **Build the file I'm looking at** - builds whichever example the file you are
  currently editing belongs to.

Both build and flash without changing your workspace folder. Whatever you built
last is staged at `build/main.elf`, so pressing `F5` always debugs it.

To point the Ada editor features (go-to-definition, diagnostics) at a different
example:

```shell
python3 tools/mb.py als --use ravenscar/buttons
```

To see every project you can build:

```shell
python3 tools/mb.py list
```

# Flashing your first project to the MicroBit V2
* The above installation should lead to a correct compile flow. However flashing the compiled firmware file to sometimes fails due to previous usage. If Ctrl+Shift+B (to build your project) results in a timeout when flashing the MicroBit, try to Erase the content of the Micro:Bit first using Ctrl+Shift+P to open the command window and type
* ```shell
  task Erase
  ```
* Try Ctrl+Shift+B after the erase. Try removing the USB cable and using another USB port or reboot the computer if the problem persists.

# How to flash, and what works where
Flashing needs USB access to the board, and not every environment has it. Pick
the first row that applies to you.

| Route | What you need | Windows | macOS | Linux | Codespace |
|---|---|---|---|---|---|
| Drag `build/main.hex` onto the MICROBIT drive | nothing | yes | yes | yes | download it first |
| `Ctrl+Shift+B` in VS Code on your own machine | `pip install pyocd` | yes | yes | yes | no |
| Container / Codespace, flashing from the host | see above | yes | yes | yes | no |
| USB straight into a container | Linux host only | no | no | yes | no |

**Containers build; they usually cannot flash.** Docker Desktop on macOS and
Windows cannot pass a USB device through to the Linux VM, and a cloud Codespace
has no USB at all. This is a limitation of the platform, not of this template.
Build in the container, then drag `build/main.hex` onto the MICROBIT drive.

Two ways to flash from a container anyway, if you want to:

* **Linux host** - it just works. Install the udev rule first so the device is
  writable by a normal user:
  ```shell
  sudo cp tools/udev/50-microbit.rules /etc/udev/rules.d/
  sudo udevadm control --reload-rules && sudo udevadm trigger
  ```
  The rule must be on the **host**; udev runs on the host kernel, so a rule
  written inside a container does nothing.

* **Windows, via USB/IP** - [usbipd-win](https://github.com/dorssel/usbipd-win)
  shares a USB device with WSL2 and with Docker Desktop 4.35+:
  ```powershell
  winget install usbipd
  usbipd list                      # find the micro:bit's BUSID
  usbipd bind --busid <BUSID>      # needs an elevated PowerShell, once per device
  usbipd attach --wsl --busid <BUSID>
  ```
  Be aware the micro:bit **re-enumerates after a mass-erase and after some
  flashes**, so the device detaches and must be re-attached (`--auto-attach`
  keeps a process running to do this for you). There is no macOS equivalent:
  Docker Desktop's USB/IP support needs a USB/IP server on the host and macOS
  has no complete implementation.

# Flashing without installing anything (GitHub Actions build)
Every push is built by GitHub Actions, which publishes a ready-to-flash firmware image. This is the
easiest route if your local toolchain is not working yet, and the only route if you are working in a
browser-based Codespace (a Codespace has no USB access, so it can build but never flash).

* Open the **Actions** tab of your repository and click the most recent successful run.
* Download the **ITRS** artifact and unzip it. It contains:
  * `main.hex` - Intel HEX, **this is the one you flash**
  * `main.bin` - raw binary, an alternative to the hex
  * `main` - the ELF, used for debugging; **this cannot be flashed by drag-and-drop**
* Plug in the micro:bit and drag `main.hex` onto the **MICROBIT** drive. The yellow LED flashes while
  it programs, the drive re-mounts, and your program starts.

If a `FAIL.TXT` appears on the MICROBIT drive instead, open it - it says why. Dragging the `main`
ELF rather than `main.hex` is the usual cause: the DAPLink bootloader accepts Intel HEX or a raw
binary only.

# Flash and read output from the browser
No install, no toolchain, no drivers:

**<https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/>**

1. Plug in the micro:bit and click **Connect**.
2. Pick a ready-built example, **or** drop in your own `.hex`.
3. Click **Flash**. `Put_Line` output appears underneath, at 115200.

**Try an example first.** CI builds every project in this template and publishes
the firmware next to the page, so you can flash `music`, `accelerometer` or a
SPARK example and see the board do something before writing a line of code.
Those images are built from the template, not from your own code - use the file
picker for that.

Where to get the `.hex`:

* **From CI** - your repository's **Actions** tab, most recent green run, download
  the **ITRS** artifact and use `main.hex`. Not `main`, which is an ELF; the page
  will tell you if you pick the wrong one.
* **Locally** - `python3 tools/mb.py build` writes `build/main.hex`.

This is the only way to flash if you are working in a browser-based Codespace,
which has no USB access of its own: the page runs in the browser on your own
laptop, not in the container.

Flashing and serial share one connection. WebUSB talks to the board's DAPLink
interface chip, which is separate from the nRF52833 running your program, so the
connection survives a flash and output resumes by itself.

**Browser support:** Chrome, Edge and Opera on desktop. Safari and Firefox do
not implement WebUSB. On Linux, install the udev rule first
(`sudo cp tools/udev/50-microbit.rules /etc/udev/rules.d/`) or the browser
cannot open the device, and note that snap Chromium cannot reach USB at all.

Close `pyocd` before connecting - WebUSB claims the debug interface exclusively.

# Task automation in this template
* DependaBot to sync with dependencies (submodules) such as the Ada Driver Library.
* Ada Github action workflow to check if your code compiles and update the badge on top
* The same workflow converts the build output to `main.hex` / `main.bin` and publishes them as the
  downloadable **ITRS** artifact.

# Template uses 
* Ada language server for VS Code (https://github.com/AdaCore/ada_language_server/blob/master/README.md#vs-code-extension)
* EditorConfig
* Cortex-Debug
* CPPtools
* VScode-Serial-Monitor
