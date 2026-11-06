import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    api,
    Badge,
    Button,
} from '@vendure/dashboard';
import type { ResultOf } from '@/gql';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import {
    akeneoCleanupStatusQuery,
    akeneoSettingsQuery,
    removeAkeneoLeftoversMutation,
    scanAkeneoLeftoversMutation,
} from './akeneo-settings.graphql';

type Settings = NonNullable<ResultOf<typeof akeneoSettingsQuery>['akeneoConnectionSettings']>;
type Status = NonNullable<ResultOf<typeof akeneoCleanupStatusQuery>['akeneoCleanupStatus']>;
type Plan = NonNullable<Status['plan']>;

const POLL_INTERVAL_MS = 2000;
const QUERY_KEY = ['akeneoCleanupStatus'];

const KINDS = [
    { key: 'products', label: 'Products' },
    { key: 'variants', label: 'Variants' },
    { key: 'collections', label: 'Collections' },
    { key: 'assets', label: 'Images' },
] as const;

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
}

function total(counts: Record<(typeof KINDS)[number]['key'], number>): number {
    return KINDS.reduce((sum, k) => sum + counts[k.key], 0);
}

function planCounts(plan: Plan) {
    return {
        products: plan.products.count,
        variants: plan.variants.count,
        collections: plan.collections.count,
        assets: plan.assets.count,
    };
}

/** Why cleanup can't start yet, or null when it can. */
function blockedReason(settings: Settings | null | undefined, hasUnsavedSettings: boolean): string | null {
    if (!settings) return 'Save the connection first.';
    if (hasUnsavedSettings) return 'Save the sync settings first.';
    if (!settings.channelCode) return 'Select an Akeneo channel in the sync settings.';
    return null;
}

/**
 * Finds what the sync created that Akeneo no longer has, shows it, and removes it on request.
 * Removing always follows a scan the admin has seen.
 */
