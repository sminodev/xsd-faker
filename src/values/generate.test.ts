import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import type { Facets } from '../xsd/facets.js';
import { checkValue } from './check.js';
import { formatScaled, generateValue, numberCandidate } from './generate.js';

const atomic = (builtin: string, extra: Partial<Facets> = {}): Facets => ({
  builtin,
  variety: 'atomic',
  patterns: [],
  ...extra,
});
const bound = (value: number, exclusive = false) => ({ value, exclusive });
const decimal = (lexical: string, exclusive = false) => ({ value: Number(lexical), lexical, exclusive });

const CASES: [string, Facets][] = [
  ['string', atomic('string')],
  ['string with lengths', atomic('string', { minLength: 3, maxLength: 5 })],
  ['string with exact length', atomic('token', { length: 9 })],
  ['pattern', atomic('string', { patterns: [['[A-Z][0-9]{9}']] })],
  ['pattern and length', atomic('string', { patterns: [['\\d{1,12}']], minLength: 4, maxLength: 6 })],
  ['patterns of two steps', atomic('string', { patterns: [['[0-9]+'], ['.{4}']] })],
  ['enumeration', atomic('token', { enumeration: ['web', 'phone', 'mail'] })],
  ['integer', atomic('integer')],
  ['bounded integer', atomic('int', { min: bound(1), max: bound(99) })],
  ['unsigned byte', atomic('unsignedByte')],
  ['decimal with digits', atomic('decimal', { totalDigits: 6, fractionDigits: 2 })],
  ['decimal exclusive bounds', atomic('decimal', { min: bound(0, true), max: bound(1, true), fractionDigits: 2 })],
  ['decimal fractionDigits 0', atomic('decimal', { fractionDigits: 0, max: bound(5) })],
  ['negative range', atomic('decimal', { min: bound(-10), max: bound(-9.5), fractionDigits: 1 })],
  ['boolean', atomic('boolean')],
  ['date', atomic('date')],
  ['dateTime', atomic('dateTime')],
  ['time', atomic('time')],
  ['gYear with pattern', atomic('gYear', { patterns: [['(19|20)\\d{2}']] })],
  ['gYearMonth', atomic('gYearMonth')],
  ['duration', atomic('duration')],
  ['hexBinary', atomic('hexBinary', { length: 4 })],
  ['base64Binary', atomic('base64Binary', { maxLength: 6 })],
  ['anyURI', atomic('anyURI')],
  ['language', atomic('language')],
  ['NCName', atomic('NCName')],
  ['list', { builtin: 'string', variety: 'list', patterns: [], item: atomic('int', { min: bound(0), max: bound(9) }) }],
  ['union', { builtin: 'anySimpleType', variety: 'union', patterns: [], members: [atomic('date'), atomic('boolean')] }],
  [
    'pattern on a union',
    {
      builtin: 'anySimpleType',
      variety: 'union',
      patterns: [['[A-Z]{3}']],
      members: [atomic('string'), atomic('integer')],
    },
  ],
  ['pattern on a list', { builtin: 'string', variety: 'list', patterns: [['[0-9 ]{5}']], item: atomic('int') }],
  ['pattern on a duration', atomic('duration', { patterns: [['.+']] })],
  ['pattern on a gDay', atomic('gDay', { patterns: [['.+']] })],
  ['pattern on an NCName', atomic('NCName', { patterns: [['.+']] })],
  ['anyURI with a pattern', atomic('anyURI', { patterns: [['.+']], length: 34 })],
  ['token with a pattern', atomic('token', { patterns: [['.+']] })],
  ['anyURI with maxLength', atomic('anyURI', { maxLength: 10 })],
  ['anyURI with minLength', atomic('anyURI', { minLength: 40 })],
  ['anyURI with length', atomic('anyURI', { length: 15 })],
  ['narrow decimal', atomic('decimal', { min: decimal('0.123'), max: decimal('0.124') })],
  ['very narrow decimal', atomic('decimal', { min: decimal('0.1234567'), max: decimal('0.1234568') })],
  ['exclusive decimal', atomic('decimal', { min: decimal('0.1', true), max: decimal('0.2', true) })],
];

describe('generateValue', () => {
  it.each(CASES)('produces valid values (%s)', (_, facets) => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const value = generateValue(facets, createRng(seed));
      expect(value, `seed ${seed}`).toBeDefined();
      expect(checkValue(facets, value as string), `seed ${seed}: ${value}`).toBeUndefined();
    }
  });

  it('writes a union value as the member that accepts it reads it', () => {
    const union: Facets = {
      builtin: 'anySimpleType',
      variety: 'union',
      patterns: [['[A-Z]{2} ?']],
      members: [atomic('NCName')],
    };
    for (let seed = 1; seed <= 50; seed += 1) {
      const value = generateValue(union, createRng(seed));
      expect(value, `seed ${seed}`).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('is deterministic for a seed', () => {
    const facets = atomic('decimal', { totalDigits: 6, fractionDigits: 2 });
    expect(generateValue(facets, createRng(3))).toBe(generateValue(facets, createRng(3)));
  });

  it('gives up on facets no value can meet', () => {
    expect(generateValue(atomic('int', { min: bound(5), max: bound(4) }), createRng(1))).toBeUndefined();
    expect(generateValue(atomic('string', { patterns: [['\\d{3}']], maxLength: 2 }), createRng(1))).toBeUndefined();
    const tooFewDigits = atomic('decimal', { min: decimal('0.123'), max: decimal('0.124'), fractionDigits: 2 });
    expect(generateValue(tooFewDigits, createRng(1))).toBeUndefined();
  });
});

describe('numberCandidate', () => {
  it('stays where a JSON number is exact when the bounds allow it', () => {
    const long = atomic('long', {
      min: decimal('-9223372036854775808'),
      max: decimal('9223372036854775807'),
    });
    const wide = atomic('decimal', { min: decimal('-1e30'), max: decimal('1e30') });
    for (let seed = 1; seed <= 200; seed += 1) {
      expect(Number.isSafeInteger(Number(numberCandidate(long, createRng(seed))))).toBe(true);
      const value = numberCandidate(wide, createRng(seed)) as string;
      expect(value.replace(/[-.]/g, '').replace(/^0+/, '').length).toBeLessThanOrEqual(15);
    }
  });

  it('leaves that range when the bounds demand it', () => {
    const huge = atomic('long', { min: decimal('9223372036854775806'), max: decimal('9223372036854775807') });
    expect(['9223372036854775806', '9223372036854775807']).toContain(numberCandidate(huge, createRng(1)));
  });

  it('stays within totalDigits for every scale', () => {
    const facets = atomic('decimal', { totalDigits: 3, fractionDigits: 2 });
    for (let seed = 1; seed <= 200; seed += 1) {
      const value = numberCandidate(facets, createRng(seed)) as string;
      expect(value.replace(/[-.]/g, '').replace(/^0+/, '').length).toBeLessThanOrEqual(3);
    }
  });
});

describe('formatScaled', () => {
  it.each([
    [12345, 2, '123.45'],
    [5, 2, '0.05'],
    [-5, 1, '-0.5'],
    [42, 0, '42'],
  ])('%i units at scale %i are %s', (units, scale, text) => {
    expect(formatScaled(units, scale)).toBe(text);
  });
});
