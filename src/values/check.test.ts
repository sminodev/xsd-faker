import { describe, expect, it } from 'vitest';
import type { Facets } from '../xsd/facets.js';
import {
  binaryKind,
  checkValue,
  digitCounts,
  PATTERN_CACHE_LIMIT,
  patternCacheSize,
  patternRegExp,
  settledValue,
} from './check.js';

const atomic = (builtin: string, extra: Partial<Facets> = {}): Facets => ({
  builtin,
  variety: 'atomic',
  patterns: [],
  ...extra,
});

describe('digitCounts', () => {
  it.each([
    ['123.45', 5, 2],
    ['-0.050', 2, 2],
    ['007', 1, 0],
    ['0', 1, 0],
    ['1200', 4, 0],
  ])('%s has %i digits, %i after the point', (lexical, total, fraction) => {
    expect(digitCounts(lexical)).toEqual({ total, fraction });
  });
});

describe('checkValue', () => {
  it.each<[string, Facets, string]>([
    ['enumeration', atomic('string', { enumeration: ['A', 'B'] }), 'A'],
    ['pattern', atomic('string', { patterns: [['[A-Z]\\d{2}']] }), 'K42'],
    ['patterns of two steps', atomic('string', { patterns: [['\\d+'], ['.{3}']] }), '123'],
    ['length', atomic('string', { minLength: 2, maxLength: 4 }), 'abc'],
    [
      'integer in range',
      atomic('int', { min: { value: 1, exclusive: false }, max: { value: 99, exclusive: false } }),
      '99',
    ],
    ['decimal digits', atomic('decimal', { totalDigits: 5, fractionDigits: 2 }), '123.45'],
    ['date', atomic('date'), '2024-02-29'],
    ['dateTime', atomic('dateTime'), '2026-11-09T21:30:00'],
    ['hexBinary length in octets', atomic('hexBinary', { length: 2 }), '0AFF'],
    ['boolean', atomic('boolean'), '1'],
    ['list', { builtin: 'string', variety: 'list', patterns: [], item: atomic('int'), maxLength: 3 }, '1 2 3'],
    [
      'list with extra spaces',
      { builtin: 'string', variety: 'list', patterns: [['\\d( \\d)*']], item: atomic('int') },
      ' 1  2 ',
    ],
    ['anyURI', atomic('anyURI'), 'https://example.org/a?b=c#d'],
    ['anyURI with characters libxml2 replaces', atomic('anyURI'), 'a b<c>'],
    [
      'union',
      { builtin: 'anySimpleType', variety: 'union', patterns: [], members: [atomic('date'), atomic('boolean')] },
      'true',
    ],
  ])('accepts a valid value (%s)', (_, facets, value) => {
    expect(checkValue(facets, value)).toBeUndefined();
  });

  it.each<[string, Facets, string]>([
    ['enumeration', atomic('string', { enumeration: ['A', 'B'] }), 'C'],
    ['pattern', atomic('string', { patterns: [['[A-Z]\\d{2}']] }), 'K4'],
    ['patterns of two steps', atomic('string', { patterns: [['\\d+'], ['.{3}']] }), '1234'],
    ['minLength', atomic('string', { minLength: 2 }), 'a'],
    ['maxLength', atomic('string', { maxLength: 2 }), 'abc'],
    ['exclusive bound', atomic('decimal', { min: { value: 0, exclusive: true } }), '0'],
    ['totalDigits', atomic('decimal', { totalDigits: 4 }), '12345'],
    ['fractionDigits', atomic('decimal', { fractionDigits: 1 }), '1.25'],
    ['integer lexical form', atomic('int'), '1e3'],
    ['date in February', atomic('date'), '2023-02-29'],
    ['list item', { builtin: 'string', variety: 'list', patterns: [], item: atomic('int') }, '1 x'],
    ['anyURI with a bracket', atomic('anyURI'), 'a]b'],
    ['anyURI with a broken escape', atomic('anyURI'), 'a%zz'],
    ['anyURI with two fragments', atomic('anyURI'), 'a#b#c'],
    ['anyURI with a colon in the first segment', atomic('anyURI'), '1a:b'],
    ['pattern after collapsing', atomic('token', { patterns: [['A {2}B']] }), 'A  B'],
    [
      'union',
      { builtin: 'anySimpleType', variety: 'union', patterns: [], members: [atomic('date'), atomic('boolean')] },
      'maybe',
    ],
  ])('rejects an invalid value (%s)', (_, facets, value) => {
    expect(checkValue(facets, value)).toEqual(expect.any(String));
  });
});

