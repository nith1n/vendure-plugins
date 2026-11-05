import { JobFilterParameter, JobState, SortOrder } from '@vendure/common/lib/generated-types';
import { ConfigService, isInspectableJobQueueStrategy, Job, JobData, RequestContext } from '@vendure/core';

/**
 * Sync runs are chains of page jobs: each job processes one Akeneo page and queues the next,
 * carrying the run's id and totals forward in its data. The newest job of a run therefore
 * describes the whole run.
 */
export interface SyncRunJobData {
    channelId: string;
    runId: string;
    startedAt: string;
}

export type SyncRunState = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export const ACTIVE_JOB_STATES = [JobState.PENDING, JobState.RUNNING, JobState.RETRYING];

/** How many recent jobs of a queue to look through for a channel's latest run. */
const LOOKBACK = 50;

/** Jobs of the queue for the active channel, newest first. Jobs without a `runId` are ignored. */
export async function findChannelJobs<D extends SyncRunJobData & JobData<D>>(
    configService: ConfigService,
    ctx: RequestContext,
    queueName: string,
    filter: JobFilterParameter = {},
): Promise<Array<Job<D>>> {
    const strategy = configService.jobQueueOptions.jobQueueStrategy;
    // Without an inspectable strategy there is no way to list jobs; report no runs
    if (!isInspectableJobQueueStrategy(strategy)) return [];
    const { items } = await strategy.findMany({
        filter: { queueName: { eq: queueName }, ...filter },
        sort: { createdAt: SortOrder.DESC },
        take: LOOKBACK,
    });
    return items
        .map(job => job as Job<D>)
        .filter(job => job.data.runId && job.data.channelId === String(ctx.channelId));
}

export function hasActiveRun(jobs: Job[]): boolean {
    return jobs.some(job => ACTIVE_JOB_STATES.includes(job.state));
}

/** While a page is queued or running the run is still going; otherwise its outcome is the run's. */
export function runState(latest: Job): SyncRunState {
    if (ACTIVE_JOB_STATES.includes(latest.state)) return 'RUNNING';
    if (latest.state === JobState.COMPLETED) return 'COMPLETED';
    if (latest.state === JobState.CANCELLED) return 'CANCELLED';
    return 'FAILED';
}

export function errorText(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    return error ? JSON.stringify(error) : 'Unknown error';
}
