# ADR-059: Settings pages and their entry points

## Status

Accepted, 2026-10-24, at the maintainer's request.

## Context

The account chip at the bottom left of the sidebar and the gear beside it opened the same Settings dialog. The account
chip opened Account and sync. The gear reopened the last page shown, which was Account and sync the first time. So
the two controls looked like duplicates. The startup switches and the version and updates section sat in the middle
of the Desktop page, between the group regions and Reset desktop layout. In Data and backup, whether automatic backup
runs came after export and restore.

## Decision

- **Entry points**
  - The account chip always opens Account and sync.
  - The gear and Ctrl+, (Command+, on macOS) always open General; they no longer return to the last page.
  - In a phone-sized window, the gear opens the list of pages, as phone settings do.
  - The status-bar conflict button still opens Versions and conflicts, and the source-reset prompt still opens Data
    and backup.
- **Page list**
  - The account is a card at the top of the list: avatar, name and sync status. As in Windows 11 Settings and macOS
    System Settings, it is not one row among the others.
  - Below the card come two groups. The first is how the app behaves: General, Desktop notes and Shortcuts. The
    second is the notes' data: Data and backup, and Versions and conflicts.
  - The Desktop page is renamed Desktop notes, so it names what it configures rather than the computer.
- **General**: "Version and updates", then "Startup", then "Language". On the web and phones, which have no host
  settings, only Language shows.
- **Desktop notes**: the display switches and My group, then Group regions, then "Show desktop notes through XWayland"
  (GNOME Wayland only), then Reset desktop layout last.
- **Data and backup**: automatic backup, export, restore, then Reset all data last.

No setting is added or removed, and the controls inside each section are unchanged.

## Consequences

### Positive

- Each control in the sidebar footer lands on its own page, the same page each time.
- Version, update state and startup behaviour are on the first page the gear opens. PowerToys groups the same items
  on its General page.
- Destructive actions are last on their pages.

### Negative

- Users of earlier versions find startup and updates moved from Desktop to General.
- The gear no longer remembers the last page.

### Neutral

- Catalog keys keep their names (`settings.desktop.startup`, `settings.update.heading`), although the sections now
  show on General.

## Alternatives Considered

### Version and updates on a separate About page

- **Pros**: matches the macOS and Windows "About" convention.
- **Cons**: adds a page for two rows, and the gear would not land on the update state.
- **Why rejected**: the maintainer asked for the gear to open the page with the version, updates and startup
  options.

### Keep the gear returning to the last page

- **Pros**: returns to what the user was doing.
- **Cons**: the gear and the account chip can land on the same page, which is the problem this decision fixes.
- **Why rejected**: entry points have fixed destinations.

## References

- [ADR-043](043-desktop-window-placement-and-startup-behavior.md) startup behaviour, [ADR-044](044-desktop-in-app-updates-from-github-releases.md)
  in-app updates, [ADR-040](040-gnome-wayland-xwayland-choice.md) the XWayland switch.
- [SPEC-006](../specs/006-desktop-window-startup-and-updates.md).

---

*Decision made: 2026-10-24*
*Decision makers: maintainer, Claude*
