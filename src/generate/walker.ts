// Walks the declarations of an XML Schema from a root element and builds one instance tree.
//
// Complex types: attributes from the type, its derivation chain and attribute groups; content from sequence, choice,
// all and group references, in document order. An extension puts the content of its base first; a restriction
// states its content itself. Simple content and simple types get a value from the ValueSource.

import type { Element } from '@xmldom/xmldom';
import type { Rng } from '../rng.js';
import { binaryKind, settledValue } from '../values/check.js';
import type { ValueContext, ValueScope, ValueSource } from '../values/source.js';
import { generateValue } from '../values/generate.js';
import {
  element,
  type GroupOccurrence,
  type InstanceAttribute,
  type InstanceElement,
  type InstanceNode,
  type InstanceText,
  text,
} from '../xml/tree.js';
import { enumerationScope, FacetReader, type Facets, holdsQNames, jsonFormOf } from '../xsd/facets.js';
import type { Problems } from '../xsd/problems.js';
import {
  declarationUnavailable,
  declaredType,
  expandedName,
  isAbstract,
  particleUnavailable,
  substitutionCandidates,
  typeCandidates,
} from './alternatives.js';
import { checkIdentities, type IdentitySlot, identityKind, planIdentities } from './identities.js';
import {
  attr,
  type Component,
  type QName,
  type SchemaDocument,
  type SchemaSet,
  XS,
  clark,
  xsChild,
  xsChildren,
} from '../xsd/schema-set.js';
import { splitXmlSpace } from '../xml/space.js';

export type OptionalMode = 'none' | 'all' | 'random';
/** Whether nillable elements may be written with xsi:nil="true". */
export type NilMode = 'never' | 'random';

/** Where a choice comes from: an xs:choice, a substitution group, or the types xsi:type can name. */
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
const RANDOM_OPTIONAL_CHANCE = 0.5;
/** Chance that `nil: 'random'` writes a nillable element without a fixed value as nil. */
const RANDOM_NIL_CHANCE = 0.5;

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

export interface WalkOptions {
  /** Shorthand for both policies; separate element and attribute settings take precedence. */
  optional: OptionalMode;
  optionalElements?: OptionalMode;
  optionalAttributes?: OptionalMode;
  allBranches?: boolean;
  /** Default: never, which draws no random numbers. */
  nil?: NilMode;
  maxTotalDepth?: number;
  maxNodes?: number;
  /** How often a repeatable element occurs: at least minOccurs, at most maxOccurs. */
  repeat: number;
  choice: ChoiceStrategy;
  /** Beyond this depth only required content is generated, so recursive types end. */
  maxDepth: number;
  values: ValueSource;
  /** Whether the caller supplies the value at this place; such ID and IDREF values are checked, not replanned. */
  userSupplied?: (target: Pick<ValueContext, 'path' | 'kind' | 'typeName' | 'baseTypeNames'>) => boolean;
  rng: Rng;
}

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

/** An attribute as a complex type uses it: the xs:attribute element (a declaration or a ref) and its document. */
interface AttributeUse {
  node: Element;
  doc: SchemaDocument;
}

/** What a complex type contributes: its model groups in order, its attributes, the facets of simple content. */
interface ContentPlan {
  groups: { node: Element; doc: SchemaDocument }[];
  attributes: Map<string, AttributeUse>;
  simple?: Facets;
  /** for simple content, the named types from this one down its derivation, the type itself first if it has a name */
  simpleTypes?: string[];
  mixed: boolean;
}

/** The named types of a value: its own, if it has a name, and those it derives from, nearest first. */
interface TypeNames {
  typeName?: string;
  baseTypeNames: string[];
}

const NO_TYPE_NAMES: TypeNames = { baseTypeNames: [] };

/** What the content model says about one JSON object: an element's content or an occurrence of a repeated group. */
interface ObjectScope {
  /** the property of each repeated group, by group definition or anonymous particle */
  keys: Map<Element, string>;
  /** how many repeated groups use each name */
  groupNames: Map<string, number>;
  /** how many particles declare each element, by expanded name */
  elements: Map<string, number>;
  /** the local names of declared elements and attributes; content admitted by xs:any must not take them */
  names: Set<string>;
  /** the JSON key of each element whose local name several namespaces declare: `{ns}local`, by expanded name */
  elementKeys: Map<string, string>;
  /** the namespace of each local name that wildcard content in this object already uses */
  wildcards: Map<string, string>;
}

/** Where a particle writes: its JSON object and the repeated group occurrences around it. */
interface Place {
  scope: ObjectScope;
  trail: readonly GroupOccurrence[];
}

const MODEL_GROUPS = ['sequence', 'choice', 'all', 'group'];
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
/** The namespace of a prefix that a generated QName value uses and the schema does not bind, followed by the prefix. */
const VALUE_PREFIX_NS = 'urn:example:prefix:';
/** Required content nested deeper than maxDepth + this is reported instead of generated. */
const DEPTH_RESERVE = 25;

