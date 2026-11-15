// Branch selection, size estimates and reachable choices for generation and coverage planning.
// These helpers read the schema without depending on Walker state.

import type { Element } from '@xmldom/xmldom';
import type { Rng } from '../rng.js';
import { attr, type SchemaSet, XS, xsChild, xsChildren } from '../xsd/schema-set.js';
import { declaredType, substitutionCandidates, typeCandidates } from './alternatives.js';

export type OptionalMode = 'none' | 'all' | 'random';

/** Kind of choice: xs:choice, substitution group or xsi:type alternatives. */
export type ChoiceKind = 'choice' | 'substitution' | 'type';

export interface ChoiceContext {
  /**
   * The xs:choice element; for a substitution group the xs:element particle that refers to the head; for xsi:type
   * the element declaration.
   */
  node: Element;
  /**
   * The alternatives: the particles of an xs:choice that may occur (maxOccurs > 0); the global element declarations
   * of a substitution group, the head first unless it is abstract; or the complex type definitions an element may
   * have, its declared type first unless it is abstract.
   */
  branches: Element[];
  /** Default: choice. */
  kind?: ChoiceKind;
  path: readonly string[];
  set: SchemaSet;
  rng: Rng;
  /** Depth of the element whose content holds the choice; the root element is depth 0. */
  depth?: number;
  /** The settings that decide how much content a branch produces. Without them: required content, once. */
  settings?: ChoiceSettings;
}

/** The generation settings a choice strategy can take into account. */
export interface ChoiceSettings {
  /** effective optional-element policy */
  optionalElements: OptionalMode;
  /** requested occurrences before clamping to minOccurs and maxOccurs */
  repeat: number;
  /** optional elements are left out from this depth on */
  maxDepth: number;
  /** content nested deeper than this cannot be generated */
  maxTotalDepth: number;
}

/** Chance that `optional: 'random'` includes an optional element or attribute. */
export const RANDOM_OPTIONAL_CHANCE = 0.5;

/**
 * How much an optional particle counts when `smallest` estimates a branch: its expected share of the output.
 * `all` generates it, `none` leaves it out, `random` includes it with RANDOM_OPTIONAL_CHANCE, so estimate and
 * generation change together; docs/api.md states the weights.
 */
export function optionalWeight(mode: OptionalMode): number {
  if (mode === 'all') return 1;
  if (mode === 'random') return RANDOM_OPTIONAL_CHANCE;
  return 0;
}

/** Picks the branch of a choice, as an index into `branches`. */
export type ChoiceStrategy = (choice: ChoiceContext) => number;

export const firstBranch: ChoiceStrategy = () => 0;
export const randomBranch: ChoiceStrategy = ({ branches, rng }) => rng.int(0, branches.length - 1);

/** The first branch that declares or refers to an element of one of these local names; otherwise `fallback`. */
export function preferBranches(names: readonly string[], fallback: ChoiceStrategy = firstBranch): ChoiceStrategy {
  return (context) => {
    const index = context.branches.findIndex((b) => names.some((name) => mentions(context.set, b, name, new Set())));
    return index >= 0 ? index : fallback(context);
  };
}

/**
 * Whether a particle declares or refers to an element of that local name; looks into model groups, not into types.
 * A type alternative of xsi:type mentions its own name.
 */
function mentions(set: SchemaSet, particle: Element, name: string, seen: Set<Element>): boolean {
  switch (particle.localName) {
    case 'complexType':
      return attr(particle, 'name') === name;
    case 'element': {
      const ref = attr(particle, 'ref');
      return (ref === undefined ? attr(particle, 'name') : ref.slice(ref.indexOf(':') + 1)) === name;
    }
    case 'sequence':
    case 'choice':
    case 'all':
      return xsChildren(particle).some((c) => mentions(set, c, name, seen));
    case 'group': {
      const group = set.reference('group', particle);
      if (!group || seen.has(group.node)) {
        return false;
      }
      seen.add(group.node);
      return xsChildren(group.node).some((c) => mentions(set, c, name, seen));
    }
    default:
      return false;
  }
}

export function occurs(node: Element): { min: number; max: number } {
  const min = attr(node, 'minOccurs');
  const max = attr(node, 'maxOccurs');
  return {
    min: min === undefined ? 1 : Number(min),
    max: max === undefined ? 1 : max === 'unbounded' ? Infinity : Number(max),
  };
}

