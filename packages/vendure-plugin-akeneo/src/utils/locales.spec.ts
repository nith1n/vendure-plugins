import { LanguageCode } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { displayLabel, suggestLocaleMapping } from './locales';

describe('suggestLocaleMapping', () => {
    it('prefers an exact locale, then the first locale of the same language', () => {
        expect(
            suggestLocaleMapping(
                [LanguageCode.en, LanguageCode.en_GB, LanguageCode.ar, LanguageCode.de],
                ['en_US', 'en_GB', 'ar_KW', 'ar_AE'],
            ),
        ).toEqual([
            { languageCode: 'en', locale: 'en_US' },
            { languageCode: 'en_GB', locale: 'en_GB' },
            { languageCode: 'ar', locale: 'ar_KW' },
        ]);
    });
});

describe('displayLabel', () => {
    it('uses the exact language, then the same language, then any label, then the fallback', () => {
        expect(displayLabel({ en_US: 'Shirts', fr_FR: 'Chemises' }, 'fr', 'shirts')).toBe('Chemises');
        expect(displayLabel({ en_US: 'Shirts', en: 'Shirts (en)' }, 'en', 'shirts')).toBe('Shirts (en)');
        expect(displayLabel({ fr_FR: 'Chemises' }, 'en', 'shirts')).toBe('Chemises');
        expect(displayLabel({ en_US: '  ' }, 'en', 'shirts')).toBe('shirts');
    });
});
