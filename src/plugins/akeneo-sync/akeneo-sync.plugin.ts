import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import {
    AkeneoConnectionSettingsAdminResolver,
    AkeneoConnectionSettingsEntityResolver,
} from './api/akeneo-connection-settings.resolver';
import { adminApiExtensions } from './api/api-extensions';
import { AKENEO_SYNC_PLUGIN_OPTIONS } from './constants';
import { AkeneoConnectionSettings } from './entities/akeneo-connection-settings.entity';
import { manageAkeneoSyncPermission } from './permissions';
import { AkeneoConnectionSettingsService } from './services/akeneo-connection-settings.service';
import { PluginInitOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        { provide: AKENEO_SYNC_PLUGIN_OPTIONS, useFactory: () => AkeneoSyncPlugin.options },
        AkeneoConnectionSettingsService,
    ],
    entities: [AkeneoConnectionSettings],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [AkeneoConnectionSettingsAdminResolver, AkeneoConnectionSettingsEntityResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions.push(manageAkeneoSyncPermission);
        return config;
    },
    exports: [AkeneoConnectionSettingsService],
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
