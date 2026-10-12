import type { Rect, Scope, ResidentLayer } from './desktop.js';
/** Presentation-only protocol; these documents never receive NativeRequest storage or backup capabilities. */
export interface DesktopEditor {
  cardId: string; draftId: string; viewId: string; text: string; sequence: number;
}
export interface DesktopFrame {
  protocol: 1; sessionId: string; sequence: number; workspaceRevision: number; layoutRevision: number;
  groups: { id: string; name: string; color: string; region: (Rect & { groupId: string | null }) | null }[];
  operationScope: Scope; activeGroupId: string | null;
  cards: { id: string; groupId: string; revision: string; summary: string; text: string; format: string;
    attachmentCount: number; rect: Rect; layer: ResidentLayer; interactive: boolean; draggable: boolean;
    editing: boolean; selected: boolean; completed: boolean; mine: boolean; color: string }[];
  editor: DesktopEditor | null;
  dropTarget: { groupId: string; kind: 'label' | 'region' } | null;
  fallbacks: { cardId: string; requested: ResidentLayer; effective: ResidentLayer }[];
}
export interface DesktopCommand {
  sessionId: string; id: string; serial: number;
  method: 'pointer.down' | 'pointer.move' | 'pointer.up' | 'pointer.cancel' | 'card.select' | 'card.edit' | 'card.details' | 'card.transfer'
    | 'editor.change' | 'editor.save' | 'editor.end' | 'editor.full' | 'interaction.escape' | 'interaction.shortcut'
    /** Adjust overlay controls: end adjust mode, or arrange the adjusted scope with args.kind stack, spread or undo. */
    | 'interaction.done' | 'layout.arrange';
  args: Record<string, unknown>;
}
export interface DesktopInfo {
  /** Native scenes: always floating plus desktop, wallpaper or both. */
  sessionId: string; referenceDpi: number; layers: ResidentLayer[];
  /** Layers a group can rest on, defaulting to `layers`; a resting paper on another layer is shown on the desktop or wallpaper. */
  residentLayers?: ResidentLayer[];
  /**
   * Adjust mode is a modal overlay: the topmost scene tints and takes the whole work area, offers its own controls,
   * and the main window is hidden until adjust mode ends. Used on GNOME, where a keep-above scene blocks other windows.
   */
  adjustOverlay?: boolean;
  /**
   * Background is a real layer-shell band; icon placement depends on the desktop shell. Desktop-window is an X11
   * desktop-type window that the shell's own icon window covers, as with GNOME's desktop icons.
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
}
export interface ShortcutRegistration {
  key: string; target: string;
  status: 'available' | 'suspended' | 'conflict' | 'unavailable' | 'reserved' | 'editing' | 'typing' | 'invalid';
}
/** Main document only. Scene documents cannot invoke these methods. */
export type DesktopOwnerCall =
  | { method: 'desktop.info' | 'desktop.start' | 'desktop.hideMain' | 'desktop.intent'; params: Record<string, never> }
  | { method: 'desktop.showMain'; params: { intent: string | null } }
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
  | { method: 'desktop.focus'; params: { intent: string; sequence: number } };
// Command serials are monotonically admitted per view. Replays outside the bounded receipt cache reject.
// Native transfers are principal-bound, 256 KiB chunks, SHA-256 validated; frame 128 MiB, command 16 MiB.
// A flush acknowledgement must follow the final durable editor.change acknowledgement, never just local input.
// With prepareFrames, scene.prepare({sequence, topology}) must be accepted before rendering the downloaded frame.
// Windows hides an attached surface whose paper geometry changes before its browser erases the old paper region.
// A pointer.up/cancel reply follows publication of the resulting geometry; the scene drains pending frame reads before clearing its preview.
