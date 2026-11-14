// Supplies locale values for recognized fields, checking each candidate against the facets. Falls back to
// facet generation for unrecognized fields or when no locale candidate fits.

import { de, defineLocale, en, type LocaleData } from 'xsd-faker-locales';
import { checkValue } from '../check.js';
import { generateValue } from '../generate.js';
import { listKeys } from '../lists.js';
import { facetValues, firstOf, type ValueContext, type ValueSource } from '../source.js';
import { dateValue } from './dates.js';
import { FIELD_KEYS, fieldOf, type FieldKey } from './fields.js';
import { identifier } from './identifiers.js';
import { drawAddress, drawPerson, fill, forGender, formsFor, record, type PersonRecord } from './records.js';
import { freeText } from './text.js';

export { FIELD_KEYS, type FieldKey } from './fields.js';

/** The locales built in, by tag. */
export const LOCALES: Readonly<Record<string, LocaleData>> = Object.freeze({ de, en });

export interface LocaleOptions {
  /** Reference date, fixed by default for reproducible output. */
  referenceDate?: string;
  /**
   * Overrides field recognition using the same path and type-name keys as value lists.
   * `null` selects facet generation for that field.
   */
  fields?: Readonly<Record<string, FieldKey | null>>;
}

const DEFAULT_REFERENCE_DATE = '2026-01-15T12:00:00Z';
/** How often a locale draws again when a candidate does not meet the facets. */
const DRAWS = 8;

/**
 * Resolves a built-in tag with subtag fallback, such as de-CH to de. Locale objects are validated
 * with `defineLocale`, which identifies invalid fields by path.
 */
export function resolveLocale(locale: string | LocaleData): LocaleData {
  if (typeof locale === 'object' && locale !== null) {
    if (Object.isFrozen(locale) && Object.values(LOCALES).includes(locale)) return locale;
    const { tag, ...data } = locale as Partial<LocaleData>;
    if (typeof tag !== 'string') throw new TypeError('locale must be a language tag or a locale from defineLocale');
    defineLocale(tag, data);
    return locale;
  }
  if (typeof locale !== 'string') throw new TypeError('locale must be a language tag or a locale from defineLocale');
  for (let tag = locale.toLowerCase(); tag !== ''; tag = tag.slice(0, Math.max(0, tag.lastIndexOf('-')))) {
    if (Object.hasOwn(LOCALES, tag)) return LOCALES[tag] as LocaleData;
  }
  throw new TypeError(`unknown locale ${locale}; built in are ${Object.keys(LOCALES).join(' and ')}`);
}

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/;

/**
 * Parses a reference date or timestamp, such as `2026-01-15` or `2026-01-15T12:00:00Z`.
 * Throws a `TypeError` for invalid dates or unsupported formats.
 */
export function referenceInstant(referenceDate: string | undefined): Date {
  const text = referenceDate ?? DEFAULT_REFERENCE_DATE;
  const parts = typeof text === 'string' ? ISO.exec(text) : null;
  const [year, month, day] = [Number(parts?.[1]), Number(parts?.[2]), Number(parts?.[3])];
  const real =
    parts !== null && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Interpret timestamps without a time zone as UTC, matching date-only input on every machine.
  const local = parts?.[4] !== undefined && !/(?:Z|[+-]\d{2}:\d{2})$/.test(text);
  const instant = new Date(local ? `${text}Z` : text);
  if (!real || !Number.isFinite(instant.getTime())) {
    throw new TypeError(`referenceDate must be an ISO date or timestamp, such as 2026-01-15; got ${String(text)}`);
  }
  return instant;
}

function checkFields(fields: LocaleOptions['fields']): void {
  if (fields === undefined) return;
  if (typeof fields !== 'object' || fields === null) throw new TypeError('fields must be an object');
  for (const [key, field] of Object.entries(fields)) {
    if (field !== null && !(FIELD_KEYS as readonly string[]).includes(field)) {
      throw new TypeError(`fields: ${key} names ${String(field)}, which is no field`);
    }
  }
}

