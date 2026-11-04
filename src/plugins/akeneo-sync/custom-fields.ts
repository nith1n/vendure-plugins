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
    }
    interface CustomAssetFields {
        akeneoCode: string | null;
    }
}

const akeneoField = (name: 'akeneoCode' | 'akeneoUuid'): CustomFieldConfig => ({
    name,
    type: 'string',
    label: [{ languageCode: LanguageCode.en, value: name === 'akeneoCode' ? 'Akeneo code' : 'Akeneo UUID' }],
    nullable: true,
    readonly: true,
    public: false,
    unique: true,
    ui: { tab: 'Akeneo' },
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
    // Category code
    Collection: [akeneoField('akeneoCode')],
    // Asset code
    Asset: [akeneoField('akeneoCode')],
};
