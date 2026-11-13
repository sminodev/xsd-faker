// Checks a value against the facets of its simple type. The generator uses it to accept or reject candidates, so it
// has to be strict: whatever it accepts must be valid for the XML Schema too.

import { binaryValue, type Bound, type Facets, INTEGERS, isNumeric } from '../xsd/facets.js';
import { combinePatterns, translateBody } from '../xsd/xsd-regex.js';
import { compareDecimal } from './decimal.js';
import { lexicalRegExp } from './lexical.js';
import { splitXmlSpace, trimXmlSpace } from '../xml/space.js';

const patternCache = new Map<string, RegExp>();

/** One regular expression for the patterns of all restriction steps. */
export function patternRegExp(steps: readonly (readonly string[])[]): RegExp {
  const key = JSON.stringify(steps);
  let regex = patternCache.get(key);
  if (regex === undefined) {
    regex = new RegExp(combinePatterns(steps.map((step) => step.map((p) => translateBody(p)))), 'u');
    patternCache.set(key, regex);
  }
  return regex;
}

/** The digits of a decimal number: all significant digits, and those after the point. */
export function digitCounts(lexical: string): { total: number; fraction: number } {
  const [whole = '', fraction = ''] = lexical.replace(/^[+-]/, '').split('.');
  const intDigits = whole.replace(/^0+/, '');
  const fracDigits = fraction.replace(/0+$/, '');
  return { total: Math.max(1, intDigits.length + fracDigits.length), fraction: fracDigits.length };
}

/** The length a length facet measures: octets for binary types, characters otherwise. */
export function measuredLength(builtin: string, value: string): number {
  if (builtin === 'hexBinary') {
    return value.length / 2;
  }
  if (builtin === 'base64Binary') {
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    return (value.length / 4) * 3 - padding;
  }
  return [...value].length;
}

function checkLength(facets: Facets, length: number, unit: string): string | undefined {
  if (facets.length !== undefined && length !== facets.length) {
    return `needs ${facets.length} ${unit}, has ${length}`;
  }
  if (facets.minLength !== undefined && length < facets.minLength) {
    return `needs at least ${facets.minLength} ${unit}, has ${length}`;
  }
  if (facets.maxLength !== undefined && length > facets.maxLength) {
    return `allows at most ${facets.maxLength} ${unit}, has ${length}`;
  }
  return undefined;
}

/**
 * The bounds of xs:float and xs:double, compared in the value space of the type (XML Schema 1.0, Datatypes 3.2.4
 * and 3.2.5): a literal is the nearest float or double, so `1e39` is INF as an xs:float. NaN meets no bound.
 */
function checkBinary(builtin: 'float' | 'double', facets: Facets, value: string): string | undefined {
  const v = binaryValue(builtin, value);
  const of = (bound: Bound) => binaryValue(builtin, bound.lexical ?? String(bound.value));
  const { min, max } = facets;
  if (min && !(min.exclusive ? v > of(min) : v >= of(min))) {
    return Number.isNaN(v) ? 'is NaN, which a bound excludes' : `is below the lower bound ${min.lexical ?? min.value}`;
  }
  if (max && !(max.exclusive ? v < of(max) : v <= of(max))) {
    return Number.isNaN(v) ? 'is NaN, which a bound excludes' : `is above the upper bound ${max.lexical ?? max.value}`;
  }
  return undefined;
}

function checkNumber(facets: Facets, value: string): string | undefined {
  if (facets.builtin === 'float' || facets.builtin === 'double') return checkBinary(facets.builtin, facets, value);
  const number = Number(value);
  if (INTEGERS[facets.builtin] !== undefined && !Number.isInteger(number)) {
    return 'is not an integer';
  }
  const { min, max } = facets;
  const lower = min ? (compareDecimal(value, min.lexical ?? String(min.value)) ?? number - min.value) : 1;
  const upper = max ? (compareDecimal(value, max.lexical ?? String(max.value)) ?? number - max.value) : -1;
  if (min && (min.exclusive ? lower <= 0 : lower < 0)) {
    return `is below the lower bound ${min.value}`;
  }
  if (max && (max.exclusive ? upper >= 0 : upper > 0)) {
    return `is above the upper bound ${max.value}`;
  }
  if (facets.builtin !== 'float' && facets.builtin !== 'double') {
    const digits = digitCounts(value);
    if (facets.totalDigits !== undefined && digits.total > facets.totalDigits) {
      return `has ${digits.total} digits, more than ${facets.totalDigits}`;
    }
    if (facets.fractionDigits !== undefined && digits.fraction > facets.fractionDigits) {
      return `has ${digits.fraction} fraction digits, more than ${facets.fractionDigits}`;
    }
  }
  return undefined;
}

