# Ada-Embedded-Project-MicroBitV2
Template for USN BSc intelligent real-time systems course.

# Requirements
Before using this template, the following should be installed:
* vscode from https://code.visualstudio.com/download 
* python 3.12.5+ from https://www.python.org/downloads/ **make sure to check "Add python.exe to path"**
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
* Select GNAT version 14.1.3+ (which is option 8)
* Select GPRBUILD version 22.0.1+ (which is option 1)

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

# Task automation in this template
* The template uses DependaBot to sync with dependencies (submodules) such as the Ada Driver Library.
* (2do) The template uses the Ada Github action workflow to check if your code compiles

# Template uses 
* Ada language server for VS Code (https://github.com/AdaCore/ada_language_server/blob/master/README.md#vs-code-extension)
