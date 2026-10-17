# ADR-035: Background and region life cycle of Windows attached scenes

## Status

Accepted, 2026-10-09; revised the same day after testing resumed. The isolated regression tests pass; the user's original
ghosting has not been reproduced yet.
Supplements [ADR-017](017-windows-composition-surface-and-input.md) and [ADR-030](030-windows-explorer-wallpaper-layer.md).

## Context

After installing the fixed build on Windows 11 23H2, the user could still reproduce white ghosting: a note whose position had
been adjusted, when moved by stack or spread, left a white block at its old position on a black wallpaper, with no dragging
needed. The previous round's early hide and asynchronous Explorer invalidation did not fix it.
The earlier mock host had a white background, so returning to white after hide could not tell the original background apart
from the leftover white WebView background.
The user recalls that the earlier 1.0.1 had no problem on 25H2; that historical package has not been checked and no
same-condition comparison has been built, so the root cause cannot be determined from it.

Before the fix, attached scenes got their image from the windowed WebView2 child window, and the default background color of
the WPF host and the WebView was white.
`SetWindowRgn` sends position change messages, and saving valid client bits was not disabled. The original hide cleared the
region before hiding, so the old paper region was already gone when the window was taken down, and the asynchronous background
repaint could wait until the new paper appeared.
These paths can be checked against the source code and the APIs; the specific compositor root cause of the persistent ghosting
on 23H2 is still unproven.

## Decision

- Attached scenes still get their image through DirectComposition from the windowed WebView2 child window; the WPF background
  is transparent, the windowed WebView goes back to the original white DefaultBackgroundColor, and the paper background is
  still painted by the page.
  No transparent color key is set and the background is not filled with black; a black wallpaper must not be used to mask an
  error that affects any wallpaper.
- The previously added `WS_EX_NOREDIRECTIONBITMAP` is withdrawn: on 23H2, setting the style to `0x200080` with SetWindowLongPtr
  in WPF SourceInitialized reported Win32 error 87, and the window could not be created. The error diagnostics keep the
  original, target and actual style; the error was not swallowed.
  The transparent windowed WebView is withdrawn too: although the browser preview looked right, pink pixels on the real screen
  changed from `(224,80,160)` to `(206,73,147)`/`(196,70,140)`; with the white background restored, the actual colors are correct.
- The app's own hosts use `WS_CLIPCHILDREN | WS_CLIPSIBLINGS`; `WM_WINDOWPOSCHANGING` of the attached input HWND
  adds `SWP_NOCOPYBITS`, which also covers the position updates implied by `SetWindowRgn`, so client pixels of the previous
  region are not copied. The original layered floating scene keeps WPF composition and native capture.
- Hide first hides both surfaces while keeping the old region, then asks the original parent to invalidate, and only then sets
  the empty region. Setting the region while hidden does not request a redraw, and Dispose also goes through hide first.
  The background repaint is still an asynchronous request and is not treated as a barrier that guarantees the white block is
  gone; this round focuses on disabling the host's white background and the preservation of old pixels.
- Only the app's own HWNDs change; Explorer styles, the registry, wallpaper files and wallpaper settings are not modified, and
  Explorer is not restarted. The previous round's `scene.prepare` is kept: when geometry changes, the attached scene is taken
  down first, and the DOM is changed after that.
- The mock host regression now uses a black background and covers hosts with and without redirection, region updates that
  shift, shorten or spread papers without pointer input, prepare/hide, and direct replacement of the visible region; every
  step checks the new paper and that the old position shows the background again, instead of checking only the last hide.
  The host without redirection uses its own black backdrop as the baseline, so that an app behind it is not taken for the
  background.
- A new probe runs a real owner formation: isolated data creates two notes, synthetic scene events save adjusted positions
  through the existing client and bridge, and the real main window stacks and spreads, returns to the desktop layer and the
  wallpaper layer; the original screen outside the new papers is compared pixel by pixel and the test area is captured.
  Synthetic DOM events do not stand for physical mouse acceptance. An installed copy also passed the isolated cases; the
  trigger of the user's white block is still unconfirmed.
- The user explicitly restored permission for testing and screenshots; the work continues with 0.1.1, the existing local
  certificate and the packaging SOP. The actual evidence is in the git history and `docs/testing.md`.

## Consequences

### Positive

The style that prevented scene creation is removed and the correct windowed WebView colors are kept; taking scenes down and
replacing regions now handle the life cycle of old pixels explicitly.
A black background and comparison with the original desktop pixels can tell white blocks from the background and check the old
position while the new paper is shown.

### Negative

The user's original ghosting has not been reproduced in the isolated cases, so passing does not mean the root cause is fixed,
and there is no device comparison for newer Explorer versions.
The background repaint still depends on Explorer and compositor scheduling; physical fast drags and the real workspace still
need acceptance.

### Neutral

The formation and geometry save contracts do not change, and no browser, dependency, listener or version is added.
There has been no independent review so far; the author's tests are not an independent review.

## Alternatives Considered

### Keep the asynchronous redraw of the whole parent

The user has shown that it is not enough; the same approach must not be delivered again, and API success must not be taken to
mean that the ghosting is gone.

### Reapply the wallpaper on every formation

An earlier manual recovery did clear the ghosting, but changing the user's global desktop state is not a suitable product
update path and violates the boundary of ADR-030.

### Simply replace the white background with black

That only masks the symptom on black wallpapers; other wallpapers would still show wrong blocks.

### Wait for Explorer with a synchronous WM_PAINT

Windows reparented across processes with SetParent may share an input queue, and `SendMessageTimeout` does not guarantee a
timeout within the same queue.
No such synchronous paint wait is added to the WPF dispatcher, to avoid unbounded blocking.

## References

- [SetWindowRgn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowrgn)
- [SetWindowPos / SWP_NOCOPYBITS](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)
- [WM_WINDOWPOSCHANGING](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-windowposchanging)
- [Extended Window Styles / WS_EX_NOREDIRECTIONBITMAP](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles)
- [RedrawWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-redrawwindow)
- [SendMessageTimeout](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw)
- [Testing](../testing.md), [PROGRESS](../../PROGRESS.md)

*Decision made: 2026-10-09*