/** One decision of a document. Substitution groups and xsi:type also name their alternatives. */
export interface ChoiceVisit {
  id: string;
  branch: number;
  branches: number;
  kind?: 'substitution' | 'type';
  /** the expanded name of each alternative, for substitution groups and xsi:type */
  alternatives?: string[];
}

/** A generation budget was exceeded, distinct from errors in user callbacks. */
export class LimitError extends Error {}

export class Walker {
  private readonly facets: FacetReader;
  private nodes = 0;
  private occurrences = 0;
  /** above zero inside content admitted by xs:any, which JSON maps without the schema: no nil there */
  private schemaless = 0;
  /** above zero inside content admitted with processContents="skip", which the validator does not assess */
  private skipped = 0;
  /** where IDs and references are written, planned once the tree is complete */
  private readonly identities: IdentitySlot[] = [];
  /** the simple values of the document with their types, described once identities are planned */
  private readonly written: { facets: Facets; holder: InstanceText | InstanceAttribute }[] = [];
  readonly choices: ChoiceVisit[] = [];
  private readonly settings: ChoiceSettings;
  /** the elements of complex type being written, outermost first */
  private readonly scopes: ValueScope[] = [];
  private instances = 0;

  constructor(
    private readonly set: SchemaSet,
    private readonly problems: Problems,
    private readonly options: WalkOptions,
  ) {
    this.facets = new FacetReader(set, problems);
    this.settings = {
      optionalElements: options.optionalElements ?? options.optional,
      repeat: options.repeat,
      maxDepth: options.maxDepth,
      maxTotalDepth: options.maxTotalDepth ?? options.maxDepth + DEPTH_RESERVE,
    };
  }

  /** The instance of a global element. */
  root(component: Component): InstanceElement {
    const tree = this.element(component.node, component.doc, [], 0, true) ?? element('', '');
    if (this.identities.length > 0) {
      planIdentities(this.identities, this.options.rng);
      // Only this check, never a validator's verdict, clears references: libxml2 does not resolve them.
      for (const message of checkIdentities(this.identities)) this.problems.error('identity-planning', message);
    }
    for (const { facets, holder } of this.written) {
      const normalized = settledValue(facets, holder.value);
      if (normalized !== holder.value) holder.normalized = normalized;
      const binary = binaryKind(facets, holder.value);
      if (binary) holder.binary = binary;
    }
    return tree;
  }

  // --- elements ------------------------------------------------------------------------------------------------

  private element(
    node: Element,
    doc: SchemaDocument,
    path: readonly string[],
    depth: number,
    global: boolean,
  ): InstanceElement | undefined {
    this.nodes += 1;
    if (this.nodes > (this.options.maxNodes ?? 10000)) {
      throw new LimitError('generated tree exceeds maxNodes');
    }
    let decl = node;
    let declDoc = doc;
    let ns: string;
    const ref = attr(node, 'ref');
    if (ref !== undefined) {
      const target = this.set.lookup('element', this.set.resolveQName(node, ref));
      if (!target) {
        this.problems.error('unknown-element', `element ${ref} is not defined`, this.set.at(node));
        return undefined;
      }
      decl = target.node;
      declDoc = target.doc;
      ns = target.doc.targetNamespace;
    } else if (global) {
      ns = doc.targetNamespace;
    } else {
      const form = attr(node, 'form');
      ns = (form === undefined ? doc.elementQualified : form === 'qualified') ? doc.targetNamespace : '';
    }
    const name = attr(decl, 'name') ?? '';
    if (xsChildren(decl).some((c) => ['key', 'keyref', 'unique'].includes(c.localName ?? ''))) {
      this.problems.warning(
        'identity-planning',
        'identity constraints are validated but not used to plan values',
        this.set.at(decl),
      );
    }
    const here = [...path, name];
    if (depth > (this.options.maxTotalDepth ?? this.options.maxDepth + DEPTH_RESERVE)) {
      this.problems.error(
        'depth-limit',
        `content nests deeper than ${depth} levels at ${here.join('/')}`,
        this.set.at(decl),
      );
      return undefined;
    }
    if (isAbstract(decl)) {
      // A particle that refers to an abstract head takes one of its members; only a root gets here.
      this.problems.error('unsupported', `${name} is abstract and cannot occur itself`, this.set.at(decl));
    }
    const out = element(ns, name);
    const fixed = attr(decl, 'fixed') ?? attr(decl, 'default');
    // Only 'random' draws a number here, so that 'never' does not change the other choices of a seed.
    if (
      this.options.nil === 'random' &&
      this.schemaless === 0 &&
      ['true', '1'].includes(attr(decl, 'nillable') ?? '') &&
      attr(decl, 'fixed') === undefined &&
      this.options.rng.chance(RANDOM_NIL_CHANCE)
    ) {
      out.nil = true;
    }
    // A member of a substitution group without a type of its own has the type of its head.
    const declared = declaredType(this.set, decl);
    if (declared.kind === 'named') {
      const qname = declared.qname;
      const complex = qname.ns === XS ? undefined : this.set.lookup('complexType', qname);
      if (complex) {
        const chosen = this.typeFor(out, decl, complex, here, depth);
        if (chosen) this.complex(out, chosen.node, chosen.doc, here, depth, fixed, decl);
      } else if (out.nil) {
        // A nil element of a simple type has neither text nor attributes.
      } else if (!(qname.ns === XS && qname.local === 'anyType')) {
        this.simpleText(out, this.facets.read(qname, declared.from), here, fixed, decl, this.simpleTypeNames(qname));
      } else {
        this.anyType(out, fixed);
      }
    } else if (declared.kind === 'anonymous' && declared.node.localName === 'complexType') {
      this.complex(out, declared.node, this.set.documentOf(declared.node) ?? declDoc, here, depth, fixed, decl);
    } else if (out.nil) {
      // as above
    } else if (declared.kind === 'anonymous') {
      this.simpleText(out, this.facets.read(declared.node), here, fixed, decl, this.simpleTypeNames(declared.node));
    } else {
      this.anyType(out, fixed);
    }
    return out;
  }

