// The negative matrix: invalid samples made from valid ones, each changed to break one rule of the schema, judged by
// the validator and sorted by whether its messages show exactly that rule. Only confirmed samples count as negative
// examples; the others are reported with their status.

import type { Element } from '@xmldom/xmldom';
import type { ChoiceOccurrence, ElementFacts, ValueFacts } from '../generate/walker.js';
import { occurs } from '../generate/walker.js';
import { createRng, type Rng } from '../rng.js';
import type { Verdict, XmlValidator } from '../validate/xmllint.js';
import { generateValue } from '../values/generate.js';
import type { SerializeOptions } from '../xml/serialize.js';
import { splitXmlSpace } from '../xml/space.js';
import type { Facets } from '../xsd/facets.js';
import type { InstanceElement, InstanceText } from '../xml/tree.js';
import { attr, type Component, type SchemaDocument, type SchemaSet, XS, xsChildren } from '../xsd/schema-set.js';
import { identityKind } from '../generate/identities.js';
import { substitutionCandidates } from '../generate/alternatives.js';
import { classifyVerdict, type ConfirmationStatus } from './classify.js';
import { type Identity, identities, integrityAfter, keyHolders } from './identity.js';
import { type ExpandedPath, type ExpandedStep, formatExpandedPath, locate, paths } from './path.js';
import { RULES, type Rule } from './rules.js';
import { mutate, type TreeMutation } from './tree.js';
import { applicableValueRules, violatingValue } from './value.js';

export interface InvalidOptions {
  /** Only these rules. Default: all. */
  rules?: readonly Rule[];
  /** At most this many samples for one rule at one place of the schema. Default: 1. */
  perRuleAndPath?: number;
  /** At most this many samples in all, chosen evenly across the rules. Default: 500. */
  maxFiles?: number;
}

export interface InvalidSample {
  /** the rule the change breaks */
  rule: Rule;
  /** the changed node, exact, in text form */
  path: string;
  /** the facet a value breaks, or `fixed` */
  facet?: string;
  /** the value the change wrote */
  value?: string;
  status: ConfirmationStatus;
  /** what the validator said, by line of the document */
  diagnostics: { message: string; line?: number }[];
  /** why a sample is not confirmed */
  reason?: string;
  /** the seed of the valid sample it was made from */
  seed: number;
  xml: string;
  tree: InstanceElement;
}

export interface NotConstructible {
  rule: Rule;
  path: string;
  reason: string;
  /** no such change exists; otherwise the search found none */
  decided: boolean;
}

export interface InvalidMatrix {
  samples: InvalidSample[];
  notConstructible: NotConstructible[];
  counts: Record<ConfirmationStatus | 'not-constructible', number>;
  /** valid samples the changes start from */
  bases: number;
  /** planned changes left out by perRuleAndPath and maxFiles, without those tried in vain */
  skipped: number;
}

/** A valid sample with what the schema says about its nodes. */
export interface Base {
  tree: InstanceElement;
  seed: number;
  facts: Map<object, ElementFacts | ValueFacts>;
}

export interface MatrixContext {
  set: SchemaSet;
  validator: XmlValidator;
  /** how the documents are written; the lines of the messages refer to it */
  layout: SerializeOptions;
  serialize: (tree: InstanceElement) => string;
  /** a further document whose tree reaches a path; for the other branch of a choice */
  reach: (path: string, seed: number) => Promise<InstanceElement | undefined>;
}

const UNKNOWN_NS = 'urn:xsd-faker:unknown';

/** A planned change; structural changes that need more generation are built only once chosen. */
interface Candidate {
  rule: Rule;
  path: ExpandedPath;
  key: string;
  base: Base;
  facet?: string;
  value?: string;
  build: () => Promise<TreeMutation | { reason: string; decided: boolean }>;
  /** the change, where it is known when planned */
  mutation?: TreeMutation;
  /** why the validator may accept the change although it breaks the rule */
  unchecked?: string;
}

