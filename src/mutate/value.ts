// Values that break exactly one facet of a simple type and meet all the others. A candidate comes from the facets
// with the broken facet turned around, such as a minimum length below `minLength`, and is accepted only if checking
// it against every facet finds that one facet and nothing else. Values are compared as XML Schema compares them, in
// the value space: `+5` is the fixed value `5`. Some couplings make such a value impossible, such as a length outside
// every length a pattern can match; those are reported as decided, without a search, and only with a proof.

import { parsePattern, type RegexNode } from '../regex/parse.js';
import { stringFromPattern } from '../regex/generate.js';
import { createRng, type Rng } from '../rng.js';
import { digitCounts, measuredLength, normalizeSpace, patternRegExp, checkValue } from '../values/check.js';
import { boundUnits, compareDecimal, decimalParts } from '../values/decimal.js';
import { generateValue } from '../values/generate.js';
import { splitXmlSpace } from '../xml/space.js';
import {
  type Bound,
  builtinFacets,
  type Facets,
  INTEGERS,
  isKnownBuiltin,
  isNumeric,
  type OtherBound,
  tighter,
} from '../xsd/facets.js';
import {
  compareMoments,
  formatMoment,
  type Moment,
  momentBeside,
  momentBetween,
  momentOf,
  ORDERED_DATES,
} from './dates.js';
import type { ValueRule } from './rules.js';

/**
 * The facets of a simple type as plain data: the effective facets along its derivation, with the tightest value of
 * each facet and the patterns of each restriction step.
 */
export interface ValueFacets {
  /** the local name of the built-in type the derivation ends in, such as `decimal` or `NMTOKENS` */
  builtin: string;
  /** default: `list` for the built-in list types, otherwise `atomic` */
  variety?: 'atomic' | 'list' | 'union';
  /** the item type of a list */
  item?: ValueFacets;
  /** the member types of a union, in their order */
  members?: readonly ValueFacets[];
  enumeration?: readonly string[];
  /** one array per restriction step: a value matches one pattern of each step */
  patterns?: readonly (readonly string[])[];
  /** lengths of a list count its items */
  length?: number;
  minLength?: number;
  maxLength?: number;
  /** bounds as written in the schema */
  minInclusive?: string;
  maxInclusive?: string;
  minExclusive?: string;
  maxExclusive?: string;
  totalDigits?: number;
  fractionDigits?: number;
  /** the effective rule; default: the rule of the built-in type */
  whiteSpace?: 'preserve' | 'replace' | 'collapse';
  /** the fixed value of the element or attribute declaration */
  fixed?: string;
}

export interface ViolatingValueRequest {
  facets: ValueFacets;
  rule: ValueRule;
  /** facets the value must still meet, such as those of another version of the type */
  mustSatisfy?: ValueFacets;
  /** default: 1 */
  seed?: number;
}

export type ViolatingValue =
  | { status: 'constructed'; value: string; rule: ValueRule }
  /** `decided`: no such value exists; otherwise the search found none. */
  | { status: 'not-constructible'; rule: ValueRule; reason: string; decided: boolean };

/** What a value breaks, by facet name, with `lexical` for the lexical space and range of the built-in type. */
type Broken =
  | 'length'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'enumeration'
  | 'minInclusive'
  | 'maxInclusive'
  | 'minExclusive'
  | 'maxExclusive'
  | 'totalDigits'
  | 'fractionDigits'
  | 'lexical'
  | 'fixed';

/** A simple type with the fixed value of its declaration. */
export interface ValueSpec {
  facets: Facets;
  fixed?: string;
}

const CANDIDATES = 200;
/** Types whose values libxml2 reads without collapsing the whitespace around them, unlike XML Schema. */
const UNTRIMMED = new Set([
  'date',
  'dateTime',
  'time',
  'gYear',
  'gYearMonth',
  'gMonth',
  'gMonthDay',
  'gDay',
  'duration',
]);
const WHITESPACE = ['preserve', 'replace', 'collapse'];

/** A value that breaks `rule` of `facets` and nothing else, and meets `mustSatisfy`. Deterministic for a seed. */
export function generateViolatingValue(request: ViolatingValueRequest): ViolatingValue {
  if (typeof request !== 'object' || request === null) throw new TypeError('request must be an object');
  const target = specOf(request.facets, 'facets');
  const also = request.mustSatisfy === undefined ? undefined : specOf(request.mustSatisfy, 'mustSatisfy');
  const seed = request.seed ?? 1;
  if (!Number.isSafeInteger(seed)) throw new TypeError('seed must be a safe integer');
  return violatingValue(target, request.rule, createRng(seed), also);
}

/** The same for facets read from a schema. */
export function violatingValue(target: ValueSpec, rule: ValueRule, rng: Rng, also?: ValueSpec): ViolatingValue {
  const facet = facetOf(rule);
  const refuse = (reason: string, decided = true): ViolatingValue => ({
    status: 'not-constructible',
    rule,
    reason,
    decided,
  });
  const impossible = decide(target, facet, also);
  if (impossible) return refuse(impossible.reason, impossible.decided);
  const accept = (value: string | undefined): value is string => {
    if (value === undefined || (UNTRIMMED.has(target.facets.builtin) && value !== value.trim())) return false;
    const broken = brokenFacets(target, value);
    return broken.size === 1 && broken.has(facet) && (also === undefined || brokenFacets(also, value).size === 0);
  };
  // A fixed value or an enumeration admits a few values only: they are tried one by one.
  const few = finite(target, facet, also);
  if (few) {
    const witnesses = few.values.filter(accept);
    if (witnesses.length > 0) return { status: 'constructed', value: rng.pick(witnesses), rule };
    return refuse(few.reason, few.complete);
  }
  for (let attempt = 0; attempt < CANDIDATES; attempt += 1) {
    const value = candidate(target, facet, rng, also);
    if (accept(value)) return { status: 'constructed', value, rule };
  }
  return refuse(`no value was found that breaks only ${facet}${also ? ' and meets the other facets' : ''}`, false);
}

const VALUE_RULES: readonly ValueRule[] = [
  'facet:length',
  'facet:minLength',
  'facet:maxLength',
  'facet:pattern',
  'facet:enumeration',
  'facet:minInclusive',
  'facet:maxInclusive',
  'facet:minExclusive',
  'facet:maxExclusive',
  'facet:totalDigits',
  'facet:fractionDigits',
  'value:lexical',
  'value:fixed',
];

/**
 * Applicable value rules for a type. Fixed values and enumerations take precedence because changing
 * the value would violate those constraints as well as any targeted facet.
 */
