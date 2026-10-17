# ADR-056: English-first UI with locale catalogs

## Status

Accepted, 2026-10-17. The maintainer asked for the UI to be designed in English first, with English and Traditional
Chinese to start and a language setting that behaves like the one in the Cats apps.

## Context

The renderer, the native hosts and their tests hard-coded Traditional Chinese text. The repository is public, its
store listings target more than one language, and the maintainer decided that English is the repository language
(AGENTS.md, "Language"). Text appears in four places: the shared renderer, desktop scenes, the native hosts' own
tray, menus and dialogs, and errors that hosts send to the page.

The Cats desktop app is the reference for the setting: its Display language select offers Auto-detect, English and
Traditional Chinese, each named in the current UI language, and Auto-detect never names the language it resolved to.
Its tray ignores the user's choice and three different tables match system languages; this design avoids both.

## Decision

- English is the source and fallback locale; `zh-TW` is the second locale. The device setting is `auto`, `en` or
  `zh-TW`, default `auto`, stored with the host's device settings (never in profiles, backups or Google).
- One matching rule maps system languages to a locale (`docs/i18n.md`), implemented once in the renderer and
  repeated exactly in each host, so the tray at a sign-in start already matches the window that opens later.
- The renderer reads flat per-area catalogs (`src/i18n/locales/<locale>/<area>.js`) through `t()`, `plural()` and
  `formatDate()`. Static markup carries keys, not text. A language change redraws in place without a reload, and
  desktop scenes take the locale from each frame.
- Shared JavaScript localizes error messages when it throws; error codes stay stable identifiers.
- Hosts answer with English messages and stable codes; the bridge shows `nativeErrors.<code>` catalog text. Hosts
  keep one small two-locale table for text they draw themselves and for descriptive reasons they return.
- `host.info` reports `language: { preference, system }`; `host.language.set` stores a new preference and redraws the
  host's own UI.
- The shared initial group keeps its persisted Chinese name because devices hash it during initialization
  (ADR-053, ADR-054); the UI shows it under the localized default name.
- `tests/i18n.test.js` checks catalog parity, key usage, native error coverage, the native tables and that no other
  tracked file contains Chinese text.

## Consequences

### Positive

- One English source of truth for UI text and one checked catalog per locale; a new locale is a copy of the area
  files plus one rule.
- Host menus and dialogs follow the user's choice, not only the operating system.
- Detailed error messages keep their wording in both languages.

### Negative

- Hosts keep a second, small set of strings beside the renderer catalogs.
- Error codes shared by several host situations get one generic sentence per code.
- Messages already on screen keep their language until they next update after a switch.

### Neutral

- The frozen 0.1.0 prototype (`src/web`, `src/server`, `src/macos`) is English-only and outside the catalogs.

## Alternatives Considered

### Translate host errors in each host

- **Pros**: hosts could keep situation-specific wording.
- **Cons**: four copies of about a hundred messages in four languages and test setups.
- **Why rejected**: the bridge is one place that sees every host error.

### English messages in shared JavaScript, translated by code in the UI

- **Pros**: shared modules stay free of locale state.
- **Cons**: many codes cover several distinct messages, and about a hundred display sites show `error.message`.
- **Why rejected**: it loses wording or rewrites every display site.

### Reload the window on a language change

- **Pros**: no redraw logic.
- **Cons**: native hosts tie their sessions and scenes to the loaded page.
- **Why rejected**: in-place redraw is safer for open work.

## References

- [Internationalization guide](../i18n.md)
- [ADR-053](053-account-scoped-initial-group.md), [ADR-054](054-explicit-workspace-initialization.md)

---

*Decision made: 2026-10-17*
*Decision makers: maintainer*
