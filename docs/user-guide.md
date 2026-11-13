# User guide

[Traditional Chinese edition](user-guide.zh-TW.md)

Updated: 2026-10-23.

How to use the 1.0 Pin It Anywhere app on Windows, macOS, Linux, phones and in the browser preview. How to build, run and
package the app, and how to use the 0.1.0 validation prototype, are in [Setup](setup-guide.md). Current status is in
[PROGRESS](../PROGRESS.md).

Labels below are quoted as the English interface shows them; the Traditional Chinese edition quotes the Chinese
interface. To switch, see [Settings](#settings).

## Getting started

- You can record notes offline without a Google account: the app starts with Local notes, which stay on this device.
  It opens with no groups. "Add the first note" makes a group called "My notes" for that note, or you can add a group yourself
  with the + beside a section.
  Sign in and Cloud notes appears above them in the sidebar; the two are always shown together, with no switching.
  To sync across devices, sign in to Google later (see [Google sign-in and sync](#google-sign-in-and-sync)).
- The round "+" button at the bottom right ("Capture") opens the editor for a new note in the group you are viewing.
  It shows only while that group's To do notes are on the board or in the list; under another filter, during a search
  and on the browser preview's Desktop canvas, which shows every group, it steps aside. Settings opens from the gear at
  the bottom left of the sidebar, or with Ctrl+, (Command+, on macOS).
- On narrow screens and phones the sidebar folds into a drawer that the button at the top left opens.
- A second independent window of the same profile is not allowed to write. Leaving the page while a save is in
  progress or has failed shows a warning.
- The desktop apps also keep desktop notes, a tray (menu bar on macOS) and global shortcuts; see
  [Desktop notes and layers](#desktop-notes-and-layers) and [The tray and menu bar](#the-tray-and-menu-bar).

## Notes and the editor

- "Capture" opens the editor. It writes Markdown: under "Edit", the tools at the right of the bar add a heading, bold text
  (Ctrl or ⌘+B), a bulleted list or a checklist step, and "Preview" shows the result. "+ Attachment" attaches files of up to 25 MiB each. Files pasted or dragged into the editor,
  such as a screenshot, are attached the same way; a pasted picture without a name of its own is named "Pasted image"
  with the date and time. Pasted or dragged text stays text.
- "Title (optional)" can stay empty. With a title, the top of the paper shows it; without one, the paper shows the
  first line of the body. The body is always shown from its first line.
- An attachment is a file, not a link. In the editor, double-click it to open a copy in its own app; right-click it, or use its "⋯",
  for "Open", "Save as…" and "Remove". On a phone, tap it for what the phone can do with it: "Share" where the phone offers it, "Save as…" and
  "Remove". The browser preview has no app to open it in, so a double click there saves it. HTML and SVG attachments never run inside the app.
- A note is saved, or it has unsaved changes kept on this device, as in a text editor. A note with unsaved changes
  shows them, with a filled dot at the end of its title; in the main window, pointing at the dot says "Unsaved
  changes, kept on this device". They are not synced and are included in backups. Opening the note again, in the
  editor or on the desktop, continues them.
- "Save note" saves the changes and removes the dot. "Close", the ✕ and Esc keep changed text unsaved; blank or
  unchanged content keeps nothing. "Discard changes" returns the note to its saved version, or throws away a new note
  that was never saved; a notification offers to undo that while the note has no newer unsaved changes.
- A new note with text that was never saved is a note too: it appears in its group with the dot and can be opened,
  ticked and moved within its group. Choose another group for it in its editor; moving it to another group otherwise
  waits until it is saved.
- If the note was changed on another device meanwhile, "Save note" is refused and the editor offers "Overwrite",
  which makes your text the next version (the other version stays in history), and "Save as copy". A note deleted
  elsewhere can only be saved as a copy. A change elsewhere that only completed, archived or moved the note does not
  refuse the save.
- Ctrl+Enter or Command+Enter saves. The full editor manages attachments and the preview.
- On the desktop you can edit a paper in place: Ctrl+Enter saves, and Esc keeps changed text unsaved and leaves
  editing. For attachments and other content, Full editor (the outward arrows) goes back to the editor in the main
  window.
- Moving a note with unsaved changes to Trash asks first, as its changes go with it; Undo brings back both.
- Settings > Desktop notes > New desktop note size offers Small (160×160), Medium (240×240, the default) and Tall
  (240×400). The choice is saved only on this device and serves both cloud and local notes. It applies when a note first
  gets a desktop position, including notes arriving from another device. Notes already placed keep their size.
  New notes shrink proportionally to fit a short group region, with a minimum shortest side of 160. Text size stays the
  same. Reset desktop layout keeps your choice and re-places the existing notes at that size.
- A new note, including one that arrives from sync, takes the first free place in its group's region, row by row from
  the top left. Only when the region is full does it overlap, stepping down and to the right from the region's corner so
  each note beneath still shows the start of its title.
- Notes you can operate on the desktop scroll their text. Notes on the Wallpaper layer and on the main window's board
  do not scroll: text that does not fit ends with "…". Open the note in the editor to read all of it.
- A paper with attachments shows a row of thumbnails along its bottom, from left to right; thumbnails that do not fit
  are not shown. Double-click a thumbnail to open the attachment, or, in the main window, right-click it, or tap it on a phone, for its other actions.
- On notes that take clicks (the Desktop and Top layers, and notes being adjusted), click a checklist box to tick or
  untick that step. It is saved and synced like any edit, without selecting, moving or opening the note. Notes on the
  Wallpaper layer let clicks through, so their boxes cannot be ticked there. On a note with unsaved changes the tick
  changes them and the note stays unsaved; a note open in an editor is ticked in the editor. The browser preview's
  canvas works the same way.

### Versions and conflicts

- "Versions and conflicts" in Settings has two tabs, "Needs attention" and "Version history". There you compare
  branches, adopt a version ("Use this version"), download its attachments, restore earlier content ("Make this the
  current version") and resolve group merge cycles.
- While something needs attention, the status bar at the bottom of the main window shows the number of conflicts;
  select it to open that page. With nothing to resolve it does not appear.
- Moving a note to another group adds a version of the same note rather than deleting it and adding a copy, so its
  history goes on; that version reads "Moved from …".
- Restoring creates a new version and keeps the later content; unsaved changes stay as they are. While several
  branches are unresolved, an ordinary save keeps your changes and tells you so.
- When a group has no receiving target or there are more than nine groups, the data is kept and the app explains how
  to sort it out. An unfinished group transfer can be retried ("Retry the move with the current version") or
  cancelled ("Cancel this move").

## Groups

- Each section in the sidebar has its own plus button, which opens "New group" for that section.
- The group you choose in the sidebar, the group a region key switches to, a group you just created, or the group
  you save a new note into (also when you pick another one in the editor) is the one the main window shows, and
  "Capture" and Quick capture add new notes to it. This device remembers it, so after a
  restart, including one that starts in the tray, the same group is chosen again. A merge passes it on to the
  receiving group; if the group no longer exists, the first group is chosen. "Adjust all" and clicking notes on the
  desktop do not change the remembered group.
- A section can hold no groups, in Cloud notes and Local notes alike. Opening the app, signing in, resetting local data or
  deleting the last group does not add one. With no group in any section, the main window offers "Add the first note", which
  makes "My notes" in Cloud notes while you are signed in and otherwise in Local notes. A share kept from the inbox lands in that
  same section, and makes "My notes" there if the section has no group. Search and Trash stay available.
- "Delete group" in "Group settings" works on any group, the last one too. Its notes go to Trash and their unsaved changes are
  discarded, after a question that says how many. Restoring such a note asks for another group; if its section has none, the
  deleted group comes back. A delete has no Undo.
- The "⋯" next to a group opens "Group settings", where you can rename the group, or merge it into another group with
  "Merge group". First choose a receiving group and preview all of the notes that move, unsaved ones too; then
  "Merge and remove the original group" confirms. The content and desktop positions are kept and the source group is
  removed; Undo can't bring back a merged group.
- To move a note to another group, drag it there in adjust mode (see
  [Adjust mode and arranging](#adjust-mode-and-arranging)), or choose the group in "Move to group" in the note's "⋯"
  settings. On a computer you can also drag a note on the board or in the list onto a group in the sidebar with the
  mouse: the group lights up and reads "Move to …", and Esc cancels. A notification then offers "Undo", which moves
  the note back unless it has moved again since. Moving from the sidebar or the "⋯" settings leaves the desktop paper
  where it is.
- The sidebar has a section for Cloud notes, while you are signed in, and one for Local notes, each with its own + and up to
  nine groups of its own. Cloud notes sync to your other devices; Local notes never leave this device. Signing out hides
  Cloud notes from the sidebar and the desktop and keeps them on this device for when you sign in again. A note's editor keeps it
  inside its section.
- To move a note to the other section, drag it onto a group there, or choose that group in the note's "⋯" > "Move to group". To
  move a group, drag it onto the other section, or use "Move to ..." in its settings. You confirm first, because moving to Local
  notes means your other devices no longer see it, and moving to Cloud notes means it syncs to them. The original goes to its
  section's Trash and says where it went; it leaves Google only when that Trash is emptied. Only the current version moves. A
  group moves behind a progress bar that you can stop: notes already moved stay moved, each note moves completely or not at
  all, and moving the group again continues into the same group. Notes with version conflicts or unsaved changes stay behind.
  A section holds nine groups, so a group can't move into a full one.
- If a backup has left two sections with the same note identities, actions pause while the app keeps your changes and reopens
  with the affected section unavailable. If saving fails, keep the window open, copy any text you need and use "Try again".
  The app reopens only after saving succeeds. A copy deleted during a cross-section move leaves the original alive; an
  interrupted recovery continues on the next start without undoing later choices you made in Trash.
- When notes are arranged, each group goes into its own region. "Group regions" in Settings > Desktop notes sets "Rows" and
  "Columns", and below them you choose the group for each region; choosing a group that is already in another region
  swaps the two. Regions are numbered from left to right and from top to bottom. There can be up to nine, each holding any
  group or none. A group in no region stays off the desktop and shows only in the main window; its notes keep their places
  for when it returns. A clean install starts with 2 rows × 3 columns. Adding or removing groups keeps your chosen rows
  and columns and existing regions; a new group takes a free region if there is one, otherwise it stays off the desktop.
- Each device keeps its own order of groups in the sidebar. Drag a group up or down to reorder it; on a phone, hold
  the group a moment and then drag it, or drag the dotted grip at the left of the row at once (a finger that moves
  without holding scrolls the list), and with a keyboard press Alt+Up or Alt+Down on the group. This changes only the
  sidebar: regions, region keys and notes stay as they are. While there are more than nine groups (after syncing offline
  changes), the order cannot change until groups are merged.
- Each group has one of nine paper colors on this device. Choose it in the group's "⋯" > "Group settings" >
  "Color on this device"; a small dot marks a color another group already uses, and choosing it swaps the two
  groups' colors. A new group takes a color no other group uses, and a merged group frees its color. Colors do not
  sync: each device keeps its own, and reordering groups does not change them.
- In the desktop apps, "Opacity on the Top layer" in "Group settings" (30% to 100%, 100% by default) makes the group's
  notes see-through while they rest on the Top layer, so they don't hide the work beneath them. Only the paper turns
  see-through; text, checkboxes and thumbnails stay solid. Notes on the Wallpaper and Desktop layers, notes being
  adjusted and the main window's board and list stay opaque. Like the color, it is kept on this device only.
- "Highlight this group's notes" in a group's settings (the ⋯ beside it) on a computer gives its notes an
  accent-colored edge and turns its dot in the sidebar into a star of the same color. Any number of groups can use it.
  Like the color, it is kept on this device only. Phones do not have it.
- Each group sits on one desktop layer; see [Desktop notes and layers](#desktop-notes-and-layers).

## The board and the list

- In the desktop apps the main window does not mirror the desktop layout; you drag notes on the desktop itself.
- On the right of the filter bar, switch between "Board" (a grid of 240×240 square papers, independent of New desktop
  note size; the window width only changes how many fit in a row, while phones and windows 640 px or narrower show two
  columns across) and "List". This device remembers the choice. Double-click a note, or press Enter on it, to open the full editor; on a touch screen a tap opens it.
  Hold Ctrl (⌘ on macOS) and double-click a board paper to edit it in place, with the actions of a desktop paper
  ([Desktop notes and layers](#desktop-notes-and-layers)); pressing anywhere else keeps its changes and closes it. A single click on a board paper's checklist box ticks or
  unticks that step, as on the desktop, and a click elsewhere on a note opens nothing. Only the browser preview has
  a third view, "Desktop": a canvas inside the page that shows the To do notes in their group regions, where you
  arrange them (see [Browser preview](#browser-preview)).
- The filters "To do", "Completed" and "Archived" show the notes in each state. "Trash" is its own item below the groups: it
  lists trashed notes by group, on the board and in the list, newest first, and you can restore them there. With cloud and local
  notes both open it has the tabs All, Cloud notes and Local notes, and "Empty Trash" acts on the tab shown. Search covers titles and the full text in every group and every status except Trash: while it has text the title
  reads "Search results in all groups", each result names its group and status, and a link below the results shows
  matches in Trash. In Trash, search covers only Trash. The search field ends the top bar; on phones it opens from the magnifier
  at the top right.
- Search results come in three tiers: notes whose title, or first line when there is no title, matches; then notes
  matching in the first five lines of their text; then the rest. Within a tier the notes keep their usual order.
- Completed notes leave the desktop unless this computer shows them (see "Show completed notes" below); shown, they
  are marked as completed. Archiving or deleting takes a note off the desktop on every device.
- A note offers its next step when you point at it, or always on a touch screen: To do has the check mark, the trash can and "⋯"; Completed has "Back to To do", "Archive",
  the trash can and "⋯"; Archived has "Unarchive", which returns the note to To do or Completed, whichever it was, and the trash can. "⋯" holds the note's settings: its group, whether this computer shows it, and "Archive" for a note still to do.
- The trash can asks nothing first, unless unsaved changes would go with the note. A notification offers "Undo" until you use or close it, or another undoable action replaces it. In Trash, "Delete forever" permanently removes the note, all retained versions and its owned
  attachments after confirmation. "Empty Trash" covers the previewed trashed notes across every group, not just the
  selected group. The large trash icon at the bottom right replaces Capture in this view, and its confirmation names
  each affected collection. Cleanup resumes in bounded background steps; its status distinguishes a committed deletion from
  pending cloud/device cleanup. Offline devices and already exported backups cannot be erased remotely.
- Distinct unpublished changes from a note permanently deleted elsewhere appear in Settings > Versions and conflicts,
  under Needs attention. "Save as copy" creates a new identity; the deleted original does not return. Archived notes
  remain editable. Trash has no automatic expiry yet, and saved versions have no individual retention timer.

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
  own "⋯" settings keep only "Show on the desktop".
- While Locked, notes on the Desktop layer and the Top layer still let you select text and click links, and the mouse
  does not pass through them. The Wallpaper layer always lets the mouse pass through.
- "Show notes on the desktop" in Settings > Desktop notes keeps notes on the desktop between adjustments. When it is
  off, notes appear only while you adjust their positions. This setting applies only to this computer.
- "Show completed notes" in Settings > Desktop notes is off at first. While it is off, completed notes leave this computer's
  desktop, also while you adjust, and return to their old places when you turn it on or move them back to To do.
  Each computer keeps its own choice, and "Reset desktop layout" turns it back off.
- "Hold Ctrl to drag or double-click a note" ("Hold ⌘ to drag or double-click a note" on macOS) in Settings > Desktop
  notes is off at first. When it is on, hold Ctrl (⌘ on macOS) before you press on a note on the Desktop or Top layer, then drag: that
  one note moves without entering adjust mode, stays on its layer (on Windows a Desktop-layer note floats above other windows while you drag it), and the main window stays where it is. Without the
  key a press selects text as before, and checkboxes, attachments and links keep working with it. It only moves the
  note, never to another group. Esc while dragging, or a change of displays, puts it back; "Undo" in adjust mode takes
  a finished move back. Each computer keeps its own choice, and "Reset desktop layout" turns it back off. GNOME through
  XWayland keeps notes on the Wallpaper layer only, so it does not offer this
  ([SPEC-003](specs/003-desktop-cards-groups-and-formation.md#2026-10-24-addendum-quick-move)).
- With the same switch on, hold Ctrl (⌘ on macOS) and double-click such a note to edit it in place: it rises to the Top
  layer, opaque, where it is, with no overlay, and the main window stays where it is. It continues the note's unsaved
  changes. Below the text, the check mark (Save) saves the text, the cross (Cancel) returns the note to its
  saved version, the outward arrows (Full editor) continue in the main window, and the trash can at the left moves the
  note to Trash. With unsaved changes, Cancel and the trash can ask first: the line under the text asks, and a second
  press within a few seconds answers it. If text cannot be kept, the line says why, and typing or Save writes it
  again. Esc keeps changed text unsaved and closes. Clicking another app leaves it open;
  double-clicking another note with the key closes it, keeping its changes, and opens that one. Entering adjust mode,
  a change of displays, the note leaving the desktop or turning the switch off also close it and keep changed text
  unsaved. While one note is open the others can still be moved
  with the key; the open one stays put. On Raspberry Pi OS and other layer-shell desktops, click into the text once if
  typing does not reach it
  ([SPEC-003](specs/003-desktop-cards-groups-and-formation.md#2026-10-24-addendum-adjust-mode-arranges-quick-edit-edits)).
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

- Notes are normally Locked, and you cannot change their text. Under "Adjust" at the bottom of the sidebar, press
  "This group" (the group selected above it) or "All" to enter adjust mode, which only arranges notes: click selects a
  note and brings it to the front, and dragging moves it. Adjusted notes have no Edit or "⋯" button, and neither a
  double-click nor Enter opens them; edit a note in the main window, or with the key and a double click on the desktop
  (see [Desktop notes and layers](#desktop-notes-and-layers)). "Done" returns to Locked. In a narrow
  window "Adjust" is in the drawer, and search waits until "Done".
- While you adjust, the view bar turns into a dark adjust bar that names what you are adjusting and has "Bring to
  front" (‹ › brings the previous or next note of the group to the front), "Stack", "Spread", "Undo" and "Done". The
  filters and views come back after "Done". In the browser preview, adjusting from the board or the list
  switches to the "Desktop" canvas.
- In the desktop apps, adjust mode covers the screen with a translucent overlay that has "Adjust position", "Stack",
  "Spread", "Undo" and "Done" at the top. When you enter it, the main window is minimized first only if it has the
  focus, and it is restored when you finish
  ([ADR-042](decisions/042-adjust-overlay-on-every-desktop-host.md)).
  While the overlay is active, the main window cannot be operated, even if you restore it. Finish with the overlay's
  "Done" or a desktop shortcut before using the main window again.
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
- Quick capture brings up the main window on the To do notes of the group it adds to, on the board or in the list,
  ending a search, and opens the editor over them, so the new note appears where you see it. When the main window was
  in the tray or menu bar, saving the note or pressing Esc puts it back there; a main window that was open or minimized
  stays as it was.
- In the desktop apps, each press of a region key moves that group's notes to the next step: Wallpaper layer →
  Desktop layer → Top layer → Adjust position, and the next press returns to the Wallpaper layer. Desktops that do
  not support the Wallpaper layer skip it.
- On each switch, the center of the group's region briefly shows, on the Top layer, the group name, its current
  layer and a dot for each step. It fades out after about 1.5 seconds and does not block the mouse.
- Ctrl+Shift+0 puts every group into Adjust position; press it again and each group returns to its own layer.
- When "Show notes on the desktop" is off, or in the browser preview, a region key only toggles that group's Adjust
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

Settings opens on its General page from the gear at the bottom left of the sidebar, or with Ctrl+, (Command+, on
macOS). The account area beside the gear opens Account and sync. In a phone-sized window Settings starts from its list
of pages. Changes take effect at once but do not rearrange existing notes.

The account card at the top of the list of pages shows the account and its sync status; the pages follow in two
groups:

- Account and sync (the account card): see [Google sign-in and sync](#google-sign-in-and-sync).
- General: on the desktop apps, "Version and updates" (see [Updates](#updates)) and "Startup" (see
  [Startup and the main window](#startup-and-the-main-window)); on iOS and Android, "Version", which the app stores
  update; then "Language", whose "Display language" is
  "Auto-detect", "English" or "Traditional Chinese". Each option is named in the current interface language.
  - "Auto-detect" (the default) follows the language of this device: the app takes the first of the system's
    preferred languages that is English or Traditional Chinese (including Chinese without a region, Hong Kong and
    Macau). Simplified Chinese and other languages are skipped, and with no match the app uses English.
  - Choosing an option switches the window at once without reloading. The desktop notes, the tray, the macOS menu bar
    and application menus, and the dialogs the app shows itself switch to the same language. A notification already on
    screen keeps its language until it next changes.
  - Phones have the same setting; on iOS the Share Extension sheet follows it too.
  - The choice belongs to this device: it is not part of a backup or of Google data.
- Desktop notes (desktop apps and the browser preview; phones have no Desktop notes or Shortcuts page): "Show notes
  on the desktop", "Show completed notes", "Hold Ctrl to drag or double-click a note" (desktop apps only), "New desktop note size" and
  "Group regions". On GNOME Wayland the page also has "Show
  desktop notes through XWayland" (see [Linux](#linux)). "Reset desktop layout" is last.
- Shortcuts: see [Shortcuts](#shortcuts).
- Operation results and failures appear in notifications over the page, including over Settings. Ordinary results disappear
  after a few seconds; errors, progress and Undo/Retry remain until closed, acted on or resolved. Hovering or focusing a
  notification pauses its timeout. Old completed cleanup is not announced when the app reopens.
- Data and backup: automatic backup, export, restore and, last, reset all data; see
  [Backups and restore](#backups-and-restore).
- Versions and conflicts: see [Versions and conflicts](#versions-and-conflicts).

### Startup and the main window

On the desktop apps, the "Startup" section of Settings > General has these switches; each shows what the system
actually does:

- "Start Pin It Anywhere when you sign in to the computer". If you turned it off in the system (Startup apps in Windows,
  Login Items in System Settings on macOS), the row says so and you turn it back on there.
- "Keep running in the tray when the main window closes" ("Keep running in the menu bar when the main window closes"
  on macOS). When it is off, closing the main window saves and quits Pin It Anywhere.
- "Open the main window after starting at sign-in". When it is off, a start at sign-in only shows desktop notes in the
  background; opening Pin It Anywhere yourself always shows the main window.

### Reset desktop layout

At the bottom of Settings > Desktop notes, "Reset desktop layout…" asks for confirmation ("Reset"), then puts this
computer's notes back into their group regions, restores their default size and display, and moves every group to
the back layer (the Wallpaper layer, or the Desktop layer where the desktop has no Wallpaper layer); it does not touch
content, group names and contents, or shortcuts. In the desktop apps it also returns the main window to its default
size, centered on the primary display. Unsaved changes stay on this device. Whether a restore applies a backup's
layout is chosen separately ("Also restore desktop positions"), and importing new data does not move existing notes.

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
  "Replace current notes" keeps history and moves extra notes to Trash.
- "Replace current notes" needs a successfully saved safety backup of the current data first ("Back up current data
  first"). Browsers that only download, and cannot confirm that the file was saved, disable this step.
- In the native apps, a manual export uses the system folder picker, creates a new `pin-it-anywhere-backup-UUID.zip` file
  each time and reads it back to verify it. Reading a portable backup can still use the normal file picker.
- Local and Google backups have the same format. A Google export syncs first; if the sync fails you must explicitly
  choose a current-only export if sync fails. The coverage selector defaults to "Complete retained history" and also
  applies to safety backups. "Current state only" includes current conflicts and unsaved changes, but excludes older
  versions. The manifest and restore preview identify that limited scope. Complete export reads retained remote
  history on demand; it fails intact if the 20,000-entry or 128 MiB expanded ZIP limit is exceeded.
- History lists are paged, and remote version contents download only when opened. Offline cached history can be
  incomplete. Notes retain versions until whole-note permanent deletion; copies own their cloud attachments, so
  saving a copy can consume additional Drive space. A future "clear this note's history" operation is not implemented.
- To work offline, download a Google ZIP and restore it into Local notes. The detailed procedures in both
  directions are in [Google setup](google-setup.md).
- During the test phase the data formats of notes and backups stay at V1; updated fields do not start a schema
  upgrade or create extra copies. The data version policy is
  [SPEC-007](specs/007-schema-evolution-and-migrations.md). The dataset format is incompatible with the older
  whole-workspace format and its ZIPs. There is no automatic conversion: the first-start screen keeps old data and
  offers Open Settings to reach Data and backup, where you can explicitly discard the old local copy. Closing
  Settings leaves it untouched. Use a compatible older app to inspect/export old data. Local discard never
  authorizes deleting Google data; that is a separate confirmation.

### Restore into a cleared workspace

- The local workspace also has the restore method "Clear this device, then restore from the backup": check the ZIP
  with "Check file", verify the number of items that will be cleared, tick "I understand the current local content
  will be permanently replaced by the backup", then press "Confirm restore".
- You do not have to reset first or be forced to back up the old content. Notes, history, unsaved changes, attachments
  and layout are replaced in one transaction; if it fails, the original data is kept.
- The old content does not stay in Trash. The automatic backup settings and other workspaces are kept. You can
  still choose "Back up current data first".
- In a Google workspace, "Clear Google, then restore from the backup" overwrites everything; see
  [Google setup](google-setup.md). Unless "Also restore desktop positions" is ticked, this device keeps its own layout
  and settings for the notes and groups in the backup.

Recent restore receipts are under the collapsed "Recent restores" entry.

### Automatic backups

- Automatic backups are off by default. Under "Automatic backup" in Data and backup, choose the "Location" ("Choose
  folder"), the password and "Copies to keep", then press "Turn on automatic backup".
- By default seven copies are kept. A backup runs only when something changed and at least 24 hours have passed
  since the last successful one; a missed backup runs when the app opens or resumes. "Back up now" runs one at once.
- On Windows the password is saved with DPAPI in the current Windows account, and the renderer only gets a key ID.
  To restore on another device you still need the password, so keep it yourself.
- Automatic backups require complete retained history. Missing remote history, concurrent changes or a size limit
  fail the run and keep the last verified backup; they never silently switch to current-only coverage.
- Turning automatic backups off ("Turn off") or changing the location keeps the old files. Unfinished, modified or
  replaced files are kept and the problem is shown.
- On Windows, saving supports only local NTFS folders; network drives, FAT/exFAT, symlinks and junctions are refused.
- In the browser preview the automatic backup entry says it is not supported and is disabled. The steps above are
  for the Windows native app; for other platforms, current status is in [PROGRESS](../PROGRESS.md).

### Reset all data

- Already signed in with old Google notes: choose Open cloud reset in the old-data notice to reach Settings /
  Data and backup. If this device also has an old local copy, first choose Open Settings in the incompatibility
  notice and confirm discarding that copy. Google sign-in is kept; after reopening, the old-cloud notice leads
  back to Settings. Reset does not require reading or converting old notes.
- At the bottom of Data and backup, "Reset all data…" deletes the current workspace's notes, groups, unsaved changes,
  attachments, history, layout, shortcuts and automatic backup settings on this device. "Export a backup first" is
  next to it. In the "Reset all data?" dialog you must tick "I understand this cannot be undone" before "Delete
  permanently and reset" runs it. Saved backup ZIPs, shares not yet accepted in the Share inbox and other workspaces
  are not affected.
- In a Google workspace it also clears the data on Drive, and every device that uses the account is affected (see
  [Google setup](google-setup.md)). Update or stop every older client first, including unfinished reset/overwrite jobs:
  an older delete-all can also destroy the new dataset. The app records old file IDs using metadata, clears those
  captured leaf files in batches, then creates an empty dataset without reading or converting old contents. It retains obsolete folder containers to avoid
  deleting late, uncaptured children. Clearing and initialization show separate progress and resume unfinished work.
  Later legacy writes are retained and reported; removing them requires a new explicit reset preview.
- If the expected cloud dataset disappears or changes, local notes stay usable and sync pauses. The recovery dialog
  offers retaining/exporting this copy, previewing a rejoin of the verified cloud (with counts of local changes to
  discard), or recovering the current local data to a new Google generation. Recovery requires a saved encrypted
  safety backup and fresh note identities; uncached history and unavailable attachments are not promised.
- Cloud reset/restore resumes in background units after confirmation. A seeded restore publishes readiness only after
  all captured history uploads; edits made in the meantime remain queued for normal sync afterwards.
- Settings can stay open during a confirmed cloud reset. Account and sync shows preparation progress and any
  error; Data and backup also shows the current stage and retry action. If the reset stops, Continue resumes the
  saved job, including after reopening the app. Creating new cloud data and cleaning old files have separate
  progress counts. A running backup or another confirmation can temporarily pause the background work.

### When Pin It Anywhere can't open your notes

- On Windows, macOS and Linux, when the notes on this device can't be opened, Pin It Anywhere says why instead of a general
  error: the data is damaged, the disk is full, another program is using it, the system doesn't let Pin It Anywhere open
  its folder, or the data can't be decrypted (on Windows only the Windows account, on the PC, that used Pin It Anywhere
  before can read it; on Linux only the local key kept with the data can).
- It shows the data folder, with "Open folder" ("Show in Finder" on macOS) to see it in the file manager.
- For damaged data or data that can't be decrypted, "Set aside and start again…" asks first, then moves the database
  (on Linux with its local key) into a dated `set-aside-…` folder inside the data folder and opens empty data. Nothing
  is deleted. A Google workspace gets its notes, groups and attachments back from Drive after you sign in again; this
  device's desktop positions, colours, shortcuts and unsaved changes stay in the set-aside copy. The local
  workspace comes back only by restoring a backup ZIP. Preferences such as the display language stay as they were.
- A full disk, data another program holds, a folder Pin It Anywhere may not open, or a cause it can't tell is not offered
  setting aside: free space, close that program or check the folder's permissions, then start Pin It Anywhere again.

### Keep your own copies

- Without Google sync, clearing the browser's data loses the browser preview's data; save a ZIP first in
  Settings > Data and backup.
- Do not use the native database as a backup for another machine: on Windows, DPAPI needs the key of the original
  Windows account.
- The browser preview's IndexedDB and the native app are different profiles; existing data is not moved
  automatically.
- For what an MSIX update or uninstall keeps on Windows, see [Windows](#windows).

## The tray and menu bar

- Left-click the icon to open the main window; right-click it for the menu. On macOS, Control-click also opens the menu.
  Linux panels choose how to map physical clicks to tray actions; this is the app's primary/context-menu contract.
- While "Keep running in the tray when the main window closes" is on (the default; "Keep running in the menu bar when
  the main window closes" on macOS), closing the window (X) hides it to the tray (the menu bar on macOS). To quit, use
  "Exit Pin It Anywhere" in the Windows tray, or "Quit Pin It Anywhere" in the Linux tray and the macOS menu bar; all save first.
  When the switch is off, or when the tray is unavailable, X saves and quits.
- After X or the Windows tray's "Hide main window", the desktop notes and the authority over local data keep running.
  From the tray you can reopen the main window, use Quick capture, adjust notes or quit.
- All three desktop hosts use the same action order, in groups separated by lines: Open Pin It Anywhere and Hide main
  window (only when the window is shown, not minimized); Quick capture, Show or hide desktop notes and Adjust all note
  positions; Check for updates… (only where in-app updates are available); and Exit Pin It Anywhere on Windows or Quit
  Pin It Anywhere on macOS/Linux. Both exit commands save first. The macOS application menu also offers Quit Pin It Anywhere.
- While notes are being adjusted, Done adjusting replaces Adjust all note positions. Desktop actions are disabled
  while the desktop session is starting or an operation temporarily blocks input; Open and quitting remain available.
  Opening restores a hidden or minimized main window. Registered shortcuts are shown beside their desktop actions;
  refused or unavailable shortcuts are omitted. Each platform keeps its native menu appearance and shortcut symbols.
- The tray and menu labels follow Settings > General > Display language.
- If the focus has moved after a delay, click a floating note once to continue.
- Whether closing the main window keeps Pin It Anywhere in the tray is a switch in Settings > General; see
  [Startup and the main window](#startup-and-the-main-window).

## Updates

- The repository is now [pin-it-anywhere](https://github.com/sammykenny2/pin-it-anywhere). Builds configured with the
  old repository cannot discover updates through its redirect. When a new build is available, install it manually
  once and follow its data-transition instructions; keep the old app if it still holds local notes you need.
- Before installing the renamed app or signing in to its new Google project, export a complete backup from the old
  app and keep it available until the new installation can read your notes. Changed Apple/Android application
  identities may create a separate installation or credential boundary. The same Google account does not make the
  previous project's Drive notes appear automatically; restore a supported backup deliberately when needed.
- Settings > General > "Version and updates" shows the version, how it was installed and the in-app update state. A
  single button offers the next step: "Check for updates", "Download update", or "Restart and install". The tray and
  the menu bar also have "Check for updates…".
- Pin It Anywhere checks for updates only when you ask; there is no automatic or periodic check.
- "Restart and install" first saves unsaved text; Pin It Anywhere closes and reopens when the installation is done. Finish
  a running backup or restore first.
- Only installations that can upgrade in place support in-app updates: the installed Windows app (MSIX), a signed and
  notarized macOS app (updated with Sparkle) and Linux installed from the DEB (installed through pkexec). Other forms,
  such as the Windows ZIP, show only the version.

## Platform notes

### Windows

- Without a Google ID you can still record offline. Content, attachments, unsaved changes, layout and the backup
  journal are stored in `%LOCALAPPDATA%\PinItAnywhere\pinitanywhere.sqlite3` for the ZIP and Debug builds, or in
  `LocalCache\Local\PinItAnywhere\pinitanywhere.sqlite3` in the MSIX package's private data area. The payload is protected with
  DPAPI for the current Windows user.
- An MSIX update keeps the data. Uninstalling removes all local and Google account data, settings, credentials and
  cache in the package. Export a ZIP before reinstalling; exported files and Google cloud data are not affected.
- Data in an old standalone directory has to be exported as a ZIP with the old version and imported in the MSIX; it
  is not moved or deleted automatically.
- Only one app may run per data path; another window tells you to use the original window.
- Closing first waits for unsaved changes to be kept on the device and an automatic backup to finish. If a dialog or
  IME input is still open, finish it first. When a write fails, the window and your text are kept; reopening reads the
  committed content.

### macOS

- The close button keeps Pin It Anywhere in the menu bar; "Quit Pin It Anywhere" there saves and quits.
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
  current mode"); later you can switch with "Show desktop notes through XWayland" in Settings > Desktop notes
  ([ADR-040](decisions/040-gnome-wayland-xwayland-choice.md)), or start it directly with `GDK_BACKEND=x11 pin-it-anywhere`.
  Through XWayland, groups stay resident only on the Wallpaper layer
  ([ADR-039](decisions/039-gnome-desktop-icons-and-x11-scene-size.md)).
- On layer-shell desktops such as Raspberry Pi OS (labwc), the resident layers are not limited by the overlay (the
  default pcmanfm desktop has no Wallpaper layer). Adjust mode likewise covers the whole screen with the overlay and
  hides the main window.
- On Wayland desktops without a global shortcuts portal, such as sway and wayfire, Pin It Anywhere can't register its keys.
  Bind keys in the compositor's own configuration to Pin It Anywhere's named actions instead, which run while Pin It Anywhere
  is open: `quick-capture`, `toggle-desktop`, `adjust-all`, `done-adjusting`, `region-1` to `region-9` (the group in
  that region steps on, as its key does), `show-main` and `quit` (save and quit, as in the tray). For example, in
  sway's config: `bindsym Ctrl+Shift+n exec gapplication action <app id> quick-capture`; in wayfire.ini, under
  `[command]`: `binding_capture = <ctrl> <shift> KEY_N` and `command_capture = gapplication action <app id> quick-capture`.
  `<app id>` is Pin It Anywhere's application ID, the name of its icon in `/usr/lib/pin-it-anywhere/Icons` without `.png`
  (`dev.sammykenny2.pinitanywhere` for builds without their own); `gapplication` comes with the GLib tools (`libglib2.0-bin`).
  Without an activation token from the compositor, the main window may come to the front without taking the focus.
  Hyprland's own portal offers global shortcuts, so there Settings > Shortcuts registers them as on GNOME or KDE
  (not checked on Hyprland). On labwc, keep using the keybinds Settings writes into rc.xml.

### Phones

- Phones have no desktop notes, so there is no layer option, no Desktop or Shortcuts page in Settings and no Adjust
  position controls. The sidebar and the new-note button work as described in [Getting started](#getting-started).

### Browser preview

- The browser preview is not an OS desktop overlay. Its "Desktop" view draws the notes inside the page, and groups
  have no layer option there; the real layering, click-through and global shortcuts come from the native hosts.
- It has no Google sync; back it up as described in [Keep your own copies](#keep-your-own-copies).
- Shortcuts work only in the current window, and region keys only toggle a group's Adjust position.
- Automatic backups are not supported there and their entry is disabled.
