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

# Where "mb.py setup" puts alr when it is not already installed. Deliberately not
# on PATH: nothing here should require the student to edit their environment.
MANAGED_ALR_DIR = Path.home() / ".local" / "share" / "ada-microbit" / "alr"
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

def alr_path() -> str:
    """Where alr is, preferring one already on PATH.

    Falls back to the copy "mb.py setup" installs, so a student never has to
    edit PATH for this project to work.
    """
    found = shutil.which("alr")
    if found:
        return found
    for name in ("alr", "alr.exe"):
        managed = MANAGED_ALR_DIR / "bin" / name
        if managed.is_file():
            return str(managed)
    return "alr"


def run(cmd: list[str], quiet: bool = False) -> int:
    if not quiet:
        info(" ".join(cmd))
    if cmd and cmd[0] == "alr":
        cmd = [alr_path()] + cmd[1:]
    try:
        return subprocess.call(cmd, cwd=REPO)
    except FileNotFoundError:
        die(f"{cmd[0]} not found. Install Alire and re-open the terminal.", 127)


def alr_exec(args: list[str], quiet: bool = False) -> int:
    return run(["alr", "exec", "--"] + args, quiet=quiet)


def capture(cmd: list[str]) -> tuple[int, str]:
    """Run and capture. Status is the command's own, never a pipeline's."""
    if cmd and cmd[0] == "alr":
        cmd = [alr_path()] + cmd[1:]
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
    A plain build -- which is what Ctrl+Alt+F and "Build & Flash" run -- then
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
    if not build_one(pid, gpr):
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

def probe_present() -> bool:
    rc, out = capture(["pyocd", "list"])
    if rc != 0:
        return False
    return bool([l for l in out.splitlines() if TARGET in l or "0d28" in l.lower()
                 or re.match(r"^\s*\d+\s", l)])


def no_probe_hint() -> None:
    print(
        "\nmb: built fine, but no debug probe is visible here.\n"
        "    In a Codespace there is no USB access: flash from the browser instead --\n"
        "    press Ctrl+Alt+F (the micro:bit flasher extension), which builds and flashes.\n"
        f"    Or download {rel(BUILD / 'main.hex')} and drag it onto the MICROBIT drive."
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
    bundled = (
        "// Generated by tools/mb.py extension. Do not edit.\n"
        "// Part 1: @microbit/microbit-connection, adapted for a classic worker.\n"
        + _adapt_library()
        + "\n// Part 2: the extension itself (extension/extension.js).\n"
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


def _find_vscode() -> bool:
    """Is VS Code installed?

    Checks for the application as well as the "code" command: on macOS that
    command exists only after running "Shell Command: Install 'code' command in
    PATH", so testing PATH alone reports a false negative on most installs.
    """
    if shutil.which("code") or shutil.which("code-insiders"):
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

    if os.name == "nt":
        # Otherwise alr stops to install MSYS2, which a cross-compile-only
        # project never needs.
        run(["alr", "settings", "--global", "--set", "msys2.do_not_install", "true"],
            quiet=True)
        print("  set      msys2.do_not_install=true")

    # 4. Toolchain ----------------------------------------------------------
    rc, _ = capture(["alr", "exec", "--", "arm-eabi-gcc", "-dumpversion"])
    if rc == 0 and not args.force:
        print("  OK       toolchain already selected")
    else:
        info(f"installing gnat_arm_elf={GNAT_VERSION} and gprbuild={GPRBUILD_VERSION}")
        print("           about 550 MB, unpacking to roughly 2 GB -- this takes a while")
        run(["alr", "settings", "--global", "--set", "toolchain.assistant", "false"],
            quiet=True)
        if run(["alr", "--non-interactive", "toolchain", "--select",
                f"gnat_arm_elf={GNAT_VERSION}",
                f"gprbuild={GPRBUILD_VERSION}"]) != 0:
            print("  FAILED   toolchain install")
            ok = False

    # 5. pyocd (optional) ---------------------------------------------------
    if not args.no_pyocd:
        if shutil.which("pyocd"):
            print("  OK       pyocd")
        else:
            info("installing pyocd (for flashing and debugging from this machine)")
            rc = run([sys.executable, "-m", "pip", "install", "--user", "--quiet",
                      "--upgrade", "pyocd>=0.44"], quiet=True)
            if rc != 0:
                print("  note     pyocd not installed -- you can still flash from the browser")

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

    print("\nFlashing / debugging (optional - not available in a Codespace):")
    for name, probe in (("pyocd", ["pyocd", "--version"]),
                        ("arm-eabi-gdb", ["alr", "exec", "--", "arm-eabi-gdb", "--version"])):
        rc, out = capture(probe)
        first = _version_line(out)
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
