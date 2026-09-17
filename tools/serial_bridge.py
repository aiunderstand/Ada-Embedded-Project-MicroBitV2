#!/usr/bin/env python3
"""The desktop's micro:bits and their serial output, as JSON lines.

Run by "python3 tools/mb.py boards", under the Python that has pyserial (the
venv setup made, normally), for the micro:bit companion extension: it has no
USB of its own, and the flasher's Serial view runs in a host that has none
either. Standalone on purpose, like get.py: it must not import mb.py, whose
Python may lack pyserial.

    --list    the boards now, one JSON object, and exit
    --watch   keep going: a "boards" event whenever the list changes (the
              ports are polled once a second, which is how an unplugged board
              is noticed), and commands on stdin, one JSON object per line:
                {"cmd": "open", "id": "<unique id>"}   read that board's port
                {"cmd": "close"}                        stop reading
                {"cmd": "send", "text": "..."}          a line to the board
              answered by events "opened", "closed" (with a reason when the
              board went away) and "data".

A board is DAPLink's USB serial port, vendor 0x0d28. Its unique id is the
USB serial number, whose first four digits are the board id: 9900 and 9901
are a micro:bit v1, 9903 to 9906 a v2. The same string is what pyocd calls
the probe's unique id, so the flasher's choice serves the flash as well.
"""
import argparse
import json
import sys
import threading
import time

MICROBIT_VID = 0x0D28
BAUD = 115200
V1_IDS = ("9900", "9901")
V2_IDS = ("9903", "9904", "9905", "9906")


def board_version(serial_number):
    prefix = (serial_number or "")[:4]
    if prefix in V2_IDS:
        return "v2"
    if prefix in V1_IDS:
        return "v1"
    return None


def boards_from(ports):
    """The micro:bits among pyserial's ports, as the companion expects them."""
    found = []
    for p in ports:
        if getattr(p, "vid", None) != MICROBIT_VID:
            continue
        sn = getattr(p, "serial_number", None) or ""
        found.append({
            "id": sn or p.device,
            "port": p.device,
            "version": board_version(sn),
            "description": getattr(p, "description", "") or "",
        })
    return sorted(found, key=lambda b: b["id"])


def emit(out, event, **fields):
    out.write(json.dumps({"event": event, **fields}) + "\n")
    out.flush()


class Bridge:
    """One open port at a time; reads it on a thread; answers commands."""

    def __init__(self, list_ports, serial_cls, out, poll_s=1.0):
        self.list_ports = list_ports
        self.serial_cls = serial_cls
        self.out = out
        self.poll_s = poll_s
        self.boards = None
        self.port = None       # the open serial.Serial
        self.port_id = None
        self.lock = threading.Lock()

    def poll(self):
        """Emit the list when it changed; drop the open port if its board went."""
        now = boards_from(self.list_ports())
        if now != self.boards:
            self.boards = now
            emit(self.out, "boards", boards=now)
        if self.port_id and not any(b["id"] == self.port_id for b in now):
            self.close("unplugged")

    def open(self, board_id):
        board = next((b for b in (self.boards or []) if b["id"] == board_id), None)
        if not board:
            emit(self.out, "error", message=f"no board with id {board_id}")
            return
        self.close()
        try:
            port = self.serial_cls(board["port"], BAUD, timeout=0.2)
        except Exception as err:  # noqa: BLE001 -- pyserial's own exception types vary
            text = str(err)
            busy = any(w in text for w in ("PermissionError", "Access is denied", "Resource busy",
                                           "Device or resource busy"))
            emit(self.out, "error", id=board_id,
                 message=("another program holds the port (a serial terminal, or a second "
                          "monitor); only one can" if busy else text))
            return
        with self.lock:
            self.port, self.port_id = port, board_id
        emit(self.out, "opened", id=board_id, port=board["port"])
        threading.Thread(target=self.read_loop, args=(port, board_id), daemon=True).start()

    def close(self, reason=None):
        with self.lock:
            port, board_id = self.port, self.port_id
            self.port, self.port_id = None, None
        if port is None:
            return
        try:
            port.close()
        except Exception:  # noqa: BLE001
            pass
        emit(self.out, "closed", id=board_id, **({"reason": reason} if reason else {}))

    def send(self, text):
        with self.lock:
            port = self.port
        if port is None:
            emit(self.out, "error", message="not reading any board, nothing sent")
            return
        try:
            port.write((text.rstrip("\r\n") + "\r\n").encode("utf-8", "replace"))
        except Exception as err:  # noqa: BLE001
            emit(self.out, "error", message=f"send failed: {err}")

    def read_loop(self, port, board_id):
        while True:
            with self.lock:
                if self.port is not port:
                    return
            try:
                data = port.read(port.in_waiting or 1)
            except Exception as err:  # noqa: BLE001
                with self.lock:
                    still = self.port is port
                if still:
                    self.close(f"read failed: {err}")
                return
            if data:
                emit(self.out, "data", id=board_id, text=data.decode("utf-8", "replace"))

    def command(self, line):
        try:
            cmd = json.loads(line)
        except ValueError:
            emit(self.out, "error", message=f"not a command: {line.strip()[:80]}")
            return
        what = cmd.get("cmd")
        if what == "open":
            self.open(str(cmd.get("id", "")))
        elif what == "close":
            self.close()
        elif what == "send":
            self.send(str(cmd.get("text", "")))
        else:
            emit(self.out, "error", message=f"unknown command: {what}")


def watch(bridge, stdin):
    """Poll on this thread; commands arrive on another. Ends when stdin does."""
    done = threading.Event()

    def commands():
        for line in stdin:
            if line.strip():
                bridge.command(line)
        done.set()

    threading.Thread(target=commands, daemon=True).start()
    while not done.is_set():
        bridge.poll()
        done.wait(bridge.poll_s)
    bridge.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", action="store_true", help="the boards now, as JSON, then exit")
    ap.add_argument("--watch", action="store_true", help="keep reporting, and take commands on stdin")
    args = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    try:
        import serial
        from serial.tools import list_ports
    except ImportError:
        emit(sys.stdout, "error", message="pyserial is not installed for this Python. Run:  python3 tools/mb.py setup")
        return 1
    if args.watch:
        watch(Bridge(list_ports.comports, serial.Serial, sys.stdout), sys.stdin)
        return 0
    emit(sys.stdout, "boards", boards=boards_from(list_ports.comports()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