  /** An element of xs:anyType, declared or for want of a type: empty, or its value constraint as text. */
  private anyType(out: InstanceElement, fixed: string | undefined): void {
    out.anyType = true;
    if (fixed !== undefined) out.children = [text(fixed)];
  }

  /**
   * The complex type an element gets: its declared type, or a type derived from it, written as xsi:type. Chosen like
   * a branch when there is more than one; an abstract type without a concrete derived type is reported.
   */
  private typeFor(
    out: InstanceElement,
    decl: Element,
    declared: Component,
    path: readonly string[],
    depth: number,
  ): Component | undefined {
    const candidates = typeCandidates(this.set, decl, declared);
    if (candidates.length === 0) {
      this.problems.error(
        'unsupported',
        `${out.name} has the abstract type ${attr(declared.node, 'name')} and no concrete type derived from it`,
        this.set.at(decl),
      );
      return undefined;
    }
    if (candidates.length > 1) out.typeable = true;
    const index = candidates.length === 1 ? 0 : this.decide('type', decl, candidates, path, depth);
    const chosen = candidates[index] ?? declared;
    if (chosen.node !== declared.node) {
      out.xsiType = { ns: chosen.doc.targetNamespace, name: attr(chosen.node, 'name') ?? '' };
    }
    return chosen;
  }

  /** Asks the choice strategy among substitution group members or types, and records the decision. */
  private decide(
    kind: 'substitution' | 'type',
    node: Element,
    candidates: readonly Component[],
    path: readonly string[],
    depth: number,
  ): number {
    const index = this.ask({ node, branches: candidates.map((c) => c.node), path, depth, kind });
    this.choices.push({
      id: choiceId(this.set, node),
      branch: index,
      branches: candidates.length,
      kind,
      alternatives: candidates.map(expandedName),
    });
    return index;
  }

  /** The branch the strategy picks, checked. */
  private ask(context: Pick<ChoiceContext, 'node' | 'branches' | 'path' | 'depth' | 'kind'>): number {
    const index = this.options.choice({
      ...context,
      set: this.set,
      rng: this.options.rng,
      settings: this.settings,
    });
    if (!Number.isInteger(index) || index < 0 || index >= context.branches.length) {
      throw new RangeError('choice strategy returned an invalid branch index');
    }
    return index;
  }

  private simpleText(
    out: InstanceElement,
    facets: Facets,
    path: readonly string[],
    fixed: string | undefined,
    decl: Element,
    names: TypeNames,
  ): void {
    this.identityBoundary(facets);
    const value = fixed ?? this.value(facets, path, 'element', names);
    const scope = fixed === undefined ? (enumerationScope(facets, value) ?? decl) : decl;
    this.bindPrefixes(out, facets, value, scope, fixed === undefined);
    const form = jsonFormOf(facets);
    const node = text(value, form.type, form.list);
    out.children = [node];
    this.written.push({ facets, holder: node });
    this.identity(facets, path, 'element', names, fixed !== undefined, {
      get: () => node.value,
      set: (v) => {
        node.value = v;
      },
    });
  }

  /**
   * The prefixes in a QName value need a declaration in the document; the schema says what they stand for. A
   * generated value, from a pattern for example, may use a prefix the schema does not bind: any namespace makes it a
   * QName, so `xsi` gets its own and every other prefix one of its own.
   */
  private bindPrefixes(out: InstanceElement, facets: Facets, value: string, scope: Element, generated: boolean): void {
    if (!holdsQNames(facets)) return;
    for (const token of splitXmlSpace(value)) {
      const prefix = token.slice(0, Math.max(token.indexOf(':'), 0));
      if (prefix === '' || prefix === 'xml') continue;
      const ns =
        scope.lookupNamespaceURI(prefix) ??
        (!generated ? null : prefix === 'xsi' ? XSI : `${VALUE_PREFIX_NS}${prefix}`);
      if (ns) out.valueNamespaces = { ...out.valueNamespaces, [prefix]: ns };
    }
  }

