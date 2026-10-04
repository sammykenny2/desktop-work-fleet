# Third-party notices

Updated: 2026-10-04.

## project-bootstrap

- Source: [sammykenny2/project-bootstrap](https://github.com/sammykenny2/project-bootstrap).
- Revision used: a7438cf81d44519db89d2783dc14b7cfc9e0e851.
- Composition: templates/base via the minimal preset.
- Scope: shared agent instructions, agent-specific template files, documentation scaffolds, configuration defaults, and maintenance helper scripts.
- Source license: MIT.
- Original copyright line supplied by that checkout: Copyright (c) 2025.
- The original line and complete MIT permission/disclaimer text are retained in [LICENSE](LICENSE). The new project adds a separate notice for its original contributions.

Project-specific research and documentation were written for desktop-work-fleet. External references in the research are citations, not bundled product code.

No product code, images, fonts, dependency lockfiles, platform modules, or user data were imported from another sticky-note application.

## 1.0 renderer under development

The repository's package-lock.json pins the following packages. `npm run build`
copies only the two runtime ESM modules into `build/app/vendor`, retaining their
copyright headers and complete upstream LICENSE files. No fonts, images, CDN
scripts, browser binaries or application assets from another product are bundled.

| Package | Version | Purpose | License / source |
|---|---|---|---|
| marked | 18.0.14 | Runtime Markdown parsing | MIT; [MarkedJS](https://github.com/markedjs/marked) |
| dompurify | 3.4.16 | Runtime DOM sanitization | Apache-2.0 option of its Apache-2.0 OR MPL-2.0 license; [Cure53](https://github.com/cure53/DOMPurify) |
| @types/trusted-types | 2.0.7 | DOMPurify type dependency, not bundled | MIT; [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/trusted-types) |
| @playwright/test, playwright, playwright-core | 1.63.0 | Development browser tests, not bundled | Apache-2.0; [Microsoft Playwright](https://github.com/microsoft/playwright) |

Marked copyright: (c) 2018+, MarkedJS; (c) 2011–2018, Christopher Jeffrey.
DOMPurify copyright: Cure53 and other contributors. The source ESM files are copied
without modification; application configuration is separate. The build includes
`marked-LICENSE.txt`, `dompurify-LICENSE.txt` and this notice. Platform packages must
retain those files and the project's LICENSE. Final native SDK and store-package
inventories remain separate release work.

## Validation version 0.1.0

No third-party pip/npm runtime packages, fonts, images, prior application code or assets
are bundled. QR generation uses Apple's system CoreImage API; no external QR library is copied.
The original implementation is covered by this repository's MIT license.

- Python 3.14.7 (minimum 3.12) is an external requirement, not bundled. Its
  [PSF license and incorporated software notices](https://docs.python.org/3/license.html)
  remain with the user's Python distribution.
- SQLite 3.51.0 is used through Python's standard library; it is
  [public domain](https://www.sqlite.org/copyright.html), not copied into the app.
- Swift 6.3.3 is a build tool. The app dynamically links the system Swift runtime;
  [Apache 2.0 and the Swift runtime exception](https://www.swift.org/LICENSE.txt) apply
  to Swift components. No Swift runtime libraries are bundled in this app.
- AppKit, Foundation, WebKit, CoreImage, CoreGraphics, CFNetwork and supporting Apple
  frameworks are dynamically loaded from macOS, under Apple's platform SDK/runtime terms.
  Framework binaries and SDK headers are not redistributed.
- Node 24.21.0 is used only for tests; it is not shipped. Its
  [license includes MIT and incorporated-component notices](https://github.com/nodejs/node/blob/v24.21.0/LICENSE).

The app Resources directory retains this notice and the root LICENSE. The exact tested
versions and scope are recorded in [runtime inventory](docs/validation/runtime-inventory.json).
This is an inventory of the delivered source and locally built Mac app; it is not an
approval or license audit for future store packages or unselected frameworks.
