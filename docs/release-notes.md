# Release Notes

One entry per version, newest first, written in the commit that bumps the version.
Entries describe what changed for users and operators. They never record whether or when a build reached users;
that record is the GitHub Releases `windows-v<version>`, `linux-v<version>`, `macos-v<version>`, `ios-v<version>` and
`android-v<version>` and their workflow runs.
`Platforms` lists the platforms whose version files carry the number and that were meant for distribution.
`Summary` is one plain line for the in-app update prompt.

## 0.3.5

Platforms: Windows, Linux, macOS, Android.

Summary: Search is back at the end of the top bar, Adjust sits at the foot of the sidebar, Versions and conflicts moves into Settings, and the sidebar shows your Google name and photo.

- Search returns to the right end of the top bar, with Capture beside it; the view bar holds only the filters and the views. Phones keep the magnifier and the floating button.
- "Adjust: This group | All" moves to the foot of the sidebar, where This group is the group selected above it; in a narrow window it is in the drawer. While the browser preview's canvas is being adjusted, search waits until Done.
- "Versions and conflicts" is now a Settings page. While anything needs attention, the status bar shows the number of conflicts and opens that page; the sidebar entry and the drawer button's dot for conflicts are gone. Sync waits while the page is open.
- Signed in with Google, the sidebar and the Account page show the account's name and photo, and the email address appears when you hover over the account. They are read with the existing Drive permission and kept in memory only; the privacy notice describes this.
- The sidebar's group list is called "All groups", so it no longer shares a name with the "My group" setting.
- Completed notes stay off the desktop unless this computer turns on "Show completed notes" in Settings > Desktop. Computers that never changed the setting now hide them as well, and "Reset desktop layout" turns it off again.
- Note, sync and backup formats stay at V1.

## 0.3.4

Platforms: Windows, Linux, macOS, Android.

Summary: The main window is easier to read: Capture sits in the top bar, search sits with the filters and views, and arranging tools appear in their own bar only while you adjust notes.

- Capture moves from the sidebar to the top bar and adds to the group you are viewing; the sidebar now only lists places. Phones keep the floating button.
- Search moves next to the filters and views. When a window is too narrow, view names and labels shorten first, then search moves up to the top bar.
- "Adjust: This group | All" replaces the old toolbar. While you adjust, a dark bar like the desktop overlay covers the view bar with what is being adjusted, "Bring to front" (the old arrows, now labelled), Stack, Spread, Undo and Done.
- The status line no longer shows a Locked light; the sync status keeps the only light.
- In the browser preview, adjusting from the board or list switches to the Desktop canvas.
- Note, sync and backup formats stay at V1.

## 0.3.3

Platforms: Windows, Linux, macOS, Android.

Summary: Reorder groups in the sidebar and choose each group's color on this device. Desktop groups show their layers, new groups start on the back layer, completed notes can be hidden, and moving a note to Deleted offers Undo.

- Groups: drag a sidebar group or use Alt+Up/Down to change this device's order. Group pickers follow that order, including conflict repair. On computers, a short message lists region shortcuts whose groups changed after a reorder.
- Group settings offer nine paper colors per device. Choosing a color another group uses swaps the two; colors do not sync or change when groups are reordered.
- The desktop sidebar marks this device's My group with a star and shows each group's resting layer, including a tooltip for an unsupported layer's fallback. Phones ignore My group settings carried over by a restored layout.
- New groups created on a computer or first received there from sync start on its back layer: the wallpaper layer when available, otherwise the default desktop layer. Reset desktop layout also moves every group to the back layer.
- Settings > Desktop > Show completed notes can hide completed papers from this computer's desktop without changing their status or other devices.
- Moving a note to Deleted offers Undo in the status line. Permanent deletion remains outside this version.
- iOS device builds and installation stay local; public GitHub workflows no longer build or upload iOS packages containing registered device identifiers.
- Note, sync and backup formats stay at V1.

## 0.3.2

Platforms: Windows, Linux, macOS, iOS, Android.