  /** Records an ID or reference for planning; a reference inside a union cannot be planned and is reported. */
  private identity(
    facets: Facets,
    path: readonly string[],
    kind: 'element' | 'attribute',
    names: TypeNames,
    fixed: boolean,
    access: Pick<IdentitySlot, 'get' | 'set'>,
  ): void {
    const identity = identityKind(facets);
    if (identity === undefined) return;
    if (identity === 'unplanned') {
      this.problems.error(
        'identity-planning',
        `references in a union at ${path.join('/')} are not planned, and the default validator does not resolve them`,
      );
      return;
    }
    this.identities.push({
      kind: identity,
      facets,
      path: path.join('/'),
      adjustable: !fixed && !(this.options.userSupplied?.({ path, kind, ...names }) ?? false),
      validated: this.skipped === 0,
      ...access,
    });
  }

  private identityBoundary(facets: Facets): void {
    if (['ENTITY', 'ENTITIES', 'NOTATION'].includes(facets.builtin)) {
      this.problems.warning('identity-planning', 'entity and notation declarations are not used to plan values');
    }
    if (facets.item) this.identityBoundary(facets.item);
    for (const member of facets.members ?? []) this.identityBoundary(member);
  }

  private value(facets: Facets, path: readonly string[], kind: 'element' | 'attribute', names: TypeNames): string {
    const name = path.at(-1) ?? '';
    const value = this.options.values.value({
      facets,
      name,
      path,
      kind,
      rng: this.options.rng,
      ...names,
      scopes: [...this.scopes],
    });
    if (value === undefined) {
      this.problems.error('no-value', `no value satisfies the facets of ${path.join('/')}`);
      return '';
    }
    return value;
  }

  /** The named simple types of a value: the type itself if it has a name, then the bases of its restrictions. */
  private simpleTypeNames(type: QName | Element): TypeNames {
    let own: string | undefined;
    let node: Element | undefined;
    if ('nodeType' in type) {
      node = type;
    } else {
      if (type.ns === XS) return NO_TYPE_NAMES;
      own = clark(type.ns, type.local);
      node = this.set.lookup('simpleType', type)?.node;
    }
    const bases: string[] = [];
    const seen = new Set<Element>();
    while (node && !seen.has(node)) {
      seen.add(node);
      const restriction = xsChild(node, 'restriction');
      const base = restriction && attr(restriction, 'base');
      if (!restriction) break;
      if (base === undefined) {
        node = xsChild(restriction, 'simpleType');
        continue;
      }
      const name = this.set.resolveQName(restriction, base);
      if (name.ns === XS) break;
      bases.push(clark(name.ns, name.local));
      node = this.set.lookup('simpleType', name)?.node;
    }
    return own === undefined ? { baseTypeNames: bases } : { typeName: own, baseTypeNames: bases };
  }

  // --- complex types -------------------------------------------------------------------------------------------

  /** The content of an element of complex type; its instance is a scope for the values inside it. */
  private complex(
    out: InstanceElement,
    typeNode: Element,
    doc: SchemaDocument,
    path: readonly string[],
    depth: number,
    fixed: string | undefined,
    decl: Element,
  ): void {
    this.scopes.push({ name: out.name, path, instanceId: (this.instances += 1), state: new Map() });
    try {
      this.complexContent(out, typeNode, doc, path, depth, fixed, decl);
    } finally {
      this.scopes.pop();
    }
  }

  private complexContent(
    out: InstanceElement,
    typeNode: Element,
    doc: SchemaDocument,
    path: readonly string[],
    depth: number,
    fixed: string | undefined,
    decl: Element,
  ): void {
    const plan = this.plan(typeNode, doc);
    const scope = this.objectScope(plan.groups, plan.attributes);
    out.attributes = this.attributes(out, plan.attributes, path, depth);
    // Mixed content keeps its elements in the text property, so no attribute key can meet them.
    const keys = attributeKeys(plan.attributes, plan.mixed ? new Map() : scope.elements);
    for (const attribute of out.attributes) {
      const key = keys.get(clark(attribute.ns, attribute.name));
      if (key !== undefined) attribute.key = key;
    }
    if (out.nil) {
      // Attributes stay as the type declares them; content is not allowed.
      return;
    }
    if (plan.simple) {
      const named = attr(typeNode, 'name') !== undefined;
      const chain = plan.simpleTypes ?? [];
      const names: TypeNames = named
        ? { typeName: chain[0] ?? '', baseTypeNames: chain.slice(1) }
        : { baseTypeNames: chain };
      this.simpleText(out, plan.simple, path, fixed, decl, names);
      out.simpleContent = true;
      return;
    }
    if (plan.mixed && fixed !== undefined) {
      // A value constraint on mixed content is its text.
      out.children = [text(fixed)];
      out.mixed = true;
      return;
    }
    const children: InstanceNode[] = [];
    if (plan.mixed) {
      children.push(
        text(`${generateValue({ builtin: 'string', variety: 'atomic', patterns: [] }, this.options.rng) ?? 'Text'} `),
      );
    }
    const place = { scope, trail: [] };
    for (const group of plan.groups) {
      this.particle(group.node, group.doc, path, depth, children, new Set(), place);
    }
    out.children = children;
    if (plan.mixed) out.mixed = true;
  }

