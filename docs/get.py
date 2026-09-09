#!/usr/bin/env python3
"""Get the project onto this machine, from nothing.

    python3 get.py https://github.com/YOUR_NAME/YOUR_REPO.git

Everything before "mb.py setup" used to be manual: install git, remember
--recurse-submodules, remember core.longpaths on Windows, then find the setup
command. Students without git could not even start, and a repository cloned
without its submodules looks like a corrupt download rather than a missed flag.

Deliberately standalone -- it is fetched on its own, before the repository
exists, so it cannot import anything from it. It only clones and hands over:
every real decision stays in tools/mb.py.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

TEMPLATE = "https://github.com/aiunderstand/Ada-Embedded-Project-MicroBitV2.git"


def say(msg=""):
    print(msg, flush=True)


def run(cmd, **kw) -> int:
    say(f"  $ {' '.join(str(c) for c in cmd)}")
    try:
        return subprocess.call(cmd, **kw)
    except FileNotFoundError:
        return 127


def ask(question: str, default: str = "") -> str:
    if not sys.stdin.isatty():
        return default
    try:
        return input(question).strip() or default
    except (EOFError, KeyboardInterrupt):
        say()
        return default


def yes(question: str) -> bool:
    return ask(f"{question} [Y/n] ", "y").lower() in ("", "y", "yes")


def install_git() -> bool:
    """Ask, then use whatever this platform's package manager is."""
    say("git is not installed, and it is how the code and its drivers arrive.")
    if not yes("Install git now?"):
        return False
    if os.name == "nt" and shutil.which("winget"):
        return run(["winget", "install", "--id", "Git.Git", "-e",
                    "--source", "winget", "--scope", "user",
                    "--accept-package-agreements",
                    "--accept-source-agreements"]) == 0
    if sys.platform == "darwin":
        # Apple ships git inside the Command Line Tools; this opens a dialog.
        run(["xcode-select", "--install"])
        say("\nAccept the dialog that appeared, wait for it to finish, then run")
        say("this script again.")
        return False
    for mgr, cmd in (("apt-get", ["sudo", "apt-get", "install", "-y", "git"]),
                     ("dnf", ["sudo", "dnf", "install", "-y", "git"]),
                     ("pacman", ["sudo", "pacman", "-S", "--noconfirm", "git"]),
                     ("zypper", ["sudo", "zypper", "install", "-y", "git"])):
        if shutil.which(mgr):
            say("  sudo will ask for your password")
            return run(cmd) == 0
    return False


def reachable(url: str) -> tuple[bool, str]:
    """Can git read this repository with what it has right now?

    GIT_TERMINAL_PROMPT=0 stops git asking for a username in the terminal, so
    a private repository fails at once instead of stalling on a prompt. A
    credential helper with its own window (Git for Windows ships one) still
    gets to open it, which is exactly the "sign in through the browser" we want.
    """
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    p = subprocess.run(["git", "ls-remote", "--exit-code", url, "HEAD"],
                       env=env, stdin=subprocess.DEVNULL,
                       capture_output=True, text=True)
    return p.returncode == 0, p.stderr.strip()


def sign_in(url: str) -> bool:
    """A repository git may not read: get it a credential the easy way, or
    explain the manual one. Returns whether the repository is readable now."""
    say("\nGitHub would not let this machine read that repository. Either it is")
    say("private, which is fine, or the address has a typo.")
    if shutil.which("gh"):
        say("\nThe GitHub command-line tool is installed; it can sign you in")
        say("through your browser and teach git to use that.")
        if yes("Sign in now?"):
            if subprocess.call(["gh", "auth", "status", "-h", "github.com"],
                               stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL) != 0:
                run(["gh", "auth", "login", "--web", "--git-protocol", "https",
                     "-h", "github.com"])
            run(["gh", "auth", "setup-git", "-h", "github.com"])
            ok, _ = reachable(url)
            if ok:
                return True
            say("\nStill cannot read it. Check the address, and that the account")
            say("you signed in with can see the repository.")
        return False
    say("\nTwo ways to sign in. Either one, then run this script again:")
    say("  1. Install the GitHub command-line tool and let this script use it:")
    if os.name == "nt":
        say("       winget install --id GitHub.cli")
    elif sys.platform == "darwin":
        say("       brew install gh")
    else:
        say("       sudo apt install gh        (or your distribution's package)")
    say("  2. Or, when git asks for a password below, paste a token instead --")
    say("     GitHub does not accept account passwords. Make one at")
    say("     https://github.com/settings/tokens  (classic, tick 'repo').")
    if os.name == "nt":
        say("\nOn Windows, git normally opens a sign-in window by itself; if one")
        say("appeared just now, sign in there and this script will carry on.")
    return False


