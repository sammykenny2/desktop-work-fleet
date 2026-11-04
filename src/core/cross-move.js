import { activeGroups, FleetError, requireValue, validateNewGroup } from './contracts.js';
import { t } from '../i18n/index.js';

const noteJobKind = 'cross-move'; const groupJobKind = 'cross-group';
const noteKey = id => `${noteJobKind}:${id}`; const groupKey = id => `${groupJobKind}:${id}`;
const sectionKind = profileId => profileId.startsWith('google:') ? 'cloud' : 'local';

/**
 * Moves notes and groups between open collections (ADR-066). Two collections share no transaction, so a move is a series
 * of steps recorded in a journal in the source collection, each safe to repeat: the note's id in the target is chosen
 * before anything is written, so a crash at any point finishes on the next start with one copy, never half a note.
 * `step` lets a test stop after each one.
 */
export class CrossMove {
  #combined; #uuid; #step;
  constructor(combined, { uuid = () => crypto.randomUUID(), step = async () => {} } = {}) {
    this.#combined = combined; this.#uuid = uuid; this.#step = step;
  }

  /** Why a note cannot move now: a code the page explains, or null. */
  refusal(cardId) {
    const { workspace } = this.#combined.ownerOfCard(cardId); const card = workspace.cardValue(cardId);
    if (!card) return 'unsaved';
    if (card.deleted) return 'trashed';
    if (workspace.unsavedChanges(cardId)) return 'unsaved';
    if (workspace.revisionHeads('card', cardId).length > 1) return 'conflict';
    return null;
  }

  async moveNote(cardId, targetGroupId) {
    const source = this.#combined.ownerOfCard(cardId); const target = this.#combined.ownerOfGroup(targetGroupId);
    requireValue(source !== target, 'same-collection', t('errors.core.sameCollection'));
    const refusal = this.refusal(cardId);
    if (refusal) throw new FleetError(`move-${refusal}`, t(`errors.core.move.${refusal}`));
    const card = source.workspace.cardValue(cardId);
    // Everything the move needs must be on this device before it is recorded.
    const bytes = await this.#attachments(source, card);
    const placement = source.workspace.layout.state.placements[cardId];
    // A move still waiting for this collection keeps its id, so that it cannot leave a second copy there.
    const earlier = await source.storage.getJob(noteKey(cardId));
    const job = { kind: noteJobKind, cardId, revision: card.revision, toProfile: target.id, toGroupId: targetGroupId, toGroupName: this.#groupName(target, targetGroupId),
      newCardId: earlier?.toProfile === target.id ? earlier.newCardId : this.#uuid(), ...placement ? { placement } : {} };
    await source.storage.putJob(noteKey(cardId), job);
    await this.#step('journal');
    return this.#finishNote(source, target, job, bytes);
  }

  #groupName(profile, groupId) { return profile.workspace.state.groups.find(group => group.id === groupId)?.name ?? ''; }

  async #attachments(source, card) {
    const result = [];
    for (const file of card.content.attachments ?? []) {
      const value = await source.storage.getAttachment(source.id, file.id).catch(() => null);
      if (!value) throw new FleetError('move-attachment', t('errors.core.move.attachment', { name: file.name }));
      result.push({ id: file.id, bytes: new Uint8Array(await new Blob([value]).arrayBuffer()) });
    }
    return result;
  }

