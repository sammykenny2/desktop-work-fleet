/** Renderer-neutral v1 desktop semantics. Coordinates are logical desktop units, never raw device pixels. */
import type { RevisionRecord, SyncState } from './sync.js';
import type { RestoreReceipt } from './backup.js';
export type Id = string;
export type Revision = string;
export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export type Scope = { kind: 'none' } | { kind: 'all' } | { kind: 'group'; groupId: Id };
export type ResidentLayer = 'desktop' | 'wallpaper' | 'floating';

export interface Content {
  format: string;
  text: string;
  title?: string;
  attachments?: { id: Id; name: string; mediaType?: string; size?: number }[];
  [extension: string]: unknown;
}
export interface Group { id: Id; name: string; revision: Revision; deleted: boolean; redirectGroupId?: Id }
export interface GroupMergePlan {
  kind: 'group-merge';
  sourceId: Id;
  targetId: Id;
  sourceName: string;
  targetName: string;
  fingerprint: string;
  cards: { id: Id; summary: string; deleted: boolean; archived: boolean; completed: boolean }[];
  draftCount: number;
}
export interface Card {
  id: Id;
  revision: Revision;
  groupId: Id;
  content: Content;
  deleted: boolean;
  archived: boolean;
  completed: boolean;
}
export interface SourceRef { provider: string; accountId: string; collectionId: string }
export interface Snapshot { cards: Card[]; groups: Group[]; writable: boolean; conflicts?: unknown[] }
export interface Placement extends Rect {
  order: number;
  visible: boolean;
}
export interface Grid { rows: number; columns: number; area: Rect; slots: (Id | null)[] }
export interface Geometry extends Rect { order: number }
export interface TransferUndo {
  cardId: Id;
  fromGroupId: Id;
  toGroupId: Id;
  previousRevision: Revision;
  expectedRevision: Revision;
}
export interface LayoutUndo {
  kind: 'move' | 'formation' | 'transfer';
  before: Record<Id, Geometry>;
  gridBefore?: Grid;
  gridAfter?: Grid;
  transfer?: TransferUndo;
}
export interface DeviceLayout {
  schemaVersion: 1;
  deviceId: Id;
  revision: number;
  grid: Grid;
  placements: Record<Id, Placement>;
  history: LayoutUndo[];
  desktopVisible: boolean;
  myGroupId: Id | null;
  shortcuts: Record<string, Id>;
  /** Missing groups are on the desktop layer. */
  groupLayers: Record<Id, ResidentLayer>;
  /** Palette index (0-8) each group wears on this device; a group without one takes a free colour. */
  groupColors?: Record<Id, number>;
  /** This device's opacity, 0.3 to 1, for each group's papers resting on the Top layer; absent means opaque. Never syncs. */
  groupOpacity?: Record<Id, number>;
  /** The main window's view of a group's papers on this device; missing shows the board. */
  mainView?: 'board' | 'list';
  /** The group the main window shows on this device, which quick capture files into; missing shows the first group. */
  mainGroupId?: Id;
}
export interface FormationPlan {
  kind: 'formation';
  layoutRevision: number;
  membership: string;
  scope: Exclude<Scope, { kind: 'none' }>;
  mode: 'stack' | 'spread';
  grid: Grid;
  changes: Record<Id, Placement>;
  overflow: Id[];
  resized: Id[];
  allowResize: boolean;
}
export interface DropTarget { groupId: Id; kind: 'label' | 'region' }
export interface DragSession {
  generation: string;
  cardId: Id;
  pointerId: number;
  groupId: Id;
  revision: Revision;
  layoutRevision: number;
  start: Point;
  current: Point;
  origin: Placement;
  position: Placement;
  threshold: number;
  dragging: boolean;
  target: DropTarget | null;
}
export interface InteractionState {
  operationScope: Scope;
  activeGroupId: Id | null;
  selectedCardId: Id | null;
  editingCardId: Id | null;
  dragSession: DragSession | null;
}
export interface MoveCardToGroup {
  cardId: Id;
  groupId: Id;
  expectedRevision: Revision;
  position?: Point;
  expectedLayoutRevision?: number;
}
export interface Draft {
  id: Id;
  cardId: Id;
  groupId: Id;
  content: Content;
  baseRevision: Revision | null;
  recoveredFrom?: { id: Id; baseline: string }[];
}
export interface OutboxEntry {
  operationId: Id;
  kind: 'card' | 'group';
  entityId: Id;
  parents: Revision[];
  value: Card | Group;
}
export interface WorkspaceState {
  schemaVersion: 1;
  profileId: Id;
  revision: number;
  cards: Card[];
  groups: Group[];
  drafts: Record<Id, Draft>;
  membershipRebases?: Record<Revision, { cardId: Id; revision: Revision }>;
  outbox: OutboxEntry[];
  /** Legacy local previews migrate these from their complete outbox before the next atomic save. */
  revisions?: RevisionRecord[];
  sync?: SyncState;
  restoreReceipts?: Record<Id, RestoreReceipt>;
  conflicts: unknown[];
  layout: DeviceLayout;
}
/** Must compare expectedRevision and atomically persist the entire state, or reject without success. */
export type PersistWorkspace = (state: WorkspaceState, expectedRevision: number | null) => Promise<void>;
export interface Capability {
  status: 'available' | 'unsupported' | 'unverified';
  backend: string;
  reason?: string;
}
export interface PlatformCapabilities {
  platform: string;
  version: string;
  desktopLayer: Capability;
  wallpaperLayer: Capability;
  temporaryFloating: Capability;
  inputRegions: Capability;
  keyboardOnDemand: Capability;
  globalShortcuts: Capability;
  monitorMapping: Capability;
}