export function applicableValueRules(spec: ValueSpec): ValueRule[] {
  const f = spec.facets;
  if (spec.fixed !== undefined) return ['value:fixed'];
  if (f.enumeration !== undefined) return ['facet:enumeration'];
  return VALUE_RULES.filter((rule) => {
    const facet = facetOf(rule);
    if (facet === 'fixed') return spec.fixed !== undefined;
    if (facet === 'lexical') return everyString(f) === undefined;
    return present(f, facet);
  });
}

function facetOf(rule: ValueRule): Broken {
  const facet = rule.slice(rule.indexOf(':') + 1);
  if (!['facet', 'value'].includes(rule.slice(0, rule.indexOf(':'))) || !isBroken(facet)) {
    throw new TypeError(`not a value rule: ${String(rule)}`);
  }
  return facet;
}

const BROKEN = new Set<string>([
  'length',
  'minLength',
  'maxLength',
  'pattern',
  'enumeration',
  'minInclusive',
  'maxInclusive',
  'minExclusive',
  'maxExclusive',
  'totalDigits',
  'fractionDigits',
  'lexical',
  'fixed',
]);
const isBroken = (name: string): name is Broken => BROKEN.has(name);

// --- reading ValueFacets ----------------------------------------------------------------------------------------

const LIST_ITEMS: Readonly<Record<string, string>> = { NMTOKENS: 'NMTOKEN', IDREFS: 'IDREF', ENTITIES: 'ENTITY' };

function specOf(facets: ValueFacets, where: string): ValueSpec {
  const converted = toFacets(facets, where);
  if (facets.fixed !== undefined && typeof facets.fixed !== 'string')
    throw new TypeError(`${where}.fixed must be a string`);
  return facets.fixed === undefined ? { facets: converted } : { facets: converted, fixed: facets.fixed };
}

function toFacets(input: ValueFacets, where: string): Facets {
  if (typeof input !== 'object' || input === null) throw new TypeError(`${where} must be an object`);
  if (typeof input.builtin !== 'string' || !isKnownBuiltin(input.builtin)) {
    throw new TypeError(`${where}.builtin must name a built-in type, not ${String(input.builtin)}`);
  }
  const variety = input.variety ?? (LIST_ITEMS[input.builtin] !== undefined ? 'list' : 'atomic');
  let out: Facets;
  if (variety === 'list') {
    const base = builtinFacets(LIST_ITEMS[input.builtin] !== undefined ? input.builtin : 'string');
    out = {
      builtin: input.builtin,
      variety: 'list',
      patterns: [],
      ...(base.minLength !== undefined ? { minLength: base.minLength } : {}),
      item: input.item ? toFacets(input.item, `${where}.item`) : (base.item ?? builtinFacets('string')),
    };
  } else if (variety === 'union') {
    if (!Array.isArray(input.members) || input.members.length === 0) {
      throw new TypeError(`${where}.members must list the member types of a union`);
    }
    out = {
      builtin: 'anySimpleType',
      variety: 'union',
      patterns: [],
      members: (input.members as readonly ValueFacets[]).map((m, i) => toFacets(m, `${where}.members[${i}]`)),
    };
  } else if (variety === 'atomic') {
    out = builtinFacets(input.builtin);
    if (out.variety !== 'atomic') throw new TypeError(`${where}.builtin ${input.builtin} is a list type`);
  } else {
    throw new TypeError(`${where}.variety must be atomic, list or union`);
  }
  out = { ...out, patterns: [] };
  if (input.enumeration !== undefined) out.enumeration = strings(input.enumeration, `${where}.enumeration`);
  if (input.patterns !== undefined) {
    if (!Array.isArray(input.patterns)) throw new TypeError(`${where}.patterns must be an array of arrays`);
    out.patterns = input.patterns.map((step, i) => strings(step, `${where}.patterns[${i}]`));
  }
  for (const name of ['length', 'minLength', 'maxLength', 'totalDigits', 'fractionDigits'] as const) {
    const value = input[name];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < (name === 'totalDigits' ? 1 : 0)) {
      throw new TypeError(`${where}.${name} must be a ${name === 'totalDigits' ? 'positive' : 'non-negative'} integer`);
    }
    if (name === 'minLength') out.minLength = Math.max(out.minLength ?? 0, value);
    else out[name] = value;
  }
  for (const name of ['minInclusive', 'minExclusive', 'maxInclusive', 'maxExclusive'] as const) {
    const lexical = input[name];
    if (lexical === undefined) continue;
    if (typeof lexical !== 'string') throw new TypeError(`${where}.${name} must be a string`);
    if (variety !== 'atomic') {
      out.unsupportedBounds = true;
      continue;
    }
    const text = lexical.trim();
    if (!isNumeric(out.builtin)) {
      out.otherBounds = [...(out.otherBounds ?? []), { facet: name, lexical: text }];
      continue;
    }
    // INF and -INF bound a float or double as values; they are no limit for the finite values.
    const infinite = (out.builtin === 'float' || out.builtin === 'double') && /^[+-]?INF$/.test(text);
    const value = infinite ? (text.startsWith('-') ? -Infinity : Infinity) : Number(text);
    if (text === '' || (!infinite && !Number.isFinite(value))) {
      throw new TypeError(
        `${where}.${name} must be a number${out.builtin === 'float' || out.builtin === 'double' ? ', INF or -INF' : ''}`,
      );
    }
    const bound: Bound = {
      value,
      lexical: infinite ? text.replace(/^\+/, '') : text,
      exclusive: name.endsWith('Exclusive'),
    };
    if (name.startsWith('min')) out.min = tighter(out.min, bound, true);
    else out.max = tighter(out.max, bound, false);
  }
  if (input.whiteSpace !== undefined) {
    if (!WHITESPACE.includes(input.whiteSpace))
      throw new TypeError(`${where}.whiteSpace must be ${WHITESPACE.join(', ')}`);
    out.whiteSpace = input.whiteSpace;
  }
  return out;
}

function strings(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new TypeError(`${where} must be an array of strings`);
  }
  return [...(value as string[])];
}

// --- checking ---------------------------------------------------------------------------------------------------

