# Codex-Specific Instructions

Read `AGENTS.md` first and `docs/AGENT-GUIDE.md` next. Only Codex maintains this
file; other agents should ignore it.

- Prefer `rg` for text search.
- Preserve user edits and respect `.editorconfig`.
- Use the project's verified commands in `docs/testing.md` and its manifests.
- Follow an assigned Conductor. Do not substitute author-run tests for independent
  code review.
- Record status as AGENTS.md "Status, History and Release Notes" describes: the commit
  body is the per-change record; never append session entries to PROGRESS.md, and
  never make or offer a status or release-result commit after a version bump. Fixing
  a defect that a release run reveals is ordinary work (AGENTS.md "Development Workflow").
- Write code, comments, commit messages and documentation in English (AGENTS.md
  "Language"), even when replying to the user in another language.
- For `dyu`, reply exactly “I am Codex, and I understand.” after reading both files.

## Skills

The canonical source is `skills/`. Codex discovers `.agents/skills/<name>/SKILL.md`.
After skill changes, run `scripts/windows/Sync-AgentSkills.ps1`; keep referenced
resources inside the skill directory so sync preserves them. Optional skills and
scripts are documented in `skills/README.md`; do not assume they are installed.

## Project Context

No additional Codex-specific constraints are currently required. Shared project facts live in AGENTS.md and the documentation index.
