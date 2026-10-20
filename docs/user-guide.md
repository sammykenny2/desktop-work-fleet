# User guide

[Traditional Chinese edition](user-guide.zh-TW.md)

Updated: 2026-10-17.

How to use the 1.0 Work Fleet app on Windows, macOS, Linux, phones and in the browser preview. How to build, run and
package the app, and how to use the 0.1.0 validation prototype, are in [Setup](setup-guide.md). Current status is in
[PROGRESS](../PROGRESS.md).

Labels below are quoted as the English interface shows them; the Traditional Chinese edition quotes the Chinese
interface. To switch, see [Settings](#settings).

## Getting started

- You can record notes offline without a Google account: the app starts with Local notes, which stay on this device.
  To sync across devices, sign in to Google later (see [Google sign-in and sync](#google-sign-in-and-sync)).
- "Capture" at the top right of the main window opens the editor for a new note in the group you are viewing. Settings
  opens from the gear at the bottom left of the sidebar, or with Ctrl+, (Command+, on macOS).
- On narrow screens and phones the sidebar folds into a drawer that the button at the top left opens, and you add a
  note with the plus button at the bottom right.
- A second independent window of the same profile is not allowed to write. Leaving the page while a save is in
  progress or has failed shows a warning.
- The desktop apps also keep desktop notes, a tray (menu bar on macOS) and global shortcuts; see
  [Desktop notes and layers](#desktop-notes-and-layers) and [The tray and menu bar](#the-tray-and-menu-bar).

## Notes and the editor

- "Capture" opens the editor. It supports Markdown and checklists ("+ Checklist" adds a step, "Preview / checklist"
  shows the result), and "+ Attachment" attaches files of up to 25 MiB each.
- "Title (optional)" can stay empty. With a title, the top of the paper shows it; without one, the paper shows the
  first line of the body. The body is always shown from its first line.
- Attachments can only be downloaded; HTML and SVG attachments are never run directly.
- "Save note" saves and removes the matching draft. "Keep draft" keeps the draft instead, and you continue it later
  from "Unfinished drafts" in the sidebar.
- Ctrl+Enter or Command+Enter saves. Esc keeps the draft and ends editing; blank or unchanged content keeps no draft.
  The full editor manages attachments and the preview.
- On the desktop you can edit a paper in place: Ctrl+Enter saves, and Esc keeps the draft and leaves editing (blank
  or unchanged content keeps no draft). For attachments and other content, "Full editor" goes back to the editor in
  the main window.
- New notes are 240×240 squares. Where a group region is short, a new note shrinks to a square that fits (at least
  160×160). Notes already on the desktop keep their size until you use Reset desktop layout.
- Notes you can operate on the desktop scroll their text. Notes on the Wallpaper layer and on the main window's board
  do not scroll: text that does not fit ends with "…". Open the note in the editor to read all of it.
- A paper with attachments shows a row of thumbnails along its bottom, from left to right; thumbnails that do not fit
  are not shown. Double-click a thumbnail to open the attachment.

### Versions and conflicts

- "Versions and conflicts" in the sidebar has two tabs, "Needs attention" and "Version history". There you compare
  branches, adopt a version ("Use this version"), download its attachments, restore earlier content ("Make this the
  current version") and resolve group merge cycles.
- Restoring creates a new version and keeps the later content; unfinished drafts can still be recovered. While
  several branches are unresolved, an ordinary save keeps the draft and tells you so.
- When a group has no receiving target or there are more than nine groups, the data is kept and the app explains how
  to sort it out. An unfinished group transfer can be retried ("Retry the move with the current version") or
  cancelled ("Cancel this move").

## Groups

- The plus button next to "All groups" in the sidebar opens "New group".
- The "⋯" next to a group opens "Group settings", where you can rename the group, or merge it into another group with
  "Merge or remove group". First choose a receiving group and preview all of the notes and drafts that move; then
  "Merge and remove the original group" confirms. The content and desktop positions are kept and the source group is
  removed; Undo can't bring back a merged group.
- To move a note to another group, drag it there in adjust mode (see
  [Adjust mode and arranging](#adjust-mode-and-arranging)), or choose the group in "Move to group" in the note's "⋯"
  details.
- When notes are arranged, each group goes into its own region. "Group regions" in Settings > Desktop sets "Rows" and
  "Columns", and below them you choose the group for each region; choosing a group that is already in another region
  swaps the two. Regions are numbered from left to right and from top to bottom.
- The sidebar lists groups in region order, and each device keeps its own order. Drag a group up or down to reorder
  it; on a phone, drag the dotted grip at the left of the row, and with a keyboard press Alt+Up or Alt+Down on the
  group. Reordering moves the groups between their regions, so each region key then acts on the group now in its
  region; a short message lists the keys that now act on a different group and closes by itself. Notes already on
  the desktop stay where they are until you arrange them. While there are more than nine groups (after syncing
  offline changes), the order cannot change until groups are merged.
- Each group has one of nine paper colors on this device. Choose it in the group's "⋯" > "Group settings" >
  "Color on this device"; a small dot marks a color another group already uses, and choosing it swaps the two
  groups' colors. A new group takes a color no other group uses, and a merged group frees its color. Colors do not
  sync: each device keeps its own, and reordering groups does not change them.
- "My group" in Settings > Desktop gives the notes of one group an accent-colored edge on this device and puts a
  star before its name in the sidebar. Phones have no "My group" and ignore one carried over by a restored layout.
- Each group sits on one desktop layer; see [Desktop notes and layers](#desktop-notes-and-layers).

## The board and the list

- In the desktop apps the main window does not mirror the desktop layout; you drag notes on the desktop itself.
- On the right of the filter bar, switch between "Board" (a grid of square papers) and "List". This device remembers
  the choice. Click a note to edit it. The third view differs by platform:
  - Desktop apps: "Layout map", only a blank placeholder for now.
  - Browser preview: "Desktop", a canvas inside the page that shows the To do notes in their group regions; you
    arrange them there (see [Browser preview](#browser-preview)).
  - Phones have no third view.
- The filters "To do", "Completed", "Archived" and "Deleted" show the notes in each state, and you can restore notes
  from them. Search covers titles and the full text. Its field sits next to the views, or in the top bar when the
  window is too narrow; on phones it opens from the magnifier at the top right.
- Completed notes leave the desktop unless this computer shows them (see "Show completed notes" below); shown, they
  are marked as completed. Archiving or deleting takes a note off the desktop on every device.
- "Move to Deleted" in a note's "⋯" details asks nothing first. The status line at the bottom offers "Undo" until the
  next message, and the note stays in Deleted until you restore it there.

## Desktop notes and layers

Desktop notes exist only in the desktop apps (Windows, macOS, Linux).

- Each group sits on one layer. From back to front: Wallpaper layer, Desktop layer, Top layer. Groups you create on
  this computer, including the first one, and groups that signing in or syncing with Google brings to it for the
  first time start at the back: on the Wallpaper layer, or on the Desktop layer where the desktop has no Wallpaper
  layer. Groups already on this computer keep their layer until "Reset desktop layout" moves every group there.
  Switch a group's layer with its region key (default Ctrl+Shift+1-9, see [Shortcuts](#shortcuts)).
- In the desktop apps each group row in the sidebar shows a small stack of three plates for the group's layer: the
  bottom plate filled for the Wallpaper layer, the middle one for the Desktop layer, the top one for the Top layer.
  Hover it for the layer's name. Where this computer cannot show the chosen layer, the icon shows where the notes
  really are and the tooltip says so. In a window narrower than about 950 pixels the sidebar leaves the icon out.
- The layer belongs to the group, and each computer stores its own. On a computer you can also choose it in the
  group's "⋯" > "Group settings" > "Layer on the desktop"; phones and the browser preview have no such option. A note's
  own "⋯" details keep only "Show on the desktop".
- While Locked, notes on the Desktop layer and the Top layer still let you select text and click links, and the mouse
  does not pass through them. The Wallpaper layer always lets the mouse pass through.
- "Show notes while locked" in Settings > Desktop must be on for notes to stay on the desktop while Locked. When it is
  off, notes appear on the desktop only while you adjust them.
- "Show completed notes" in Settings > Desktop is off at first. While it is off, completed notes leave this computer's
  desktop, also while you adjust, and return to their old places when you turn it on or move them back to To do.
  Each computer keeps its own choice, and "Reset desktop layout" turns it back off.
- In the Windows Explorer desktop, the Wallpaper layer attaches below the desktop icons. macOS offers the same
  controls with three AppKit layers; Linux layer-shell uses three native bands.
- pcmanfm desktops draw the wallpaper and the icons on the same surface, so notes cannot go below the icons and there
  is no Wallpaper layer. On pcmanfm and on X11, a group that prefers the Wallpaper layer falls back to the Desktop
  layer, and "Group settings" names the layer it actually shows on. Scope, click-through and redraw, and native
  verification: [ADR-031](decisions/031-macos-and-linux-wallpaper-scenes.md).
- When the desktop host is unavailable, the app tells you it shows the notes on the Desktop layer for now; your
  preference is kept. The layering decision is [ADR-030](decisions/030-windows-explorer-wallpaper-layer.md).
- Resizing the main window does not move notes on the desktop. At startup the app uses the display layout and work
  areas of that moment; recovering after displays are plugged in or out is not integrated yet.
- Platform specifics (GNOME Wayland, Raspberry Pi OS, pcmanfm) are in [Linux](#linux).

## Adjust mode and arranging

- Notes are normally Locked, and you cannot change their text. Under "Adjust" at the right of the view bar, press "This
  group" or "All" to enter adjust mode: click selects a note, double-click edits it in place. "Done" returns to
  Locked. When the window is too narrow for the whole row, "Adjust" shows only in the "Desktop" (or "Layout map")
  view.
- While you adjust, the view bar turns into a dark adjust bar that names what you are adjusting and has "Bring to
  front" (‹ › brings the previous or next note of the group to the front), "Stack", "Spread", "Undo" and "Done". The
  filters, search and views come back after "Done". In the browser preview, adjusting from the board or the list
  switches to the "Desktop" canvas.
- In the desktop apps, adjust mode covers the screen with a translucent overlay that has "Adjust position", "Stack",
  "Spread", "Undo" and "Done" at the top. When you enter it, the main window is minimized first only if it has the
  focus, and it is restored when you finish
  ([ADR-042](decisions/042-adjust-overlay-on-every-desktop-host.md)).
- In the main window, "This group" and "All" move the matching notes to the Top layer for the time being; "Done"
  returns them to their group's layer.
- Dragging only moves a note. It changes groups only when you drop it on another group's receiving label, or hold
  Shift and drop it into another group's region.
- "Stack" and "Spread" (Arrange) show a preview first, and "Apply arrangement" applies it. Resizing notes has to be
  allowed each time ("Allow resizing notes this time"). "Undo" reverts position, size and group transfers in order.

## Shortcuts

- Settings > Shortcuts lists "Quick capture" and "Show or hide desktop notes", then, under "Note layers and position",
  "All groups" and one row for each region 1-9, named after the group in that region (or "Empty").
- A shortcut is Ctrl, Alt or Meta with a letter, a digit or F1-F24, optionally with Shift. Separate several shortcuts
  for one action with commas; leave the field empty to remove the shortcut.
- Defaults: Quick capture Ctrl+Shift+N, Show or hide desktop notes Ctrl+Shift+D, All groups Ctrl+Shift+0, regions 1-9
  Ctrl+Shift+1-9.
- In the desktop apps, each press of a region key moves that group's notes to the next step: Wallpaper layer →
  Desktop layer → Top layer → Adjust position, and the next press returns to the Wallpaper layer. Desktops that do
  not support the Wallpaper layer skip it.
- On each switch, the center of the group's region briefly shows, on the Top layer, the group name, its current
  layer and a dot for each step. It fades out after about 1.5 seconds and does not block the mouse.
- Ctrl+Shift+0 puts every group into Adjust position; press it again and each group returns to its own layer.
- When "Show notes while locked" is off, or in the browser preview, a region key only toggles that group's Adjust
  position and does not change layers.
- Regions are numbered from left to right and from top to bottom. The number keys follow the regions and act on the
  group that is in that region at the time; keys for empty regions are not registered with the system.
- Keys that older versions bound to a group become the key of the region that group is in when the app opens, and
  regions without a key get their default number.
- If the browser reserves a combination, change the key in Settings. The browser preview applies shortcuts only in
  the current window and does not claim to register global keys with the OS.
- Windows enables global shortcuts according to the settings. Settings shows for each key whether it is registered,
  "used by another app" or "reserved by the system", and "Register shortcuts again" retries; you can also change the
  key. Ctrl+Alt with a letter or a digit is not registered globally, so that AltGr can still type characters; the row
  says "use a Ctrl+Shift combination instead", and a function-key combination works too. While the app has the focus it releases the global registrations and the current
  window handles the keys; IME composition and dialogs come first.

## Settings

Settings opens from the gear at the bottom left of the sidebar, or with Ctrl+, (Command+, on macOS). Changes take
effect at once but do not rearrange existing notes.

- General > Display language: "Auto-detect", "English" or "Traditional Chinese". Each option is named in the current
  interface language.
  - "Auto-detect" (the default) follows the language of this device: the app takes the first of the system's
    preferred languages that is English or Traditional Chinese (including Chinese without a region, Hong Kong and
    Macau). Simplified Chinese and other languages are skipped, and with no match the app uses English.
  - Choosing an option switches the window at once without reloading. The desktop notes, the tray, the macOS menu bar
    and application menus, and the dialogs the app shows itself switch to the same language. A status line already on
    screen keeps its language until it next changes.
  - Phones have the same setting; on iOS the Share Extension sheet follows it too.
  - The choice belongs to this device: it is not part of a backup or of Google data.
- Account and sync: see [Google sign-in and sync](#google-sign-in-and-sync).
- Data and backup: see [Backups and restore](#backups-and-restore).
- Desktop (desktop apps and the browser preview; phones have no Desktop or Shortcuts page): "Show notes while
  locked", "Show completed notes", "My group", "Group regions" and "Reset desktop layout". The desktop apps also show
  "Startup", "Version and updates" and "Reset main window". On GNOME Wayland the page also has "Show desktop notes
  through XWayland" (see [Linux](#linux)).
- Shortcuts: see [Shortcuts](#shortcuts).

### Startup and the main window

On the desktop apps, the "Startup" section of Settings > Desktop has these switches; each shows what the system
actually does:

- "Start Work Fleet when you sign in to the computer". If you turned it off in the system (Startup apps in Windows,
  Login Items in System Settings on macOS), the row says so and you turn it back on there.
- "Keep running in the tray when the main window closes" ("Keep running in the menu bar when the main window closes"
  on macOS). When it is off, closing the main window saves and quits Work Fleet.
- "Open the main window after starting at sign-in". When it is off, a start at sign-in only shows desktop notes in the
  background; opening Work Fleet yourself always shows the main window.

Under "Reset main window", "Reset main window size and position" returns the main window to its default size, centered
on the primary display. Desktop notes are not affected.

### Reset desktop layout

At the bottom of Settings > Desktop, "Reset desktop layout…" asks for confirmation ("Reset"), then only puts this
computer's notes back into their group regions, restores their default size and display, and moves every group to
the back layer (the Wallpaper layer, or the Desktop layer where the desktop has no Wallpaper layer); it does not touch
content, group names and contents, or shortcuts. Drafts stay on this device. Whether a restore applies a backup's layout is chosen
separately ("Also restore desktop positions"), and importing new data does not move existing notes.

## Google sign-in and sync

- Sign in from Settings > Account and sync in the native apps: press "Sign in" in the "Google account" row. The
  account area at the bottom left of the sidebar opens that page. The browser preview has no Google sign-in or sync
  and only keeps local data.
- Once signed in, the account area shows the account's name and photo; on a computer, hover over it to see the email
  address, which the "Google account" row also shows. Until the first sync reaches Google, for example when the app
  starts offline, it shows the email address and its first letter.
- Signing in does not send your existing Local notes or browser preview data automatically. How to move them, and the
  other account procedures, are in [Google setup](google-setup.md).
- To overwrite everything in Google after signing in, use "Clear Google, then restore from the backup"; see
  [Backups and restore](#backups-and-restore) and [Google setup](google-setup.md).
- "Reset all data" in a Google workspace also clears the data on Drive, which affects every device that uses the
  account.
- On Linux, Google tokens need an unlocked keyring; see [Linux](#linux).

## Backups and restore

### Export and import

- "Export backup" in Data and backup saves a plain ZIP, or an encrypted one with "Encrypt with a password". To
  restore, choose the file under "Restore from backup" and press "Check file", which checks it and shows a preview;
  then confirm with "Confirm restore". The "Restore method" is "Add as new notes", "Merge with current notes" or
  "Replace current notes".
- An encrypted export needs a password of at least 12 characters. The password of a manual export is not stored and
  cannot be recovered; restoring needs the original password.
- "Add as new notes" creates separate data; "Merge with current notes" keeps branches by their original identity;
  "Replace current notes" keeps history and moves extra notes to Deleted.
- "Replace current notes" needs a successfully saved safety backup of the current data first ("Back up current data
  first"). Browsers that only download, and cannot confirm that the file was saved, disable this step.
- In the native apps, a manual export uses the system folder picker, creates a new `work-fleet-backup-UUID.zip` file
  each time and reads it back to verify it. Reading a portable backup can still use the normal file picker.
- Local and Google backups have the same format. A Google export syncs first; if the sync fails you must explicitly
  choose "Back up only what this device knows".
- To work offline, download a Google ZIP, switch to Local notes and restore it. The detailed procedures in both
  directions are in [Google setup](google-setup.md).
- During the test phase the data formats of notes and backups stay at V1; updated fields do not start a schema
  upgrade or create extra copies. The data version policy is
  [SPEC-007](specs/007-schema-evolution-and-migrations.md); existing ZIP backups keep working as usual.

### Restore into a cleared workspace

- The local workspace also has the restore method "Clear this device, then restore from the backup": check the ZIP
  with "Check file", verify the number of items that will be cleared, tick "I understand the current local content
  will be permanently replaced by the backup", then press "Confirm restore".
- You do not have to reset first or be forced to back up the old content. Notes, history, drafts, attachments and
  layout are replaced in one transaction; if it fails, the original data is kept.
- The old content does not stay in Deleted. The automatic backup settings and other workspaces are kept. You can
  still choose "Back up current data first".
- In a Google workspace, "Clear Google, then restore from the backup" overwrites everything; see
  [Google setup](google-setup.md).

### Automatic backups

- Automatic backups are off by default. Under "Automatic backup" in Data and backup, choose the "Location" ("Choose
  folder"), the password and "Copies to keep", then press "Turn on automatic backup".
- By default seven copies are kept. A backup runs only when something changed and at least 24 hours have passed
  since the last successful one; a missed backup runs when the app opens or resumes. "Back up now" runs one at once.
- On Windows the password is saved with DPAPI in the current Windows account, and the renderer only gets a key ID.
  To restore on another device you still need the password, so keep it yourself.
- Turning automatic backups off ("Turn off") or changing the location keeps the old files. Unfinished, modified or
  replaced files are kept and the problem is shown.
- On Windows, saving supports only local NTFS folders; network drives, FAT/exFAT, symlinks and junctions are refused.
- In the browser preview the automatic backup entry says it is not supported and is disabled. The steps above are
  for the Windows native app; for other platforms, current status is in [PROGRESS](../PROGRESS.md).

### Reset all data

- At the bottom of Data and backup, "Reset all data…" deletes the current workspace's notes, groups, drafts,
  attachments, history, layout, shortcuts and automatic backup settings on this device. "Export a backup first" is
  next to it. In the "Reset all data?" dialog you must tick "I understand this cannot be undone" before "Delete
  permanently and reset" runs it. Saved backup ZIPs, shares not yet accepted in the Share inbox and other workspaces
  are not affected.
- In a Google workspace it also clears the data on Drive, and every device that uses the account is affected (see
  [Google setup](google-setup.md)).

### Keep your own copies

- Without Google sync, clearing the browser's data loses the browser preview's data; save a ZIP first in
  Settings > Data and backup.
- Do not use the native database as a backup for another machine: on Windows, DPAPI needs the key of the original
  Windows account.
- The browser preview's IndexedDB and the native app are different profiles; existing data is not moved
  automatically.
- For what an MSIX update or uninstall keeps on Windows, see [Windows](#windows).

## The tray and menu bar

- While "Keep running in the tray when the main window closes" is on (the default; "Keep running in the menu bar when
  the main window closes" on macOS), closing the window (X) hides it to the tray (the menu bar on macOS). To quit, use
  "Save and quit Work Fleet" in the Windows tray, or "Save and quit" in the Linux tray and the macOS menu bar. When the
  switch is off, or when the tray is unavailable, X saves and quits.
- After X or the Windows tray's "Hide main window", the desktop notes and the authority over local data keep running.
  From the tray you can reopen the main window, use Quick capture, adjust notes or quit.
- The Windows tray menu has "Open main window", "Quick capture", "Adjust all notes", "Done adjusting", "Show or hide
  desktop notes", "Hide main window", "Check for updates…" (where in-app updates are available) and "Save and quit
  Work Fleet".
- The Linux tray and the macOS menu bar have "Open Work Fleet", "Quick capture", "Adjust all groups", "Show or hide
  desktop notes", "Check for updates…" (where in-app updates are available) and "Save and quit". The macOS
  application menu also has "Save and quit Work Fleet".
- The tray and menu labels follow Settings > General > Display language.
- If the focus has moved after a delay, click a floating note once to continue.
- Whether closing the main window keeps Work Fleet in the tray is a switch in Settings > Desktop; see
  [Startup and the main window](#startup-and-the-main-window).

## Updates

- Settings > Desktop > "Version and updates" shows the version, how it was installed and the in-app update state. A
  single button offers the next step: "Check for updates", "Download update", or "Restart and install". The tray and
  the menu bar also have "Check for updates…".
- Work Fleet checks for updates only when you ask; there is no automatic or periodic check.
- "Restart and install" first saves unsaved text; Work Fleet closes and reopens when the installation is done. Finish
  a running backup or restore first.
- Only installations that can upgrade in place support in-app updates: the installed Windows app (MSIX), a signed and
  notarized macOS app (updated with Sparkle) and Linux installed from the DEB (installed through pkexec). Other forms,
  such as the Windows ZIP, show only the version.

## Platform notes

### Windows

- Without a Google ID you can still record offline. Content, attachments, drafts, layout and the backup journal are
  stored in `%LOCALAPPDATA%\WorkFleet\fleet.sqlite3` for the ZIP and Debug builds, or in
  `LocalCache\Local\WorkFleet\fleet.sqlite3` in the MSIX package's private data area. The payload is protected with
  DPAPI for the current Windows user.
- An MSIX update keeps the data. Uninstalling removes all local and Google account data, settings, credentials and
  cache in the package. Export a ZIP before reinstalling; exported files and Google cloud data are not affected.
- Data in an old standalone directory has to be exported as a ZIP with the old version and imported in the MSIX; it
  is not moved or deleted automatically.
- Only one app may run per data path; another window tells you to use the original window.
- Closing first waits for drafts to be saved and an automatic backup to finish. If a dialog or IME input is still
  open, finish it first. When a save fails, the window and the draft are kept; reopening reads the committed content.

### macOS

- The close button keeps Work Fleet in the menu bar; "Save and quit" there saves and quits.
- Desktop notes use three AppKit layers with the same controls as Windows.

### Linux

- Offline notes in a new workspace, or after the master key migration has finished, do not need a keyring. Google
  tokens, saved automatic backup passwords and the first migration of old data need libsecret and an unlocked,
  persistent Secret Service. While it is locked, only those features pause; startup and background sync never ask for
  a password ([ADR-048](decisions/048-linux-offline-workspace-and-system-secrets.md)).
- Automatic sign-in can leave the keyring locked. Press "Sync now" to open the system unlock dialog; after a
  successful unlock the sync continues, and after a cancel or timeout you can try again.
- When global shortcuts or a tray are not available on your desktop, the main window can still record notes. What
  each needs is listed in [Setup](setup-guide.md).
- GNOME Wayland (for example the Ubuntu 22.04 default) has no layer-shell, so desktop notes have to go through
  XWayland. On first start the app asks "Use XWayland to show desktop notes?" ("Restart with XWayland" or "Keep the
  current mode"); later you can switch with "Show desktop notes through XWayland" in Settings > Desktop
  ([ADR-040](decisions/040-gnome-wayland-xwayland-choice.md)), or start it directly with `GDK_BACKEND=x11 work-fleet`.
  Through XWayland, groups stay resident only on the Wallpaper layer
  ([ADR-039](decisions/039-gnome-desktop-icons-and-x11-scene-size.md)).
- On layer-shell desktops such as Raspberry Pi OS (labwc), the resident layers are not limited by the overlay (the
  default pcmanfm desktop has no Wallpaper layer). Adjust mode likewise covers the whole screen with the overlay and
  hides the main window.

### Phones

- Phones have no desktop notes, so there is no layer option, no Desktop or Shortcuts page in Settings and no Adjust
  position controls. The sidebar and the new-note button work as described in [Getting started](#getting-started).

### Browser preview

- The browser preview is not an OS desktop overlay. Its "Desktop" view draws the notes inside the page, and groups
  have no layer option there; the real layering, click-through and global shortcuts come from the native hosts.
- It has no Google sync; back it up as described in [Keep your own copies](#keep-your-own-copies).
- Shortcuts work only in the current window, and region keys only toggle a group's Adjust position.
- Automatic backups are not supported there and their entry is disabled.
