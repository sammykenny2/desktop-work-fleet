# Release Notes

One entry per version, newest first, written in the commit that bumps the version.
Entries describe what changed for users and operators. They never record whether or when a build reached users;
that record is the GitHub Release `v<version>`, which carries every platform, and its workflow run (up to 0.3.6, one
release per platform: `windows-v<version>`, `linux-v<version>`, `macos-v<version>`, `ios-v<version>` and
`android-v<version>`).
`Platforms` lists the platforms whose version files carry the number and that were meant for distribution; since
0.3.7 every release carries Windows, Linux, macOS and Android.
`Summary` is one plain line for the in-app update prompt.

## 0.4.3

Platforms: Windows, Linux, macOS, Android.

Summary: On Windows, notes on the Wallpaper layer no longer leave blocks behind where they were.

- Windows: when a note on the Wallpaper layer was moved, stacked or spread, hidden or closed, its old place kept the note's last pixels, because Explorer does not draw the wallpaper there again by itself. They were black, so a black wallpaper hid them; on any other wallpaper they showed as dark blocks. Work Fleet now asks Explorer to draw the wallpaper again whenever a note leaves the Wallpaper layer. The Desktop layer is unchanged.
- Windows: the package still bundles the .NET 10.0.13 Desktop runtime when built with .NET SDK 10.0.403, which had started picking 10.0.14 for it and stopped the package build.
- Note, sync and backup formats stay at V1.

## 0.4.2

Platforms: Windows, Linux, macOS, Android.

Summary: On Windows, adjust mode and desktop notes now show correctly right after a change of displays or of display scaling.

- Windows: after Work Fleet moved to another display while it ran, for example from a Remote Desktop session back to the computer's own screen, adjust mode showed neither its tint nor its toolbar yet took every click, the main window's too, until Esc or Done in the tray. Adjust mode now shows on the new display.
- Windows: after a change of display scaling while Work Fleet ran, notes on the Desktop and Wallpaper layers could be drawn shrunk inside their frame until Work Fleet restarted. They now keep their size.
- Note, sync and backup formats stay at V1.

## 0.4.1

Platforms: Windows, Linux, macOS, Android.

Summary: On Windows a desktop note now follows a Ctrl-drag to where you drop it, and the phone apps show their version in Settings.

- Windows: holding Ctrl and dragging a note on the Desktop layer moved it a little and then snapped it back. It now follows the pointer, floating above other windows while you drag, and rests on its Desktop layer where you drop it.
- Windows: when a note leaves or comes back to the Desktop layer (a Ctrl-drag, opening one with a Ctrl double-click, closing it, a new note), the other notes there no longer blink.
- Known on Windows: the moved or opened note itself may still flicker briefly as it changes layer, during a Ctrl-drag, a Ctrl double-click and Save.
- iOS and Android: Settings > General now starts with "Version", which shows the app's version; the stores update the phone apps, so there is no update row. Backups made on Android record the app's version instead of 0.1.0.
- Note, sync and backup formats stay at V1.

## 0.4.0

Platforms: Windows, Linux, macOS, Android.

Summary: Adjust mode now only arranges notes, and a new setting lets you hold Ctrl (⌘ on macOS) to drag or double-click a desktop note to move or edit it in place.

- Adjust mode only arranges notes: adjusted notes no longer carry Edit or "⋯", and neither a double click nor Enter opens them, on the desktop and on the browser preview's Desktop canvas. Edit notes in the main window, or with the setting below.
- New in Settings > Desktop notes, off at first: "Hold Ctrl to drag or double-click a note" ("Hold ⌘ …" on macOS). With it on, hold the key and drag a note resting on the Desktop or Top layer to move just that note without adjusting. It stays on its layer, never changes group, Esc while dragging puts it back, and Undo in adjust mode takes a move back.
- With the same setting, hold the key and double-click such a note to edit it in place: it rises opaque to the Top layer where it is, with Save, Cancel (discards what this edit changed) and Full editor. Esc keeps a changed draft and closes. Clicking another app leaves it open; opening another note, entering adjust mode, a change of displays or turning the setting off close it and keep a changed draft. Other notes can still be moved with the key while one is open.
- The setting belongs to each computer and Reset desktop layout turns it off. GNOME through XWayland, where notes rest only on the Wallpaper layer, phones and the browser preview do not offer it. On Raspberry Pi OS and other layer-shell desktops, click into the text once if typing does not reach an opened note.
- The phone apps no longer zoom with two fingers, a double tap or a small text field, and on Windows neither the main window nor the desktop notes zoom with a pinch; the main window keeps Ctrl+wheel zoom.
- Note, sync and backup formats stay at V1.

