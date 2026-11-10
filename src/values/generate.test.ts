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
];

describe('generateValue', () => {
  it.each(CASES)('produces valid values (%s)', (_, facets) => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const value = generateValue(facets, createRng(seed));
      expect(value, `seed ${seed}`).toBeDefined();
      expect(checkValue(facets, value as string), `seed ${seed}: ${value}`).toBeUndefined();
    }
  });

  it('is deterministic for a seed', () => {
    const facets = atomic('decimal', { totalDigits: 6, fractionDigits: 2 });
    expect(generateValue(facets, createRng(3))).toBe(generateValue(facets, createRng(3)));
  });

  it('gives up on facets no value can meet', () => {
    expect(generateValue(atomic('int', { min: bound(5), max: bound(4) }), createRng(1))).toBeUndefined();
    expect(generateValue(atomic('string', { patterns: [['\\d{3}']], maxLength: 2 }), createRng(1))).toBeUndefined();
  });
});

describe('numberCandidate', () => {
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
