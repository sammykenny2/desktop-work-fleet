# Brand icons

Icon candidates for Pin It Anywhere and publisher marks for sammykenny2.dev. All artwork is drawn in this repository
(SVG shapes and constructed monoline letters, no fonts, photos or third-party art). No concept is wired into the native
projects yet: the shipped apps still use the generated paper icon from `scripts/apple-icons.mjs`, and the final icon
remains an open item in [ADR-069](../../docs/decisions/069-pin-it-anywhere-product-identity.md). Platform rules and
their sources are in [App icon platform requirements](../../docs/research/2026-11-13-app-icon-platform-requirements.md).

## Concepts

- `paper-pin`: one tilted paper held by a round pin, on ink blue. The plainest reading of the English name.
- `cat-note`: a paper with cat ears and a pin for a nose, on teal. Follows the Traditional Chinese name and the
  cat-led naming rule for the product family.
- `scatter`: two papers at different angles, the front one pinned, on amber. "Anywhere" rather than "pin".

All three share the cream paper and the coral pin, so the tray glyph and accents stay consistent whichever is chosen.

## Layer files

Each `concepts/<id>/` directory holds:

- `concept.json`: name, background gradient, dark backdrop and palette, and per-platform scale and offset.
- `background.svg`: 1024 full-bleed backplate.
- `foreground.svg`: 1024 transparent motif. Every top-level `<g id>` is a layer, back to front, and becomes one
  Icon Composer group. Groups marked `data-legacy="true"` are shadows drawn only into pre-rendered bitmaps.
  Groups must not nest other `<g>` elements.
- `monochrome.svg`: one-colour silhouette for Android themed icons and the tinted appearance.
- `small.svg`: a 32-unit drawing simplified by hand for 16-32 px, with edges on even units.
- `tray.svg`: a 32-unit (16 pt at 2x) black glyph of filled shapes for the macOS menu bar, the Windows notification
  area and the GNOME symbolic icon.

## Rendering

`node scripts/render-brand-assets.mjs` writes every concept and the publisher marks to the Git-ignored `build/brand/`.
It needs `npm ci` for Playwright. `.icns` files and the Liquid Glass previews also need macOS with Xcode 26 or later.
It is a design-time tool. After a concept is chosen, its outputs are committed where each native project reads them,
so packaging never needs a browser.

Per concept the output contains:

- `apple/AppIcon.icon`: the Icon Composer document, the preferred route. Xcode builds bitmap fallbacks for macOS 13
  and iOS 16 from it. `apple/previews/` holds Apple's own renders of each appearance.
- `apple/ios/AppIcon.appiconset` with the 1024 light, dark and tinted images, plus `apple/macos/AppIcon.appiconset`
  and `AppIcon.icns`: the asset-catalog route.
- `apple/macos/StatusItem.imageset`: a vector template image for the menu bar, plus 1x and 2x PNGs.
- `android/res`: the adaptive icon with background, foreground and monochrome layers at every density. Pre-rendered
  layers are used for now; they can become vector drawables when the icon is wired in.
- `windows/AppIcon.ico` (16-256 px), and `windows/Assets` with the MSIX tiles at scale 100-400, the target sizes 16-256
  and both unplated alternates. Two monochrome notification-area icons: `tray-light-theme.ico` and `tray-dark-theme.ico`.
- `linux/hicolor`: 16-512 px bitmaps, a scalable SVG and `<app-id>-symbolic.svg`.
- `store/`:
  - App Store: the 1024 marketing icon.
  - Google Play: the 512 icon and the 1024 x 500 feature graphic.
  - Microsoft Store: the 300 tile, box art and poster art.
  - These are opaque files without an alpha channel.
- `sources/`: the composed SVG behind each output.

## Publisher marks (sammykenny2.dev)

`scripts/brand-company.mjs` constructs the SK2 monogram and the `sammykenny2.dev` wordmark from strokes. No store
requires a publisher logo. These marks are for the optional Google Play developer page (512 icon and 4096 x 2304
header), the site favicon and touch icons, and account avatars. The cat-eared badge is an alternative that ties the
publisher to the cat-led product family.
