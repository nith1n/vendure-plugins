import { LanguageCode } from '@vendure/core';

import { AkeneoLabels } from '../akeneo/akeneo-types';
import { AkeneoLocaleMapping } from '../entities/akeneo-connection-settings.entity';

const language = (code: string) => code.split('_')[0];

/**
 * Suggests an Akeneo locale for each Vendure language: the exact code if Akeneo has it
 * (`en_GB` -> `en_GB`), otherwise the first locale of the same language (`en` -> `en_GB`).
 * Languages without a match are left out.
 */
export function suggestLocaleMapping(
    languageCodes: LanguageCode[],
    akeneoLocales: string[],
): AkeneoLocaleMapping[] {
    return languageCodes.flatMap(languageCode => {
        const locale =
            akeneoLocales.find(l => l === String(languageCode)) ??
            akeneoLocales.find(l => language(l) === language(languageCode));
        return locale ? [{ languageCode, locale }] : [];
    });
}

/** Best label for display in the given language, falling back to any label, then the code. */
export function displayLabel(labels: AkeneoLabels, languageCode: string, fallback: string): string {
    const entries = Object.entries(labels).filter((e): e is [string, string] => !!e[1]?.trim());
    const label =
        entries.find(([l]) => l === languageCode)?.[1] ??
        entries.find(([l]) => language(l) === language(languageCode))?.[1] ??
        entries[0]?.[1];
    return label?.trim() || fallback;
}
