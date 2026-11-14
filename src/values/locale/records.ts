// A person and an address for each element instance: the name fields of one element belong to one person, its
// address fields to one place. A record is drawn when the first of its fields is asked for and kept in the state of
// the innermost element around the value. It also serves that element's parent, so a gender beside a `Name` element
// fits the first name inside it; elements beside each other, and each repetition, get records of their own. Drawing
// a record takes exactly one number from the document's random source; everything inside it comes from a source
// seeded with that number, so a record never shifts later values.

import type { Gendered, LocaleData, Region } from 'xsd-faker-locales';
import { createRng, type Rng } from '../../rng.js';
import type { ValueContext } from '../source.js';

export type Gender = 'female' | 'male' | 'neutral';

export interface PersonRecord {
  gender: Gender;
  firstName: string;
  lastName: string;
  title: string;
  nobilityPrefix: string;
  nameSuffix: string;
  salutation: string;
}

export interface AddressRecord {
  street: string;
  houseNumber: string;
  streetLine: string;
  postcode: string;
  city: string;
  state?: Region;
  supplement: string;
}

/**
 * First names for the selected gender, including neutral names. For a neutral person, uses neutral names
 * when available, otherwise both gendered lists.
 */
export function forGender(lists: Gendered, gender: Gender): string[] {
  if (gender !== 'neutral') return [...lists[gender], ...lists.neutral];
  return lists.neutral.length > 0 ? [...lists.neutral] : [...lists.female, ...lists.male];
}

/**
 * The forms of a salutation or name suffix for a gender: its own and the neutral ones. A neutral person takes only
 * neutral ones, since `Frau` or `Freifrau` would contradict the gender; without any, the field is left to the facets.
 */
export function formsFor(lists: Gendered, gender: Gender): string[] {
  return gender === 'neutral' ? [...lists.neutral] : [...lists[gender], ...lists.neutral];
}

/** An entry of a list, or '' for an empty one; always one draw, so that every record takes the same steps. */
function entry(rng: Rng, list: readonly string[]): string {
  const index = rng.int(0, Math.max(0, list.length - 1));
  return list[index] ?? '';
}

/**
 * A pattern with each `#` replaced by a digit and each `?` by a capital letter. With `number`, no number in it starts
 * with 0, so a building number is never `07` or `8/0`.
 */
export function fill(pattern: string, rng: Rng, number = false): string {
  return pattern.replace(/[#?]/g, (char, offset: number) => {
    if (char === '?') return String.fromCharCode(65 + rng.int(0, 25));
    const starts = number && !/[0-9#]/.test(pattern.charAt(offset - 1));
    return String(rng.int(starts ? 1 : 0, 9));
  });
}

export function drawPerson(locale: LocaleData, rng: Rng): PersonRecord {
  const { person } = locale;
  const roll = rng.int(0, 99);
  const gender: Gender = roll < 49 ? 'female' : roll < 98 ? 'male' : 'neutral';
  return {
    gender,
    firstName: entry(rng, gender === 'neutral' ? forGender(person.firstName, gender) : person.firstName[gender]),
    lastName: entry(rng, person.lastName),
    title: entry(rng, person.title),
    nobilityPrefix: entry(rng, person.nobilityPrefix),
    nameSuffix: entry(rng, formsFor(person.nameSuffix, gender)),
    salutation: entry(rng, formsFor(person.salutation, gender)),
  };
}

/** A street name from the locale's street patterns. */
export function streetName(locale: LocaleData, rng: Rng): string {
  const { street } = locale.address;
  const pattern = entry(rng, street.patterns);
  const stem = entry(rng, street.stems);
  const suffix = entry(rng, street.suffixes);
  const name = entry(rng, street.names);
  return pattern.replace(/\{(\w+)\}/g, (_, part: string) =>
    part === 'stem' ? stem : part === 'suffix' ? suffix : name,
  );
}

export function drawAddress(locale: LocaleData, rng: Rng): AddressRecord {
  const { address } = locale;
  const place = address.places[rng.int(0, address.places.length - 1)] ?? address.places[0];
  const postcode = fill(entry(rng, place?.postcodes ?? []), rng);
  const street = streetName(locale, rng);
  const houseNumber = fill(entry(rng, address.buildingNumber), rng, true);
  const line = entry(rng, address.streetLine);
  const supplement = fill(entry(rng, address.supplement), rng, true);
  const state = address.states.find((s) => s.code === place?.state);
  return {
    street,
    houseNumber,
    streetLine: line.replace(/\{(\w+)\}/g, (_, part: string) => (part === 'street' ? street : houseNumber)),
    postcode,
    city: place?.city ?? '',
    ...(state ? { state } : {}),
    supplement,
  };
}

/**
 * Finds a record in the innermost element, a child's shared record or the parent. Otherwise creates one
 * and shares it with the parent. Values outside complex-type elements receive their own record.
 */
export function record<T>(context: ValueContext, kind: string, draw: (rng: Rng) => T): T {
  const scope = context.scopes?.at(-1);
  const parent = context.scopes?.at(-2);
  const own = `locale.${kind}`;
  const fromChild = `locale.${kind}.child`;
  const found = scope?.state.get(own) ?? scope?.state.get(fromChild) ?? parent?.state.get(own);
  if (found !== undefined) return found as T;
  const made = draw(createRng(context.rng.int(0, 0x7fffffff)));
  scope?.state.set(own, made);
  if (parent && !parent.state.has(own) && !parent.state.has(fromChild)) parent.state.set(fromChild, made);
  return made;
}