  /** Reads a content model once, branches not taken included, because JSON names must not depend on the sample. */
  private objectScope(
    models: readonly { node: Element; doc: SchemaDocument }[],
    attributes: ReadonlyMap<string, AttributeUse> = new Map(),
  ): ObjectScope {
    const scope: ObjectScope = {
      keys: new Map(),
      groupNames: new Map(),
      elements: new Map(),
      names: new Set(),
      elementKeys: new Map(),
      wildcards: new Map(),
    };
    for (const { node, doc } of models) this.declare(node, doc, scope, new Set());
    for (const key of [...scope.elements.keys(), ...attributes.keys()]) scope.names.add(localOf(key));
    // A local name of several namespaces is a collision: every one of them takes its expanded name.
    for (const names of byLocalName(scope.elements.keys()).values()) {
      if (names.length > 1) for (const name of names) scope.elementKeys.set(name, name);
    }
    return scope;
  }

  private declare(node: Element, doc: SchemaDocument, scope: ObjectScope, seen: Set<Element>): void {
    const { max } = occurs(node);
    if (max === 0 || seen.has(node)) return;
    const next = new Set([...seen, node]);
    if (node.localName === 'element') {
      const ref = attr(node, 'ref');
      const qualified = (attr(node, 'form') ?? (doc.elementQualified ? 'qualified' : 'unqualified')) === 'qualified';
      const name = ref
        ? this.set.resolveQName(node, ref)
        : { ns: qualified ? doc.targetNamespace : '', local: attr(node, 'name') ?? '' };
      // The members of a substitution group are declared here as well, each under its own name.
      const head = ref ? this.set.lookup('element', name) : undefined;
      const names = head ? substitutionCandidates(this.set, head).map(expandedName) : [clark(name.ns, name.local)];
      for (const key of names.length > 0 ? names : [clark(name.ns, name.local)]) {
        scope.elements.set(key, (scope.elements.get(key) ?? 0) + 1);
      }
    } else if (node.localName === 'group') {
      const group = this.set.reference('group', node);
      if (!group) return;
      if (max > 1) {
        claimGroupKey(scope, group.node, attr(group.node, 'name') ?? '');
      } else {
        for (const child of xsChildren(group.node)) this.declare(child, group.doc, scope, next);
      }
    } else if (MODEL_GROUPS.includes(node.localName ?? '')) {
      if (max > 1) {
        claimGroupKey(scope, node, node.localName ?? '');
      } else {
        for (const child of xsChildren(node)) this.declare(child, doc, scope, next);
      }
    }
  }

  /** How to enter each occurrence of a model group: a repeated group is an object per occurrence. */
  private entering(
    group: Element,
    max: number,
    place: Place,
    members: readonly Element[],
    doc: SchemaDocument,
  ): () => Place {
    if (max <= 1) return () => place;
    const key = place.scope.keys.get(group) ?? '';
    const scope = this.objectScope(members.map((node) => ({ node, doc })));
    return () => ({ scope, trail: [...place.trail, { key, occurrence: (this.occurrences += 1) }] });
  }

  /**
   * The declarations that may occur for an element particle that refers to the head of a substitution group: the
   * head unless abstract, and the allowed members. Undefined for a particle without alternatives.
   */
  private substitutes(particle: Element): Component[] | undefined {
    const ref = attr(particle, 'ref');
    const head = ref === undefined ? undefined : this.set.lookup('element', this.set.resolveQName(particle, ref));
    if (!head) return undefined;
    const all = substitutionCandidates(this.set, head);
    // A member that cannot be generated is not offered, unless no other is left.
    const available = all.filter((c) => !declarationUnavailable(this.set, c.node));
    const candidates = available.length > 0 ? available : all;
    return candidates.length === 1 && candidates[0]?.node === head.node ? undefined : candidates;
  }

  private placed(child: InstanceElement, max: number, place: Place): void {
    const name = clark(child.ns, child.name);
    child.repeatable = max > 1 || (place.scope.elements.get(name) ?? 0) > 1;
    const key = place.scope.elementKeys.get(name);
    if (key !== undefined) child.key = key;
    if (place.trail.length > 0) child.groups = [...place.trail];
  }

