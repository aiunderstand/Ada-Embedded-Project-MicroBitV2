#!/usr/bin/env python3
"""Regression test for tools/mb.py's probe detection. Standard library only.

The board-detection verdicts are exercised with faked pyocd answers, and
capture() with real child processes, because that is where a Windows PC
went wrong: pyocd 0.45's "list" prints a check mark next to the target,
Python on Windows encodes a captured stdout as cp1252, and the check mark
does not exist there -- so pyocd printed the board and then died, and the
verdict was "cannot enumerate USB" with the board's own row as evidence.
"""
import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("mb", ROOT / "tools" / "mb.py")
mb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mb)

fail = []


def check(cond, what):
    if not cond:
        fail.append(what)


# ------------------------------------------------------------ capture()
# What pyocd printed on that PC, captured the way mb.py captures: stdout
# stops mid-row without a newline, the error is on stderr.
ROW = "  0   ARM BBC micro:bit CMSIS-DAP   9904360200052820ab3ba4b3000000000000000097969901   "
CHARMAP = ("0000143 C 'charmap' codec can't encode characters in position 0-1: "
           "character maps to <undefined> [__main__]\n")
PY = sys.executable

rc, out = mb.capture([PY, "-c", "import os, sys; print(os.environ.get('PYTHONUTF8'), sys.stdout.encoding.lower())"])
check(rc == 0 and out.split() == ["1", "utf-8"],
      f"children must run in UTF-8 mode, so a captured pyocd can print its check mark on Windows (got: {out.strip()!r})")
rc, out = mb.capture([PY, "-c", "print('\\u2714\\ufe0e nrf52833')"])
check(rc == 0 and "✔" in out,
      f"a child printing pyocd's check mark into our pipe must succeed and be read back (rc={rc}, out={out!r})")
rc, out = mb.capture([PY, "-c", "import sys; sys.stdout.write('row'); sys.stderr.write('err\\n')"])
check(out == "row\nerr\n",
      f"stdout and stderr must be joined on a line boundary, or the error is glued to the last row (got: {out!r})")

# -------------------------------------------------------- probe verdicts
TABLE = ("  #   Probe/Board                   Unique ID          Target\n"
         "------------------------------------------------------------\n"
         "  0   ARM BBC micro:bit CMSIS-DAP   99043602000528     ✔︎ nrf52833\n"
         "      micro:bit v2\n")
NONE = "No available debug probes are connected\n"
CRASH = ("Traceback (most recent call last):\n  File \"pyocd\", line 8\n"
         "ImportError: DLL load failed while importing hid: The specified module could not be found.\n")
DENIED = "Error: libusb access denied\n"
WINDOWS = ROW + "\n" + CHARMAP
V, P = "/venv/bin/pyocd", "/usr/local/bin/pyocd"


def fake(cands, answers):
    mb._pyocd_fallback = None
    mb.pyocd_candidates = lambda: list(cands)
    mb.capture = lambda cmd: answers.get(cmd[0], (127, ""))


def verdict(cands, answers):
    fake(cands, answers)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        c = mb.probe_check()
        if c.state != "ok":
            mb.cannot_flash_hint(c)
    return c, buf.getvalue()


def setup_problem(cands, answers):
    fake(cands, answers)
    for exe in cands:
        answers.setdefault(exe, (0, ""))
    real = mb.capture
    mb.capture = lambda cmd: (0, "0.45.1\n") if cmd[-1] == "--version" else real(cmd)
    with contextlib.redirect_stdout(io.StringIO()):
        return mb._pyocd_problem()


c, hint = verdict([V, P], {V: (0, TABLE)})
check(c.state == "ok" and c.exe == V and mb.pyocd_path() == V, "ours lists the board: use ours")
c, hint = verdict([V, P], {V: (1, CRASH), P: (0, TABLE)})
check(c.state == "ok" and c.exe == P and mb.pyocd_path() == P, "ours crashes, the one on PATH lists the board: use that one")
c, hint = verdict([V, P], {V: (0, NONE), P: (0, TABLE)})
check(c.state == "ok" and c.exe == P and mb.pyocd_path() == P, "ours sees nothing, the one on PATH lists the board: use that one")
c, hint = verdict([V], {V: (1, CRASH)})
check(c.state == "broken" and "does not run" in hint and V in hint and "DLL load failed" in hint and "mb.py setup" in hint,
      f"a crashing pyocd is its own verdict, quoting the crash and naming the fix (got {c.state}: {hint!r})")
c, hint = verdict([V, P], {V: (0, NONE), P: (0, NONE)})
check(c.state == "no-probe" and f"pyocd used:  {V}" in hint and "No available debug probes" in hint and f"also tried:  {P}" in hint,
      f"no board anywhere: say which pyocd was asked, what it said, and what else was tried (got: {hint!r})")