def folder_for(url: str) -> Path:
    name = url.rstrip("/").split("/")[-1]
    if name.endswith(".git"):
        name = name[:-4]
    return Path.cwd() / (name or "Ada-Embedded-Project-MicroBitV2")


def main() -> int:
    v = sys.version_info
    if (v.major, v.minor) < (3, 9):
        say(f"Python 3.9+ is required; this is {v.major}.{v.minor}.")
        return 1

    say("micro:bit Ada project -- getting you set up\n")

    url = sys.argv[1] if len(sys.argv) > 1 else ""
    if not url:
        say("Paste the address of YOUR repository, the one you made with")
        say("'Use this template'. It looks like")
        say("  https://github.com/YOUR_NAME/YOUR_REPO")
        say("Leave it empty to take a read-only copy of the template instead.\n")
        url = ask("Repository: ", TEMPLATE)
    if not url.startswith(("http://", "https://", "git@", "file://")):
        say(f"'{url}' does not look like a repository address.")
        return 1

    if not shutil.which("git") and not install_git():
        say("\nWithout git this script cannot continue. Install it from")
        say("https://git-scm.com/downloads and run this again.")
        return 1
    if not shutil.which("git"):
        say("\ngit was installed but is not visible yet. Close this window,")
        say("open a new one, and run this script again.")
        return 1

    if os.name == "nt":
        # The drivers carry a bundled Unity project with 171-character paths.
        # Without this the clone truncates and looks like a corrupt download.
        run(["git", "config", "--global", "core.longpaths", "true"])

    dest = folder_for(url)
    if dest.exists() and any(dest.iterdir()):
        say(f"\n{dest} already exists.")
        if not (dest / ".git").is_dir():
            say("It is not a clone, so I will not touch it. Move it aside and "
                "try again.")
            return 1
        say("Using it as it is, and making sure the drivers are there.")
        run(["git", "submodule", "update", "--init", "--recursive"], cwd=dest)
    else:
        ok, why = reachable(url)
        # GitHub answers "not found" for a private repository when a stored
        # credential does not cover it, and asks for a username when there is
        # no credential at all. Both mean "sign in"; only a network error does
        # not.
        auth = any(k in why.lower() for k in
                   ("could not read username", "authentication failed",
                    "not found", "permission denied"))
        if not ok and auth:
            if not sign_in(url):
                # Clone anyway: a pasted token, or a helper's window, may
                # still get through. The prompt is git's own.
                say("\nTrying the clone; git will ask if it needs to.")
        elif not ok:
            say(f"\ngit cannot reach that repository:\n  {why}")
            return 1
        say(f"\nCloning into {dest}")
        # --recurse-submodules is the whole point: the drivers live in a
        # submodule, and a clone without them builds nothing.
        if run(["git", "clone", "--recurse-submodules", url, str(dest)]) != 0:
            say("\nThe clone failed. If it asked for a password: GitHub wants a")
            say("token, not your account password (see above). If it said")
            say("'Filename too long', run 'git config --global core.longpaths true'")
            say("and try again.")
            return 1

    setup = dest / "tools" / "mb.py"
    if not setup.is_file():
        say(f"\nCloned, but {setup} is missing. Is that the right repository?")
        return 1

    say("\nNow installing the compiler and tools. This is the long part.\n")
    rc = run([sys.executable, str(setup), "setup"], cwd=dest)

    say()
    if rc == 0:
        say("Done. Open the folder in VS Code and press Ctrl+Shift+B:")
        say(f"  cd {dest}")
        say("  code .")
        if shutil.which("code") and yes("\nOpen VS Code there now?"):
            run(["code", str(dest)])
    else:
        say("Setup reported a problem above. Fix it, then run:")
        say(f"  cd {dest}")
        say(f"  {Path(sys.executable).name} tools/mb.py setup")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
