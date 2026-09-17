"""Drive the Ada Language Server headless: does Go to Definition work with a
given PATH and settings? Prints diagnostics, alire messages and the definition."""
import json, os, subprocess, sys, time, threading, queue
import glob
# The server binary the Ada extension installed, whatever the version and platform folder.
ALS = sorted(glob.glob(os.path.expanduser("~/.vscode/extensions/adacore.ada-*/*/*/ada_language_server*")))[-1]
ROOT = os.getcwd()
settings = json.loads(sys.argv[1])          # e.g. {"projectFile": "Code/itrs.gpr", "gprConfigurationFile": "build/als.cgpr"}
path = sys.argv[2]                          # the PATH to run with
env = {**os.environ, "PATH": path}
env.pop("ALIRE", None)
p = subprocess.Popen([ALS], cwd=ROOT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
q = queue.Queue()
def reader():
    while True:
        line = p.stdout.readline()
        if not line: return
        if line.lower().startswith(b"content-length:"):
            n = int(line.split(b":")[1]); p.stdout.readline()
            q.put(json.loads(p.stdout.read(n)))
threading.Thread(target=reader, daemon=True).start()
def send(msg):
    body = json.dumps(msg).encode(); p.stdin.write(b"Content-Length: %d\r\n\r\n" % len(body) + body); p.stdin.flush()
root_uri = "file://" + ROOT
send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"processId": os.getpid(), "rootUri": root_uri,
      "workspaceFolders": [{"uri": root_uri, "name": "repo"}], "capabilities": {"workspace": {"configuration": True}},
      "initializationOptions": {"ada": settings}}})
send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
send({"jsonrpc": "2.0", "method": "workspace/didChangeConfiguration", "params": {"settings": {"ada": settings}}})
main = ROOT + "/Code/src/main.adb"
send({"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": {"textDocument": {"uri": "file://" + main, "languageId": "ada", "version": 1, "text": open(main).read()}}})
diags, alire, logs, definition = [], [], [], None
deadline = time.time() + 25; asked = False
while time.time() < deadline:
    try: m = q.get(timeout=0.5)
    except queue.Empty:
        if not asked and time.time() > deadline - 12:
            asked = True
            send({"jsonrpc": "2.0", "id": 2, "method": "textDocument/definition", "params": {"textDocument": {"uri": "file://" + main}, "position": {"line": 0, "character": 8}}})
        continue
    if m.get("method") == "workspace/configuration":
        send({"jsonrpc": "2.0", "id": m["id"], "result": [settings for _ in m["params"]["items"]]})
    elif m.get("method") == "textDocument/publishDiagnostics":
        for d in m["params"]["diagnostics"]:
            diags.append((os.path.basename(m["params"]["uri"]), d["message"][:160].replace("\n", " ")))
    elif m.get("method") in ("window/logMessage", "window/showMessage"):
        logs.append(m["params"]["message"][:160].replace("\n", " "))
    elif m.get("id") == 2:
        definition = m.get("result") or m.get("error")
    elif m.get("method") == "$/progress":
        pass
print("settings:", settings); print("PATH has alr:", any(os.path.exists(os.path.join(d, "alr")) for d in path.split(":")))
for d in dict.fromkeys(diags): print("  diag:", d)
for l in dict.fromkeys(logs): print("  log :", l)
print("  definition:", json.dumps(definition)[:300] if definition is not None else "NO ANSWER")
p.kill()
