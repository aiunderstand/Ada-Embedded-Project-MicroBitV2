#!/usr/bin/env python3
"""
mb.py - one build/flash driver for the micro:bit v2 Ada template.

Everything runs through Alire, so no PATH editing is ever required:

    template   alr build   -- --root-dir=. --relocate-build-tree=build/obj
    examples   alr exec -- gprbuild -P <project.gpr> --root-dir=. ...

Because every project is built from the repository root into one relocated
tree, you never have to close the VS Code folder and reopen it somewhere else,
and no obj/ directories are ever written inside the Ada_Drivers_Library
submodule.

Firmware always ends up at build/main.elf / .hex / .bin, whichever project you
built, so launch.json and the CI artifact have a stable path.

    python3 tools/mb.py list
    python3 tools/mb.py build                     # the template
    python3 tools/mb.py build --use ravenscar/buttons
    python3 tools/mb.py build --use-dir <path>    # nearest project to a file
    python3 tools/mb.py build --all               # regression sweep
    python3 tools/mb.py flash | erase | prove | doctor | als | clean
    python3 tools/mb.py boards [--watch]          # the micro:bits here, for the extension
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import NamedTuple

REPO = Path(__file__).resolve().parent.parent
BUILD = REPO / "build"
OBJ_TREE = BUILD / "obj"
TEMPLATE_GPR = REPO / "Code" / "itrs.gpr"
EXAMPLES = REPO / "Code/libs/Ada_Drivers_Library/examples/MicroBit_v2"
KNOWN_FAILURES = REPO / "tools" / "known_failures.txt"
UDEV_RULE = REPO / "tools" / "udev" / "50-microbit.rules"
ALS_JSON = REPO / ".als.json"
PROJECT_FILE = REPO / "build" / "project.txt"   # what "Choose project..." picked

TARGET = "nrf52833"

# Pinned toolchain. Keep in step with alire.toml, .devcontainer/Dockerfile and
# .github/workflows/ada.yml.
ALR_VERSION = "2.1.1"
GNAT_VERSION = "15.1.2"
GPRBUILD_VERSION = "25.0.1"

# Alire publishes no checksums, so these were computed once and pinned here: a
# tampered or truncated download fails loudly instead of being installed.
ALR_SHA256 = {
    "x86_64-linux":   "09c66bcd8c35dd4b97b72c3d9b76e44caa6964a2db35aba069f396f00f1f64c7",
    "aarch64-linux":  "d76c93ad3dc631826144e10bdabc6b3bf98783805bebfd5e4a0e852dd524d812",
    "x86_64-macos":   "d3e16cdfaf0cfb2da62853b79b62910189fdca9d5fddc5c3ac5974ffc7d9544b",
    "aarch64-macos":  "2c4867bfff3b95ecd9d846df460a52983d2b0072808b341f8fa5d82494fb309e",
    "x86_64-windows": "863013b1f94da6f3b7d0d5a74022ac3370424eeea9a470ebdb33d188d61b9125",
}

# Where "mb.py setup" puts what it installs. Deliberately not on PATH: nothing
# here should require the student to edit their environment.
MANAGED_DIR = Path.home() / ".local" / "share" / "ada-microbit"
MANAGED_ALR_DIR = MANAGED_DIR / "alr"
VENV_DIR = MANAGED_DIR / "venv"          # holds pyocd, immune to PEP 668
ALR_POINTER = MANAGED_DIR / "alr-path"   # the alr setup actually used
OBJCOPY = "arm-eabi-objcopy"
SIZE = "arm-eabi-size"

# Directories that never contain a buildable example.
SKIP_PARTS = {"obj", "build", "boards", ".git", "lib"}

HAS_MAIN = re.compile(r"^\s*for\s+Main\s+use", re.IGNORECASE | re.MULTILINE)


def rel(p: Path) -> str:
    """Repo-relative, forward-slashed. Never wrap in PurePosixPath."""
    try:
        return p.resolve().relative_to(REPO).as_posix()
    except ValueError:
        return p.as_posix()


def info(msg: str) -> None:
    print(f"mb: {msg}")


def die(msg: str, code: int = 1):
    print(f"mb: error: {msg}", file=sys.stderr)
    raise SystemExit(code)


# --------------------------------------------------------------------------
# project discovery
# --------------------------------------------------------------------------

def is_buildable(gpr: Path) -> bool:
    """A project we can actually link an executable from."""
    try:
        return bool(HAS_MAIN.search(gpr.read_text(errors="replace")))
    except OSError:
        return False


def discover() -> dict[str, Path]:
    """id -> .gpr path. 'template' plus every micro:bit v2 example."""
    found: dict[str, Path] = {}
    if TEMPLATE_GPR.is_file():
        found["template"] = TEMPLATE_GPR

    if EXAMPLES.is_dir():
        for gpr in sorted(EXAMPLES.rglob("*.gpr")):
            # Test on the parts BELOW the examples root, not the absolute path:
            # a checkout living under any dir called lib/ or obj/ would
            # otherwise silently yield an empty picker.
            parts = gpr.relative_to(EXAMPLES).parts[:-1]
            if any(part in SKIP_PARTS for part in parts):
                continue
            if not is_buildable(gpr):
                continue
            found.setdefault(Path(*parts).as_posix() if parts else gpr.stem, gpr)
    return found


def resolve_dir(start: Path) -> tuple[str, Path]:
    """Nearest enclosing project for a file or directory (for ${fileDirname})."""
    projects = discover()
    by_dir = {gpr.parent.resolve(): (pid, gpr) for pid, gpr in projects.items()}
    here = start.resolve()
    if here.is_file():
        here = here.parent
    for cand in [here, *here.parents]:
        if cand in by_dir:
            return by_dir[cand]
        if cand == REPO:
            break
    die(f"no project found at or above {rel(start)} - try: mb.py list")


def resolve_id(pid: str) -> tuple[str, Path]:
    projects = discover()
    if pid in projects:
        return pid, projects[pid]
    matches = [k for k in projects if pid.lower() in k.lower()]
    if len(matches) == 1:
        return matches[0], projects[matches[0]]
    if len(matches) > 1:
        die(f"'{pid}' is ambiguous: {', '.join(sorted(matches)[:8])}")
    die(f"no project matches '{pid}' - try: mb.py list")


# --------------------------------------------------------------------------
# running things through Alire
# --------------------------------------------------------------------------

def _bin_names(stem: str) -> tuple[str, ...]:
    return (stem, stem + ".exe") if os.name == "nt" else (stem,)


def _search(dirs, stem: str) -> str | None:
    for d in dirs:
        for name in _bin_names(stem):
            cand = Path(d) / name
            if cand.is_file() and os.access(cand, os.X_OK):
                return str(cand)
    return None


def _alr_dirs() -> list[Path]:
    """Everywhere alr is normally installed, ours first.

    PATH is not enough. A VS Code task is "type": "process", so it runs with the
    editor's environment and no shell: launched from a dock or an application
    menu it never sees ~/.bashrc, and on a Wayland session it does not see
    ~/.profile either, so a per-user bin directory is simply absent. The build
    then failed while the same command worked in the integrated terminal.
    """
    home = Path.home()
    dirs = [MANAGED_ALR_DIR / "bin",
            home / ".alire" / "bin",           # Alire's own install script
            home / ".local" / "share" / "alire",  # its self-install location
            home / ".local" / "bin",
            home / "alr" / "bin",
            home / ".cargo" / "bin",
            Path("/usr/local/bin"), Path("/opt/alire/bin"), Path("/snap/bin")]
    if os.name == "nt":
        for var in ("LOCALAPPDATA", "USERPROFILE", "PROGRAMFILES"):
            base = os.environ.get(var)
            if base:
                dirs += [Path(base) / "alire" / "bin", Path(base) / "alr" / "bin"]
    return dirs


def alr_path() -> str:
    """Where alr is: PATH, then the one setup recorded, then the usual places.

    The recorded pointer matters most. setup runs in a terminal, where PATH
    works; the editor may not have that PATH, and this is how it still ends up
    running the very same alr.
    """
    found = shutil.which("alr")
    if found:
        return found
    try:
        noted = ALR_POINTER.read_text().strip()
        if noted and Path(noted).is_file() and os.access(noted, os.X_OK):
            return noted
    except OSError:
        pass
    return _search(_alr_dirs(), "alr") or "alr"


def remember_alr() -> None:
    """Record the resolved alr, so a task without PATH finds the same one."""
    found = alr_path()
    if os.path.sep not in found:            # bare name: nothing worth recording
        return
    try:
        MANAGED_DIR.mkdir(parents=True, exist_ok=True)
        ALR_POINTER.write_text(str(Path(found).resolve()) + "\n")
    except OSError:
        pass                                 # a note, never a reason to fail


def pyocd_candidates() -> list[str]:
    """Every pyocd this machine has, ours first -- see _alr_dirs() for why
    PATH is not enough. Ours is the one whose version we control; the others
    are what a student installed themselves, and probe_check() falls back to
    them when ours does not run or does not see the board."""
    home = Path.home()
    bin_dir = "Scripts" if os.name == "nt" else "bin"
    found = []
    ours = _search([VENV_DIR / bin_dir], "pyocd")
    if ours:
        found.append(ours)
    on_path = shutil.which("pyocd")
    if on_path:
        found.append(on_path)
    dirs = []
    try:
        import site
        dirs.append(Path(site.getuserbase()) / bin_dir)   # "pip install --user"
    except Exception:                        # noqa: BLE001
        pass
    dirs += [home / ".local" / "bin", Path("/usr/local/bin")]
    for d in dirs:
        more = _search([d], "pyocd")
        if more:
            found.append(more)
    unique = []
    for f in found:
        if Path(f).resolve() not in [Path(u).resolve() for u in unique]:
            unique.append(f)
    return unique


_pyocd_fallback: str | None = None   # another pyocd, chosen because ours failed


def pyocd_path() -> str:
    """The pyocd to run: the one probe_check() found working, else ours."""
    if _pyocd_fallback:
        return _pyocd_fallback
    cands = pyocd_candidates()
    return cands[0] if cands else "pyocd"


_msys2_guarded = False


def skip_msys2() -> None:
    """Tell Alire not to install MSYS2, before it ever gets the chance to ask.

    Windows-only, and every Alire call goes through here first, because the
    question is asked at *startup* -- so setting this in "setup" alone left
    "doctor", "build" and the Ctrl+Shift+B task to hit the prompt on a machine
    where alr had never run. MSYS2 is Alire's system package manager; this
    project cross-compiles and depends only on binary toolchain crates, so it
    needs nothing from it (the Windows CI leg builds with this set from its
    first command).

    Sets it once per process rather than reading it back: one extra alr call is
    cheaper than two, and writing it again is harmless.
    """
    global _msys2_guarded
    if _msys2_guarded or os.name != "nt":
        return
    try:
        subprocess.run([alr_path(), "settings", "--global",
                        "--set", "msys2.do_not_install", "true"],
                       cwd=REPO, stdin=subprocess.DEVNULL,
                       capture_output=True, text=True)
    except OSError:
        # No alr on this machine yet. Do NOT latch: "setup" probes for alr,
        # installs it, and probes again -- and that second call is the first one
        # that can be asked the question.
        return
    _msys2_guarded = True


def _not_found(prog: str) -> str:
    """Name the actual mistake. "alr not found" usually means it IS installed,
    just not visible here: a VS Code task started from the desktop does not have
    the terminal's PATH."""
    if not prog.endswith("alr"):
        return f"{prog} not found."
    return "\n".join([
        "alr not found.",
        "",
        "  If 'alr --version' works in a terminal, Alire IS installed and this",
        "  process simply cannot see it -- a VS Code task started from the",
        "  desktop does not have the terminal's PATH. Either fix works:",
        "",
        "    run 'python3 tools/mb.py setup' in that terminal   (records where it is)",
        "    or close VS Code and start it with 'code .' from there",
        "",
        "  If that command does not work either, Alire is not installed yet:",
        "  'python3 tools/mb.py setup' installs it.",
    ])


