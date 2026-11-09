import { describe, expect, it } from 'vitest';

import { AkeneoApiClient } from './akeneo-api-client';
import { AkeneoLookups, pickText, pickValue } from './akeneo-lookups';
import {
    AkeneoAttribute,
    AkeneoAttributeGroup,
    AkeneoFamily,
    AkeneoPage,
    AkeneoValues,
} from './akeneo-types';

const values: AkeneoValues = {
    name: [
        { locale: 'en_US', scope: null, data: 'Shirt' },
        { locale: 'fr_FR', scope: null, data: 'Chemise' },
    ],
    description: [
        { locale: null, scope: 'ecommerce', data: 'For the web shop' },
        { locale: null, scope: 'print', data: 'For the catalog' },
    ],
    title: [{ locale: null, scope: null, data: '  ' }],
};

describe('pickValue', () => {
    it('picks the value of the locale', () => {
        expect(pickValue(values, 'name', 'fr_FR', 'ecommerce')?.data).toBe('Chemise');
    });

    it('picks the value of the channel, and non-localizable values for any locale', () => {
        expect(pickValue(values, 'description', 'en_US', 'print')?.data).toBe('For the catalog');
    });

    it('returns nothing for a locale or channel without a value', () => {
        expect(pickValue(values, 'name', 'de_DE', 'ecommerce')).toBeUndefined();
        expect(pickValue(values, 'description', null, 'mobile')).toBeUndefined();
        expect(pickValue(values, 'missing', null, 'ecommerce')).toBeUndefined();
    });
});

describe('pickText', () => {
    it('trims text and treats blank text as missing', () => {
        expect(pickText({ name: [{ locale: null, scope: null, data: ' Shirt ' }] }, 'name', null, 'x')).toBe(
            'Shirt',
        );
        expect(pickText(values, 'title', null, 'ecommerce')).toBeUndefined();
    });
});

describe('AkeneoLookups.familyImageAttributes', () => {
    const attribute = (code: string, group: string, sortOrder: number): AkeneoAttribute => ({
        code,
        type: 'pim_catalog_image',
        group,
        sort_order: sortOrder,
        localizable: false,
        scopable: false,
        labels: {},
    });
    const page = <T>(items: T[]): AkeneoPage<T> => ({ items, next: null });
    const attributes = [
        attribute('zoom', 'media', 2),
        attribute('main', 'media', 1),
        attribute('packshot', 'general', 9),
        attribute('other_family', 'general', 0),
    ];
    const groups: AkeneoAttributeGroup[] = [
        { code: 'media', sort_order: 2, labels: {} },
        { code: 'general', sort_order: 1, labels: {} },
    ];
    const family = (attributeAsImage: string | null): AkeneoFamily => ({
        code: 'shirts',
        labels: {},
        attribute_as_label: 'name',
        attribute_as_image: attributeAsImage,
        attributes: ['name', 'main', 'zoom', 'packshot'],
    });
    const client = (imageAttribute: string | null) =>
        ({
            attributes: () => Promise.resolve(page(attributes)),
            attributeGroups: () => Promise.resolve(page(groups)),
            family: () => Promise.resolve(family(imageAttribute)),
            async *pages<T>(first: AkeneoPage<T>) {
                yield await Promise.resolve(first);
            },
        }) as unknown as AkeneoApiClient;

    it("puts the family's image attribute first, then the others by group and attribute order", async () => {
        const lookups = new AkeneoLookups(client('zoom'));
        expect(await lookups.familyImageAttributes('shirts')).toEqual(['zoom', 'packshot', 'main']);
    });

    it('orders by group and attribute order when the family has no image attribute', async () => {
        const lookups = new AkeneoLookups(client(null));
        expect(await lookups.familyImageAttributes('shirts')).toEqual(['packshot', 'main', 'zoom']);
    });
});
