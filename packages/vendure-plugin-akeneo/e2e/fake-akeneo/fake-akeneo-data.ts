type Labels = Record<string, string>;
type Value = { locale: string | null; scope: string | null; data: unknown };
type Values = Record<string, Value[]>;

export type FakeCategory = { code: string; parent: string | null; labels: Labels };
export type FakeAttribute = {
    code: string;
    type: string;
    group: string;
    sort_order: number;
    localizable: boolean;
    scopable: boolean;
    labels: Labels;
    is_main_identifier?: boolean;
    reference_data_name?: string;
};
export type FakeProductModel = {
    code: string;
    family: string;
    family_variant: string;
    parent: string | null;
    categories: string[];
    values: Values;
    updated: string;
};
export type FakeProduct = {
    uuid: string;
    identifier: string;
    enabled: boolean;
    family: string | null;
    parent: string | null;
    categories: string[];
    values: Values;
    updated: string;
};

export type FakeAkeneoData = {
    channels: Array<{
        code: string;
        labels: Labels;
        category_tree: string;
        locales: string[];
        currencies: string[];
    }>;
    categories: FakeCategory[];
    attributes: FakeAttribute[];
    attributeGroups: Array<{ code: string; sort_order: number; labels: Labels }>;
    attributeOptions: Record<
        string,
        Array<{ code: string; attribute: string; sort_order: number; labels: Labels }>
    >;
    families: Array<{
        code: string;
        labels: Labels;
        attribute_as_label: string;
        attribute_as_image: string | null;
        attributes: string[];
    }>;
    familyVariants: Record<
        string,
        Array<{
            code: string;
            labels: Labels;
            variant_attribute_sets: Array<{ level: number; axes: string[]; attributes: string[] }>;
        }>
    >;
    productModels: FakeProductModel[];
    products: FakeProduct[];
    assetFamilies: Array<{ code: string; labels: Labels; attribute_as_main_media: string }>;
    assetFamilyAttributes: Record<string, Array<{ code: string; type: string; media_type?: string }>>;
    assets: Record<
        string,
        Array<{
            code: string;
            values: Record<string, Array<{ locale: string | null; channel: string | null; data: unknown }>>;
        }>
    >;
    files: Record<string, { contentType: string; bytes: Buffer }>;
};

/** A 1×1 PNG, so Vendure's content type check accepts the downloaded images. */
export const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

export const UPDATED = '2026-01-01T00:00:00+00:00';

const text = (data: string, locale: string | null = null): Value => ({ locale, scope: null, data });
const image = (code: string): Value => ({ locale: null, scope: null, data: code });

/** File codes as Akeneo stores them: a hash path and the original file name. */
export const FILES = {
    shirt: 'a/b/c/d/1111111111111111111111111111111111111111_shirt.png',
    shirtRed: 'a/b/c/e/2222222222222222222222222222222222222222_shirt_red.png',
    belt: 'a/b/c/f/3333333333333333333333333333333333333333_belt.png',
    front: 'a/b/d/a/4444444444444444444444444444444444444444_front.png',
    poster: 'a/b/d/b/5555555555555555555555555555555555555555_poster.png',
};

/**
 * A small catalog covering each mapping case:
 * - `shirt`: a two-level product model (color, then size) with three variant products, an image
 *   on the root model, another on the red sub model, and an Asset Manager image.
 * - `belt`: a simple product with prices in two currencies.
 * - `poster`: a product outside the `ecommerce` channel's category tree.
 */