# Children run in UTF-8 mode, and our own output never dies on a character.
#
# pyocd 0.45's "list" prints a check mark next to the target. Captured into a
# pipe on Windows, Python encodes stdout as cp1252, where that character does
# not exist, so pyocd printed the board's row and then died with exit 1 --
# while the same command in a terminal, whose console takes UTF-8, listed the
# board fine. setup reported "cannot enumerate USB" with the board's own row
# as the evidence. UTF-8 mode fixes stdout for every Python child, capture()
# decodes the same way, and since we then print what pyocd said, our own
# stdout must not refuse the character either.
os.environ["PYTHONUTF8"] = "1"
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass


def run(cmd: list[str], quiet: bool = False) -> int:
    if not quiet:
        info(" ".join(cmd))
    if cmd and cmd[0] == "alr":
        skip_msys2()
        cmd = [alr_path()] + cmd[1:]
    try:
        return subprocess.call(cmd, cwd=REPO)
    except FileNotFoundError:
        die(_not_found(cmd[0]), 127)


def alr_exec(args: list[str], quiet: bool = False) -> int:
    return run(["alr", "exec", "--"] + args, quiet=quiet)


def capture(cmd: list[str]) -> tuple[int, str]:
    """Run and capture. Status is the command's own, never a pipeline's.

    stdin is closed on purpose. Capturing the output hides any prompt the
    command writes, while an inherited terminal still makes it *look* answerable
    -- so a question like Alire's MSYS2 one waited on input that could never
    arrive, and the student saw a cursor and nothing else. With no stdin a
    prompting command fails immediately and we report its output.
    """
    if cmd and cmd[0] == "alr":
        skip_msys2()
        cmd = [alr_path()] + cmd[1:]
    try:
        p = subprocess.run(cmd, cwd=REPO, stdin=subprocess.DEVNULL,
                           capture_output=True, encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return 127, ""
    # A command that dies mid-line leaves stdout without its newline; joined
    # flat, the error then reads as the tail of the last line it printed.
    out = p.stdout
    if out and p.stderr and not out.endswith("\n"):
        out += "\n"
    return p.returncode, out + p.stderr


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

RELOCATE = ["--root-dir=.", f"--relocate-build-tree=build/obj"]
# Full paths in compiler messages, so the Problems panel can open the file;
# the template gets them too now, not only the examples.
CARGS = ["-cargs:ada", "-gnatef"]

_runtime_root: str | None = None


def runtime_root() -> str | None:
    """Where the compiler keeps its runtimes: <toolchain>/arm-eabi/lib/gnat."""
    global _runtime_root
    if _runtime_root is None:
        rc, out = capture(["alr", "exec", "--", "arm-eabi-gcc", "-print-file-name=gnat"])
        # Alire chatter precedes the answer; the answer is the last path.
        paths = [l.strip() for l in out.splitlines() if os.path.sep in l or "/" in l]
        _runtime_root = os.path.normpath(paths[-1]) if rc == 0 and paths else ""
    return _runtime_root or None


def runtime_named(gpr: Path) -> str | None:
    """The runtime a project names literally: for Runtime ("ada") use "...";"""
    try:
        text = gpr.read_text(errors="replace")
    except OSError:
        return None
    # The board projects keep the old runtime name in a comment right above
    # the real one ("-- for Runtime ("ada") use "zfp-cortex-m4f";").
    text = re.sub(r"--[^\n]*", "", text)
    m = re.search(r'for\s+Runtime\s*\(\s*"ada"\s*\)\s+use\s+"([^"]+)"', text, re.I)
    return m.group(1) if m else None


def linker_script_switches(gpr: Path) -> list[str]:
    """-largs -L<runtime>/ld: the linker script's directory, as an absolute path.

    The runtime's own switches say the same ("-L${RUNTIME_DIR}/ld", then
    "-T common-ROM.ld"), but on Windows gprbuild hands ld that directory
    relative to the object directory, and Windows resolves a relative name
    by appending it to the current directory and refusing the result when
    that exceeds 260 characters -- before it collapses the "..". With the
    build tree relocated under build/obj, an example's object directory is
    already 116 characters from C:/Users/huber/itrs26, the runtime lies
    eleven ".." up, and the concatenation is 269: "cannot open linker
    script file common-ROM.ld", while the template, 5 levels up and 171
    long, links. An absolute -L before the runtime's makes ld open the
    script by its full name, which is never concatenated.
    """
    name = runtime_named(gpr)
    root = runtime_root()
    if not name or not root:
        return []
    ld_dir = Path(root) / name / "ld"
    if not ld_dir.is_dir():
        return []
    return ["-largs", f"-L{ld_dir}"]


def built_exe(gpr: Path) -> Path:
    """Where gprbuild puts the executable inside the relocated tree."""
    return OBJ_TREE / rel(gpr.parent) / "obj" / "main"


def build_one(pid: str, gpr: Path, quiet: bool = False, verbose: bool = False) -> bool:
    # -v makes gprbuild print every command it runs, the link line included:
    # a linker error names a file it could not find, and only the command
    # shows where it looked.
    if pid == "template":
        cmd = ["alr", "build", "--"] + (["-v"] if verbose else []) + RELOCATE
    else:
        cmd = ["alr", "exec", "--", "gprbuild", "-j0", "-p", "-P", rel(gpr)] + \
              (["-v"] if verbose else []) + RELOCATE
    cmd += CARGS + linker_script_switches(gpr)
    if quiet:
        rc, out = capture(cmd)
        if rc != 0:
            sys.stdout.write(out)
        return rc == 0
    return run(cmd) == 0


def stage_firmware(gpr: Path, pid: str = "") -> bool:
    """Copy the ELF to build/main.elf and derive .hex/.bin next to it."""
    exe = built_exe(gpr)
    if not exe.is_file():
        die(f"no executable at {rel(exe)} - did the link step run?")
    BUILD.mkdir(parents=True, exist_ok=True)
    elf = BUILD / "main.elf"
    shutil.copy2(exe, elf)

    for fmt, out in (("ihex", BUILD / "main.hex"), ("binary", BUILD / "main.bin")):
        if alr_exec([OBJCOPY, "-O", fmt, rel(elf), rel(out)], quiet=True) != 0:
            die(f"{OBJCOPY} failed producing {out.name}")

    hexf = BUILD / "main.hex"
    text = hexf.read_text()
    if not text.startswith(":") or ":00000001FF" not in text.splitlines()[-1]:
        die("produced .hex is not valid Intel HEX")

    if pid:
        (BUILD / "last-project.txt").write_text(pid + "\n")
    alr_exec([SIZE, rel(elf)], quiet=True)
    info(f"firmware: {rel(elf)}, {rel(hexf)}, {rel(BUILD / 'main.bin')}")
    return True


def load_known_failures() -> set[str]:
    if not KNOWN_FAILURES.is_file():
        return set()
    out = set()
    for line in KNOWN_FAILURES.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.add(line)
    return out


def chosen_project(args) -> tuple[str, Path]:
    """The project to build: chosen now, or chosen earlier, or the template.

    --use / --use-dir choose a project and remember it in build/project.txt.
    A plain build -- which is what "Build & Flash" and the flasher run -- then
    rebuilds that choice, so a student can pick an example once and flash it
    with the same key as their own program. Choosing "template" returns.
    """
    if getattr(args, "use_dir", None):
        pid, gpr = resolve_dir(Path(args.use_dir))
    elif getattr(args, "use", None):
        pid, gpr = resolve_id(args.use)
    else:
        remembered = PROJECT_FILE.read_text().strip() if PROJECT_FILE.is_file() else ""
        if remembered and remembered != "template":
            try:
                pid, gpr = resolve_id(remembered)
                info(f"building {pid}, chosen earlier with 'Choose project...' -- "
                     "choose 'template' to return to your own program")
                return pid, gpr
            except SystemExit:
                info(f"'{remembered}' (chosen earlier) no longer exists; building the template")
        return "template", TEMPLATE_GPR
    BUILD.mkdir(parents=True, exist_ok=True)
    PROJECT_FILE.write_text(pid + "\n")
    return pid, gpr


def cmd_build(args) -> int:
    if args.all:
        return build_all(args)
    pid, gpr = chosen_project(args)
    info(f"building {pid} ({rel(gpr)})")
    if not build_one(pid, gpr, verbose=getattr(args, "verbose", False)):
        return 1
    stage_firmware(gpr, pid)
    return 0


def build_all(args) -> int:
    """Regression sweep. Quarantined-but-passing (XPASS) fails the run, so the
    known-failures list can only ever shrink."""
    projects = discover()
    quarantined = load_known_failures()
    xfail = xpass = passed = failed = 0
    bad: list[str] = []

    for pid in sorted(projects):
        ok = build_one(pid, projects[pid], quiet=True)
        known = pid in quarantined
        if ok and known:
            print(f"  XPASS  {pid}  (quarantined but builds - remove it from "
                  f"{rel(KNOWN_FAILURES)})")
            xpass += 1
            bad.append(pid)
        elif ok:
            print(f"  PASS   {pid}")
            passed += 1
        elif known:
            print(f"  XFAIL  {pid}  (known failure)")
            xfail += 1
        else:
            print(f"  FAIL   {pid}")
            failed += 1
            bad.append(pid)

    print(f"\n{passed} PASS, {failed} FAIL, {xfail} XFAIL, {xpass} XPASS")
    if quarantined:
        print(f"note: {len(quarantined)} project(s) quarantined in "
              f"{rel(KNOWN_FAILURES)} - this list should only shrink.")
    if bad:
        print("problem projects: " + ", ".join(bad))
    return 1 if bad else 0


# --------------------------------------------------------------------------
# flash / debug / prove
# --------------------------------------------------------------------------

def in_container() -> bool:
    """A Codespace or devcontainer: no USB, and udev belongs to the host."""
    return bool(os.environ.get("CODESPACES") or os.environ.get("REMOTE_CONTAINERS")
                or Path("/.dockerenv").exists())


class ProbeCheck(NamedTuple):
    state: str          # ok / no-pyocd / broken / denied / no-probe
    exe: str            # the pyocd the verdict is about
    rc: int
    said: str           # the last lines it printed, for the message
    tried: tuple = ()   # every pyocd that was asked
    listing: str = ""   # everything it printed: which boards, by unique id


# A row of "pyocd list": an index, then the probe, then a unique ID, a
# micro:bit or its target. Not a log line, which also starts with digits
# ("0000143 C ..." in pyocd 0.45, "0001234:CRITICAL:..." before it).
_PROBE_ROW = re.compile(r"^\s*\d+\s+\S.*(?:[0-9a-f]{8,}|micro:bit|cmsis-dap|0d28|"
                        + TARGET + ")", re.I)
_LOG_LINE = re.compile(r"^\s*\d+(?:\s[A-Z]\s|:[A-Z]+:)")


def _probe_rows(out: str) -> list[str]:
    return [l for l in out.splitlines() if _PROBE_ROW.match(l) and not _LOG_LINE.match(l)]


def _tail(out: str, lines: int = 3) -> str:
    kept = [l.strip()[:110] for l in out.strip().splitlines() if l.strip()]
    return "\n             ".join(kept[-lines:]) if kept else "(nothing)"


def probe_check() -> ProbeCheck:
    """Why flashing can or cannot happen, and what pyocd said about it.

    These were one boolean, and every failure was reported as "no debug probe is
    visible", with a Codespaces explanation -- so a Windows student with the
    board plugged in and pyocd simply not on PATH was told about Codespaces.
    Different problems need different sentences.

    A pyocd that crashes is another one. It was reported as "no micro:bit is
    visible", to a student whose own pyocd, on PATH, listed the board fine:
    any non-zero exit without a permission word counted as no board, and only
    our venv copy was ever asked. So every pyocd on the machine is asked in
    turn, the first that sees the board is the one used (pyocd_path() follows
    it, and a note says so), and the report names the pyocd it is about and
    quotes what it said -- the same lines the student would otherwise have to
    go and find.
    """
    global _pyocd_fallback
    cands = pyocd_candidates()
    if not cands:
        return ProbeCheck("no-pyocd", "pyocd", 127, "")
    first = None
    for exe in cands:
        rc, out = capture([exe, "list"])
        low = out.lower()
        if rc == 127:
            continue
        # libusb cannot open the device without the udev rule; it says so in
        # several different wordings depending on the version.
        if rc != 0 and any(w in low for w in ("access denied", "permission",
                                              "error_access", "not permitted")):
            return ProbeCheck("denied", exe, rc, _tail(out), tuple(cands))
        if _probe_rows(out):
            # The board is in the listing, so USB works, whatever the exit
            # code says (a pyocd that died *after* the row has still seen it).
            if exe != cands[0]:
                _pyocd_fallback = exe
                info(f"note: flashing with {exe}; ours ({cands[0]}) "
                     "did not find the board")
            if rc != 0:
                info(f"note: {exe} listed the board but exited with {rc}")
            return ProbeCheck("ok", exe, rc, _tail(out), tuple(cands), out)
        if rc != 0 and "no available debug probes" not in low:
            verdict = "broken"
        else:
            verdict = "no-probe"
        if first is None:
            first = ProbeCheck(verdict, exe, rc, _tail(out), tuple(cands))
    return first or ProbeCheck("no-pyocd", cands[0], 127, "", tuple(cands))


def probe_state() -> str:
    return probe_check().state


def probe_present() -> bool:
    return probe_state() == "ok"


def cannot_flash_hint(check: ProbeCheck) -> None:
    """Say which of the things went wrong, and how to fix that one."""
    state = check.state
    browser = (f"    Or flash from the browser: download "
               f"{rel(BUILD / 'main.hex')} and drop it on\n"
               "    https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/")
    # What was run and what it answered: the next report then carries it.
    others = [t for t in check.tried if t != check.exe]
    evidence = (f"    pyocd used:  {check.exe}\n"
                f"    it said:     {check.said}\n"
                + (f"    also tried:  {', '.join(others)} -- same answer\n" if others else ""))
    if state == "broken":
        print("\nmb: built fine, but pyocd does not run on this machine, so it "
              "cannot flash.\n"
              + evidence +
              "    Reinstall it with:  python3 tools/mb.py setup\n"
              + browser)
        return
    if state == "no-pyocd":
        print("\nmb: built fine, but pyocd is not installed here, so it cannot flash.\n"
              "    Install it with:  python3 tools/mb.py setup\n"
              + browser)
        return
    if state == "denied":
        print("\nmb: built fine, and the board is there -- but this user is not "
              "allowed to open it.\n"
              "    Install the udev rule once:\n"
              f"      sudo cp {rel(UDEV_RULE)} /etc/udev/rules.d/\n"
              "      sudo udevadm control --reload-rules && sudo udevadm trigger\n"
              "    Then unplug and replug the board.  Or: python3 tools/mb.py setup\n"
              + browser)
        return
    if in_container():
        print("\nmb: built fine, but there is no USB access in a Codespace.\n"
              "    Ctrl+Shift+B flashes through the micro:bit flasher extension in your\n"
              "    browser; if it ran this task instead, the extension is not installed\n"
              "    there: Extensions view, AIUnderstand.microbit-flasher, Install.\n"
              + browser)
        return
    print("\nmb: built fine, but no micro:bit is visible.\n"
          "    Check the cable carries data -- some only carry power -- and that the\n"
          "    board appears as a MICROBIT drive.  Then try again.\n"
          + evidence + browser)


def no_probe_hint() -> None:
    cannot_flash_hint(probe_check())


def cmd_flash(args) -> int:
    if not args.no_build:
        rc = cmd_build(args)
        if rc:
            return rc
    elf = BUILD / "main.elf"
    if not elf.is_file():
        die("nothing built yet - run: mb.py build")
    check = probe_check()
    if check.state != "ok":
        cannot_flash_hint(check)
        return 0
    # With several boards plugged in, the flasher's choice decides which.
    board = chosen_board(check.listing)
    rc = alr_exec([pyocd_path(), "load", "-t", TARGET, "--format", "elf"]
                  + (["-u", board] if board else []) + [rel(elf)])
    if rc == 0:
        info("serial output: VS Code's Serial Monitor extension (Microsoft), "
             "the board's port at 115200 baud")
    return rc


def _venv_python() -> Path:
    return VENV_DIR / ("Scripts" if os.name == "nt" else "bin") / (
        "python.exe" if os.name == "nt" else "python3")


def _python_with_pyserial() -> str | None:
    """A Python that can import pyserial: setup's venv first, then this one."""
    cands = [str(_venv_python())] if _venv_python().is_file() else []
    cands.append(sys.executable)
    for py in cands:
        rc, _ = capture([py, "-c", "import serial"])
        if rc == 0:
            return py
    return None


def cmd_boards(args) -> int:
    """The micro:bits on this machine, and their serial: tools/serial_bridge.py.

    The desktop end of the extension's Serial view. The companion extension
    runs this with --watch and relays it; --list is for people. pyserial lives
    in setup's venv next to pyocd; a venv from before it was added gets it
    installed here rather than sending the student back through setup.
    """
    if in_container():
        print(json.dumps({"event": "error", "message": "a Codespace has no USB; the boards are in the browser"}))
        return 1
    py = _python_with_pyserial()
    if not py and _venv_python().is_file():
        info("installing pyserial into setup's venv")
        run([str(_venv_python()), "-m", "pip", "install", "--quiet", "pyserial"], quiet=True)
        py = _python_with_pyserial()
    if not py:
        print(json.dumps({"event": "error", "message": "pyserial is not installed. Run:  python3 tools/mb.py setup"}))
        return 1
    return run([py, str(BRIDGE), "--watch" if args.watch else "--list"], quiet=True)


def chosen_board(listing: str) -> str | None:
    """The board the flasher chose (build/board.txt), if pyocd sees it."""
    try:
        wanted = BOARD_FILE.read_text().strip()
    except OSError:
        return None
    if not wanted:
        return None
    if wanted in listing:
        return wanted
    info(f"note: the chosen board {wanted[:8]}... is not connected; using the one that is")
    return None


def cmd_erase(args) -> int:
    check = probe_check()
    if check.state != "ok":
        cannot_flash_hint(check)
        return 0
    return alr_exec([pyocd_path(), "erase", "--mass", "-t", TARGET])


def proof_gpr(gpr: Path) -> Path:
    """The project GNATprove should analyse.

    GNATprove analyses every unit it can see, and the Ada Drivers Library is not
    SPARK, so proving a program that withs the ADL fails on the ADL's own code
    rather than on the student's. Each spark/ example therefore ships a
    proof.gpr covering only its hardware-free core; use it when present.
    """
    candidate = gpr.parent / "proof.gpr"
    return candidate if candidate.is_file() else gpr


def prove_one(pid: str, gpr: Path, args) -> bool:
    target = proof_gpr(gpr)
    if target == gpr and not (gpr.parent / "src" / "core").is_dir():
        info(f"note: {pid} has no proof.gpr; proving the whole project")
    info(f"proving {pid} ({rel(target)})")
    # Without --checks-as-errors, gnatprove reports an unproved check and still
    # exits 0 -- a proof gate that cannot fail is not a gate.
    cmd = ["gnatprove", "-P", rel(target), "-j0", "--report=all",
           "--checks-as-errors=on", f"--mode={args.mode}"]
    if args.level is not None:
        cmd.append(f"--level={args.level}")
    return alr_exec(cmd) == 0


def cmd_prove(args) -> int:
    if args.all_spark:
        projects = {k: v for k, v in discover().items() if k.startswith("spark/")}
        if not projects:
            die("no spark/ examples found")
        failed = [pid for pid in sorted(projects)
                  if not prove_one(pid, projects[pid], args)]
        print(f"\n{len(projects) - len(failed)}/{len(projects)} spark example(s) proved")
        if failed:
            print("unproved: " + ", ".join(failed))
        return 1 if failed else 0

    if args.use:
        pid, gpr = resolve_id(args.use)
    elif args.use_dir:
        pid, gpr = resolve_dir(Path(args.use_dir))
    else:
        pid, gpr = "template", TEMPLATE_GPR
    return 0 if prove_one(pid, gpr, args) else 1


# --------------------------------------------------------------------------
# housekeeping
# --------------------------------------------------------------------------

def _summary(gpr: Path) -> str:
    """First prose line of an example's README, used as the gallery caption."""
    readme = gpr.parent / "README.md"
    if not readme.is_file():
        return ""
    for line in readme.read_text(errors="replace").splitlines():
        line = line.strip()
        if line and not line.startswith(("#", "|", "-", "*", "`", ">")):
            # Plain prose for a dropdown: drop the markdown emphasis and code ticks.
            line = re.sub(r"\*\*(.+?)\*\*", r"\1", line)
            line = re.sub(r"`([^`]+)`", r"\1", line)
            return line.rstrip(":.").strip()
    return ""


def cmd_gallery(args) -> int:
    """Build every project and emit .hex files plus a manifest.

    Used by the Pages workflow so the browser flasher can offer ready-built
    firmware. The output is deployed as a Pages artifact and never committed,
    so this costs nothing in the repository.
    """
    import json

    out = Path(args.out)
    if not out.is_absolute():
        out = REPO / out
    out.mkdir(parents=True, exist_ok=True)

    projects = discover()
    entries, failed = [], []
    for pid in sorted(projects):
        gpr = projects[pid]
        if not build_one(pid, gpr, quiet=True):
            print(f"  FAIL  {pid}")
            failed.append(pid)
            continue
        exe = built_exe(gpr)
        name = pid.replace("/", "-") + ".hex"
        hexf = out / name
        if alr_exec([OBJCOPY, "-O", "ihex", rel(exe), rel(hexf)], quiet=True) != 0:
            print(f"  FAIL  {pid} (objcopy)")
            failed.append(pid)
            continue
        entries.append({
            "id": pid,
            "family": pid.split("/")[0] if "/" in pid else "template",
            "label": pid.split("/")[-1].replace("_", " "),
            "hex": name,
            "bytes": hexf.stat().st_size,
            "summary": _summary(gpr),
        })
        print(f"  ok    {pid}  ({hexf.stat().st_size // 1024} KB)")

    manifest = {
        # Stamped by the caller so this stays deterministic and resumable.
        "commit": args.commit or "",
        "built": args.built or "",
        "projects": entries,
    }
    (out / "index.json").write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(e["bytes"] for e in entries)
    print(f"\n{len(entries)} firmware image(s), {total // 1024} KB, manifest at {rel(out / 'index.json')}")
    if failed:
        print("failed: " + ", ".join(failed))
    return 1 if failed else 0


def cmd_list(args) -> int:
    projects = discover()
    quarantined = load_known_failures()
    width = max((len(k) for k in projects), default=10)
    for pid in sorted(projects):
        mark = "  [known failure]" if pid in quarantined else ""
        print(f"  {pid.ljust(width)}  {rel(projects[pid])}{mark}")
    print(f"\n{len(projects)} project(s).")
    return 0


def cmd_serve(args) -> int:
    """Serve the flasher from this machine, with the firmware you just built.

    The point is Codespaces. A Codespace has no USB, so the firmware normally has
    to be downloaded and then handed to the flasher page by hand. Serving the
    page from inside the Codespace instead puts the page and the freshly built
    hex on the same origin, so the page can simply offer it -- no download, no
    drag.

    The forwarded URL is https://<codespace>-<port>.app.github.dev, which is a
    secure context, and WebUSB requires one.
    """
    import http.server
    import json
    import socketserver

    if not args.no_build:
        rc = cmd_build(args)
        if rc:
            return rc

    hexf = BUILD / "main.hex"
    if not hexf.is_file():
        die("nothing built yet - run: mb.py build")

    site = BUILD / "site"
    if site.exists():
        shutil.rmtree(site)
    shutil.copytree(REPO / "docs", site)
    firmware = site / "firmware"
    firmware.mkdir(parents=True, exist_ok=True)
    shutil.copy2(hexf, firmware / "main.hex")

    last = BUILD / "last-project.txt"
    built = last.read_text().strip() if last.is_file() else "your project"
    manifest = {
        "commit": "", "built": "",
        "projects": [{
            "id": built,
            "family": "build",
            "label": f"{built} (just built here)",
            "hex": "main.hex",
            "bytes": hexf.stat().st_size,
            "summary": "the firmware currently in build/",
        }],
    }
    (firmware / "index.json").write_text(json.dumps(manifest, indent=2) + "\n")

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(site), **kw)

        def end_headers(self):
            # Always hand out the current build, never a cached one.
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, fmt, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", args.port), Handler) as httpd:
        print()
        info(f"serving the flasher on port {args.port}, offering: {built}")
        print()
        print("  In a Codespace: open the PORTS panel, find this port, and click")
        print("  the globe icon to open it in your browser.")
        print()
        print("  It must be a real browser tab. VS Code's Simple Browser is an")
        print("  iframe and WebUSB will not work there.")
        print()
        print(f"  Locally: http://localhost:{args.port}/")
        print()
        print("  Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print()
            info("stopped")
    return 0


EXTENSION_DIR = REPO / "extension"


def _adapt_library() -> str:
    """Turn the vendored ESM bundle into a classic worker script.

    The VS Code web extension host loads a classic script, which cannot use
    `export`, so the export clause becomes assignments onto globalThis. Done at
    package time rather than committed twice, so docs/vendor stays the single
    source of the library.
    """
    import re
    src = (REPO / "docs/vendor/microbit-connection-usb.mjs").read_text()
    body = re.sub(r"^/\*.*?\*/\s*", "", src, flags=re.S)
    body = re.sub(r"\n//# sourceMappingURL=\S*\s*$", "\n", body)
    m = re.search(r"export\s*\{([^}]*)\}\s*;?", body)
    if not m:
        die("could not find the export clause in the vendored library")
    names = {}
    for part in m.group(1).split(","):
        local, _, exported = part.strip().partition(" as ")
        names[(exported or local).strip()] = local.strip()
    body = body[:m.start()] + body[m.end():]
    assigns = "\n".join(f"globalThis.{k} = {v};" for k, v in names.items())
    return body.rstrip() + "\n" + assigns + "\n"


def cmd_extension(args) -> int:
    """Assemble the VS Code web extension as a folder, ready to publish or serve.

    Nothing is installed into a VS Code here, and no .vsix is built, on
    purpose. An extension installed *into* a Codespace cannot run in the
    browser client: its code is fetched by the web worker host, which lives on
    another origin, and that request bypasses GitHub's routing for the page --
    microsoft/vscode#144513, open since 2022 (the symptom is "Activating..."
    forever, and a 404 on extension.js in the Network tab). Web extensions
    work in a Codespace when they are installed *in the browser* from the
    Marketplace -- this one as AIUnderstand.microbit-flasher, published by the
    publish-extension workflow with vsce from this folder. Nothing else can
    deliver it: the Codespaces page policy admits only the Marketplace CDNs,
    so GitHub Pages and "Install Extension from Location..." are blocked.
    """
    out = Path(args.out).resolve() if args.out else BUILD / "extension"
    write_extension(out, args.version)
    size = (out / "extension.js").stat().st_size // 1024
    info(f"extension assembled in {rel(out)} ({size} KB, version "
         f"{json_load(out / 'package.json')['version']})")
    return 0


def cmd_companion(args) -> int:
    """Assemble the Codespace-side companion extension as a folder.

    It runs in the container, where devcontainer.json installs it like any
    other, and asks the workbench to install the flasher into the browser --
    the one way a repository can get a web extension in front of a student
    without a click. Plain Node, nothing to bundle.
    """
    out = Path(args.out).resolve() if args.out else BUILD / "companion"
    write_companion(out, args.version)
    info(f"companion assembled in {rel(out)} (version {json_load(out / 'package.json')['version']})")
    return 0


def write_companion(out: Path, version: str | None = None) -> None:
    import json
    src = REPO / "companion"
    pkg = json_load(src / "package.json")
    if version:
        pkg["version"] = version
    if out.is_relative_to(BUILD) and out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "package.json").write_text(json.dumps(pkg, indent=2) + "\n")
    for name in ("extension.js", "README.md"):
        shutil.copy2(src / name, out / name)
    for name in ("LICENSE", "LICENSE.md", "LICENSE.txt"):
        if (REPO / name).is_file():
            shutil.copy2(REPO / name, out / "LICENSE")
            break


