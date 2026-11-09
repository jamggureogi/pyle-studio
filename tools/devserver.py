"""Local test server for the studio.

Serves the studio files and fakes the repository API against a local folder,
so the studio can be tested without a GitHub token.

    python3 tools/devserver.py /path/to/pyle_claude-copy [port]
    open http://localhost:8765/?local
"""
import base64, hashlib, json, os, subprocess, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

STUDIO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else None
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765


def sha(data):
    return hashlib.sha1(data).hexdigest()


def safe(path):
    full = os.path.abspath(os.path.join(REPO, path))
    if not full.startswith(REPO + os.sep):
        raise ValueError("bad path")
    return full


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STUDIO, **kw)

    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if not u.path.startswith("/__repo"):
            return super().do_GET()
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        route = u.path[len("/__repo"):]
        if route == "/ping":
            return self.send_json({"ok": True})
        if route == "/file":
            p = safe(q["path"])
            if not os.path.isfile(p):
                return self.send_json({}, 404)
            data = open(p, "rb").read()
            return self.send_json({"text": data.decode("utf-8"), "sha": sha(data)})
        if route == "/raw":
            p = safe(q["path"])
            if not os.path.isfile(p):
                return self.send_json({}, 404)
            data = open(p, "rb").read()
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if route == "/list":
            p = safe(q["path"])
            if not os.path.isdir(p):
                return self.send_json([])
            items = []
            for n in sorted(os.listdir(p)):
                full = os.path.join(p, n)
                items.append({"name": n, "path": os.path.relpath(full, REPO), "type": "dir" if os.path.isdir(full) else "file",
                              "size": os.path.getsize(full)})
            return self.send_json(items)
        if route == "/commits":
            out = subprocess.run(["git", "-C", REPO, "log", f"-{q.get('n', 15)}", "--format=%H%x1f%an%x1f%aI%x1f%s"],
                                 capture_output=True, text=True).stdout
            commits = [dict(zip(["sha", "author", "date", "message"], l.split("\x1f"))) for l in out.strip().split("\n") if l]
            return self.send_json(commits)
        self.send_json({}, 404)

    def do_PUT(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        p = safe(body["path"])
        cur = sha(open(p, "rb").read()) if os.path.isfile(p) else None
        if body.get("sha") != cur:
            return self.send_json({"error": "conflict"}, 409)
        data = base64.b64decode(body["b64"]) if "b64" in body else body["text"].encode()
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "wb").write(data)
        subprocess.run(["git", "-C", REPO, "add", body["path"]], capture_output=True)
        subprocess.run(["git", "-C", REPO, "commit", "-q", "-m", "[편집실] " + body.get("message", "")], capture_output=True)
        self.send_json({"sha": sha(data)})

    def do_DELETE(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        p = safe(body["path"])
        if os.path.isfile(p):
            os.remove(p)
        subprocess.run(["git", "-C", REPO, "commit", "-qam", "[편집실] " + body.get("message", "")], capture_output=True)
        self.send_json({"ok": True})


if __name__ == "__main__":
    if not REPO:
        sys.exit("usage: devserver.py <repo-folder> [port]")
    print(f"http://localhost:{PORT}/?local  (repo: {REPO})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
