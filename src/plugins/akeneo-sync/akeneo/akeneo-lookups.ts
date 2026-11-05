import { AkeneoApiClient, AkeneoApiError } from './akeneo-api-client';
import {
    AkeneoAttribute,
    AkeneoAttributeOption,
    AkeneoCategory,
    AkeneoFamily,
    AkeneoFamilyVariant,
    AkeneoProductModel,
    AkeneoValue,
    AkeneoValues,
} from './akeneo-types';

/**
 * Memoized reads of the Akeneo records a page of products refers to (models, families,
 * attributes, options). Create one per job so data is fresh for every page.
 */
export class AkeneoLookups {
    private readonly cache = new Map<string, Promise<unknown>>();

    constructor(private readonly client: AkeneoApiClient) {}

    model(code: string): Promise<AkeneoProductModel> {
        return this.once(`model:${code}`, () => this.client.productModel(code));
    }

    /** Follows `parent` up to the root model, which is what becomes the Vendure Product. */
    async rootModel(code: string): Promise<AkeneoProductModel> {
        let model = await this.model(code);
        for (let depth = 0; model.parent; depth++) {
            if (depth > 5) throw new AkeneoApiError(`Product model "${code}" has too many levels`, null);
            model = await this.model(model.parent);
        }
        return model;
    }

    /** Undefined if the category no longer exists. */
    category(code: string): Promise<AkeneoCategory | undefined> {
        return this.once(`category:${code}`, () => this.client.category(code).catch(notFoundAsUndefined));
    }

    family(code: string): Promise<AkeneoFamily> {
        return this.once(`family:${code}`, () => this.client.family(code));
    }

    familyVariant(familyCode: string, code: string): Promise<AkeneoFamilyVariant> {
        return this.once(`fv:${familyCode}:${code}`, () => this.client.familyVariant(familyCode, code));
    }

    attribute(code: string): Promise<AkeneoAttribute> {
        return this.once(`attr:${code}`, () => this.client.attribute(code));
    }

    /** Undefined if the option no longer exists. */
    option(attributeCode: string, code: string): Promise<AkeneoAttributeOption | undefined> {
        return this.once(`option:${attributeCode}:${code}`, () =>
            this.client.attributeOption(attributeCode, code).catch(notFoundAsUndefined),
        );
    }

    private once<T>(key: string, load: () => Promise<T>): Promise<T> {
        if (!this.cache.has(key)) this.cache.set(key, load());
        return this.cache.get(key) as Promise<T>;
    }
}

function notFoundAsUndefined(e: unknown): undefined {
    if (e instanceof AkeneoApiError && e.httpStatus === 404) return undefined;
    throw e;
}

/**
 * The value of an attribute for a locale and Akeneo channel. Non-localizable and non-scopable
 * values (locale/scope null) match any locale/channel.
 */
export function pickValue(
    values: AkeneoValues | undefined,
    attribute: string,
    locale: string | null,
    scope: string,
): AkeneoValue | undefined {
    const candidates = (values?.[attribute] ?? []).filter(v => v.scope === null || v.scope === scope);
    return candidates.find(v => v.locale === locale) ?? candidates.find(v => v.locale === null);
}

export function pickText(
    values: AkeneoValues | undefined,
    attribute: string,
    locale: string | null,
    scope: string,
): string | undefined {
    const data = pickValue(values, attribute, locale, scope)?.data;
    return typeof data === 'string' && data.trim() ? data.trim() : undefined;
}

/** The main identifier attribute (Akeneo supports several identifier attributes). */
export async function findMainIdentifierAttribute(client: AkeneoApiClient): Promise<string | null> {
    const identifiers: AkeneoAttribute[] = [];
    for await (const page of client.pages(await client.attributes())) {
        identifiers.push(...page.items.filter(a => a.type === 'pim_catalog_identifier'));
    }
    return (identifiers.find(a => a.is_main_identifier) ?? identifiers[0])?.code ?? null;
}
