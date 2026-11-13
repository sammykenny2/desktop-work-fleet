# ADR-069: Pin It Anywhere product identity

## Status

Accepted, 2026-11-13. These are the final naming choices; applying them to the repository, applications and external
accounts is separate work under [SPEC-013](../specs/013-product-identity-and-distribution.md) and
[PLAN-014](../plans/014-product-identity-and-distribution.md). This record does not claim that any identifier is reserved
or that the running app has been renamed.

## Context

The product captures one small thing on a compact paper that can be placed around the desktop. It offers a little more
structure than a plain note, while staying lighter than a task or project manager. Local notes and Google Drive notes
are the current sources. Compact presentation is the default, not a new restriction on rich text, attachments or note
length. Todo / In Progress / Done describes a possible lightweight workflow; a distinct In Progress state and
Linear, Plane or Trello integrations are future design candidates, not delivered features or an approved integration plan.

The first store launch needs a stable public name and application identity before OAuth clients, signing profiles and
store records are created. The old Work Fleet identifiers still exist in source and installed test applications.

## Decision

### Final names

| Surface | Decided value |
|---|---|
| Product display name in English and other locales by default | `Pin It Anywhere` |
| Traditional Chinese product display name (`zh-TW`) | `貓亂貼` |
| GitHub repository name, under `sammykenny2` | `pin-it-anywhere` |
| Google Cloud project display name and desired project ID | `pin-it-anywhere` |
| macOS and iOS main application Bundle ID | `dev.sammykenny2.pinitanywhere` |
| Android application ID | `dev.sammykenny2.pinitanywhere` |
| iOS Share Extension Bundle ID | `dev.sammykenny2.pinitanywhere.share` |
| Apple App Group | `group.dev.sammykenny2.pinitanywhere` |
| Personal domain selected for the product family | `sammykenny2.dev` |

The maintainer requires exactly three simple English words for repository names, joined with hyphens. Bundle and
Android application IDs use the dot-separated reverse-domain convention above, with no hyphens. A Java/Kotlin source
namespace, assembly name, environment-variable prefix or internal Swift type is not automatically a public app ID;
rename those only when needed by the implementation.

Future personal products follow the same Traditional Chinese family rule: three characters, starting with the cat
character U+8C93 and followed by two playful characters. The independent `cats-inc` ecosystem is outside this rule.
Localized display names may change later without changing permanent application identifiers.

### App icon (2026-11-13)

The maintainer chose **Cat Note** from three candidates drawn in this repository. It is a cream note with cat ears, a
coral pin for its nose, on a teal gradient. It follows the Traditional Chinese name and the cat-led family rule, and it
stays recognisable at 16 px and as a one-colour menu-bar or tray glyph. Paper Pin (one tilted paper on ink blue) and
Scatter (two papers on amber) were not selected; their sources stay in `assets/brand/concepts/` for reference.

- The layered SVG in `assets/brand/concepts/cat-note/` is the source. `node scripts/render-brand-assets.mjs --concept
  cat-note --install` renders it with Playwright at design time and replaces the committed bitmaps each native project
  reads. Packaging only copies those files and never needs a browser.
- Apple uses asset catalogs: one 1024 px iOS image with dark and tinted appearances, and macOS 16-1024 px. The Icon
  Composer `.icon` document is not wired in: the last Apple CI build (2026-10-20) used the `macos-15` image's default
  Xcode 16.4, which predates Icon Composer. Adopt it once the Apple builds use Xcode 26 or later. The macOS menu bar shows the template glyph `StatusItem` instead of the
  `note.text` SF Symbol.
- Android uses an adaptive icon of bitmap layers, including the monochrome layer for themed icons.
- Windows embeds the 16-256 px icon in the executable; its windows and notification-area icon reuse it. The MSIX
  names three unqualified scale-100 images because the package has no `resources.pri`; scale and target-size variants
  wait for a PRI step. The rendered monochrome notification-area icons are not used.
- Linux installs a hicolor theme (16-512 px, scalable and symbolic) under the app ID. The window uses the flat 256 px
  file. The tray names the app ID with the bundle's `Icons/` as its theme path, so a panel may pick a sized theme file
  or that flat file; which one has not been seen on a real panel.
- The sammykenny2.dev publisher marks are optional; no store or app uses them.

### Identity and authorization boundaries

- Renaming a repository, Cloud project display name or OAuth branding is different from replacing an OAuth client.
  A display-only rename with the same clients and scopes does not by itself require invalidating existing tokens.
  Branding changes may require Google's verification process; validate the actual configuration before cutover.
- A Google Cloud project ID cannot be renamed. The chosen ID therefore requires a new project if the current ID is
  different. Check global availability before creation; do not silently choose a different suffix.
- New OAuth clients require a fresh sign-in. Treat the new project as a separate application-data boundary: do not
  assume it can read the previous application's Drive appDataFolder. Export complete backups while the old clients
  still work, verify old/new access with a test account, and restore deliberately into the new application.
- New Bundle IDs, Android application IDs, App Groups or Windows package identities can create separate installations
  and storage/security namespaces. Do not claim an in-place upgrade or access to old Keychain, encrypted data or share
  inboxes without platform evidence. Preserve the old app and its credentials until backup and restore are verified.
- Re-register the Apple app/extension IDs and App Group and regenerate their provisioning profiles. A changed Bundle ID
  alone does not require replacing a valid signing certificate for the same Apple team. Google OAuth redirect schemes
  and Android fingerprints must come from the actual new clients and distribution signatures.

### Remaining identity work

The Windows Package Identity Name, Publisher and PublisherDisplayName must be reconciled with the issued Certum
certificate and any future Partner Center reservation. They are not inferred from the Apple/Android ID.
Linux package/desktop IDs, release asset and updater metadata names, deep links, store SKU, public support contact and
privacy/support URL paths remain implementation choices to settle together. Suggestions such as a
`support@` mailbox are not configured services or confirmed names.

## Consequences

### Positive

- Public product names and permanent mobile/Apple IDs have one authoritative table.
- The English name describes placing a small note without limiting future lightweight sources.

### Negative

- Changing installed test identities and Google projects requires deliberate backup, sign-in and restore acceptance.
- A name decision does not establish domain control, trademark clearance or availability of a Cloud/store identifier.

### Neutral

- Historical documentation and published assets keep their original names; runtime and public-facing changes follow
  the implementation plan rather than a repository-wide text replacement.

## Alternatives Considered

- `One More Note` and `post-it-here`: not selected; the maintainer chose a different identity after discussing naming
  confusion and existing brands. This is a naming decision, not a legal clearance finding.
- `pin-it-here`, `pin-it-there`, `pin-it-everyhere` and `pin-it-near`: not selected; the chosen name better expresses
  freely placing papers and satisfies the three-word repository rule.
- Keeping the old Cloud project ID while only changing its display name: avoids a client cutover, but does not meet
  the chosen project-ID target.

## References

- [Dated primary-source evidence and limits](../research/2026-11-13-product-identity-and-distribution-boundaries.md).
- [Distribution policy](070-release-channels-and-architecture.md), [Requirements](../requirements.md).
- [Google Cloud project identifiers](https://cloud.google.com/resource-manager/docs/creating-managing-projects).
- [Google OAuth branding](https://support.google.com/cloud/answer/15549049).
- [Google Drive application data](https://developers.google.com/workspace/drive/api/guides/appdata).

---

*Decision made: 2026-11-13*
*Decision maker: Project maintainer*
