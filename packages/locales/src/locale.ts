// Defining and extending locales. A locale given in parts falls back to the locale it extends: objects are merged
// field by field, arrays are replaced as a whole, so one list never mixes two languages unless asked to. Every locale
// is checked when it is defined, so that a mistake shows up with its path and not during generation.

import type { DeepPartial, LocaleData, LocaleInput } from './types.js';

type Spec =
  'list' | 'list?' | 'words' | 'texts' | 'places' | 'regions' | 'region' | 'region?' | { [key: string]: Spec };

const GENDERED: Spec = { female: 'list', male: 'list', neutral: 'list?' };

/** What each field holds; `?` marks a list that may be empty. */
const SPEC: { [key: string]: Spec } = {
  person: {
    firstName: GENDERED,
    lastName: 'list',
    title: 'list?',
    nobilityPrefix: 'list?',
    nameSuffix: { female: 'list?', male: 'list?', neutral: 'list?' },
    salutation: GENDERED,
  },
  address: {
    street: { patterns: 'list', stems: 'list?', suffixes: 'list?', names: 'list?' },
    streetLine: 'list',
    buildingNumber: 'list',
    supplement: 'list?',
    places: 'places',
    states: 'regions',
    country: 'region?',
  },
  contact: { phone: 'list', mobile: 'list?', emailDomain: 'list' },
  text: { words: 'words', phrases: 'texts', sentences: 'texts' },
};

const TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;
/** Characters XML allows, without white space at either end. */
export const ENTRY = /^[^\s\p{Cc}\p{Cs}\uFFFE\uFFFF](?:[^\p{Cc}\p{Cs}\uFFFE\uFFFF]*[^\s\p{Cc}\p{Cs}\uFFFE\uFFFF])?$/u;
const WORD = /^[^\s\p{Cc}\p{Cs}\uFFFE\uFFFF]+$/u;
const TEXT = /^[^\s\p{Cc}\p{Cs}\uFFFE\uFFFF]+(?: [^\s\p{Cc}\p{Cs}\uFFFE\uFFFF]+)*$/u;
const STREET_PART = /\{(\w*)\}/g;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Defines a locale: complete data, or parts of a locale on top of the one it `extends`. Throws a `TypeError` naming
 * the path of the first field that is missing or malformed. The result is frozen.
 */
export function defineLocale(tag: string, input: LocaleInput): LocaleData {
  if (typeof tag !== 'string' || !TAG.test(tag)) throw new TypeError(`${String(tag)} is not a language tag`);
  if (!isObject(input)) throw new TypeError(`locale ${tag}: the data must be an object`);
  const { extends: base, ...own } = input;
  if (base !== undefined && !isObject(base)) throw new TypeError(`locale ${tag}: extends must be a locale`);
  const data = base === undefined ? own : merge(strip(base), own, false);
  return freeze(copy({ tag, ...check(tag, data) }));
}

/**
 * A locale with some of its data replaced: objects are merged, arrays replaced, or with `arrays: 'append'` added to
 * the end of the existing ones. The result keeps the tag of `base` unless `tag` names another one.
 */
export function extendLocale(
  base: LocaleData,
  patch: DeepPartial<Omit<LocaleData, 'tag'>>,
  options: { arrays?: 'replace' | 'append'; tag?: string } = {},
): LocaleData {
  if (!isObject(base)) throw new TypeError('extendLocale needs a locale to extend');
  if (!isObject(patch)) throw new TypeError(`locale ${base.tag}: the patch must be an object`);
  if (options.arrays !== undefined && options.arrays !== 'replace' && options.arrays !== 'append') {
    throw new TypeError('arrays must be replace or append');
  }
  const tag = options.tag ?? base.tag;
  if (typeof tag !== 'string' || !TAG.test(tag)) throw new TypeError(`${String(tag)} is not a language tag`);
  return freeze(copy({ tag, ...check(tag, merge(strip(base), patch, options.arrays === 'append')) }));
}

function strip(locale: LocaleData): Record<string, unknown> {
  const data: Record<string, unknown> = { ...locale };
  delete data.tag;
  return data;
}

