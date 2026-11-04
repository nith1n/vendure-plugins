import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, RequestContext, Transaction } from '@vendure/core';

import { AkeneoConnectionSettings, AkeneoLocaleMapping } from '../entities/akeneo-connection-settings.entity';
import { manageAkeneoSyncPermission } from '../permissions';
import { AkeneoCategorySyncService } from '../services/akeneo-category-sync.service';
import { AkeneoSyncSettingsService } from '../services/akeneo-sync-settings.service';
import { AkeneoCategoryTreeOption, AkeneoChannelOption, SaveAkeneoSyncSettingsInput } from '../types';

@Resolver()
export class AkeneoSyncAdminResolver {
    constructor(
        private categorySyncService: AkeneoCategorySyncService,
        private syncSettingsService: AkeneoSyncSettingsService,
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
    akeneoSuggestedLocaleMapping(
        @Ctx() ctx: RequestContext,
        @Args() args: { channelCode: string },
    ): Promise<AkeneoLocaleMapping[]> {
        return this.syncSettingsService.suggestLocaleMapping(ctx, args.channelCode);
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

    @Mutation()
    @Allow(manageAkeneoSyncPermission.Permission)
    startAkeneoCategorySync(@Ctx() ctx: RequestContext) {
        return this.categorySyncService.startSync(ctx);
    }
}
