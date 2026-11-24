#!/usr/bin/env python3
"""Runs OpenCode with a local model on behalf of the office.

The container has no internet access and no credentials; it only accepts a model, a folder and a task.

After the model finishes, the server checks the result itself (the model cannot influence this):
- it compares the project files before and after the task,
- if the project folder contains a .verify file, it runs the command stored there (e.g. python3 -m pytest -q),
- a task that changed no files or failed verification exits with code 3, so the office shows an error instead of "done".
A task that is not meant to change anything (a question, a code review) is marked with [no changes] in its text.
Every task report is appended to $VERIFY_LOG.

GPU queue: all offices mount the same /queue directory, so only one local model works at a time
and the others wait in arrival order (tickets in /queue/waiting, the current task in /queue/current.json).
"""
import datetime, fcntl, hashlib, json, os, re, signal, socket, socketserver, struct, subprocess, threading, time, urllib.request

MODELS = set(filter(None, os.environ.get("MODELS", "").split(",")))
ROOTS = tuple(p.rstrip("/") + "/" for p in os.environ.get(
    "ALLOWED_ROOTS", "/home/node/projects,/home/node/.open-office/worktrees").split(",") if p)
MAX = 16 << 20
SKIP = {".git", "__pycache__", "node_modules", ".pytest_cache", ".venv", ".mypy_cache"}
VERIFY_FILE = ".verify"
VERIFY_LOG = os.environ.get("VERIFY_LOG", "/home/node/verify.log")
VERIFY_TIMEOUT = 600
QUEUE = os.environ.get("QUEUE_DIR", "/queue")
GATE = os.environ.get("OLLAMA_GATE", "http://ollama-gate:8080")
HOST = socket.gethostname()


class Ticket:
    """A place in the GPU queue shared by all offices: ordered by arrival time, exclusive via flock."""

    def __init__(self, model, cwd):
        self.info = {"model": model, "folder": cwd, "office": os.environ.get("OFFICE_NAME", HOST),
                     "queued": datetime.datetime.now().isoformat(timespec="seconds")}
        self.name = f"{time.time_ns():020d}-{HOST}-{threading.get_ident()}.json"
        self.path = os.path.join(QUEUE, "waiting", self.name)
        self.lock = None

    def wait(self, cancelled, notify):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w") as f:
            json.dump(self.info, f, ensure_ascii=False)
        last = None
        while not cancelled.is_set():
            tickets = sorted(os.listdir(os.path.dirname(self.path)))
            ahead = tickets.index(self.name) if self.name in tickets else 0
            if ahead == 0:
                lock = open(os.path.join(QUEUE, "gpu.lock"), "a+")
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    self.lock = lock
                    with open(os.path.join(QUEUE, "current.json"), "w") as f:
                        json.dump({**self.info, "started": datetime.datetime.now().isoformat(timespec="seconds")}, f, ensure_ascii=False)
                    return True
                except OSError:
                    lock.close()
                    ahead = 1
            if ahead != last:
                notify(f"[GPU queue] waiting, tasks ahead: {ahead}\n".encode())
                last = ahead
            time.sleep(2)
        return False

    def unload_models(self):
        """Unload this office's models unless the next ticket comes from the same office.

        Separate Ollama instances do not know about each other; without this the next one would fall back to CPU."""
        try:
            following = [n for n in sorted(os.listdir(os.path.join(QUEUE, "waiting"))) if n != self.name]
            if following:
                with open(os.path.join(QUEUE, "waiting", following[0])) as f:
                    if json.load(f).get("office") == self.info["office"]:
                        return
            loaded = json.load(urllib.request.urlopen(f"{GATE}/api/ps", timeout=10)).get("models", [])
            for m in loaded:
                body = json.dumps({"model": m["name"], "keep_alive": 0}).encode()
                urllib.request.urlopen(urllib.request.Request(f"{GATE}/api/generate", body, {"Content-Type": "application/json"}), timeout=60).read()
                print(f"[GPU queue] unloaded: {m['name']}", flush=True)
        except (OSError, ValueError) as e:
            print(f"[GPU queue] could not unload models: {e}", flush=True)

    def release(self):
        try:
            os.unlink(self.path)
        except OSError:
            pass
        if self.lock:
            self.unload_models()
            try:
                os.unlink(os.path.join(QUEUE, "current.json"))
            except OSError:
                pass
            self.lock.close()
            self.lock = None


def clean_queue():
    """Tickets left by this container's previous run are no longer waiting."""
    try:
        for n in os.listdir(os.path.join(QUEUE, "waiting")):
            if f"-{HOST}-" in n:
                os.unlink(os.path.join(QUEUE, "waiting", n))
    except OSError:
        pass


def snapshot(root):
    """Hash of every project file (without .git and tool directories)."""
    state = {}
    for d, subdirs, files in os.walk(root):
        subdirs[:] = [s for s in subdirs if s not in SKIP]
        for n in files:
            p = os.path.join(d, n)
            try:
                if os.path.islink(p):
                    state[os.path.relpath(p, root)] = "link:" + os.readlink(p)
                    continue
                h = hashlib.sha256()
                with open(p, "rb") as f:
                    for chunk in iter(lambda: f.read(1 << 20), b""):
                        h.update(chunk)
                state[os.path.relpath(p, root)] = h.hexdigest()
            except OSError:
                pass
    return state


def diff(before, after):
    return (sorted(set(after) - set(before)), sorted(p for p in before if p in after and before[p] != after[p]), sorted(set(before) - set(after)))


