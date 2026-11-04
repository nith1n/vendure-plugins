import { CustomFieldConfig, CustomFields, LanguageCode } from '@vendure/core';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductFields {
        akeneoCode: string | null;
        akeneoUuid: string | null;
    }
    interface CustomProductVariantFields {
        akeneoUuid: string | null;
    }
    interface CustomCollectionFields {
        akeneoCode: string | null;
        akeneoChannelId: string | null;
    }
    interface CustomAssetFields {
        akeneoCode: string | null;
    }
}

const akeneoField = (
    name: 'akeneoCode' | 'akeneoUuid',
    options: Pick<CustomFieldConfig, 'unique' | 'index'> = { unique: true },
): CustomFieldConfig => ({
    name,
    type: 'string',
    label: [{ languageCode: LanguageCode.en, value: name === 'akeneoCode' ? 'Akeneo code' : 'Akeneo UUID' }],
    nullable: true,
    readonly: true,
    public: false,
    ui: { tab: 'Akeneo' },
    ...options,
});

/**
 * Akeneo identifiers used to match incoming Akeneo records to existing Vendure entities.
 * Postgres allows multiple NULLs in a unique index, so unsynced rows are fine.
 * Facets and FacetValues match on their built-in `code` (attribute / option code) instead.
 */
export const akeneoCustomFields: CustomFields = {
    // Product models (akeneoCode) and simple products without variants (akeneoUuid)
    Product: [akeneoField('akeneoCode'), akeneoField('akeneoUuid')],
    ProductVariant: [akeneoField('akeneoUuid')],
    // Category code. Each Vendure channel syncs its own Collections, so the code is only unique
    // per owning channel (new Collections are always also assigned to the default channel).
    Collection: [
        akeneoField('akeneoCode', { index: true }),
        { name: 'akeneoChannelId', type: 'string', nullable: true, internal: true, index: true },
    ],
    // Asset code
    Asset: [akeneoField('akeneoCode')],
};
