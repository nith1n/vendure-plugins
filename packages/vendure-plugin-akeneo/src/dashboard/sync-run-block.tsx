import { Badge, Button } from '@vendure/dashboard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/** The fields every sync status query returns. */
export interface SyncRunStatus {
    state: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    startedAt: string;
    finishedAt?: string | null;
    created: number;
    updated: number;
    unchanged: number;
    error?: string | null;
}

interface SyncRunBlockProps<S extends SyncRunStatus> {
    /** e.g. "categories"; used in the button and messages. */
    noun: string;
    queryKey: string;
    fetchStatus: () => Promise<S | null | undefined>;
    start: () => Promise<unknown>;
    /** Label of the start button; "Sync <noun>" by default. */
    startLabel?: string;
    /** A faster way to start shown first, e.g. syncing only what changed; null when unavailable. */
    quickStart?: (status: S | null) => { label: string; start: () => Promise<unknown> } | null;
    /** Part of the status query key; a change refetches the status, e.g. after settings change. */
    refreshKey?: string;
    /** Why the sync can't start yet, or null when it can. */
    blockedReason: string | null;
    /** Extra line under the badge, e.g. progress while running. */
    detail?: (status: S) => string | null;
}

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

/** Start button plus the latest run of a sync, polled while it is running. */
export function SyncRunBlock<S extends SyncRunStatus>({
    noun,
    queryKey,
    fetchStatus,
    start,
    startLabel,
    quickStart,
    refreshKey,
    blockedReason,
    detail,
}: Readonly<SyncRunBlockProps<S>>) {
    const queryClient = useQueryClient();
    const { data: status, error } = useQuery({
        queryKey: [queryKey, refreshKey],
        queryFn: async () => (await fetchStatus()) ?? null,
        // Poll only while a run is going
        refetchInterval: query => (query.state.data?.state === 'RUNNING' ? POLL_INTERVAL_MS : false),
    });
    const running = status?.state === 'RUNNING';

    const quick = quickStart?.(status ?? null) ?? null;

    const startMutation = useMutation({
        mutationFn: (run: () => Promise<unknown>) => run(),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [queryKey] });
            toast.success(`Syncing ${noun}`);
        },
        onError: err => toast.error(`Could not start syncing ${noun}`, { description: errorMessage(err) }),
    });

    return (
        <div className="flex flex-col gap-3 text-sm">
            {status ? (
                <RunSummary status={status} detail={detail?.(status) ?? null} />
            ) : (
                <p className="text-muted-foreground">
                    {error ? `Could not load status: ${errorMessage(error)}` : 'No sync has run yet.'}
                </p>
            )}
            {blockedReason && <p className="text-muted-foreground">{blockedReason}</p>}
            <div className="flex flex-wrap gap-2">
                {quick && !running && !startMutation.isPending && (
                    <Button
                        type="button"
                        disabled={!!blockedReason}
                        onClick={() => startMutation.mutate(quick.start)}
                    >
                        {quick.label}
                    </Button>
                )}
                <Button
                    type="button"
                    variant="outline"
                    disabled={!!blockedReason || running || startMutation.isPending}
                    onClick={() => startMutation.mutate(start)}
                >
                    {running || startMutation.isPending ? 'Syncing…' : (startLabel ?? `Sync ${noun}`)}
                </Button>
            </div>
        </div>
    );
}

function RunSummary({ status, detail }: Readonly<{ status: SyncRunStatus; detail: string | null }>) {
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
            {detail && <span className="text-muted-foreground">{detail}</span>}
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                <Count label="Created" value={status.created} />
                <Count label="Updated" value={status.updated} />
                <Count label="Unchanged" value={status.unchanged} />
            </dl>
            {status.error && <span className="text-destructive">{status.error}</span>}
        </div>
    );
}

function Count({ label, value }: Readonly<{ label: string; value: number }>) {
    return (
        <div className="rounded-md border px-2 py-1.5">
            <dd className="text-base font-semibold tabular-nums">{value}</dd>
            <dt className="text-xs text-muted-foreground">{label}</dt>
        </div>
    );
}
