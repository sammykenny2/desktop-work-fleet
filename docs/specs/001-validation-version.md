# SPEC-001: Backlog validation version

## Metadata

| Field | Value |
|---|---|
| Status | Implemented with validation limits |
| Owner | Project maintainer |
| Reviewer | Independent review recorded in validation report |

## Summary

Validate persistence and shared data with quick text capture and Todo/In Progress/Done,
and validate desktop presentation through public APIs with a real sandboxed macOS app.

## Goals

- Text alone is enough to save; Inbox by default, with to-do checkboxes, complete/restore and delete/restore.
- A phone or a second browser and the native Mac use the same authoritative SQLite service.
- revision, operation and epoch protect against races, retries and recovery; no silent automatic overwrite.
- Drafts are saved locally first, then sent; after a 409 or a network failure they can be recovered or saved as a copy.
- While desktop presentation is locked, it accepts no input but keeps updating; the menu bar entry unlocks and relocks
  it at any time.
- Short-lived one-time pairing, read-only permission, device revocation, reproducible backup and restore.

## Non-Goals

This round introduces no agent scheduling, estimation or assignment, and claims no cross-platform desktop or store
approval.

## Requirements

Every concern in the handoff plan must keep a result row in the validation report, marked passed, failed/blocked or not
yet tested.
Data and signing secrets stay outside the repo; real private notes are not used for testing.

## Design Overview

Native AppKit presentation + WebKit editing, a shared editor in HTML/ES modules, and an authoritative Python/SQLite API.

## Dependencies

System AppKit/Foundation/WebKit/CoreImage and SQLite from the Python standard library; no new third-party runtime
packages.

## Open Questions

- UX, reachability and iOS local network behaviour of real phones and LAN TLS.
- Manual observation of Spaces, Show Desktop, multiple displays and gesture click-through.
- Per-device highlighting of content, several independent desktop note windows, and presentation with larger data
  volumes.

## References

- [Plan](../plans/001-validation-version-macos-handoff.md)
- [ADR-002](../decisions/002-validation-runtime.md)
- [Validation report](../validation/2026-10-03-validation-report.md)