## 0.3.13

Platforms: Windows, Linux, macOS, Android.

Summary: Drag a note onto a group in the sidebar to move it there, and on a phone hold a group to reorder it without selecting text.

- On a computer, drag a note on the board or in the list onto another group in the sidebar to move it there. The group lights up and reads "Move to …", Esc cancels, and the status bar offers Undo, which moves the note back unless it has moved again since. The desktop paper stays where it is, as with "Move to group".
- Moving a note to another group adds a version of the same note rather than deleting it and adding a copy; in Versions and conflicts that version reads "Moved from …".
- On a phone, hold a group in the sidebar for a moment and drag it to reorder; the grip still drags at once, and a finger that moves without holding scrolls the list. Holding a group no longer selects text on Android or iOS.
- On phones the round "+" now floats above the status bar, which spans the full width, as on computers. On every width the "+" moves up when a long status wraps onto a second line.
- Note, sync and backup formats stay at V1.

## 0.3.12

Platforms: Windows, Linux, macOS, Android.

Summary: The gear now opens General, with the version, updates and startup options, and the account area opens Account and sync.

- The account area at the bottom left of the sidebar always opens Account and sync. The gear and Ctrl+, (Command+, on macOS) always open General instead of the last page shown; in a phone-sized window the gear still opens the list of pages.
- Settings lists the account as a card at the top, then General, Desktop notes and Shortcuts, then Data and backup, and Versions and conflicts.
- General now holds Version and updates, Startup and Language. The Desktop page is renamed Desktop notes; Reset desktop layout stays last.
- Data and backup starts with automatic backup, then export and restore; Reset all data stays last.
- No setting was added or removed.
- Note, sync and backup formats stay at V1.

## 0.3.11

Platforms: Windows, Linux, macOS, Android.

Summary: The Windows tray menu now appears at once, and the window for local data that cannot be opened has the Windows 11 look.

- Windows: the tray menu appears whole at once instead of sliding down as it opens.
- Windows: the window shown at start when the local data cannot be opened has the Windows 11 look and follows the Windows light or dark mode. Its accent button opens the data folder; setting the data aside still asks first.
- Note, sync and backup formats stay at V1.

## 0.3.10

Platforms: Windows, Linux, macOS, Android.

Summary: The Windows tray menu now has the Windows 11 look and follows the Windows light or dark mode.

- Windows: the tray menu is drawn in the Windows 11 style, with rounded corners and Windows 11 spacing, light or dark as the Windows mode is, or in high contrast. It opens just above the taskbar instead of over it. Its items, keyboard use and shortcuts are unchanged.
- Note, sync and backup formats stay at V1.

## 0.3.9

Platforms: Windows, Linux, macOS, Android.

Summary: Notes on the main window's board tick checklist steps with a click and open on a double-click, the Windows tray menu is regrouped, and Windows message boxes use the current Windows look.

- On the main window's board, clicking a checklist box ticks or unticks that step, as on the desktop. With a mouse, a single click on a note no longer opens the editor: double-click it, or choose "More actions" (…) > "Edit". On a touch screen a tap still opens it.
- Windows: the tray menu is grouped with separators. "Open Work Fleet" comes first in bold, as clicking the icon does; "Hide main window" shows only while the main window is open; "Adjust all notes" becomes "Done adjusting" while notes are being adjusted; desktop actions show their global shortcuts; and "Save and quit Work Fleet" is now "Exit Work Fleet", which still saves first.
- Windows: message boxes, such as the answer to "Check for updates…", use the current Windows style instead of the classic one.
- Note, sync and backup formats stay at V1.

## 0.3.8

Platforms: Windows, Linux, macOS, Android.

Summary: Desktop notes tick checklist steps and show their attachment thumbnails, groups can make Top-layer notes see-through, search puts title matches first, and data that can't be opened explains itself.

