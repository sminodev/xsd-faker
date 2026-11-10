import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { combinePatterns, translateBody } from '../xsd/xsd-regex.js';
import { generateString, stringFromPattern, UngeneratableError } from './generate.js';
import { parsePattern } from './parse.js';

// Formats that occur in real schemas: identifiers, dates, times, versions, codes, UUIDs, e-mail addresses.
const PATTERNS = [
  '[0-9]{9}',
  '\\d{3}-\\d{4}',
  '[A-Z][0-9]{9}',
  '[A-Z]{1,3}',
  '(19|2[0-9])\\d{2}',
  '((19|2[0-9])\\d{2})(0[1-9]|1[012])(0[1-9]|[12][0-9]|3[01])',
  '((0[0-9])|(1[0-9])|(2[0-3]))[0-5][0-9][0-5][0-9]',
  '[1-9][0-9]{0,2}\\.(0|[1-9][0-9]{0,2})\\.(0|[1-9][0-9]{0,2})',
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
  '0[1-9]|1[0-2]',
  '[1-4]|9',
  '[^@ ]+@[^@ ]+',
  '\\w+@\\w+\\.de',
  'a*b+c?',
  '(ab|cd){2}',
  'x{0}y',
  '.{2,5}',
  '\\i\\c*',
  '[a-z-[aeiou]]+',
  '[\\d-[5]]{4}',
  '\\p{Lu}\\p{Ll}+',
  '[\\-+]?\\d+',
  '\\^\\$\\.\\*',
  '\\s?\\S{3}',
  '\\W\\w',
];

describe('stringFromPattern', () => {
  it.each(PATTERNS)('matches /%s/ for 200 seeds', (pattern) => {
    // The translator in xsd/xsd-regex.ts is the independent judge.
    const regex = new RegExp(combinePatterns([[translateBody(pattern)]]), 'u');
    for (let seed = 1; seed <= 200; seed += 1) {
      const value = stringFromPattern(pattern, createRng(seed));
      expect(value, `seed ${seed}`).toMatch(regex);
    }
  });

  it('is deterministic for a seed', () => {
    expect(stringFromPattern('[A-Z]{5}\\d{3}', createRng(5))).toBe(stringFromPattern('[A-Z]{5}\\d{3}', createRng(5)));
  });

  it('covers every branch of an alternation', () => {
    const seen = new Set(Array.from({ length: 100 }, (_, seed) => stringFromPattern('a|b|c', createRng(seed))));
    expect(seen).toEqual(new Set(['a', 'b', 'c']));
  });

  it('limits unbounded repeats', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const value = generateString(parsePattern('a+'), createRng(seed), { maxExtraRepeats: 2 });
      expect(value.length).toBeGreaterThanOrEqual(1);
      expect(value.length).toBeLessThanOrEqual(3);
    }
  });

  it('reports a class it cannot draw from', () => {
    expect(() => stringFromPattern('[^ -~]', createRng(1))).toThrow(UngeneratableError);
  });
});
