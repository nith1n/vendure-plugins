import { api } from '@vendure/dashboard';
import type { ResultOf } from './graphql';

import {
    akeneoProductSyncStatusQuery,
    akeneoSettingsQuery,
    startAkeneoProductSyncMutation,
} from './akeneo-settings.graphql';
import { SyncRunBlock } from './sync-run-block';

type Settings = NonNullable<ResultOf<typeof akeneoSettingsQuery>['akeneoConnectionSettings']>;
type Status = NonNullable<ResultOf<typeof akeneoProductSyncStatusQuery>['akeneoProductSyncStatus']> & {
    /** Since when a changes-only run would fetch; null when only a full sync is possible. */
    changesAvailableSince: string | null;
};

/** Why the sync can't start yet, or null when it can. */
function blockedReason(settings: Settings | null | undefined, hasUnsavedSettings: boolean): string | null {
    if (!settings) return 'Save the connection first.';
    if (hasUnsavedSettings) return 'Save the sync settings first.';
    if (!settings.enabled) return 'Sync is disabled for this channel.';
    if (!settings.channelCode) return 'Select an Akeneo channel in the sync settings.';
    return null;
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Null when the run had no image jobs, i.e. images are not synced. */
function imageSummary(images: Status['images']): string | null {
    const { downloaded, reused, skipped, pending, failed } = images;
    if (!downloaded && !reused && !skipped && !pending && !failed) return null;
    const parts = [`${downloaded} new`, `${reused} reused`];
    if (skipped) parts.push(`${skipped} skipped`);
    if (failed) parts.push(`${failed} job(s) failed`);
    return `${pending ? 'Downloading images' : 'Images'}: ${parts.join(', ')}`;
}

/**
 * Counts are per Akeneo product, i.e. per Vendure variant. "Sync changes" fetches only what
 * Akeneo updated since the last completed run; a full sync is needed after settings change.
 */
export function AkeneoProductSyncBlock({
    settings,
    hasUnsavedSettings,
}: Readonly<{ settings: Settings | null | undefined; hasUnsavedSettings: boolean }>) {
    return (
        <SyncRunBlock<Status>
            noun="products"
            queryKey="akeneoProductSyncStatus"
            // Settings decide whether a changes-only run is possible, so refetch when they change
            refreshKey={JSON.stringify(settings ?? null)}
            fetchStatus={async () => {
                const result = await api.query(akeneoProductSyncStatusQuery);
                return (
                    result.akeneoProductSyncStatus && {
                        ...result.akeneoProductSyncStatus,
                        changesAvailableSince: result.akeneoProductSyncChangesSince,
                    }
                );
            }}
            // Pass variables: with only a document, api.mutate returns a curried function instead
            start={() => api.mutate(startAkeneoProductSyncMutation, { changesOnly: false })}
            startLabel="Full sync"
            quickStart={s =>
                s?.changesAvailableSince
                    ? {
                          label: 'Sync changes',
                          start: () => api.mutate(startAkeneoProductSyncMutation, { changesOnly: true }),
                      }
                    : null
            }
            blockedReason={blockedReason(settings, hasUnsavedSettings)}
            detail={s =>
                [
                    s.changesSince && `Changes since ${new Date(s.changesSince).toLocaleString()}`,
                    s.state === 'RUNNING'
                        ? `${s.pages} page(s) done, ${s.products} variants so far`
                        : `${plural(s.products, 'variant')}, ${plural(s.productsCreated, 'new product')}, ${plural(s.productsUpdated, 'product')} updated`,
                    s.skipped ? `${s.skipped} skipped: synced by another channel` : null,
                    imageSummary(s.images),
                ]
                    .filter(Boolean)
                    .join('. ')
            }
        />
    );
}