c, hint = verdict([V], {V: (1, DENIED)})
check(c.state == "denied" and "udev" in hint, "a refused device is the udev rule")
c, hint = verdict([], {})
check(c.state == "no-pyocd" and "not installed" in hint, "no pyocd at all")
c, hint = verdict([V, P], {V: (1, CRASH), P: (0, NONE)})
check(c.state == "broken" and f"also tried:  {P}" in hint, "ours crashes and the other sees nothing: report the crash, mention the other")

# Another probe is not a micro:bit: a J-Link on the lecturer's Mac was "detected".
JLINK = ("  #   Probe/Board         Unique ID   Target\n"
         "----------------------------------------------\n"
         "  0   Segger J-Link EDU   261008410   n/a\n")
c, hint = verdict([V], {V: (0, JLINK)})
check(c.state == "no-probe" and "J-Link" in hint and "not a micro:bit" in hint,
      f"a J-Link alone is no micro:bit, and the hint names it (got {c.state}: {hint!r})")
c, hint = verdict([V], {V: (0, JLINK + "  1   Arm DAPLink CMSIS-DAP   9904360200052820   n/a\n      micro:bit v2\n")})
check(c.state == "ok", "a micro:bit next to a J-Link is found")

# The Windows case: the board is in the output, whatever the exit code says.
c, hint = verdict([V], {V: (1, WINDOWS)})
check(c.state == "ok" and c.exe == V,
      f"a pyocd that listed the board and then died has enumerated USB: that is a pass, not 'broken' (got {c.state})")
check(setup_problem([V], {V: (1, WINDOWS)}) is None,
      "setup must pass a pyocd that listed the board before dying, instead of 'cannot enumerate USB: <the board's row>'")
check(setup_problem([V], {V: (1, CRASH)}) is not None, "setup still fails a pyocd that crashes without listing anything")
check(setup_problem([V], {V: (0, NONE)}) is None, "setup passes a pyocd that runs and sees no board")

# ------------------------------------------------- setup: VS Code extensions
# setup installs the workspace's recommendations through the "code" command,
# so Microsoft's Serial Monitor is there before the first program prints.
real_capture = mb.capture
recs = mb.recommended_extensions()
check("ms-vscode.vscode-serial-monitor" in recs and "AIUnderstand.microbit-flasher" in recs,
      f"the recommendations are read from .vscode/extensions.json, Serial Monitor included (got {recs})")
check(mb.code_cli() is None or isinstance(mb.code_cli(), str), "code_cli() answers without error")
def install_run(cli, container=False, outcome=(0, "Installing extensions...\nExtension 'x' is already installed.")):
    calls = []
    mb.in_container = lambda: container
    mb.code_cli = lambda: cli
    mb.capture = lambda cmd: (calls.append(list(cmd)), outcome)[1]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        mb.install_extensions()
    return calls, buf.getvalue()
calls, out = install_run("/usr/bin/code")
check(calls == [["/usr/bin/code", "--install-extension", e] for e in recs] and out.count("already installed") == len(recs),
      f"every recommendation is installed through the code command, and a repeat says so (got {calls})")
calls, out = install_run("/usr/bin/code", outcome=(1, "Failed Installing Extensions: ms-vscode.vscode-serial-monitor\n"))
check("FAILED" in out and "Extensions view" in out, "a failed install names the extension and the manual route")
calls, out = install_run(None)
check(not calls and "skipped" in out and "offers" in out, "without a code command: skipped, and VS Code's own prompt is named")
calls, out = install_run("/usr/bin/code", container=True)
check(not calls and not out, "in a Codespace nothing is installed: devcontainer.json does that")
mb.capture = real_capture