Summary: Saving a group's settings without changing its name, for example to set only this device's layer, no longer creates a group change that syncs to your other devices and can show up there as a version conflict.

- Group settings: Save with the name unchanged records nothing shared. Changing only the desktop layer stays on this device, and it also works while the group has an unresolved conflict.
- Before this version every such save added a new version of the group that synced to all devices, and two devices saving the same group close together produced a conflict. Devices still on an older version keep doing this until they update.
- Conflicts that already exist stay until you choose a version under "Versions and conflicts" on one device. Let the other devices sync before you change that group elsewhere.
- macOS: the release build retries Apple's stapling step when the connection to the notary service drops.
- Note, sync and backup formats stay at V1.

## 0.3.1

Platforms: Windows, Linux, macOS, iOS, Android.

Summary: Work Fleet is now designed in English and also comes in Traditional Chinese: pick a language in Settings > General > Display language or let it follow the device. Notes gain an optional title, fixed papers end long text with "…", and attachments sit in a row under the text.

- English is the main UI language, with a complete Traditional Chinese translation. Settings > General > Display language offers Auto-detect (the default, which follows the device's language), English and Traditional Chinese. The window switches at once, and the tray, menu bar and the app's own dialogs follow the same choice.
- Notes can have an optional title, which search, the drafts list and shared text include. A note shows its text from the first line again.
- Papers that cannot scroll (the board, the wallpaper layer and papers you are not adjusting) end text that does not fit with "…"; papers that scroll keep their full text.
- Attachments appear as a row of thumbnails under the text; those that do not fit are hidden. Double-click still opens a read-only copy.
- Desktop notes use the main window's group colours, and a new square note shrinks to fit a short group region.
- Google sync: after a reset or on a new account, workspace initialization is explicit and resumable. Several devices joining at once no longer create duplicate default groups, and the other devices wait until the device that reset finishes.
- Android and iOS: the first previews on GitHub, including the 0.3.0 board and list views, square notes, attachment thumbnails, H1–H6 headings and code colouring. The APK is signed with the project's test key; the IPA installs only on the devices registered for development. Note, sync and backup formats stay at V1.
- The release text on GitHub and in the in-app update prompt is now in English.

## 0.3.0

Platforms: Windows, Linux, macOS.

Summary: The main window can show notes as a board or a list, and new notes are square. Attachments show system thumbnails and open as a read-only copy on double-click; Markdown gains H1 to H6 sizes and code colouring.

- The main window switches between a board of paper tiles and a list; each device remembers the choice.
- New notes are 240×240 squares. The title band and the body no longer show the title twice.
- Attachments show a system thumbnail or file icon with the file name. Double-click opens a read-only copy in the default app; changes made there are not saved back.
- Markdown has six heading sizes (H1–H6) and colours fenced code that names its language. Long notes keep their full text, and the colouring work is capped.
- Ticking checklist items directly on the desktop is planned for 0.3.x and is not in this version. Note, sync and backup formats stay at V1.
- Cancelling Google sign-in brings back editing, sync and automatic backups for the current workspace.
- Windows and Linux: a start at sign-in that should stay hidden waits for a late tray icon instead of showing the main window.
- Windows: keeps the bundled .NET 10.0.13 runtime and the WPF display-loss fix. The automatic reopen after a crash stays off. Other Windows 11 versions still need checking.
- Linux: thumbnails and the file types that open depend on the installed thumbnailers and default apps. The tray tooltip reads "Work Fleet", and `host.log` in the data folder records each start and tray change.
- Linux: keyring handling is unchanged since 0.2.5. Notes open without a keyring password; a locked keyring pauses only sync and encrypted backups, and "Sync now" offers the system unlock dialog.
- macOS: thumbnails come from Quick Look and system file icons. Google sign-in no longer signs out first, so cancelling keeps the existing session.

## 0.2.8

Platforms: Windows.

Summary: Windows now bundles .NET 10.0.13 with the WPF fix for a display that disappears; three local reboots did not crash. The adjust toolbar now appears as soon as adjust mode starts.

- Windows: bundles .NET 10.0.13, which includes the WPF fix for a lost display. Three local reboots did not crash. Removing the built-in primary display in the first minute after start, and other Windows 11 versions, are not yet re-tested.
- Windows: the floating Stack, Spread, Undo and Done toolbar shows as soon as adjust mode starts. Composition input, unsaved drafts and a minimized main window stay protected.
- Windows: the one-time automatic reopen after a crash stays off.
- Other platforms stay at 0.2.7.

## 0.2.7

Platforms: Windows, Linux, macOS.

Summary: Group regions now follow the current primary display. After a laptop screen turns off, the region frame, stacking and spreading no longer stay on the old, smaller area.

- Group regions are laid out on the current primary display's work area at startup and after every display change. Papers do not move because of it.
- Fixes the dashed region frame, stacking and spreading staying on a smaller display's area after a laptop's built-in screen turns off and only a larger external display remains.

## 0.2.6

Platforms: Windows.

Summary: Crashes after display changes at sign-in should become less likely: the desktop and wallpaper layers now draw in software, using about 130 MB more memory per 4K display.

- Windows: scenes attached to Explorer (desktop and wallpaper layers) render in software. This may reduce crashes when displays change after sign-in, at about 130 MB more working set per 4K display.
- Windows: `host.log` records every lid report and the inputs behind the sign-in display wait.

## 0.2.5

Platforms: Windows, Linux, macOS.

Summary: Switching accounts or closing the app during a sync no longer lets the old operation update the new view. On Linux, Sync now can open the system keyring unlock dialog.

- Switching accounts or closing the app during a sync no longer lets results from the old source update the new view.
- Linux: "Sync now" with a locked keyring opens the system unlock dialog and, on success, continues syncing the same account. Cancel or timeout can be retried. Startup and background syncs never prompt.
- Linux: switching accounts, going local, signing out or closing cancels a pending unlock.

## 0.2.4

Platforms: Windows, Linux, macOS.

Summary: Google sign-out now affects only this device, and update checks use the public release feed instead of the rate-limited GitHub API. On Linux, notes open without a keyring password.

- Sign-out removes this device's Google credentials only. It no longer revokes the grant, which had signed out every other device on the account.
- Update checks read the public `releases.atom` feed. The unauthenticated GitHub REST API and its shared hourly quota are no longer used.
- Linux: notes start without a keyring password. The local storage key lives in the data folder with owner-only permissions.
- Linux: Google tokens and saved automatic-backup passwords stay in the Secret Service. A locked keyring pauses only sync and encrypted backups. Migrating older data the first time needs the original keyring unlocked once.
- macOS: "Open Work Fleet at login" can be turned on the first time; a login item the system had never seen was treated as an install error.
- macOS: Drive uploads accept the literal commas Google returns in resumable upload URLs, which fixes the "invalid resumable location" error.

## 0.2.3

Platforms: Windows, Linux, macOS.

Summary: At sign-in, Windows waits for displays to settle before attaching desktop scenes, and the macOS app starts again after 0.2.2 exited at launch.

- Windows: at sign-in, desktop scenes attach to Explorer only after the displays settle: while the lid is closed but the built-in display is still on, then 5 s without changes, at most 3 minutes.
- Windows: the one-time hidden reopen after a sign-in crash is off, so every crash stays visible.
- macOS: the app finds the bundled Sparkle framework again, which fixes 0.2.2 exiting at launch. 0.2.2 cannot update itself; install the 0.2.3 DMG by hand.
- Linux: no Linux changes; the version follows the shared number.

## 0.2.2

Platforms: Windows, Linux, macOS.

Summary: First macOS preview, signed with Developer ID and notarized. Windows records display changes in host.log and no longer misses the Google sign-in callback when the browser holds an idle spare connection.

- macOS: first GitHub preview, as a Developer ID signed and notarized DMG plus a Sparkle update ZIP.
- macOS: known issue: the app exits at launch because it cannot find the Sparkle framework. Fixed in 0.2.3.
- Windows: `host.log` records the display list at start, on each change, when applying a new layout and when displays cannot be read.
- Windows: the Google sign-in callback serves each browser connection on its own, so an idle spare connection from the browser no longer blocks sign-in.
- Linux: no Linux changes since 0.2.0; an installed 0.2.0 DEB can update in the app.

## 0.2.1

Platforms: Windows.

Summary: On a fatal error, desktop scenes leave Explorer before Windows writes its report, so Explorer is not held up, and the error is written to host.log.

- Windows: on a fatal error, scenes hosted inside Explorer are detached first; then the error with every HRESULT layer goes to `host.log` and Windows Error Reporting.
- Windows: a render-thread failure during a start at sign-in reopens the app once, hidden. This was turned off again in 0.2.3.
- Windows: an installed 0.2.0 can update to this version in the app.

## 0.2.0

Platforms: Windows, Linux.

Summary: First version with in-app updates. The main window remembers its place, startup behaviour can be set, and backups gain a full local restore and a Google overwrite restore.

- All platforms share one version number from this version on.
- In-app updates from GitHub Releases: Windows installs the MSIX; Linux installs the DEB through pkexec. An installed Windows 0.1.2 has no updater, so install 0.2.0 by hand.
- The main window remembers its size and position. Settings add start at sign-in, open the main window at sign-in, and keep running in the tray when the window closes. A second launch brings back the running instance.
- Backups add "clear local data, then restore" and "clear Google, then restore" with resumable stages. Exporting a Google workspace syncs first.
- Adjust mode dims the desktop with an overlay and a floating toolbar on every desktop host. A main window that was minimized stays minimized.
- Windows: packages bundle the .NET 8 Desktop runtime. The MSIX keeps data in the package's private folder, and uninstalling deletes it.
- Linux: first GitHub DEB. GNOME Wayland can switch to XWayland for desktop papers, GNOME Xorg gets all three layers, labwc shortcuts are written to rc.xml, desktops run by pcmanfm drop the wallpaper layer, and the launcher prefers the system Python.

## 0.1.2

Platforms: Windows.

Summary: Installs on Windows 11 from build 22000, including 23H2, and fixes papers snapping back during a fast drag.

- Windows: the MSIX installs on Windows 11 build 22000 and later (previously 24H2 and later). Windows 10 stays excluded.
- Windows: a fast drag on the topmost layer no longer snaps back; the drop waits for the latest geometry.
- Windows: desktop and wallpaper papers hide their old surface before moving, to stop white blocks at old positions after stacking or spreading. The original cause was not reproduced.
- Windows: a scene setting that 23H2 rejects was reverted, and windowed WebView backgrounds are opaque again.
- Windows: the package depends on the installed .NET 8 Desktop Runtime.

## 0.1.1

Platforms: Windows.

Summary: Notes appear in creation order, oldest first, on every device.

- Notes sort by creation time on every device. New notes store `createdAt`; older notes without it sort first by ID, so their order changes once.
- Windows: still requires Windows 11 24H2 or later.

## 0.1.0

Platforms: Windows.

Summary: First Windows preview on GitHub Releases, with Google sign-in and Drive sync, desktop layers per group and a single settings window.

- Windows: first preview built and signed by CI. Requires Windows 11 24H2 or later and a trusted preview certificate.
- Google sign-in with a Desktop client and Drive app-data sync, including resumable uploads for large attachments.
- Desktop layers (wallpaper, desktop, topmost) belong to groups. Ctrl+Shift+1 to 9 step the group in a desktop region through the layers and adjust mode, with an on-screen notice.
- Papers on the desktop and wallpaper layers have rounded corners and draw correctly on the first start.
- One settings window for account and sync, data and backup, desktop and shortcuts, with "reset all data" and "reset desktop layout".
- Closing the main window keeps Work Fleet in the tray; the tray, taskbar and executable use the paper icon.
- Desktop icons stay clickable while Work Fleet runs.
