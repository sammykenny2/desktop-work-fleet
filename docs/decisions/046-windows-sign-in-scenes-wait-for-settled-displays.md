# ADR-046: A Windows sign-in start waits for settled displays before attaching scenes to Explorer

## Status

Accepted, 2026-10-14. After reading the `host.log` of two sign-in crashes, the user said: "First do the fix that waits
at sign-in for the displays to settle before attaching the scenes."

Revised 2026-10-15:
- At the 0.2.5 sign-in start the wait did not take effect, and the scenes were attached to Explorer after 2.8 seconds.
  Both displays were present at start, and the built-in display was primary.
- About 100 seconds later Windows turned off the built-in display; 30 seconds after that, the external display was
  renumbered and the app crashed right away ([ADR-049](049-windows-attached-scenes-render-in-software.md)).
- The `host.log` of that time does not show why the wait let the scenes through. According to the code, three cases
  let them through at once:
  - `lid=open`: Windows reported the lid as open. Inference (unverified): at boot Windows itself also believed the lid
    was open, which is why it turned on the built-in display.
  - `lid=unreported`: no lid report had arrived yet at decision time, which counts as open. The decision is made only
    once, and a `lid closed` arriving later does not make the scenes wait again; a `lid closed` that appears after
    `scenes attaching` is this case.
  - `builtIn=unread other=unread`: the display configuration could not be read, which counts as no need to wait.
- So `host.log` now records the decision's inputs, to tell these cases apart next time:
  - Every lid state report from Windows writes one line, `lid closed` or `lid open`, including the one reported at
    registration.
  - The `scenes waiting` and `scenes attaching after` lines gain the decision inputs, for example
    `; lid=open builtIn=on other=on changed=none`.
- The wait itself can only avoid the first change, and the decision rules are unchanged. The next fix direction is in
  ADR-049.

## Context

- This laptop usually stays closed and uses only an external 4K display. After boot, the lid has to be opened and
  closed again before the external display shows a picture, and only then does the user sign in.
- Two sign-ins, on 0.2.1 (booted 21:12) and 0.2.2 (booted 23:00), both crashed (ADR-045). The 0.2.2 `host.log`:
  - About 60 seconds after sign-in, Windows started Work Fleet through the StartupTask.
  - Work Fleet read two displays: the closed built-in display (1920×1080, 125%) as primary, and the external 4K (150%)
    on the right.
  - Only about 75 seconds after sign-in did Windows turn off the built-in display, leaving only the external 4K. Work
    Fleet started applying the new layout, and about 1 second later the render thread failed.
- The 0.2.1 dump shows the same display change. Both switches happened about 75 seconds after sign-in, regardless of
  how long Windows took to start Work Fleet itself.
- After sign-in, the same switch with DisplaySwitch and closing the lid after the app started both failed to reproduce
  it (`Test-WindowsDisplaySwitch.ps1`).
  With the lid closed, Windows does not let DisplaySwitch extend to the built-in display, so "lid closed but built-in
  display still active" occurs only at a boot sign-in.
- The wrong scaling the user saw after sign-in is exactly the period when the built-in display is still primary.

## Decision

- Only for a sign-in start: the scenes (desktop layer, wallpaper layer, floating layer) create no windows and do not
  attach to Explorer until the displays settle. The main window and the data start as usual.
- Decision rules (core `SignInDisplays`):
  - Wait while the lid is closed, the built-in display is still on, and there are other displays. Built-in means a
    display connected as internal, LVDS, embedded DisplayPort or UDI embedded.
  - When the display list has just changed, wait until it has not changed for 5 seconds.
  - Wait at most 3 minutes from when the main window loads; after that, attach the scenes as usual and log the reason.
  - No lid state (a desktop PC) counts as open; closed with only the built-in display does not wait, because Windows
    will not turn it off.
- Lid state: the display monitor window registers `GUID_LIDSWITCH_STATE_CHANGE`; Windows reports the current state at
  registration and notifies on every change. Lid changes and a once-per-second check both re-run the decision. The
  connection type is read from the active targets of `QueryDisplayConfig`.
- `host.log` records `scenes waiting: <reason>` (when the reason changes) and `scenes attaching after <seconds>s`; on
  reaching the limit it adds `although <reason>`.
  Since 2026-10-15 both lines carry the decision inputs, and every lid report is logged too (see the revision under
  Status).

## Consequences

### Positive

- At the moment the built-in display is turned off at sign-in, Explorer holds no Work Fleet scene windows.
- The next sign-in's `host.log` shows how long the scenes waited and why.
- A normal boot (displays already settled) costs only one extra decision; the test identity on this machine logged
  0.6 seconds.

### Negative

- While waiting, no notes are visible on the desktop, for up to 3 minutes; the data, the main window and the tray are
  unaffected.
- At a sign-in start the main window is still shown at an off-screen position, so WPF still has one render target.
  If a render thread failure still happens while the scenes wait, the cause is not scene attachment to Explorer;
  `host.log` would show "scenes waiting" followed by "fatal".
- Only one kind of "displays not yet settled" is handled: a closed laptop lid. Other display changes that happen only at
  sign-in are covered only by the 5-second quiet period and the 3-minute limit.
- The cause of the render thread failure is still unknown.

### Neutral

- A manual launch does not wait.
- The wait only delays `Start()`; the page still calls `desktop.start` as usual and gets the layout when the scenes are
  ready later.

## Alternatives Considered

### Alternative 1: A fixed delay after sign-in

- **Pros**: Simple, with no need to read the lid or connection types.
- **Cons**: 75 seconds is this machine's value, and other machines differ; every sign-in would wait.
- **Why rejected**: The lid and built-in display states can be read directly, so there is no need to guess a time.

### Alternative 2: Wait only until the display list has been unchanged for a while

- **Pros**: Does not depend on the lid state.
- **Cons**: In the 0.2.2 case the display list had been unchanged for a minute when Work Fleet started, and Windows
  turned off the built-in display 14 seconds later.
- **Why rejected**: It cannot predict this switch; it is kept only as the 5-second quiet period after a switch.

### Alternative 3: Software rendering for the scenes (ADR-045 Alternative 3)

- **Pros**: May avoid GPU-related render thread failures.
- **Cons**: The cause is unknown, so it is not guaranteed to help; 4K full-screen scenes perform worse; it can be
  verified only by rebooting.
- **Why rejected**: First avoid the known dangerous moment; if crashes still happen while waiting, evaluate this
  option.
  On 2026-10-15 this changed to software rendering for only the scenes attached to Explorer; see ADR-049.

## References

- [ADR-045](045-windows-fatal-error-leaves-explorer-first.md): leaving Explorer first on a crash, `host.log`
- [ADR-043](043-desktop-window-placement-and-startup-behavior.md): start at sign-in and hidden start
- [docs/testing.md](../testing.md): core probe, `--platform`, `--sign-in-hold`, `Test-WindowsDisplaySwitch.ps1`

---

*Decision made: 2026-10-14*
*Decision makers: User, Claude*
