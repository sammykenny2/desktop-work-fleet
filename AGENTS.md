# AGENTS.md

> Shared coding-agent instructions. Customize project facts, not protocol claims.

## Reading Order and Scope

1. Read this file and confirm understanding, then read only your own agent file
   (`CLAUDE.md`, `GEMINI.md`, or `CODEX.md`).
2. Consult `docs/AGENT-GUIDE.md` and any relevant skill before task work.
3. Never edit another agent's specific instruction file.
4. These local conventions do not override host safety rules or higher-priority
   instructions. MUST means required; SHOULD means recommended. Explicit user
   workflow choices can override defaults such as branch and PR policy.

## Project Metadata

- Type: single-project
- Purpose: Backlog-first work notes with cross-device sync and optional desktop presentation.
- Entry points: README.md, docs/README.md, src/server/work_fleet.py, src/macos/main.swift.
- Stack and versions: Validation version uses Swift/AppKit, WebKit, native ES modules and Python 3.12+ standard-library SQLite; see ADR-002 and the runtime inventory.
- Test commands: `python3 -m unittest discover -s tests -p 'test_*.py' -v`, `node --test tests/drafts.test.js`; macOS build/probe commands are in docs/testing.md.
- Subprojects: none declared; nested AGENTS.md files provide scoped instructions
  and do not by themselves prove a monorepo architecture.

## Product and Research Boundaries

- Read docs/README.md, docs/requirements.md, and the current handoff at
  docs/handoff/2026-10-04-desktop-interaction-handoff.md before designing behavior.
  SPEC-003 is the desktop interaction contract: U requirements, delegated D defaults,
  and explicit Q questions. Quick capture and unfinished work remain the primary use.
- Do not infer plaintext-only, no-checklist, or restricted backup scope from earlier
  drafts. ADR-006 supersedes conflicting card/container and interaction assumptions.
- A separate desktop-interaction reference project may be useful for targeted native
  behavior research. Ask the maintainer for its current readable location when needed;
  do not guess a sibling path, scan the whole filesystem, or hardcode its name/path.
  Continue independent contract work while waiting. Reference behavior and failure
  evidence, not its UI/code/assets/schema. Genuine reuse still needs provenance/license records.
- Agent orchestration and execution status machines are deferred, not default UI.
- Research lives in docs/research/. Use dated
  lowercase kebab-case filenames and distinguish evidence, proposals and decisions.
- Record status as described in "Status, History and Release Notes" below. Do not
  create a competing task list or status file.
- Build this product independently. Do not bulk-port another application's code,
  UI, assets or data contracts. Any targeted future reuse needs source/license notes.
- Validation runtime choices are recorded in ADR-002; broader platform packaging remains open. Generic A2A/MCP bootstrap
  material does not imply those protocols are part of the product.

## Status, History and Release Notes

Write each fact once, in the smallest durable place that owns it, and in the same
commit as the change it describes. Nothing is recorded after the fact.

- **Git history is the change log.** Every commit uses a Conventional Commit subject
  and a body that states what changed and why, the checks that ran with their
  results (or which could not run), and whether an independent review happened.
  That body replaces any per-session log entry.
- **PROGRESS.md is a short current-state snapshot**: status by area, verified and
  unverified boundaries, open items. Edit it only when a change alters that
  project-level truth, in the same commit, by rewriting the affected lines rather
  than appending. Never add session narratives, test counts, artifact paths, sizes
  or hashes, commit SHAs, review notes, or release and publication status.
  Rebuilds and repackaging do not touch it; report their results in the conversation.
- **Owning documents**: decisions in ADRs; behaviour and acceptance in SPECs; the
  Status field and task checkboxes of an approved PLAN, updated with the work;
  verification procedures and unverified boundaries in `docs/testing.md`; packaging
  and release procedure in `docs/deployment.md`; platform caveats in the platform
  README under `src/native/<platform>/`.
- **`docs/release-notes.md`** gets one entry per version, written only in the
  version-bump commit, summarizing the commits since the previous version. Feature
  commits do not add entries and there is no "Unreleased" section. Follow the entry
  format at the top of that file; the release workflows read the entry, and
  `tests/release-notes.test.js` fails while a recorded version has no entry.
  Entries must stay true after publication: no "prepared", "published" or
  "released" wording, run IDs, hashes, or the bump commit's own SHA.