  // A target group gone since the journal was written gives way to the first group there, or to a new one of the same name.
  async #targetGroup(target, job) {
    const groups = activeGroups(target.workspace.state);
    if (groups.some(group => group.id === job.toGroupId)) return job.toGroupId;
    return (groups[0] ?? await target.workspace.createGroup(job.toGroupName || t('app.groups.defaultName'))).id;
  }

  async #finishNote(source, target, job, known = null) {
    const card = source.workspace.cardValue(job.cardId); const copied = target.workspace.cardValue(job.newCardId);
    // Gone, or trashed by this very move before the journal could be cleared. Or changed before any copy exists, which a
    // move waiting for a collection to open allows for a long time: it no longer describes this note, so the note stays.
    if (!card || card.movedTo?.id === job.newCardId || (!copied && card.revision !== job.revision)) {
      await source.storage.deleteJob(noteKey(job.cardId)); return copied;
    }
    // A copy is only ever made after its attachments.
    if (!copied) for (const { id, bytes } of known ?? await this.#attachments(source, card)) await target.storage.putAttachmentBytes(target.id, id, bytes);
    await this.#step('attachments');
    const groupId = await this.#targetGroup(target, job);
    const moved = await target.workspace.adoptCard({ id: job.newCardId, groupId, content: card.content, archived: card.archived, completed: card.completed, createdAt: card.createdAt });
    await this.#step('created');
    if (job.placement) await target.workspace.layout.adoptPlacement(job.newCardId, job.placement);
    await this.#step('placed');
    // The original changed after the copy was made: it stays, and both exist rather than losing the change.
    if (card.revision === job.revision && !card.deleted) {
      await source.workspace.updateCard(job.cardId, { deleted: true, movedTo: { id: job.newCardId, section: sectionKind(target.id), group: this.#groupName(target, groupId) } }, job.revision);
    }
    await this.#step('trashed');
    await source.storage.deleteJob(noteKey(job.cardId));
    return moved;
  }

  /** The group a move of this group goes into: the one an earlier, unfinished move began, or a new one of the same name. */
  async groupTarget(groupId) {
    const source = this.#combined.ownerOfGroup(groupId);
    const job = await source.storage.getJob(groupKey(groupId));
    if (!job) return null;
    const target = this.#combined.profiles.find(profile => profile.id === job.toProfile);
    return target && activeGroups(target.workspace.state).some(group => group.id === job.toGroupId) ? job : null;
  }

  async openGroup(groupId, toProfile) {
    const source = this.#combined.ownerOfGroup(groupId); const target = this.#combined.profile(toProfile);
    requireValue(source !== target, 'same-collection', t('errors.core.sameCollection'));
    const earlier = await this.groupTarget(groupId);
    if (earlier?.toProfile === toProfile) return earlier.toGroupId;
    validateNewGroup(target.workspace.state);
    const toGroupId = this.#uuid(); const group = source.workspace.state.groups.find(item => item.id === groupId);
    await source.storage.putJob(groupKey(groupId), { kind: groupJobKind, groupId, toProfile, toGroupId });
    await this.#step('group-journal');
    await target.workspace.adoptGroup({ id: toGroupId, name: group.name });
    await this.#combined.layout.settle();
    await this.#combined.layout.carryLooks(groupId, toGroupId);
    return toGroupId;
  }

  /** When nothing is left in the group but Trash, it leaves its collection and the target takes its region. Returns whether it did. */
  async finishGroup(groupId) {
    const source = this.#combined.ownerOfGroup(groupId);
    const job = await source.storage.getJob(groupKey(groupId));
    if (!job || source.workspace.working.cards.some(card => card.groupId === groupId && !card.deleted)) return false;
    await this.#combined.layout.handOverGroup(groupId, job.toGroupId);
    await this.#step('handed-over');
    await source.workspace.retireMovedGroup(groupId);
    await this.#step('retired');
    await this.#combined.layout.settle();
    await source.storage.deleteJob(groupKey(groupId));
    return true;
  }

  /** Finishes what a crash interrupted; a move into a collection that is not open waits until it is. */
  async resume() {
    // One move that cannot finish yet must not hold back the others; it keeps its record for the next start.
    let failure = null; const attempt = action => action().catch(error => { failure ??= error; });
    for (const source of this.#combined.profiles) {
      for (const row of await this.#jobs(source, noteJobKind)) {
        const target = this.#combined.profiles.find(profile => profile.id === row.toProfile);
        if (target) await attempt(() => this.#finishNote(source, target, row));
      }
      for (const row of await this.#jobs(source, groupJobKind)) {
        const target = this.#combined.profiles.find(profile => profile.id === row.toProfile);
        if (!target) continue;
        const group = source.workspace.state.groups.find(item => item.id === row.groupId);
        // Finished, or either group has gone another way since.
        if (!group || group.deleted || group.movedAway || !activeGroups(target.workspace.state).some(item => item.id === row.toGroupId)) {
          await source.storage.deleteJob(groupKey(row.groupId)); continue;
        }
        // A move the user stopped keeps its record, so moving the group again continues into the same group.
        await attempt(() => this.finishGroup(row.groupId));
      }
    }
    if (failure) throw failure;
  }

  async #jobs(source, kind) {
    const rows = []; let after = null;
    do {
      const page = await source.storage.jobs(kind, { after, limit: 50 });
      rows.push(...page.rows.map(row => row.value)); after = page.next;
    } while (after);
    return rows;
  }
}
