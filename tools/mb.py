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
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUILD = REPO / "build"
OBJ_TREE = BUILD / "obj"
TEMPLATE_GPR = REPO / "Code" / "itrs.gpr"
EXAMPLES = REPO / "Code/libs/Ada_Drivers_Library/examples/MicroBit_v2"
KNOWN_FAILURES = REPO / "tools" / "known_failures.txt"
ALS_JSON = REPO / ".als.json"

TARGET = "nrf52833"
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

def run(cmd: list[str], quiet: bool = False) -> int:
    if not quiet:
        info(" ".join(cmd))
    try:
        return subprocess.call(cmd, cwd=REPO)
    except FileNotFoundError:
        die(f"{cmd[0]} not found. Install Alire and re-open the terminal.", 127)


def alr_exec(args: list[str], quiet: bool = False) -> int:
    return run(["alr", "exec", "--"] + args, quiet=quiet)


def capture(cmd: list[str]) -> tuple[int, str]:
    """Run and capture. Status is the command's own, never a pipeline's."""
    try:
        p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    except FileNotFoundError:
        return 127, ""
    return p.returncode, (p.stdout + p.stderr)


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

RELOCATE = ["--root-dir=.", f"--relocate-build-tree=build/obj"]


def built_exe(gpr: Path) -> Path:
    """Where gprbuild puts the executable inside the relocated tree."""
    return OBJ_TREE / rel(gpr.parent) / "obj" / "main"


def build_one(pid: str, gpr: Path, quiet: bool = False) -> bool:
    if pid == "template":
        cmd = ["alr", "build", "--"] + RELOCATE
    else:
        cmd = ["alr", "exec", "--", "gprbuild", "-j0", "-p", "-P", rel(gpr)] + \
              RELOCATE + ["-cargs:ada", "-gnatef"]
    if quiet:
        rc, out = capture(cmd)
        if rc != 0:
            sys.stdout.write(out)
        return rc == 0
    return run(cmd) == 0


def stage_firmware(gpr: Path) -> bool:
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


def cmd_build(args) -> int:
    if args.all:
        return build_all(args)
    if args.use_dir:
        pid, gpr = resolve_dir(Path(args.use_dir))
    elif args.use:
        pid, gpr = resolve_id(args.use)
    else:
        pid, gpr = "template", TEMPLATE_GPR
    info(f"building {pid} ({rel(gpr)})")
    if not build_one(pid, gpr):
        return 1
    stage_firmware(gpr)
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

def probe_present() -> bool:
    rc, out = capture(["pyocd", "list"])
    if rc != 0:
        return False
    return bool([l for l in out.splitlines() if TARGET in l or "0d28" in l.lower()
                 or re.match(r"^\s*\d+\s", l)])


def no_probe_hint() -> None:
    print(
        "\nmb: built fine, but no debug probe is visible here.\n"
        "    In a Codespace or a Docker Desktop container there is no USB access.\n"
        f"    Download {rel(BUILD / 'main.hex')} and drag it onto the MICROBIT drive."
    )


def cmd_flash(args) -> int:
    if not args.no_build:
        rc = cmd_build(args)
        if rc:
            return rc
    elf = BUILD / "main.elf"
    if not elf.is_file():
        die("nothing built yet - run: mb.py build")
    if not probe_present():
        no_probe_hint()
        return 0
    return alr_exec(["pyocd", "load", "-t", TARGET, "--format", "elf", rel(elf)])


def cmd_erase(args) -> int:
    if not probe_present():
        no_probe_hint()
        return 0
    return alr_exec(["pyocd", "erase", "--mass", "-t", TARGET])


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


def cmd_als(args) -> int:
    """Point the Ada Language Server at a project, without popup spam."""
    if args.use:
        pid, gpr = resolve_id(args.use)
    elif args.use_dir:
        pid, gpr = resolve_dir(Path(args.use_dir))
    else:
        pid, gpr = "template", TEMPLATE_GPR
    import json
    wanted = json.dumps({"projectFile": rel(gpr)}, indent=2) + "\n"
    # Only write when the content actually changes: the extension watches
    # **/.als.json and offers to restart the language server on every write.
    if ALS_JSON.is_file() and ALS_JSON.read_text() == wanted:
        info(f"language server already pointed at {pid}")
        return 0
    ALS_JSON.write_text(wanted)
    info(f"language server now pointed at {pid} ({rel(gpr)})")
    return 0


def cmd_doctor(args) -> int:
    """Exit non-zero only for build-critical tools; flashing tools are optional."""
    print("Build tools (required):")
    critical_ok = True
    for name, probe in (("alr", ["alr", "--version"]),
                        ("gprbuild", ["alr", "exec", "--", "gprbuild", "--version"]),
                        ("arm-eabi-gcc", ["alr", "exec", "--", "arm-eabi-gcc", "-dumpversion"]),
                        (OBJCOPY, ["alr", "exec", "--", OBJCOPY, "--version"])):
        rc, out = capture(probe)
        first = out.strip().splitlines()[0] if out.strip() else ""
        if rc == 0:
            print(f"  OK       {name}: {first}")
        else:
            print(f"  MISSING  {name}")
            critical_ok = False

    print("\nFlashing / debugging (optional - not available in a Codespace):")
    for name, probe in (("pyocd", ["pyocd", "--version"]),
                        ("arm-eabi-gdb", ["alr", "exec", "--", "arm-eabi-gdb", "--version"])):
        rc, out = capture(probe)
        first = out.strip().splitlines()[0] if out.strip() else ""
        print(f"  {'OK      ' if rc == 0 else 'missing '} {name}"
              + (f": {first}" if rc == 0 else ""))
    print(f"  {'OK       probe detected' if probe_present() else 'missing  no debug probe attached'}")

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

    p = sub.add_parser("clean", help="remove the build tree")
    p.set_defaults(func=cmd_clean)

    p = sub.add_parser("als", help="point the Ada Language Server at a project")
    target_flags(p)
    p.set_defaults(func=cmd_als)

    p = sub.add_parser("doctor", help="check the toolchain")
    p.set_defaults(func=cmd_doctor)

    args = ap.parse_args()
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