- **No bookkeeping after a release.** Once the version-bump commit is pushed, nothing
  about the release is recorded in tracked files: no "prepared", "published" or
  "released" status, run links, artifact hashes or store status in PROGRESS.md, plans,
  docs or release notes. The GitHub Release, the workflow run and the final report in
  the conversation hold them. Such commits add nothing, and every agent pushing at the
  same time then has to merge and re-run CI. Fixing a defect is not bookkeeping; see
  "Development Workflow". ROADMAP.md orders future work; it is not a status record.

## Language

- English is the repository language: code, identifiers, comments, log and error
  messages, scripts, workflows, commit messages, documentation and agent files.
- Chinese may appear in code only where the code must recognise, store or test
  Chinese text (locale matching, CJK handling tests, persisted protocol values),
  with an English comment saying why. `tests/i18n.test.js` lists those places and
  fails on Chinese anywhere else outside the zh-TW catalogs and Chinese editions.
- User-visible text comes only from the locale catalogs in `src/i18n/locales/` and
  the small native string tables described in `docs/i18n.md`, never inline in code.
  Write the English text first; every key must exist in every supported locale
  (`en`, `zh-TW`). Native hosts send English error messages with stable codes.
- A document whose name ends in `_ZH` or carries `.zh-TW` before the extension (for
  example `README.zh-TW.md`) is a Chinese edition. Only user-facing guides keep one.
  Change the English document and its Chinese edition in the same commit; every
  other document is English only.
- Replying to the user in their preferred language does not change the repository
  language.

## Task Routing

| Need | Reference |
|------|-----------|
| Setup and commands | `docs/setup-guide.md`, `docs/testing.md` |
| Using the app | `docs/user-guide.md` (Chinese edition `docs/user-guide.zh-TW.md`) |
| UI text, locales and the CJK guard | `docs/i18n.md` |
| Current status and release history | `PROGRESS.md`, `docs/release-notes.md` |
| Architecture and decisions | `docs/architecture.md`, `docs/decisions/` |
| Feature planning | `docs/specs/`, `docs/plans/` |
| Document inventory | `docs/README.md` |
| Script help and naming | `docs/SCRIPT-STANDARDS.md` |
| Services / ports | `docs/services.md` |
| Security | `docs/security-guidelines.md` |
| Optional reusable workflows | `skills/README.md` |
| Optional A2A / MCP integration | `docs/a2a/README.md`, `docs/mcp-config.md` |

## Change and Safety Rules

- Preserve user edits. Do not discard, delete, publish, or stage unrelated work
  without authorization. Never commit credentials or modify out-of-scope files.
- Update related tests and docs in the same session/commit. Keep examples consistent
  with actual behavior; placeholders are not completed implementation.
- Read relevant ADRs before architecture decisions and record new decisions using
  `docs/decisions/000-template.md`. Use SPEC/PLAN templates for approved complex work.
- Resolve destructive targets exactly and preview operations. On a violated
  requirement, stop the affected operation, disclose it and propose correction;
  obtain approval before corrective destructive work.
- Check `docs/services.md` before adding listeners and update it when ports change.
  If available, consult the bootstrap's cross-project port registry. Warn about
  conflicts and make ports configurable; do not modify an external registry
  without permission.

## Development Workflow

Before the first Windows Store, Apple App Store or Google Play submission is planned,
all current note, sync and backup JSON schemas stay at V1. Update V1 directly during
testing; do not introduce schema bumps, automatic upgrade jobs, migration snapshots
or compatibility maintenance for unreleased test formats. Revisit format freezing
and migrations when the maintainer starts store-launch planning. This does not
authorize deleting existing user data or changing published application versions.

The user has authorized direct Conventional Commit and push to origin/main for this
project. Do not create feature branches or PRs, and never force push. Preserve unrelated
changes. Plan, implement only the authorized scope, run appropriate checks, and record
independent-review status. Do not interpret a review request as permission to edit.

Ordinary implementation, commit and push requests do not authorize a version bump or
publication. Every version bump requires explicit user approval of the target version;
a preview-release request alone does not authorize choosing and bumping a version.
GitHub Actions dispatch also requires explicit user authorization. Honor approval
already given in the current session without asking again. The repository is public
since 2026-10-14: `ci.yml` runs the documented checks on every push to main and every
pull request; release workflows still run only when dispatched with authorization.
For an approved release, land implementation, tests and documentation in earlier
commits. The version-bump commit changes the approved version records (for Windows
the `<Version>` in `src/native/windows/Directory.Build.props`; see docs/deployment.md
for the others) and adds that version's `docs/release-notes.md` entry, nothing that
needs updating afterwards. Push it, verify a clean worktree and matching local/remote
main, then dispatch each platform's release workflow only with that authorization; it
creates the `<platform>-v<version>` tag and prerelease. Never reuse, move or delete a
published tag or release.

