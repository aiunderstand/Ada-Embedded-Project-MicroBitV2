# Feature 3 — Platform-agnostic VS Code tasks (Windows / macOS / Linux / devcontainer)

## Verdict

Adopt **(a) a real `alire.toml` at the repo root** as the environment provider, and
**(b) `"type": "process"` tasks** as the invocation mechanism. Reject (c) as the primary
mechanism (keep only its `$ada` problem matcher) and reject (d) as unnecessary.
No `windows`/`osx`/`linux` overrides anywhere.

The one-line reason: the root cause of `zsh -c 'source /root/.zshrc && ...'` is that the
toolchain is not on the PATH that VS Code inherits. `alr` fixes that on all four platforms
identically; `"type": "process"` then removes the shell — and with it every quoting,
`zsh` vs `cmd.exe` vs `powershell` difference — from the picture.

## Verified this session (local machine, alr 2.1.0, macOS arm64)

| Claim | Evidence |
|---|---|
| `alr exec` exists in 2.1.x with a `-P` switch | `alr exec --help` |
| `alr build [--] <gprbuild switches>` exists | `alr build --help` |
| `gnat_arm_elf` 14.2.1 has native origins for linux x86-64/aarch64, macos x86-64/aarch64, windows x86-64 | index manifest |
| `gnat_arm_elf` 14.2.1 == GNAT-FSF tarball `gnat-14.2.0-1` — the exact tarball CI already downloads | index manifest URLs |
| `gnat_arm_elf` declares `[environment] PATH.prepend = "${CRATE_ROOT}/bin"` | index manifest |
| `embedded-nrf52833` is bundled at least through gnat_arm_elf **15.1.2** | `ls .../arm-eabi/lib/gnat` |
| `arm-eabi-objcopy` **and** `arm-eabi-gdb` ship in `gnat_arm_elf/bin` | `ls .../bin` |
| Prefix is `arm-eabi-`, **not** `arm-none-eabi-` | same |
| `[[depends-on]] gnat_arm_elf` + `auto-gpr-with = false` is the upstream-blessed pattern | `nrf5x_hal-0.1.0.toml` (AdaCore/Chouteau) |
| `project-files` accepts subdirectory paths | many index crates (`gnat/foo.gpr`, `.alire/ado.gpr`) |
| No `alire.toml` exists anywhere in the repo *or the submodule* | `find . -name alire.toml` |

### Two new submodule defects found while checking

1. **All 15 zfp examples select `for Runtime ("ada") use "zfp-cortex-m4f"`.** That runtime
   does **not exist** in gnat_arm_elf 14.x/15.x — it was renamed `light-cortex-m4f` in
   GNAT 12. All 15 are unbuildable with the pinned toolchain.
2. **All 15 zfp `.gpr` use Windows backslash paths** in `with "..\..\..\..\boards\..."` and
   in `-T ..\..\..\..\boards\MicroBit_v2\src\zfp\link.ld`. Even with the runtime fixed
   they cannot resolve on macOS/Linux/container.

So the zfp half of the examples is Windows-only *and* toolchain-broken. Excluded from the
example picker until fixed.

## Files

- create `alire.toml`
- create `.gitattributes`
- rewrite `.vscode/tasks.json`
- rewrite `.vscode/launch.json`
- edit `.vscode/settings.json`
- edit `.gitignore`
- rewrite `.github/workflows/ada.yml`
- edit `.devcontainer/devcontainer.json`
- README: delete the whole "Update global environment variables (PATH)" section

See the structured output for exact contents.