/** Stable within a schema set: document path and structural declaration path. */
export function choiceId(set: SchemaSet, node: Element): string {
  const parts: string[] = [];
  let current: Element | undefined = node;
  while (current) {
    const parent: Element | undefined =
      current.parentNode?.nodeType === 1 ? (current.parentNode as Element) : undefined;
    const position = parent ? xsChildren(parent).indexOf(current) : 0;
    parts.unshift(`${current.localName}[${position}]`);
    current = parent;
  }
  return `${set.at(node).file ?? ''}#${parts.join('/')}`;
}

/** Settings assumed by `smallest` when a caller builds a ChoiceContext without them: required content, once. */
const REQUIRED_ONLY: ChoiceSettings = { optionalElements: 'none', repeat: 1, maxDepth: 12, maxTotalDepth: 64 };
const PARTICLES = new Set(['element', 'sequence', 'choice', 'all', 'group', 'any', 'complexType']);
const estimators = new WeakMap<SchemaSet, Map<string, (particle: Element, depth: number) => number>>();

/**
 * Expected number of elements one particle adds, as the walker generates it with these settings. Occurrences are
 * `repeat` clamped to the particle's bounds. An optional particle counts with optionalWeight() and not at all from
 * maxDepth on, so recursion through optional content ends as generation does. A nested choice counts with its
 * smallest branch. Content deeper than maxTotalDepth, an unknown reference or a circular group or derivation make the
 * cost infinite. `depth` is the depth of the element whose content holds the particle.
 */
export function expectedSize(set: SchemaSet, particle: Element, depth: number, settings = REQUIRED_ONLY): number {
  const key = `${settings.optionalElements}|${settings.repeat}|${settings.maxDepth}|${settings.maxTotalDepth}`;
  let bySettings = estimators.get(set);
  if (!bySettings) {
    bySettings = new Map();
    estimators.set(set, bySettings);
  }
  let estimate = bySettings.get(key);
  if (!estimate) {
    estimate = estimator(set, settings);
    bySettings.set(key, estimate);
  }
  return estimate(particle, depth);
}

function estimator(set: SchemaSet, settings: ChoiceSettings): (particle: Element, depth: number) => number {
  const weight = optionalWeight(settings.optionalElements);
  const memo = new Map<Element, Map<number, number>>();
  // Groups and types being computed, by depth: meeting one again at the same depth is a cycle without an element.
  const active = new Map<Element, Set<number>>();
  const guarded = (node: Element, depth: number, compute: () => number): number => {
    const busy = active.get(node) ?? new Set<number>();
    if (busy.has(depth)) return Infinity;
    busy.add(depth);
    active.set(node, busy);
    try {
      return compute();
    } finally {
      busy.delete(depth);
    }
  };
  const sum = (nodes: Element[], depth: number): number =>
    nodes.filter((n) => PARTICLES.has(n.localName ?? '')).reduce((total, n) => total + occurrence(n, depth), 0);
  const occurrence = (node: Element, depth: number): number => {
    const cached = memo.get(node)?.get(depth);
    if (cached !== undefined) return cached;
    const { min, max } = occurs(node);
    let value = 0;
    const share = max === 0 ? 0 : min > 0 ? 1 : depth >= settings.maxDepth ? 0 : weight;
    if (share > 0) value = share * Math.min(max, Math.max(min, settings.repeat)) * single(node, depth);
    const byDepth = memo.get(node) ?? new Map<number, number>();
    byDepth.set(depth, value);
    memo.set(node, byDepth);
    return value;
  };
  const single = (node: Element, depth: number): number => {
    switch (node.localName) {
      case 'element': {
        if (depth + 1 > settings.maxTotalDepth) return Infinity;
        const ref = attr(node, 'ref');
        if (ref === undefined) return 1 + content(node, depth + 1);
        // A substitution group counts with its smallest allowed member, like a nested choice.
        const head = set.lookup('element', set.resolveQName(node, ref));
        const members = head ? substitutionCandidates(set, head) : [];
        return members.length > 0 ? Math.min(...members.map((m) => 1 + content(m.node, depth + 1))) : Infinity;
      }
      case 'complexType':
        // A type xsi:type can name, for the element at `depth`.
        return depth > settings.maxTotalDepth ? Infinity : 1 + typeContent(node, depth);
      case 'sequence':
      case 'all':
        return sum(xsChildren(node), depth);
      case 'choice': {
        const branches = xsChildren(node).filter((c) => PARTICLES.has(c.localName ?? '') && occurs(c).max > 0);
        return branches.length > 0 ? Math.min(...branches.map((b) => occurrence(b, depth))) : 0;
      }
      case 'group': {
        const group = set.reference('group', node);
        return group ? guarded(group.node, depth, () => sum(xsChildren(group.node), depth)) : Infinity;
      }
      case 'any':
        return 1;
      default:
        return 0;
    }
  };
  const content = (decl: Element, depth: number): number => {
    const declared = declaredType(set, decl);
    if (declared.kind === 'named') {
      const qname = declared.qname;
      const complex = qname.ns === XS ? undefined : set.lookup('complexType', qname);
      if (!complex) return 0;
      // The types xsi:type can name count with the smallest one.
      const types = typeCandidates(set, decl, complex);
      return types.length > 0 ? Math.min(...types.map((t) => typeContent(t.node, depth))) : Infinity;
    }
    return declared.kind === 'anonymous' && declared.node.localName === 'complexType'
      ? typeContent(declared.node, depth)
      : 0;
  };
  const typeContent = (type: Element, depth: number): number =>
    guarded(type, depth, () => {
      if (xsChild(type, 'simpleContent')) return 0;
      const complexContent = xsChild(type, 'complexContent');
      const derivation = complexContent ? xsChildren(complexContent)[0] : undefined;
      let base = 0;
      if (derivation?.localName === 'extension') {
        const qname = set.resolveQName(derivation, attr(derivation, 'base') ?? '');
        const inherited = qname.ns === XS ? undefined : set.lookup('complexType', qname);
        if (inherited) base = typeContent(inherited.node, depth);
      }
      return base + sum(xsChildren(derivation ?? type), depth);
    });
  return occurrence;
}

