"""System-browser PKCE and account-bound, fixed Google Drive operations."""
import base64
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import re
import secrets
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import protocol as p

SCOPE = "https://www.googleapis.com/auth/drive.appdata"
FIELDS = "id,size,spaces,trashed,appProperties,sha256Checksum"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def http(url, method="GET", data=None, headers=None, maximum=2 * 1024 * 1024):
    uri = urlsplit(url)
    p.require(uri.scheme == "https" and uri.hostname in ("oauth2.googleapis.com", "www.googleapis.com") and uri.port in (None, 443) and uri.username is None and uri.password is None and not uri.fragment, "invalid-source", "Google 傳輸位置無效。")
    request = Request(url, data=data, headers=headers or {}, method=method)
    try:
        try:
            response = build_opener(NoRedirect()).open(request, timeout=30)
        except HTTPError as error:
            response = error
        with response:
            length = response.headers.get("Content-Length")
            p.require(length is None or length.isdigit() and int(length) <= maximum, "source-capacity", "Google 回應容量超限。")
            chunks, size, deadline = [], 0, time.monotonic() + 110
            while True:
                p.require(time.monotonic() < deadline, "network", "Google 傳輸逾時，待送內容保留。")
                chunk = response.read(min(65536, maximum + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                p.require(size <= maximum, "source-capacity", "Google 回應容量超限。")
            return response.status, b"".join(chunks), response.headers
    except p.Failure:
        raise
    except (URLError, OSError, TimeoutError) as error:
        raise p.Failure("network", "無法連接 Google，本機資料與待送內容保留。") from error


class Google:
    def __init__(self, vault, config, profile, open_browser):
        self.vault, self.profile, self.open_browser = vault, profile, open_browser
        self.client = config.get("google", {}).get("clients", {}).get("linux", "")
        # A Desktop-type client's secret: Google's token endpoint requires it even with PKCE and documents it as non-confidential.
        self.secret = config.get("google", {}).get("secrets", {}).get("linux", "")
        p.require(isinstance(self.secret, str) and len(self.secret) <= 256 and all("!" <= c <= "~" for c in self.secret), "google-config", "Google client secret 設定無效。")
        self.account = profile[7:] if profile.startswith("google:") else ""
        self.prepared = None
        self.closed = threading.Event()
        self.credentials = self.load(self.account) if self.account else None
        self.uploads = {}

    @property
    def available(self):
        return bool(self.client)

    def load(self, account):
        value = self.vault.read("google-account", account)
        if value is None:
            return None
        credentials = p.decode(value)
        p.require(credentials.get("accountId") == account, "google-account", "Google 帳號身分不符。")
        if credentials.get("clientId") != self.client or SCOPE not in credentials.get("scope", "").split():
            return None
        return credentials

    def save(self, credentials):
        p.require(not self.closed.is_set(), "stale-session", "Google 工作階段已結束。")
        self.vault.save("google-account", credentials["accountId"], p.encode(credentials).decode("ascii"))

    def status(self):
        return {"configured": self.available, "connected": self.credentials is not None, "profileId": self.profile,
                "accountId": None if self.credentials is None else self.credentials["accountId"],
                "email": None if self.credentials is None else self.credentials["email"]}

    def token_request(self, fields):
        if self.secret:
            fields = {**fields, "client_secret": self.secret}
        status, data, _ = http("https://oauth2.googleapis.com/token", "POST", urlencode(fields).encode("ascii"), {"Content-Type": "application/x-www-form-urlencoded"}, 65536)
        p.require(status == 200, "unauthorized", "Google 授權未完成或已撤銷，請重新登入。")
        return p.decode(data)

    def identity(self, access):
        status, data, _ = http("https://www.googleapis.com/oauth2/v3/userinfo", headers={"Authorization": "Bearer " + access}, maximum=65536)
        p.require(status == 200, "unauthorized", "無法核對 Google 帳號。")
        value = p.decode(data)
        p.require(p.is_account(value.get("sub")), "google-account", "Google 帳號身分無效。")
        return value

    def sign_in(self):
        p.require(self.available and not self.closed.is_set(), "google-config", "請先填寫 .env 的 Linux Google client ID 並重新建置。")
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
                self.wfile.write("請返回 Work Fleet 完成登入。".encode("utf-8"))

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
            p.require("code" in result and not self.closed.is_set(), "google-cancelled", "Google 登入已取消或逾時。")
            tokens = self.token_request({"client_id": self.client, "code": result["code"], "code_verifier": verifier, "redirect_uri": redirect, "grant_type": "authorization_code"})
        access, scope = p.text(tokens, "access_token", 8192), p.text(tokens, "scope", 4096)
        p.require(SCOPE in scope.split(), "source-permission", "尚未授權 App 資料同步。")
        identity = self.identity(access)
        credentials = {"accountId": identity["sub"], "email": p.text(identity, "email", 512), "clientId": self.client, "scope": scope, "refreshToken": p.text(tokens, "refresh_token", 8192), "accessToken": access, "expiresAt": int(time.time()) + p.number(tokens, "expires_in", 86400)}
        self.save(credentials)
        self.prepared = credentials["accountId"]
        return {"accountId": credentials["accountId"], "email": credentials["email"], "profileId": "google:" + credentials["accountId"]}

    def open_account(self, account):
        p.require(account == self.prepared and self.load(account) is not None, "google-account", "請先完成此帳號登入。")
        self.prepared = None
        return "google:" + account

    def sign_out(self):
        # Only this device signs out. Google's revocation removes the project's grant for every client, so every other
        # device signed in to this account would lose sync within the hour (ADR-021, amended 2026-10-15).
        if self.credentials is not None:
            self.vault.remove("google-account", self.credentials["accountId"])
            self.credentials = None
            self.uploads.clear()

    def token(self):
        p.require(not self.closed.is_set() and self.credentials is not None and self.profile == "google:" + self.credentials["accountId"], "unauthorized", "請先登入目前 Google 帳號。")
        if self.credentials["expiresAt"] <= int(time.time()) + 60:
            tokens = self.token_request({"client_id": self.client, "refresh_token": self.credentials["refreshToken"], "grant_type": "refresh_token"})
            access = p.text(tokens, "access_token", 8192)
            p.require(self.identity(access)["sub"] == self.account, "google-account", "Google 回傳不同帳號，已停止同步。")
            updated = {**self.credentials, "accessToken": access, "expiresAt": int(time.time()) + p.number(tokens, "expires_in", 86400)}
            self.save(updated)
            self.credentials = updated
        return self.credentials["accessToken"]

    def path(self, base, **query):
        return base + "?" + urlencode(query)

    def request(self, path, method="GET", data=None, headers=None, maximum=2 * 1024 * 1024, context="", allow308=False):
        status, body, response = http("https://www.googleapis.com" + path, method, data, {**(headers or {}), "Authorization": "Bearer " + self.token()}, maximum)
        p.require(not self.closed.is_set(), "stale-session", "Google 工作階段已結束。")
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
                self.credentials["expiresAt"] = 0
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
        error = p.Failure(code, "Google Drive 未完成同步，本機資料與待送內容保留。")
        error.status = status
        raise error

    def json(self, path, **options):
        return p.decode(self.request(path, **options)[1])

    def file(self, args):
        value = args.get("file")
        p.require(isinstance(value, dict) and re.fullmatch(r"[A-Za-z0-9_-]{1,256}", p.text(value, "id")) is not None and value.get("kind") in ("revision", "attachment", "reset") and p.is_digest(value.get("sha256")), "invalid-source-file", "同步檔案身分無效。")
        size = p.number(value, "size", {"revision": 8 * 1024 * 1024, "reset": 4096}.get(value["kind"], p.ATTACHMENT))
        return {"id": value["id"], "kind": value["kind"], "sha256": value["sha256"], "size": size}

    def metadata(self, value, file):
        properties = value.get("appProperties", {})
        p.require(value.get("id") == file["id"] and str(value.get("size")) == str(file["size"]) and "appDataFolder" in value.get("spaces", []) and value.get("trashed", False) is False and properties.get("wfFormat") == "work-fleet-file" and properties.get("wfSchema") == "1" and properties.get("wfKind") == file["kind"] and properties.get("wfSha256") == file["sha256"] and value.get("sha256Checksum", file["sha256"]) == file["sha256"], "upload-mismatch", "Google 檔案 metadata 與內容身分不同。")

    def read_file(self, file):
        self.metadata(self.json(self.path("/drive/v3/files/" + file["id"], fields=FIELDS)), file)
        data = self.request(self.path("/drive/v3/files/" + file["id"], alt="media"), maximum=max(65536, file["size"]))[1]
        p.require(len(data) == file["size"] and p.digest(data) == file["sha256"], "file-integrity", "Google 檔案內容校驗失敗。")
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
        p.require(value is None or re.fullmatch(r"bytes=0-[0-9]+", value) is not None, "invalid-upload-range", "Google 續傳進度無效。")
        offset = 0 if value is None else int(value[8:]) + 1
        p.require(previous < offset <= size, "service-unavailable", "Google 尚未確認新的續傳進度。")
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
                p.require(saved[1:] == (file["sha256"], size), "upload-mismatch", "續傳內容與原上傳不同。")
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
                          and "uploadType=resumable" in pairs and any(pair.startswith("upload_id=") and len(pair) > 10 for pair in pairs), "invalid-upload-uri", "Google 續傳位置無效。")
                saved = (urlunsplit(("", "", uri.path, uri.query, "")), file["sha256"], size)
                self.uploads[key] = saved
            while position < size:
                end = min(size, position + 1024 * 1024)
                status, body, headers = self.request(saved[0], "PUT", data[position:end], {"Content-Type": "application/octet-stream", "Content-Range": f"bytes {position}-{end - 1}/{size}"}, context="upload", allow308=True)
                if status != 308:
                    return self.completed(body, file)
                position = self.offset(headers, end, position)
            raise p.Failure("service-unavailable", "Google 尚未確認上傳完成，待送內容保留。")
        except p.Failure as error:
            if 400 <= getattr(error, "status", 0) < 500:
                self.uploads.pop(key, None)
            if error.code == "file-exists":
                self.read_file(file)
                return self.json(self.path("/drive/v3/files/" + key, fields=FIELDS))
            raise

    def invoke(self, method, args, data=None):
        p.require(p.text(args, "accountId") == self.account and not self.closed.is_set(), "stale-session", "Google 帳號已切換。")
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
        if method == "google.delete":
            # Reset only: files in the app data folder are removed one by one; one that is already gone counts as deleted.
            file_id = p.text(args, "fileId", 256)
            p.require(re.fullmatch(r"[A-Za-z0-9_-]{1,256}", file_id) is not None, "invalid-source-file", "同步檔案身分無效。")
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
            p.require(data is not None and len(data) == file["size"] and p.digest(data) == file["sha256"], "file-integrity", "待送檔案校驗失敗。")
            return self.create_file(file, data)
        raise p.Failure("unsupported-method", "Google 主機沒有此操作。")

    def close(self):
        self.closed.set()
        self.uploads.clear()