  /** The content of a complex type, following its derivation down to the base types. */
  private plan(typeNode: Element, doc: SchemaDocument, seen = new Set<Element>()): ContentPlan {
    const empty: ContentPlan = { groups: [], attributes: new Map(), mixed: false };
    if (seen.has(typeNode)) {
      this.problems.error('circular-type', 'circular complex type derivation', this.set.at(typeNode));
      return empty;
    }
    seen.add(typeNode);
    const simpleContent = xsChild(typeNode, 'simpleContent');
    const complexContent = xsChild(typeNode, 'complexContent');
    const derivation = simpleContent
      ? xsChildren(simpleContent)[0]
      : complexContent
        ? xsChildren(complexContent)[0]
        : undefined;
    let base = empty;
    let baseFacets: Facets | undefined;
    let baseTypes: string[] = [];
    if (derivation) {
      const baseName = this.set.resolveQName(derivation, attr(derivation, 'base') ?? '');
      const baseType = baseName.ns === XS ? undefined : this.set.lookup('complexType', baseName);
      if (baseType) {
        base = this.plan(baseType.node, baseType.doc, seen);
        baseFacets = base.simple;
        baseTypes = base.simpleTypes ?? [];
      } else if (simpleContent) {
        baseFacets = this.facets.read(baseName, derivation);
        const names = this.simpleTypeNames(baseName);
        baseTypes = names.typeName === undefined ? names.baseTypeNames : [names.typeName, ...names.baseTypeNames];
      } else if (!(baseName.ns === XS && baseName.local === 'anyType')) {
        this.problems.error(
          'unknown-type',
          `base type ${attr(derivation, 'base')} is not defined`,
          this.set.at(derivation),
        );
      }
    }
    const owner = derivation ?? typeNode;
    const attributes = new Map(base.attributes);
    this.collectAttributes(owner, doc, attributes, new Set());
    if (simpleContent && derivation) {
      const facets = baseFacets ?? { builtin: 'string', variety: 'atomic' as const, patterns: [] };
      const simple = derivation.localName === 'restriction' ? this.facets.restrict(facets, derivation) : facets;
      const name = attr(typeNode, 'name');
      const simpleTypes = name === undefined ? baseTypes : [clark(doc.targetNamespace, name), ...baseTypes];
      return { groups: [], attributes, simple, simpleTypes, mixed: false };
    }
    const own = xsChildren(owner).find((c) => MODEL_GROUPS.includes(c.localName ?? ''));
    const groups = own ? [{ node: own, doc }] : [];
    const extension = derivation?.localName === 'extension';
    // mixed on complexContent wins over mixed on the type. An extension that says nothing keeps the mixed content of
    // its base, as libxml2 does.
    const flag = (value: string | undefined) =>
      value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : undefined;
    const declared = flag(complexContent && attr(complexContent, 'mixed')) ?? flag(attr(typeNode, 'mixed'));
    return {
      groups: extension ? [...base.groups, ...groups] : groups,
      attributes,
      mixed: declared ?? (extension && base.mixed),
    };
  }

  /** Adds the attributes of a type or derivation; a later use replaces one of the same name, prohibited removes it. */
  private collectAttributes(
    owner: Element,
    doc: SchemaDocument,
    into: Map<string, AttributeUse>,
    seen: Set<Element>,
  ): void {
    for (const child of xsChildren(owner)) {
      if (child.localName === 'attribute') {
        const ref = attr(child, 'ref');
        const form = attr(child, 'form');
        const localNs = (form === undefined ? doc.attributeQualified : form === 'qualified') ? doc.targetNamespace : '';
        const qn =
          ref === undefined ? { ns: localNs, local: attr(child, 'name') ?? '' } : this.set.resolveQName(child, ref);
        const key = clark(qn.ns, qn.local);
        if (attr(child, 'use') === 'prohibited') {
          into.delete(key);
        } else {
          into.set(key, { node: child, doc });
        }
      } else if (child.localName === 'attributeGroup') {
        const ref = attr(child, 'ref') ?? '';
        const group = this.set.reference('attributeGroup', child);
        if (!group) {
          this.problems.error('unknown-group', `attribute group ${ref} is not defined`, this.set.at(child));
        } else if (seen.has(group.node)) {
          this.problems.error('circular-group', `attribute group ${ref} refers to itself`, this.set.at(child));
        } else {
          this.collectAttributes(group.node, group.doc, into, new Set([...seen, group.node]));
        }
      }
    }
  }

  private attributes(
    owner: InstanceElement,
    uses: Map<string, AttributeUse>,
    path: readonly string[],
    depth: number,
  ): InstanceAttribute[] {
    const out: InstanceAttribute[] = [];
    for (const use of uses.values()) {
      if (attr(use.node, 'use') !== 'required' && !this.includeOptional(depth, 'attribute')) {
        continue;
      }
      let decl = use.node;
      let ns: string;
      const ref = attr(use.node, 'ref');
      if (ref !== undefined) {
        const global = this.set.lookup('attribute', this.set.resolveQName(use.node, ref));
        if (!global) {
          this.problems.error('unknown-attribute', `attribute ${ref} is not defined`, this.set.at(use.node));
          continue;
        }
        decl = global.node;
        ns = global.doc.targetNamespace;
      } else {
        const form = attr(use.node, 'form');
        ns = (form === undefined ? use.doc.attributeQualified : form === 'qualified') ? use.doc.targetNamespace : '';
      }
      const name = attr(decl, 'name') ?? '';
      const typeName = attr(decl, 'type');
      const anonymous = xsChild(decl, 'simpleType');
      const typeQName = typeName === undefined ? undefined : this.set.resolveQName(decl, typeName);
      const facets = typeQName
        ? this.facets.read(typeQName, decl)
        : anonymous
          ? this.facets.read(anonymous)
          : this.facets.read({ ns: XS, local: 'anySimpleType' });
      const names = typeQName
        ? this.simpleTypeNames(typeQName)
        : anonymous
          ? this.simpleTypeNames(anonymous)
          : NO_TYPE_NAMES;
      const fixed =
        attr(use.node, 'fixed') ?? attr(decl, 'fixed') ?? attr(use.node, 'default') ?? attr(decl, 'default');
      this.identityBoundary(facets);
      const value = fixed ?? this.value(facets, [...path, name], 'attribute', names);
      const constrained = attr(use.node, 'fixed') !== undefined || attr(use.node, 'default') !== undefined;
      const scope = fixed === undefined ? (enumerationScope(facets, value) ?? decl) : constrained ? use.node : decl;
      this.bindPrefixes(owner, facets, value, scope, fixed === undefined);
      const form = jsonFormOf(facets);
      const attribute: InstanceAttribute = { ns, name, value, type: form.type, ...(form.list ? { list: true } : {}) };
      out.push(attribute);
      this.written.push({ facets, holder: attribute });
      this.identity(facets, [...path, name], 'attribute', names, fixed !== undefined, {
        get: () => attribute.value,
        set: (v) => {
          attribute.value = v;
        },
      });
    }
    return out;
  }

