# App icon platform requirements

Primary documentation checked: 2026-11-13. This is evidence and its limits for the icon candidates in
[assets/brand](../../assets/brand/README.md). It does not choose a concept; the final icon is still an open
identity item in [ADR-069](../decisions/069-pin-it-anywhere-product-identity.md).

## Apple

- [HIG: App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons) (changed 2026-10-28):
  iOS, iPadOS and macOS accept a non-layered bitmap or a layered Icon Composer file and recommend Icon Composer. The
  system generates the appearances an app does not provide: default, dark, clear light/dark and tinted light/dark.
  Backgrounds must be full-bleed and opaque, without a pre-applied mask, shadow, bevel or glow.
- [Creating your app icon using Icon Composer](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer):
  layer canvas 1024 (1088 for watchOS), SVG preferred, at most four groups, no mask, blur, shadow, specular or
  gradients baked into layer files. Adding a `.icon` file replaces the asset-catalog icon, and Xcode builds bitmap
  fallbacks for older systems from it according to the minimum deployment target. Apple does not publish the
  `icon.json` schema; the keys used here were read from Xcode 27.2's own Icon Composer template and framework strings.
- [Configuring your app icon](https://developer.apple.com/documentation/xcode/configuring-your-app-icon): the asset
  catalog route still works; iOS can generate every size from one 1024 image, macOS needs each size. Dark icons use a
  transparent background and tinted icons a greyscale image.
- [Xcode 27 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes):
  Icon Composer 2.0 adds a sharper rendering mode for the 2027 systems and previews both design generations.
- [App Store Connect: add an app icon](https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon/):
  the store icon comes from the build; there is no separate upload.
- [HIG: The menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar) gives a 24 pt bar
  and black-and-clear icons; [NSImage.isTemplate](https://developer.apple.com/documentation/appkit/nsimage/istemplate)
  defines template images. Neither page gives a status-item image size; 16 pt is this project's choice.

## Android and Google Play

- [Adaptive icons](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive): 108 dp foreground and
  background layers, a 66 dp safe zone, logo between 48 and 66 dp, no mask or shadow in the layers, and an optional
  monochrome layer for themed icons on Android 13+. This project's `minSdk` is 28, so no legacy launcher bitmaps are needed.
- [Play icon design specifications](https://developer.android.com/distribute/google-play/resources/icon-design-specifications):
  512 x 512 32-bit PNG, sRGB, at most 1024 KB, supplied as a full square; Play applies the 30% radius mask and shadow.
- [Play listing assets](https://support.google.com/googleplay/android-developer/answer/9866151): the 1024 x 500 feature
  graphic (JPEG or 24-bit PNG, no alpha) is required.
- [Developer page](https://support.google.com/googleplay/android-developer/answer/9873827): optional; a 512 x 512
  developer icon and a 4096 x 2304 header without alpha. This is the only store surface found for a publisher logo.
- [OAuth branding](https://support.google.com/cloud/answer/15549049): app logo up to 1 MB, 120 x 120 recommended;
  changing it can trigger verification. That logo is the app icon, not a publisher mark.

## Microsoft

- [App icon construction](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction):
  scale variants 100-400 (100, 200 and 400 at minimum), AppList target sizes 16-256 each with `_altform-unplated` and
  `_altform-lightunplated` files to avoid a backplate, StoreLogo required, and a medium tile still required by the
  Store. ICO bare minimum 16, 24, 32, 48 and 256; tray sizes 16-64 across 100-400% scale.
- [App icon design](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-design): 48 px grid,
  unplated icons recommended, at least half the icon at 3:1 contrast on both light and dark themes. The two pages
  disagree on whether theme variants are required; the candidates ship all three names.
- [VisualElements](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-uap-visualelements),
  [DefaultTile](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-uap-defaulttile) and
  [SplashScreen](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-uap-splashscreen):
  Square44x44 and Square150x150 are required; wide, small and large tiles and the splash screen are optional.
- [MSIX Store images](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images):
  one screenshot required; a 300 x 300 tile icon is strongly recommended; 1:1 box art and 2:3 poster art are described
  for games. No light/dark guidance for notification-area icons was found.

## Linux

- [Icon Theme Specification](https://specifications.freedesktop.org/icon-theme/latest/): at least a 48 x 48 PNG in
  `hicolor`, SVG under `scalable`; no standard full size set.
- [GNOME integration](https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html) and
  [themed icons](https://developer.gnome.org/documentation/tutorials/themed-icons.html): a scalable SVG or 256 px PNG
  named by application ID, and an optional `<appid>-symbolic.svg`.
- [GNOME UI icons](https://developer.gnome.org/hig/guidelines/ui-icons.html): symbolic icons are 16 x 16 and recoloured
  by the system; the candidates therefore use filled shapes only, since a recolour through `fill` would flood strokes.

## Local verification and limits

- Xcode 27.2 `actool` compiled each candidate's `.icon` for iOS 16 and macOS 13, and the asset-catalog route for both,
  without warnings. Icon Composer's bundled `ictool` rendered all six iOS appearances and macOS default/dark.
- Not verified: installation on devices, Android launcher masks other than browser-simulated circle and squircle,
  Windows Start/taskbar and tray rendering, GNOME and labwc panels, and store-console upload validation.