def write_extension(out: Path, version: str | None = None) -> None:
    """package.json, the bundled extension.js, README and LICENSE into `out`.

    The version normally comes from extension/package.json; the publishing
    workflow overrides it with a monotonic one, since the Marketplace needs
    each release to be higher than the last.
    """
    import json
    pkg = json_load(EXTENSION_DIR / "package.json")
    if version:
        pkg["version"] = version
    # One classic script, so the three parts share a scope: the library's
    # globals, then GdbServer, then the extension that uses both.
    bundled = (
        "// Generated by tools/mb.py extension. Do not edit.\n"
        "// Part 1: @microbit/microbit-connection, adapted for a classic worker.\n"
        + _adapt_library()
        + "\n// Part 2: the GDB remote-protocol server (extension/gdbserver.js).\n"
        + (EXTENSION_DIR / "gdbserver.js").read_text()
        + "\n// Part 3: the extension itself (extension/extension.js).\n"
        + (EXTENSION_DIR / "extension.js").read_text()
    )
    if out.is_relative_to(BUILD) and out.exists():
        shutil.rmtree(out)  # ours; a stale file here would be published too
    out.mkdir(parents=True, exist_ok=True)
    (out / "package.json").write_text(json.dumps(pkg, indent=2) + "\n")
    (out / "extension.js").write_text(bundled)
    (out / "README.md").write_text((EXTENSION_DIR / "README.md").read_text())
    for name in ("LICENSE", "LICENSE.md", "LICENSE.txt"):
        if (REPO / name).is_file():
            shutil.copy2(REPO / name, out / "LICENSE")
            break


