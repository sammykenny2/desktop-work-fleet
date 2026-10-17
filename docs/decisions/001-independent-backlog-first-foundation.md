# ADR-001: Independent project with a backlog-first research foundation

## Status

Accepted, 2026-10-03. Acceptance covers only the direction the user has stated and this bootstrap; it does not
include candidate technology choices.

## Context

The user needs work notes that sync across devices, mainly as a place for the backlog and for quickly capturing
ideas. An earlier discussion widened into managing the execution of multiple agents; the user clarified that this
would add load to the main workflow.

The user asked for an independent new repo, built with the project skeleton template skill, with the research
recorded in detail under docs/research, and without copying large amounts of an existing app.

## Decision

- The repo is named desktop-work-fleet, in lower case with hyphens.
- Start with an independent architecture; there is no requirement to port an existing app's formats, UI or
  platform modules.
- Make the backlog and quick capture the product's focus, keeping simple defaults and room for future views.
- Keep the goal of publishing our own apps on Apple and Google stores, and the cross-device sync requirement.
- Use the project skeleton template's minimal skeleton for now; research documents live in docs/research.
- Do not choose a framework, backend or sync protocol now, and do not build a product prototype.

## Consequences

### Positive

The requirements have a written basis that can be handed over; early suggestions are clearly separated from the
user's decisions; UX, data reliability and platform limits can each be validated on their own.

### Negative

Building the product from scratch means platform, sync and distribution capabilities must be validated again; the
success of other apps cannot be cited as tests of this project.

### Neutral

Minimal provides document and collaboration templates but no app runtime. The MIT skeleton notices are kept, but
future third-party dependencies still need to be checked one by one.

## Alternatives Considered

### Continue an existing app's architecture

The user prefers to start from a new architecture, so this was not adopted.

### Build an agent execution workbench in the first version

This strays from the user's main use, the backlog and quick capture; evaluation is deferred.

### Commit now to a PM backend or a cross-platform framework

There is no evidence yet on UX, data reliability or store compatibility; this stays open.

## References

- [Backlog requirements](../research/2026-10-03-backlog-first-product-requirements.md)
- [Independent architecture and validation](../research/2026-10-03-independent-architecture-and-validation-plan.md)
- [Third-party sources](../../THIRD-PARTY-NOTICES.md)
