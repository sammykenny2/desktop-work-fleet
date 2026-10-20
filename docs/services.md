# Services and Ports

Updated: 2026-10-05.

The validation service defaults to `127.0.0.1:9847`, configurable with `--host` / `--port`. The editor page and the API
share one origin. If the port is taken at startup, the service fails at once and does not stop other services. Tests use
a random port assigned by the OS. The available port registry of the project skeleton template was read; the external
registry was not modified.

The macOS app has only the network.client entitlement and no listener.
On a LAN you must use `--cert`, `--key` and `--origin https://host:port`; the phone needs to trust the certificate and
be able to reach that host. The QR code itself provides no NAT traversal; access from outside needs your own trusted
HTTPS deployment or a VPN. Bonjour and UDP discovery are not enabled.

## 1.0 UI development preview

After `npm run build`, you can run `python scripts/testing/serve_preview.py --port 0`.
It serves the static `build/app` assets on loopback only; by default the OS picks a free port, and the terminal shows
the actual URL. `--port` sets a test port; if it is taken, startup fails without stopping other listeners.
This is not a note API or an authoritative data server; the UI saves data through local IndexedDB transactions.
The native apps package these local assets and do not depend on this development listener.

The Windows 1.0 main window loads `https://work-fleet.invalid/app/index.html` through WebView2 virtual host mapping.
That name resolves to the packaged Assets only inside WebView2; there is no DNS, no TCP/HTTP listener and no new port.
Native SQLite / DPAPI is reached through the WebMessage bridge; there is no local note server.

## Windows Debug WebView inspection

Only in the Debug configuration, and only when the launching process has `WORK_FLEET_WEBVIEW_DEBUG_PORT`, does WebView2
open a CDP port on loopback. The developer chooses the port (1024–65535); there is no fixed default. Release and MSIX
builds do not compile this path.
If the port is taken, WebView2 provides no CDP and does not stop other listeners. Test probes use a free port assigned
by the OS.
Loopback does not separate Windows users: any process on the machine can use this port to read the decrypted notes and
call the native bridge. Open it only while inspecting; see [ADR-032](decisions/032-windows-debug-webview-inspection.md).

## Windows Google sign-in callback

During sign-in a TcpListener binds `127.0.0.1:0`, with a free port assigned by the OS, on the path `/oauth2/callback`.
Only a code that matches the random state of that sign-in is accepted; the PKCE verifier stays in the native service.
The listener closes on completion, cancellation or a 110-second timeout.
Each connection is handled on its own, at most 16 at once, and each must send its request within 5 seconds.
The browser may first open an empty preliminary connection (Chrome keeps one to fetch the favicon); when it times out
or disconnects, it closes only itself and does not end the sign-in.
`host.log` records each sign-in's result, port, the time the callback arrived and the number of connections, but not the
code, token or account.
This listener serves no note API, binds no LAN address, uses no fixed port and does not change the external port
registry. Google HTTPS token, userinfo and Drive requests are all sent by the native side; the renderer holds no
credentials and no arbitrary HTTP capability.
The account chip's name and photo come from Drive's `about.user` (`google.profile`), which the app data scope covers;
the page asks after a sync reaches Google, and waits ten minutes after a failed read.
Each host fetches the photo itself from a pinned `lh3`-`lh6.googleusercontent.com` HTTPS address, without the access
token or redirects, at most 128 KiB and only when its bytes are a PNG, JPEG, GIF or WebP image; it reaches the page as
bytes shown from a `blob:` URL, since the page loads nothing from the network.

## Linux native host and Google callback

Linux GTK / WebKitGTK serves the packaged assets through the secure custom scheme `workfleet://app`; there is no resident
HTTP listener. Only during Google sign-in is `127.0.0.1:0` used, with the fixed path `/oauth2/callback`; PKCE and state
stay native, and the listener closes after completion, cancellation or a 110-second timeout. No fixed port, LAN listener
or change to an external registry is added.