def json_load(path: Path):
    import json
    return json.loads(path.read_text())


def cmd_clean(args) -> int:
    target = BUILD.resolve()
    if REPO not in target.parents and target != BUILD.resolve():
        die("refusing to remove a path outside the repository")
    if target.exists():
        shutil.rmtree(target)
        info(f"removed {rel(target)}")
    else:
        info("nothing to clean")
    return 0


ALS_CGPR = BUILD / "als.cgpr"   # the toolchain, spelled out for the language server
BRIDGE = REPO / "tools" / "serial_bridge.py"   # runs under the Python that has pyserial
BOARD_FILE = BUILD / "board.txt"   # the board the flasher chose, by unique id


def project_runtime(gpr: Path) -> str:
    """The Ada runtime a project builds with: named in it, or in a project it
    withs (the zfp examples take the board project's), else the template's."""
    named = runtime_named(gpr)
    if named:
        return named
    try:
        text = gpr.read_text(errors="replace")
    except OSError:
        return "embedded-nrf52833"
    for m in re.finditer(r'with\s+"([^"]+)"', text):
        withed = (gpr.parent / m.group(1).replace("//", "/")).resolve()
        named = runtime_named(withed) if withed.is_file() else None
        if named:
            return named
    return "embedded-nrf52833"


def write_als_config(gpr: Path) -> bool:
    """Write build/als.cgpr: the compiler's location and the runtime, for the
    Ada Language Server.

    The server finds the toolchain through "alr printenv" -- and looks for alr
    on PATH only, which setup deliberately never edits. On a Windows PC the
    result was a project that "could not be loaded", red under every name
    from the drivers library, and no Go to Definition, while the same clone
    on a Mac with alr on PATH worked. A configuration file carries the
    driver and runtime paths instead, so the server loads the project with
    nothing on PATH at all: reproduced headless here, alr and toolchain
    hidden, red lines without it and a definition in microbit.ads with it.
    Per machine, so it lives in build/ and is written by setup and by "als".
    """
    runtime = project_runtime(gpr)
    BUILD.mkdir(parents=True, exist_ok=True)
    rc, out = capture(["alr", "exec", "--", "gprconfig", "--batch", "--target=arm-eabi",
                       f"--config=Ada,,{runtime}", "--config=Asm_Cpp",
                       "-o", rel(ALS_CGPR)])
    # gprconfig exits 0 with a file that has no Ada in it when the runtime
    # does not exist; Runtime_Dir is what the server needs from it.
    if rc != 0 or not ALS_CGPR.is_file() or "Runtime_Dir" not in ALS_CGPR.read_text(errors="replace"):
        last = [l for l in out.strip().splitlines() if l.strip()]
        print(f"  FAILED   language server configuration for runtime {runtime}: "
              f"{last[-1][:100] if last else 'no Ada compiler in the result'}")
        return False
    return True


