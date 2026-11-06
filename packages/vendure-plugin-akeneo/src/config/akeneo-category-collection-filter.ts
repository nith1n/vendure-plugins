import { CollectionFilter, combineWithAndArg, LanguageCode, randomSuffix } from '@vendure/core';

import { AkeneoVariantCategory } from '../entities/akeneo-variant-category.entity';

export const AKENEO_CATEGORY_FILTER_CODE = 'akeneo-category';

/**
 * Matches variants classified in an Akeneo category or one of its descendants. The category sync
 * sets it on the Collections it creates; it can also be added to any Collection by hand.
 */
export const akeneoCategoryCollectionFilter = new CollectionFilter({
    code: AKENEO_CATEGORY_FILTER_CODE,
    description: [{ languageCode: LanguageCode.en, value: 'Filter by Akeneo category' }],
    args: {
        categoryCode: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Akeneo category code' }],
        },
        combineWithAnd: combineWithAndArg,
    },
    apply: (qb, args) => {
        const alias = randomSuffix('akeneo_category');
        const param = randomSuffix('akeneoCategory');
        // Correlated EXISTS rather than a join, so it cannot multiply the variant rows
        const inCategory = qb
            .subQuery()
            .select('1')
            .from(AkeneoVariantCategory, alias)
            .where(`${alias}.variantId = productVariant.id`)
            .andWhere(`${alias}.categoryCode = :${param}`)
            .getQuery();
        const params = { [param]: args.categoryCode };
        return args.combineWithAnd === false
            ? qb.orWhere(`EXISTS ${inCategory}`, params)
            : qb.andWhere(`EXISTS ${inCategory}`, params);
    },
});
