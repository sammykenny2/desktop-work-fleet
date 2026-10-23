import { FleetError } from '../core/contracts.js';
import { schemas } from '../core/schema.js';

// SPEC-006 DO: what the main window says when this device's notes cannot be read, and when starting again can help.
const causes = new Set(['data-damaged', 'data-full', 'data-in-use', 'data-denied', 'data-key', 'data-unreadable']);

/**
 * The cause of a failed storage.load, or null for an error that keeps its own message, such as a closed session or a
 * bridge that timed out. A host that cannot decrypt the record reports its key error; text that is not JSON is damaged.
 */
export function loadFailureCause(error) {
  if (causes.has(error?.code)) return error.code;
  if (['vault-unavailable', 'storage-integrity'].includes(error?.code)) return 'data-key';
  return error instanceof SyntaxError ? 'data-damaged' : null;
}

/**
 * A record that loaded but is refused as a workspace is damaged, except one from a newer version, which keeps its own
 * message. Anything but a refusal is a fault in this version rather than in the data, so it keeps its message too.
 */
export function workspaceFailureCause(error, saved) {
  if (!(error instanceof FleetError)) return null;
  const found = saved?.schemaVersion;
  return error.code === 'unsupported-schema' && Number.isSafeInteger(found) && found > schemas.workspace ? null : 'data-damaged';
}

/**
 * Setting the data aside helps only data shown to be damaged or undecryptable: never a full disk, held files or a closed
 * folder, and not a cause the host cannot tell, which could be healthy data.
 */
export const canSetAside = cause => ['data-damaged', 'data-key'].includes(cause);

/** The catalog key that explains a cause. */
export const causeKey = cause => `app.dataFailure.${{ 'data-damaged': 'damaged', 'data-full': 'full', 'data-in-use': 'inUse',
  'data-denied': 'denied', 'data-key': 'key' }[cause] ?? 'unreadable'}`;