def cmd_als(args) -> int:
    """Point the Ada Language Server at a project, without popup spam."""
    if args.use:
        pid, gpr = resolve_id(args.use)
    elif args.use_dir:
        pid, gpr = resolve_dir(Path(args.use_dir))
    else:
        pid, gpr = "template", TEMPLATE_GPR
    return 0 if point_als_at(pid, gpr) else 1


def point_als_at(pid: str, gpr: Path) -> bool:
    """build/als.cgpr for the project's runtime, and .als.json naming both."""
    import json
    have_cgpr = write_als_config(gpr)
    settings = {"projectFile": rel(gpr)}
    if have_cgpr:
        settings["gprConfigurationFile"] = rel(ALS_CGPR)
        # With the toolchain spelled out, "alr not found in PATH" is a fact,
        # not a problem; it would sit in the Problems panel as one.
        settings["alireDiagnostics"] = False
    wanted = json.dumps(settings, indent=2) + "\n"
    # Only write when the content actually changes: the extension watches
    # **/.als.json and offers to restart the language server on every write.
    if ALS_JSON.is_file() and ALS_JSON.read_text() == wanted:
        info(f"language server already pointed at {pid}")
        return have_cgpr
    ALS_JSON.write_text(wanted)
    info(f"language server now pointed at {pid} ({rel(gpr)})")
    return have_cgpr