/** Plans the changes of the samples, chooses within the limits and applies them. */
async function applyChanges(bases: readonly Base[], context: MatrixContext, options: InvalidOptions) {
  const perKey = options.perRuleAndPath ?? 1;
  const maxFiles = options.maxFiles ?? 500;
  if (!Number.isSafeInteger(perKey) || perKey < 1 || perKey > 1000) {
    throw new RangeError('perRuleAndPath must be an integer from 1 to 1000');
  }
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 100000) {
    throw new RangeError('maxFiles must be an integer from 1 to 100000');
  }
  const wanted = new Set<Rule>(options.rules ?? RULES);
  for (const rule of wanted) if (!RULES.includes(rule)) throw new TypeError(`unknown rule ${String(rule)}`);

  const notConstructible = new Map<string, NotConstructible>();
  const byKey = new Map<string, Candidate[]>();
  for (const base of bases) {
    for (const candidate of plan(base, context, wanted, notConstructible)) {
      const list = byKey.get(candidate.key) ?? [];
      list.push(candidate);
      byKey.set(candidate.key, list);
    }
  }
  const chosen = await selectChanges(byKey, perKey, maxFiles, createRng(bases[0]?.seed ?? 1), async (candidate) => {
    const built = await candidate.build();
    if (!('op' in built)) {
      remember(notConstructible, candidate.rule, candidate.path, built.reason, built.decided);
      return undefined;
    }
    const result = mutate(candidate.base.tree, built, context.layout);
    if (result.status !== 'applied') {
      remember(notConstructible, candidate.rule, candidate.path, result.reason, true);
      return undefined;
    }
    return { candidate, mutation: result, xml: context.serialize(result.tree) };
  });
  chosen.done.sort(
    (a, b) =>
      RULES.indexOf(a.candidate.rule) - RULES.indexOf(b.candidate.rule) ||
      a.candidate.key.localeCompare(b.candidate.key),
  );
  return { applied: chosen.done, notConstructible: [...notConstructible.values()], skipped: chosen.skipped };
}

/**
 * Chooses the changes within the limits. Each key, one rule at one place, gives up to `perKey` changes; beyond
 * `maxFiles`, every rule gives up its share in turn, in an order the random source decides. A change that cannot be
 * made gives its turn to the next change of the same key, and a key whose changes all fail gives it to the next key
 * of the same rule. `skipped` counts the changes never tried.
 */
export async function selectChanges<C extends { rule: Rule }, R>(
  byKey: ReadonlyMap<string, readonly C[]>,
  perKey: number,
  maxFiles: number,
  rng: Rng,
  attempt: (candidate: C) => Promise<R | undefined>,
): Promise<{ done: R[]; skipped: number }> {
  const planned = [...byKey.values()].reduce((n, list) => n + list.length, 0);
  let tried = 0;
  const queues = new Map([...byKey].map(([key, list]) => [key, [...list]]));
  const next = async (key: string): Promise<R | undefined> => {
    const queue = queues.get(key) ?? [];
    for (let candidate = queue.shift(); candidate; candidate = queue.shift()) {
      tried += 1;
      const done = await attempt(candidate);
      if (done !== undefined) return done;
    }
    return undefined;
  };
  const slots = [...byKey].flatMap(([key, list]) => Array.from({ length: Math.min(perKey, list.length) }, () => key));
  const done: R[] = [];
  if (slots.length <= maxFiles) {
    for (const key of slots) {
      const result = await next(key);
      if (result !== undefined) done.push(result);
    }
    return { done, skipped: planned - tried };
  }
  const byRule = RULES.map((rule) =>
    shuffle(
      slots.filter((key) => byKey.get(key)?.[0]?.rule === rule),
      rng,
    ),
  );
  const turn = byRule.map(() => 0);
  while (done.length < maxFiles && byRule.some((list, r) => (turn[r] ?? 0) < list.length)) {
    for (const [r, list] of byRule.entries()) {
      while (done.length < maxFiles && (turn[r] ?? 0) < list.length) {
        const key = list[turn[r] ?? 0] as string;
        turn[r] = (turn[r] ?? 0) + 1;
        const result = await next(key);
        if (result !== undefined) {
          done.push(result);
          break;
        }
      }
    }
  }
  return { done, skipped: planned - tried };
}