export function catalogFixture(): FakeAkeneoData {
    return {
        channels: [
            {
                code: 'ecommerce',
                labels: { en_US: 'E-commerce' },
                category_tree: 'master',
                locales: ['en_US', 'en_GB'],
                currencies: ['USD', 'EUR'],
            },
            {
                code: 'print',
                labels: { en_US: 'Print' },
                category_tree: 'print_catalog',
                locales: ['en_US'],
                currencies: ['USD'],
            },
        ],
        categories: [
            { code: 'master', parent: null, labels: { en_US: 'Master catalog' } },
            { code: 'clothing', parent: 'master', labels: { en_US: 'Clothing', en_GB: 'Clothes' } },
            { code: 'shirts', parent: 'clothing', labels: { en_US: 'Shirts' } },
            { code: 'accessories', parent: 'master', labels: { en_US: 'Accessories' } },
            { code: 'print_catalog', parent: null, labels: { en_US: 'Print catalog' } },
            { code: 'posters', parent: 'print_catalog', labels: { en_US: 'Posters' } },
        ],
        attributes: [
            attribute('sku', 'pim_catalog_identifier', 'general', 0, { is_main_identifier: true }),
            attribute('name', 'pim_catalog_text', 'general', 1, { localizable: true }),
            attribute('description', 'pim_catalog_textarea', 'general', 2, { localizable: true }),
            attribute('price', 'pim_catalog_price_collection', 'general', 3),
            attribute('color', 'pim_catalog_simpleselect', 'general', 4),
            attribute('size', 'pim_catalog_simpleselect', 'general', 5),
            attribute('image', 'pim_catalog_image', 'media', 0),
            attribute('gallery', 'pim_catalog_asset_collection', 'media', 1, {
                reference_data_name: 'packshots',
            }),
            attribute('detail_image', 'pim_catalog_image', 'media', 2),
        ],
        attributeGroups: [
            { code: 'general', sort_order: 1, labels: { en_US: 'General' } },
            { code: 'media', sort_order: 2, labels: { en_US: 'Media' } },
        ],
        attributeOptions: {
            color: [
                { code: 'red', attribute: 'color', sort_order: 1, labels: { en_US: 'Red' } },
                { code: 'blue', attribute: 'color', sort_order: 2, labels: { en_US: 'Blue' } },
            ],
            size: [
                { code: 's', attribute: 'size', sort_order: 1, labels: { en_US: 'S' } },
                { code: 'm', attribute: 'size', sort_order: 2, labels: { en_US: 'M' } },
            ],
        },
        families: [
            {
                code: 'clothing',
                labels: { en_US: 'Clothing' },
                // Families often use the SKU as their label; the sync settings pick the real name
                attribute_as_label: 'sku',
                attribute_as_image: 'image',
                attributes: ['sku', 'name', 'description', 'price', 'color', 'size', 'image', 'gallery'],
            },
            {
                code: 'accessories',
                labels: { en_US: 'Accessories' },
                attribute_as_label: 'name',
                attribute_as_image: 'image',
                attributes: ['sku', 'name', 'description', 'price', 'image', 'detail_image'],
            },
        ],
        familyVariants: {
            clothing: [
                {
                    code: 'clothing_color_size',
                    labels: { en_US: 'By color and size' },
                    variant_attribute_sets: [
                        { level: 1, axes: ['color'], attributes: ['color', 'image'] },
                        { level: 2, axes: ['size'], attributes: ['size', 'sku', 'price'] },
                    ],
                },
            ],
        },
        productModels: [
            {
                code: 'shirt',
                family: 'clothing',
                family_variant: 'clothing_color_size',
                parent: null,
                categories: ['shirts'],
                values: {
                    name: [text('Shirt', 'en_US'), text('Shirt (GB)', 'en_GB')],
                    description: [text('A cotton shirt', 'en_US')],
                    image: [image(FILES.shirt)],
                    gallery: [{ locale: null, scope: null, data: ['shirt_front'] }],
                },
                updated: UPDATED,
            },
            {
                code: 'shirt_red',
                family: 'clothing',
                family_variant: 'clothing_color_size',
                parent: 'shirt',
                categories: [],
                values: { color: [text('red')], image: [image(FILES.shirtRed)] },
                updated: UPDATED,
            },
            {
                code: 'shirt_blue',
                family: 'clothing',
                family_variant: 'clothing_color_size',
                parent: 'shirt',
                categories: [],
                values: { color: [text('blue')] },
                updated: UPDATED,
            },
        ],
        products: [
            variant('00000000-0000-4000-8000-000000000001', 'shirt-red-s', 'shirt_red', 's', '19.99'),
            variant('00000000-0000-4000-8000-000000000002', 'shirt-red-m', 'shirt_red', 'm', '19.99'),
            variant('00000000-0000-4000-8000-000000000003', 'shirt-blue-s', 'shirt_blue', 's', '21.50'),
            {
                uuid: '00000000-0000-4000-8000-000000000010',
                identifier: 'belt',
                enabled: true,
                family: 'accessories',
                parent: null,
                categories: ['accessories'],
                values: {
                    sku: [text('belt')],
                    name: [text('Leather belt', 'en_US')],
                    price: [
                        {
                            locale: null,
                            scope: null,
                            data: [
                                { amount: '25.50', currency: 'USD' },
                                { amount: '23.00', currency: 'EUR' },
                            ],
                        },
                    ],
                    image: [image(FILES.belt)],
                },
                updated: UPDATED,
            },
            {
                uuid: '00000000-0000-4000-8000-000000000020',
                identifier: 'poster',
                enabled: true,
                family: 'accessories',
                parent: null,
                categories: ['posters'],
                values: {
                    sku: [text('poster')],
                    name: [text('Poster', 'en_US')],
                    image: [image(FILES.poster)],
                },
                updated: UPDATED,
            },
        ],
        assetFamilies: [
            { code: 'packshots', labels: { en_US: 'Packshots' }, attribute_as_main_media: 'media' },
        ],
        assetFamilyAttributes: {
            packshots: [
                { code: 'label', type: 'text' },
                { code: 'media', type: 'media_file', media_type: 'image' },
            ],
        },
        assets: {
            packshots: [
                {
                    code: 'shirt_front',
                    values: {
                        label: [{ locale: 'en_US', channel: null, data: 'Shirt front' }],
                        media: [{ locale: null, channel: null, data: FILES.front }],
                    },
                },
            ],
        },
        files: Object.fromEntries(
            Object.values(FILES).map(code => [code, { contentType: 'image/png', bytes: PNG }]),
        ),
    };
}

function attribute(
    code: string,
    type: string,
    group: string,
    sortOrder: number,
    extra: Partial<FakeAttribute> = {},
): FakeAttribute {
    return {
        code,
        type,
        group,
        sort_order: sortOrder,
        localizable: false,
        scopable: false,
        labels: { en_US: code.charAt(0).toUpperCase() + code.slice(1).replace('_', ' ') },
        ...extra,
    };
}

function variant(uuid: string, sku: string, parent: string, size: string, usd: string): FakeProduct {
    return {
        uuid,
        identifier: sku,
        enabled: true,
        family: 'clothing',
        parent,
        categories: [],
        values: {
            sku: [text(sku)],
            size: [text(size)],
            price: [{ locale: null, scope: null, data: [{ amount: usd, currency: 'USD' }] }],
        },
        updated: UPDATED,
    };
}
