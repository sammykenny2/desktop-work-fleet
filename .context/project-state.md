# Project State

Updated: 2026-10-03.

## Current focus

The user's latest direction is architecture design before more macOS desktop tests
or multi-window implementation. The product blueprint and ADR-003 are Proposed;
they do not select the final framework or replace the working prototype.

Version 0.1.0 exists: Swift/AppKit and WebKit on macOS, a native ES-module web
editor, and a Python standard-library SQLite service. Its scope and validation
limits are recorded in ADR-002 and the validation report.

Quick capture and visible unfinished work remain the primary need.
Agent orchestration is deferred.

## Entry points

- docs/README.md: document inventory.
- PROGRESS.md: authoritative execution status and known Windows restore failure.
- docs/architecture.md: implemented architecture and proposed direction.
- docs/resreach/2026-10-03-product-architecture-blueprint.md: detailed design.
- docs/decisions/003-product-architecture-boundaries.md: Proposed boundaries.
- docs/validation/2026-10-03-validation-report.md: existing macOS evidence.
- docs/resreach/README.md: dated research; spelling is intentional.

## Unresolved choices

The production UI framework, client sharing strategy, server runtime, detailed
sync wire format and final platform support matrix remain undecided.
ADR-002 selects the validation runtime only.

## Roles

No Conductor or implementation team is assigned. Follow the active user-authorized task.
