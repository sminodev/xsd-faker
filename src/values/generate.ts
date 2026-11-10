// Generates a value for a simple type: produce a candidate, check it against all facets, try again if it fails.
// Candidates come from the enumeration, from a pattern, or from the built-in type; the check decides.

import { RegexSyntaxError } from '../regex/parse.js';
import { stringFromPattern, UngeneratableError } from '../regex/generate.js';
import type { Rng } from '../rng.js';
import { type Facets, INTEGERS, isNumeric } from '../xsd/facets.js';
import { boundUnits } from './decimal.js';
import { checkValue } from './check.js';

const ATTEMPTS = 100;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A value that satisfies all facets, or undefined if none was found. */
export function generateValue(facets: Facets, rng: Rng): string | undefined {
  if (
    [facets.length, facets.minLength].some((n) => n !== undefined && (!Number.isSafeInteger(n) || n > 65536 || n < 0))
  )
    return undefined;
  if (facets.enumeration?.length === 0) return undefined;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const value = candidate(facets, rng);
    if (value !== undefined && checkValue(facets, value) === undefined) {
      return value;
    }
  }
  return undefined;
}

/** One candidate; it may still break a facet. */
function candidate(facets: Facets, rng: Rng): string | undefined {
  if (facets.enumeration !== undefined) {
    return rng.pick(facets.enumeration);
  }
  if (facets.variety === 'union') {
    const members = facets.members ?? [];
    return members.length > 0 ? generateValue(rng.pick(members), rng) : undefined;
  }
  if (facets.variety === 'list') {
    return listCandidate(facets, rng);
  }
  // Patterns on a built-in type with its own lexical form (a date, a number) may be met by either source.
  if (facets.patterns.length > 0 && (!hasLexicalForm(facets.builtin) || rng.chance(0.5))) {
    return patternCandidate(facets, rng);
  }
  return builtinCandidate(facets, rng);
}

function hasLexicalForm(builtin: string): boolean {
  return isNumeric(builtin) || ['boolean', 'date', 'dateTime', 'time', 'gYear', 'gYearMonth'].includes(builtin);
}

function patternCandidate(facets: Facets, rng: Rng): string | undefined {
  const step = rng.pick(facets.patterns);
  try {
    return stringFromPattern(rng.pick(step), rng, {
      maxExtraRepeats: Math.max(3, Math.min(65536, (facets.length ?? facets.minLength ?? 0) + 3)),
    });
  } catch (e) {
    if (e instanceof RegexSyntaxError || e instanceof UngeneratableError) {
      return undefined;
    }
    throw e;
  }
}

