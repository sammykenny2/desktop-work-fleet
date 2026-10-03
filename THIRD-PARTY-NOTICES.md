# Third-party notices

Updated: 2026-10-03.

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
