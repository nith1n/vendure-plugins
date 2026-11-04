/**
 * Subset of the Akeneo REST API resources used by the sync. Only the fields we
 * read are typed; Akeneo returns more.
 *
 * @see https://api.akeneo.com/api-reference-index.html
 */

/** Locale code (e.g. `en_US`) -> label. */
export type AkeneoLabels = Record<string, string | null>;

export interface AkeneoPage<T> {
    items: T[];
    /** Absolute URL of the next page, or null on the last page. */
    next: string | null;
}

export interface AkeneoSearchFilter {
    operator: string;
    value?: unknown;
    locale?: string;
    scope?: string;
}

/** Akeneo `search` query parameter: property/attribute code -> filters. */
export type AkeneoSearch = Record<string, AkeneoSearchFilter[]>;

export interface AkeneoListOptions {
    /** Page size, max 100. */
    limit?: number;
    search?: AkeneoSearch;
}

export interface AkeneoCategory {
    code: string;
    parent: string | null;
    labels: AkeneoLabels;
    updated?: string;
    position?: number;
}

export interface AkeneoAttribute {
    code: string;
    /** e.g. `pim_catalog_simpleselect`, `pim_catalog_text`, `pim_catalog_image`. */
    type: string;
    group: string;
    localizable: boolean;
    scopable: boolean;
    labels: AkeneoLabels;
    sort_order?: number;
}

export interface AkeneoAttributeOption {
    code: string;
    attribute: string;
    sort_order: number;
    labels: AkeneoLabels;
}

export interface AkeneoFamily {
    code: string;
    attribute_as_label: string;
    attribute_as_image: string | null;
    attributes: string[];
    labels: AkeneoLabels;
}

export interface AkeneoFamilyVariant {
    code: string;
    labels: AkeneoLabels;
    variant_attribute_sets: Array<{ level: number; axes: string[]; attributes: string[] }>;
}

export interface AkeneoValue {
    locale: string | null;
    scope: string | null;
    data: unknown;
}

/** Attribute code -> one value per locale/scope combination. */
export type AkeneoValues = Record<string, AkeneoValue[]>;

export interface AkeneoProductModel {
    code: string;
    family: string;
    family_variant: string;
    /** Parent product model code, for the second level of a two-level family variant. */
    parent: string | null;
    categories: string[];
    values: AkeneoValues;
    created: string;
    updated: string;
}

export interface AkeneoProduct {
    uuid: string;
    identifier?: string | null;
    enabled: boolean;
    family: string | null;
    /** Product model code. Null for simple products without variants. */
    parent: string | null;
    categories: string[];
    values: AkeneoValues;
    created: string;
    updated: string;
}

/** Asset Manager values use `channel` where product values use `scope`. */
export interface AkeneoAssetValue {
    locale: string | null;
    channel: string | null;
    data: unknown;
}

export interface AkeneoAsset {
    code: string;
    values: Record<string, AkeneoAssetValue[]>;
    created?: string;
    updated?: string;
}