function shuffle<T>(list: T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function remember(
  into: Map<string, NotConstructible>,
  rule: Rule,
  path: ExpandedPath,
  reason: string,
  decided: boolean,
): void {
  const key = `${rule} ${schemaPath(path)}`;
  if (!into.has(key)) into.set(key, { rule, path: formatExpandedPath(path), reason, decided });
}

/** A path without positions: one place of the schema. */
function schemaPath(path: ExpandedPath): string {
  return formatExpandedPath(path.map((step) => ({ ...step, position: 1 })));
}

const nameOf = (e: { ns: string; name: string }) => `{${e.ns}}${e.name}`;

// --- planning -----------------------------------------------------------------------------------------------------

function* plan(
  base: Base,
  context: MatrixContext,
  wanted: Set<Rule>,
  notConstructible: Map<string, NotConstructible>,
): Generator<Candidate> {
  const rng = createRng(base.seed);
  const known = identities(base.tree, base.facts);
  // the IDs of the document, by path, for duplicates and references
  const ids = new Map(known.filter((i) => i.kind === 'id').map((i) => [i.holder, i.value]));
  const idValues = new Set(ids.values());
  const make = (
    rule: Rule,
    path: ExpandedPath,
    build: Candidate['build'],
    extra: Partial<Candidate> = {},
  ): Candidate => ({
    rule,
    path,
    key: `${rule} ${schemaPath(path)}`,
    base,
    build,
    ...('mutation' in build ? { mutation: build.mutation as TreeMutation } : {}),
    ...extra,
  });
  const fixedChange = (mutation: TreeMutation) => Object.assign(() => Promise.resolve(mutation), { mutation });
  /** A change whose ID check finds another cause, such as a reference left without its ID, is not offered. */
  const clean = (candidate: Candidate): boolean => {
    const mutation = candidate.mutation;
    if (!mutation) return true;
    const others = otherCauses(integrityAfter(known, mutation), candidate.rule, candidate.value);
    if (others.length === 0) return true;
    remember(
      notConstructible,
      candidate.rule,
      candidate.path,
      `the change would also break an ID or a reference: ${others[0] ?? ''}`,
      false,
    );
    return false;
  };
  const keys = wanted.has('structure:too-many') ? keyHolders(base.tree, base.facts) : new Set<InstanceElement>();

  for (const { path, element, attribute } of paths(base.tree)) {
    const facts = base.facts.get(element);
    if (facts?.kind !== 'element' || facts.schemaless || element.wildcard) continue;
    // values
    const holder = attribute ?? (element.nil ? undefined : textOf(element));
    const value = holder && base.facts.get(holder);
    if (holder && value?.kind === 'value' && !value.schemaless) {
      const spec = { facets: value.facets, ...(value.fixed !== undefined ? { fixed: value.fixed } : {}) };
      for (const rule of applicableValueRules(spec)) {
        if (!wanted.has(rule)) continue;
        const result = violatingValue(spec, rule, rng);
        if (result.status === 'not-constructible') {
          remember(notConstructible, rule, path, result.reason, result.decided);
          continue;
        }
        const candidate = change(
          make,
          rule,
          path,
          { op: 'set-value', target: path, value: result.value, rule },
          {
            facet: rule === 'value:fixed' ? 'fixed' : rule.slice(rule.indexOf(':') + 1),
            value: result.value,
            ...(rule === 'value:fixed' && value.fixedOnReference
              ? { unchecked: 'libxml2 does not check a fixed value on an attribute that refers to a global attribute' }
              : {}),
          },
        );
        if (clean(candidate)) yield candidate;
      }
      const kind = identityKind(value.facets);
      const own = formatExpandedPath(path);
      // A fixed value or an enumeration is broken first by any other value.
      const free = value.fixed === undefined && value.facets.enumeration === undefined;
      if (free && kind === 'id' && wanted.has('identity:duplicate-id')) {
        const other = [...ids].find(([where, v]) => where !== own && v !== holder.value);
        if (other) {
          const candidate = change(
            make,
            'identity:duplicate-id',
            path,
            { op: 'set-value', target: path, value: other[1], rule: 'identity:duplicate-id' },
            { value: other[1] },
          );
          if (clean(candidate)) yield candidate;
        }
      }
      if (free && (kind === 'idref' || kind === 'idrefs') && wanted.has('identity:dangling-idref')) {
        const missing = absentReference(value.facets, idValues, rng);
        const candidate = change(
          make,
          'identity:dangling-idref',
          path,
          { op: 'set-value', target: path, value: missing, rule: 'identity:dangling-idref' },
          { value: missing },
        );
        if (clean(candidate)) yield candidate;
      }
      if (attribute && value.required && wanted.has('structure:missing-attribute')) {
        const candidate = change(make, 'structure:missing-attribute', path, {
          op: 'remove',
          target: path,
          rule: 'structure:missing-attribute',
        });
        if (clean(candidate)) yield candidate;
      }
    }
    if (attribute) continue;
    for (const candidate of structure(base, context, wanted, path, element, facts, make, fixedChange, keys)) {
      if (clean(candidate)) yield candidate;
    }
  }
}

/** A reference that meets its facets and names no ID of the document. */
function absentReference(facets: Facets, ids: ReadonlySet<string>, rng: Rng): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const value = generateValue(facets, rng);
    const items = value === undefined ? [] : splitXmlSpace(value);
    if (items.length > 0 && items.every((item) => !ids.has(item))) return value as string;
  }
  let missing = 'missingReference';
  for (let n = 2; ids.has(missing); n += 1) missing = `missingReference${n}`;
  return missing;
}