/** Every facet a value breaks. */
export function brokenFacets(spec: ValueSpec, value: string): Set<Broken> {
  const facets = spec.facets;
  const out = new Set<Broken>();
  // A union has no whitespace rule of its own: its facets see the value as the member that reads it normalizes it.
  const v = facets.variety === 'union' ? settled(facets, value) : normalizeSpace(facets, value);
  if (spec.fixed !== undefined && !sameValue(facets, normalizeSpace(facets, spec.fixed), v)) out.add('fixed');
  if (
    facets.enumeration !== undefined &&
    !facets.enumeration.some((e) => sameValue(facets, normalizeSpace(facets, e), v))
  ) {
    out.add('enumeration');
  }
  if (facets.patterns.length > 0 && !patternRegExp(facets.patterns).test(v)) out.add('pattern');
  if (facets.variety === 'union') {
    if (memberOf(facets, v) === undefined) out.add('lexical');
    return out;
  }
  if (facets.variety === 'list') {
    const items = splitXmlSpace(v);
    const implicit = builtinFacets(facets.builtin).minLength;
    if (implicit !== undefined && items.length < implicit) out.add('lexical');
    lengths(facets, items.length, out);
    if (items.some((item) => facets.item && brokenFacets({ facets: facets.item }, item).size > 0)) out.add('lexical');
    return out;
  }
  // The lexical space and the value range of the built-in type: the validator names the type, not a facet.
  if (
    checkValue({ ...builtinFacets(facets.builtin), ...(facets.whiteSpace ? { whiteSpace: facets.whiteSpace } : {}) }, v)
  ) {
    out.add('lexical');
    return out;
  }
  if (isNumeric(facets.builtin)) {
    bounds(facets, v, out);
    if (facets.builtin !== 'float' && facets.builtin !== 'double' && !/^[+-]?(INF|NaN)$/.test(v)) {
      const digits = digitCounts(v);
      if (facets.totalDigits !== undefined && digits.total > facets.totalDigits) out.add('totalDigits');
      if (facets.fractionDigits !== undefined && digits.fraction > facets.fractionDigits) out.add('fractionDigits');
    }
    return out;
  }
  otherBounds(facets, v, out);
  lengths(facets, measuredLength(facets.builtin, v), out);
  return out;
}

/** Normalizes a union value using its first accepting member; leaves unmatched values unchanged. */
function settled(facets: Facets, value: string): string {
  const member = memberOf(facets, value);
  if (!member) return value;
  return member.variety === 'union' ? settled(member, value) : normalizeSpace(member, value);
}

/** The first member of a union that accepts a value, as the validator picks it. */
function memberOf(facets: Facets, v: string): Facets | undefined {
  return (facets.members ?? []).find((m) => brokenFacets({ facets: m }, v).size === 0);
}

function lengths(facets: Facets, length: number, out: Set<Broken>): void {
  if (facets.length !== undefined && length !== facets.length) out.add('length');
  if (facets.minLength !== undefined && length < facets.minLength && !isImplicitMinLength(facets)) out.add('minLength');
  if (facets.maxLength !== undefined && length > facets.maxLength) out.add('maxLength');
}

/** The minimum of one item of a built-in list type, which the validator reports as the type. */
const isImplicitMinLength = (facets: Facets) => facets.minLength === builtinFacets(facets.builtin).minLength;

/** A float or double value as a number, with INF, -INF and NaN. */
const special = (v: string): number | undefined =>
  v === 'INF' ? Infinity : v === '-INF' ? -Infinity : v === 'NaN' ? NaN : undefined;

function bounds(facets: Facets, v: string, out: Set<Broken>): void {
  // NaN satisfies no bound; INF and -INF compare as the greatest and least values.
  const compare = (bound: Bound): number => {
    const value = special(v);
    if (value !== undefined || !Number.isFinite(bound.value)) return Math.sign((value ?? Number(v)) - bound.value);
    return compareDecimal(v, bound.lexical ?? String(bound.value)) ?? Math.sign(Number(v) - bound.value);
  };
  const { min, max } = declaredBounds(facets);
  if (min) {
    const order = compare(min);
    if (Number.isNaN(order) || (min.exclusive ? order <= 0 : order < 0)) {
      out.add(min.exclusive ? 'minExclusive' : 'minInclusive');
    }
  }
  if (max) {
    const order = compare(max);
    if (Number.isNaN(order) || (max.exclusive ? order >= 0 : order > 0)) {
      out.add(max.exclusive ? 'maxExclusive' : 'maxInclusive');
    }
  }
}

/** The bounds of a date or time type; a comparison XML Schema leaves open counts as broken. */
function otherBounds(facets: Facets, v: string, out: Set<Broken>): void {
  const value = momentOf(facets.builtin, v);
  for (const bound of facets.otherBounds ?? []) {
    const limit = momentOf(facets.builtin, bound.lexical);
    const order = value && limit ? compareMoments(value, limit) : undefined;
    const kept =
      order !== undefined &&
      (bound.facet === 'minInclusive'
        ? order >= 0
        : bound.facet === 'minExclusive'
          ? order > 0
          : bound.facet === 'maxInclusive'
            ? order <= 0
            : order < 0);
    if (!kept) out.add(bound.facet);
  }
}

/** The bounds the schema states, leaving out those that are only the range of the built-in type. */
function declaredBounds(facets: Facets): { min?: Bound; max?: Bound } {
  const builtin = builtinFacets(facets.builtin);
  const same = (a: Bound | undefined, b: Bound | undefined) =>
    a !== undefined &&
    b !== undefined &&
    a.exclusive === b.exclusive &&
    (compareDecimal(a.lexical ?? String(a.value), b.lexical ?? String(b.value)) ?? a.value - b.value) === 0;
  return {
    ...(facets.min && !same(facets.min, builtin.min) ? { min: facets.min } : {}),
    ...(facets.max && !same(facets.max, builtin.max) ? { max: facets.max } : {}),
  };
}

/**
 * Whether two values of a type are equal in its value space, as an enumeration and a fixed value compare them: `1`
 * and `true` for a boolean, `5` and `+5.0` for a decimal, `0a` and `0A` for hexBinary, instants for dates. Both are
 * normalized by the whitespace rule of the type; a union compares them in the member that reads them.
 */
function sameValue(facets: Facets, a: string, b: string): boolean {
  if (a === b) return true;
  if (facets.variety === 'list') {
    const x = splitXmlSpace(a);
    const y = splitXmlSpace(b);
    const item = facets.item;
    return (
      item !== undefined &&
      x.length === y.length &&
      x.every((v, i) => sameValue(item, normalizeSpace(item, v), normalizeSpace(item, y[i] ?? '')))
    );
  }
  if (facets.variety === 'union') {
    const m = memberOf(facets, a);
    return m !== undefined && m === memberOf(facets, b) && sameValue(m, normalizeSpace(m, a), normalizeSpace(m, b));
  }
  const builtin = facets.builtin;
  if (builtin === 'boolean') {
    const truth = (x: string) => (x === '1' || x === 'true' ? 'true' : x === '0' || x === 'false' ? 'false' : x);
    return truth(a) === truth(b);
  }
  if (builtin === 'float' || builtin === 'double') {
    const x = special(a) ?? Number(a);
    const y = special(b) ?? Number(b);
    return x === y || (Number.isNaN(x) && Number.isNaN(y));
  }
  if (isNumeric(builtin)) return compareDecimal(a, b) === 0;
  if (builtin === 'hexBinary') return a.toUpperCase() === b.toUpperCase();
  if (builtin === 'base64Binary') return a.replace(/\s/g, '') === b.replace(/\s/g, '');
  if (ORDERED_DATES.has(builtin)) {
    const x = momentOf(builtin, a);
    const y = momentOf(builtin, b);
    return x !== undefined && y !== undefined && compareMoments(x, y) === 0;
  }
  if (builtin === 'duration') {
    const x = durationOf(a);
    const y = durationOf(b);
    return x !== undefined && y !== undefined && x.months === y.months && x.seconds === y.seconds;
  }
  return false;
}

