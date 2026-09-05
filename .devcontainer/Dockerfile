# Toolchain image for the micro:bit v2 Ada template.
#
# The whole point is that the ~550 MB toolchain download and its ~2 GB
# extraction happen HERE, once, instead of on every student's first Codespace
# start. Pulling this image is a fast registry transfer instead.
#
# Built for linux/amd64 (Codespaces) and linux/arm64 (Apple Silicon) by
# .github/workflows/devcontainer-image.yml, and pinned by tag in
# devcontainer.json. It is also the image the CI matrix runs in, so one artifact
# defines the toolchain everywhere.
#
# Build locally if you ever need to:
#   docker build -t ada-microbit .devcontainer

FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# Keep these in step with alire.toml and .github/workflows/ada.yml.
ARG ALR_VERSION=2.1.1
ARG GNAT_VERSION=15.1.2
ARG GPRBUILD_VERSION=25.0.1
# (gnatprove is resolved by Alire per workspace; see the note below.)

# Alire keeps its settings -- including which toolchain is selected -- per user.
# The image is built as root but the container runs as vscode, so without a
# shared settings directory the selection made here would be invisible at
# runtime and alr would try to install its own toolchain on first use.
ENV ALIRE_SETTINGS_DIR=/opt/alire/settings \
    ALIRE_TOOLCHAIN_DIR=/opt/alire/toolchains \
    DEBIAN_FRONTEND=noninteractive

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# libusb and udev are for pyocd; the rest is what Alire and the build need.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip wget git \
      libusb-1.0-0 libusb-1.0-0-dev udev usbutils \
      python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

# pyocd < 0.44 pins capstone < 5.0, which has no aarch64 and no cp312 wheels and
# therefore cannot install on arm64 or on modern Python.
RUN pip3 install --no-cache-dir --break-system-packages "pyocd>=0.44"

# Alire itself.
RUN set -euo pipefail; \
    case "$(uname -m)" in \
      x86_64)          arch=x86_64 ;; \
      aarch64 | arm64) arch=aarch64 ;; \
      *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;; \
    esac; \
    tmp="$(mktemp -d)"; \
    wget -q -O "$tmp/alr.zip" \
      "https://github.com/alire-project/alire/releases/download/v${ALR_VERSION}/alr-${ALR_VERSION}-bin-${arch}-linux.zip"; \
    unzip -q "$tmp/alr.zip" -d "$tmp/alr"; \
    install -m 0755 "$tmp/alr/bin/alr" /usr/local/bin/alr; \
    rm -rf "$tmp"; \
    alr --version

# The toolchain. This is the expensive layer, and the reason this image exists.
# Done as vscode so the recorded selection belongs to the user that will run it.
#
# gnatprove is deliberately NOT baked in: it is an ordinary Alire crate
# dependency rather than a toolchain component, so it is resolved per workspace
# and alr would re-deploy it anyway. "mb.py prove" fetches it on first use.
RUN mkdir -p "$ALIRE_SETTINGS_DIR" "$ALIRE_TOOLCHAIN_DIR" && chown -R vscode:vscode /opt/alire

USER vscode
RUN set -euo pipefail; \
    cd /tmp; \
    alr settings --global --set toolchain.dir "$ALIRE_TOOLCHAIN_DIR"; \
    alr settings --global --set toolchain.assistant false; \
    alr --non-interactive toolchain --select \
        "gnat_arm_elf=${GNAT_VERSION}" \
        "gprbuild=${GPRBUILD_VERSION}"; \
    alr toolchain; \
    \
    # Drop the runtimes this board cannot use. gnat_arm_elf ships 71 of them for
    # boards from STM32 to RISC-V -- 1.1 GB of its 1.9 GB -- and every one of the
    # 47 projects here uses just embedded-nrf52833 or light-cortex-m4f. Keeping
    # the nRF52833 family plus generic Cortex-M4 leaves 69 MB.
    #
    # This MUST happen in the same layer as the install: a delete in a later
    # layer leaves the files in the earlier one and saves nothing.
    cd "$ALIRE_TOOLCHAIN_DIR"/gnat_arm_elf_*/arm-eabi/lib/gnat; \
    for rt in */; do \
      rt="${rt%/}"; \
      case "$rt" in \
        embedded-nrf52833|light-nrf52833|light-tasking-nrf52833|light-cortex-m4f|light-cortex-m4) ;; \
        *) rm -rf "$rt" ;; \
      esac; \
    done; \
    # Fail loudly rather than shipping an image that cannot build the examples.
    test -d embedded-nrf52833 || { echo "embedded-nrf52833 was removed!" >&2; exit 1; }; \
    test -d light-cortex-m4f  || { echo "light-cortex-m4f was removed!" >&2; exit 1; }; \
    echo "runtimes kept:"; ls; \
    rm -rf "$ALIRE_TOOLCHAIN_DIR"/gnat_arm_elf_*/share/info \
           "$ALIRE_TOOLCHAIN_DIR"/gnat_arm_elf_*/share/man
USER root

# Put the toolchain on PATH for everyone, including processes that never source
# a shell rc -- cortex-debug spawns arm-eabi-gdb directly, so F5 depends on this.
RUN set -euo pipefail; \
    for bin in "$ALIRE_TOOLCHAIN_DIR"/gnat_arm_elf_*/bin/* \
               "$ALIRE_TOOLCHAIN_DIR"/gprbuild_*/bin/*; do \
      [ -x "$bin" ] || continue; \
      ln -sf "$bin" "/usr/local/bin/$(basename "$bin")"; \
    done; \
    arm-eabi-gcc -dumpversion; \
    gprbuild --version | head -1
