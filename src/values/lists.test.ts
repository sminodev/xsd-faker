import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import type { Facets } from '../xsd/facets.js';
import { listed, listKeys, valueLists } from './lists.js';
import type { ValueContext } from './source.js';

const facets = (extra: Partial<Facets> = {}): Facets => ({
  builtin: 'string',
  variety: 'atomic',
  patterns: [],
  ...extra,
});
const context = (extra: Partial<ValueContext> = {}): ValueContext => ({
  facets: facets(),
  name: 'code',
  path: ['R', 'code'],
  kind: 'element',
  rng: createRng(1),
  typeName: '{urn:t}Narrow',
  baseTypeNames: ['{urn:t}Code'],
  ...extra,
});

describe('valueLists', () => {
  it('tries the path, then the type with and without namespace, then its base types', () => {
    expect(listKeys(context())).toEqual(['/R/code', '{urn:t}Narrow', 'Narrow', '{urn:t}Code', 'Code']);
    expect(listKeys({ path: ['R', 'code'], kind: 'attribute' })).toEqual(['/R/@code']);
  });

  it('takes the first key with a value that meets the facets', () => {
    const lists = { '/R/code': 'too long', Code: ['A1', 'B2'], Narrow: 'NN' };
    const narrow = context({ facets: facets({ maxLength: 2 }) });
    expect(valueLists(lists).value(narrow)).toBe('NN');
    expect(valueLists({ '/R/code': 'too long', Code: 'A1' }).value(narrow)).toBe('A1');
    expect(valueLists({ '{urn:other}Code': 'X' }).value(narrow)).toBeUndefined();
    expect(valueLists({ '/R/code': 'P', Code: 'C' }).value(context())).toBe('P');
  });

  it('counts a listed place as supplied by the caller', () => {
    expect(listed({ Code: 'A1' }, context())).toBe(true);
    expect(listed({ Other: 'A1' }, context())).toBe(false);
  });
});
