#!/usr/bin/env python3
"""python mb.py setup -- the one command, at the root, on every platform.

Everything lives in tools/mb.py; this is the front door, so that a student
never has to know where the tool is. Windows: python; macOS and Linux:
python3.
"""
import pathlib
import runpy
import sys

sys.argv[0] = str(pathlib.Path(__file__).resolve().parent / "tools" / "mb.py")
runpy.run_path(sys.argv[0], run_name="__main__")
