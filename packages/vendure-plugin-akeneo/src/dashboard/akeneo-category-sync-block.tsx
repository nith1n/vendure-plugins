import { api } from '@vendure/dashboard';
import type { ResultOf } from './graphql';

import {
    akeneoCategorySyncStatusQuery,
    akeneoSettingsQuery,
    startAkeneoCategorySyncMutation,
} from './akeneo-settings.graphql';
import { SyncRunBlock } from './sync-run-block';

type Settings = NonNullable<ResultOf<typeof akeneoSettingsQuery>['akeneoConnectionSettings']>;
type Status = NonNullable<ResultOf<typeof akeneoCategorySyncStatusQuery>['akeneoCategorySyncStatus']>;

/** Why the sync can't start yet, or null when it can. */
function blockedReason(settings: Settings | null | undefined, hasUnsavedSettings: boolean): string | null {
    if (!settings) return 'Save the connection first.';
    if (hasUnsavedSettings) return 'Save the sync settings first.';
    if (!settings.enabled) return 'Sync is disabled for this channel.';
    if (!settings.channelCode) return 'Select an Akeneo channel in the sync settings.';
    if (!settings.categoryTreeCodes.length) return 'Select at least one category tree to sync.';
    return null;
}

export function AkeneoCategorySyncBlock({
    settings,
    hasUnsavedSettings,
}: Readonly<{ settings: Settings | null | undefined; hasUnsavedSettings: boolean }>) {
    return (
        <SyncRunBlock<Status>
            noun="categories"
            queryKey="akeneoCategorySyncStatus"
            fetchStatus={async () =>
                (await api.query(akeneoCategorySyncStatusQuery)).akeneoCategorySyncStatus
            }
            // Pass variables: with only a document, api.mutate returns a curried function instead
            start={() => api.mutate(startAkeneoCategorySyncMutation, {})}
            blockedReason={blockedReason(settings, hasUnsavedSettings)}
            detail={s =>
                s.currentTree
                    ? `Syncing ${s.currentTree}, ${s.pages} page(s) done`
                    : `${s.categories} categories in ${s.trees.join(', ')}`
            }
        />
    );
}
