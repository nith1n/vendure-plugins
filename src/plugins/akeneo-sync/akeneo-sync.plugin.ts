import { CustomFields, PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import {
    AkeneoConnectionSettingsAdminResolver,
    AkeneoConnectionSettingsEntityResolver,
} from './api/akeneo-connection-settings.resolver';
import { adminApiExtensions } from './api/api-extensions';
import { AkeneoSyncAdminResolver } from './api/akeneo-sync.resolver';
import { akeneoCategoryCollectionFilter } from './config/akeneo-category-collection-filter';
import { AKENEO_SYNC_PLUGIN_OPTIONS } from './constants';
import { akeneoCustomFields } from './custom-fields';
import { AkeneoConnectionSettings } from './entities/akeneo-connection-settings.entity';
import { AkeneoVariantCategory } from './entities/akeneo-variant-category.entity';
import { manageAkeneoSyncPermission } from './permissions';
import { AkeneoApiService } from './services/akeneo-api.service';
import { AkeneoAssetSyncService } from './services/akeneo-asset-sync.service';
import { AkeneoCategorySyncService } from './services/akeneo-category-sync.service';
import { AkeneoConnectionSettingsService } from './services/akeneo-connection-settings.service';
import { AkeneoProductSyncService } from './services/akeneo-product-sync.service';
import { AkeneoSyncSettingsService } from './services/akeneo-sync-settings.service';
import { PluginInitOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        { provide: AKENEO_SYNC_PLUGIN_OPTIONS, useFactory: () => AkeneoSyncPlugin.options },
        AkeneoConnectionSettingsService,
        AkeneoApiService,
        AkeneoCategorySyncService,
        AkeneoSyncSettingsService,
        AkeneoProductSyncService,
        AkeneoAssetSyncService,
    ],
    entities: [AkeneoConnectionSettings, AkeneoVariantCategory],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [
            AkeneoConnectionSettingsAdminResolver,
            AkeneoConnectionSettingsEntityResolver,
            AkeneoSyncAdminResolver,
        ],
    },
    configuration: config => {
        config.authOptions.customPermissions.push(manageAkeneoSyncPermission);
        config.catalogOptions.collectionFilters.push(akeneoCategoryCollectionFilter);
        for (const [entity, fields] of Object.entries(akeneoCustomFields)) {
            const key = entity as keyof CustomFields;
            config.customFields[key] = [...(config.customFields[key] ?? []), ...(fields ?? [])];
        }
        return config;
    },
    exports: [AkeneoConnectionSettingsService, AkeneoApiService],
    dashboard: './dashboard/index.tsx',
    compatibility: '^3.0.0',
})
export class AkeneoSyncPlugin {
    static options: PluginInitOptions = {};

    static init(options: PluginInitOptions): Type<AkeneoSyncPlugin> {
        this.options = options;
        return AkeneoSyncPlugin;
    }
}
