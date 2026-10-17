# ADR-007: Shared card scene and platform host boundaries

## Status

Proposed, 2026-10-04. Product semantics follow the accepted [ADR-006](006-card-group-and-formation-semantics.md).
This proposal gives the implementation direction; it does not choose a renderer framework, core language or native
window topology.
Protocol limits and required conditions such as no data loss cannot be ignored just because this ADR is still
Proposed.

## Context

Group operations need the whole group raised, the selected card frontmost, free moves, formation and hints for the
target of a group change.
Sources must also be able to extend from Drive to API sources, and renderers are not only on the desktop.
Wayland layer-shell does not define the order of several independent surfaces within the same layer,
so "one native window per card" cannot be relied on as a cross-platform guarantee of arbitrary card z-order.
See the [platform research](../research/2026-10-04-desktop-interaction-platform-feasibility.md).

## Decision

Proposed: the following logical responsibilities. The names do not prescribe a language, a library or a service
that must be added:

| Boundary | Responsibility | Must not take on |
|---|---|---|
| Content / Group core | Card identity, content, membership, conditional commands, drafts | OS window handles, device coordinates |
| Source coordinator | Consistent local state, outbox, provider session, kept conflicts | Deciding click gestures or automatic layout |
| NoteSource / FileStore | Source semantics and capabilities; file sources also attach a transport | Using Drive file order to decide card stacking order |
| DeviceLayoutStore | Group regions, positions/sizes, basic stacking order, undo | Global shared positions or source tokens |
| FormationPlanner | A layout plan from fixed input, overflow and size-consent information | Moving native windows directly during the calculation |
| InteractionController | Scope, focus, card selection, editing, dragging, candidate group change | Saving a whole old note over newer content |
| Scene / Renderer | Drawing cards, highlights, target hit testing, controllable card order | Connecting to Google itself, or persisting display order as membership |
| PlatformHost | OS layers, displays, input regions, focus, shortcuts, lifecycle | Forcing cardId = windowId |

### Presentation surface proposal

- Especially on Wayland, prefer a small number of shared drawing surfaces, one per "output display × effective
  system layer", with card order inside a layer controlled by the renderer.
  An equivalent design that controls subsurfaces explicitly may also be evaluated.
- An operation on a specific group may temporarily move that group's presentation to a floating surface while the
  other cards stay in their original layer; moving the presentation does not copy card data, change the cardId or
  change the local logical position.
- Windows/macOS do not have to use the same number of native surfaces as Wayland; what is shared is the behaviour
  contract.
- Hint surfaces only draw visuals and do not take pointer capture or keyboard focus; the actual input region
  covers only positions where operations are allowed.
- During normal viewing, mouse clicks pass through; using a full-screen transparent window must not make the whole
  desktop unclickable.
- Native surface alpha, input regions, redraws and partial pass-through must be proven per backend;
  one platform's API for ignoring the mouse on a whole window is not treated as per-region hit testing on all
  three platforms.

### Required contract information

Platform capabilities distinguish at least: desktop-layer, wallpaper-layer, temporary-floating, input-regions,
keyboard-on-demand, global-shortcut backend and monitor mapping.
This is a typed capability report, not developers guessing from the OS name and always returning true.
An unsupported capability needs a reachable alternative entry and an accurate product description; another
platform must not be dropped automatically or quietly turned into an ordinary window.

The Group type needs a stable ID; besides cards, FileNoteSource must define the version and references of shared
group metadata.
If a future source has no native groups, the authoritative location of the attached metadata must be designed
explicitly, not stored separately by each renderer.
Phones and the main window can send MoveCardToGroup directly, without depending on the desktop grid or the Shift
key.
Whether dynamic plugins go into 1.0 still needs product scope confirmation; the abstract interface itself does not
mean running external programs.

## Consequences

### Positive

Card ordering, formation and group changes can be validated with platform-independent scenarios; the local layout
does not pollute sync data.
Linux protocol limits enter the technology choice explicitly instead of being discovered at release time as an
inability to cycle freely.

### Negative

Shared surfaces need regional input control, display coordinate mapping and a redraw strategy.
Dragging across displays and the visual hand-over between different system layers need integration acceptance;
testing the pure model is not enough.

### Neutral

This does not specify Tauri, Swift, WebView or a canvas library, nor does it guarantee one shared set of native
window code.
The existing 0.1.0 host can serve as partial experience, but its HTTP/SQLite server is not a required dependency
of the Drive 1.0.
Before adopting any third-party backend, its actual license, linking, distribution and store compatibility must be
checked.

## Alternatives Considered

| Option | Assessment |
|---|---|
| One native window per card, relying entirely on OS ordering | Cannot be a general guarantee; ordering within a Wayland layer is undefined |
| Rebuilding native windows on every cycle to try for ordering | Prone to flicker and to losing focus/capture; not an explicit protocol guarantee |
| All cards always in a single topmost full-screen window | Cannot directly keep non-operated groups on the desktop and let blank areas pass clicks through |
| Only ordinary app windows, to avoid desktop integration | Can serve as a test renderer or a fallback for specific environments, but cannot cancel the desktop product goal |
| Forcing all sources into files / all platforms onto one backend | Hides the heterogeneity in the wrong abstraction; not adopted as a premise |

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [Platform capabilities and evidence](../research/2026-10-04-desktop-interaction-platform-feasibility.md)
- [PLAN-003](../plans/003-desktop-interaction-implementation.md)
- [Earlier proposal on sources and renderers](004-google-drive-notes-mvp.md)
