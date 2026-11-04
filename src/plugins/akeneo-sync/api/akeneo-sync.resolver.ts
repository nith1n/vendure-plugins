import { Mutation, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, RequestContext } from '@vendure/core';

import { manageAkeneoSyncPermission } from '../permissions';
import { AkeneoCategorySyncService } from '../services/akeneo-category-sync.service';

@Resolver()
export class AkeneoSyncAdminResolver {
    constructor(private categorySyncService: AkeneoCategorySyncService) {}

    @Mutation()
    @Allow(manageAkeneoSyncPermission.Permission)
    startAkeneoCategorySync(@Ctx() ctx: RequestContext) {
        return this.categorySyncService.startSync(ctx);
    }
}
