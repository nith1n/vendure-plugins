export const AKENEO_SYNC_PLUGIN_OPTIONS = Symbol('AKENEO_SYNC_PLUGIN_OPTIONS');
export const loggerCtx = 'AkeneoSyncPlugin';
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Job queues. Syncs and cleanup of a channel must not run at the same time. */
export const CATEGORY_SYNC_QUEUE = 'akeneo-category-sync';
export const PRODUCT_SYNC_QUEUE = 'akeneo-product-sync';
export const ASSET_SYNC_QUEUE = 'akeneo-asset-sync';
export const CLEANUP_QUEUE = 'akeneo-cleanup';
