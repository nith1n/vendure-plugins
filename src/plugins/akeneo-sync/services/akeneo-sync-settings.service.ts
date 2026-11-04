import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

import { AkeneoApiClient } from '../akeneo/akeneo-api-client';
import { AkeneoChannel, AkeneoPage } from '../akeneo/akeneo-types';
import { AkeneoConnectionSettings, AkeneoLocaleMapping } from '../entities/akeneo-connection-settings.entity';
import { AkeneoCategoryTreeOption, AkeneoChannelOption, SaveAkeneoSyncSettingsInput } from '../types';
import { displayLabel, suggestLocaleMapping } from '../utils/locales';

import { AkeneoApiService } from './akeneo-api.service';
import { AkeneoConnectionSettingsService } from './akeneo-connection-settings.service';

/**
 * What to sync for a Vendure channel: the Akeneo channel, which Akeneo locale feeds each
 * Vendure language, and which category trees become Collections. Option lists are read
 * live from Akeneo so admins pick from what actually exists.
 */
@Injectable()
export class AkeneoSyncSettingsService {
    constructor(
        private connection: TransactionalConnection,
        private connectionSettingsService: AkeneoConnectionSettingsService,
        private akeneoApiService: AkeneoApiService,
    ) {}

    async getChannelOptions(ctx: RequestContext): Promise<AkeneoChannelOption[]> {
        const channels = await this.fetchChannels(ctx);
        return channels.map(c => ({
            code: c.code,
            label: displayLabel(c.labels, ctx.languageCode, c.code),
            categoryTree: c.category_tree,
            locales: c.locales,
        }));
    }

    async getCategoryTreeOptions(ctx: RequestContext): Promise<AkeneoCategoryTreeOption[]> {
        const client = await this.akeneoApiService.getClient(ctx);
        const roots = await collect(client, await client.categoryTrees());
        return roots.map(c => ({ code: c.code, label: displayLabel(c.labels, ctx.languageCode, c.code) }));
    }

    async suggestLocaleMapping(ctx: RequestContext, channelCode: string): Promise<AkeneoLocaleMapping[]> {
        const channel = await this.findChannel(ctx, channelCode);
        return suggestLocaleMapping(ctx.channel.availableLanguageCodes ?? [], channel.locales);
    }

    async save(ctx: RequestContext, input: SaveAkeneoSyncSettingsInput): Promise<AkeneoConnectionSettings> {
        const settings = await this.connectionSettingsService.findForChannel(ctx);
        if (!settings) throw new UserInputError('Save the Akeneo connection before configuring the sync');

        const channel = await this.findChannel(ctx, input.channelCode);

        const languages = new Set(ctx.channel.availableLanguageCodes ?? []);
        const seen = new Set<string>();
        for (const { languageCode, locale } of input.localeMapping) {
            if (!languages.has(languageCode)) {
                throw new UserInputError(`Language "${languageCode}" is not available in this channel`);
            }
            if (seen.has(languageCode)) {
                throw new UserInputError(`Language "${languageCode}" is mapped more than once`);
            }
            if (!channel.locales.includes(locale)) {
                throw new UserInputError(
                    `Locale "${locale}" is not enabled on Akeneo channel "${channel.code}"`,
                );
            }
            seen.add(languageCode);
        }

        const treeCodes = [...new Set(input.categoryTreeCodes)];
        if (treeCodes.length) {
            const trees = new Set((await this.getCategoryTreeOptions(ctx)).map(t => t.code));
            const unknown = treeCodes.filter(code => !trees.has(code));
            if (unknown.length) {
                throw new UserInputError(`Not Akeneo category trees: ${unknown.join(', ')}`);
            }
        }

        settings.channelCode = channel.code;
        settings.localeMapping = input.localeMapping;
        settings.categoryTreeCodes = treeCodes;
        settings.includeCategoryRoot = input.includeCategoryRoot;
        settings.enabled = input.enabled;
        return this.connection.getRepository(ctx, AkeneoConnectionSettings).save(settings);
    }

    private async findChannel(ctx: RequestContext, code: string): Promise<AkeneoChannel> {
        const channel = (await this.fetchChannels(ctx)).find(c => c.code === code);
        if (!channel) throw new UserInputError(`Akeneo channel "${code}" does not exist`);
        return channel;
    }

    private async fetchChannels(ctx: RequestContext): Promise<AkeneoChannel[]> {
        const client = await this.akeneoApiService.getClient(ctx);
        return collect(client, await client.channels());
    }
}

/** Option lists are small (channels, tree roots), so reading every page is fine. */
async function collect<T>(client: AkeneoApiClient, first: AkeneoPage<T>): Promise<T[]> {
    const items: T[] = [];
    for await (const page of client.pages(first)) items.push(...page.items);
    return items;
}