function listCandidate(facets: Facets, rng: Rng): string | undefined {
  const count =
    facets.length ??
    rng.int(Math.max(1, facets.minLength ?? 1), Math.max(facets.minLength ?? 1, Math.min(facets.maxLength ?? 3, 3)));
  const items: string[] = [];
  for (let k = 0; k < count; k += 1) {
    const item = facets.item ? generateValue(facets.item, rng) : word(rng, 5);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return items.join(' ');
}

/** A lower-case word with a capital first letter. */
function word(rng: Rng, length: number): string {
  let out = '';
  for (let k = 0; k < length; k += 1) {
    out += LETTERS[rng.int(0, LETTERS.length - 1)];
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** A length allowed by the length facets, at most 20 above the minimum. */
function lengthFor(facets: Facets, rng: Rng, fallbackMax: number): number {
  if (facets.length !== undefined) {
    return facets.length;
  }
  // Without minLength, prefer non-empty values; maxLength="0" leaves the empty string as the only choice.
  const min = facets.minLength ?? Math.min(1, facets.maxLength ?? 1);
  return rng.int(min, Math.max(min, Math.min(facets.maxLength ?? fallbackMax, min + 20)));
}

function date(rng: Rng): { year: number; month: number; day: number } {
  const year = rng.int(1990, 2030);
  const month = rng.int(1, 12);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: rng.int(1, days) };
}

function time(rng: Rng): string {
  return `${pad(rng.int(0, 23))}:${pad(rng.int(0, 59))}:${pad(rng.int(0, 59))}`;
}

function bytes(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.int(0, 255));
}

function builtinCandidate(facets: Facets, rng: Rng): string | undefined {
  const b = facets.builtin;
  if (isNumeric(b)) {
    return numberCandidate(facets, rng);
  }
  const d = date(rng);
  switch (b) {
    case 'boolean':
      return rng.pick(['true', 'false']);
    case 'date':
      return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
    case 'dateTime':
      return `${d.year}-${pad(d.month)}-${pad(d.day)}T${time(rng)}`;
    case 'time':
      return time(rng);
    case 'gYear':
      return String(d.year);
    case 'gYearMonth':
      return `${d.year}-${pad(d.month)}`;
    case 'gMonth':
      return `--${pad(d.month)}`;
    case 'gMonthDay':
      return `--${pad(d.month)}-${pad(d.day)}`;
    case 'gDay':
      return `---${pad(d.day)}`;
    case 'duration':
      return `P${rng.int(1, 30)}D`;
    case 'hexBinary':
      return bytes(rng, lengthFor(facets, rng, 8))
        .map((x) => x.toString(16).padStart(2, '0').toUpperCase())
        .join('');
    case 'base64Binary':
      return btoa(String.fromCharCode(...bytes(rng, lengthFor(facets, rng, 12))));
    case 'anyURI':
      return `https://example.org/${word(rng, 6).toLowerCase()}`;
    case 'language':
      return rng.pick(['de', 'en', 'fr', 'de-DE', 'en-GB']);
    case 'QName':
    case 'NCName':
    case 'Name':
    case 'ID':
    case 'IDREF':
    case 'ENTITY':
    case 'NMTOKEN':
      return word(rng, lengthFor(facets, rng, 8));
    case 'NMTOKENS':
    case 'IDREFS':
    case 'ENTITIES':
      return `${word(rng, 5)} ${word(rng, 5)}`;
    default:
      // string, normalizedString, token, anySimpleType and the rest: readable letters
      return word(rng, lengthFor(facets, rng, 10));
  }
}

/** Formats `units * 10^-scale` as a decimal number without exponent, for example 12345 and 2 as 123.45. */
export function formatScaled(units: number, scale: number): string {
  const sign = units < 0 ? '-' : '';
  const digits = String(Math.abs(units)).padStart(scale + 1, '0');
  return scale === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/**
 * A number within the bounds and digit limits. It works in whole units of the chosen scale: with 2 fraction digits,
 * 123.45 is 12345 units of 0.01.
 */
export function numberCandidate(facets: Facets, rng: Rng): string | undefined {
  const integer = INTEGERS[facets.builtin] !== undefined || facets.fractionDigits === 0;
  const scale = integer ? 0 : rng.int(0, Math.min(facets.fractionDigits ?? 2, 4));
  const factor = 10n ** BigInt(scale);
  const min = facets.min,
    max = facets.max;
  let low = min ? boundUnits(min.lexical ?? String(min.value), scale, true, min.exclusive) : undefined;
  let high = max ? boundUnits(max.lexical ?? String(max.value), scale, false, max.exclusive) : undefined;
  if ((min && low === undefined) || (max && high === undefined)) return undefined;
  low ??= high === undefined ? 0n : high - 1000n * factor;
  high ??= low + 1000n * factor;
  if (facets.totalDigits !== undefined) {
    if (!Number.isSafeInteger(facets.totalDigits) || facets.totalDigits > 1000) return undefined;
    const limit = 10n ** BigInt(facets.totalDigits) - 1n;
    low = low < -limit ? -limit : low;
    high = high > limit ? limit : high;
  }
  if (low > high) return undefined;
  const span = high - low + 1n;
  const safe = BigInt(Number.MAX_SAFE_INTEGER);
  const units =
    low >= -safe && high <= safe && span <= safe
      ? BigInt(rng.int(Number(low), Number(high)))
      : low + (BigInt(Math.floor(rng.next() * 4294967296)) * span) / 4294967296n;
  const sign = units < 0n ? '-' : '';
  const digits = String(units < 0n ? -units : units).padStart(scale + 1, '0');
  return scale === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
