import { t } from '../i18n/index.js';
import { INITIAL_GROUP_NAME } from '../sources/initial-group.js';

/**
 * The name to show for a group. Groups that still carry the stored default name (the shared initial group, and first
 * groups that earlier versions created with the same Chinese text) show the default name in the UI language.
 */
export const groupName = group => group?.name === INITIAL_GROUP_NAME ? t('app.groups.defaultName') : group?.name ?? '';
