import { activeGroups, PinItAnywhereError, requireValue, validateNewGroup } from './contracts.js';
import { resolveGroupId } from './groups.js';
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

  /**
   * The bytes of a note's attachments. Read them before taking a turn in a desktop's queue, for one not on this device comes
   * from Drive and the queue must not wait for the network (ADR-064).
   */
  async readAttachments(cardId) {
    const source = this.#combined.ownerOfCard(cardId); const card = source.workspace.cardValue(cardId);
    return card ? this.#attachments(source, card) : [];
  }

  async moveNote(cardId, targetGroupId, known = []) {
    const source = this.#combined.ownerOfCard(cardId); const target = this.#combined.ownerOfGroup(targetGroupId);
    requireValue(source !== target, 'same-collection', t('errors.core.sameCollection'));
    const refusal = this.refusal(cardId);
    if (refusal) throw new PinItAnywhereError(`move-${refusal}`, t(`errors.core.move.${refusal}`));
    target.workspace.requireGroup(targetGroupId);
    const card = source.workspace.cardValue(cardId);
    // Everything the move needs must be on this device before it is recorded.
    const bytes = await this.#attachments(source, card, known);
    const placement = source.workspace.layout.state.placements[cardId];
    // A move stopped past its copy keeps its id, so that it cannot leave a second copy. Only a live copy of this very version
    // qualifies: finishing on an older one would trash the only newest text, a trashed one would leave nothing alive, and a
    // purged id can never be used again (ADR-062).
    const earlier = await source.storage.getJob(noteKey(cardId));
    const copy = earlier?.toProfile === target.id && earlier.revision === card.revision ? target.workspace.cardValue(earlier.newCardId) : null;
    const resumable = copy && !copy.deleted;
    const job = { kind: noteJobKind, cardId, revision: card.revision, toProfile: target.id, toGroupId: targetGroupId, toGroupName: this.#groupName(target, targetGroupId),
      newCardId: resumable ? earlier.newCardId : this.#uuid(), ...resumable ? { copied: true } : {}, ...placement ? { placement } : {} };
    await source.storage.putJob(noteKey(cardId), job);
    await this.#step('journal');
    const moved = await this.#finishOrClear(source, target, job, bytes);
    const copyNow = target.workspace.cardValue(job.newCardId);
    if (moved && (!copyNow || copyNow.deleted)) throw new PinItAnywhereError('move-copy-gone', t('errors.core.move.copyGone'));
    if (source.workspace.cardValue(cardId)?.movedTo?.id === job.newCardId) return moved;
    // Only an original still in Trash with this mark has moved. Otherwise it changed in time to stay, or its copy went first.
    if (!moved) throw new PinItAnywhereError('move-changed', t('errors.core.move.changed'));
    throw new PinItAnywhereError('move-both', t('errors.core.move.both', { group: this.#groupName(target, moved.groupId) }));
  }

  #groupName(profile, groupId) { return profile.workspace.state.groups.find(group => group.id === groupId)?.name ?? ''; }

  async #attachments(source, card, known = []) {
    const result = [];
    for (const file of card.content.attachments ?? []) {
      const held = known.find(item => item.id === file.id);
      if (held) { result.push(held); continue; }
      const value = await source.storage.getAttachment(source.id, file.id).catch(() => null);
      if (!value) throw new PinItAnywhereError('move-attachment', t('errors.core.move.attachment', { name: file.name }));
      result.push({ id: file.id, bytes: new Uint8Array(await new Blob([value]).arrayBuffer()) });
    }
    return result;
  }

  // A target group gone since the journal was written gives way to the first group there, or to a new one of the same name.
  async #targetGroup(target, job) {
    const state = target.workspace.state; const groups = activeGroups(state);
    // Merged since, it lives on in the group it was merged into.
    let current = job.toGroupId; try { current = resolveGroupId(state, job.toGroupId); } catch { /* gone without a recipient */ }
    if (groups.some(group => group.id === current)) return current;
    return (groups[0] ?? await target.workspace.createGroup(job.toGroupName || t('app.groups.defaultName'))).id;
  }

  #unsettled({ workspace }, cardId) { return Boolean(workspace.unsavedChanges(cardId)) || workspace.revisionHeads('card', cardId).length > 1; }

  // A refusal before any copy exists means nothing happened, as the user is told now, so nothing is left to finish later. Any
  // other failure, such as a full disk, may pass, and tries again at the next start.
  async #finishOrClear(source, target, job, known = null) {
    try { return await this.#finishNote(source, target, job, known); }
    catch (error) {
      const original = source.workspace.cardValue(job.cardId);
      const recovering = original?.deleted && original.movedTo?.id === job.newCardId;
      const refused = error instanceof PinItAnywhereError && ['move-attachment', 'conflict', 'missing-group', 'group-limit'].includes(error.code);
      // A storage failure may have committed without an acknowledgement, so memory alone cannot prove nothing moved.
      if (refused && !recovering && !target.workspace.cardValue(job.newCardId)) await source.storage.deleteJob(noteKey(job.cardId));
      throw error;
    }
  }

  #copyGone(target, job) { const card = target.workspace.cardValue(job.newCardId); return !card || card.deleted; }

  /** The journal stays until compensation succeeds; startup can repeat it after a failed write or a crash. */
  async #settleOriginal(source, target, job) {
    if (this.#copyGone(target, job)) await source.workspace.recoverMovedCard(job.cardId, job.newCardId, job.revision);
  }

  async #clearNote(source, target, job) {
    await this.#settleOriginal(source, target, job);
    await source.storage.deleteJob(noteKey(job.cardId));
    // Clearing the journal is also an asynchronous write. If the copy went during it, record recovery before attempting it.
    const original = source.workspace.cardValue(job.cardId);
    if (original?.deleted && original.movedTo?.id === job.newCardId && this.#copyGone(target, job)) {
      await source.storage.putJob(noteKey(job.cardId), { ...job, copied: true });
      await this.#settleOriginal(source, target, job);
      await source.storage.deleteJob(noteKey(job.cardId));
    }
  }

  async #finishNote(source, target, job, known = null) {
    const card = source.workspace.cardValue(job.cardId); const copied = target.workspace.cardValue(job.newCardId);
    if (card?.movedTo?.id === job.newCardId) {
      await this.#clearNote(source, target, job); return copied;
    }
    // Nothing is left to do but clear the record when the note is gone, or this very move trashed it before the record could be
    // cleared; when its copy has since been trashed or purged, which the user did knowing it, so the original stays; or when no
    // copy exists yet and the note has changed or is unsettled. A move waiting for a collection to open allows all this for a
    // long time, and it no longer describes this note.
    if (!card || copied?.deleted
      || (!copied && (job.copied || card.revision !== job.revision || this.#unsettled(source, job.cardId)))) {
      await source.storage.deleteJob(noteKey(job.cardId)); return copied?.deleted ? null : copied;
    }
    // A copy is only ever made after its attachments.
    if (!copied) for (const { id, bytes } of known ?? await this.#attachments(source, card)) await target.storage.putAttachmentBytes(target.id, id, bytes);
    await this.#step('attachments');
    // Marked first, so that a copy purged later can never be made again under its id: stopping right here leaves the note
    // where it was and the record cleared on the next start, which loses nothing.
    if (!copied) await source.storage.putJob(noteKey(job.cardId), { ...job, copied: true });
    const moved = copied ?? await target.workspace.adoptCard({ id: job.newCardId, groupId: await this.#targetGroup(target, job), content: card.content, archived: card.archived, completed: card.completed, createdAt: card.createdAt });
    await this.#step('created');
    if (job.placement) await target.workspace.layout.adoptPlacement(job.newCardId, job.placement);
    await this.#step('placed');
    // Read again, for a sync can land between these steps. An original changed after the copy was made stays, and both exist
    // rather than losing the change; so does an unsettled one, whose unsaved changes or other version would end up on a note in
    // Trash, and which could not be trashed anyway while in conflict. A copy deleted meanwhile leaves the original too, or
    // the note would be alive nowhere.
    const current = source.workspace.cardValue(job.cardId); const copyNow = target.workspace.cardValue(job.newCardId);
    if (copyNow && !copyNow.deleted && current?.revision === job.revision && !current.deleted && !this.#unsettled(source, job.cardId)) {
      await source.workspace.updateCard(job.cardId, { deleted: true, movedTo: { id: job.newCardId, section: sectionKind(target.id), group: this.#groupName(target, moved.groupId) } }, job.revision);
    }
    await this.#step('trashed');
    await this.#clearNote(source, target, job);
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
    if (earlier?.toProfile === toProfile) {
      if (!earlier.carried) await this.#carryLooks(source, earlier);
      return earlier.toGroupId;
    }
    validateNewGroup(target.workspace.state);
    const toGroupId = this.#uuid(); const group = source.workspace.state.groups.find(item => item.id === groupId);
    const job = { kind: groupJobKind, groupId, toProfile, toGroupId };
    await source.storage.putJob(groupKey(groupId), job);
    await this.#step('group-journal');
    await this.#combined.layout.admitMovedGroup(groupId, toGroupId, toProfile);
    await target.workspace.adoptGroup({ id: toGroupId, name: group.name });
    await this.#combined.layout.settle();
    await this.#step('group-created');
    await this.#carryLooks(source, job);
    return toGroupId;
  }

  async #carryLooks(source, job) {
    await this.#combined.layout.carryLooks(job.groupId, job.toGroupId);
    await source.storage.putJob(groupKey(job.groupId), { ...job, carried: true });
  }

  /** When nothing is left in the group but Trash, it leaves its collection and the target takes its region. Returns whether it did. */
  async finishGroup(groupId) {
    const source = this.#combined.ownerOfGroup(groupId);
    const job = await source.storage.getJob(groupKey(groupId));
    if (!job || source.workspace.working.cards.some(card => card.groupId === groupId && !card.deleted)) return false;
    // Decided from here on, so a crash finishes it. Without this mark a stopped move leaves its group alone, even once empty.
    if (!job.finishing) await source.storage.putJob(groupKey(groupId), { ...job, finishing: true });
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
        if (target) await attempt(() => this.#finishOrClear(source, target, row));
      }
      for (const row of await this.#jobs(source, groupJobKind)) {
        const target = this.#combined.profiles.find(profile => profile.id === row.toProfile);
        if (!target) continue;
        // Finished, or either group has gone another way since.
        if (![[source, row.groupId], [target, row.toGroupId]].every(([{ workspace }, id]) => activeGroups(workspace.state).some(item => item.id === id))) {
          await source.storage.deleteJob(groupKey(row.groupId)); continue;
        }
        // A move the user stopped keeps its record, so moving the group again continues into the same group.
        if (row.finishing) await attempt(() => this.finishGroup(row.groupId));
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
