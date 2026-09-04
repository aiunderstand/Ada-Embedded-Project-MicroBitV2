#!/usr/bin/env bash
#
# Container provisioning for the micro:bit v2 Ada template.
#
# This lives in a script rather than an inline devcontainer.json string on
# purpose: the previous inline version ended in "|| true", which binds the whole
# preceding && chain, so a failed step still reported a clean container create.
# That is how a broken container looked healthy for ~35 commits.
#
# set -euo pipefail means a failure here fails the container create, loudly.
set -euo pipefail

ALR_VERSION="2.1.0"
GNAT_VERSION="15.1.2"     # NOT 16.1.0: it fails to link with
                          # ".eh_frame LMA overlaps .data" (bundled linker script)
GPRBUILD_VERSION="25.0.1" # 22.0.1 has no aarch64 build at all
TOOLCHAIN_DIR="/opt/alire/toolchains"

log() { echo "==> $*"; }

log "Installing OS packages"
apt-get update
apt-get install -y --no-install-recommends \
    libusb-1.0-0 libusb-1.0-0-dev udev usbutils unzip wget ca-certificates

log "Installing pyocd"
# pyocd < 0.44 pins capstone<5.0, which has no aarch64 and no cp312 wheels,
# so it cannot install on arm64 or on modern Python.
#
# The devcontainer python feature provides a pip that is not "externally
# managed", but a plain distro python (Ubuntu 24.04+) refuses to install into
# the system environment under PEP 668, so fall back explicitly.
pip install --no-cache-dir --upgrade "pyocd>=0.44" \
  || pip install --no-cache-dir --upgrade --break-system-packages "pyocd>=0.44"

log "Installing Alire ${ALR_VERSION}"
case "$(uname -m)" in
    x86_64)          ALR_ARCH="x86_64" ;;
    aarch64 | arm64) ALR_ARCH="aarch64" ;;
    *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
tmp="$(mktemp -d)"
wget -q -O "${tmp}/alr.zip" \
    "https://github.com/alire-project/alire/releases/download/v${ALR_VERSION}/alr-${ALR_VERSION}-bin-${ALR_ARCH}-linux.zip"
unzip -q -o "${tmp}/alr.zip" -d "${tmp}/alr"
# Into /usr/local/bin, not /workspaces: the workspace is a mounted volume and is
# not the right home for a system tool.
install -m 0755 "${tmp}/alr/bin/alr" /usr/local/bin/alr
rm -rf "${tmp}"
alr --version

log "Selecting the pinned toolchain"
alr settings --global --set toolchain.dir "${TOOLCHAIN_DIR}"
alr settings --global --set toolchain.assistant false
alr --non-interactive toolchain --select \
    "gnat_arm_elf=${GNAT_VERSION}" "gprbuild=${GPRBUILD_VERSION}"

log "Exposing the toolchain on PATH"
# mb.py always goes through "alr exec", so it does not need this. But
# cortex-debug spawns arm-eabi-gdb directly and never sources a shell rc, so F5
# needs the binaries genuinely on PATH. Symlinks avoid having to know the
# hashed directory name.
for bin in "${TOOLCHAIN_DIR}"/gnat_arm_elf_*/bin/* "${TOOLCHAIN_DIR}"/gprbuild_*/bin/*; do
    [ -x "$bin" ] || continue
    ln -sf "$bin" "/usr/local/bin/$(basename "$bin")"
done
arm-eabi-gcc -dumpversion
gprbuild --version | head -1

log "Container setup complete"