def _version_line(out: str) -> str:
    """First line of a --version that is actually the version.

    Commands run through "alr exec" can be preceded by Alire's own chatter
    ("Note: Synchronizing workspace..."), which would otherwise be reported as
    the tool's version in doctor output.
    """
    # Alire prints its own progress and dependency-solving output before running
    # the command, and some of it contains digits ("+b gnat_arm_elf 15.1.2
    # (new,binary)"), so a digit test alone is not enough. -q would suppress the
    # command's own output too, so filter explicitly.
    noise_prefix = ("Note:", "Warning:", "Info:", "ERROR:", "+", "-", "#")
    noise_substr = ("Synchronizing", "Dependencies automatically",
                    "(new,binary)", "Nothing to update", "Deploying",
                    "installed successfully", "set as default")
    for line in out.splitlines():
        line = line.strip()
        if not line or line.startswith(noise_prefix):
            continue
        if any(n in line for n in noise_substr):
            continue
        if not any(c.isdigit() for c in line):
            continue
        return line
    return ""


def _alr_asset() -> tuple[str, str]:
    """(asset key, archive name) for this machine."""
    import platform
    m = platform.machine().lower()
    arch = "aarch64" if m in ("arm64", "aarch64") else "x86_64"
    if sys.platform.startswith("linux"):
        osname = "linux"
    elif sys.platform == "darwin":
        osname = "macos"
    elif os.name == "nt":
        osname = "windows"
        # Alire publishes no ARM64 Windows build. The x64 one under Windows'
        # emulation crashes immediately (0xC0000005, access violation), verified
        # on Windows 11 ARM64, so there is nothing useful to fall back to.
        native = (os.environ.get("PROCESSOR_ARCHITEW6432")
                  or os.environ.get("PROCESSOR_ARCHITECTURE", "")).upper()
        if "ARM" in native or m in ("arm64", "aarch64"):
            die("Windows on ARM is not supported.\n"
                "  Alire publishes no ARM64 Windows build, and the x64 build crashes\n"
                "  under Windows' x64 emulation.\n\n"
                "  Use the browser path instead - it needs nothing installed:\n"
                "    setup/codespace.md\n"
                "  Or use an x86-64 Windows machine, macOS, or Linux.")
        arch = "x86_64"
    else:
        die(f"unsupported platform: {sys.platform}")
    key = f"{arch}-{osname}"
    return key, f"alr-{ALR_VERSION}-bin-{key}.zip"


def _install_alr() -> bool:
    """Download, verify and unpack Alire into MANAGED_ALR_DIR."""
    import hashlib
    import urllib.request
    import zipfile

    key, asset = _alr_asset()
    expected = ALR_SHA256.get(key)
    if not expected:
        die(f"no pinned checksum for {key}")
    url = (f"https://github.com/alire-project/alire/releases/download/"
           f"v{ALR_VERSION}/{asset}")

    info(f"downloading Alire {ALR_VERSION} for {key}")
    tmp = REPO / "build" / "_alr_download.zip"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f)
    except Exception as err:                       # noqa: BLE001
        print(f"  download failed: {err}")
        return False

    got = hashlib.sha256(tmp.read_bytes()).hexdigest()
    if got != expected:
        tmp.unlink(missing_ok=True)
        die(f"checksum mismatch for {asset}\n  expected {expected}\n  got      {got}")
    info("checksum verified")

    if MANAGED_ALR_DIR.exists():
        shutil.rmtree(MANAGED_ALR_DIR)
    MANAGED_ALR_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(tmp) as z:
        z.extractall(MANAGED_ALR_DIR)
    tmp.unlink(missing_ok=True)

    for name in ("alr", "alr.exe"):
        exe = MANAGED_ALR_DIR / "bin" / name
        if exe.is_file():
            exe.chmod(0o755)
            info(f"installed {rel(exe) if REPO in exe.parents else exe}")
            return True
    print(f"  unpacked, but no alr binary under {MANAGED_ALR_DIR}")
    return False


def _offer_path(args) -> None:
    """Put our alr on PATH, so more than mb.py can find it.

    mb.py itself does not need this -- alr_path() records where alr is. But a
    student who types "alr" gets "not recognized", and VS Code's Ada extension
    and integrated terminal look at PATH like everything else. On Windows the
    user PATH lives in the registry and IS inherited by an application started
    from the Start menu, so setting it there actually fixes those. On Linux and
    macOS the equivalent edit only reaches terminals -- a desktop-launched
    VS Code reads neither .bashrc nor, on Wayland, .profile -- so we print the
    line rather than editing a shell file that would not have helped.
    """
    bindir = MANAGED_ALR_DIR / "bin"
    if not any((bindir / n).is_file() for n in _bin_names("alr")):
        return
    if shutil.which("alr"):
        return
    if os.name != "nt":
        print(f"           to type 'alr' yourself, add to your shell profile:")
        print(f'             export PATH="$PATH:{bindir}"')
        return
    if not _ask(args, "Add alr to your PATH, so VS Code and you can find it?"):
        print(f"           later, add this to PATH by hand: {bindir}")
        return
    # setx truncates at 1024 characters and expands %VARIABLES%; the .NET call
    # does neither.
    ps = ("$d = '{}'; "
          "$p = [Environment]::GetEnvironmentVariable('Path','User'); "
          "if ($p -notlike \"*$d*\") {{ "
          "[Environment]::SetEnvironmentVariable('Path', "
          "($p.TrimEnd(';') + ';' + $d), 'User') }}").format(bindir)
    if run(["powershell", "-NoProfile", "-Command", ps], quiet=True) == 0:
        print("  set      PATH now contains alr")
        print("           close and reopen VS Code and any terminal to pick it up")
    else:
        print(f"           could not set PATH; add this by hand: {bindir}")


def _ask(args, question: str) -> bool:
    """Ask before installing anything.

    Detection can be wrong -- a tool may be installed somewhere this script does
    not look -- so it must never install over the top of something silently.
    """
    if args.no_install_tools:
        return False
    if args.yes:
        return True
    if not sys.stdin.isatty():
        print("           (not a terminal: re-run with --yes to install automatically)")
        return False
    try:
        return input(f"           {question} [Y/n] ").strip().lower() in ("", "y", "yes")
    except (EOFError, KeyboardInterrupt):
        print()
        return False


def _install(label: str, cmd: list[str], note: str = "") -> bool:
    info(f"installing {label}: {' '.join(cmd)}")
    if note:
        print(f"           {note}")
    return run(cmd, quiet=True) == 0


def _install_git(args) -> bool:
    if os.name == "nt" and shutil.which("winget"):
        return _install("git", ["winget", "install", "--id", "Git.Git", "-e",
                                "--source", "winget", "--scope", "user",
                                "--accept-package-agreements",
                                "--accept-source-agreements"])
    if sys.platform == "darwin":
        # Apple ships git with the Command Line Tools. This opens a GUI prompt.
        return _install("the Xcode Command Line Tools", ["xcode-select", "--install"],
                        "accept the dialog that appears, then run setup again")
    if sys.platform.startswith("linux") and shutil.which("apt-get"):
        return _install("git", ["sudo", "apt-get", "install", "-y", "git"],
                        "sudo will ask for your password")
    return False


def _install_vscode(args) -> bool:
    if os.name == "nt" and shutil.which("winget"):
        return _install("VS Code", ["winget", "install", "--id",
                                    "Microsoft.VisualStudioCode", "-e",
                                    "--source", "winget", "--scope", "user",
                                    "--accept-package-agreements",
                                    "--accept-source-agreements"])
    if sys.platform == "darwin" and shutil.which("brew"):
        return _install("VS Code", ["brew", "install", "--cask",
                                    "visual-studio-code"])
    if sys.platform.startswith("linux") and shutil.which("snap"):
        return _install("VS Code", ["sudo", "snap", "install", "code", "--classic"],
                        "sudo will ask for your password")
    return False


def _toolchain_missing() -> list[str]:
    """Which of the two toolchain pieces cannot actually be run through alr."""
    missing = []
    for name, probe in (("gnat_arm_elf", ["arm-eabi-gcc", "-dumpversion"]),
                        ("gprbuild", ["gprbuild", "--version"])):
        rc, _ = capture(["alr", "exec", "--"] + probe)
        if rc != 0:
            missing.append(name)
    return missing


def _toolchain_ok() -> bool:
    return not _toolchain_missing()


def _pyocd_problem() -> str | None:
    """None when pyocd runs, otherwise one line saying what is wrong.

    Works with nothing plugged in: "pyocd list" loads the USB backend and
    prints that no probes are connected, which is a pass. A traceback there
    means the install is broken (usually a missing libusb), and that is the
    case worth catching at setup time rather than at flash time.
    """
    exe = pyocd_path()
    if os.path.sep not in exe:
        return "not installed"
    rc, out = capture([exe, "--version"])
    if rc != 0:
        return f"installed at {exe} but it does not run: {_version_line(out) or out.strip()[:120]}"
    rc, out = capture([exe, "list"])
    # A listed probe is proof of enumeration, whatever the exit code: on
    # Windows, pyocd 0.45 printed the board and then died on a check mark it
    # could not encode -- see capture() -- and this line blamed USB for it.
    if rc == 0 or "no available debug probes" in out.lower() or _probe_rows(out):
        return None
    last = [l for l in out.strip().splitlines() if l.strip()]
    return f"cannot enumerate USB: {last[-1] if last else 'unknown error'}"


