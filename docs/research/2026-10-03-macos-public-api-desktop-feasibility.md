# macOS public API desktop display feasibility research

- Date: 2026-10-03
- Status: static research of official APIs and inferences; no macOS results on real hardware for this project yet.
- Question: without private APIs, can the app receive data, show it read-only near the desktop, and stay unclickable by the mouse?
- Release premise: the goal includes the Mac App Store, so App Sandbox and review limits must be taken into account.

## 1. Current conclusion and confidence

There is a reasonable public API path to validate. Mouse click-through, window focus, window level and a transparent WebView background are separate problems that can be handled one by one.

The minimum candidate is "opaque note cards + public AppKit window APIs + receiving data in the background". A card can show a solid background while still letting mouse events pass through.

There is currently not enough evidence to claim that this project works reliably on every macOS version, every Spaces setup or every desktop configuration, and it has not passed App Store review. In particular, the details of sitting above the wallpaper and below the Finder icons need validation on real hardware.

## 2. Official API evidence

| Capability | Public API / documentation | Conclusion it can support |
|---|---|---|
| Mouse click-through | NSWindow.ignoresMouseEvents | A window can be made transparent to mouse events |
| Not becoming the keyboard target | NSWindow.canBecomeKey | Decides whether a window can become the key window |
| Window level | NSWindow.level, CGWindowLevelKey | The public desktop and desktop-icon levels can be studied |
| Collection behaviour such as Spaces | NSWindow.collectionBehavior | There is a public control point; real combinations still need testing |
| Sandbox network connections | network.client entitlement | Can connect out to a server on this machine or another machine |

Sources: [mouse events](https://developer.apple.com/documentation/appkit/nswindow/ignoresmouseevents), [key window](https://developer.apple.com/documentation/appkit/nswindow/canbecomekey), [NSWindow](https://developer.apple.com/documentation/appkit/nswindow), [window levels](https://developer.apple.com/documentation/coregraphics/cgwindowlevelkey), [desktop icon level](https://developer.apple.com/documentation/coregraphics/cgwindowlevelkey/desktopiconwindow), [network client](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.client).

These documents prove the APIs are public entry points; "fits our desktop experience" is a question for later combination testing.

## 3. Two meanings of transparent

### Input transparency

Clicks are not accepted by the note, so the user operates the desktop or other windows underneath. The public ignoresMouseEvents is the main entry point to study.

### Visual transparency

Seeing the wallpaper behind the card background, or showing rounded corners, translucency and blur. This does not necessarily depend on event click-through.

Tauri's transparent WebView window has a private API restriction on macOS; the official configuration documentation explicitly warns about its App Store compatibility and mentions a public API path for windowEffects. This does not mean every transparent AppKit window or every visual effect needs private APIs. [Tauri config](https://v2.tauri.app/reference/config/)

The first probe uses solid-colour cards, which keeps non-essential visual effects out of the desktop-layer and input validation. This is not a constraint on the final appearance.

## 4. Assessment by layer

| Goal | Initial judgement | Main unknowns |
|---|---|---|
| Read-only data in a normal window | Usable as a baseline | Data updates and focus |
| Behind normal apps, above desktop icons | A public API combination worth validating first | Finder rearrangement, Show Desktop, Spaces |
| Above the wallpaper, below the icons | A candidate capability, with weaker evidence than the previous one | Ordering within the same level, the system wallpaper window and version differences |
| Mouse click-through | A direct public API exists | Whether framework wrappers reset the state |
| Not stealing keyboard focus | Public APIs can support it | Whether the app activates on launch, update and re-show |
| Switching between locked and in-place editing | Can be designed as distinct interaction modes | Focus and draft handling when locking again |
| All desktop features fully consistent | Cannot be guaranteed yet | Multiple displays, Stage Manager, full screen and OS versions |

Do not treat a fixed number or a single successful orderBack as a reliable wallpaper-layer solution. Judge by the values of the public standard levels and evidence of the actual ordering.

## 5. Minimum validation version with public APIs

A candidate experimental directory for a separate macOS spike can be created in this repo; the directory name and implementation are not decided. This session only records the plan and produces no app code.

Recommendation: first validate the platform itself with a small AppKit prototype, covering:

- A simple editing/control entry point.
- One solid-colour, read-only display card.
- While locked: ignore the mouse, never become the key window, never activate on its own.
- Compare the level results of a normal window, above desktop icons and below the icons.
- Update the text through a controllable data source, without stealing focus on update.
- Run in a configuration with App Sandbox enabled.

If Tauri or another framework is chosen later, an integration validation for that framework version is needed. A successful AppKit probe does not mean a particular WebView wrapper succeeds.

## 6. Sandbox and networking

Mac App Store distribution requires App Sandbox. [Apple App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)

If the app itself opens HTTPS or other TCP connections to receive data, network.client is the relevant entitlement; once a TCP connection is established, data can flow both ways, so "receiving server updates" must not be read as requiring an inbound listener. [Apple network entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.client)

If UDP discovery, Bonjour or a locally listening server is used, the actual permissions and privacy behaviour must be checked separately. Do not add broad permissions early just because the data source is a local server.

## 7. Validation items if implemented with Tauri

These are candidate checks; they do not mean Tauri has been chosen:

- Whether no Cargo feature source enables macos-private-api, including target-specific dependencies.
- Whether the config turns off the related private API options.
- Whether window creation still requests transparent behaviour that depends on private APIs.
- Whether the packages used enable the same capability indirectly through other features.
- Whether the native window adapter keeps the input, focus and level settings.
- Whether the release artifacts, entitlements and sandbox behaviour match expectations.

Changing one JSON boolean is not evidence that private APIs have been fully excluded.

## 8. Real-hardware tests that must be recorded

| Scenario | Observation |
|---|---|
| Click icons and empty desktop covered by a note | Whether the target underneath receives the event correctly |
| Desktop marquee selection, dragging icons, dropping files | Whether the note intercepts, gets moved or has text selected |
| Data update arrives while typing in the editor | Whether text focus is kept |
| Opening and closing normal apps and Finder windows | Whether the card stays at its intended level |
| Show Desktop, Mission Control, Spaces | Whether showing/hiding and recovery behave as expected |
| Stage Manager, full-screen apps | Whether it covers work content, or disappears and cannot be recovered |
| Multiple displays, different scaling, plugging/unplugging displays | Whether position and size recover sensibly |
| Sleep/wake, network loss, server recovery | Old content stays readable and the sync status is clear |
| Unlock/edit/lock | Draft kept; input click-through and focus restored correctly |
| Sandbox release configuration | Whether results match the development configuration |

Record the OS, hardware, displays, app build, entitlements, steps and results; failures must be kept too. Every item in this table is currently untested.

## 9. Success and fallback conditions

Minimum platform success: receive updates, show unfinished content, mouse click-through, no keyboard focus stealing, and no private APIs.

If the wallpaper layer is unstable, first validate whether the above-desktop-icons approach still meets the user's needs. Unsupported features must be listed explicitly, not hidden behind "cross-platform". App Store submittability and the actual review result are recorded separately.