CONVERSATION_ROLE = re.compile(
    r"^(\[Context reminder\] )?You are [^,(\n]{1,40}(, the Team Lead|, the team's Creative Director|, refining the project vision|, presenting completed work|, discussing the completed project)"
    r"|^(\[Context reminder\] )?(Your name is|You are) [^\n]{0,80}Review")


def is_conversation(task):
    """The team lead and the reviewer are not expected to change files."""
    return bool(CONVERSATION_ROLE.search(task[:400]))


def verify(cwd, model, task, code, before, command):
    added, changed, removed = diff(before, snapshot(cwd))
    report = {"time": datetime.datetime.now().isoformat(timespec="seconds"), "model": model, "folder": cwd, "model_exit": code,
              "added": added, "changed": changed, "removed": removed}
    notes, result = [], 0
    if code != 0:
        notes.append(f"model exited with code {code}")
        result = code
    elif VERIFY_FILE in added + changed + removed:
        notes.append(f"model touched {VERIFY_FILE}, verification is void")
        result = 3
    elif command:
        try:
            r = subprocess.run(["sh", "-c", command], cwd=cwd, stdin=subprocess.DEVNULL, capture_output=True, timeout=VERIFY_TIMEOUT,
                               start_new_session=True, env={**os.environ, "PWD": cwd})
            report["command"], report["command_exit"] = command, r.returncode
            report["command_output"] = (r.stdout + r.stderr).decode("utf-8", "replace")[-1500:]
            if r.returncode != 0:
                notes.append(f"verification command `{command}` exited with code {r.returncode}")
                result = 3
        except subprocess.TimeoutExpired:
            notes.append(f"verification command exceeded {VERIFY_TIMEOUT} s")
            result = 3
        tests = [p for p in added + changed + removed if os.path.basename(p).startswith("test") or "/tests/" in "/" + p]
        if tests and result == 0:
            notes.append("note: the model changed test files: " + ", ".join(tests[:10]))
    if code == 0 and not (added or changed or removed) and "[no changes]" not in task and not is_conversation(task):
        notes.append("the model reported done but changed no files")
        result = result or 3
    report["notes"], report["result"] = notes, "OK" if result == 0 else "FAILED"
    try:
        with open(VERIFY_LOG, "a") as f:
            f.write(json.dumps(report, ensure_ascii=False) + "\n")
    except OSError:
        pass
    summary = (f"\n[verify] {report['result']}: added {len(added)}, changed {len(changed)}, removed {len(removed)}"
               + (f", command exit {report['command_exit']}" if "command_exit" in report else "")
               + ("; " + "; ".join(notes) if notes else "") + "\n")
    if "command_output" in report and result:
        summary += report["command_output"][-600:] + "\n"
    return result, summary.encode()


class Job(socketserver.StreamRequestHandler):
    def frame(self, kind, data, lock):
        with lock:
            self.wfile.write(kind + struct.pack(">I", len(data)) + data)
            self.wfile.flush()

    def pump(self, stream, kind, lock):
        try:
            for data in iter(lambda: stream.read1(65536), b""):
                self.frame(kind, data, lock)
        except OSError:
            pass

    def handle(self):
        lock = threading.Lock()
        try:
            req = json.loads(self.rfile.readline(MAX))
            model, task, cwd = str(req["model"]), str(req["task"]), os.path.realpath(str(req["cwd"]))
            if model not in MODELS:
                raise ValueError(f"model not allowed: {model}")
            if not (cwd + "/").startswith(ROOTS):
                raise ValueError(f"folder outside the allowed roots: {cwd}")
        except (ValueError, KeyError, TypeError, OSError) as e:
            self.frame(b"e", f"local-agent: {e}\n".encode(), lock)
            self.frame(b"x", b"\x01", lock)
            return

        cancelled, procs = threading.Event(), []

        def watch():
            try:
                while self.connection.recv(4096):
                    pass
            except OSError:
                pass
            cancelled.set()
            for p in procs:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except OSError:
                    pass

        threading.Thread(target=watch, daemon=True).start()
        ticket = Ticket(model, cwd)
        try:
            if not ticket.wait(cancelled, lambda d: self.frame(b"e", d, lock)):
                return
            before = snapshot(cwd)
            try:
                with open(os.path.join(cwd, VERIFY_FILE)) as f:
                    command = f.read().strip()
            except OSError:
                command = ""
            try:
                p = subprocess.Popen(["opencode", "run", "--model", f"ollama/{model}", task, "--format", "json"], cwd=cwd,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, env={**os.environ, "PWD": cwd})
            except OSError as e:
                self.frame(b"e", f"local-agent: {e}\n".encode(), lock)
                self.frame(b"x", b"\x01", lock)
                return
            procs.append(p)
            if cancelled.is_set():
                os.killpg(p.pid, signal.SIGKILL)
            threads = [threading.Thread(target=self.pump, args=a) for a in ((p.stdout, b"o", lock), (p.stderr, b"e", lock))]
            for t in threads:
                t.start()
            code = p.wait()
            for t in threads:
                t.join()
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except OSError:
                pass
        except OSError:
            return
        finally:
            ticket.release()
        if cancelled.is_set():
            return
        result, summary = verify(cwd, model, task, code, before, command)
        try:
            self.frame(b"e", summary, lock)
            self.frame(b"x", bytes([result & 255]), lock)
        except OSError:
            pass


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


clean_queue()
Server(("0.0.0.0", 8090), Job).serve_forever()
