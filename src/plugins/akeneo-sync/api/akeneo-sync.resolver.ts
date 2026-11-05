import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, RequestContext, Transaction } from '@vendure/core';

import { AkeneoConnectionSettings, AkeneoLocaleMapping } from '../entities/akeneo-connection-settings.entity';
import { manageAkeneoSyncPermission } from '../permissions';
import { AkeneoCategorySyncService, CategorySyncStatus } from '../services/akeneo-category-sync.service';
import { AkeneoProductSyncService, ProductSyncStatus } from '../services/akeneo-product-sync.service';
import { AkeneoSyncSettingsService } from '../services/akeneo-sync-settings.service';
import {
    AkeneoAttributeChoice,
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
    startAkeneoProductSync(@Ctx() ctx: RequestContext) {
        return this.productSyncService.startSync(ctx);
    }

    @Mutation()
    @Allow(manageAkeneoSyncPermission.Permission)
    startAkeneoCategorySync(@Ctx() ctx: RequestContext) {
        return this.categorySyncService.startSync(ctx);
    }
}
