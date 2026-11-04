import { api, Badge, Button } from '@vendure/dashboard';
import type { ResultOf } from '@/gql';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
    akeneoCategorySyncStatusQuery,
    akeneoSettingsQuery,
    startAkeneoCategorySyncMutation,
} from './akeneo-settings.graphql';

type Settings = NonNullable<ResultOf<typeof akeneoSettingsQuery>['akeneoConnectionSettings']>;
type Status = NonNullable<ResultOf<typeof akeneoCategorySyncStatusQuery>['akeneoCategorySyncStatus']>;

const statusQueryKey = ['akeneoCategorySyncStatus'];
const POLL_INTERVAL_MS = 2000;

const stateBadge = {
    RUNNING: { label: 'Running', variant: 'warning' },
    COMPLETED: { label: 'Completed', variant: 'success' },
    FAILED: { label: 'Failed', variant: 'destructive' },
    CANCELLED: { label: 'Cancelled', variant: 'outline' },
} as const;

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
}

/** Why the sync can't start yet, or null when it can. */
function blockedReason(settings: Settings | null | undefined): string | null {
    if (!settings) return 'Save the connection first.';
    if (!settings.enabled) return 'Sync is disabled for this channel.';
    if (!settings.channelCode) return 'Select an Akeneo channel in the sync settings.';
    if (!settings.categoryTreeCodes.length) return 'Select at least one category tree to sync.';
    return null;
}

export function AkeneoCategorySyncBlock({ settings }: Readonly<{ settings: Settings | null | undefined }>) {
    const queryClient = useQueryClient();
    const { data, error } = useQuery({
        queryKey: statusQueryKey,
        queryFn: () => api.query(akeneoCategorySyncStatusQuery),
        enabled: !!settings,
        // Poll only while a run is going
        refetchInterval: query =>
            query.state.data?.akeneoCategorySyncStatus?.state === 'RUNNING' ? POLL_INTERVAL_MS : false,
    });
    const status = data?.akeneoCategorySyncStatus;
    const running = status?.state === 'RUNNING';

    const startMutation = useMutation({
        // Pass variables: with only a document, api.mutate returns a curried function instead
        mutationFn: () => api.mutate(startAkeneoCategorySyncMutation, {}),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: statusQueryKey });
            toast.success('Category sync started');
        },
        onError: err => toast.error('Could not start category sync', { description: errorMessage(err) }),
    });

    const reason = blockedReason(settings);
    return (
        <div className="flex flex-col gap-3 text-sm">
            {status ? (
                <RunSummary status={status} />
            ) : (
                <p className="text-muted-foreground">
                    {error ? `Could not load status: ${errorMessage(error)}` : 'No sync has run yet.'}
                </p>
            )}
            {reason && <p className="text-muted-foreground">{reason}</p>}
            <div>
                <Button
                    type="button"
                    variant="outline"
                    disabled={!!reason || running || startMutation.isPending}
                    onClick={() => startMutation.mutate()}
                >
                    {running || startMutation.isPending ? 'Syncing…' : 'Sync categories'}
                </Button>
            </div>
        </div>
    );
}

function RunSummary({ status }: Readonly<{ status: Status }>) {
    const badge = stateBadge[status.state];
    const time = status.finishedAt ?? status.startedAt;
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Last run</span>
                <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <span className="text-muted-foreground">
                {status.finishedAt ? 'Finished' : 'Started'} {new Date(time).toLocaleString()}
            </span>
            {status.currentTree && (
                <span className="text-muted-foreground">
                    Syncing {status.currentTree}, {status.pages} page(s) done
                </span>
            )}
            <span>
                {status.categories} categories: {status.created} created, {status.updated} updated,{' '}
                {status.unchanged} unchanged
            </span>
            {status.error && <span className="text-destructive">{status.error}</span>}
        </div>
    );
}
