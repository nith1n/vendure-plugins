import { PermissionDefinition } from '@vendure/core';

/**
 * @description
 * Grants everything the plugin offers: the Akeneo connection and sync settings, running syncs and
 * cleanup, and their status.
 *
 * @category Plugin
 */
export const manageAkeneoSyncPermission = new PermissionDefinition({
    name: 'ManageAkeneoSync',
    description: 'Allows configuring and running the Akeneo sync',
});