function merge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  append: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    if (Array.isArray(value)) {
      out[key] = append && Array.isArray(current) ? [...(current as unknown[]), ...(value as unknown[])] : value;
    } else if (isObject(value) && isObject(current)) {
      out[key] = merge(current, value, append);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function check(tag: string, data: Record<string, unknown>): Omit<LocaleData, 'tag'> {
  const fail = (path: string, problem: string): never => {
    throw new TypeError(`locale ${tag}: ${path} ${problem}`);
  };
  const strings = (path: string, value: unknown, entry: RegExp, empty: boolean, what: string): void => {
    if (!Array.isArray(value)) fail(path, 'must be an array');
    const list = value as unknown[];
    if (!empty && list.length === 0) fail(path, 'must not be empty');
    list.forEach((item, index) => {
      if (typeof item !== 'string' || !entry.test(item)) fail(`${path}[${index}]`, `must be ${what}`);
    });
  };
  const region = (path: string, value: unknown): void => {
    if (!isObject(value)) return fail(path, 'must be an object with code and name');
    for (const key of Object.keys(value)) {
      if (key !== 'code' && key !== 'name') fail(`${path}.${key}`, 'is not a locale field');
    }
    for (const key of ['code', 'name']) {
      if (typeof value[key] !== 'string' || !ENTRY.test(value[key]))
        fail(`${path}.${key}`, 'must be a non-empty string');
    }
  };
  const visit = (path: string, value: unknown, spec: Spec): void => {
    if (spec === 'list' || spec === 'list?') return strings(path, value, ENTRY, spec === 'list?', 'a non-empty string');
    if (spec === 'words') return strings(path, value, WORD, false, 'a word without spaces');
    if (spec === 'texts') return strings(path, value, TEXT, false, 'text with single spaces between words');
    if (spec === 'region' || spec === 'region?') return region(path, value);
    if (spec === 'regions') {
      if (!Array.isArray(value)) return fail(path, 'must be an array');
      return (value as unknown[]).forEach((item, index) => region(`${path}[${index}]`, item));
    }
    if (spec === 'places') {
      if (!Array.isArray(value)) return fail(path, 'must be an array');
      const list = value as unknown[];
      if (list.length === 0) fail(path, 'must not be empty');
      return list.forEach((place, index) => {
        const at = `${path}[${index}]`;
        if (!isObject(place)) return fail(at, 'must be an object with city, postcodes and state');
        for (const key of Object.keys(place)) {
          if (!['city', 'postcodes', 'state'].includes(key)) fail(`${at}.${key}`, 'is not a locale field');
        }
        if (typeof place.city !== 'string' || !ENTRY.test(place.city)) fail(`${at}.city`, 'must be a non-empty string');
        strings(`${at}.postcodes`, place.postcodes, ENTRY, false, 'a non-empty string');
        if (place.state !== undefined && (typeof place.state !== 'string' || !ENTRY.test(place.state))) {
          fail(`${at}.state`, 'must be a non-empty string');
        }
      });
    }
    if (!isObject(value)) return fail(path, 'must be an object');
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(spec, key)) fail(path ? `${path}.${key}` : key, 'is not a locale field');
    }
    for (const [key, inner] of Object.entries(spec)) {
      const at = path ? `${path}.${key}` : key;
      if (value[key] === undefined) {
        if (inner === 'region?') continue;
        fail(at, 'is missing');
      }
      visit(at, value[key], inner);
    }
  };
  visit('', data, SPEC);

  const locale = data as unknown as Omit<LocaleData, 'tag'>;
  const { street, states, places } = locale.address;
  locale.address.streetLine.forEach((pattern, index) => {
    for (const [, part] of pattern.matchAll(STREET_PART)) {
      if (part !== 'street' && part !== 'number') {
        fail(`address.streetLine[${index}]`, `refers to {${part}}; only {street} and {number} are known`);
      }
    }
  });
  street.patterns.forEach((pattern, index) => {
    for (const [, part] of pattern.matchAll(STREET_PART)) {
      const list =
        part === 'stem'
          ? street.stems
          : part === 'suffix'
            ? street.suffixes
            : part === 'name'
              ? street.names
              : undefined;
      if (list === undefined)
        fail(`address.street.patterns[${index}]`, `refers to {${part}}, which is not a street list`);
      else if (list.length === 0) fail(`address.street.patterns[${index}]`, `uses {${part}}, but that list is empty`);
    }
  });
  const codes = new Set(states.map((s) => s.code));
  places.forEach((place, index) => {
    if (place.state !== undefined && !codes.has(place.state)) {
      fail(`address.places[${index}].state`, `${place.state} is not in address.states`);
    }
  });
  return locale;
}

/** A copy of plain data, so that freezing it leaves the caller's objects alone. */
function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T;
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)])) as T;
  return value;
}

function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) freeze(inner);
  }
  return value;
}
