import { PermissionDefinition } from '@vendure/core';

/**
 * Grants the ability to view and manage the Akeneo connection settings and to test credentials.
 */
export const manageAkeneoSyncPermission = new PermissionDefinition({
    name: 'ManageAkeneoSync',
    description: 'Allows viewing and updating Akeneo Cloud API connection settings',
});