/** A duration as months and seconds, which are equal for two equal durations. */
function durationOf(v: string): { months: number; seconds: number } | undefined {
  const m = /^(-)?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(v);
  if (!m) return undefined;
  const n = (i: number) => Number(m[i] ?? 0);
  const sign = m[1] ? -1 : 1;
  return {
    months: sign * (n(2) * 12 + n(3)),
    seconds: sign * (((n(4) * 24 + n(5)) * 60 + n(6)) * 60 + n(7)),
  };
}

// --- deciding ---------------------------------------------------------------------------------------------------

const FREE_TEXT = new Set(['string', 'normalizedString', 'token', 'anySimpleType']);
const BINARY = new Set(['hexBinary', 'base64Binary']);
const LENGTHS = new Set<Broken>(['length', 'minLength', 'maxLength']);

/** Why no value can break only `facet` and meet `also`, or undefined where a search may find one. */
function decide(spec: ValueSpec, facet: Broken, also?: ValueSpec): { reason: string; decided: boolean } | undefined {
  const f = spec.facets;
  const no = (reason: string) => ({ reason, decided: true });
  const qnames = (x: Facets): boolean =>
    x.builtin === 'QName' ||
    x.builtin === 'NOTATION' ||
    (x.item !== undefined && qnames(x.item)) ||
    (x.members ?? []).some(qnames);
  if (qnames(f)) return { reason: 'values of xs:QName and xs:NOTATION need namespace bindings', decided: false };
  const unordered = unorderedBounds(f) ?? (also ? unorderedBounds(also.facets) : undefined);
  // A value outside the lexical space is not compared with the bounds; any other has to keep them.
  if (unordered && facet !== 'lexical') return { reason: unordered, decided: false };
  if (facet === 'fixed') {
    if (spec.fixed === undefined) return no('the declaration has no fixed value');
  } else if (facet === 'lexical') {
    const reason = everyString(f);
    if (reason) return no(reason);
  } else if (!present(f, facet)) {
    if (beyondType(f, facet)) return no(`beyond the bound lies only what xs:${f.builtin} excludes`);
    return no(`the type has no ${facet}`);
  }
  if (LENGTHS.has(facet) && f.variety === 'atomic') {
    const range = BINARY.has(f.builtin) ? undefined : patternLengths(f.patterns);
    if (range && range.min <= range.max) {
      const ok =
        facet === 'length'
          ? range.min < (f.length ?? 0) || range.max > (f.length ?? 0)
          : facet === 'minLength'
            ? range.min < (f.minLength ?? 0)
            : range.max > (f.maxLength ?? Infinity);
      if (!ok) return no(`every value of the pattern has a length of ${range.min} to ${range.max}`);
    }
  }
  if (facet === 'minLength' && (f.minLength ?? 0) === 0) return no('no length is below 0');
  if (facet === 'totalDigits' && integral(f)) {
    const limit = `1${'0'.repeat(f.totalDigits ?? 0)}`;
    const { min, max } = f;
    const under = (b: Bound | undefined) =>
      b !== undefined && (compareDecimal(b.lexical ?? String(b.value), limit) ?? 0) < 0;
    const over = (b: Bound | undefined) =>
      b !== undefined && (compareDecimal(b.lexical ?? String(b.value), `-${limit}`) ?? 0) > 0;
    if (under(max) && over(min)) return no(`every integer within the bounds has at most ${f.totalDigits} digits`);
  }
  if (facet === 'totalDigits' && !integral(f) && f.fractionDigits !== undefined && f.min && f.max) {
    // The bounds limit the digits before the point, fractionDigits those after it.
    const whole = (b: Bound) => {
      const parts = decimalParts(b.lexical ?? String(b.value));
      if (!parts || parts.scale < 0) return undefined;
      const units = parts.units < 0n ? -parts.units : parts.units;
      const integer = units / 10n ** BigInt(parts.scale);
      return integer === 0n ? 0 : String(integer).length;
    };
    const most = Math.max(whole(f.min) ?? Infinity, whole(f.max) ?? Infinity) + f.fractionDigits;
    if (most <= (f.totalDigits ?? 0)) return no(`every number within the bounds has at most ${most} digits`);
  }
  if (facet === 'fractionDigits') {
    if (integral(f) && f.fractionDigits !== 0) return no(`xs:${f.builtin} has no fraction digits`);
    if (f.totalDigits !== undefined && f.totalDigits <= (f.fractionDigits ?? 0)) {
      return no('more fraction digits than allowed are more total digits than allowed');
    }
  }
  if (also && !LENGTHS.has(facet)) {
    // The value keeps the length facets of both types, measured alike where the types are the same.
    const g = also.facets;
    const span = (x: Facets) => ({ min: x.length ?? x.minLength ?? 0, max: x.length ?? x.maxLength ?? Infinity });
    if (f.builtin === g.builtin && f.variety === g.variety) {
      const a = span(f);
      const b = span(g);
      if (Math.max(a.min, b.min) > Math.min(a.max, b.max)) {
        return no('the lengths of facets and mustSatisfy leave no value');
      }
    }
  }
  return undefined;
}

/** Why every string is a valid value of the type, or undefined. */
function everyString(f: Facets): string | undefined {
  /** No facet of its own, so that any token is a value. */
  const open = (x: Facets) =>
    x.variety === 'atomic' &&
    FREE_TEXT.has(x.builtin) &&
    x.patterns.length === 0 &&
    x.enumeration === undefined &&
    x.length === undefined &&
    x.minLength === undefined &&
    x.maxLength === undefined;
  if (f.variety === 'atomic') return FREE_TEXT.has(f.builtin) ? `every string is a valid xs:${f.builtin}` : undefined;
  if (f.variety === 'list') {
    return builtinFacets(f.builtin).minLength === undefined && f.item && open(f.item)
      ? 'every list of strings is valid'
      : undefined;
  }
  return (f.members ?? []).some((m) => open(m) || (m.variety === 'list' && everyString(m) !== undefined))
    ? 'a member of the union accepts every string'
    : undefined;
}

