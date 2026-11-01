import type { Rect, Scope, ResidentLayer } from './desktop.js';
/** Presentation-only protocol; these documents never receive NativeRequest storage or backup capabilities. */
/** `draftId` names the edit session, whose writes are the note's unsaved changes (ADR-061). */
export interface DesktopEditor {
  cardId: string; draftId: string; viewId: string; text: string; sequence: number;
}
export interface DesktopFrame {
  protocol: 1; sessionId: string; sequence: number; workspaceRevision: number; layoutRevision: number;
  /** The display topology the frame was laid out for. */
  topology: number;
  /** The main window's UI locale; the scene draws its own text in it (docs/i18n.md). */
  locale: 'en' | 'zh-TW';
  groups: { id: string; name: string; color: string; region: (Rect & { groupId: string | null }) | null }[];
  operationScope: Scope; activeGroupId: string | null;
  /** `revision` is null for a note never saved; `unsaved` marks a paper showing unsaved changes (ADR-061). */
  cards: { id: string; groupId: string; revision: string | null; summary: string; text: string; format: string;
    attachmentCount: number; attachments?: { id: string; name: string }[]; rect: Rect; layer: ResidentLayer; interactive: boolean; draggable: boolean;
    editing: boolean; selected: boolean; completed: boolean; mine: boolean; color: string;
    /** From 0.3 to 1: below 1 only for a paper resting on the Top layer, whose background then lets the work show through. */
    opacity: number; unsaved?: boolean }[];
  editor: DesktopEditor | null;
  dropTarget: { groupId: string; kind: 'label' | 'region' } | null;
  fallbacks: { cardId: string; requested: ResidentLayer; effective: ResidentLayer }[];
  /** A short on-screen notice after a group or all-groups key, drawn by the topmost scene. */
  notice: { id: string; rect: Rect; title: string; text: string; step: number; steps: number } | null;
  /** The key that starts a quick move on a resting paper (SPEC-003, 2026-10-24), or null while it is off or adjusting. */
  quickMove: 'meta' | 'ctrl' | null;
}
export interface DesktopCommand {
  sessionId: string; id: string; serial: number;
  method: 'pointer.down' | 'pointer.move' | 'pointer.up' | 'pointer.cancel' | 'card.select' | 'card.edit' | 'card.transfer'
    | 'editor.change' | 'editor.save' | 'editor.end' | 'editor.full' | 'interaction.escape' | 'interaction.shortcut'
    /** Discards the note's unsaved changes, returning it to its saved revision, and closes the quick edit (ADR-061). */
    | 'editor.cancel'
    /** Adjust overlay controls: end adjust mode, or arrange the adjusted scope with args.kind stack, spread or undo. */
    | 'interaction.done' | 'layout.arrange' | 'attachment.preview' | 'attachment.open'
    /** Ticks checklist step args.task of a paper that takes clicks, drawn from note revision args.revision. */
    | 'card.check';
  /** pointer.down with args.quick true starts a quick move of a resting paper instead of an adjust drag; card.edit opens a
   * resting paper for a quick edit on the Top layer. */
  args: Record<string, unknown>;
}
export interface DesktopInfo {
  /** Native scenes: always floating plus desktop, wallpaper or both. */
  sessionId: string; referenceDpi: number; layers: ResidentLayer[];
  /** Layers a group can rest on, defaulting to `layers`; a resting paper on another layer is shown on the desktop or wallpaper. */
  residentLayers?: ResidentLayer[];
  /**
   * Adjust mode is a modal overlay: the topmost scene tints and takes its whole viewport and offers its own controls,
   * and a main window that had the focus as adjust mode began is moved aside (desktop.mainVisible) until it ends.
   * Every desktop host reports it; the browser preview has no overlay.
   */
  adjustOverlay?: boolean;
  /**
   * A quick move's paper rides the Top layer while it drags and rests on its own layer again at the drop. Windows
   * reports it: its Desktop-layer scenes are attached to Explorer and cannot show a paper moving inside them.
   */
  liftQuickMove?: boolean;
  /**
   * Background is a real layer-shell band; icon placement depends on the desktop shell. Desktop-window is an X11
   * desktop-type window that the shell's own icon window covers, as with GNOME's desktop icons; on GNOME Xorg only
   * once the icons have been clicked and risen. Unavailable also covers layer-shell under pcmanfm --desktop, which
   * draws the wallpaper and the icons on one background surface that papers could only cover.
   */
  wallpaperPlacement?: 'background' | 'desktop-window' | 'unavailable';
  workAreas: (Rect & { id: string; primary: boolean })[];
  views: { viewId: string; layer: ResidentLayer; viewport: Rect }[];
}
/** scene.info response. Hosts opt in before a scene sends the optional scene.prepare call. */
export interface DesktopSceneInfo {
  sessionId: string; viewId: string; layer: ResidentLayer; active: boolean;
  topology: number; viewport: Rect; bindings: Record<string, string>;
  prepareFrames?: boolean;
  /** The topmost scene draws the adjust overlay and its controls; see DesktopInfo.adjustOverlay. */
  adjustOverlay?: boolean;
  /** See DesktopInfo.liftQuickMove: a scene below the Top layer leaves the paper where it is until a frame lifts it. */
  liftQuickMove?: boolean;
}
export interface ShortcutRegistration {
  key: string; target: string;
  /** Unwritten: on labwc the key is not yet in the keybinds Work Fleet writes to the user's rc.xml. */
  status: 'available' | 'suspended' | 'conflict' | 'unavailable' | 'reserved' | 'editing' | 'typing' | 'invalid' | 'unwritten';
}
/** Linux on labwc only: whether the user's rc.xml holds the current keys in Work Fleet's block; null elsewhere. */
export interface LabwcShortcuts { state: 'absent' | 'outdated' | 'current'; path: string }
/** Main document only. Scene documents cannot invoke these methods. */
export type DesktopOwnerCall =
  | { method: 'desktop.info' | 'desktop.start' | 'desktop.hideMain' | 'desktop.intent'; params: Record<string, never> }
  /** Shows the main window for a current intent; returns { activated, hidden }, hidden meaning it was in the tray or never shown. */
  | { method: 'desktop.showMain'; params: { intent: string | null } }
  /** Moves a main window that had the focus aside for the adjust overlay (false) and brings back only that one (true). */
  | { method: 'desktop.mainVisible'; params: { visible: boolean } }
  | { method: 'desktop.frame.begin'; params: { size: number; sha256: string } }
  | { method: 'desktop.frame.append'; params: { token: string; offset: number; base64: string } }
  | { method: 'desktop.frame.publish' | 'desktop.frame.discard'; params: { token: string } }
  | { method: 'desktop.command.read'; params: { ticket: string; offset: number } }
  | { method: 'desktop.reply'; params: { ticket: string; ok: boolean; result?: unknown; error?: { code: string; message: string } } }
  | { method: 'desktop.flush'; params: { id: string; viewId: string; draftId: string } }
  | { method: 'desktop.flush.cancel'; params: { id: string } }
  | { method: 'desktop.flush.release'; params: { id: string; viewId: string | null; draftId: string | null } }
  | { method: 'desktop.shortcuts.configure'; params: { bindings: { key: string; target: string }[] } }
  | { method: 'desktop.shortcuts.block'; params: { blocked: boolean } }
  /** Writes the current keys into rc.xml's Work Fleet block and reloads labwc; returns registrations and LabwcShortcuts. */
  | { method: 'desktop.shortcuts.labwc'; params: Record<string, never> }
  | { method: 'desktop.focus'; params: { intent: string; sequence: number } }
  /** Gives the keyboard to the Top-layer view showing a quick edit once it has applied `sequence`; honoured only shortly
   * after a scene asked for the edit, and without bringing the app to the front. */
  | { method: 'desktop.focusEditor'; params: { viewId: string; sequence: number } };
// Command serials are monotonically admitted per view. Replays outside the bounded receipt cache reject.
// Native transfers are principal-bound, 256 KiB chunks, SHA-256 validated; frame 128 MiB, command 16 MiB.
// A flush acknowledgement must follow the final durable editor.change acknowledgement, never just local input.
// With prepareFrames, scene.prepare({sequence, topology}) must be accepted before rendering the downloaded frame.
// Windows hides an attached surface when a paper it keeps moves or resizes there, before its browser erases the old
// paper region; a paper that only leaves or arrives changes the region instead, dropping what leaves at scene.prepare.
// A pointer.up/cancel reply follows publication of the resulting geometry; the scene drains pending frame reads before clearing its preview.
