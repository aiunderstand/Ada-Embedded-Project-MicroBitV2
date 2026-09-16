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
import sys
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

# The Windows case: the board is in the output, whatever the exit code says.
c, hint = verdict([V], {V: (1, WINDOWS)})
check(c.state == "ok" and c.exe == V,
      f"a pyocd that listed the board and then died has enumerated USB: that is a pass, not 'broken' (got {c.state})")
check(setup_problem([V], {V: (1, WINDOWS)}) is None,
      "setup must pass a pyocd that listed the board before dying, instead of 'cannot enumerate USB: <the board's row>'")
check(setup_problem([V], {V: (1, CRASH)}) is not None, "setup still fails a pyocd that crashes without listing anything")
check(setup_problem([V], {V: (0, NONE)}) is None, "setup passes a pyocd that runs and sees no board")

if fail:
    print("FAIL")
    for f in fail:
        print("  - " + f)
    sys.exit(1)
print("PASS  mb.py: capture in UTF-8 and on line boundaries; probe verdicts for every pyocd answer")