def _install_pyocd() -> bool:
    """Into our own venv, not the system Python.

    "pip install --user" is refused outright on Ubuntu 23.04 and later
    (PEP 668, "externally-managed-environment"), and Ubuntu ships python3
    without pip at all, so the old call failed on exactly the machines that
    need it and the failure was reported as a note. A venv sidesteps both, and
    gives an absolute path the VS Code task can use without PATH.
    """
    venv_py = VENV_DIR / ("Scripts" if os.name == "nt" else "bin") / (
        "python.exe" if os.name == "nt" else "python3")
    if not venv_py.is_file():
        rc = run([sys.executable, "-m", "venv", str(VENV_DIR)], quiet=True)
        if rc != 0 or not venv_py.is_file():
            # Debian and Ubuntu split venv out of the standard library.
            print("           this machine's Python cannot create a virtual "
                  "environment.")
            if sys.platform.startswith("linux"):
                print("           install it with:  sudo apt install python3-venv")
            return False
    # pyserial is for "mb.py boards": the desktop's board list and serial.
    return run([str(venv_py), "-m", "pip", "install", "--quiet", "--upgrade",
                "pyocd>=0.44", "pyserial"], quiet=True) == 0


UDEV_TARGET = Path("/etc/udev/rules.d/50-microbit.rules")


def _install_udev(args) -> None:
    """Linux only: without this rule the device node is root-only.

    It blocks pyocd *and* the browser flasher, which is why students saw WebUSB
    fail with a security error after picking the board from the popup. udev runs
    on the host kernel, so there is nothing to do inside a container.
    """
    if not sys.platform.startswith("linux") or in_container():
        return
    if not UDEV_RULE.is_file():
        return
    if (UDEV_TARGET.is_file()
            and UDEV_TARGET.read_text() == UDEV_RULE.read_text()):
        print("  OK       udev rule (the board is openable without root)")
        return
    print("  MISSING  udev rule -- without it nothing can open the micro:bit,")
    print("           not pyocd and not the browser flasher")
    if not _ask(args, "Install it now? sudo will ask for your password."):
        print(f"           later:  sudo cp {rel(UDEV_RULE)} {UDEV_TARGET}")
        print("                   sudo udevadm control --reload-rules && "
              "sudo udevadm trigger")
        return
    if run(["sudo", "cp", str(UDEV_RULE), str(UDEV_TARGET)], quiet=True) != 0:
        print("  FAILED   could not install the rule")
        return
    run(["sudo", "udevadm", "control", "--reload-rules"], quiet=True)
    run(["sudo", "udevadm", "trigger"], quiet=True)
    print("  set      udev rule installed -- unplug and replug the board")


def code_cli() -> str | None:
    """VS Code's "code" command, wherever it is -- see _find_vscode() for why
    PATH is not enough. This is what installs extensions from setup."""
    for name in ("code", "code-insiders"):
        found = shutil.which(name)
        if found:
            return found
    candidates = [
        Path("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"),
        Path.home() / "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Microsoft VS Code/bin/code.cmd",
        Path(os.environ.get("PROGRAMFILES", "")) / "Microsoft VS Code/bin/code.cmd",
        Path("/usr/bin/code"),
        Path("/usr/share/code/bin/code"),
        Path("/snap/bin/code"),
        Path("/var/lib/flatpak/exports/bin/com.visualstudio.code"),
    ]
    for c in candidates:
        if str(c) not in ("", ".") and c.is_file():
            return str(c)
    return None


def recommended_extensions() -> list[str]:
    """The workspace's recommended extensions: .vscode/extensions.json, the one
    list, so setup and VS Code's own prompt never disagree."""
    try:
        text = (REPO / ".vscode" / "extensions.json").read_text()
        text = re.sub(r"^\s*//.*$", "", text, flags=re.M)
        return [str(e) for e in json.loads(text).get("recommendations", [])]
    except (OSError, ValueError):
        return []


def install_extensions() -> None:
    """Install the recommended extensions through the "code" command.

    VS Code offers them when the folder is opened, one click away; this puts
    them in place before that, so Microsoft's Serial Monitor is there when the
    first program prints. A Codespace gets its extensions from
    devcontainer.json instead, and nothing here is fatal: the prompt remains.
    """
    if in_container():
        return
    cli = code_cli()
    if not cli:
        print("  skipped  VS Code extensions: no 'code' command found. VS Code offers "
              "the recommended ones when you open the folder.")
        return
    for ext in recommended_extensions():
        rc, out = capture([cli, "--install-extension", ext])
        if rc == 0:
            state = "already installed" if "already installed" in out else "installed"
            print(f"  OK       VS Code extension {ext} ({state})")
        else:
            last = [l for l in out.strip().splitlines() if l.strip()]
            print(f"  FAILED   VS Code extension {ext}: {last[-1][:100] if last else 'no output'}")
            print("           Install it from the Extensions view instead.")


def _find_vscode() -> bool:
    """Is VS Code installed?

    Checks for the application as well as the "code" command: on macOS that
    command exists only after running "Shell Command: Install 'code' command in
    PATH", so testing PATH alone reports a false negative on most installs.
    """
    if code_cli():
        return True
    candidates = [
        Path("/Applications/Visual Studio Code.app"),
        Path.home() / "Applications/Visual Studio Code.app",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Microsoft VS Code/Code.exe",
        Path(os.environ.get("PROGRAMFILES", "")) / "Microsoft VS Code/Code.exe",
        Path("/usr/share/code/code"),
        Path("/snap/bin/code"),
        Path("/var/lib/flatpak/exports/bin/com.visualstudio.code"),
    ]
    return any(str(c) not in ("", ".") and c.exists() for c in candidates)


def _check_tools(args) -> tuple[bool, bool]:
    """(git_ok, vscode_ok). Both are required; VS Code is how the course is taught."""
    # --- git ---
    if shutil.which("git"):
        rc, out = capture(["git", "--version"])
        print(f"  OK       {_version_line(out) or 'git'}")
        git_ok = True
    else:
        print("  MISSING  git -- needed to fetch the drivers library")
        git_ok = False
        if _ask(args, "Install git now?"):
            git_ok = _install_git(args) and bool(shutil.which("git"))
        if not git_ok:
            if os.name == "nt":
                print("           winget install --id Git.Git -e")
            elif sys.platform == "darwin":
                print("           xcode-select --install")
            else:
                print("           sudo apt install git")

    # --- VS Code ---
    if _find_vscode():
        print("  OK       VS Code")
        code_ok = True
    else:
        print("  MISSING  VS Code -- used for editing, building and debugging")
        code_ok = False
        if _ask(args, "Install VS Code now?"):
            code_ok = _install_vscode(args) or _find_vscode()
        if not code_ok:
            print("           https://code.visualstudio.com/download")
            print("           (if it is already installed, this check simply did not "
                  "find it -- carry on)")

    return git_ok, code_ok