export function AkeneoCleanupBlock({
    settings,
    hasUnsavedSettings,
}: Readonly<{ settings: Settings | null | undefined; hasUnsavedSettings: boolean }>) {
    const queryClient = useQueryClient();
    const [confirming, setConfirming] = useState(false);
    const { data: status, error } = useQuery({
        queryKey: QUERY_KEY,
        queryFn: async () => (await api.query(akeneoCleanupStatusQuery)).akeneoCleanupStatus ?? null,
        refetchInterval: query => (query.state.data?.state === 'RUNNING' ? POLL_INTERVAL_MS : false),
    });
    const running = status?.state === 'RUNNING';
    const blocked = blockedReason(settings, hasUnsavedSettings);

    const onStarted = async (message: string) => {
        await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        toast.success(message);
    };
    const scan = useMutation({
        // Pass variables: with only a document, api.mutate returns a curried function instead
        mutationFn: () => api.mutate(scanAkeneoLeftoversMutation, {}),
        onSuccess: () => onStarted('Looking for leftovers'),
        onError: err => toast.error('Could not look for leftovers', { description: errorMessage(err) }),
    });
    const remove = useMutation({
        mutationFn: (scanJobId: string) => api.mutate(removeAkeneoLeftoversMutation, { scanJobId }),
        onSuccess: () => onStarted('Removing leftovers'),
        onError: err => toast.error('Could not remove leftovers', { description: errorMessage(err) }),
    });

    const scanned = status?.mode === 'SCAN' && status.state === 'COMPLETED' ? status.plan : null;
    const toRemove = scanned ? total(planCounts(scanned)) : 0;
    const busy = running || scan.isPending || remove.isPending;

    return (
        <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
                Finds products, collections and images the sync created that Akeneo no longer has. Nothing is
                removed until you confirm.
            </p>
            {status ? (
                <StatusSummary status={status} />
            ) : (
                error && <p className="text-destructive">Could not load status: {errorMessage(error)}</p>
            )}
            {blocked && <p className="text-muted-foreground">{blocked}</p>}
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant="outline"
                    disabled={!!blocked || busy}
                    onClick={() => scan.mutate()}
                >
                    {running && status?.mode === 'SCAN' ? 'Looking…' : 'Find leftovers'}
                </Button>
                {scanned && toRemove > 0 && (
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={!!blocked || busy}
                        onClick={() => setConfirming(true)}
                    >
                        Remove {toRemove} {toRemove === 1 ? 'item' : 'items'}
                    </Button>
                )}
            </div>

            <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove leftovers?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {scanned && confirmText(planCounts(scanned))}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                setConfirming(false);
                                if (status) remove.mutate(String(status.jobId));
                            }}
                        >
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function StatusSummary({ status }: Readonly<{ status: Status }>) {
    if (status.state === 'RUNNING') {
        return (
            <div className="flex items-center gap-2">
                <Badge variant="warning">Running</Badge>
                <span className="text-muted-foreground">
                    {status.mode === 'SCAN' ? 'Looking for leftovers…' : 'Removing leftovers…'}
                </span>
            </div>
        );
    }
    if (status.state !== 'COMPLETED') {
        return (
            <div className="flex flex-col gap-1">
                <Badge variant="destructive" className="self-start">
                    {status.state === 'CANCELLED' ? 'Cancelled' : 'Failed'}
                </Badge>
                {status.error && <span className="text-destructive">{status.error}</span>}
            </div>
        );
    }
    const finished = status.finishedAt ? new Date(status.finishedAt).toLocaleString() : '';
    if (status.mode === 'REMOVE' && status.removed) {
        return (
            <p className="text-muted-foreground">
                Removed {describe(status.removed)} {finished && `Finished ${finished}.`}
            </p>
        );
    }
    const plan = status.plan;
    if (!plan) return null;
    const found = KINDS.filter(k => plan[k.key].count > 0);
    return (
        <div className="flex flex-col gap-3">
            <span className="text-muted-foreground">Last checked {finished}</span>
            {found.length ? (
                found.map(k => (
                    <div key={k.key} className="flex flex-col gap-0.5">
                        <span className="font-medium">
                            {k.label}: {plan[k.key].count}
                        </span>
                        <span className="text-muted-foreground">
                            {plan[k.key].examples.join(', ')}
                            {plan[k.key].count > plan[k.key].examples.length ? ', …' : ''}
                        </span>
                    </div>
                ))
            ) : (
                <span>Nothing to clean up.</span>
            )}
            {plan.kept.length > 0 && (
                <div className="flex flex-col gap-0.5">
                    <span className="font-medium">Kept</span>
                    {plan.kept.map(k => (
                        <span key={`${k.kind}:${k.name}`} className="text-muted-foreground">
                            {k.name}: {k.reason}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function confirmText(counts: Record<(typeof KINDS)[number]['key'], number>): string {
    const parts = [`This removes ${describe(counts)}`];
    if (counts.products || counts.variants) {
        parts.push('Products and variants are soft-deleted, so past orders keep working.');
    }
    if (counts.collections || counts.assets) parts.push('Collections and images are deleted for good.');
    parts.push('Anything that is back in Akeneo by then is left alone.');
    return parts.join(' ');
}

/** e.g. "2 products, 8 collections and 1 image." */
function describe(counts: Record<(typeof KINDS)[number]['key'], number>): string {
    const nouns = {
        products: ['product', 'products'],
        variants: ['variant', 'variants'],
        collections: ['collection', 'collections'],
        assets: ['image', 'images'],
    } as const;
    const parts = KINDS.filter(k => counts[k.key] > 0).map(
        k => `${counts[k.key]} ${nouns[k.key][counts[k.key] === 1 ? 0 : 1]}`,
    );
    if (!parts.length) return 'nothing.';
    const last = parts.pop();
    return `${parts.length ? `${parts.join(', ')} and ` : ''}${last}.`;
}