/** Why bounds of the type or of an item or member cannot be compared, or undefined. */
function unorderedBounds(f: Facets): string | undefined {
  if (f.variety === 'atomic' && f.otherBounds && f.otherBounds.length > 0) {
    if (!ORDERED_DATES.has(f.builtin)) {
      return `bounds of xs:${f.builtin} are not compared, so no value can be shown to keep or break them`;
    }
    const unread = f.otherBounds.find((b) => momentOf(f.builtin, b.lexical) === undefined);
    if (unread) return `the bound ${unread.lexical} is not a value of xs:${f.builtin}`;
    return undefined;
  }
  if (f.unsupportedBounds && !f.otherBounds?.length) return `bounds of xs:${f.builtin} are not supported`;
  return (
    (f.item ? unorderedBounds(f.item) : undefined) ??
    (f.members ?? []).map(unorderedBounds).find((reason) => reason !== undefined)
  );
}

/** Types whose values have more than one spelling: `1` and `true`, `5` and `+5`. */
const SPELLINGS = (f: Facets): boolean =>
  f.variety === 'atomic'
    ? f.builtin === 'boolean' ||
      isNumeric(f.builtin) ||
      BINARY.has(f.builtin) ||
      ORDERED_DATES.has(f.builtin) ||
      f.builtin === 'duration'
    : f.variety === 'list'
      ? f.item !== undefined && SPELLINGS(f.item)
      : true;

/** Common alternative lexical representations of the same value. */
function spellings(f: Facets, v: string): string[] {
  const out = new Set([v]);
  if (f.variety !== 'atomic') return [...out];
  if (f.builtin === 'boolean') {
    out.add(({ true: '1', '1': 'true', false: '0', '0': 'false' } as Record<string, string>)[v] ?? v);
  } else if (isNumeric(f.builtin) && /^[+-]?\d/.test(v)) {
    const unsigned = v.replace(/^\+/, '');
    const sign = unsigned.startsWith('-') ? '-' : '';
    const digits = unsigned.replace(/^-/, '');
    out.add(unsigned);
    if (!sign) out.add(`+${digits}`);
    out.add(`${sign}0${digits}`);
    if (!integral(f)) out.add(digits.includes('.') ? `${unsigned}0` : `${unsigned}.0`);
  } else if (f.builtin === 'hexBinary') {
    out.add(v.toLowerCase());
    out.add(v.toUpperCase());
  } else if (ORDERED_DATES.has(f.builtin)) {
    if (v.endsWith('Z')) out.add(`${v.slice(0, -1)}+00:00`);
    if (/[+-]00:00$/.test(v)) out.add(`${v.slice(0, -6)}Z`);
  }
  return [...out];
}

/**
 * The values to try where a fixed value or an enumeration leaves only a few: the fixed value of the declaration or
 * of `also`, or the values of an enumeration, each in its other spellings. `complete` says whether these are all the
 * values that can qualify: other spellings matter only to a pattern of a type that has them.
 */
function finite(
  spec: ValueSpec,
  facet: Broken,
  also?: ValueSpec,
): { values: string[]; reason: string; complete: boolean } | undefined {
  const f = spec.facets;
  const g = also?.facets;
  let source: { facets: Facets; values: readonly string[]; reason: string } | undefined;
  if (spec.fixed !== undefined && facet !== 'fixed') {
    source = { facets: f, values: [spec.fixed], reason: 'a fixed value admits no other value, and it breaks nothing' };
  } else if (f.enumeration !== undefined && facet !== 'enumeration') {
    source = {
      facets: f,
      values: f.enumeration,
      reason:
        facet === 'fixed'
          ? 'the enumeration allows only the fixed value'
          : `every value outside the enumeration breaks it as well, and none inside breaks only ${facet}`,
    };
  } else if (also && g && (also.fixed !== undefined || g.enumeration !== undefined)) {
    source = {
      facets: g,
      values: also.fixed !== undefined ? [also.fixed] : (g.enumeration ?? []),
      reason: `no value that mustSatisfy admits breaks only ${facet}`,
    };
  }
  if (!source) return undefined;
  const from = source.facets;
  const values = [...new Set(source.values.flatMap((v) => spellings(from, normalizeSpace(from, v))))];
  const patterned = f.patterns.length > 0 || (g?.patterns.length ?? 0) > 0;
  return {
    values,
    reason: source.reason,
    complete: !(patterned && (SPELLINGS(f) || (g !== undefined && SPELLINGS(g)))),
  };
}

/** Whether a bound is the limit of the built-in type itself, so that only values outside the type break it. */
function beyondType(f: Facets, facet: Broken): boolean {
  const lower = facet === 'minInclusive' || facet === 'minExclusive';
  if (!lower && facet !== 'maxInclusive' && facet !== 'maxExclusive') return false;
  const own = lower ? f.min : f.max;
  const limit = lower ? builtinFacets(f.builtin).min : builtinFacets(f.builtin).max;
  if (!own || !limit || own.exclusive !== facet.endsWith('Exclusive')) return false;
  const order = compareDecimal(own.lexical ?? String(own.value), limit.lexical ?? String(limit.value)) ?? 0;
  return lower ? (own.exclusive ? order < 0 : order <= 0) : own.exclusive ? order > 0 : order >= 0;
}

function present(f: Facets, facet: Broken): boolean {
  switch (facet) {
    case 'length':
      return f.length !== undefined;
    case 'minLength':
      return f.minLength !== undefined && !isImplicitMinLength(f);
    case 'maxLength':
      return f.maxLength !== undefined;
    case 'pattern':
      return f.patterns.length > 0;
    case 'enumeration':
      return f.enumeration !== undefined;
    case 'totalDigits':
      return f.totalDigits !== undefined && f.variety === 'atomic';
    case 'fractionDigits':
      return f.fractionDigits !== undefined && f.variety === 'atomic';
    case 'minInclusive':
    case 'minExclusive': {
      if (f.otherBounds) return f.otherBounds.some((b) => b.facet === facet);
      const min = declaredBounds(f).min;
      return min !== undefined && min.exclusive === (facet === 'minExclusive');
    }
    case 'maxInclusive':
    case 'maxExclusive': {
      if (f.otherBounds) return f.otherBounds.some((b) => b.facet === facet);
      const max = declaredBounds(f).max;
      return max !== undefined && max.exclusive === (facet === 'maxExclusive');
    }
    default:
      return true;
  }
}

/** Whether every value of the type is an integer. */
const integral = (f: Facets) =>
  INTEGERS[f.builtin] !== undefined || (f.builtin === 'decimal' && f.fractionDigits === 0);

/** The lengths a value matching all pattern steps can have, or undefined without patterns or for a pattern not read. */
export function patternLengths(steps: readonly (readonly string[])[]): { min: number; max: number } | undefined {
  if (steps.length === 0) return undefined;
  let min = 0;
  let max = Infinity;
  for (const step of steps) {
    let stepMin = Infinity;
    let stepMax = 0;
    for (const pattern of step) {
      let node: RegexNode;
      try {
        node = parsePattern(pattern);
      } catch {
        return undefined;
      }
      const range = nodeLengths(node);
      stepMin = Math.min(stepMin, range.min);
      stepMax = Math.max(stepMax, range.max);
    }
    min = Math.max(min, stepMin);
    max = Math.min(max, stepMax);
  }
  return { min, max };
}

