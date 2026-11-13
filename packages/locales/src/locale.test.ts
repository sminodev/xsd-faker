import { describe, expect, it } from 'vitest';
import { defineLocale, extendLocale } from './locale.js';
import { de } from './locales/de/index.js';
import { en } from './locales/en/index.js';
import type { LocaleData } from './types.js';

describe('built-in locales', () => {
  it('are complete and frozen', () => {
    for (const locale of [de, en]) {
      expect(Object.isFrozen(locale)).toBe(true);
      expect(Object.isFrozen(locale.person.lastName)).toBe(true);
      expect(defineLocale(locale.tag, { extends: locale })).toEqual(locale);
    }
    expect(de.tag).toBe('de');
    expect(en.address.country?.code).toBe('US');
  });
});

describe('defineLocale', () => {
  it('falls back to the locale it extends: objects field by field, arrays as a whole', () => {
    const deCH = defineLocale('de-CH', {
      extends: de,
      address: {
        places: [{ city: 'Zürich', postcodes: ['8001'], state: 'ZH' }],
        states: [{ code: 'ZH', name: 'Zürich' }],
        country: { code: 'CH', name: 'Schweiz' },
      },
      person: { lastName: ['Meier'] },
    });
    expect(deCH.tag).toBe('de-CH');
    expect(deCH.address.places).toEqual([{ city: 'Zürich', postcodes: ['8001'], state: 'ZH' }]);
    expect(deCH.person.lastName).toEqual(['Meier']);
    expect(deCH.person.firstName).toEqual(de.person.firstName);
    expect(deCH.address.street).toEqual(de.address.street);
  });

  it('leaves the given objects unfrozen', () => {
    const lastName = ['Meier'];
    defineLocale('de-CH', { extends: de, person: { lastName } });
    expect(Object.isFrozen(lastName)).toBe(false);
  });

  it('names the path of a missing or malformed field', () => {
    const withoutExtends = { person: de.person, address: de.address, contact: de.contact };
    expect(() => defineLocale('xx', withoutExtends)).toThrow(new TypeError('locale xx: text is missing'));
    expect(() => defineLocale('xx', { extends: de, person: { lastName: [] } })).toThrow(
      'locale xx: person.lastName must not be empty',
    );
    expect(() => defineLocale('xx', { extends: de, person: { lastName: ['Meier', ' Huber'] } })).toThrow(
      'locale xx: person.lastName[1] must be a non-empty string',
    );
    const place = { city: 'Zürich', postcodes: [], state: 'DE-BY' };
    expect(() => defineLocale('xx', { extends: de, address: { places: [place] } })).toThrow(
      'locale xx: address.places[0].postcodes must not be empty',
    );
    const noStates = { places: [{ city: 'Zürich', postcodes: ['8001'], state: 'ZH' }], states: [] };
    expect(() => defineLocale('xx', { extends: de, address: noStates })).toThrow(
      'locale xx: address.places[0].state ZH is not in address.states',
    );
    const elsewhere = { city: 'Zürich', postcodes: ['8001'], state: 'ZH' };
    expect(() => defineLocale('xx', { extends: de, address: { places: [elsewhere] } })).toThrow(
      'locale xx: address.places[0].state ZH is not in address.states',
    );
    expect(() => defineLocale('xx', { extends: de, text: { words: ['zwei Wörter'] } })).toThrow(
      'locale xx: text.words[0] must be a word without spaces',
    );
    expect(() => defineLocale('xx', { extends: de, text: { phrases: ['Hof  links'] } })).toThrow(
      'locale xx: text.phrases[0] must be text with single spaces between words',
    );
    const street = { patterns: ['{stem}{ending}'] };
    expect(() => defineLocale('xx', { extends: de, address: { street } })).toThrow(
      'locale xx: address.street.patterns[0] refers to {ending}, which is not a street list',
    );
    const unknown = { extends: de, person: { lastNames: ['Meier'] } } as unknown as Parameters<typeof defineLocale>[1];
    expect(() => defineLocale('xx', unknown)).toThrow('locale xx: person.lastNames is not a locale field');
  });

  it('accepts BCP 47 tags, private use included, and nothing else', () => {
    expect(defineLocale('de-x-office', { extends: de }).tag).toBe('de-x-office');
    expect(() => defineLocale('de_DE', { extends: de })).toThrow('de_DE is not a language tag');
  });
});

