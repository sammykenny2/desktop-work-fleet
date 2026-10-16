# Agent Guide

Read root `AGENTS.md` and your own agent file first. Customize this guide with
project-specific procedures that are too detailed for always-loaded instructions.

## Project Context

Start with docs/README.md and docs/handoff/2026-10-04-desktop-interaction-handoff.md.
SPEC-003 and ADR-006 contain the latest card/group/formation/gesture requirements.
Follow confirmed U requirements and delegated D defaults; ask only about Q items
needed for the current implementation. Do not reopen the confirmed floating-layer
or gesture choices. ADR-007 is a technical proposal, not an adopted framework.
The executable validation runtime remains ADR-002; PROGRESS.md is execution status.
For targeted external desktop behavior research, ask the maintainer for the reference
project location only when required. Do not guess paths or copy its implementation.
Older Drive/backup drafts require scope reconciliation before freezing contracts.
Pre-store testing keeps all current note/sync/backup JSON schemas at V1. Change V1
directly without automatic schema upgrades or migration snapshots; revisit the
upgrade policy when store-launch planning starts, as required by root AGENTS.

## Workflows

- Features: consult requirements and architecture; use existing SPEC/PLAN templates
  for complex approved work. Implement, add tests, and update affected docs.
- Bugs: reproduce, identify the cause, fix when authorized, and add regression
  coverage. A diagnosis-only request does not authorize implementation.
- Documentation: use `update-docs` if installed. Otherwise map the change to the
  existing document inventory in `docs/README.md`, update targeted sections,
  check links and examples, and report omissions.
- Tests: use `run-tests` if installed; otherwise read `docs/testing.md` and the
  actual manifest/CI commands. Do not infer pytest solely from a Python filename.
- Review: use `review-code` if installed and you did not author the code. Review
  read-only and report actionable findings with evidence.
- Scripts: use `docs/SCRIPT-STANDARDS.md` for help and naming examples.
- Research: record dated primary sources in `docs/research/` when conclusions
  depend on changing external APIs or protocols.
- Releases: finish all tracked changes and local check records before the final
  version-bump commit/push. Follow [deployment](deployment.md) and root AGENTS:
  dispatch closes repository writes for that release task. Afterwards, monitor,
  verify ignored artifacts and report in the conversation; do not make a status,
  documentation or handoff commit. New repository work requires a new explicit user task.

## Optional Protocol Integrations

A coding-agent skill is not an A2A Agent Card skill, and local agent instructions
are not wire protocol configuration. Consult `docs/terminology.md` first.

When A2A examples are installed, read `docs/a2a/README.md`. Select public versus
authenticated cards deliberately; advertise only implemented capabilities. Validate
the selected protocol revision and actual transport/auth behavior separately.
MCP host configurations belong to that host, not to A2A discovery metadata.

## Services and Ports

Consult `docs/services.md` before assigning a port. If the bootstrap checkout and
its `docs/port-registry.md` are available, check cross-project usage as well.
Choose a configurable port, warn about conflicts, update this project's service
documentation, and obtain permission before changing an external central registry.

## Branch Maintenance

Remote deletion after a squash merge does not remove local branches; ancestry alone
may not identify squash-merged work. Use the shipped merged-branch cleanup helper
only when cleanup is requested:

```powershell
.\scripts\windows\Remove-MergedBranches.ps1 -WhatIf
```

```bash
./scripts/linux/remove-merged-branches.sh --dry-run
```

The macOS copy provides the same interface. Helpers stop on dirty worktrees, skip
other worktrees and never remove the default branch or never-pushed branches.
Read their help before execution. `-ReturnToDefault` / `--return-to-default`
also switches to and fast-forwards the default branch, but only leaves a branch
whose upstream is gone: on an unmerged branch or a detached HEAD it stays and
warns, and a failed fast-forward is reported as a warning. Do not change global
Git settings as an implicit step; use repository-scoped or explicit user choices.

## Handoff

Report the affected behavior, commands actually tested, independent-review status,
documentation updates, and any remaining blockers. Update progress/status only
within the role ownership rules in `AGENTS.md`. Never label placeholder tests or
unrun deployment/runtime checks as passing.
After release dispatch, deliver this handoff in the conversation and use GitHub's
run/release as the publication record; do not update tracked handoff or progress files.