After dispatch, agents MUST NOT make, or offer, commits whose only purpose is to
record the release: status, handoff, release-result, artifact-hash or "published"
documentation updates. Monitor the runs, verify artifacts in Git-ignored directories
and report outcomes and links in the conversation. Standing commit/push permission
and ordinary documentation-sync rules do not authorize such bookkeeping.

Fixes remain ordinary work. When a release run fails, or reveals a defect in code,
scripts or workflows, agents MAY fix it in a normal commit with the usual checks and,
under the same release authorization, dispatch the failed platform again: a platform
publishes nothing until its workflow succeeds. A transient outside failure (for
example a dropped connection to Apple's notary service) may simply be re-run.
Re-dispatching builds the latest main, so first confirm that main holds no unrelated
commits since the version bump; otherwise ask the maintainer. A fix for a platform
whose release is already published ships in a new version, which needs approval.

Use the project's documented test command; confirm the manifest/CI configuration
when this template still contains placeholders. Report missing tests as missing,
not successful. New or changed behavior needs appropriate regression coverage.

## Project Roles

| Role | Assigned Agent | Responsibility |
|------|----------------|----------------|
| Conductor | Unassigned | Planning, assignment, status |
| Architect | Unassigned | Architecture and stack decisions |
| Security Specialist | Unassigned | Security review |
| UX Lead | Unassigned | UX decisions |
| Specialist | All others | Implementation, testing, documentation |

If assigned, the Conductor coordinates architecture and owns README Current Status.
Specialists acknowledge assignments, follow the agreed plan and do not change that
status section without approval. Otherwise work follows the authorized user task.

An agent MUST NOT review code it wrote itself. Author-run tests and mechanical
checks are allowed but are not independent review. Important changes SHOULD be
reviewed by a separate agent or human. Report when independent review is unavailable.
Do not add agent annotations in code or docs. Shared AGENTS changes require a
reason in the commit message. Handoffs state completed work, checks and remaining
work in the commit body and the conversation, not in a status log.

## Conventions and Skills

Honor `.editorconfig`. Use lowercase kebab-case directories, snake_case Python,
and the project's chosen JavaScript/TypeScript naming. PowerShell scripts use
`Verb-Noun.ps1` with comment-based help; Bash uses kebab-case, header help and
a `usage()` function. See `docs/SCRIPT-STANDARDS.md` for examples.

Canonical skills live in `skills/`; edit them there, not in discovery copies.
Run `scripts/windows/Sync-AgentSkills.ps1` after changes. See `skills/README.md`
for discovery paths and installed workflows. Do not assume optional skills exist.

Branch cleanup is an explicit maintenance task, never an automatic commit step.
Preview `scripts/windows/Remove-MergedBranches.ps1 -WhatIf` or the corresponding
Bash script's `--dry-run`; see `docs/AGENT-GUIDE.md` for details.

When cleaning up after a merge, remove the worktree you created for that work
before sweeping; the helper skips any branch a worktree still holds. Remove only
worktrees you created, since another may hold someone else's live work, and keep
one past its merge only when the user asks. While several agents share a clone,
keep the main checkout on the default branch and work in worktrees under the
repository's Git-ignored `.claude/worktrees/`, not sibling directories that
folder-wide tools such as bulk `git pull` scripts also scan.

## Command Aliases

| Alias | Required behavior |
|-------|-------------------|
| `dyu` | Read this file and own agent file, reply exactly “I am [Agent Name], and I understand.”, then await the next task |
| `cnp` | Check secrets and scope; `git add .`, Conventional Commit and push; resolve unsafe unrelated changes first |
| `umd` | Update documentation affected by recent changes; use `update-docs` if installed |
| `rlc` | Read-only review of the last commit; use an independent reviewer for your own code |

Aliases do not authorize force-pushes, destructive cleanup or additional external
actions. Report completion or a precise blocker.

These are project conventions using the [AGENTS.md](https://agents.md) format,
not AAIF certification or a claim of runtime protocol interoperability.