function nodeLengths(node: RegexNode): { min: number; max: number } {
  switch (node.kind) {
    case 'char':
      return { min: [...node.value].length, max: [...node.value].length };
    case 'set':
      return { min: 1, max: 1 };
    case 'sequence':
      return node.items
        .map(nodeLengths)
        .reduce((a, b) => ({ min: a.min + b.min, max: a.max + b.max }), { min: 0, max: 0 });
    case 'alternation': {
      const ranges = node.options.map(nodeLengths);
      return { min: Math.min(...ranges.map((r) => r.min)), max: Math.max(...ranges.map((r) => r.max)) };
    }
    case 'repeat': {
      const item = nodeLengths(node.item);
      return { min: item.min * node.min, max: node.max === 0 || item.max === 0 ? 0 : item.max * node.max };
    }
  }
}

// --- constructing -----------------------------------------------------------------------------------------------

/** The facets without one of them, keeping what the built-in type itself demands. */
function without(f: Facets, facet: Broken): Facets {
  const out: Facets = { ...f, patterns: [...f.patterns] };
  const builtin = builtinFacets(f.builtin);
  switch (facet) {
    case 'length':
      delete out.length;
      break;
    case 'minLength':
      if (builtin.minLength === undefined) delete out.minLength;
      else out.minLength = builtin.minLength;
      break;
    case 'maxLength':
      delete out.maxLength;
      break;
    case 'pattern':
      out.patterns = [];
      break;
    case 'enumeration':
      delete out.enumeration;
      delete out.enumerationNode;
      break;
    case 'minInclusive':
    case 'minExclusive':
      if (builtin.min) out.min = builtin.min;
      else delete out.min;
      break;
    case 'maxInclusive':
    case 'maxExclusive':
      if (builtin.max) out.max = builtin.max;
      else delete out.max;
      break;
    case 'totalDigits':
      delete out.totalDigits;
      break;
    case 'fractionDigits':
      delete out.fractionDigits;
      break;
    default:
      break;
  }
  return out;
}

/** How deep a built-in string type lies in the derivation from xs:string. */
const STRING_DEPTH: Readonly<Record<string, number>> = {
  string: 0,
  normalizedString: 1,
  token: 2,
  language: 3,
  Name: 3,
  NMTOKEN: 3,
  NCName: 4,
  ID: 5,
  IDREF: 5,
  ENTITY: 5,
};

/** Facet-compatible type families: strings, and numeric types except float and double. */
const family = (builtin: string): string =>
  isNumeric(builtin) && builtin !== 'float' && builtin !== 'double'
    ? 'decimal'
    : STRING_DEPTH[builtin] !== undefined
      ? 'string'
      : builtin;

/**
 * Intersects facets for lists or types in the same family, such as int/integer or token/string.
 * Returns the target facets for incompatible families, or undefined when the intersection is empty.
 */
function steered(f: Facets, also: ValueSpec | undefined): Facets | undefined {
  const g = also?.facets;
  if (!g || g.variety !== f.variety || f.variety === 'union') return f;
  if (f.variety === 'atomic' && family(f.builtin) !== family(g.builtin)) return f;
  if (f.length !== undefined && g.length !== undefined && f.length !== g.length) return undefined;
  const out: Facets = { ...f, patterns: [...f.patterns, ...g.patterns] };
  if (f.variety === 'list') {
    const item = f.item && g.item ? steered(f.item, { facets: g.item }) : f.item;
    if (item) out.item = item;
  } else if (family(f.builtin) === 'decimal') {
    // The narrower built-in range and an integer type's lack of fraction digits carry over.
    const own = builtinFacets(g.builtin);
    if (own.min) out.min = tighter(out.min, own.min, true);
    if (own.max) out.max = tighter(out.max, own.max, false);
    if (INTEGERS[g.builtin] !== undefined) out.fractionDigits = 0;
  } else if ((STRING_DEPTH[g.builtin] ?? 0) > (STRING_DEPTH[f.builtin] ?? 0)) {
    out.builtin = g.builtin;
  }
  const length = f.length ?? g.length;
  if (length !== undefined) out.length = length;
  const minLength = Math.max(f.minLength ?? 0, g.minLength ?? 0);
  if (minLength > 0 || f.minLength !== undefined || g.minLength !== undefined) out.minLength = minLength;
  const maxLength = Math.min(f.maxLength ?? Infinity, g.maxLength ?? Infinity);
  if (maxLength !== Infinity) out.maxLength = maxLength;
  if (g.min) out.min = tighter(out.min, g.min, true);
  if (g.max) out.max = tighter(out.max, g.max, false);
  if (g.otherBounds) out.otherBounds = [...(f.otherBounds ?? []), ...g.otherBounds];
  for (const name of ['totalDigits', 'fractionDigits'] as const) {
    const value = Math.min(out[name] ?? Infinity, g[name] ?? Infinity);
    if (value !== Infinity) out[name] = value;
  }
  if (g.enumeration) {
    out.enumeration = f.enumeration ? f.enumeration.filter((e) => g.enumeration?.includes(e)) : [...g.enumeration];
  }
  return out;
}

/** Whether a type, its item or a member has bounds of a date or time type. */
const dated = (f: Facets): boolean =>
  (f.otherBounds?.length ?? 0) > 0 || (f.item !== undefined && dated(f.item)) || (f.members ?? []).some(dated);

/**
 * Generates a candidate, including supported date/time bounds that ordinary generation leaves to validation.
 * INF and -INF bounds do not restrict finite candidates.
 */
function valueOf(f: Facets | undefined, rng: Rng): string | undefined {
  if (!f) return undefined;
  if (!dated(f)) {
    if ((!f.min || Number.isFinite(f.min.value)) && (!f.max || Number.isFinite(f.max.value))) {
      return generateValue(f, rng);
    }
    const finiteBounds: Facets = { ...f };
    if (f.min && !Number.isFinite(f.min.value)) delete finiteBounds.min;
    if (f.max && !Number.isFinite(f.max.value)) delete finiteBounds.max;
    return generateValue(finiteBounds, rng);
  }
  const free = f.patterns.length === 0 && f.enumeration === undefined;
  if (f.variety === 'atomic' && free) {
    const moment = (lower: boolean): Moment | undefined => {
      const bound = (f.otherBounds ?? []).find((b) => b.facet.startsWith(lower ? 'min' : 'max'));
      const at = bound && momentOf(f.builtin, bound.lexical);
      return at && bound.facet.endsWith('Exclusive') ? momentBeside(f.builtin, at, lower ? 1 : -1, 1) : at;
    };
    return formatMoment(f.builtin, momentBetween(f.builtin, moment(true), moment(false), rng));
  }
  if (f.variety === 'list' && free && f.item) {
    const low = Math.max(f.length ?? f.minLength ?? 1, builtinFacets(f.builtin).minLength ?? 0);
    const count = f.length ?? rng.int(low, Math.max(low, Math.min(f.maxLength ?? low + 3, low + 3)));
    return list(f, count, rng);
  }
  if (f.variety === 'union' && free && f.members && f.members.length > 0) return valueOf(rng.pick(f.members), rng);
  return generateValue(f, rng);
}

