import { describe, expect, it } from 'vitest';
import { localeFromFaker, type FakerLocaleDefinition } from './faker.js';
import { de } from './locales/de/index.js';
import { en } from './locales/en/index.js';

/** A small definition in the form of a faker-js locale, written here. */
const definition: FakerLocaleDefinition = {
  metadata: { code: 'de_AT', country: 'AT' },
  person: {
    first_name: { female: ['Anna', 'Lena '], male: ['Lukas', 'Lukas', ''], generic: ['Kim'] },
    last_name: { generic: ['Gruber', 'Huber'] },
    prefix: { female: ['Frau', 'Dr.'], male: ['Herr', 'Dr.', 'Prof. Dr.'] },
  },
  location: {
    street_name: ['Hauptplatz', 'Ringstraße'],
    city_name: ['Graz', 'Linz'],
    building_number: ['#', '##', '!#'],
    state: ['Steiermark', 'Oberösterreich'],
    state_abbr: ['ST', 'OÖ'],
    postcode: '####',
    default_country: ['Österreich'],
  },
};

describe('localeFromFaker', () => {
  it('takes names, streets, cities, numbers, states and the country, and the rest from the base locale', () => {
    const locale = localeFromFaker(definition);
    expect(locale.tag).toBe('de-AT');
    expect(locale.person.firstName).toEqual({ female: ['Anna', 'Lena'], male: ['Lukas'], neutral: ['Kim'] });
    expect(locale.person.lastName).toEqual(['Gruber', 'Huber']);
    expect(locale.person.title).toEqual(['Dr.', 'Prof. Dr.']);
    expect(locale.person.salutation).toEqual({ female: ['Frau'], male: ['Herr'], neutral: [] });
    expect(locale.address.street.names).toEqual(['Hauptplatz', 'Ringstraße']);
    expect(locale.address.buildingNumber).toEqual(['#', '##', '##']);
    expect(locale.address.places).toEqual([
      { city: 'Graz', postcodes: ['####'] },
      { city: 'Linz', postcodes: ['####'] },
    ]);
    expect(locale.address.states).toEqual([
      { code: 'ST', name: 'Steiermark' },
      { code: 'OÖ', name: 'Oberösterreich' },
    ]);
    expect(locale.address.country).toEqual({ code: 'AT', name: 'Österreich' });
    expect(locale.text).toEqual(de.text);
    expect(locale.person.nameSuffix).toEqual(de.person.nameSuffix);
  });

  it('accepts plain lists, a tag and a base of its own, and an almost empty definition', () => {
    const locale = localeFromFaker(
      { person: { first_name: ['Ada', 'Alan'], last_name: ['Lovelace'] } },
      { tag: 'en-x-test', base: en },
    );
    expect(locale.person.firstName).toEqual({ female: ['Ada', 'Alan'], male: ['Ada', 'Alan'], neutral: [] });
    expect(locale.address).toEqual(en.address);
    expect(localeFromFaker({}).tag).toBe('und');
    expect(() => localeFromFaker(null as unknown as FakerLocaleDefinition)).toThrow(TypeError);
  });

  it('takes the country of the metadata, letters in postcode patterns, and leaves out entries it cannot hold', () => {
    const swiss = localeFromFaker({
      metadata: { code: 'de_CH', country: 'CH' },
      person: { last_name: ['Meier', 'Bad\u0007Name', '  '] },
      location: { city_name: ['Bern', 'Zug\u0000'], postcode: '####' },
    });
    expect(swiss.address.country).toEqual({ code: 'CH', name: 'CH' });
    expect(swiss.person.lastName).toEqual(['Meier']);
    expect(swiss.address.places.map((p) => p.city)).toEqual(['Bern']);
    const british = localeFromFaker({
      metadata: { code: 'en_GB', country: 'GB' },
      location: { city_name: ['Bath'], postcode: ['??# #??'], default_country: ['United Kingdom'] },
    });
    expect(british.address.country).toEqual({ code: 'GB', name: 'United Kingdom' });
    expect(british.address.places[0]?.postcodes).toEqual(['??# #??']);
  });

  it('takes city, postcode, state and country together from the base locale where faker-js has no cities', () => {
    const japanese = localeFromFaker(
      {
        metadata: { code: 'ja', country: 'JP' },
        person: { last_name: ['Sato'] },
        location: {
          state: ['Hokkaido', 'Aomori'],
          postcode: '###-####',
          default_country: ['Japan'],
          street_name: ['Sakura Dori'],
        },
      },
      { base: en },
    );
    expect(japanese.address.places).toEqual(en.address.places);
    expect(japanese.address.states).toEqual(en.address.states);
    expect(japanese.address.country).toEqual(en.address.country);
    expect(japanese.address.street.names).toEqual(['Sakura Dori']);
    expect(japanese.person.lastName).toEqual(['Sato']);
  });

  it('leaves the country of faker-js cities open unless the metadata or the country option names it', () => {
    const french = { metadata: { code: 'fr' }, location: { city_name: ['Lyon'], postcode: '#####' } };
    expect(localeFromFaker(french).address.country).toBeUndefined();
    expect(localeFromFaker(french, { country: 'FR' }).address.country).toEqual({ code: 'FR', name: 'FR' });
    expect(localeFromFaker(french, { country: { code: 'FR', name: 'France' } }).address.country).toEqual({
      code: 'FR',
      name: 'France',
    });
  });
});
