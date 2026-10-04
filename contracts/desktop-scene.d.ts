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
    | 'editor.change' | 'editor.save' | 'editor.end' | 'editor.full' | 'interaction.escape';
  args: Record<string, unknown>;
}
export interface DesktopInfo {
  sessionId: string; referenceDpi: number; layers: ResidentLayer[];
  workAreas: (Rect & { id: string; primary: boolean })[];
  views: { viewId: string; layer: ResidentLayer; viewport: Rect }[];
}
// Command serials are monotonically admitted per view. Replays outside the bounded receipt cache reject.
// Native transfers are principal-bound, 256 KiB chunks, SHA-256 validated; frame 128 MiB, command 16 MiB.
// A flush acknowledgement must follow the final durable editor.change acknowledgement, never just local input.
