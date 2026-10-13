"""ADR-044 Linux updater: GitHub Releases of the configured public repository and a DEB installed through pkexec.

The feed rules match the Windows host (tests/fixtures/update-feed.json). HTTPS only, no credentials, a fixed host allowlist
with at most three redirects, size limits and a streamed SHA-256. No GTK here: the owner passes callbacks that run on its
main loop. Installing replaces the files of the running app, so the owner restarts right after a successful install."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

PLATFORM = "linux"
ARCHITECTURE = "all"
PACKAGE = "work-fleet"
MANIFEST = "work-fleet-update.json"
MAX_FEED = 2 * 1024 * 1024
MAX_MANIFEST = 64 * 1024
MAX_PACKAGE = 512 * 1024 * 1024
API_HOSTS = ("api.github.com",)
DOWNLOAD_HOSTS = ("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com")
VERSION = re.compile(r"^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
REPOSITORY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$")


class UpdateError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def invalid(detail=""):
    return UpdateError("metadata_invalid", "更新資訊格式不符，未下載任何檔案。" + detail)


def parse_version(text):
    """A strict x.y.z release version without leading zeros, as a tuple, or None."""
    match = VERSION.match(text) if isinstance(text, str) else None
    return tuple(int(part) for part in match.groups()) if match else None


def latest(releases, platform, channel, current):
    """The newest release for this platform and channel that is newer than `current` (a tuple), or None."""
    try:
        value = json.loads(releases)
    except (ValueError, UnicodeDecodeError) as error:
        raise invalid() from error
    if not isinstance(value, list):
        raise invalid()
    prefix, best = platform + "-v", None
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("tag_name"), str) or not item["tag_name"].startswith(prefix):
            continue
        version = parse_version(item["tag_name"][len(prefix):])
        if version is None or item.get("draft") is True or item.get("prerelease") is True and channel != "preview" or version <= current:
            continue
        if best is not None and version <= best["version"]:
            continue
        assets = [{"name": asset["name"], "size": asset["size"], "url": asset["browser_download_url"]}
                  for asset in item.get("assets") or [] if isinstance(asset, dict) and isinstance(asset.get("name"), str)
                  and isinstance(asset.get("browser_download_url"), str) and type(asset.get("size")) is int and asset["size"] >= 0]
        best = {"tag": item["tag_name"], "version": version, "prerelease": item.get("prerelease") is True,
                "page": item.get("html_url") if isinstance(item.get("html_url"), str) else "", "assets": assets}
    return best


def manifest(data, release, platform, arch):
    """Checks a release's work-fleet-update.json against the release and picks this architecture's installer."""
    def unique(pairs):
        keys = [key for key, _ in pairs]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate key")
        return dict(pairs)
    try:
        value = json.loads(data, object_pairs_hook=unique)
    except (ValueError, UnicodeDecodeError) as error:
        raise invalid() from error
    if not isinstance(value, dict) or type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1:
        raise invalid()
    summary = value.get("summary") if isinstance(value.get("summary"), str) else ""
    if value.get("platform") != platform or value.get("tag") != release["tag"] or parse_version(value.get("version")) != release["version"] or len(summary) > 2000:
        raise invalid()
    assets = value.get("assets")
    if not isinstance(assets, list):
        raise invalid()
    matches = [asset for asset in assets if isinstance(asset, dict) and asset.get("arch") == arch]
    if len(matches) != 1:
        raise invalid("沒有這個架構的安裝檔。")
    chosen = matches[0]
    name, sha256, size = chosen.get("name"), chosen.get("sha256"), chosen.get("size")
    if not isinstance(name, str) or not isinstance(sha256, str) or not DIGEST.match(sha256) or type(size) is not int or not 0 < size <= MAX_PACKAGE:
        raise invalid()
    asset = next((item for item in release["assets"] if item["name"] == name), None)
    if asset is None or asset["size"] != size:
        raise invalid()
    return {"version": value["version"], "tag": release["tag"], "summary": summary[:500], "name": name, "size": size,
            "sha256": sha256, "url": asset["url"], "page": release["page"]}


def host_architecture(run=subprocess.run):
    try:
        return run(["dpkg", "--print-architecture"], capture_output=True, text=True, timeout=10, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def check_deb(path, version, current, run=subprocess.run, architecture=None):
    """The download must be this app's DEB at the manifest version, newer than this one, for all or this architecture."""
    try:
        result = run(["dpkg-deb", "-f", str(path), "Package", "Version", "Architecture"], capture_output=True, text=True, timeout=30, check=True)
    except (OSError, subprocess.SubprocessError) as error:
        raise UpdateError("identity_mismatch", "下載的檔案不是有效的 DEB，未安裝。") from error
    fields = {}
    for line in result.stdout.splitlines():
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip()
    if fields.get("Package") != PACKAGE:
        raise UpdateError("identity_mismatch", "下載的安裝檔不是這個 App，未安裝。")
    if fields.get("Version") != version or parse_version(fields.get("Version")) is None or parse_version(fields["Version"]) <= current \
            or fields.get("Architecture") not in ("all", architecture if architecture is not None else host_architecture(run)):
        raise UpdateError("identity_mismatch", "下載的安裝檔版本或架構不符，未安裝。")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class Fetcher:
    """HTTPS GET to allowlisted hosts; redirects are followed by hand, at most three, only to the GitHub asset hosts."""
    def __init__(self, user_agent, opener=None):
        self.user_agent = user_agent
        self.opener = opener or urllib.request.build_opener(_NoRedirect())

    def open(self, url, hosts, accept, timeout):
        for _hop in range(4):
            parts = urllib.parse.urlsplit(url)
            if parts.scheme != "https" or parts.port not in (None, 443) or parts.username or parts.password or (parts.hostname or "").lower() not in hosts:
                raise UpdateError("provider_rejected", "更新來源指向未允許的位置，已停止。")
            headers = {"User-Agent": self.user_agent, "Accept": accept}
            if hosts == API_HOSTS:
                headers["X-GitHub-Api-Version"] = "2022-11-28"
            try:
                return self.opener.open(urllib.request.Request(url, headers=headers), timeout=timeout)
            except urllib.error.HTTPError as error:
                location = error.headers.get("Location") if error.headers else None
                error.close()
                if error.code in (301, 302, 303, 307, 308) and location:
                    url, hosts = urllib.parse.urljoin(url, location), DOWNLOAD_HOSTS
                    continue
                if error.code in (403, 429):
                    raise UpdateError("rate_limited", "GitHub 暫時限制查詢次數，請稍後再試。") from error
                raise UpdateError("provider_rejected", f"GitHub 回應錯誤（{error.code}），請稍後再試。") from error
            except urllib.error.URLError as error:
                raise UpdateError("offline", "無法連線到 GitHub，請確認網路後再試。") from error
            except TimeoutError as error:
                raise UpdateError("timeout", "連線逾時，請稍後再試。") from error
        raise UpdateError("provider_rejected", "更新來源轉址次數過多，已停止。")

    def fetch(self, url, limit, hosts):
        with self.open(url, hosts, "application/vnd.github+json" if hosts == API_HOSTS else "application/octet-stream", 30) as response:
            data = response.read(limit + 1)
        if len(data) > limit:
            raise invalid("超過容量上限。")
        return data

    def download(self, url, path, size, sha256, progress):
        digest, received = hashlib.sha256(), 0
        try:
            with self.open(url, DOWNLOAD_HOSTS, "application/octet-stream", 60) as response, open(path, "wb") as output:
                while True:
                    chunk = response.read(81920)
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > size:
                        raise UpdateError("checksum_mismatch", "下載的檔案大小不符，已刪除。")
                    digest.update(chunk)
                    output.write(chunk)
                    progress(received)
        except TimeoutError as error:
            raise UpdateError("timeout", "下載逾時，請稍後再試。") from error
        if received != size or digest.hexdigest() != sha256:
            raise UpdateError("checksum_mismatch", "下載的檔案與更新資訊不符，已刪除。")


