import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, RequestContext, Transaction } from '@vendure/core';

import { AkeneoConnectionSettings, AkeneoLocaleMapping } from '../entities/akeneo-connection-settings.entity';
import { manageAkeneoSyncPermission } from '../permissions';
import { AkeneoCategorySyncService, CategorySyncStatus } from '../services/akeneo-category-sync.service';
import { AkeneoCleanupService, CleanupPlan, kindCount } from '../services/akeneo-cleanup.service';
import { AkeneoProductSyncService, ProductSyncStatus } from '../services/akeneo-product-sync.service';
import { AkeneoSyncSettingsService } from '../services/akeneo-sync-settings.service';
import {
    AkeneoAttributeChoice,
    AkeneoFamilyOption,
    AkeneoCategoryTreeOption,
    AkeneoChannelOption,
    SaveAkeneoSyncSettingsInput,
} from '../types';

@Resolver()
export class AkeneoSyncAdminResolver {
    constructor(
        private categorySyncService: AkeneoCategorySyncService,
        private syncSettingsService: AkeneoSyncSettingsService,
        private productSyncService: AkeneoProductSyncService,
        private cleanupService: AkeneoCleanupService,
    ) {}

    @Query()
    @Allow(manageAkeneoSyncPermission.Permission)
    akeneoChannels(@Ctx() ctx: RequestContext): Promise<AkeneoChannelOption[]> {
        return this.syncSettingsService.getChannelOptions(ctx);
    }

    @Query()
    @Allow(manageAkeneoSyncPermission.Permission)
    akeneoCategoryTrees(@Ctx() ctx: RequestContext): Promise<AkeneoCategoryTreeOption[]> {
        return this.syncSettingsService.getCategoryTreeOptions(ctx);
    }

    @Query()
    @Allow(manageAkeneoSyncPermission.Permission)
    akeneoAttributeChoices(@Ctx() ctx: RequestContext): Promise<AkeneoAttributeChoice[]> {
        return this.syncSettingsService.getAttributeChoices(ctx);
    }

    @Query()
    @Allow(manageAkeneoSyncPermission.Permission)
    akeneoFamilies(@Ctx() ctx: RequestContext): Promise<AkeneoFamilyOption[]> {
        return this.syncSettingsService.getFamilyOptions(ctx);
    }

    @Query()
    @Allow(manageAkeneoSyncPermission.Permission)
    akeneoSuggestedLocaleMapping(
        @Ctx() ctx: RequestContext,
        @Args() args: { channelCode: string },
    ): Promise<AkeneoLocaleMapping[]> {
        return this.syncSettingsService.suggestLocaleMapping(ctx, args.channelCode);
    }

    @Query()
    @Allow(manageAkeneoSyncPermission.Permission)
    akeneoCategorySyncStatus(@Ctx() ctx: RequestContext): Promise<CategorySyncStatus | null> {
        return this.categorySyncService.getStatus(ctx);
    }

    @Mutation()
    @Transaction()
    @Allow(manageAkeneoSyncPermission.Permission)
    saveAkeneoSyncSettings(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: SaveAkeneoSyncSettingsInput },
    ): Promise<AkeneoConnectionSettings> {
        return this.syncSettingsService.save(ctx, args.input);
    }

    @Query()
    @Allow(manageAkeneoSyncPermission.Permission)
    akeneoProductSyncStatus(@Ctx() ctx: RequestContext): Promise<ProductSyncStatus | null> {
        return this.productSyncService.getStatus(ctx);
    }

    @Mutation()
    @Allow(manageAkeneoSyncPermission.Permission)
    startAkeneoProductSync(@Ctx() ctx: RequestContext, @Args() args: { changesOnly?: boolean | null }) {
        return this.productSyncService.startSync(ctx, !!args.changesOnly);
    }

    @Query()
    @Allow(manageAkeneoSyncPermission.Permission)
    akeneoProductSyncChangesSince(@Ctx() ctx: RequestContext): Promise<Date | null> {
        return this.productSyncService.getChangesSince(ctx);
    }

    @Query()
    @Allow(manageAkeneoSyncPermission.Permission)
    async akeneoCleanupStatus(@Ctx() ctx: RequestContext) {
        const status = await this.cleanupService.getStatus(ctx);
        return status && { ...status, plan: status.plan && toPlanOutput(status.plan) };
    }

    @Mutation()
    @Allow(manageAkeneoSyncPermission.Permission)
    scanAkeneoLeftovers(@Ctx() ctx: RequestContext) {
        return this.cleanupService.startScan(ctx);
    }

    @Mutation()
    @Allow(manageAkeneoSyncPermission.Permission)
    removeAkeneoLeftovers(@Ctx() ctx: RequestContext, @Args() args: { scanJobId: ID }) {
        return this.cleanupService.startRemove(ctx, args.scanJobId);
    }

    @Mutation()
    @Allow(manageAkeneoSyncPermission.Permission)
    startAkeneoCategorySync(@Ctx() ctx: RequestContext) {
        return this.categorySyncService.startSync(ctx);
    }
}

/** The plan without the ids, which only the remove job needs. */
function toPlanOutput(plan: CleanupPlan) {
    const kind = (k: CleanupPlan['products']) => ({ count: kindCount(k), examples: k.examples });
    return {
        products: kind(plan.products),
        variants: kind(plan.variants),
        // Scans from before options were cleaned up have none
        options: plan.options ? kind(plan.options) : { count: 0, examples: [] },
        optionGroups: plan.optionGroups ? kind(plan.optionGroups) : { count: 0, examples: [] },
        collections: kind(plan.collections),
        assets: kind(plan.assets),
        kept: plan.kept,
    };
}
