![Your project compiles badge](https://github.com/aiunderstand/Ada-Embedded-Project-MicroBitV2/actions/workflows/ada.yml/badge.svg)

# Ada-Embedded-Project-MicroBitV2
Template for USN BSc intelligent real-time systems course.

# Requirements Windows / Mac / Linux
Before using this template, the following should be installed:
* vscode from https://code.visualstudio.com/download 
* python 3.12.5+ from https://www.python.org/downloads/ **make sure to check "Add python.exe to path". Don't use the Windows/App Store version**. 
* pyocd 0.34.3+ from https://pyocd.io/docs/installing by doing python3 -m pip install -U pyocd
* git scm 2.46.0+ from https://git-scm.com/downloads
* alire 2.0.1+ from https://alire.ada.dev/

# Install Toolchains
Open command prompt and type 
```shell
alr
```
Say yes to install msys2
```shell
alr toolchain --select
```
* Select GNAT_ARM_ELF version 14.1.3+ 
* Select GPRBUILD version 22.0.1+ 

# Update global environment variables (PATH)
* Windows
    * Open powershell as administrator
    * ```shell
        ./rundll32.exe sysdm.cpl,EditEnvironmentVariables
      ```      
    * goto system variables > path > new and add
        * C:\Users\[USERNAME]\AppData\Local\alire\cache\toolchains\gprbuild_[VERSION]\bin
        * C:\Users\[USERNAME]\AppData\Local\alire\cache\toolchains\gnat_arm_elf_[VERSION]\bin
        * C:\Program Files\Alire\bin (if you installed it in default)
        * C:\Users\[USERNAME]\AppData\Local\Programs\Python\[YOUR_PYTHON_VERSION]
        * C:\Users\[USERNAME]\AppData\Local\Programs\Python\[YOUR_PYTHON_VERSION]\Scripts
    * Close the environment variables window and **reboot computer**

* MacOs
    * Open terminal app
    * ```shell
        nano ~/.zshrc 
      ```
    * add lines
        * $ export PATH="~/.local/share/alire/cache/toolchains/gprbuild_[VERSION]/bin/:$PATH"
        * $ export PATH="~/.local/share/alire/cache/toolchains/gnat_arm_elf_[VERSION]/bin/:$PATH"        
    * Close the environment variables window and **reboot computer**
      
* Linux
    * Open terminal app
    * ```shell
        nano ~/.zshrc 
      ```
    * add lines
        * $ export PATH="/home/[USERNAME]/.local/share/alire/cache/toolchains/gprbuild_[VERSION]/bin/:$PATH"
        * $ export PATH="/home/[USERNAME]/.local/share/alire/cache/toolchains/gnat_arm_elf_[VERSION]/bin/:$PATH"       
    * Close the environment variables window and **reboot computer**

# Start
* Click on the green "Use This Template" button and choose "create a new repository". This will create a unique repository under your github username with the contents of this template. Remember To choose a suitable name for your project
* Clone your newly created repositry with submodules by opening a command prompt and typing
```shell
git clone --recurse-submodules https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git.
```
You can also first clone the project and then initialize the submodules afterwards using
```shell
git submodule update --init --recursive
```

# Open VScode
Important to open a folder at the workspace level (root of the project or root of the example where a folder .vscode is present) either via command prompt or via open. To build your project press Ctrl+Shift+B. Decline any question of VScode trying to be helpful.

# Flashing your first project to the MicroBit V2
* The above installation should lead to a correct compile flow. However flashing the compiled firmware file to sometimes fails due to previous usage. If Ctrl+Shift+B (to build your project) results in a timeout when flashing the MicroBit, try to Erase the content of the Micro:Bit first using Ctrl+Shift+P to open the command window and type
* ```shell
  task Erase
  ```
* Try Ctrl+Shift+B after the erase. Try removing the USB cable and using another USB port or reboot the computer if the problem persists.

# Task automation in this template
* DependaBot to sync with dependencies (submodules) such as the Ada Driver Library.
* Ada Github action workflow to check if your code compiles and update the badge on top

# Template uses 
* Ada language server for VS Code (https://github.com/AdaCore/ada_language_server/blob/master/README.md#vs-code-extension)
* EditorConfig
* Cortex-Debug
* CPPtools
* VScode-Serial-Monitor
