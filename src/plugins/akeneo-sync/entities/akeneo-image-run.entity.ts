import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * @description
 * Image download totals of one product sync run. A run queues one asset job per page, so a
 * large catalog has more jobs than can be listed; the jobs add their results here instead.
 */
@Entity()
export class AkeneoImageRun extends VendureEntity {
    constructor(input?: DeepPartial<AkeneoImageRun>) {
        super(input);
    }

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 64 })
    runId: string;

    @Column({ type: 'int', default: 0 })
    queued: number;

    @Column({ type: 'int', default: 0 })
    completed: number;

    /** Jobs that failed their last attempt. */
    @Column({ type: 'int', default: 0 })
    failed: number;

    @Column({ type: 'int', default: 0 })
    downloaded: number;

    @Column({ type: 'int', default: 0 })
    reused: number;

    @Column({ type: 'int', default: 0 })
    assigned: number;

    @Column({ type: 'int', default: 0 })
    skipped: number;
}