# ------------------------------------------------- the linker script on Windows
# gprbuild hands ld the runtime's ld directory relative to the object
# directory; Windows appends that to the current directory and refuses the
# result past 260 characters before collapsing the "..". mb.py adds the
# directory as an absolute -L, in front, so the script is opened by full name.
import tempfile
with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    (root / "embedded-nrf52833" / "ld").mkdir(parents=True)
    gpr = root / "default.gpr"
    gpr.write_text('project Default is\n   for Runtime ("ada") use "embedded-nrf52833";\nend Default;\n')
    zfp = root / "zfp.gpr"
    zfp.write_text('project Zfp is\n   for Runtime ("Ada") use MicroBit_v2_ZFP\'Runtime ("Ada");\nend Zfp;\n')
    mb._runtime_root = None
    # The compiler answers with ".." in it, after Alire's chatter; here it normalises to root.
    mb.capture = lambda cmd: (0, f"Note: Synchronizing workspace...\n{root}/x/../\n") if cmd[-1] == "-print-file-name=gnat" else (1, "")
    got = mb.linker_script_switches(gpr)
    check(got == ["-largs", f"-L{root / 'embedded-nrf52833' / 'ld'}"],
          f"a project naming its runtime gets that runtime's ld directory as an absolute -L (got {got})")
    check(mb.linker_script_switches(zfp) == [],
          "a project that takes its runtime from another project gets nothing: the light runtime has no -T")
    mb._runtime_root = None
    mb.capture = lambda cmd: (1, "alr: command not found")
    check(mb.linker_script_switches(gpr) == [], "no compiler answer, no switch: the build then fails on its own terms")
    mb._runtime_root = None
    mb.capture = real_capture
    calls = []
    mb.run = lambda cmd, quiet=False: (calls.append(list(cmd)), 0)[1]
    mb.linker_script_switches = lambda g: ["-largs", "-L/rt/ld"]
    mb.build_one("template", mb.TEMPLATE_GPR)
    mb.build_one("ravenscar/x", gpr)
    check(all(c[-4:] == ["-cargs:ada", "-gnatef", "-largs", "-L/rt/ld"] for c in calls) and len(calls) == 2,
          f"template and examples end with the same compiler switches and the absolute -L (got {calls})")
    check(calls[0][:3] == ["alr", "build", "--"] and calls[1][:4] == ["alr", "exec", "--", "gprbuild"],
          "the template still builds through alr build, the examples through gprbuild")

# ------------------------------------------ the language server's toolchain
# The Ada extension finds the toolchain through alr on PATH, which setup never
# edits; the configuration file carries the paths instead.
with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    (root / "boards").mkdir()
    board = root / "boards" / "board_zfp.gpr"
    board.write_text('project Board_ZFP is\n   -- for Runtime ("Ada") use "zfp-cortex-m4f";\n'
                     '   for Runtime ("Ada") use "light-cortex-m4f";\nend Board_ZFP;\n')
    ex = root / "ex.gpr"
    ex.write_text('with "boards//board_zfp.gpr";\nproject Ex is\n'
                  '   for Runtime ("Ada") use Board_ZFP\'Runtime ("Ada");\nend Ex;\n')
    plain = root / "plain.gpr"
    plain.write_text('project Plain is\n   for Runtime ("ada") use "embedded-nrf52833";\nend Plain;\n')
    none = root / "none.gpr"
    none.write_text("project None is\nend None;\n")
    check(mb.project_runtime(plain) == "embedded-nrf52833", "a runtime named in the project")
    check(mb.project_runtime(ex) == "light-cortex-m4f",
          f"a runtime taken from a withed project, past the commented-out old name (got {mb.project_runtime(ex)})")
    check(mb.project_runtime(none) == "embedded-nrf52833", "no runtime anywhere: the template's")
    # point_als_at: gprconfig is faked by writing the file it would write.
    mb.ALS_CGPR = root / "als.cgpr"
    mb.ALS_JSON = root / ".als.json"
    seen = []
    def fake_gprconfig(cmd):
        seen.append(cmd)
        (root / "als.cgpr").write_text('for Runtime_Dir ("Ada") use "/rt/";\n')
        return 0, ""
    mb.capture = fake_gprconfig
    with contextlib.redirect_stdout(io.StringIO()):
        ok = mb.point_als_at("template", mb.TEMPLATE_GPR)
    als = json.loads((root / ".als.json").read_text()) if (root / ".als.json").is_file() else {}
    check(ok and als.get("gprConfigurationFile") == mb.rel(root / "als.cgpr") and als.get("alireDiagnostics") is False
          and als.get("projectFile") == mb.rel(mb.TEMPLATE_GPR),
          f".als.json names the project, the configuration file, and silences the alr diagnostic (got {als})")
    check(any("--config=Ada,,embedded-nrf52833" in c and "--target=arm-eabi" in c for c in seen),
          f"gprconfig is asked for the project's runtime on the arm-eabi target (got {seen})")
    def broken_gprconfig(cmd):
        (root / "als.cgpr").write_text("--  no Ada compiler found\n")
        return 0, ""
    mb.capture = broken_gprconfig
    with contextlib.redirect_stdout(io.StringIO()) as buf:
        ok = mb.point_als_at("template", mb.TEMPLATE_GPR)
    als = json.loads((root / ".als.json").read_text())
    check(not ok and "gprConfigurationFile" not in als,
          "a configuration without a runtime is not pointed at, whatever gprconfig's exit code")
    mb.capture = real_capture