- On desktop notes that take clicks (the Desktop and Top layers), clicking a checklist box ticks or unticks that step. It saves and syncs like any edit, without selecting, moving or opening the note. Wallpaper-layer notes still let clicks through, and a note with a kept draft waits until the draft is saved or dropped.
- Desktop notes now show their attachment thumbnails and open an attachment on a double-click in the desktop apps, which refused both before.
- "Opacity on the Top layer" in Group settings (30% to 100%) makes a group's notes see-through while they rest on the Top layer, so they don't hide the work beneath them. Text, checkboxes and thumbnails stay solid; it is kept on this device only.
- Search lists notes whose title, or first line, matches first, then notes matching in their first five lines, then the rest.
- Files pasted or dragged into the editor, such as a screenshot, become attachments; a pasted picture without a name of its own is named "Pasted image" with the date and time.
- When Quick capture brought the main window out of the tray or menu bar, saving the note or pressing Esc puts it back there.
- With the main window in the tray, sync keeps its 20-second pace instead of slowing to once a minute, and showing the window syncs at once.
- When the notes on this device can't be opened, the desktop apps say why (damaged, disk full, in use, not permitted or can't be decrypted), show the data folder and, for damaged or undecryptable data, offer "Set aside and start again" after a confirmation. The database moves into a dated set-aside folder and nothing is deleted; a Google workspace gets its notes back from Drive after signing in again.
- Linux: on sway, wayfire and other Wayland desktops without a global shortcuts portal, compositor keybindings can run Work Fleet's named actions with `gapplication action`; the user guide has examples.
- Note, sync and backup formats stay at V1.

## 0.3.7

Platforms: Windows, Linux, macOS, Android.

Summary: One reset now covers the desktop layout and the main window, the status row spans the main window again, board notes keep one size, and every platform ships in one release.

- "Reset desktop layout" in Settings > Desktop also returns the main window to its default size, centered on the primary screen, in the desktop apps; the separate "Reset main window" section is gone. If the window cannot be reset, the status says that the layout was reset anyway.
- The status row under the notes spans the whole width again, with conflicts on the left and the save status on the right; the round "+" sits above it.
- Board notes keep the 240×240 size of a new desktop note however wide the window is; the width only changes how many fit in a row. Phones and windows 640 px or narrower keep two columns.
- One GitHub release, tagged v0.3.7, carries Windows, macOS, Linux and Android. In-app updates on Windows, macOS and Linux look for these releases from now on. Installs of 0.3.6 or earlier look only for the older per-platform releases, so install 0.3.7 once by hand; later versions update in the app.
- Note, sync and backup formats stay at V1.

## 0.3.6

Platforms: Windows, Linux, macOS, Android.

Summary: Capture floats over the group's To do, the main window remembers its group, new notes no longer land on top of each other, and Windows follows display changes.

- Capture is the floating "+" at the bottom right on every screen. It shows while the selected group's To do notes are on the board or in the list, and the top-bar Capture button is gone. Quick capture (Ctrl+Shift+N or the tray) first shows the target group's To do, then opens the editor.
- Search looks through every group: while it has text, the top bar reads "Search results in all groups".
- Saving a new note shows the group it went into, under To do. The main window remembers its group on this device across restarts, so Capture and Quick capture keep filing into it after a sign-in start.
- A new note, whether captured, synced, restored or placed after a layout reset, takes the first free place in its group's region instead of landing on the first note there. Only notes shown on the desktop take up room.
- "Clear Google, then restore from the backup" with "Also restore desktop positions" unchecked keeps this device's layout and desktop settings instead of resetting them to the defaults.
- While notes are being adjusted on the desktop, the main window no longer opens a dialog or another adjustment under the overlay; desktop shortcuts, Esc and Quick capture still work.
- Windows: after a switch to a larger display or resolution while Work Fleet runs, for example a remote session, the adjust overlay and the notes cover the whole new screen.
- Windows: after a display or scaling change while Work Fleet runs, notes are drawn at the new primary display's scaling, as after a restart, instead of the one Work Fleet started with.
- Linux: on Wayland desktops that use layer-shell, such as labwc on a Raspberry Pi, notes stay clear of the panel.
- Note, sync and backup formats stay at V1.

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
