# SPEC-007: V1 data policy during the testing phase

## Metadata

| Field | Value |
|---|---|
| Status | Implemented, revised 2026-10-17 |
| Owner | Project maintainer |
| Reviewer | Independent review results are in the git history |

## Summary

Until store launch is formally planned, all current note, sync and backup JSON schemas stay at V1, and fields are
changed directly in V1.

## Requirements

- Workspace, Layout, revision, Drive metadata, the ZIP manifest, the encryption envelope and the automatic backup
  journal are all marked V1.
- Keep the version constants, basic format recognition and the rejection of unknown formats; current field changes are
  not treated as the start of a version upgrade.
- Loading and everyday editing add no schema upgrade commits, migration copies or extra native APIs.
- Keep normal CAS, drafts, history, attachments, account isolation and the existing backup and restore; user data is
  never deleted automatically.
- When a Windows Store, Apple App Store or Google Play launch is formally planned, format freezing and migrations are
  evaluated then.

## Design Overview

`core/schema.js` only gathers the current V1 constants and basic version validation; the existing Workspace loads
directly and saves with ordinary transactions.
Local and Google workspaces still use the same V1 backup format. Internal SQLite table versions and app package version
numbers are not part of this public schema policy change.

## References

[ADR-051](../decisions/051-schema-evolution-and-atomic-migrations.md), [PLAN-007](../plans/007-schema-evolution-and-migrations.md), [PROGRESS](../../PROGRESS.md).