describe('extendLocale', () => {
  it('replaces arrays by default and appends them on request', () => {
    const replaced = extendLocale(de, { person: { title: ['Mag.'] } });
    expect(replaced.person.title).toEqual(['Mag.']);
    expect(replaced.tag).toBe('de');
    const appended = extendLocale(de, { person: { title: ['Mag.'] } }, { arrays: 'append', tag: 'de-AT' });
    expect(appended.person.title).toEqual([...de.person.title, 'Mag.']);
    expect(appended.tag).toBe('de-AT');
    expect(de.person.title).not.toContain('Mag.');
  });

  it('checks the result like defineLocale', () => {
    const broken = { address: { buildingNumber: [] } } as unknown as Partial<LocaleData>;
    expect(() => extendLocale(en, broken)).toThrow('locale en: address.buildingNumber must not be empty');
  });
});

describe('the data of the built-in locales', () => {
  const lists = (locale: typeof de): [string, readonly string[]][] => [
    ['firstName.female', locale.person.firstName.female],
    ['firstName.male', locale.person.firstName.male],
    ['firstName.neutral', locale.person.firstName.neutral],
    ['lastName', locale.person.lastName],
    ['street.stems', locale.address.street.stems],
    ['street.names', locale.address.street.names],
    ['words', locale.text.words],
    ['phrases', locale.text.phrases],
    ['sentences', locale.text.sentences],
  ];

  it('has no entry twice in a list', () => {
    for (const locale of [de, en]) {
      for (const [name, list] of lists(locale)) expect(new Set(list).size, `${locale.tag} ${name}`).toBe(list.length);
    }
  });

  it('spreads names, street stems and words over the alphabet', () => {
    for (const locale of [de, en]) {
      for (const [name, list] of lists(locale).filter(([, l]) => l.length >= 100)) {
        const initials = new Map<string, number>();
        for (const entry of list)
          initials.set(entry.charAt(0).toUpperCase(), (initials.get(entry.charAt(0).toUpperCase()) ?? 0) + 1);
        expect(initials.size, `${locale.tag} ${name}`).toBeGreaterThanOrEqual(18);
        expect(Math.max(...initials.values()) / list.length, `${locale.tag} ${name}`).toBeLessThan(0.16);
      }
    }
  });

  it('uses only numbers reserved for fiction and domains reserved for examples', () => {
    const reserved = [
      /^(0|\+49 )30 23125#{3}$/,
      /^(0|\+49 )40 66969#{3}$/,
      /^(0|\+49 )69 90009#{3}$/,
      /^(0|\+49 )89 99998#{3}$/,
      /^(0|\+49 )221 4710#{3}$/,
      /^(0|\+49 )171 39200##$/,
      /^(0|\+49 )176 040690##$/,
      /^(\+1-\d{3}-|\(\d{3}\) )555-01##$/,
    ];
    for (const locale of [de, en]) {
      for (const phone of [...locale.contact.phone, ...locale.contact.mobile]) {
        expect(
          reserved.some((r) => r.test(phone)),
          phone,
        ).toBe(true);
      }
      for (const domain of locale.contact.emailDomain)
        expect(domain).toMatch(/^(example\.(com|org|net)|[a-z]+\.example)$/);
    }
  });

  it('has short words, so that free text reaches every length from 2', () => {
    for (const locale of [de, en]) {
      expect(locale.text.words.some((w) => [...w].length === 2)).toBe(true);
      expect(locale.text.words.some((w) => [...w].length === 3)).toBe(true);
    }
  });
});