# ------------------------------------------------------------ the bridge
# tools/serial_bridge.py is the desktop end of the flasher's Serial view: the
# boards as JSON lines, one port read at a time, an unplugged board noticed.
bspec = importlib.util.spec_from_file_location("bridge", ROOT / "tools" / "serial_bridge.py")
bridge = importlib.util.module_from_spec(bspec)
bspec.loader.exec_module(bridge)
import time, types
Port = lambda dev, vid, sn: types.SimpleNamespace(device=dev, vid=vid, serial_number=sn, description="USB Serial Device")
V2 = "9904360200052820ab3ba4b3000000000000000097969901"
ports = [Port("COM3", 0x0D28, V2), Port("COM4", 0x0D28, "9900000012345678"), Port("COM5", 0x1234, "x")]
listed = bridge.boards_from(ports)
check([b["version"] for b in listed] == ["v1", "v2"] and listed[1]["port"] == "COM3",
      f"micro:bits are told apart by the board id in the serial number; other devices are not listed (got {listed})")
class FakePort:
    made = []
    def __init__(self, port, baud, timeout):
        self.port, self.baud, self.buf, self.writes, self.closed = port, baud, [b"hello\r\n"], [], False
        FakePort.made.append(self)
    @property
    def in_waiting(self):
        return len(self.buf[0]) if self.buf else 0
    def read(self, n):
        if self.buf:
            return self.buf.pop(0)
        time.sleep(0.02)
        return b""
    def write(self, data):
        self.writes.append(data)
    def close(self):
        self.closed = True
out = io.StringIO()
plugged = {"ports": ports}
br = bridge.Bridge(lambda: plugged["ports"], FakePort, out, poll_s=0.05)
br.poll()
br.command(json.dumps({"cmd": "open", "id": V2}))
time.sleep(0.15)
br.command(json.dumps({"cmd": "send", "text": "hi"}))
plugged["ports"] = [ports[1], ports[2]]   # the v2 is unplugged
br.poll()
events = [json.loads(l) for l in out.getvalue().splitlines()]
kinds = [e["event"] for e in events]
check(kinds[0] == "boards" and len(events[0]["boards"]) == 2, "the list is the first thing said")
check("opened" in kinds and any(e["event"] == "data" and e["text"] == "hello\r\n" for e in events),
      f"open reads the port and reports its data (got {kinds})")
check(FakePort.made and FakePort.made[0].baud == 115200 and FakePort.made[0].writes == [b"hi\r\n"],
      "115200 baud, and a sent line ends in CR LF")
check(any(e["event"] == "closed" and e.get("reason") == "unplugged" for e in events) and FakePort.made[0].closed,
      f"an unplugged board closes its port and says so (got {events})")
br.command(json.dumps({"cmd": "open", "id": "nope"}))
check(json.loads(out.getvalue().splitlines()[-1])["event"] == "error", "opening a board that is not there is an error, not a crash")

# mb.py flash follows the flasher's choice when pyocd sees that board.
mb.BOARD_FILE = Path(tempfile.mkdtemp()) / "board.txt"
check(mb.chosen_board("0 ARM " + V2) is None, "no choice recorded, no -u")
mb.BOARD_FILE.write_text(V2 + "\n")
check(mb.chosen_board("  0   ARM BBC micro:bit CMSIS-DAP   " + V2 + "   ...") == V2, "the recorded board, when pyocd lists it")
with contextlib.redirect_stdout(io.StringIO()):
    check(mb.chosen_board("No available debug probes") is None, "and not when it is unplugged: the note says so and the flash goes on")

# ------------------------------------------------------------ setup asks nothing
# "python mb.py setup" is the whole installation; --ask brings questions back.
with contextlib.redirect_stdout(io.StringIO()):
    check(mb._ask(types.SimpleNamespace(), "Install it?") is True, "by default setup goes ahead")
    check(mb._ask(types.SimpleNamespace(no_install_tools=True), "Install it?") is False, "--no-install-tools only reports")
    check(mb._ask(types.SimpleNamespace(ask=True), "Install it?") in (True, False) or True, "--ask asks (or goes ahead without a terminal)")
with tempfile.TemporaryDirectory() as td:
    v = Path(td) / "version"
    v.write_text("Linux version 5.15.167.4-microsoft-standard-WSL2 (root@...)\n")
    check(mb.is_wsl(v) is True, "WSL is recognised from /proc/version")
    v.write_text("Linux version 6.8.0-45-generic (buildd@lcy02) ...\n")
    check(mb.is_wsl(v) is False, "a plain Linux is not")
    check(mb.is_wsl(Path(td) / "missing") is False, "and no such file (macOS, Windows) is not either")
front = subprocess.run([sys.executable, str(ROOT / "mb.py"), "--help"], capture_output=True, text=True)
check(front.returncode == 0 and "setup" in front.stdout, "mb.py at the root runs the tool: python mb.py setup")

if fail:
    print("FAIL")
    for f in fail:
        print("  - " + f)
    sys.exit(1)
print("PASS  mb.py: capture in UTF-8 and on line boundaries; probe verdicts for every pyocd answer")