const generated = (f: Facets | undefined, rng: Rng) => valueOf(f, rng);

function candidate(spec: ValueSpec, facet: Broken, rng: Rng, also?: ValueSpec): string | undefined {
  const f = spec.facets;
  const relaxed = (changes: Partial<Facets> = {}) => steered({ ...without(f, facet), ...changes }, also);
  switch (facet) {
    case 'length': {
      const length = otherLength(f, rng);
      if (length === undefined) return undefined;
      return f.variety === 'list' ? list(steered(f, also) ?? f, length, rng) : generated(relaxed({ length }), rng);
    }
    case 'minLength': {
      const length = rng.int(0, (f.minLength ?? 1) - 1);
      return f.variety === 'list'
        ? list(steered(f, also) ?? f, length, rng)
        : generated(relaxed({ maxLength: (f.minLength ?? 1) - 1 }), rng);
    }
    case 'maxLength': {
      const length = (f.maxLength ?? 0) + 1 + (rng.chance(0.5) ? 0 : rng.int(1, 3));
      return f.variety === 'list'
        ? list(steered(f, also) ?? f, length, rng)
        : generated(relaxed({ minLength: (f.maxLength ?? 0) + 1 }), rng);
    }
    case 'pattern':
    case 'enumeration': {
      if (rng.chance(0.5)) return generated(relaxed(), rng);
      const valid = generated(steered(without(f, facet), also), rng);
      return valid === undefined ? undefined : edited(valid, rng);
    }
    case 'minInclusive':
    case 'minExclusive':
    case 'maxInclusive':
    case 'maxExclusive': {
      if (f.otherBounds) return dateBeyond(f, facet, rng);
      const lower = facet.startsWith('min');
      const bound = lower ? f.min : f.max;
      if (!bound) return undefined;
      // Beyond INF or -INF lies only the bound itself, for an exclusive bound.
      if (!Number.isFinite(bound.value)) return bound.exclusive ? bound.lexical : undefined;
      return lower
        ? generated(
            relaxed({ max: tighter(without(f, facet).max, { ...bound, exclusive: facet === 'minInclusive' }, false) }),
            rng,
          )
        : generated(
            relaxed({ min: tighter(without(f, facet).min, { ...bound, exclusive: facet === 'maxInclusive' }, true) }),
            rng,
          );
    }
    case 'totalDigits':
      return digitsCandidate(f, relaxed() ?? f, rng, (f.totalDigits ?? 0) + rng.int(1, 2), undefined);
    case 'fractionDigits':
      return digitsCandidate(f, relaxed() ?? f, rng, undefined, (f.fractionDigits ?? 0) + rng.int(1, 2));
    case 'lexical':
      return lexicalCandidate(steered(f, also) ?? f, rng);
    case 'fixed':
      return generated(steered(f, also), rng);
    default:
      return undefined;
  }
}

/** A length other than `length` that the pattern of a string can still give: any of them, the near ones first. */
function otherLength(f: Facets, rng: Rng): number | undefined {
  const target = f.length ?? 0;
  const range = f.variety === 'atomic' && !BINARY.has(f.builtin) ? patternLengths(f.patterns) : undefined;
  const low = range?.min ?? 0;
  const high = range?.max ?? Infinity;
  const near = [target - 1, target + 1].filter((n) => n >= low && n <= high && n >= 0);
  if (near.length > 0 && rng.chance(0.7)) return rng.pick(near);
  const options = [low, Number.isFinite(high) ? high : target + 1 + rng.int(0, 3), ...near].filter(
    (n) => n !== target && n >= low && n <= high && n >= 0,
  );
  return options.length > 0 ? rng.pick(options) : undefined;
}

/** A value of a date or time type beyond one of its bounds, as near as one step or farther. */
function dateBeyond(f: Facets, facet: Broken, rng: Rng): string | undefined {
  const bounds = (f.otherBounds ?? []).filter((b: OtherBound) => b.facet === facet);
  if (bounds.length === 0) return undefined;
  const bound = rng.pick(bounds);
  const at = momentOf(f.builtin, bound.lexical);
  if (!at) return undefined;
  const steps = facet.endsWith('Exclusive') && rng.chance(0.3) ? 0 : rng.chance(0.5) ? 1 : rng.int(2, 400);
  return formatMoment(f.builtin, momentBeside(f.builtin, at, facet.startsWith('min') ? -1 : 1, steps));
}

/** A list of `count` items that meet the item type. */
function list(f: Facets, count: number, rng: Rng): string | undefined {
  const items: string[] = [];
  for (let k = 0; k < count; k += 1) {
    const item = f.item ? valueOf(f.item, rng) : 'item';
    if (item === undefined || /\s/.test(item)) return undefined;
    items.push(item);
  }
  return items.join(' ');
}

/** A valid value with one character replaced, inserted or removed. */
function edited(value: string, rng: Rng): string {
  const chars = [...value];
  // ASCII, Latin, other scripts and a space, so that one of them lies outside the characters a pattern allows. No
  // line break: libxml2 would split its message about the value over two lines.
  const odd = rng.pick(['#', '~', 'Z', 'z', '0', '-', '_', '.', ' ', 'é', 'Ж', 'א', '中', '☃']);
  const at = rng.int(0, chars.length);
  const how = chars.length === 0 ? 0 : rng.int(0, 2);
  if (how === 0) chars.splice(at, 0, odd);
  else if (how === 1) chars.splice(Math.min(at, chars.length - 1), 1, odd);
  else chars.splice(Math.min(at, chars.length - 1), 1);
  return chars.join('');
}

/** A random integer from `low` to `high`, also beyond the safe integers. */
function between(low: bigint, high: bigint, rng: Rng): bigint {
  const safe = BigInt(Number.MAX_SAFE_INTEGER);
  if (low >= -safe && high <= safe && high - low <= safe) return BigInt(rng.int(Number(low), Number(high)));
  return low + (BigInt(Math.floor(rng.next() * 4294967296)) * (high - low + 1n)) / 4294967296n;
}

/**
 * A number with that many digits in all (`total`) or after the point (`fraction`), and within the bounds of `range`:
 * the sign and the digits before the point follow the bounds, so that `minInclusive="999"` gets `999.123`. The digit
 * limits of `f` are the ones the number breaks or keeps.
 */