def cmd_setup(args) -> int:
    """One command that makes a fresh machine ready to build.

    Everything here is idempotent: run it again after a failure, or to repair an
    installation, and it will skip what is already done.
    """
    ok = True
    print(f"Setting up {rel(REPO)}\n")

    # 1. Python -----------------------------------------------------------
    v = sys.version_info
    if (v.major, v.minor) < (3, 9):
        die(f"Python 3.9+ required, found {v.major}.{v.minor}")
    print(f"  OK       python {v.major}.{v.minor}.{v.micro}")

    # 2. git and VS Code ---------------------------------------------------
    git_ok, code_ok = _check_tools(args)
    if not git_ok:
        print("\n  git is needed to fetch the drivers library. Install it and run "
              "setup again.")
        return 1
    if not code_ok:
        ok = False

    if os.name == "nt":
        # The drivers library carries a bundled Unity project whose paths exceed
        # the Windows 260-character limit; without this a clone silently
        # truncates and nothing builds.
        rc, out = capture(["git", "config", "--global", "core.longpaths"])
        if out.strip() != "true":
            run(["git", "config", "--global", "core.longpaths", "true"], quiet=True)
            print("  set      git core.longpaths=true (needed on Windows)")
        else:
            print("  OK       git core.longpaths")

    board = REPO / "Code/libs/Ada_Drivers_Library/boards"
    if not board.is_dir():
        info("fetching the drivers submodule")
        if run(["git", "submodule", "update", "--init", "--recursive"], quiet=True) != 0:
            print("  MISSING  submodule -- run: git submodule update --init --recursive")
            ok = False
        else:
            print("  OK       drivers submodule")
    else:
        print("  OK       drivers submodule")

    # 3. Alire -------------------------------------------------------------
    rc, out = capture(["alr", "--version"])
    if rc == 0:
        print(f"  OK       {_version_line(out)}")
    else:
        if not _install_alr():
            print("\n  Could not install Alire automatically. Install it by hand from")
            print("  https://alire.ada.dev/ and run this again.")
            return 1
        rc, out = capture(["alr", "--version"])
        print(f"  OK       {_version_line(out)}")
        _offer_path(args)

    # Written down now, in the terminal, where PATH works. A VS Code task has
    # its own environment and often does not, and this is what lets it run the
    # same alr instead of failing with "alr not found".
    remember_alr()

    if os.name == "nt":
        # Already done by skip_msys2() before the first alr call above; say so,
        # because a student who hit the old hang needs to see it is now off.
        print("  set      msys2.do_not_install=true")

    # 4. Toolchain ----------------------------------------------------------
    # The select is checked afterwards, not trusted: a Windows student ended up
    # with Alire on disk and neither compiler nor gprbuild, and setup had said
    # nothing. So: verify, try once more, and if it still is not there, say
    # what to run by hand -- with the full path to alr, which is not on PATH.
    if _toolchain_ok() and not args.force:
        print("  OK       toolchain already selected")
    else:
        info(f"installing gnat_arm_elf={GNAT_VERSION} and gprbuild={GPRBUILD_VERSION}")
        print("           about 550 MB, unpacking to roughly 2 GB -- this takes a while")
        run(["alr", "settings", "--global", "--set", "toolchain.assistant", "false"],
            quiet=True)
        select = ["alr", "--non-interactive", "toolchain", "--select",
                  f"gnat_arm_elf={GNAT_VERSION}", f"gprbuild={GPRBUILD_VERSION}"]
        run(select)
        if not _toolchain_ok():
            info("the toolchain is not usable yet -- trying once more")
            run(select)
        missing = _toolchain_missing()
        if not missing:
            print("  OK       toolchain installed and verified")
        else:
            ok = False
            print(f"  FAILED   toolchain: {', '.join(missing)} not usable after two tries")
            print("           Usually the download stopped part way (network, proxy,")
            print("           or too little disk: it needs about 2 GB). Run this by")
            print("           hand and read its output, then run setup again:")
            print(f"             \"{alr_path()}\" toolchain --select "
                  f"gnat_arm_elf={GNAT_VERSION} gprbuild={GPRBUILD_VERSION}")
            print(f"           \"{alr_path()}\" toolchain   shows what is installed.")

    if _toolchain_ok():
        # The Ada extension: it looks for alr on PATH, which we never edit.
        chosen = PROJECT_FILE.read_text().strip() if PROJECT_FILE.is_file() else "template"
        try:
            pid, gpr = ("template", TEMPLATE_GPR) if chosen == "template" else resolve_id(chosen)
        except SystemExit:
            pid, gpr = "template", TEMPLATE_GPR
        if point_als_at(pid, gpr):
            print(f"  OK       language server configuration ({rel(ALS_CGPR)}, {pid})")

    # 5. pyocd ---------------------------------------------------------------
    # Checked the same way as Alire and the toolchain. It used to be a "note",
    # so a student whose pyocd never installed learned that from a failed
    # flash, with a message about Codespaces. No board is needed to check it:
    # "pyocd list" exercises the whole USB stack and reports zero probes.
    if not args.no_pyocd:
        if os.path.sep not in pyocd_path():
            info("installing pyocd (for flashing and debugging from this machine)")
            _install_pyocd()
        problem = _pyocd_problem()
        if problem is None:
            print(f"  OK       pyocd ({pyocd_path()})")
        else:
            ok = False
            print(f"  FAILED   pyocd: {problem}")
            print("           Building and proving work without it. Flashing from")
            print("           this machine does not; the browser flasher still does.")

    # 6. udev (Linux, on the host) ------------------------------------------
    _install_udev(args)

    # 7. VS Code extensions --------------------------------------------------
    install_extensions()

    print()
    if not ok:
        print("Setup finished with problems. See the messages above.")
        if not code_ok:
            print("VS Code is missing: install it, then this project is ready to use.")
        return 1
    print("Setup complete. Checking:\n")
    cmd_doctor(args)
    print("\nNext: open this folder in VS Code and press Ctrl+Shift+B.")
    return 0


def cmd_doctor(args) -> int:
    """Exit non-zero only for build-critical tools; flashing tools are optional."""
    chosen = PROJECT_FILE.read_text().strip() if PROJECT_FILE.is_file() else "template"
    print(f"Project: {chosen}  (Choose project... changes it; 'template' is your own program)")
    print("Build tools (required):")
    # The resolved path, not just a version: "works in the terminal, MISSING in
    # the task" is a PATH problem, and this is the line that shows it.
    print(f"  using    alr: {alr_path()}")
    critical_ok = True
    for name, probe in (("alr", ["alr", "--version"]),
                        ("gprbuild", ["alr", "exec", "--", "gprbuild", "--version"]),
                        ("arm-eabi-gcc", ["alr", "exec", "--", "arm-eabi-gcc", "-dumpversion"]),
                        (OBJCOPY, ["alr", "exec", "--", OBJCOPY, "--version"])):
        rc, out = capture(probe)
        first = _version_line(out)
        if rc == 0:
            print(f"  OK       {name}: {first}")
        else:
            print(f"  MISSING  {name}")
            critical_ok = False

    if ALS_CGPR.is_file():
        print(f"  OK       language server configuration: {rel(ALS_CGPR)}")
    else:
        print(f"  missing  language server configuration -- run: python3 tools/mb.py als\n"
              "           (without it the Ada extension needs alr on PATH; red lines and\n"
              "           no Go to Definition otherwise)")

    print("\nFlashing / debugging (optional - not available in a Codespace):")
    for name, probe in (("pyocd", [pyocd_path(), "--version"]),
                        ("arm-eabi-gdb", ["alr", "exec", "--", "arm-eabi-gdb", "--version"])):
        rc, out = capture(probe)
        first = _version_line(out)
        print(f"  {'OK      ' if rc == 0 else 'missing '} {name}"
              + (f": {first}" if rc == 0 else ""))
    check = probe_check()
    if check.state == "ok":
        print(f"  OK       probe detected by {check.exe}")
    else:
        print(f"  missing  no debug probe attached ({check.state})\n"
              f"           {check.exe} said: {check.said}")
    cli = code_cli()
    if cli and not in_container():
        rc, out = capture([cli, "--list-extensions"])
        have = {l.strip().lower() for l in out.splitlines()}
        for ext in recommended_extensions():
            print(f"  {'OK      ' if ext.lower() in have else 'missing '} VS Code extension {ext}")

    if not critical_ok:
        print("\nA build tool is missing. Run:  alr toolchain --select")
        return 1
    print("\nBuild environment looks good.")
    return 0


# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(prog="mb.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def target_flags(p):
        p.add_argument("--use", metavar="ID", help="project id (see: mb.py list)")
        p.add_argument("--use-dir", metavar="DIR",
                       help="build the project at or above DIR (for ${fileDirname})")
        p.add_argument("-v", "--verbose", action="store_true",
                       help="show every command gprbuild runs, the link line included")

    p = sub.add_parser("build", help="build a project")
    target_flags(p)
    p.add_argument("--all", action="store_true", help="build every project (regression sweep)")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("flash", help="build then flash")
    target_flags(p)
    p.add_argument("--no-build", action="store_true")
    p.add_argument("--all", action="store_false", help=argparse.SUPPRESS)
    p.set_defaults(func=cmd_flash, all=False)

    p = sub.add_parser("erase", help="mass-erase the board")
    p.set_defaults(func=cmd_erase)

    p = sub.add_parser("boards", help="the micro:bits on this machine, as JSON (the flasher's desktop end)")
    p.add_argument("--watch", action="store_true",
                   help="keep reporting changes, and take serial commands on stdin")
    p.set_defaults(func=cmd_boards)

    p = sub.add_parser("prove", help="run gnatprove (SPARK)")
    target_flags(p)
    p.add_argument("--all-spark", action="store_true",
                   help="prove every spark/ example")
    p.add_argument("--mode", default="flow", choices=["check", "flow", "prove", "all"])
    p.add_argument("--level", type=int, choices=[0, 1, 2, 3, 4])
    p.set_defaults(func=cmd_prove)

    p = sub.add_parser("list", help="list buildable projects")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("gallery",
                       help="build every project and emit .hex files + a manifest")
    p.add_argument("--out", default="site/firmware", help="output directory")
    p.add_argument("--commit", default="", help="commit sha to record in the manifest")
    p.add_argument("--built", default="", help="ISO timestamp to record in the manifest")
    p.set_defaults(func=cmd_gallery)

    p = sub.add_parser("serve",
                       help="serve the flasher with your latest build (for Codespaces)")
    target_flags(p)
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--no-build", action="store_true")
    p.add_argument("--all", action="store_false", help=argparse.SUPPRESS)
    p.set_defaults(func=cmd_serve, all=False)

    p = sub.add_parser("extension",
                       help="assemble the VS Code web extension folder (to publish or serve)")
    p.add_argument("--out", help="output folder (default: build/extension)")
    p.add_argument("--version",
                   help="override the version from extension/package.json "
                        "(the publishing workflow passes a monotonic one)")
    p.set_defaults(func=cmd_extension)

    p = sub.add_parser("companion",
                       help="assemble the Codespace-side companion extension folder")
    p.add_argument("--out", help="output folder (default: build/companion)")
    p.add_argument("--version", help="override the version from companion/package.json")
    p.set_defaults(func=cmd_companion)

    p = sub.add_parser("clean", help="remove the build tree")
    p.set_defaults(func=cmd_clean)

    p = sub.add_parser("als", help="point the Ada Language Server at a project")
    target_flags(p)
    p.set_defaults(func=cmd_als)

    p = sub.add_parser("setup",
                       help="install everything needed to build (run this first)")
    p.add_argument("--no-pyocd", action="store_true",
                   help="skip pyocd; flash from the browser instead")
    p.add_argument("--force", action="store_true",
                   help="reinstall the toolchain even if one is present")
    p.add_argument("--no-install-tools", action="store_true",
                   help="never install git or VS Code, only report them")
    p.add_argument("--yes", "-y", action="store_true",
                   help="answer yes to install prompts (for unattended runs)")
    p.set_defaults(func=cmd_setup)

    p = sub.add_parser("doctor", help="check the toolchain")
    p.set_defaults(func=cmd_doctor)

    args = ap.parse_args()
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
