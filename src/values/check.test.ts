import { describe, expect, it } from 'vitest';
import type { Facets } from '../xsd/facets.js';
import { checkValue, digitCounts } from './check.js';

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
    [
      'union',
      { builtin: 'anySimpleType', variety: 'union', patterns: [], members: [atomic('date'), atomic('boolean')] },
      'maybe',
    ],
  ])('rejects an invalid value (%s)', (_, facets, value) => {
    expect(checkValue(facets, value)).toEqual(expect.any(String));
  });
});