/** Codes for a gender, as schemas write them; the locale's language first. */
const GENDER_CODES: Readonly<Record<string, Record<PersonRecord['gender'], string[]>>> = {
  de: {
    female: ['w', 'W', 'weiblich', 'f', 'F', 'female'],
    male: ['m', 'M', 'männlich', 'male'],
    neutral: ['d', 'D', 'divers', 'x', 'X', 'u', 'U', 'unbestimmt'],
  },
  en: {
    female: ['f', 'F', 'female', 'w', 'W'],
    male: ['m', 'M', 'male'],
    neutral: ['x', 'X', 'u', 'U', 'unknown', 'd', 'D', 'diverse'],
  },
};

const ascii = (text: string): string =>
  text
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');

/**
 * Creates a locale value source with bounded retries and a fallback to facet generation.
 */
export function localeValues(locale: string | LocaleData, options: LocaleOptions = {}): ValueSource {
  const data = resolveLocale(locale);
  const reference = referenceInstant(options.referenceDate);
  checkFields(options.fields);
  const fields = options.fields ?? {};
  const language = data.tag.toLowerCase().startsWith('de') ? 'de' : 'en';
  const fits = (context: ValueContext, value: string | undefined): value is string =>
    value !== undefined && checkValue(context.facets, value) === undefined;
  /** The first of the candidates that meets the facets; an empty one never counts. */
  const first = (context: ValueContext, candidates: readonly (string | undefined)[]) =>
    candidates.find((value) => value !== '' && fits(context, value));
  /** A value of the list that meets the facets and is not among `used`. */
  const fromList = (context: ValueContext, list: readonly string[], used: readonly string[] = []) => {
    const fitting = list.filter((value) => value !== '' && !used.includes(value) && fits(context, value));
    return fitting.length > 0 ? context.rng.pick(fitting) : undefined;
  };
  const person = (context: ValueContext) => record(context, 'person', (rng) => drawPerson(data, rng));
  const address = (context: ValueContext) => record(context, 'address', (rng) => drawAddress(data, rng));

  /** List used to supply distinct values for repeated fields within an element. */
  function listOf(key: FieldKey, context: ValueContext): readonly string[] | undefined {
    const { person: p, address: a } = data;
    switch (key) {
      case 'person.firstName': {
        const { gender } = person(context);
        return gender === 'neutral' ? forGender(p.firstName, gender) : p.firstName[gender];
      }
      case 'person.lastName':
        return p.lastName;
      case 'person.title':
        return p.title;
      case 'person.nobilityPrefix':
        return p.nobilityPrefix;
      case 'person.nameSuffix':
        return formsFor(p.nameSuffix, person(context).gender);
      case 'address.street':
        return a.street.names;
      case 'address.supplement':
        return a.supplement;
      default:
        return undefined;
    }
  }

  /**
   * A field of a person or an address. The first occurrence in an element takes the record's value; a further one,
   * such as the second of three first names, takes another value of the same list while the list has one.
   */
  function recordValue(key: FieldKey, context: ValueContext): string | undefined {
    const list = listOf(key, context);
    const scope = context.scopes?.at(-1);
    const usedKey = `locale.used.${key}`;
    const used = (scope?.state.get(usedKey) as string[] | undefined) ?? [];
    const value = (used.length > 0 && list ? fromList(context, list, used) : undefined) ?? fieldValue(key, context);
    if (value !== undefined && list) scope?.state.set(usedKey, [...used, value]);
    return value;
  }

  /** A field of a person or an address: the record's value, or one from the locale's list for that field. */
  function fieldValue(key: FieldKey, context: ValueContext): string | undefined {
    const { address: a } = data;
    const list = listOf(key, context);
    switch (key) {
      case 'person.firstName':
        return first(context, [person(context).firstName]) ?? fromList(context, list ?? []);
      case 'person.lastName':
        return first(context, [person(context).lastName]) ?? fromList(context, list ?? []);
      case 'person.fullName': {
        const r = person(context);
        return first(context, [`${r.firstName} ${r.lastName}`, r.lastName]);
      }
      case 'person.title':
        return first(context, [person(context).title]) ?? fromList(context, list ?? []);
      case 'person.nobilityPrefix':
        return first(context, [person(context).nobilityPrefix]) ?? fromList(context, list ?? []);
      case 'person.nameSuffix':
        return first(context, [person(context).nameSuffix]) ?? fromList(context, list ?? []);
      case 'person.salutation': {
        const r = person(context);
        return first(context, [r.salutation]) ?? fromList(context, formsFor(data.person.salutation, r.gender));
      }
      case 'person.gender': {
        const codes = GENDER_CODES[language]?.[person(context).gender] ?? [];
        const { enumeration } = context.facets;
        const listed = enumeration?.find((value) => codes.some((code) => code.toLowerCase() === value.toLowerCase()));
        return first(context, listed !== undefined ? [listed] : codes);
      }
      case 'address.street':
        return first(context, [address(context).street]) ?? fromList(context, a.street.names);
      case 'address.houseNumber':
        return (
          first(context, [address(context).houseNumber]) ??
          first(context, [String(context.rng.int(1, 99))]) ??
          first(context, [String(context.rng.int(1, 9))])
        );
      case 'address.streetLine': {
        const r = address(context);
        return first(context, [r.streetLine, r.street]);
      }
      case 'address.postcode':
        return first(context, [address(context).postcode]);
      case 'address.city':
        return (
          first(context, [address(context).city]) ??
          fromList(
            context,
            a.places.map((place) => place.city),
          )
        );
      case 'address.state': {
        const state = address(context).state;
        const short = state?.code.replace(/^[A-Z]{2}-/, '');
        return (
          first(context, [state?.name, state?.code, short]) ??
          fromList(
            context,
            a.states.map((s) => s.name),
          )
        );
      }
      case 'address.country':
        return first(context, [a.country?.code, a.country?.name]);
      case 'address.supplement':
        return first(context, [address(context).supplement]) ?? fromList(context, list ?? []);
      default:
        return undefined;
    }
  }

  /** A candidate of a field that is not part of a record; checked and drawn again by the caller. */
  function candidate(key: FieldKey, context: ValueContext): string | undefined {
    const { rng, facets } = context;
    switch (key) {
      case 'contact.phone':
        return fill(rng.pick(data.contact.phone), rng);
      case 'contact.mobile':
        return fill(rng.pick(data.contact.mobile.length > 0 ? data.contact.mobile : data.contact.phone), rng);
      case 'contact.email': {
        const r = person(context);
        const local = [ascii(r.firstName.toLowerCase()), ascii(r.lastName.toLowerCase())].filter(Boolean).join('.');
        return `${local || 'info'}@${rng.pick(data.contact.emailDomain)}`;
      }
      case 'date.birth':
        return dateValue('birth', reference, facets, rng);
      case 'date.past':
        return dateValue('past', reference, facets, rng);
      case 'date.future':
        return dateValue('future', reference, facets, rng);
      case 'id.kvnr':
      case 'id.ik':
      case 'id.lanr':
      case 'id.pzn':
        if (facets.enumeration !== undefined) return undefined;
        return identifier(
          key.slice(3) as 'kvnr',
          rng,
          () => generateValue(facets, rng),
          (value) => fits(context, value),
        );
      case 'text':
        return freeText(data.text, facets, rng);
      default:
        return undefined;
    }
  }

  const domain: ValueSource = {
    value(context) {
      if (context.facets.unsupportedBounds) return undefined;
      const override = listKeys(context).find((key) => Object.hasOwn(fields, key));
      const key = override !== undefined ? fields[override] : fieldOf(context);
      if (key === undefined || key === null) return undefined;
      if (key.startsWith('person.') || key.startsWith('address.')) return recordValue(key, context);
      for (let draw = 0; draw < DRAWS; draw += 1) {
        const value = candidate(key, context);
        if (value === undefined) return undefined;
        if (fits(context, value)) return value;
      }
      return undefined;
    },
  };
  return firstOf(domain, facetValues);
}
