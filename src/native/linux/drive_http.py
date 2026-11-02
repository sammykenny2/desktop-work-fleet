"""Account-owned HTTPS connections for Drive; no redirects or automatic write retries."""
from http.client import HTTPSConnection, HTTPException
import socket
import threading
import time
from urllib.parse import urlsplit
from urllib.request import getproxies, proxy_bypass

import protocol as p


class DriveHTTP:
    def __init__(self, fallback):
        self.fallback = fallback
        self.lock = threading.Lock()
        self.idle = []
        self.active = set()
        self.closed = False

    def request(self, url, method="GET", data=None, headers=None, maximum=2 * 1024 * 1024):
        uri = urlsplit(url)
        p.require(uri.scheme == "https" and uri.hostname == "www.googleapis.com" and uri.port in (None, 443)
                  and uri.username is None and uri.password is None and not uri.fragment,
                  "invalid-source", "The Google transfer address isn't valid.")
        with self.lock:
            p.require(not self.closed, "stale-session", "The Google session has ended.")
        # Keep the existing urllib proxy routing/authentication. Never silently bypass a configured proxy.
        if getproxies().get("https") and not proxy_bypass(uri.hostname):
            return self.fallback(url, method, data, headers, maximum)
        with self.lock:
            p.require(not self.closed, "stale-session", "The Google session has ended.")
            connection = self.idle.pop() if self.idle else HTTPSConnection(uri.hostname, timeout=30)
            self.active.add(connection)
        reusable = False
        try:
            deadline = time.monotonic() + 110
            active_socket = connection.sock
            if active_socket is not None:
                active_socket.settimeout(30)
            connection.request(method, uri.path + ("?" + uri.query if uri.query else ""), body=data, headers=headers or {})
            with connection.getresponse() as response:
                length = response.getheader("Content-Length")
                p.require(length is None or length.isdigit() and int(length) <= maximum,
                          "source-capacity", "Google's response is too large.")
                chunks, size = [], 0
                while True:
                    p.require(not self.closed, "stale-session", "The Google session has ended.")
                    remaining = deadline - time.monotonic()
                    p.require(remaining > 0, "network", "The Google transfer timed out; content waiting to upload is kept.")
                    active_socket = connection.sock
                    if active_socket is not None:
                        active_socket.settimeout(min(30, remaining))
                    chunk = response.read1(min(65536, maximum + 1 - size))
                    if not chunk:
                        break
                    chunks.append(chunk); size += len(chunk)
                    p.require(size <= maximum, "source-capacity", "Google's response is too large.")
                p.require(response.length in (None, 0), "network", "Google didn't return a complete response.")
                reusable = not response.will_close
                return response.status, b"".join(chunks), response.headers
        except p.Failure:
            raise
        except (OSError, HTTPException) as error:
            # A server may close an idle socket. Retire it and let the existing sync retry policy decide;
            # this layer cannot know whether a failed POST/PUT has already committed remotely.
            raise p.Failure("network", "Can't connect to Google; local data and content waiting to upload are kept.") from error
        finally:
            with self.lock:
                self.active.discard(connection)
                if reusable and not self.closed and len(self.idle) < 4:
                    self.idle.append(connection)
                else:
                    connection.close()

    def close(self):
        with self.lock:
            self.closed = True
            connections = self.idle + list(self.active)
            self.idle = []
        for connection in connections:
            # Wake a blocked read before retiring the socket. Headers/buffers belong to that request alone.
            active_socket = connection.sock
            if active_socket is not None:
                try:
                    active_socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            connection.close()