describe('name characters of XML 1.0, Second Edition', () => {
  it.each<[string, boolean]>([
    ['ä', true],
    ['aą', true],
    ['aŀ', false],
    ['á', true],
    ['a١', true],
    ['ǅa', false],
    ['Ⅻ', false],
    ['١a', false],
    ['́a', false],
    ['Ĳ', false],
    ['a\u{10000}', false],
  ])('NCName %s: %s', (value, valid) => {
    expect(checkValue(atomic('NCName'), value) === undefined).toBe(valid);
    expect(checkValue(atomic('string', { patterns: [['\\i\\c*']] }), value) === undefined).toBe(valid);
  });

  it('keeps \\d independent of the name tables', () => {
    expect(checkValue(atomic('string', { patterns: [['\\d{3}']] }), '١٢٣')).toBeUndefined();
  });
});

describe('the value a validator reads', () => {
  const union = (...members: Facets[]): Facets => ({
    builtin: 'anySimpleType',
    variety: 'union',
    patterns: [],
    members,
  });

  it('normalizes whitespace by the type, and a union by its first accepting member', () => {
    expect(settledValue(atomic('integer'), '   123   ')).toBe('123');
    expect(settledValue(atomic('string'), ' a  b ')).toBe(' a  b ');
    expect(settledValue(union(atomic('gYearMonth'), atomic('language'), atomic('normalizedString')), 'ENU ')).toBe(
      'ENU',
    );
    expect(settledValue(union(atomic('normalizedString'), atomic('token')), 'a\tb ')).toBe('a b ');
  });

  it('tells float and double values by the type, the accepting member and all list items', () => {
    expect(binaryKind(atomic('double'), '1')).toBe('double');
    expect(binaryKind(atomic('float'), '1')).toBe('float');
    expect(binaryKind(atomic('decimal'), '1')).toBeUndefined();
    expect(binaryKind(union(atomic('decimal'), atomic('double')), '1.5')).toBeUndefined();
    expect(binaryKind(union(atomic('decimal'), atomic('double')), '1E3')).toBe('double');
    const list = (item: Facets): Facets => ({ builtin: 'anySimpleType', variety: 'list', patterns: [], item });
    expect(binaryKind(list(atomic('float')), '1 2')).toBe('float');
    expect(binaryKind(list(union(atomic('decimal'), atomic('double'))), '1 1E3')).toBeUndefined();
  });

  it('refuses the prefix xmlns in a QName, which no document can bind', () => {
    expect(checkValue(atomic('QName'), 'xmlns:a')).toEqual(expect.any(String));
    expect(checkValue(atomic('QName'), 'xml:lang')).toBeUndefined();
  });
});

describe('INF, -INF and NaN against bounds (XML Schema 1.0)', () => {
  it('excludes NaN by any bound, INF by an upper and -INF by a lower one', () => {
    const nonNegative = atomic('double', { min: { value: 0, lexical: '0', exclusive: false } });
    expect(checkValue(nonNegative, 'NaN')).toEqual(expect.any(String));
    expect(checkValue(nonNegative, '-INF')).toEqual(expect.any(String));
    expect(checkValue(nonNegative, 'INF')).toBeUndefined();
    expect(checkValue(atomic('float', { max: { value: 1, lexical: '1', exclusive: false } }), 'INF')).toEqual(
      expect.any(String),
    );
    expect(checkValue(atomic('double'), 'NaN')).toBeUndefined();
    expect(checkValue(atomic('double'), '+INF')).toEqual(expect.any(String));
    expect(checkValue(atomic('decimal'), 'INF')).toEqual(expect.any(String));
  });
});

describe('XML white space only', () => {
  it('collapses #x20, #x9, #xA and #xD, never U+00A0 or U+2003', () => {
    expect(settledValue(atomic('token'), '\u00a0A\u00a0')).toBe('\u00a0A\u00a0');
    expect(settledValue(atomic('token'), '  x\u00a0 y\u2003 ')).toBe('x\u00a0 y\u2003');
    expect(settledValue(atomic('token'), '\t a \n b\r')).toBe('a b');
    const list: Facets = { builtin: 'anySimpleType', variety: 'list', patterns: [], item: atomic('token'), length: 2 };
    expect(checkValue(list, 'a\u00a0b c')).toBeUndefined();
    expect(checkValue(atomic('integer'), '\u00a01')).toEqual(expect.any(String));
  });
});

describe('the cache of compiled patterns', () => {
  it('keeps at most its limit across many schemas, and gives the same expression for a pattern used again', () => {
    const first = patternRegExp([['[A-Z]{2}0']]);
    for (let n = 0; n < PATTERN_CACHE_LIMIT * 2; n += 1) patternRegExp([[`[A-Z]{2}${n}`]]);
    expect(patternCacheSize()).toBe(PATTERN_CACHE_LIMIT);
    const again = patternRegExp([['[A-Z]{2}0']]);
    expect(again.source).toBe(first.source);
    expect(['AB0', 'AB', 'ab0'].map((v) => again.test(v))).toEqual([true, false, false]);
    // Reusing an entry protects it from eviction; the least recently used entry is removed first.
    for (let n = 0; n < PATTERN_CACHE_LIMIT - 1; n += 1) patternRegExp([[`x${n}`]]);
    expect(patternRegExp([['[A-Z]{2}0']])).toBe(again);
  });
});
