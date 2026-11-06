import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { DeletionResponse, DeletionResult } from '@vendure/common/lib/generated-types';
import { Allow, Ctx, RequestContext, Transaction } from '@vendure/core';

import { AkeneoConnectionSettings } from '../entities/akeneo-connection-settings.entity';
import { manageAkeneoSyncPermission } from '../permissions';
import { AkeneoConnectionSettingsService } from '../services/akeneo-connection-settings.service';
import {
    AkeneoCredentialValidationResult,
    SaveAkeneoConnectionSettingsInput,
    ValidateAkeneoCredentialsInput,
} from '../types';

@Resolver()
export class AkeneoConnectionSettingsAdminResolver {
    constructor(private settingsService: AkeneoConnectionSettingsService) {}

    @Query()
    @Allow(manageAkeneoSyncPermission.Permission)
    akeneoConnectionSettings(@Ctx() ctx: RequestContext): Promise<AkeneoConnectionSettings | null> {
        return this.settingsService.findForChannel(ctx);
    }

    @Mutation()
    @Transaction()
    @Allow(manageAkeneoSyncPermission.Permission)
    saveAkeneoConnectionSettings(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: SaveAkeneoConnectionSettingsInput },
    ): Promise<AkeneoConnectionSettings> {
        return this.settingsService.save(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(manageAkeneoSyncPermission.Permission)
    validateAkeneoCredentials(
        @Ctx() ctx: RequestContext,
        @Args() args: { input?: ValidateAkeneoCredentialsInput | null },
    ): Promise<AkeneoCredentialValidationResult> {
        return this.settingsService.validate(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(manageAkeneoSyncPermission.Permission)
    async deleteAkeneoConnectionSettings(@Ctx() ctx: RequestContext): Promise<DeletionResponse> {
        const deleted = await this.settingsService.delete(ctx);
        return deleted
            ? { result: DeletionResult.DELETED }
            : {
                  result: DeletionResult.NOT_DELETED,
                  message: 'No Akeneo connection settings exist for this channel',
              };
    }
}

@Resolver('AkeneoConnectionSettings')
export class AkeneoConnectionSettingsEntityResolver {
    @ResolveField()
    hasSecret(@Parent() settings: AkeneoConnectionSettings): boolean {
        return !!settings.encryptedSecret;
    }

    @ResolveField()
    hasPassword(@Parent() settings: AkeneoConnectionSettings): boolean {
        return !!settings.encryptedPassword;
    }
}
