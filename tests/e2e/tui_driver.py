"""Drives the Bobi terminal UI in a pseudo terminal (no display needed).

Usage: python3 -I tui_driver.py <cwd> <step>... where a step is
  wait:<text>   wait until <text> appears on screen (timeout 30 s)
  type:<text>   type text
  key:<name>    press enter|esc|tab|shift-tab|left|right|up|down
  dump          print the visible text
The command to run comes from BOBI_TUI_CMD (JSON array). Exit code 0 when all steps succeed.
"""
import json, os, pty, re, select, sys, time

KEYS = {"enter": b"\r", "esc": b"\x1b", "tab": b"\t", "shift-tab": b"\x1b[Z", "left": b"\x1b[D", "right": b"\x1b[C", "up": b"\x1b[A", "down": b"\x1b[B"}
ANSI = re.compile(rb"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78]")

def main():
    cwd, steps = sys.argv[1], sys.argv[2:]
    cmd = json.loads(os.environ["BOBI_TUI_CMD"])
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.environ["PWD"] = cwd
        os.environ.setdefault("TERM", "xterm-256color")
        os.execvp(cmd[0], cmd)
    # 120x40 terminal
    import fcntl, struct, termios
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    raw = bytearray()

    def pump(seconds):
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    return False
                if not chunk:
                    return False
                raw.extend(chunk)
        return True

    def text():
        return ANSI.sub(b"", bytes(raw)).decode("utf-8", "replace")

    ok = True
    try:
        pump(1)
        for step in steps:
            kind, _, arg = step.partition(":")
            if kind == "wait":
                deadline = time.time() + 30
                start = len(raw)
                while arg not in ANSI.sub(b"", bytes(raw[start - 2000 if start > 2000 else 0:])).decode("utf-8", "replace"):
                    if time.time() > deadline or not pump(0.2):
                        print(f"TIMEOUT waiting for {arg!r}", file=sys.stderr)
                        print(text()[-3000:], file=sys.stderr)
                        ok = False
                        break
                if not ok:
                    break
            elif kind == "type":
                for ch in arg:
                    os.write(fd, ch.encode())
                    pump(0.02)
            elif kind == "key":
                os.write(fd, KEYS[arg])
                pump(0.3)
            elif kind == "sleep":
                pump(float(arg))
            elif kind == "dump":
                pump(0.5)
                print(text()[-4000:])
    finally:
        try:
            os.kill(pid, 15)
        except ProcessLookupError:
            pass
        pump(2)
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass
    sys.exit(0 if ok else 1)

main()
