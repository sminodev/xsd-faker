// ID and IDREF planning for one document. The walker records where IDs and references are written; afterwards IDs
// are made unique and every reference gets an ID of the document that its facets allow, also one written later. An
// own integrity check decides: the default validator, libxml2, does not check that references resolve.

import type { Rng } from '../rng.js';
import { checkValue } from '../values/check.js';
import { generateValue } from '../values/generate.js';
import type { Facets } from '../xsd/facets.js';

export type IdentityKind = 'id' | 'idref' | 'idrefs';

/** An element text or attribute value of an ID, IDREF or IDREFS type. */
export interface IdentitySlot {
  kind: IdentityKind;
  /** the facets of the value; for `idrefs` those of the list, with the item facets in `item` */
  facets: Facets;
  /** local names from the root, for messages */
  path: string;
  /** false for fixed values and values the caller supplied: they are checked, never rewritten */
  adjustable: boolean;
  /** false inside content admitted with processContents="skip", which the validator does not assess */
  validated: boolean;
  get(): string;
  set(value: string): void;
}

/**
 * What a simple type means for planning: an ID, a reference, a list of references, or `unplanned` for references
 * inside a union or a list of unions, whose member the validator picks by the value.
 */
export function identityKind(facets: Facets): IdentityKind | 'unplanned' | undefined {
  if (facets.variety === 'atomic') {
    return facets.builtin === 'ID' ? 'id' : facets.builtin === 'IDREF' ? 'idref' : undefined;
  }
  if (facets.variety === 'list') {
    const item = facets.item && identityKind(facets.item);
    return item === 'idref' ? 'idrefs' : item === 'unplanned' ? 'unplanned' : undefined;
  }
  return (facets.members ?? []).some((member) => {
    const kind = identityKind(member);
    return kind !== undefined && kind !== 'id';
  })
    ? 'unplanned'
    : undefined;
}

const ATTEMPTS = 10;
const items = (value: string): string[] => value.split(/[ \t\n\r]+/).filter((item) => item !== '');

/** The facets of two types at once: all patterns, the tighter lengths, the common enumerated values. */
function both(a: Facets, b: Facets): Facets {
  const out: Facets = { ...a, patterns: [...a.patterns, ...b.patterns] };
  const length = a.length ?? b.length;
  if (length !== undefined) out.length = length;
  const minLength = Math.max(a.minLength ?? 0, b.minLength ?? 0);
  if (minLength > 0) out.minLength = minLength;
  const maxLength = Math.min(a.maxLength ?? Infinity, b.maxLength ?? Infinity);
  if (maxLength !== Infinity) out.maxLength = maxLength;
  const enumeration =
    a.enumeration && b.enumeration
      ? a.enumeration.filter((v) => b.enumeration?.includes(v))
      : (a.enumeration ?? b.enumeration);
  if (enumeration) out.enumeration = enumeration;
  return out;
}

/**
 * Plans the identities of a document in place. What it cannot solve, and slots that are not adjustable, stay as they
 * are; `checkIdentities` then reports them.
 */
export function planIdentities(slots: readonly IdentitySlot[], rng: Rng): void {
  const live = slots.filter((slot) => slot.validated);
  const ids = live.filter((slot) => slot.kind === 'id');
  /** ID value -> its slot */
  const owners = new Map<string, IdentitySlot>();
  // Fixed and supplied IDs first, so that a generated duplicate yields to them.
  for (const slot of [...ids.filter((s) => !s.adjustable), ...ids.filter((s) => s.adjustable)]) {
    let value = slot.get().trim();
    if (owners.has(value) && slot.adjustable) {
      const fresh = unique(slot.facets, rng, owners);
      if (fresh !== undefined) {
        slot.set(fresh);
        value = fresh;
      }
    }
    if (!owners.has(value)) owners.set(value, slot);
  }
  const referenced = new Set<string>();
  /** An ID for a reference with these facets: an existing one, or an unreferenced ID changed to fit. */
  const target = (facets: Facets): string | undefined => {
    const fitting = [...owners.keys()].filter((value) => checkValue(facets, value) === undefined);
    if (fitting.length > 0) return rng.pick(fitting);
    for (const [value, slot] of owners) {
      if (!slot.adjustable || referenced.has(value)) continue;
      const fresh = unique(both(slot.facets, facets), rng, owners);
      if (fresh === undefined || checkValue(slot.facets, fresh) !== undefined) continue;
      owners.delete(value);
      owners.set(fresh, slot);
      slot.set(fresh);
      return fresh;
    }
    return undefined;
  };
  for (const slot of live) {
    if (slot.kind === 'id' || !slot.adjustable) continue;
    if (slot.kind === 'idref') {
      const value = target(slot.facets);
      if (value !== undefined) {
        referenced.add(value);
        slot.set(value);
      }
      continue;
    }
    const item = slot.facets.item;
    for (let attempt = 0; item && attempt < ATTEMPTS; attempt += 1) {
      const facets = slot.facets;
      const count =
        facets.length ??
        rng.int(
          Math.max(1, facets.minLength ?? 1),
          Math.max(facets.minLength ?? 1, Math.min(facets.maxLength ?? 3, 3)),
        );
      const values: string[] = [];
      for (let k = 0; k < count; k += 1) {
        const value = target(item);
        if (value === undefined) break;
        values.push(value);
      }
      const value = values.join(' ');
      if (values.length === count && checkValue(facets, value) === undefined) {
        for (const v of values) referenced.add(v);
        slot.set(value);
        break;
      }
    }
  }
}

/** A value for these facets that no ID of the document has yet. */
function unique(facets: Facets, rng: Rng, taken: ReadonlyMap<string, IdentitySlot>): string | undefined {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const value = generateValue(facets, rng);
    if (value !== undefined && !taken.has(value)) return value;
  }
  return undefined;
}

/**
 * The integrity check that `planIdentities` must pass: each ID value occurs once, and each reference names an ID of
 * the document. Returns one message per violation; content the validator skips is left out.
 */
export function checkIdentities(slots: readonly IdentitySlot[]): string[] {
  const problems: string[] = [];
  const live = slots.filter((slot) => slot.validated);
  const ids = new Map<string, string>();
  for (const slot of live.filter((s) => s.kind === 'id')) {
    const value = slot.get().trim();
    const first = ids.get(value);
    if (first !== undefined) problems.push(`ID "${value}" at ${slot.path} is already used at ${first}`);
    else ids.set(value, slot.path);
  }
  for (const slot of live.filter((s) => s.kind !== 'id')) {
    const values = slot.kind === 'idref' ? [slot.get().trim()] : items(slot.get());
    for (const value of values) {
      if (!ids.has(value)) problems.push(`reference "${value}" at ${slot.path} names no ID of the document`);
    }
  }
  return problems;
}
