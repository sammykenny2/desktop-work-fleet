"""Personal validation server. Python standard library only; see docs/api.md."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import ssl
import time
import tempfile
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

WEB = Path(__file__).resolve().parents[1] / "web"
STATUSES = {"todo", "in_progress", "done"}
ROLES = {"viewer", "editor", "admin"}


def compact(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def identifier():
    return str(uuid.uuid4())


class Fault(Exception):
    def __init__(self, status, error, **extra):
        self.status = status
        self.body = {"error": error, **extra}


def require(condition, status=400, error="invalid_request", **extra):
    if not condition:
        raise Fault(status, error, **extra)


def text_field(body, key, limit, default=None):
    value = body.get(key, default)
    require(isinstance(value, str) and 0 < len(value.strip()) <= limit)
    return value


def uuid_field(value):
    try:
        require(isinstance(value, str) and str(uuid.UUID(value)) == value)
    except (ValueError, AttributeError):
        raise Fault(400, "invalid_id") from None
    return value


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS notes(
                    id TEXT PRIMARY KEY, text TEXT NOT NULL, board TEXT NOT NULL,
                    status TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS devices(
                    id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
                    role TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS invites(
                    hash TEXT PRIMARY KEY, role TEXT NOT NULL, expires REAL NOT NULL, used INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS operations(
                    device TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, response TEXT NOT NULL,
                    PRIMARY KEY(device, id));
            """)
            db.execute("INSERT OR IGNORE INTO meta VALUES('epoch', ?)", (identifier(),))
            db.execute("INSERT OR IGNORE INTO meta VALUES('schema', '1')")
            if db.execute("SELECT value FROM meta WHERE key='schema'").fetchone()[0] != "1":
                raise RuntimeError("Unsupported database schema")
        os.chmod(self.path, 0o600)

    @contextlib.contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA synchronous=FULL")
        try:
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def epoch(db):
        return db.execute("SELECT value FROM meta WHERE key='epoch'").fetchone()[0]

    @staticmethod
    def note(row):
        return {**dict(row), "deleted": bool(row["deleted"])} if row else None

    @staticmethod
    def authenticate(db, token):
        device = db.execute("SELECT * FROM devices WHERE hash=? AND revoked=0", (digest(token),)).fetchone()
        require(device is not None, 401, "unauthorized")
        return device

    def bootstrap(self):
        """Recoverable local-owner bootstrap; never prints or exposes the token over HTTP."""
        token_file = self.path.with_suffix(".admin-token")
        if token_file.exists():
            return token_file
        with self.connect(write=True) as db:
            token = secrets.token_urlsafe(32)
            with token_file.open("x", encoding="utf-8") as file:
                os.chmod(token_file, 0o600)
                file.write(token)
                file.flush()
                os.fsync(file.fileno())
            db.execute("INSERT INTO devices VALUES(?,?,?,?,0)", (identifier(), digest(token), "Local owner", "admin"))
        return token_file

    def create_invite(self, role="editor", ttl=300):
        require(role in ROLES)
        with self.connect(write=True) as db:
            return self._invite(db, role, ttl)

    @staticmethod
    def _invite(db, role, ttl=300):
        code = secrets.token_urlsafe(24)
        expires = time.time() + ttl
        db.execute("INSERT INTO invites VALUES(?,?,?,0)", (digest(code), role, expires))
        return {"code": code, "expires": expires, "role": role}

    def dispatch(self, method, path, token, body, origin):
        require(isinstance(body, dict))
        with self.connect(write=method != "GET") as db:
            if method == "POST" and path == "/api/pair":
                code = text_field(body, "code", 128)
                name = text_field(body, "name", 80)
                invitation = db.execute("SELECT * FROM invites WHERE hash=?", (digest(code),)).fetchone()
                require(invitation is not None and not invitation["used"] and invitation["expires"] > time.time(), 403, "invalid_invite")
                new_token = secrets.token_urlsafe(32)
                device_id = identifier()
                db.execute("UPDATE invites SET used=1 WHERE hash=?", (digest(code),))
                db.execute("INSERT INTO devices VALUES(?,?,?,?,0)", (device_id, digest(new_token), name, invitation["role"]))
                return {"token": new_token, "device": device_id, "role": invitation["role"], "epoch": self.epoch(db)}
            device = self.authenticate(db, token)
            if method == "GET" and path == "/api/snapshot":
                return {"epoch": self.epoch(db), "role": device["role"], "device": device["id"],
                        "notes": [self.note(row) for row in db.execute("SELECT * FROM notes ORDER BY rowid")]}
            if path in {"/api/invites", "/api/devices", "/api/revoke"}:
                require(device["role"] == "admin", 403, "admin_required")
                if method == "POST" and path == "/api/invites":
                    role = body.get("role", "editor")
                    require(role in {"viewer", "editor"})
                    invitation = self._invite(db, role)
                    return {**invitation, "url": origin + "/#pair=" + invitation["code"]}
                if method == "GET" and path == "/api/devices":
                    return {"devices": [dict(r) for r in db.execute("SELECT id,name,role,revoked FROM devices")]}
                if method == "POST" and path == "/api/revoke":
                    target = uuid_field(body.get("device"))
                    require(target != device["id"], 400, "cannot_revoke_self")
                    require(db.execute("UPDATE devices SET revoked=1 WHERE id=?", (target,)).rowcount == 1, 404, "not_found")
                    return {"revoked": target}
            if method == "POST" and path == "/api/operations":
                require(device["role"] in {"editor", "admin"}, 403, "read_only")
                require(body.get("epoch") == self.epoch(db), 409, "epoch_changed", epoch=self.epoch(db))
                operation = uuid_field(body.get("operation"))
                fingerprint = digest(compact(body))
                prior = db.execute("SELECT * FROM operations WHERE device=? AND id=?", (device["id"], operation)).fetchone()
                if prior:
                    require(prior["hash"] == fingerprint, 409, "operation_reused")
                    return json.loads(prior["response"])
                note_id = uuid_field(body.get("id"))
                action = body.get("action")
                current = db.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
                if action == "create":
                    require(current is None, 409, "already_exists", current=self.note(current))
                    value = text_field(body, "text", 12000)
                    board = text_field(body, "board", 80, "Inbox")
                    status = body.get("status", "todo")
                    require(status in STATUSES)
                    db.execute("INSERT INTO notes VALUES(?,?,?,?,1,0)", (note_id, value, board, status))
                else:
                    require(action in {"update", "delete", "restore"})
                    require(current is not None, 404, "not_found")
                    revision = body.get("revision")
                    require(type(revision) is int and revision > 0)
                    require(revision == current["revision"], 409, "conflict", current=self.note(current))
                    require(not current["deleted"] or action == "restore", 409, "deleted", current=self.note(current))
                    if action == "update":
                        patch = body.get("patch")
                        require(isinstance(patch, dict) and bool(patch) and not (set(patch) - {"text", "status", "board"}))
                        value = text_field(patch, "text", 12000, current["text"])
                        board = text_field(patch, "board", 80, current["board"])
                        status = patch.get("status", current["status"])
                        require(status in STATUSES)
                        db.execute("UPDATE notes SET text=?,board=?,status=?,revision=revision+1 WHERE id=?", (value, board, status, note_id))
                    else:
                        require(action != "restore" or current["deleted"], 409, "not_deleted")
                        db.execute("UPDATE notes SET deleted=?,revision=revision+1 WHERE id=?", (int(action == "delete"), note_id))
                result = {"epoch": self.epoch(db), "note": self.note(db.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone())}
                db.execute("INSERT INTO operations VALUES(?,?,?,?)", (device["id"], operation, fingerprint, compact(result)))
                return result
            raise Fault(404, "not_found")

    def backup(self, destination):
        destination = Path(destination)
        with destination.open("xb"):
            pass
        os.chmod(destination, 0o600)
        source = sqlite3.connect(self.path)
        target = sqlite3.connect(destination)
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()

    @classmethod
    def restore(cls, source_path, destination):
        source_path = Path(source_path).resolve(strict=True)
        destination = Path(destination)
        require(not destination.exists() and not destination.with_suffix(".admin-token").exists(), 400, "destination_exists")
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        source = sqlite3.connect(source_path.as_uri() + "?mode=ro", uri=True)
        try:
            require(source.execute("PRAGMA integrity_check").fetchone()[0] == "ok", 400, "corrupt_backup")
            require(source.execute("SELECT value FROM meta WHERE key='schema'").fetchone()[0] == "1", 400, "unsupported_schema")
            # The final filename never contains an unrotated or partially restored DB.
            with tempfile.TemporaryDirectory(prefix=".work-fleet-restore-", dir=destination.parent) as staging:
                staged = Path(staging) / "restored.sqlite3"
                target = sqlite3.connect(staged)
                try:
                    source.backup(target)
                finally:
                    target.close()
                restored = cls(staged)
                with restored.connect(write=True) as db:
                    db.execute("UPDATE meta SET value=? WHERE key='epoch'", (identifier(),))
                    db.execute("UPDATE devices SET revoked=1")
                    db.execute("DELETE FROM invites")
                    db.execute("DELETE FROM operations")
                # Windows requires a writable handle for fsync; only the private staging copy is opened.
                with staged.open("r+b") as file:
                    os.fsync(file.fileno())
                # Same filesystem, atomic create-only publication, never overwrite a user file.
                os.link(staged, destination)
                if os.name != "nt":
                    directory_fd = os.open(destination.parent, os.O_RDONLY)
                    try:
                        os.fsync(directory_fd)
                    finally:
                        os.close(directory_fd)
        finally:
            source.close()
        restored = cls(destination)
        restored.bootstrap()
        return restored


