import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import type { Facets } from '../xsd/facets.js';
import { checkIdentities, type IdentitySlot, identityKind, planIdentities } from './identities.js';

const atomic = (builtin: string, extra: Partial<Facets> = {}): Facets => ({
  builtin,
  variety: 'atomic',
  patterns: [],
  ...extra,
});
const idrefs = (extra: Partial<Facets> = {}): Facets => ({
  builtin: 'IDREFS',
  variety: 'list',
  patterns: [],
  minLength: 1,
  item: atomic('IDREF'),
  ...extra,
});
function slot(kind: IdentitySlot['kind'], value: string, extra: Partial<IdentitySlot> = {}) {
  let current = value;
  const s: IdentitySlot = {
    kind,
    facets: kind === 'idrefs' ? idrefs() : atomic(kind === 'id' ? 'ID' : 'IDREF'),
    path: `R/${kind}`,
    adjustable: true,
    validated: true,
    get: () => current,
    set: (v) => {
      current = v;
    },
    ...extra,
  };
  return s;
}

describe('identityKind', () => {
  it('plans IDs, references and lists of references, and leaves references in unions unplanned', () => {
    expect(identityKind(atomic('ID'))).toBe('id');
    expect(identityKind(atomic('IDREF', { patterns: [['R[0-9]+']] }))).toBe('idref');
    expect(identityKind(idrefs())).toBe('idrefs');
    expect(identityKind({ builtin: 'anySimpleType', variety: 'union', patterns: [], members: [atomic('IDREF')] })).toBe(
      'unplanned',
    );
    expect(identityKind({ builtin: 'anySimpleType', variety: 'union', patterns: [], members: [atomic('ID')] })).toBe(
      undefined,
    );
    expect(identityKind(atomic('string'))).toBe(undefined);
  });
});

describe('planIdentities', () => {
  it('makes IDs unique and points references at them, also forward', () => {
    const slots = [slot('idref', 'x'), slot('id', 'Same'), slot('idrefs', 'y z'), slot('id', 'Same')];
    planIdentities(slots, createRng(1));
    expect(checkIdentities(slots)).toEqual([]);
    const ids = [slots[1]!.get(), slots[3]!.get()];
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(slots[0]!.get());
    for (const item of slots[2]!.get().split(' ')) expect(ids).toContain(item);
  });

  it('changes an unreferenced ID to meet the facets of a reference', () => {
    const ref = slot('idref', 'x', { facets: atomic('IDREF', { patterns: [['R[0-9]{3}']] }) });
    const slots = [slot('id', 'Abc'), ref];
    planIdentities(slots, createRng(4));
    expect(checkIdentities(slots)).toEqual([]);
    expect(ref.get()).toMatch(/^R[0-9]{3}$/);
    expect(slots[0]!.get()).toBe(ref.get());
  });

  it('keeps fixed and supplied values and lets the check report them', () => {
    const fixedRef = slot('idref', 'missing', { adjustable: false });
    const fixedId = slot('id', 'a', { adjustable: false });
    const generatedId = slot('id', 'a');
    const slots = [fixedRef, fixedId, generatedId];
    planIdentities(slots, createRng(1));
    expect(fixedRef.get()).toBe('missing');
    expect(fixedId.get()).toBe('a');
    expect(generatedId.get()).not.toBe('a');
    expect(checkIdentities(slots)).toEqual(['reference "missing" at R/idref names no ID of the document']);
  });

  it('cannot solve references without an ID, and ignores content the validator skips', () => {
    const lonely = [slot('idref', 'x')];
    planIdentities(lonely, createRng(1));
    expect(checkIdentities(lonely)).toHaveLength(1);
    const skipped = [slot('idref', 'x', { validated: false }), slot('id', 'a'), slot('id', 'a', { validated: false })];
    planIdentities(skipped, createRng(1));
    expect(checkIdentities(skipped)).toEqual([]);
  });

  it('meets the length facets of a list of references', () => {
    const list = slot('idrefs', 'x', { facets: idrefs({ length: 4 }) });
    const slots = [slot('id', 'a'), slot('id', 'b'), list];
    planIdentities(slots, createRng(2));
    expect(checkIdentities(slots)).toEqual([]);
    expect(list.get().split(' ')).toHaveLength(4);
  });
});
