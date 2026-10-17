# ADR-002: Native macOS display and a single SQLite source for the validation version

## Status

Accepted, 2026-10-03; the scope is the working validation version the user authorized for this round.

## Context

We first need evidence from a real Mac on the Sandbox and public APIs, and then to validate write contention and
recovery.
This machine has Swift 6.3.3 and Python 3.14.7 and no production signing identity. There is no product code yet.

## Decision

- macOS uses the public system frameworks Swift AppKit, Foundation, WebKit and CoreImage.
  It is an ad-hoc signed App Sandbox app that only makes outgoing connections; the three window levels can be compared.
- A Python 3.12+ standard-library HTTP service with SQLite is the validation version's source of truth; there are
  no pip/npm runtime dependencies.
- The native desktop reads JSON; unlocking opens the WebKit editor in the same window.
  The same native HTML/CSS/JavaScript editor also serves desktop and phone browsers.
- A per-record revision, a database-wide epoch, per-device operation IDs and SQLite transactions handle
  contention, retries and delete tombstones. Drafts are saved locally first; reading offline and manual resend are
  supported.
- Pairing uses a 5-minute one-time invitation that is exchanged for a revocable token with a role; CoreImage
  generates the QR code.
- Backup uses the SQLite online backup; restore goes to a new path, changes the epoch and revokes every old device.
- By default the service listens only on loopback; non-loopback requires a TLS certificate and an exact public
  origin.

## Consequences

### Positive

It can be reproduced without installing runtime packages; the licensing surface is smaller, and platform and data
reliability can be validated independently.

### Negative

The Python standard-library service is meant only for personal validation; no load or security audit for the
public network has been done.
WebKit storage is separate from Safari's. There is no automatic offline merge; on a conflict the user chooses which
copy to keep.

### Neutral

React, Rust Axum and Tauri remain candidates; this decision does not claim that Windows, Linux, phone packaging or
store approval is done.
System SDKs are not copied into the repo; Python and SQLite are external runtime requirements and are not
distributed with the app.

## Alternatives Considered

React + Axum + Tauri: workable, but adds tools and license trees to the first validation; the HTTP contract is kept
so that it can be swapped later.
Plain localStorage: cannot validate shared authoritative data or multi-device contention, so it was not adopted.

## References

- [Handoff plan](../plans/001-validation-version-macos-handoff.md)
- [Apple window API](https://developer.apple.com/documentation/appkit/nswindow)
- [Python license](https://docs.python.org/3/license.html)
- [SQLite public domain](https://www.sqlite.org/copyright.html)
- [Swift license / runtime exception](https://www.swift.org/LICENSE.txt)