/**
 * The branch with the smallest expected output under the context's settings (see expectedSize); the first such
 * branch on a tie. Without settings in the context, only required content counts.
 */
export const smallestBranch: ChoiceStrategy = ({ branches, set, depth = 0, settings }) => {
  let selected = 0;
  let best = Infinity;
  branches.forEach((branch, index) => {
    const value = expectedSize(set, branch, depth, settings);
    if (value < best) {
      best = value;
      selected = index;
    }
  });
  return selected;
};

/**
 * The choices a particle can lead to, through element types, derivations, groups and every branch of nested
 * choices. Optional particles are followed only when `followOptional` is set. Depth limits are not applied.
 */
export function reachableChoices(set: SchemaSet, particle: Element, followOptional: boolean): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  const visitType = (type: Element): void => {
    if (seen.has(type)) return;
    seen.add(type);
    const complexContent = xsChild(type, 'complexContent');
    const derivation = complexContent ? xsChildren(complexContent)[0] : undefined;
    if (derivation?.localName === 'extension') {
      const qname = set.resolveQName(derivation, attr(derivation, 'base') ?? '');
      const inherited = qname.ns === XS ? undefined : set.lookup('complexType', qname);
      if (inherited) visitType(inherited.node);
    }
    for (const child of xsChildren(derivation ?? type)) visit(child);
  };
  /** Visits the declaration's type and any xsi:type alternatives, recording a choice when there are several. */
  const visitDeclaration = (decl: Element): void => {
    const declared = declaredType(set, decl);
    if (declared.kind === 'named') {
      const qname = declared.qname;
      const complex = qname.ns === XS ? undefined : set.lookup('complexType', qname);
      if (!complex) return;
      const types = typeCandidates(set, decl, complex);
      if (types.length > 1) out.push(decl);
      for (const type of types) visitType(type.node);
    } else if (declared.kind === 'anonymous' && declared.node.localName === 'complexType') {
      visitType(declared.node);
    }
  };
  const visit = (node: Element): void => {
    if (node.localName === 'complexType') {
      visitType(node);
      return;
    }
    if (seen.has(node) || !PARTICLES.has(node.localName ?? '')) return;
    seen.add(node);
    const { min, max } = occurs(node);
    if (max === 0 || (min === 0 && !followOptional)) return;
    switch (node.localName) {
      case 'element': {
        const ref = attr(node, 'ref');
        const head = ref === undefined ? undefined : set.lookup('element', set.resolveQName(node, ref));
        if (ref === undefined) {
          visitDeclaration(node);
          return;
        }
        // A substitution group is a decision of its own, and each member a branch below it.
        const members = head ? substitutionCandidates(set, head) : [];
        if (members.length > 1) out.push(node);
        for (const member of members) visitDeclaration(member.node);
        return;
      }
      case 'choice':
        out.push(node);
        for (const child of xsChildren(node)) visit(child);
        return;
      case 'sequence':
      case 'all':
        for (const child of xsChildren(node)) visit(child);
        return;
      case 'group': {
        const group = set.reference('group', node);
        if (group) for (const child of xsChildren(group.node)) visit(child);
        return;
      }
      default:
        return;
    }
  };
  visit(particle);
  return out;
}
