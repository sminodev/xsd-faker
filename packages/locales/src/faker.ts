// A locale from the locale data of faker-js, which the caller installs and imports. The object is read for its shape
// alone: nothing here imports faker-js or depends on its types. Taken over are first names by gender, last names,
// titles, street names, building number patterns, and where faker-js has cities, the cities with its states and
// country; faker-js has no postcodes per city, so a city gets the locale's postcode pattern. Without cities, the
// places come whole from the base locale. Everything else comes from the base locale too.

import { defineLocale, ENTRY } from './locale.js';
import { de } from './locales/de/index.js';
import { en } from './locales/en/index.js';
import type { DeepPartial, LocaleData, Place, Region } from './types.js';

/** A list in faker-js: plain, or by gender. */
export type FakerList =
  | readonly string[]
  | { readonly generic?: readonly string[]; readonly female?: readonly string[]; readonly male?: readonly string[] };

/** The parts of a faker-js locale definition that are read; every part may be missing. */
export interface FakerLocaleDefinition {
  readonly metadata?: { readonly code?: string; readonly country?: string };
  readonly person?: { readonly first_name?: FakerList; readonly last_name?: FakerList; readonly prefix?: FakerList };
  readonly location?: {
    readonly street_name?: readonly string[];
    readonly city_name?: readonly string[];
    readonly building_number?: readonly string[];
    readonly state?: readonly string[];
    readonly state_abbr?: readonly string[];
    readonly postcode?: string | readonly string[];
    readonly default_country?: readonly string[];
  };
}

export interface FakerOptions {
  /** The tag of the new locale; by default the code of the faker-js locale, such as `de-AT` for `de_AT`. */
  tag?: string;
  /** The locale for everything faker-js does not have; `de` for a German locale, `en` otherwise. */
  base?: LocaleData;
  /**
   * The country of the faker-js cities, as a code such as `FR` or as code and name, where the faker-js locale does not
   * name one in its metadata.
   */
  country?: string | Region;
}

/** The usable entries of a list: strings, trimmed, without repeats and without any a locale cannot hold. */
function clean(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const item of list as unknown[]) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().replace(/\s+/g, ' ');
    if (ENTRY.test(trimmed)) out.add(trimmed);
  }
  return [...out];
}

function byGender(list: FakerList | undefined): { generic: string[]; female: string[]; male: string[] } {
  if (Array.isArray(list)) return { generic: clean(list), female: [], male: [] };
  const gendered = (list ?? {}) as { generic?: unknown; female?: unknown; male?: unknown };
  return { generic: clean(gendered.generic), female: clean(gendered.female), male: clean(gendered.male) };
}

const TITLE = /\b(Dr|Prof)\b/;

function withoutCountry(locale: LocaleData): LocaleData {
  const address = { ...locale.address };
  delete address.country;
  return { ...locale, address };
}

/** A locale made from a faker-js locale definition, falling back to `base` for what it does not have. */
export function localeFromFaker(definition: FakerLocaleDefinition, options: FakerOptions = {}): LocaleData {
  if (typeof definition !== 'object' || definition === null)
    throw new TypeError('the faker-js locale must be an object');
  const code = typeof definition.metadata?.code === 'string' ? definition.metadata.code.replace(/_/g, '-') : undefined;
  const tag = options.tag ?? code ?? 'und';
  const base = options.base ?? (tag.toLowerCase().startsWith('de') ? de : en);
  const person: DeepPartial<LocaleData['person']> = {};
  const address: DeepPartial<LocaleData['address']> = {};

  const first = byGender(definition.person?.first_name);
  const female = first.female.length > 0 ? first.female : first.generic;
  const male = first.male.length > 0 ? first.male : first.generic;
  if (female.length > 0 && male.length > 0) {
    person.firstName = { female, male, neutral: first.female.length > 0 || first.male.length > 0 ? first.generic : [] };
  }
  const last = byGender(definition.person?.last_name);
  const lastNames = [...new Set([...last.generic, ...last.female, ...last.male])];
  if (lastNames.length > 0) person.lastName = lastNames;
  const prefix = byGender(definition.person?.prefix);
  const titles = [...new Set([...prefix.generic, ...prefix.female, ...prefix.male].filter((p) => TITLE.test(p)))];
  if (titles.length > 0) person.title = titles;
  const salutation = {
    female: prefix.female.filter((p) => !TITLE.test(p)),
    male: prefix.male.filter((p) => !TITLE.test(p)),
  };
  if (salutation.female.length > 0 && salutation.male.length > 0) person.salutation = { ...salutation, neutral: [] };

  const location = definition.location ?? {};
  const streets = clean(location.street_name);
  if (streets.length > 0) address.street = { patterns: ['{name}'], stems: [], suffixes: [], names: streets };
  const numbers = clean(location.building_number).map((n) => n.replace(/!/g, '#'));
  if (numbers.length > 0) address.buildingNumber = numbers;
  const names = clean(location.state);
  const codes = clean(location.state_abbr);
  const states: Region[] = names.map((name, i) => ({
    code: codes.length === names.length ? (codes[i] ?? name) : name,
    name,
  }));
  const postcodes = clean(typeof location.postcode === 'string' ? [location.postcode] : location.postcode).map((p) =>
    p.replace(/!/g, '#'),
  );
  // City, postcode, state and country come from one source: all from faker-js where it has cities, with postcodes
  // from its pattern, and otherwise all from the base locale, so an address never mixes two countries.
  const cities = clean(location.city_name);
  let country: Region | undefined;
  if (cities.length > 0) {
    const patterns = postcodes.length > 0 ? postcodes : ['#####'];
    address.places = cities.map((city): Place => ({ city, postcodes: patterns }));
    address.states = states;
    // The country of the cities: the option, else the one of the metadata, named by the default country where
    // faker-js has one. Without either it stays open; the base locale's country would not fit these cities.
    const name = clean(location.default_country)[0];
    const option = options.country;
    const code = typeof option === 'string' ? option : (option?.code ?? clean([definition.metadata?.country])[0]);
    country = typeof option === 'object' ? option : code !== undefined ? { code, name: name ?? code } : undefined;
  }
  // Without its country, a locale of faker-js cities leaves country fields to the facets.
  const extended = country === undefined && address.places !== undefined ? withoutCountry(base) : base;
  if (country !== undefined) address.country = country;
  return defineLocale(tag, { extends: extended, person, address });
}