/** A planned change that is known in full. */
function change(
  make: Make,
  rule: Rule,
  path: ExpandedPath,
  mutation: TreeMutation,
  extra: Partial<Candidate> = {},
): Candidate {
  return make(rule, path, () => Promise.resolve(mutation), { ...extra, mutation });
}

/** The findings of an ID check that are not the rule of the change itself. */
function otherCauses(findings: readonly string[], rule: Rule, value: string | undefined): string[] {
  if (value === undefined || (rule !== 'identity:duplicate-id' && rule !== 'identity:dangling-idref')) {
    return [...findings];
  }
  return findings.filter((finding) => !finding.includes(`"${value}"`));
}

function textOf(element: InstanceElement): InstanceText | undefined {
  if (element.children.some((c) => c.kind === 'element')) return undefined;
  const text = element.children.find((c) => c.kind === 'text');
  return text?.kind === 'text' ? text : undefined;
}

type Make = (rule: Rule, path: ExpandedPath, build: Candidate['build'], extra?: Partial<Candidate>) => Candidate;

function* structure(
  base: Base,
  context: MatrixContext,
  wanted: Set<Rule>,
  path: ExpandedStep[],
  element: InstanceElement,
  facts: ElementFacts,
  make: Make,
  fixedChange: (mutation: TreeMutation) => Candidate['build'],
  keys: ReadonlySet<InstanceElement>,
): Generator<Candidate> {
  const set = context.set;
  const located = locate(base.tree, path);
  const parent = located?.kind === 'element' ? located.parent : undefined;
  const index = located?.kind === 'element' ? located.index : 0;
  const slot = facts.slot;
  if (
    slot &&
    parent &&
    wanted.has('structure:missing-element') &&
    slot.min >= 1 &&
    slot.count <= slot.min &&
    slot.required &&
    // An element of the same name right after it could take its place in the content model.
    !sameNameNext(parent, index, element)
  ) {
    yield make(
      'structure:missing-element',
      path,
      fixedChange({ op: 'remove', target: path, rule: 'structure:missing-element' }),
    );
  }
  // Copies of an element with IDs would repeat its IDs, which the ID check finds; copies of the field of a key
  // would repeat its value.
  if (
    slot &&
    parent &&
    wanted.has('structure:too-many') &&
    Number.isFinite(slot.max) &&
    !slot.repeated &&
    !keys.has(element)
  ) {
    const times = slot.max - slot.count + 1;
    if (times <= 50) {
      yield make(
        'structure:too-many',
        path,
        fixedChange({ op: 'repeat', target: path, times, rule: 'structure:too-many' }),
      );
    }
  }
  if (slot && parent && wanted.has('structure:order') && slot.compositor === 'sequence' && !slot.repeated) {
    const next = parent.children.slice(index + 1).find((c) => c.kind === 'element');
    const nextFacts = next && base.facts.get(next);
    if (
      next?.kind === 'element' &&
      nameOf(next) !== nameOf(element) &&
      nextFacts?.kind === 'element' &&
      nextFacts.slot?.compositor === 'sequence' &&
      !nextFacts.slot.repeated
    ) {
      yield make('structure:order', path, fixedChange({ op: 'swap-next', target: path, rule: 'structure:order' }));
    }
  }
  const content = facts.content;
  const elementOnly = content && !content.simple && !element.anyType;
  if (elementOnly && !content.anyElement && !element.nil && wanted.has('structure:unknown-element')) {
    const children = element.children.filter((c) => c.kind === 'element');
    const last = children.at(-1);
    const node: InstanceElement = {
      kind: 'element',
      ns: UNKNOWN_NS,
      name: 'unknown',
      attributes: [],
      children: [],
      repeatable: false,
    };
    const where = last?.kind === 'element' ? { after: childPath(path, element, last) } : { into: path };
    yield make(
      'structure:unknown-element',
      path,
      fixedChange({ op: 'insert', ...where, node, rule: 'structure:unknown-element' }),
    );
  }
  if (elementOnly && wanted.has('structure:second-branch')) {
    for (const occurrence of facts.choices) {
      const change = secondBranch(context, path, element, occurrence, base.seed, content);
      if (change) yield make('structure:second-branch', path, change);
    }
  }
  if (!element.anyType && wanted.has('structure:unknown-attribute')) {
    const unknown = unknownAttribute(element, content);
    if (unknown) {
      yield make(
        'structure:unknown-attribute',
        [...path, { ns: unknown.ns, name: unknown.name, attribute: true }],
        fixedChange({
          op: 'add-attribute',
          target: path,
          attribute: { ...unknown, value: 'x' },
          rule: 'structure:unknown-attribute',
        }),
      );
    }
  }
  if (!element.nil) {
    const filled = element.children.some((c) => c.kind === 'element' || c.value !== '');
    // The validator ignores xsi:nil on an element that is not nillable and checks its content, so the content stays.
    if (!facts.nillable && wanted.has('structure:nil-not-nillable')) {
      yield make(
        'structure:nil-not-nillable',
        path,
        fixedChange({ op: 'set-nil', target: path, keepContent: filled, rule: 'structure:nil-not-nillable' }),
      );
    }
    if (facts.nillable && facts.fixed !== undefined && wanted.has('structure:nil-with-fixed')) {
      yield make(
        'structure:nil-with-fixed',
        path,
        fixedChange({ op: 'set-nil', target: path, keepContent: false, rule: 'structure:nil-with-fixed' }),
      );
    }
    if (facts.nillable && facts.fixed === undefined && filled && wanted.has('structure:nil-with-content')) {
      yield make(
        'structure:nil-with-content',
        path,
        fixedChange({ op: 'set-nil', target: path, keepContent: true, rule: 'structure:nil-with-content' }),
      );
    }
  }
  if (wanted.has('structure:foreign-xsi-type') && !element.anyType) {
    const foreign = foreignType(set, facts);
    if (foreign) {
      yield make(
        'structure:foreign-xsi-type',
        path,
        fixedChange({ op: 'set-xsi-type', target: path, type: foreign, rule: 'structure:foreign-xsi-type' }),
      );
    }
  }
}