  // --- content models ------------------------------------------------------------------------------------------

  private includeOptional(depth: number, kind: 'element' | 'attribute' = 'element'): boolean {
    const mode =
      kind === 'attribute'
        ? (this.options.optionalAttributes ?? this.options.optional)
        : (this.options.optionalElements ?? this.options.optional);
    if (mode === 'none' || (kind === 'element' && depth >= this.options.maxDepth)) return false;
    return mode === 'all' || this.options.rng.chance(RANDOM_OPTIONAL_CHANCE);
  }

  /** Requested multiplicity is independent of whether optional particles are included. */
  count(min: number, max: number, depth: number): number {
    if (min === 0 && !this.includeOptional(depth)) return 0;
    return Math.min(max, Math.max(min, this.options.repeat));
  }

  /** Adds the instances of one particle (element, model group, group reference) to `out`. */
  private particle(
    node: Element,
    doc: SchemaDocument,
    path: readonly string[],
    depth: number,
    out: InstanceNode[],
    groups: Set<Element>,
    place: Place,
  ): void {
    const { min, max } = occurs(node);
    if (max === 0) {
      return;
    }
    if (
      !Number.isSafeInteger(min) ||
      min < 0 ||
      (!(Number.isSafeInteger(max) && max >= 0) && max !== Infinity) ||
      min > max
    ) {
      this.problems.error('invalid-facet', 'invalid occurrence range', this.set.at(node));
      return;
    }
    const times = this.count(min, max, depth);
    if (times > (this.options.maxNodes ?? 10000)) throw new LimitError('particle occurrence count exceeds maxNodes');
    switch (node.localName) {
      case 'element': {
        const members = this.substitutes(node);
        if (members?.length === 0 && times > 0) {
          this.problems.error(
            'unsupported',
            `${attr(node, 'ref')} is abstract and no member of its substitution group may replace it`,
            this.set.at(node),
          );
          return;
        }
        for (let k = 0; k < times; k += 1) {
          if (!members) {
            const child = this.element(node, doc, path, depth + 1, false);
            if (child) {
              this.placed(child, max, place);
              out.push(child);
            }
            continue;
          }
          // A template writes every member; an instance one per occurrence of the particle.
          const indices = this.options.allBranches
            ? members.map((_, i) => i)
            : [members.length === 1 ? 0 : this.decide('substitution', node, members, path, depth)];
          for (const index of indices) {
            const member = members[index];
            const child = member && this.element(member.node, member.doc, path, depth + 1, true);
            if (child) {
              this.placed(child, max, place);
              out.push(child);
            }
          }
        }
        return;
      }
      case 'sequence':
      case 'all': {
        const members = xsChildren(node);
        const enter = this.entering(node, max, place, members, doc);
        for (let k = 0; k < times; k += 1) {
          const inner = enter();
          for (const child of members) {
            this.particle(child, doc, path, depth, out, groups, inner);
          }
        }
        return;
      }
      case 'choice': {
        // A branch that cannot be generated is not offered, unless no other is left.
        const possible = xsChildren(node).filter((c) => occurs(c).max > 0);
        const available = possible.filter((c) => !particleUnavailable(this.set, c));
        const branches = available.length > 0 ? available : possible;
        const enter = this.entering(node, max, place, branches, doc);
        for (let k = 0; k < times && branches.length > 0; k += 1) {
          const index = this.ask({ node, branches, path, depth, kind: 'choice' });
          // A template writes every branch; in XML each one is an occurrence of the choice of its own.
          const indices = this.options.allBranches ? branches.map((_, i) => i) : [index];
          for (const selected of indices) {
            const branch = branches[selected];
            if (branch) {
              this.choices.push({ id: choiceId(this.set, node), branch: selected, branches: branches.length });
              this.particle(branch, doc, path, depth, out, groups, enter());
            }
          }
        }
        return;
      }
      case 'group': {
        const ref = attr(node, 'ref') ?? '';
        const group = this.set.reference('group', node);
        if (!group) {
          this.problems.error('unknown-group', `group ${ref} is not defined`, this.set.at(node));
          return;
        }
        if (groups.has(group.node)) {
          this.problems.error('circular-group', `group ${ref} contains itself`, this.set.at(node));
          return;
        }
        const compositor = xsChildren(group.node)[0];
        const enter = this.entering(group.node, max, place, compositor ? [compositor] : [], group.doc);
        for (let k = 0; k < times && compositor; k += 1) {
          this.particle(compositor, group.doc, path, depth, out, new Set([...groups, group.node]), enter());
        }
        return;
      }
      case 'any':
        for (let k = 0; k < times; k += 1) {
          const child = this.wildcard(node, doc, path, depth + 1, place.scope);
          if (child) {
            this.placed(child, max, place);
            out.push(child);
          }
        }
        return;
      default:
        this.problems.error('unsupported', `xs:${node.localName} is not supported here`, this.set.at(node));
    }
  }