function digitsCandidate(
  f: Facets,
  range: Facets,
  rng: Rng,
  total: number | undefined,
  fraction: number | undefined,
): string | undefined {
  const integer = integral(f) || integral(range);
  // More fraction digits than totalDigits allows would break totalDigits as well: the fraction stays within it.
  let fractionDigits: number;
  if (fraction !== undefined) {
    fractionDigits = Math.min(fraction, f.totalDigits ?? fraction);
    if (integer || fractionDigits <= (f.fractionDigits ?? 0)) return undefined;
  } else {
    fractionDigits = integer ? 0 : rng.int(0, Math.min(total ?? 0, f.fractionDigits ?? total ?? 0));
  }
  const scale = BigInt(fractionDigits);
  const unit = (b: Bound | undefined, lower: boolean) =>
    b && Number.isFinite(b.value)
      ? boundUnits(b.lexical ?? String(b.value), fractionDigits, lower, b.exclusive)
      : undefined;
  const low = unit(range.min, true);
  const high = unit(range.max, false);
  if (
    (range.min && Number.isFinite(range.min.value) && low === undefined) ||
    (range.max && Number.isFinite(range.max.value) && high === undefined)
  ) {
    return undefined;
  }
  const signs = [...(high === undefined || high > 0n ? [1] : []), ...(low === undefined || low < 0n ? [-1] : [])];
  if (signs.length === 0) return undefined;
  const sign = signs.length === 2 ? (rng.chance(0.3) ? -1 : 1) : (signs[0] as number);
  // The magnitude in units of 10^-fractionDigits.
  const from = sign > 0 ? (low === undefined || low < 0n ? 0n : low) : high === undefined || high > 0n ? 0n : -high;
  const to = sign > 0 ? high : low === undefined ? undefined : -low;
  const digitsOf = (units: bigint) => (units / 10n ** scale === 0n ? 0 : String(units / 10n ** scale).length);
  let whole: number;
  if (total !== undefined) {
    whole = total - fractionDigits;
  } else {
    const fewest = digitsOf(from);
    const most = Math.min(
      to === undefined ? fewest + 3 : digitsOf(to),
      fewest + 3,
      (f.totalDigits ?? Infinity) - fractionDigits,
    );
    if (most < fewest) return undefined;
    whole = rng.int(fewest, most);
  }
  if (whole < 0 || (whole === 0 && fractionDigits === 0)) return undefined;
  // Exactly `whole` digits before the point, and a first fraction digit that counts where there are none.
  let a = whole === 0 ? 10n ** (scale - 1n) : 10n ** (BigInt(whole - 1) + scale);
  let b = 10n ** (BigInt(whole) + scale) - 1n;
  if (from > a) a = from;
  if (to !== undefined && to < b) b = to;
  if (a > b) return undefined;
  let units = between(a, b, rng);
  // The last fraction digit is not 0, so that it counts.
  if (fractionDigits > 0 && units % 10n === 0n) units = units + 1n <= b ? units + 1n : units - 1n;
  if (units < a || (fractionDigits > 0 && units % 10n === 0n)) return undefined;
  const digits = String(units).padStart(fractionDigits + 1, '0');
  const body = fractionDigits === 0 ? digits : `${digits.slice(0, -fractionDigits)}.${digits.slice(-fractionDigits)}`;
  return `${sign < 0 ? '-' : ''}${body}`;
}

const INVALID: Readonly<Record<string, readonly string[]>> = {
  boolean: ['yes', 'TRUE', '2'],
  decimal: ['1.2.3', 'abc', '1e5', '--1'],
  // libxml2 accepts an exponent without digits, such as 1e, which XML Schema does not allow
  float: ['1.2.3', 'abc', 'inf', '+INF'],
  double: ['1.2.3', 'abc', 'inf', '+INF'],
  date: ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1'],
  dateTime: ['2026-02-30T10:00:00', '2026-01-01 10:00:00', '2026-01-01T25:00:00'],
  time: ['25:00:00', '10:61:00', '10:00'],
  duration: ['P1', '1D', 'PT', 'P-1D'],
  gYear: ['26', '2026-', 'year'],
  gYearMonth: ['2026-13', '2026', '2026-1'],
  gMonth: ['--13', '13', '--1'],
  gMonthDay: ['--02-30', '--13-01', '02-01'],
  gDay: ['---32', '--01', '---1'],
  hexBinary: ['ABC', 'GG', '0x0A'],
  base64Binary: ['A', 'A===', 'AB=C'],
  Name: ['1a', 'a b', '-a'],
  NCName: ['1a', 'a:b', 'a b'],
  ID: ['1a', 'a:b', 'a b'],
  IDREF: ['1a', 'a:b', 'a b'],
  ENTITY: ['1a', 'a:b', 'a b'],
  NMTOKEN: ['a b', 'a,b', 'a;b'],
  language: ['x_1', 'abcdefghi', 'de-'],
};

function lexicalCandidate(f: Facets, rng: Rng): string | undefined {
  if (f.variety === 'list') {
    const valid = list(f, Math.max(f.length ?? f.minLength ?? 1, 1), rng);
    const item = f.item && violatingValue({ facets: f.item }, 'value:lexical', rng);
    if (valid === undefined || item?.status !== 'constructed' || /\s/.test(item.value)) return undefined;
    const items = valid.split(' ');
    items[rng.int(0, items.length - 1)] = item.value;
    return items.join(' ');
  }
  // A string the pattern gives may lie outside the lexical space, such as a date with month 13. Not for binary
  // types: libxml2 skips the characters outside the alphabet of base64Binary, so that `12-34` passes as `1234`.
  if (f.patterns.length > 0 && !BINARY.has(f.builtin) && rng.chance(0.5)) {
    try {
      return stringFromPattern(rng.pick(rng.pick(f.patterns)), rng, { maxExtraRepeats: 3 });
    } catch {
      return undefined;
    }
  }
  // One to three letters of the base64 alphabet among other characters, which libxml2 does not take for one.
  if (f.variety === 'union') return rng.pick(['§ A', 'x y §', 'A§', '? A']);
  const range = INTEGERS[f.builtin];
  const integerCases = INTEGERS[f.builtin] === undefined ? [] : ['1.5', 'abc', '1e3', ...outside(f.builtin, range)];
  const cases = [...(INVALID[f.builtin] ?? []), ...integerCases];
  return cases.length > 0 ? rng.pick(cases) : undefined;
}

/** The integers just outside the range of a built-in integer type. */
function outside(builtin: string, range: { min?: number; max?: number } | undefined): string[] {
  const facets = builtinFacets(builtin);
  const out: string[] = [];
  if (facets.min) out.push(String(BigInt(facets.min.lexical ?? String(range?.min ?? 0)) - 1n));
  if (facets.max) out.push(String(BigInt(facets.max.lexical ?? String(range?.max ?? 0)) + 1n));
  return out;
}