/** Whether a particle of the content model outside the choice declares an element of that expanded name. */
function declaredElsewhere(
  set: SchemaSet,
  models: readonly { node: Element; doc: SchemaDocument }[],
  choice: Element,
  name: string,
): boolean {
  const seen = new Set<Element>([choice]);
  return models.some((model) => declares(set, model.node, model.doc, name, seen));
}

function declares(set: SchemaSet, node: Element, doc: SchemaDocument, name: string, seen: Set<Element>): boolean {
  if (seen.has(node) || occurs(node).max === 0) return false;
  seen.add(node);
  switch (node.localName) {
    case 'element': {
      const ref = attr(node, 'ref');
      if (ref === undefined) {
        const form = attr(node, 'form');
        const ns = (form === undefined ? doc.elementQualified : form === 'qualified') ? doc.targetNamespace : '';
        return `{${ns}}${attr(node, 'name') ?? ''}` === name;
      }
      const head = set.lookup('element', set.resolveQName(node, ref));
      return (head ? [head, ...substitutionCandidates(set, head)] : []).some(
        (c) => `{${c.doc.targetNamespace}}${attr(c.node, 'name') ?? ''}` === name,
      );
    }
    case 'sequence':
    case 'choice':
    case 'all':
      return xsChildren(node).some((c) => declares(set, c, doc, name, seen));
    case 'group': {
      const group = set.reference('group', node);
      return group !== undefined && xsChildren(group.node).some((c) => declares(set, c, group.doc, name, seen));
    }
    case 'any':
      return true;
    default:
      return false;
  }
}

function sameNameNext(parent: InstanceElement, index: number, element: InstanceElement): boolean {
  const next = parent.children.slice(index + 1).find((c) => c.kind === 'element');
  return next?.kind === 'element' && nameOf(next) === nameOf(element);
}

