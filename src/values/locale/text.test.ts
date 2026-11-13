import { de, en } from 'xsd-faker-locales';
import { describe, expect, it } from 'vitest';
import { createRng } from '../../rng.js';
import type { Facets } from '../../xsd/facets.js';
import { checkValue } from '../check.js';
import { dateValue } from './dates.js';
import { freeText } from './text.js';

const facets = (extra: Partial<Facets>): Facets => ({ builtin: 'string', variety: 'atomic', patterns: [], ...extra });
const chars = (text: string) => [...text].length;

describe('freeText', () => {
  it('hits every exact length from 2 to 200 with single spaces and no space at either end', () => {
    for (const locale of [de, en]) {
      for (let length = 2; length <= 200; length += 1) {
        const value = freeText(locale.text, facets({ length }), createRng(length));
        expect(value === undefined ? undefined : chars(value), `${locale.tag} ${length}`).toBe(length);
        expect(value).toMatch(/^\S+( \S+)*$/);
      }
    }
  });

  it('stays within minLength and maxLength, also under whiteSpace collapse', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      for (const [minLength, maxLength] of [
        [1, 10],
        [15, 25],
        [45, 70],
        [80, 120],
        [1, 600],
      ] as const) {
        const f = facets({ minLength, maxLength, whiteSpace: 'collapse' });
        const value = freeText(de.text, f, createRng(seed));
        expect(value !== undefined && checkValue(f, value) === undefined, `${minLength}..${maxLength}: ${value}`).toBe(
          true,
        );
      }
    }
  });

  it('writes word groups up to 40 characters and sentences beyond, starting with a capital letter', () => {
    const short = freeText(en.text, facets({ maxLength: 30 }), createRng(1)) ?? '';
    expect(short).toMatch(/^[A-Z]/);
    expect(short).not.toMatch(/\.$/);
    const long = freeText(en.text, facets({ minLength: 50, maxLength: 120 }), createRng(1)) ?? '';
    expect(long).toMatch(/^[A-Z].*\.$/);
  });

  it('writes a sentence with a period for everything longer than 40 characters', () => {
    for (const locale of [de, en]) {
      for (let seed = 1; seed <= 60; seed += 1) {
        for (const [minLength, maxLength] of [
          [1, 45],
          [41, 44],
          [45, 50],
          [77, 77],
          [1, 600],
        ] as const) {
          const value = freeText(locale.text, facets({ minLength, maxLength }), createRng(seed)) ?? '';
          if (chars(value) > 40) expect(value, `${locale.tag} ${minLength}..${maxLength}`).toMatch(/^\p{Lu}.*\.$/u);
          expect(chars(value)).toBeGreaterThanOrEqual(minLength);
          expect(chars(value)).toBeLessThanOrEqual(maxLength);
        }
      }
    }
  });

  it('gives "" where nothing is allowed and nothing where no word is short enough', () => {
    expect(freeText(de.text, facets({ maxLength: 0 }), createRng(1))).toBe('');
    expect(freeText(de.text, facets({ length: 1 }), createRng(1))).toBeUndefined();
  });
});

describe('dateValue', () => {
  const reference = new Date('2026-01-15T12:00:00Z');

  it('puts birth dates one to ninety years back, endings ahead and other dates back', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const birth = dateValue('birth', reference, facets({ builtin: 'date' }), createRng(seed)) ?? '';
      expect(birth >= '1936-01-15' && birth <= '2025-01-15', birth).toBe(true);
      const future = dateValue('future', reference, facets({ builtin: 'date' }), createRng(seed)) ?? '';
      expect(future > '2026-01-15' && future <= '2028-01-16', future).toBe(true);
      const past = dateValue('past', reference, facets({ builtin: 'date' }), createRng(seed)) ?? '';
      expect(past >= '2024-01-15' && past <= '2026-01-15', past).toBe(true);
    }
  });

  it('writes the form the type or its pattern asks for', () => {
    const rng = () => createRng(5);
    expect(dateValue('past', reference, facets({ builtin: 'dateTime' }), rng())).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/,
    );
    const compact = facets({ patterns: [['((19|2[0-9])\\d{2})(0[1-9]|1[012])(0[1-9]|[12][0-9]|3[01])']] });
    expect(dateValue('past', reference, compact, rng())).toMatch(/^\d{8}$/);
    const stamp = facets({ patterns: [['\\d{14}']] });
    expect(dateValue('past', reference, stamp, rng())).toMatch(/^\d{14}$/);
    const german = facets({ patterns: [['\\d\\d\\.\\d\\d\\.\\d{4}']] });
    expect(dateValue('past', reference, german, rng())).toMatch(/^\d\d\.\d\d\.\d{4}$/);
    expect(dateValue('past', reference, facets({ patterns: [['[A-Z]+']] }), rng())).toBeUndefined();
    expect(dateValue('past', reference, facets({}), rng())).toMatch(/^\d{4}-\d\d-\d\d$/);
  });
});