class Updater:
    """One check, download or install at a time; a request while one runs joins it. `publish` gets every state change."""
    def __init__(self, directory, config, version, distribution, publish, record_check, last_checked=None, fetcher=None, run=subprocess.run, which=shutil.which):
        update = config.get("update") if isinstance(config.get("update"), dict) else {}
        repository = update.get("repository") if isinstance(update.get("repository"), str) else ""
        self.repository = repository if REPOSITORY.match(repository) else ""
        self.channel = update.get("channel") if update.get("channel") == "preview" else "preview"
        self.folder = Path(directory) / "updates"
        self.current_text, self.current = version, parse_version(version) or (0, 0, 0)
        self.publish, self.record_check, self.run = publish, record_check, run
        self.fetcher = fetcher or Fetcher(f"WorkFleet/{version}")
        tools = which("pkexec") and which("dpkg-deb")
        self.reason = ("只有以 DEB 安裝的版本支援 App 內更新。" if distribution != "deb" else "這個版本沒有設定更新來源。" if not self.repository
                       else "系統缺少 pkexec 或 dpkg-deb，無法安裝更新。" if not tools else "")
        self.capable = not self.reason
        self.status = "idle" if self.capable else "unavailable"
        self.last_checked, self.pending, self.downloaded = last_checked, None, None
        self.error = None
        self.received = self.total = 0
        self.lock = threading.Lock()
        self.worker = None
        self.last_progress = 0.0

    def snapshot(self):
        failed_next = "check" if self.pending is None else "download" if self.downloaded is None else "install"
        next_action = {"idle": "check", "up_to_date": "check", "update_available": "download", "downloaded": "install", "failed": failed_next}.get(self.status, "none")
        return {"available": self.capable, "reason": self.reason or None, "currentVersion": self.current_text, "channel": self.channel,
                "status": self.status, "nextAction": next_action, "version": self.pending and self.pending["version"],
                "summary": self.pending and self.pending["summary"], "pageUrl": self.pending and self.pending["page"], "lastCheckedAt": self.last_checked,
                "progress": {"received": self.received, "total": self.total} if self.status == "downloading" else None,
                "error": {"code": self.error.code, "message": str(self.error)} if self.error else None}

    def set(self, status):
        self.status = status
        self.publish(self.snapshot())

    def start(self, work, done=None):
        """Runs `work` on a worker thread; `done` runs after it, also when this request joined a running one."""
        with self.lock:
            if not self.capable:
                return False
            if self.worker is not None and self.worker.is_alive():
                if done:
                    threading.Thread(target=lambda worker=self.worker: (worker.join(), done()), daemon=True).start()
                return True

            def body():
                self.error = None
                try:
                    work()
                except UpdateError as error:
                    self.error = error
                    self.set("failed")
                except OSError:
                    self.error = UpdateError("install_failed", "無法保存下載的更新，請確認磁碟空間後再試。")
                    self.set("failed")
                except Exception:
                    self.error = UpdateError("unknown", "更新沒有完成，請稍後再試。")
                    self.set("failed")
                finally:
                    if done:
                        done()
            self.worker = threading.Thread(target=body, name="fleet-updater", daemon=True)
            self.worker.start()
            return True

    def check(self, done=None):
        return self.start(self.check_now, done)

    def download(self, done=None):
        def work():
            self.check_now()
            if self.status == "update_available" and self.pending is not None:
                self.download_now(self.pending)
        return self.start(work, done)

    def check_now(self):
        self.set("checking")
        releases = self.fetcher.fetch(f"https://api.github.com/repos/{self.repository}/releases?per_page=30", MAX_FEED, API_HOSTS)
        release = latest(releases, PLATFORM, self.channel, self.current)
        self.last_checked = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.record_check(self.last_checked)
        if release is None:
            self.pending = None
            self.clean(None)
            self.set("up_to_date")
            return
        asset = next((item for item in release["assets"] if item["name"] == MANIFEST), None)
        if asset is None:
            raise UpdateError("metadata_invalid", "這個版本缺少更新資訊，未下載任何檔案。")
        package = manifest(self.fetcher.fetch(asset["url"], MAX_MANIFEST, DOWNLOAD_HOSTS), release, PLATFORM, ARCHITECTURE)
        self.pending = package
        file = self.folder / package["name"]
        # A downloaded package counts only while the feed still names the same version and bytes.
        self.downloaded = file if file.is_file() and file.stat().st_size == package["size"] and self.digest(file) == package["sha256"] else None
        self.clean(self.downloaded)
        self.set("update_available" if self.downloaded is None else "downloaded")

    def download_now(self, package):
        self.folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        file = self.folder / package["name"]
        partial = file.with_name(file.name + ".partial")
        self.received, self.total = 0, package["size"]
        self.set("downloading")

        def progress(received):
            self.received = received
            if time.monotonic() - self.last_progress > 0.25:
                self.last_progress = time.monotonic()
                self.publish(self.snapshot())
        try:
            self.fetcher.download(package["url"], partial, package["size"], package["sha256"], progress)
            check_deb(partial, package["version"], self.current, self.run)
            partial.replace(file)
            self.downloaded = file
            self.set("downloaded")
        finally:
            partial.unlink(missing_ok=True)

    def ready(self):
        """The verified package, checked again right before installing."""
        if self.status != "downloaded" or self.downloaded is None or self.pending is None:
            raise UpdateError("update-not-ready", "還沒有下載好的更新。")
        if not self.downloaded.is_file() or self.digest(self.downloaded) != self.pending["sha256"]:
            self.downloaded = None
            self.set("update_available")
            raise UpdateError("checksum_mismatch", "下載的更新已變更，請重新下載。")
        check_deb(self.downloaded, self.pending["version"], self.current, self.run)
        return self.downloaded

    def install(self, done):
        """Installs the verified DEB with pkexec; `done(True)` means the new version is in place and the owner restarts."""
        def work():
            try:
                install()
            except BaseException:
                done(False)
                raise

        def install():
            path = self.ready()
            self.set("installing")
            # apt-get resolves new dependencies from the distribution; a local path keeps it from downloading Work Fleet itself.
            command = ["pkexec", "apt-get", "install", "-y", str(path.resolve())] if shutil.which("apt-get") else ["pkexec", "dpkg", "-i", str(path.resolve())]
            try:
                result = self.run(command, capture_output=True, text=True, timeout=1800)
            except subprocess.TimeoutExpired as error:
                raise UpdateError("install_failed", "安裝逾時，未完成。") from error
            if result.returncode in (126, 127):
                self.error = UpdateError("authorization_cancelled", "沒有取得系統授權，未安裝更新。")
                self.set("downloaded")
                done(False)
                return
            if result.returncode != 0:
                tail = (result.stderr or result.stdout or "").strip().splitlines()[-1:] or [""]
                self.error = UpdateError("install_failed", "安裝沒有完成：" + tail[0][:200])
                self.set("downloaded")
                done(False)
                return
            done(True)
        return self.start(work)

    @staticmethod
    def digest(path):
        digest = hashlib.sha256()
        with open(path, "rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def clean(self, keep):
        if not self.folder.is_dir():
            return
        for file in self.folder.iterdir():
            if file != keep:
                try:
                    file.unlink()
                except OSError:
                    pass