function childPath(path: readonly ExpandedStep[], parent: InstanceElement, child: InstanceElement): ExpandedStep[] {
  const position = parent.children
    .slice(0, parent.children.indexOf(child) + 1)
    .filter((c) => c.kind === 'element' && c.ns === child.ns && c.name === child.name).length;
  return [...path, { ns: child.ns, name: child.name, ...(position > 1 ? { position } : {}) }];
}

/** An attribute the element must not have: one a restriction prohibits, or one its type does not know. */
function unknownAttribute(
  element: InstanceElement,
  content: ElementFacts['content'],
): { ns: string; name: string } | undefined {
  const admitted = (ns: string): boolean => {
    const wildcard = content?.anyAttribute;
    if (!wildcard) return false;
    return wildcard.namespace.some(
      (spec) =>
        spec === '##any' ||
        (spec === '##other' && ns !== '' && ns !== wildcard.targetNamespace) ||
        (spec === '##local' && ns === '') ||
        (spec === '##targetNamespace' && ns === wildcard.targetNamespace) ||
        spec === ns,
    );
  };
  const present = (ns: string, name: string) => element.attributes.some((a) => a.ns === ns && a.name === name);
  for (const key of content?.prohibited ?? []) {
    const ns = key.slice(1, key.indexOf('}'));
    const name = key.slice(key.indexOf('}') + 1);
    if (!admitted(ns) && !present(ns, name)) return { ns, name };
  }
  for (const ns of ['', UNKNOWN_NS]) {
    let name = 'unknown';
    for (let n = 2; content?.attributes.has(`{${ns}}${name}`) || present(ns, name); n += 1) name = `unknown${n}`;
    if (!admitted(ns)) return { ns, name };
  }
  return undefined;
}

/** A global type the element may not name with xsi:type: a complex type outside its alternatives. */
function foreignType(set: SchemaSet, facts: ElementFacts): { ns: string; name: string } | undefined {
  const allowed = new Set((facts.types?.candidates ?? []).map((c) => c.node));
  for (const component of set.components.complexType.values()) {
    if (allowed.has(component.node) || ['true', '1'].includes(attr(component.node, 'abstract') ?? '')) continue;
    if (facts.types && derivesFrom(set, component, facts.types.declared)) continue;
    // A complex type with simple content may derive from the simple type of an element without complex type.
    if (!facts.types && xsChildren(component.node).some((c) => c.localName === 'simpleContent')) continue;
    return { ns: component.doc.targetNamespace, name: attr(component.node, 'name') ?? '' };
  }
  return facts.types ? { ns: XS, name: 'string' } : undefined;
}

function derivesFrom(set: SchemaSet, type: Component, base: Component, seen = new Set<Element>()): boolean {
  if (type.node === base.node) return true;
  if (seen.has(type.node)) return false;
  seen.add(type.node);
  for (const content of xsChildren(type.node)) {
    if (content.localName !== 'complexContent' && content.localName !== 'simpleContent') continue;
    const derivation = xsChildren(content)[0];
    const name = derivation && attr(derivation, 'base');
    const next =
      name === undefined || !derivation ? undefined : set.lookup('complexType', set.resolveQName(derivation, name));
    if (next && derivesFrom(set, next, base, seen)) return true;
  }
  return false;
}

/** The first element a particle gives, by expanded name. */
function firstElement(
  set: SchemaSet,
  node: Element,
  doc: SchemaDocument,
  seen = new Set<Element>(),
): string | undefined {
  if (seen.has(node) || occurs(node).max === 0) return undefined;
  seen.add(node);
  switch (node.localName) {
    case 'element': {
      const ref = attr(node, 'ref');
      if (ref === undefined) {
        const form = attr(node, 'form');
        const ns = (form === undefined ? doc.elementQualified : form === 'qualified') ? doc.targetNamespace : '';
        return `{${ns}}${attr(node, 'name') ?? ''}`;
      }
      const head = set.lookup('element', set.resolveQName(node, ref));
      const member = head && substitutionCandidates(set, head)[0];
      return member ? `{${member.doc.targetNamespace}}${attr(member.node, 'name') ?? ''}` : undefined;
    }
    case 'sequence':
    case 'choice':
    case 'all':
      for (const child of xsChildren(node)) {
        const found = firstElement(set, child, doc, seen);
        if (found) return found;
      }
      return undefined;
    case 'group': {
      const group = set.reference('group', node);
      const compositor = group && xsChildren(group.node)[0];
      return group && compositor ? firstElement(set, compositor, group.doc, seen) : undefined;
    }
    default:
      return undefined;
  }
}

