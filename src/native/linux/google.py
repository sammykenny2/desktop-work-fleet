"""System-browser PKCE and account-bound, fixed Google Drive operations."""
import base64
import hashlib
import hmac
from http.client import HTTPException
from http.server import BaseHTTPRequestHandler, HTTPServer
import re
import secrets
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import protocol as p
from text import t

SCOPE = "https://www.googleapis.com/auth/drive.appdata"
FIELDS = "id,size,spaces,trashed,appProperties,sha256Checksum"
# Why sync is paused, by the code of the keyring error: the page shows this text, so it is host text (text.py).
PAUSE_REASONS = {"vault-locked": "sync.keyringLocked", "vault-unlock-timeout": "sync.unlockTimedOut",
                 "vault-unlock-cancelled": "sync.unlockCancelled", "storage-integrity": "sync.secretsUnverified"}
GOOGLE_HOSTS = ("oauth2.googleapis.com", "www.googleapis.com")
PHOTO_HOSTS = tuple(f"lh{n}.googleusercontent.com" for n in range(3, 7))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def http(url, method="GET", data=None, headers=None, maximum=2 * 1024 * 1024, hosts=GOOGLE_HOSTS):
    uri = urlsplit(url)
    p.require(uri.scheme == "https" and uri.hostname in hosts and uri.port in (None, 443) and uri.username is None and uri.password is None and not uri.fragment, "invalid-source", "The Google transfer address isn't valid.")
    request = Request(url, data=data, headers=headers or {}, method=method)
    try:
        try:
            response = build_opener(NoRedirect()).open(request, timeout=30)
        except HTTPError as error:
            response = error
        with response:
            length = response.headers.get("Content-Length")
            p.require(length is None or length.isdigit() and int(length) <= maximum, "source-capacity", "Google's response is too large.")
            chunks, size, deadline = [], 0, time.monotonic() + 110
            while True:
                p.require(time.monotonic() < deadline, "network", "The Google transfer timed out; content waiting to upload is kept.")
                chunk = response.read(min(65536, maximum + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                p.require(size <= maximum, "source-capacity", "Google's response is too large.")
            return response.status, b"".join(chunks), response.headers
    except p.Failure:
        raise
    except (URLError, OSError, TimeoutError) as error:
        raise p.Failure("network", "Can't connect to Google; local data and content waiting to upload are kept.") from error


def image_type(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def photo(link):
    """A profile photo is a public googleusercontent address, fetched without the access token; None when unusable."""
    try:
        uri = urlsplit(link)
        usable = len(link) <= 2048 and uri.scheme == "https" and uri.hostname in PHOTO_HOSTS and uri.port in (None, 443) and uri.username is None and uri.password is None and not uri.fragment
    except ValueError:
        usable = False
    if not usable:
        return None
    try:
        status, data, _ = http(link, maximum=128 * 1024, hosts=PHOTO_HOSTS)
    except (p.Failure, HTTPException, ValueError):
        return None
    kind = image_type(data) if status == 200 else None
    return None if kind is None else {"type": kind, "data": base64.b64encode(data).decode("ascii")}


class Google:
    def __init__(self, vault, config, profile, open_browser):
        self.vault, self.profile, self.open_browser = vault, profile, open_browser
        self.client = config.get("google", {}).get("clients", {}).get("linux", "")
        # A Desktop-type client's secret: Google's token endpoint requires it even with PKCE and documents it as non-confidential.
        self.secret = config.get("google", {}).get("secrets", {}).get("linux", "")
        p.require(isinstance(self.secret, str) and len(self.secret) <= 256 and all("!" <= c <= "~" for c in self.secret), "google-config", "The Google client secret setting isn't valid.")
        self.account = profile[7:] if profile.startswith("google:") else ""
        self.prepared = None
        self.closed = threading.Event()
        self.unlock_lock = threading.Lock()
        self.unlock_cancelled = threading.Event()
        # The owner workspace opens before any optional vault/network operation.
        self.credentials = None
        self.vault_error = None
        self.rejected_access = None
        self.uploads = {}

    @property
    def available(self):
        return bool(self.client)

    def load(self, account):
        value = self.vault.read("google-account", account)
        if value is None:
            return None
        credentials = p.decode(value)
        p.require(credentials.get("accountId") == account, "google-account", "The Google account doesn't match.")
        if credentials.get("clientId") != self.client or SCOPE not in credentials.get("scope", "").split():
            return None
        return credentials

    def save(self, credentials):
        p.require(not self.closed.is_set(), "stale-session", "The Google session has ended.")
        self.vault.save("google-account", credentials["accountId"], p.encode(credentials).decode("ascii"))

    def status(self):
        self.refresh_credentials()
        return self.describe_status()

    def describe_status(self):
        reason = None if self.vault_error is None else t(PAUSE_REASONS.get(self.vault_error.code, "sync.keyringUnavailable"))
        return {"configured": self.available, "connected": self.credentials is not None, "profileId": self.profile,
                "accountId": self.account if self.credentials is None and self.vault_error else None if self.credentials is None else self.credentials["accountId"],
                "email": None if self.credentials is None else self.credentials["email"],
                "paused": self.vault_error is not None, "pauseReason": reason}

    def refresh_credentials(self, required=False):
        self.vault_error = None
        if not self.account:
            return
        try:
            self.credentials = self.load(self.account)
        except Exception as error:
            self.credentials = None
            self.vault_error = error if isinstance(error, p.Failure) else p.Failure("vault-unavailable", "The system's secure storage can't be read right now; sync is paused, and your notes still work.")
            if required:
                raise self.vault_error

    def request_unlock(self):
        with self.unlock_lock:
            return self.unlock_cancelled

    def cancel_unlock(self):
        with self.unlock_lock:
            self.unlock_cancelled.set()
            self.unlock_cancelled = threading.Event()
        cancel = getattr(self.vault, "cancel_unlock", None)
        if cancel is not None:
            cancel()

    def unlock_vault(self, deadline=None, request_cancelled=None):
        p.require(not self.closed.is_set() and self.account, "google-account", "Use manual sync in a Google notes workspace.")
        request_cancelled = self.request_unlock() if request_cancelled is None else request_cancelled
        p.require(not request_cancelled.is_set(), "vault-unlock-cancelled", "The unlock was cancelled; sync stays paused.")
        with self.vault.interaction(self.closed, deadline, request_cancelled):
            self.refresh_credentials()
            if self.vault_error is not None:
                if self.vault_error.code != "vault-locked":
                    raise self.vault_error
                self.vault.unlock(self.closed)
            p.require(not self.closed.is_set(), "stale-session", "The Google session has ended.")
            self.refresh_credentials(required=True)
            return self.describe_status()

    def token_request(self, fields):
        if self.secret:
            fields = {**fields, "client_secret": self.secret}
        status, data, _ = http("https://oauth2.googleapis.com/token", "POST", urlencode(fields).encode("ascii"), {"Content-Type": "application/x-www-form-urlencoded"}, 65536)
        p.require(status == 200, "unauthorized", "Google authorization didn't finish or was revoked. Sign in again.")
        return p.decode(data)

    def identity(self, access):
        status, data, _ = http("https://www.googleapis.com/oauth2/v3/userinfo", headers={"Authorization": "Bearer " + access}, maximum=65536)
        p.require(status == 200, "unauthorized", "Work Fleet couldn't verify the Google account.")
        value = p.decode(data)
        p.require(p.is_account(value.get("sub")), "google-account", "The Google account ID isn't valid.")
        return value

    def sign_in(self):
        p.require(self.available and not self.closed.is_set(), "google-config", "Set the Linux Google client ID in .env and rebuild first.")
        self.vault.writable()
        verifier, state = secrets.token_urlsafe(64), secrets.token_urlsafe(32)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
        result = {}

        class Callback(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                uri = urlsplit(self.path)
                query = parse_qs(uri.query, keep_blank_values=True)
                valid = len(self.path) <= 8192 and sum(len(str(key)) + len(str(value)) for key, value in self.headers.items()) <= 16384 and uri.path == "/oauth2/callback" and query.get("state") == [state]
                if valid and hmac.compare_digest(query["state"][0], state) and "code" not in result:
                    if len(query.get("code", [])) == 1 and 0 < len(query["code"][0]) <= 8192:
                        result["code"] = query["code"][0]
                    elif query.get("error"):
                        result["cancelled"] = True
                self.send_response(200 if valid else 400)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(t("signIn.returnToApp").encode("utf-8"))

        class Server(HTTPServer):
            def get_request(self):
                connection, address = super().get_request()
                connection.settimeout(3)
                return connection, address

        with Server(("127.0.0.1", 0), Callback) as server:
            server.timeout = 0.25
            redirect = f"http://127.0.0.1:{server.server_port}/oauth2/callback"
            url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({"client_id": self.client, "redirect_uri": redirect, "response_type": "code", "scope": "openid email " + SCOPE, "state": state, "code_challenge": challenge, "code_challenge_method": "S256", "access_type": "offline", "prompt": "consent select_account"})
            self.open_browser(url)
            deadline = time.monotonic() + 110
            while not result and time.monotonic() < deadline and not self.closed.is_set():
                server.handle_request()
            p.require("code" in result and not self.closed.is_set(), "google-cancelled", "Google sign-in was cancelled or timed out.")
            tokens = self.token_request({"client_id": self.client, "code": result["code"], "code_verifier": verifier, "redirect_uri": redirect, "grant_type": "authorization_code"})
        access, scope = p.text(tokens, "access_token", 8192), p.text(tokens, "scope", 4096)
        p.require(SCOPE in scope.split(), "source-permission", "App data sync hasn't been authorized.")
        identity = self.identity(access)
        credentials = {"accountId": identity["sub"], "email": p.text(identity, "email", 512), "clientId": self.client, "scope": scope, "refreshToken": p.text(tokens, "refresh_token", 8192), "accessToken": access, "expiresAt": int(time.time()) + p.number(tokens, "expires_in", 86400)}
        self.save(credentials)
        self.prepared = credentials["accountId"]
        return {"accountId": credentials["accountId"], "email": credentials["email"], "profileId": "google:" + credentials["accountId"]}

    def open_account(self, account):
        p.require(account == self.prepared and self.load(account) is not None, "google-account", "Finish signing in to this account first.")
        self.prepared = None
        return "google:" + account

    def sign_out(self):
        # Only this device signs out. Google's revocation removes the project's grant for every client, so every other
        # device signed in to this account would lose sync within the hour (ADR-021, amended 2026-10-15).
        credentials = self.credentials
        account = credentials["accountId"] if credentials is not None else self.account
        if account:
            self.vault.remove("google-account", account)
        self.credentials = self.prepared = None
        self.vault_error = None
        self.uploads.clear()
        self.rejected_access = None

    def token(self):
        # A later keyring lock must also stop use of an access token previously loaded into memory.
        self.refresh_credentials(required=True)
        p.require(not self.closed.is_set() and self.credentials is not None and self.profile == "google:" + self.credentials["accountId"], "unauthorized", "Sign in to the current Google account first.")
        if self.credentials["expiresAt"] <= int(time.time()) + 60 or self.credentials["accessToken"] == self.rejected_access:
            tokens = self.token_request({"client_id": self.client, "refresh_token": self.credentials["refreshToken"], "grant_type": "refresh_token"})
            access = p.text(tokens, "access_token", 8192)
            p.require(self.identity(access)["sub"] == self.account, "google-account", "Google returned a different account, so sync stopped.")
            updated = {**self.credentials, "accessToken": access, "expiresAt": int(time.time()) + p.number(tokens, "expires_in", 86400)}
            self.save(updated)
            self.credentials = updated
            self.rejected_access = None
        return self.credentials["accessToken"]

    def path(self, base, **query):
        return base + "?" + urlencode(query)

    def request(self, path, method="GET", data=None, headers=None, maximum=2 * 1024 * 1024, context="", allow308=False):
        status, body, response = http("https://www.googleapis.com" + path, method, data, {**(headers or {}), "Authorization": "Bearer " + self.token()}, maximum)
        p.require(not self.closed.is_set(), "stale-session", "The Google session has ended.")
        if 200 <= status < 300 or allow308 and status == 308:
            return status, body, response
        try:
            reasons = p.decode(body).get("error", {}).get("errors", [])
            reason = reasons[0].get("reason", "") if reasons else ""
        except (p.Failure, AttributeError, TypeError):
            reason = ""
        code = "source-error"
        if status == 401:
            if self.credentials is not None:
                self.rejected_access = self.credentials["accessToken"]
            code = "unauthorized"
        elif status == 409:
            code = "file-exists"
        elif status == 429 or reason in ("rateLimitExceeded", "userRateLimitExceeded"):
            code = "rate-limit"
        elif status >= 500:
            code = "service-unavailable"
        elif status == 410 and context == "changes":
            code = "cursor-expired"
        elif status in (400, 410) and context == "listing":
            code = "page-expired"
        elif status == 404 and context == "upload":
            code = "upload-session-expired"
        elif status == 404 and context == "delete":
            code = "file-missing"
        elif reason == "storageQuotaExceeded":
            code = "storage-quota"
        elif status == 403:
            code = "source-permission"
        error = p.Failure(code, "Google Drive didn't finish syncing; local data and content waiting to upload are kept.")
        error.status = status
        raise error

    def json(self, path, **options):
        return p.decode(self.request(path, **options)[1])

    def file(self, args):
        value = args.get("file")
        p.require(isinstance(value, dict) and re.fullmatch(r"[A-Za-z0-9_-]{1,256}", p.text(value, "id")) is not None and value.get("kind") in ("revision", "attachment", "reset", "workspace") and p.is_digest(value.get("sha256")), "invalid-source-file", "The sync file's identity isn't valid.")
        size = p.number(value, "size", {"revision": 8 * 1024 * 1024, "workspace": 8 * 1024 * 1024, "reset": 4096}.get(value["kind"], p.ATTACHMENT))
        return {"id": value["id"], "kind": value["kind"], "sha256": value["sha256"], "size": size}

    def metadata(self, value, file):
        properties = value.get("appProperties", {})
        p.require(value.get("id") == file["id"] and str(value.get("size")) == str(file["size"]) and "appDataFolder" in value.get("spaces", []) and value.get("trashed", False) is False and properties.get("wfFormat") == "work-fleet-file" and properties.get("wfSchema") == "1" and properties.get("wfKind") == file["kind"] and properties.get("wfSha256") == file["sha256"] and value.get("sha256Checksum", file["sha256"]) == file["sha256"], "upload-mismatch", "The Google file's metadata doesn't match its content.")

    def read_file(self, file):
        self.metadata(self.json(self.path("/drive/v3/files/" + file["id"], fields=FIELDS)), file)
        data = self.request(self.path("/drive/v3/files/" + file["id"], alt="media"), maximum=max(65536, file["size"]))[1]
        p.require(len(data) == file["size"] and p.digest(data) == file["sha256"], "file-integrity", "The Google file's content failed its checksum.")
        return data

    def completed(self, data, file):
        value = p.decode(data)
        self.metadata(value, file)
        if "sha256Checksum" not in value:
            self.read_file(file)
        self.uploads.pop(file["id"], None)
        return value

    def offset(self, headers, size, previous):
        value = headers.get("Range")
        p.require(value is None or re.fullmatch(r"bytes=0-[0-9]+", value) is not None, "invalid-upload-range", "Google's resumable upload progress isn't valid.")
        offset = 0 if value is None else int(value[8:]) + 1
        p.require(previous < offset <= size, "service-unavailable", "Google hasn't confirmed new upload progress.")
        return offset

    def create_file(self, file, data):
        key, size = file["id"], file["size"]
        metadata = p.encode({"id": key, "name": f"work-fleet-v1-{file['kind']}-{file['sha256']}.bin", "mimeType": "application/octet-stream", "parents": ["appDataFolder"], "appProperties": {"wfFormat": "work-fleet-file", "wfSchema": "1", "wfKind": file["kind"], "wfSha256": file["sha256"]}})
        try:
            if not data:
                boundary = "wf_" + p.identifier()
                body = b"--" + boundary.encode() + b"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + metadata + b"\r\n--" + boundary.encode() + b"\r\nContent-Type: application/octet-stream\r\n\r\n\r\n--" + boundary.encode() + b"--\r\n"
                return self.completed(self.request(self.path("/upload/drive/v3/files", uploadType="multipart", fields=FIELDS), "POST", body, {"Content-Type": "multipart/related; boundary=" + boundary})[1], file)
            saved, position = self.uploads.get(key), 0
            if saved is not None:
                p.require(saved[1:] == (file["sha256"], size), "upload-mismatch", "The resumed content differs from the original upload.")
                status, body, headers = self.request(saved[0], "PUT", b"", {"Content-Range": f"bytes */{size}"}, context="upload", allow308=True)
                if status != 308:
                    return self.completed(body, file)
                position = self.offset(headers, size, -1)
            else:
                _, _, headers = self.request(self.path("/upload/drive/v3/files", uploadType="resumable", fields=FIELDS), "POST", metadata, {"Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": str(size)})
                location = headers.get("Location", "")
                uri = urlsplit(location)
                # Google echoes the request's own parameters (fields) and adds its own (session_crd) beside upload_id, so any
                # distinct plain parameters are accepted; where the contents and the token go is what stays fixed.
                pairs = uri.query.split("&")
                p.require(len(location) <= 8192 and uri.scheme == "https" and uri.hostname == "www.googleapis.com" and uri.port in (None, 443) and uri.username is None and uri.password is None and not uri.fragment and uri.path == "/upload/drive/v3/files"
                          and all(re.fullmatch(r"[A-Za-z_]+=[A-Za-z0-9_%.-]*", pair) for pair in pairs) and len({pair.split("=")[0] for pair in pairs}) == len(pairs)
                          and "uploadType=resumable" in pairs and any(pair.startswith("upload_id=") and len(pair) > 10 for pair in pairs), "invalid-upload-uri", "Google's resumable upload address isn't valid.")
                saved = (urlunsplit(("", "", uri.path, uri.query, "")), file["sha256"], size)
                self.uploads[key] = saved
            while position < size:
                end = min(size, position + 1024 * 1024)
                status, body, headers = self.request(saved[0], "PUT", data[position:end], {"Content-Type": "application/octet-stream", "Content-Range": f"bytes {position}-{end - 1}/{size}"}, context="upload", allow308=True)
                if status != 308:
                    return self.completed(body, file)
                position = self.offset(headers, end, position)
            raise p.Failure("service-unavailable", "Google hasn't confirmed that the upload finished; content waiting to upload is kept.")
        except p.Failure as error:
            if 400 <= getattr(error, "status", 0) < 500:
                self.uploads.pop(key, None)
            if error.code == "file-exists":
                self.read_file(file)
                return self.json(self.path("/drive/v3/files/" + key, fields=FIELDS))
            raise

    def account_details(self):
        # The account chip's name and photo: Drive's about.user needs no scope beyond app data.
        about = self.json(self.path("/drive/v3/about", fields="user(displayName,photoLink)"))
        user = about.get("user") if isinstance(about, dict) and isinstance(about.get("user"), dict) else {}
        name = user["displayName"].strip() if isinstance(user.get("displayName"), str) else ""
        link = user.get("photoLink")
        return {"name": name if 0 < len(name) <= 256 else None, "photo": photo(link.strip()) if isinstance(link, str) else None}

    def invoke(self, method, args, data=None):
        p.require(p.text(args, "accountId") == self.account and not self.closed.is_set(), "stale-session", "The Google account has changed.")
        if method == "google.cursor":
            return self.json(self.path("/drive/v3/changes/startPageToken", fields="startPageToken"))
        if method == "google.list":
            query = {"spaces": "appDataFolder", "q": "trashed = false", "pageSize": "100", "fields": f"nextPageToken,incompleteSearch,files({FIELDS})"}
            if args.get("pageToken") is not None:
                query["pageToken"] = p.text(args, "pageToken", 8192)
            return self.json(self.path("/drive/v3/files", **query), context="listing")
        if method == "google.changes":
            return self.json(self.path("/drive/v3/changes", pageToken=p.text(args, "cursor", 8192), spaces="appDataFolder", pageSize="100", includeRemoved="true", fields=f"nextPageToken,newStartPageToken,changes(fileId,removed,file({FIELDS},mimeType))"), context="changes")
        if method == "google.allocate":
            return self.json(self.path("/drive/v3/files/generateIds", count="1", space="appDataFolder", type="files", fields="ids"))
        if method == "google.profile":
            return self.account_details()
        if method == "google.delete":
            # Reset only: files in the app data folder are removed one by one; one that is already gone counts as deleted.
            file_id = p.text(args, "fileId", 256)
            p.require(re.fullmatch(r"[A-Za-z0-9_-]{1,256}", file_id) is not None, "invalid-source-file", "The sync file's identity isn't valid.")
            try:
                self.request("/drive/v3/files/" + file_id, method="DELETE", context="delete")
            except p.Failure as failure:
                if failure.code != "file-missing":
                    raise
            return None
        file = self.file(args)
        if method == "google.read":
            return self.read_file(file)
        if method == "google.create":
            p.require(data is not None and len(data) == file["size"] and p.digest(data) == file["sha256"], "file-integrity", "The file waiting to upload failed its checksum.")
            return self.create_file(file, data)
        raise p.Failure("unsupported-method", "The Google host doesn't support this operation.")

    def close(self):
        self.closed.set()
        self.cancel_unlock()
        self.uploads.clear()