// libxml2 turns spaces, quotes, braces and a few other characters into `_` before it parses a URI; the rest has to be
// a URI reference (RFC 3986), without the brackets of IP literals.
const URI_PART = /^(?:[\w\-.~:/?@!$&'()*+,;= <>"{}|\\^`\u0080-\u{10FFFF}]|%[0-9A-Fa-f]{2})*$/u;

function isUriReference(value: string): boolean {
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(value)?.[0] ?? '';
  const rest = value.slice(scheme.length);
  // Without a scheme, a colon in the first segment would make that segment look like one.
  if (scheme === '' && /^[^/?#]*:/.test(rest)) {
    return false;
  }
  const [main = '', ...fragment] = rest.split('#');
  return fragment.length <= 1 && URI_PART.test(main) && URI_PART.test(fragment[0] ?? '');
}

/** The whiteSpace rule of a type without its own facet: lists collapse, unions leave it to their members. */
function defaultWhiteSpace(facets: Facets): 'preserve' | 'replace' | 'collapse' {
  if (facets.variety === 'list') {
    return 'collapse';
  }
  if (facets.variety === 'union' || facets.builtin === 'string' || facets.builtin === 'anySimpleType') {
    return 'preserve';
  }
  return facets.builtin === 'normalizedString' ? 'replace' : 'collapse';
}

/** The value as a validator sees it, after the whiteSpace rule of its type. */
export function normalizeSpace(facets: Facets, value: string): string {
  const mode = facets.whiteSpace ?? defaultWhiteSpace(facets);
  if (mode === 'preserve') {
    return value;
  }
  const replaced = value.replace(/[\t\n\r]/g, ' ');
  return mode === 'replace' ? replaced : trimXmlSpace(replaced.replace(/ +/g, ' '));
}

/** The member of a union that reads a value: the first that accepts it, in the declared order. */
function acceptingMember(facets: Facets, value: string): Facets | undefined {
  return (facets.members ?? []).find((member) => checkValue(member, value) === undefined);
}

/**
 * The value as the validator reads it: after the whitespace rule of its type, and for a union as the first member
 * that accepts it normalizes it. Unions have no whiteSpace rule of their own.
 */
export function settledValue(facets: Facets, value: string): string {
  const normalized = normalizeSpace(facets, value);
  if (facets.variety !== 'union') {
    return normalized;
  }
  const member = acceptingMember(facets, normalized);
  return member ? settledValue(member, normalized) : normalized;
}

/**
 * Whether a value is an xs:float or xs:double value, whose JSON number is checked against its binary value: by its
 * type, for a union by the member that reads it, for a list only if all items agree.
 */
export function binaryKind(facets: Facets, value: string): 'float' | 'double' | undefined {
  if (facets.variety === 'list') {
    const items = normalizeSpace(facets, value)
      .split(' ')
      .filter((item) => item !== '');
    const kinds = new Set(items.map((item) => (facets.item ? binaryKind(facets.item, item) : undefined)));
    return kinds.size === 1 ? [...kinds][0] : undefined;
  }
  if (facets.variety === 'union') {
    const normalized = normalizeSpace(facets, value);
    const member = acceptingMember(facets, normalized);
    return member ? binaryKind(member, normalized) : undefined;
  }
  return facets.builtin === 'float' || facets.builtin === 'double' ? facets.builtin : undefined;
}

/** Why `value` is not allowed by `facets`, or undefined if it is. */
export function checkValue(facets: Facets, value: string): string | undefined {
  value = normalizeSpace(facets, value);
  if (facets.enumeration !== undefined && !facets.enumeration.includes(value)) {
    return 'is not one of the enumerated values';
  }
  if (facets.patterns.length > 0 && !patternRegExp(facets.patterns).test(value)) {
    return 'does not match the pattern';
  }
  if (facets.variety === 'union') {
    const members = facets.members ?? [];
    return members.some((member) => checkValue(member, value) === undefined)
      ? undefined
      : 'matches none of the member types';
  }
  if (facets.variety === 'list') {
    const items = splitXmlSpace(value);
    const length = checkLength(facets, items.length, 'items');
    if (length) {
      return length;
    }
    for (const item of items) {
      const reason = facets.item && checkValue(facets.item, item);
      if (reason) {
        return `item ${item} ${reason}`;
      }
    }
    return undefined;
  }
  const lexical = lexicalRegExp(facets.builtin);
  if ((lexical && !lexical.test(value)) || (facets.builtin === 'anyURI' && !isUriReference(value))) {
    return `is not a valid xs:${facets.builtin}`;
  }
  // The prefix xmlns cannot be declared, so no document can bind it in a QName.
  if ((facets.builtin === 'QName' || facets.builtin === 'NOTATION') && value.startsWith('xmlns:')) {
    return 'uses the reserved prefix xmlns';
  }
  if (isNumeric(facets.builtin)) {
    return checkNumber(facets, value);
  }
  return checkLength(facets, measuredLength(facets.builtin, value), 'characters');
}