/** A second branch of a choice that occurs once: an element of another branch after the one taken. */
function secondBranch(
  context: MatrixContext,
  path: readonly ExpandedStep[],
  element: InstanceElement,
  occurrence: ChoiceOccurrence,
  seed: number,
  content: ElementFacts['content'],
): Candidate['build'] | undefined {
  const set = context.set;
  // A choice that may be empty or repeat can take the further element as an occurrence of its own.
  if (
    occurrence.context.repeated ||
    !occurrence.context.required ||
    occurrence.end <= occurrence.first ||
    occurrence.branches.length < 2
  ) {
    return undefined;
  }
  const taken = element.children.slice(occurrence.first, occurrence.end).filter((c) => c.kind === 'element');
  const last = taken.at(-1);
  if (last?.kind !== 'element') return undefined;
  // A name the element already holds elsewhere may belong to a later particle that takes the inserted element.
  const names = new Set(element.children.map((c) => (c.kind === 'element' ? nameOf(c) : '')));
  const other = occurrence.branches
    .map((branch, i) => (i === occurrence.branch ? undefined : firstElement(set, branch, occurrence.doc)))
    .find(
      (name) =>
        name !== undefined && !names.has(name) && !declaredElsewhere(set, content?.models ?? [], occurrence.node, name),
    );
  if (!other) return undefined;
  const after = childPath(path, element, last);
  return async () => {
    const ns = other.slice(1, other.indexOf('}'));
    const local = other.slice(other.indexOf('}') + 1);
    const target = `${formatExpandedPath(path)}/{${ns}}${local}`;
    const tree = await context.reach(target, seed);
    const found = tree && locate(tree, [...path, { ns, name: local }]);
    if (found?.kind !== 'element') return { reason: `no document reaches ${target}`, decided: false };
    return { op: 'insert', after, node: found.element, rule: 'structure:second-branch' };
  };
}

// --- running ------------------------------------------------------------------------------------------------------

/** Plans, applies, validates and classifies the changes of a set of valid samples. */
export async function runMatrix(
  bases: readonly Base[],
  context: MatrixContext & { schemas: Parameters<XmlValidator>[0] },
  options: InvalidOptions = {},
): Promise<InvalidMatrix> {
  {
    const { applied, notConstructible, skipped } = await applyChanges(bases, context, options);
    const verdicts: Verdict[] =
      applied.length === 0
        ? []
        : await context.validator(
            context.schemas,
            applied.map((a) => a.xml),
          );
    if (verdicts.length !== applied.length)
      throw new TypeError('validator must return exactly one verdict per document');
    const known = new Map<Base, Identity[]>();
    const samples = applied.map(({ candidate, mutation, xml }, i): InvalidSample => {
      const verdict = verdicts[i] as Verdict;
      // The ID check of the changed document: references and IDs, which the validator does not resolve.
      let before = known.get(candidate.base);
      if (!before) {
        before = identities(candidate.base.tree, candidate.base.facts);
        known.set(candidate.base, before);
      }
      const integrity = integrityAfter(before, mutation.mutation);
      const judged = classifyVerdict(verdict, mutation, { integrity });
      const classified =
        judged.status === 'accepted' && candidate.unchecked !== undefined
          ? { ...judged, status: 'not-checkable' as const, reason: candidate.unchecked }
          : judged;
      return {
        rule: candidate.rule,
        path: formatExpandedPath(candidate.path),
        ...(candidate.facet !== undefined ? { facet: candidate.facet } : {}),
        ...(candidate.value !== undefined ? { value: candidate.value } : {}),
        status: classified.status,
        diagnostics: classified.diagnostics.map((d) => ({
          message: d.message,
          ...(d.line !== undefined ? { line: d.line } : {}),
        })),
        ...(classified.reason !== undefined ? { reason: classified.reason } : {}),
        seed: candidate.base.seed,
        xml,
        tree: mutation.tree,
      };
    });
    const counts: InvalidMatrix['counts'] = {
      confirmed: 0,
      'other-cause': 0,
      accepted: 0,
      'not-checkable': 0,
      'not-constructible': notConstructible.length,
    };
    for (const sample of samples) counts[sample.status] += 1;
    return { samples, notConstructible, counts, bases: bases.length, skipped };
  }
}
