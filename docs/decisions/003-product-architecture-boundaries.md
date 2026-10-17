# ADR-003: Work data, sync and platform boundaries for the production product

> 2026-10-04: this ADR stays Deferred. The Note container / Item split below is a historical proposal and does
> not govern the confirmed one card per thing; for the new product semantics see
> [ADR-006](006-card-group-and-formation-semantics.md). Adopting the old proposal in the future also requires
> re-alignment first.

## Status

Deferred, 2026-10-03. The original Proposed content is kept as the later design for a full PM / self-hosted server.
The user switched to a Google account plus file-based notes as the 1.0 MVP; see
[ADR-004](004-google-drive-notes-mvp.md).
This document is no longer required architecture for 1.0, and it does not replace ADR-002's historical record of
the 0.1.0 validation version.

## Context

The prototype already has the basic flows for capturing data, editing, contention and recovery.
Today a Note carries the full text, status and to-dos at once, and the platform windows also handle networking
directly; extending it straight to multiple notes would carry the validation model into the production product.
The user wants the architecture done well first, keeping the backlog and quick capture first.

## Decision

Proposed:

- A Note is a container; an Item is a text or work item with a stable ID, and only tasks have the three work
  states.
- Project / Environment are optional; Views reference the same data; DeviceLayout is separate from shared content.
- A modular monolith server stores committed authoritative data; each client keeps unsynced operations in a local
  store/outbox.
- The server starts with local SQLite plus a versioned API; files are for import and export.
- Per-record conditional updates, atomic operation receipts, cursors and epochs support sync and recovery.
- The app carries its own UI and client features; platform adapters handle OS capabilities, and all desktop
  windows share one client state.
- Finish the schema, sync and technology choices first, then connect multiple windows and platform integration
  acceptance.

For the full invariants, trade-offs and prototype migration strategy, see the
[production architecture draft](../research/2026-10-03-product-architecture-blueprint.md).

## Consequences

### Positive

Tasks can appear consistently across notes, lists and boards; special desktop capabilities do not affect data
correctness; phones and the web have independent, usable editing and sync entry points.

### Negative

More contracts and local transaction design are needed than in the prototype; migration of v0.1 data and drafts
must be designed.
How much code the clients share, and its maintenance cost, still depends on the technology choice.

### Neutral

The simple Todo / In Progress / Done UX is kept; no agent execution workflow is added.
Framework, server language, wire format and minimum OS versions are not settled by this proposal.

## Alternatives Considered

### Extend the current whole-note model directly

Fewer changes, but it cannot cleanly support independent to-do states, different views and item-level conflicts,
so it is not recommended as the production model.

### Sync files directly between machines as the authority

Portable, but it needs extra design for multiple writers, deletion, ordering and semantic conflicts;
this proposal recommends a single server first, while keeping exported data portable.

### Microservices or full real-time CRDT editing

Adds deployment and data coordination work; a personal backlog does not have enough need to justify the cost
today, so it is deferred.

## References

- [ADR-001](001-independent-backlog-first-foundation.md)
- [ADR-002](002-validation-runtime.md)
- [Production architecture draft](../research/2026-10-03-product-architecture-blueprint.md)