class Handler(BaseHTTPRequestHandler):
    server_version = "WorkFleet/0.1"

    def log_message(self, *args):
        pass  # No URLs, credentials, note bodies or device names in access logs.

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def reply(self, status, payload, content_type="application/json; charset=utf-8"):
        data = payload if isinstance(payload, bytes) else compact(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(data)

    def handle_request(self):
        try:
            require(self.headers.get("Host") == urlsplit(self.server.origin).netloc, 403, "invalid_host")
            origin = self.headers.get("Origin")
            require(origin is None or origin == self.server.origin, 403, "invalid_origin")
            path = urlsplit(self.path).path
            if self.command == "GET" and path in {"/", "/app.js", "/model.js", "/style.css", "/sw.js"}:
                name = "index.html" if path == "/" else path[1:]
                mime = {"html": "text/html", "js": "text/javascript", "css": "text/css"}[name.rsplit(".", 1)[1]]
                self.reply(200, (WEB / name).read_bytes(), mime + "; charset=utf-8")
                return
            body = {}
            if self.command == "POST":
                require(self.headers.get("Content-Type", "").split(";")[0] == "application/json", 415, "json_required")
                require(not self.headers.get("Transfer-Encoding"), 400, "unsupported_encoding")
                size = int(self.headers.get("Content-Length", "0"))
                require(0 < size <= 65536, 413, "body_size")
                raw = self.rfile.read(size)
                require(len(raw) == size)
                body = json.loads(raw)
            auth = self.headers.get("Authorization", "")
            token = auth[7:] if auth.startswith("Bearer ") else ""
            result = self.server.store.dispatch(self.command, path, token, body, self.server.origin)
            self.reply(200, result)
        except Fault as fault:
            self.reply(fault.status, fault.body)
        except (ValueError, TypeError, UnicodeError):
            self.reply(400, {"error": "invalid_request"})
        except (sqlite3.Error, OSError):
            self.reply(503, {"error": "storage_unavailable"})

    do_GET = handle_request
    do_POST = handle_request


def make_server(store, host="127.0.0.1", port=9847, origin=None):
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.store = store
    server.origin = origin or f"http://{host}:{server.server_port}"
    return server


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=Path.home() / ".work-fleet" / "fleet.sqlite3")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=9847)
    serve.add_argument("--origin")
    serve.add_argument("--cert")
    serve.add_argument("--key")
    invite = sub.add_parser("invite")
    invite.add_argument("--role", choices=sorted(ROLES), default="editor")
    sub.add_parser("backup").add_argument("destination", type=Path)
    restore = sub.add_parser("restore")
    restore.add_argument("source", type=Path)
    args = parser.parse_args()
    if args.command == "restore":
        Store.restore(args.source, args.db)
        print("Restored to a new database; epoch changed and devices revoked. Pair again.")
        return
    store = Store(args.db)
    store.bootstrap()
    if args.command == "invite":
        print(compact(store.create_invite(args.role)))
    elif args.command == "backup":
        store.backup(args.destination)
        print("Backup written. Contains private notes and credential hashes; keep it private.")
    else:
        secure = bool(args.cert and args.key)
        if bool(args.cert) != bool(args.key):
            parser.error("--cert and --key must be supplied together")
        if args.host not in {"127.0.0.1", "localhost"} and not secure:
            parser.error("Non-loopback listeners require TLS --cert, --key and --origin")
        if secure and not args.origin:
            parser.error("TLS requires --origin https://hostname:port")
        if args.origin:
            parsed = urlsplit(args.origin)
            if (parsed.scheme != ("https" if secure else "http") or not parsed.hostname
                    or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password):
                parser.error("--origin must be an exact origin with the listener's scheme")
        server = make_server(store, args.host, args.port, args.origin)
        if secure:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(args.cert, args.key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
        print(f"Work Fleet listening at {server.origin}; data in {store.path}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()


if __name__ == "__main__":
    main()
