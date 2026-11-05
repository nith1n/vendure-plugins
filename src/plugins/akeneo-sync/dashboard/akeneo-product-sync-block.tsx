import { api } from '@vendure/dashboard';
import type { ResultOf } from '@/gql';

import {
    akeneoProductSyncStatusQuery,
    akeneoSettingsQuery,
    startAkeneoProductSyncMutation,
} from './akeneo-settings.graphql';
import { SyncRunBlock } from './sync-run-block';

type Settings = NonNullable<ResultOf<typeof akeneoSettingsQuery>['akeneoConnectionSettings']>;
type Status = NonNullable<ResultOf<typeof akeneoProductSyncStatusQuery>['akeneoProductSyncStatus']>;

/** Why the sync can't start yet, or null when it can. */
function blockedReason(settings: Settings | null | undefined, hasUnsavedSettings: boolean): string | null {
    if (!settings) return 'Save the connection first.';
    if (hasUnsavedSettings) return 'Save the sync settings first.';
    if (!settings.enabled) return 'Sync is disabled for this channel.';
    if (!settings.channelCode) return 'Select an Akeneo channel in the sync settings.';
    return null;
}

/** Counts are per Akeneo product, i.e. per Vendure variant. */
export function AkeneoProductSyncBlock({
    settings,
    hasUnsavedSettings,
}: Readonly<{ settings: Settings | null | undefined; hasUnsavedSettings: boolean }>) {
    return (
        <SyncRunBlock<Status>
            noun="products"
            queryKey="akeneoProductSyncStatus"
            fetchStatus={async () => (await api.query(akeneoProductSyncStatusQuery)).akeneoProductSyncStatus}
            // Pass variables: with only a document, api.mutate returns a curried function instead
            start={() => api.mutate(startAkeneoProductSyncMutation, {})}
            blockedReason={blockedReason(settings, hasUnsavedSettings)}
            detail={s =>
                s.state === 'RUNNING'
                    ? `${s.pages} page(s) done, ${s.products} variants so far`
                    : `${s.products} variants, ${s.productsCreated} new products`
            }
        />
    );
}