  /**
   * An element for xs:any: a global element of an allowed namespace if the schema has one; otherwise, unless the
   * wildcard is strict, an element of our own in an allowed namespace. Names declared in the same JSON object are
   * left out, because the schemaless JSON mapping of wildcard content would collide with them, and so are names that
   * wildcard content of another namespace already uses there.
   */
  private wildcard(
    node: Element,
    doc: SchemaDocument,
    path: readonly string[],
    depth: number,
    scope: ObjectScope,
  ): InstanceElement | undefined {
    const free = (local: string, ns: string) => !scope.names.has(local) && (scope.wildcards.get(local) ?? ns) === ns;
    const used = (out: InstanceElement | undefined) => {
      if (out) scope.wildcards.set(out.name, out.ns);
      return out;
    };
    const spec = splitXmlSpace(attr(node, 'namespace') ?? '##any');
    const allowed = (ns: string) =>
      spec.some(
        (s) =>
          s === '##any' ||
          (s === '##other' && ns !== '' && ns !== doc.targetNamespace) ||
          (s === '##local' && ns === '') ||
          (s === '##targetNamespace' && ns === doc.targetNamespace) ||
          s === ns,
      );
    const candidates = [...this.set.components.element.values()].filter(
      (c) =>
        allowed(c.doc.targetNamespace) &&
        !isAbstract(c.node) &&
        !path.includes(attr(c.node, 'name') ?? '') &&
        free(attr(c.node, 'name') ?? '', c.doc.targetNamespace),
    );
    if (candidates.length > 0) {
      const chosen = this.options.rng.pick(candidates);
      const skip = attr(node, 'processContents') === 'skip' ? 1 : 0;
      this.schemaless += 1;
      this.skipped += skip;
      try {
        const out = this.element(chosen.node, chosen.doc, path, depth, true);
        if (out) out.wildcard = true;
        return used(out);
      } finally {
        this.schemaless -= 1;
        this.skipped -= skip;
      }
    }
    if ((attr(node, 'processContents') ?? 'strict') === 'strict') {
      this.problems.error(
        'unsupported',
        'no global element of the schema matches this strict xs:any',
        this.set.at(node),
      );
      return undefined;
    }
    const first = spec[0] ?? '##any';
    const ns =
      first === '##local'
        ? ''
        : first === '##targetNamespace'
          ? doc.targetNamespace
          : first.startsWith('##')
            ? 'urn:xsd-faker:any'
            : first;
    let name = 'any';
    for (let n = 2; !free(name, ns); n += 1) name = `any${n}`;
    const out = element(ns, name, { children: [text('any content')] });
    out.wildcard = true;
    return used(out);
  }
}

/**
 * The JSON property of a repeated group: `#sequence`, `#choice`, or `#` and the name of a referenced group; a further
 * group of the same name adds `:2`, `:3`. The same group reached twice shares its property.
 */
/** The local name of an expanded name `{ns}local`. */
function localOf(name: string): string {
  return name.slice(name.indexOf('}') + 1);
}

/** Expanded names grouped by local name. */
function byLocalName(names: Iterable<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const name of names) {
    const local = localOf(name);
    out.set(local, [...(out.get(local) ?? []), name]);
  }
  return out;
}

/**
 * The JSON keys of attributes that collide, planned from the type: a local name of several attribute namespaces
 * gives each `@{ns}local`, an attribute named like an element `@local`; the element keeps its name.
 */
function attributeKeys(
  attributes: ReadonlyMap<string, unknown>,
  elements: ReadonlyMap<string, unknown>,
): Map<string, string> {
  const elementNames = new Set([...elements.keys()].map(localOf));
  const out = new Map<string, string>();
  for (const [local, names] of byLocalName(attributes.keys())) {
    for (const name of names) {
      if (names.length > 1) out.set(name, `@${name}`);
      else if (elementNames.has(local)) out.set(name, `@${local}`);
    }
  }
  return out;
}

function claimGroupKey(scope: ObjectScope, group: Element, name: string): void {
  if (scope.keys.has(group)) return;
  const count = (scope.groupNames.get(name) ?? 0) + 1;
  scope.groupNames.set(name, count);
  scope.keys.set(group, count === 1 ? `#${name}` : `#${name}:${count}`);
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
  /** A declaration: its type, or with several types xsi:type can name, that decision and each of the types. */
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
