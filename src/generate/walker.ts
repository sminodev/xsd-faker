// Walks the declarations of an XML Schema from a root element and builds one instance tree.
//
// Complex types: attributes from the type, its derivation chain and attribute groups; content from sequence, choice,
// all and group references, in document order. An extension puts the content of its base first; a restriction
// states its content itself. Simple content and simple types get a value from the ValueSource.

import type { Element } from '@xmldom/xmldom';
import type { Rng } from '../rng.js';
import type { ValueSource } from '../values/source.js';
import { generateValue } from '../values/generate.js';
import { element, type InstanceAttribute, type InstanceElement, type InstanceNode, text } from '../xml/tree.js';
import { FacetReader, type Facets, jsonTypeOf } from '../xsd/facets.js';
import type { Problems } from '../xsd/problems.js';
import {
  attr,
  type Component,
  type SchemaDocument,
  type SchemaSet,
  XS,
  clark,
  xsChild,
  xsChildren,
} from '../xsd/schema-set.js';

export type OptionalMode = 'none' | 'all' | 'random';

export interface ChoiceContext {
  /** the xs:choice element */
  node: Element;
  /** its particles that may occur (maxOccurs > 0) */
  branches: Element[];
  path: readonly string[];
  set: SchemaSet;
  rng: Rng;
}

/** Picks the branch of a choice, as an index into `branches`. */
export type ChoiceStrategy = (choice: ChoiceContext) => number;

export interface WalkOptions {
  /** Shorthand for both policies; separate element and attribute settings take precedence. */
  optional: OptionalMode;
  optionalElements?: OptionalMode;
  optionalAttributes?: OptionalMode;
  allBranches?: boolean;
  maxTotalDepth?: number;
  maxNodes?: number;
  /** How often a repeatable element occurs: at least minOccurs, at most maxOccurs. */
  repeat: number;
  choice: ChoiceStrategy;
  /** Beyond this depth only required content is generated, so recursive types end. */
  maxDepth: number;
  values: ValueSource;
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

/** Whether a particle declares or refers to an element of that local name; looks into model groups, not into types. */
function mentions(set: SchemaSet, particle: Element, name: string, seen: Set<Element>): boolean {
  switch (particle.localName) {
    case 'element': {
      const ref = attr(particle, 'ref');
      return (ref === undefined ? attr(particle, 'name') : ref.slice(ref.indexOf(':') + 1)) === name;
    }
    case 'sequence':
    case 'choice':
    case 'all':
      return xsChildren(particle).some((c) => mentions(set, c, name, seen));
    case 'group': {
      const group = set.lookup('group', set.resolveQName(particle, attr(particle, 'ref') ?? ''));
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
  mixed: boolean;
}

const MODEL_GROUPS = ['sequence', 'choice', 'all', 'group'];
/** Required content nested deeper than maxDepth + this is reported instead of generated. */
const DEPTH_RESERVE = 25;

/** A generation budget was exceeded, distinct from errors in user callbacks. */
export class LimitError extends Error {}

export class Walker {
  private readonly facets: FacetReader;
  private nodes = 0;
  readonly choices: { id: string; branch: number; branches: number }[] = [];

  constructor(
    private readonly set: SchemaSet,
    private readonly problems: Problems,
    private readonly options: WalkOptions,
  ) {
    this.facets = new FacetReader(set, problems);
  }

  /** The instance of a global element. */
  root(component: Component): InstanceElement {
    return this.element(component.node, component.doc, [], 0, { global: true, repeatable: false }) ?? element('', '');
  }

  // --- elements ------------------------------------------------------------------------------------------------

  private element(
    node: Element,
    doc: SchemaDocument,
    path: readonly string[],
    depth: number,
    how: { global: boolean; repeatable: boolean },
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
      const global = this.set.lookup('element', this.set.resolveQName(node, ref));
      if (!global) {
        this.problems.error('unknown-element', `element ${ref} is not defined`, this.set.at(node));
        return undefined;
      }
      decl = global.node;
      declDoc = global.doc;
      ns = global.doc.targetNamespace;
    } else if (how.global) {
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
    if (['true', '1'].includes(attr(decl, 'abstract') ?? '')) {
      this.problems.error(
        'unsupported',
        `${name} is abstract; substitution groups are not supported`,
        this.set.at(decl),
      );
    }
    const out = element(ns, name, { repeatable: how.repeatable });
    const fixed = attr(decl, 'fixed') ?? attr(decl, 'default');
    const typeName = attr(decl, 'type');
    const anonymousComplex = xsChild(decl, 'complexType');
    const anonymousSimple = xsChild(decl, 'simpleType');
    if (typeName !== undefined) {
      const qname = this.set.resolveQName(decl, typeName);
      const complex = qname.ns === XS ? undefined : this.set.lookup('complexType', qname);
      if (complex) {
        this.complex(out, complex.node, complex.doc, here, depth, fixed);
      } else if (!(qname.ns === XS && qname.local === 'anyType')) {
        this.simpleText(out, this.facets.read(qname, decl), here, fixed);
      }
    } else if (anonymousComplex) {
      this.complex(out, anonymousComplex, declDoc, here, depth, fixed);
    } else if (anonymousSimple) {
      this.simpleText(out, this.facets.read(anonymousSimple), here, fixed);
    }
    return out;
  }

  private simpleText(out: InstanceElement, facets: Facets, path: readonly string[], fixed: string | undefined): void {
    this.identityBoundary(facets);
    const value = fixed ?? this.value(facets, path, 'element');
    out.children = [text(value, jsonTypeOf(facets))];
  }

  private identityBoundary(facets: Facets): void {
    if (['IDREF', 'IDREFS'].includes(facets.builtin)) {
      this.problems.error(
        'identity-planning',
        'IDREF integrity is not checked by the default validator; reference planning is unsupported',
      );
    }
    if (['ENTITY', 'ENTITIES', 'NOTATION'].includes(facets.builtin)) {
      this.problems.warning('identity-planning', 'entity and notation declarations are not used to plan values');
    }
    if (facets.item) this.identityBoundary(facets.item);
    for (const member of facets.members ?? []) this.identityBoundary(member);
  }

  private value(facets: Facets, path: readonly string[], kind: 'element' | 'attribute'): string {
    const name = path.at(-1) ?? '';
    const value = this.options.values.value({ facets, name, path, kind, rng: this.options.rng });
    if (value === undefined) {
      this.problems.error('no-value', `no value satisfies the facets of ${path.join('/')}`);
      return '';
    }
    return value;
  }

  // --- complex types -------------------------------------------------------------------------------------------

  private complex(
    out: InstanceElement,
    typeNode: Element,
    doc: SchemaDocument,
    path: readonly string[],
    depth: number,
    fixed: string | undefined,
  ): void {
    const plan = this.plan(typeNode, doc);
    out.attributes = this.attributes(plan.attributes, path, depth);
    if (plan.simple) {
      this.simpleText(out, plan.simple, path, fixed);
      return;
    }
    const children: InstanceNode[] = [];
    if (plan.mixed) {
      children.push(
        text(`${generateValue({ builtin: 'string', variety: 'atomic', patterns: [] }, this.options.rng) ?? 'Text'} `),
      );
    }
    for (const group of plan.groups) {
      this.particle(group.node, group.doc, path, depth, children);
    }
    const counts = new Map<string, number>();
    for (const group of plan.groups) this.childNames(group.node, group.doc, counts);
    for (const child of children) {
      if (child.kind === 'element' && (counts.get(clark(child.ns, child.name)) ?? 0) > 1) child.repeatable = true;
    }
    out.children = children;
    if (plan.mixed) out.mixed = true;
  }

  private childNames(node: Element, doc: SchemaDocument, counts: Map<string, number>, seen = new Set<Element>()): void {
    if (occurs(node).max === 0 || seen.has(node)) return;
    const next = new Set([...seen, node]);
    if (node.localName === 'element') {
      const ref = attr(node, 'ref');
      const qualified = (attr(node, 'form') ?? (doc.elementQualified ? 'qualified' : 'unqualified')) === 'qualified';
      const name = ref
        ? this.set.resolveQName(node, ref)
        : { ns: qualified ? doc.targetNamespace : '', local: attr(node, 'name') ?? '' };
      const key = clark(name.ns, name.local);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    } else if (node.localName === 'group') {
      const group = this.set.lookup('group', this.set.resolveQName(node, attr(node, 'ref') ?? ''));
      if (group) this.childNames(group.node, group.doc, counts, next);
      // A global group has no ref: visit its compositor.
      else for (const child of xsChildren(node)) this.childNames(child, doc, counts, next);
    } else {
      for (const child of xsChildren(node)) this.childNames(child, doc, counts, next);
    }
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
    if (derivation) {
      const baseName = this.set.resolveQName(derivation, attr(derivation, 'base') ?? '');
      const baseType = baseName.ns === XS ? undefined : this.set.lookup('complexType', baseName);
      if (baseType) {
        base = this.plan(baseType.node, baseType.doc, seen);
        baseFacets = base.simple;
      } else if (simpleContent) {
        baseFacets = this.facets.read(baseName, derivation);
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
      return { groups: [], attributes, simple, mixed: false };
    }
    const own = xsChildren(owner).find((c) => MODEL_GROUPS.includes(c.localName ?? ''));
    const groups = own ? [{ node: own, doc }] : [];
    const extension = derivation?.localName === 'extension';
    return {
      groups: extension ? [...base.groups, ...groups] : groups,
      attributes,
      mixed:
        attr(typeNode, 'mixed') === 'true' ||
        (complexContent !== undefined && attr(complexContent, 'mixed') === 'true'),
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
        const group = this.set.lookup('attributeGroup', this.set.resolveQName(child, ref));
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

  private attributes(uses: Map<string, AttributeUse>, path: readonly string[], depth: number): InstanceAttribute[] {
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
      const facets = typeName
        ? this.facets.read(this.set.resolveQName(decl, typeName), decl)
        : anonymous
          ? this.facets.read(anonymous)
          : this.facets.read({ ns: XS, local: 'anySimpleType' });
      const fixed =
        attr(use.node, 'fixed') ?? attr(decl, 'fixed') ?? attr(use.node, 'default') ?? attr(decl, 'default');
      this.identityBoundary(facets);
      const value = fixed ?? this.value(facets, [...path, name], 'attribute');
      out.push({ ns, name, value, type: jsonTypeOf(facets) });
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
    return mode === 'all' || this.options.rng.chance(0.5);
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
    groups = new Set<Element>(),
    inheritedRepeatable = false,
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
      case 'element':
        for (let k = 0; k < times; k += 1) {
          const child = this.element(node, doc, path, depth + 1, {
            global: false,
            repeatable: max > 1 || inheritedRepeatable,
          });
          if (child) {
            out.push(child);
          }
        }
        return;
      case 'sequence':
      case 'all':
        for (let k = 0; k < times; k += 1) {
          for (const child of xsChildren(node)) {
            this.particle(child, doc, path, depth, out, groups, inheritedRepeatable || max > 1);
          }
        }
        return;
      case 'choice': {
        const branches = xsChildren(node).filter((c) => occurs(c).max > 0);
        for (let k = 0; k < times && branches.length > 0; k += 1) {
          const index = this.options.choice({ node, branches, path, set: this.set, rng: this.options.rng });
          if (!Number.isInteger(index) || index < 0 || index >= branches.length) {
            throw new RangeError('choice strategy returned an invalid branch index');
          }
          const indices = this.options.allBranches ? branches.map((_, i) => i) : [index];
          for (const selected of indices) {
            const branch = branches[selected];
            if (branch) {
              this.choices.push({ id: choiceId(this.set, node), branch: selected, branches: branches.length });
              this.particle(branch, doc, path, depth, out, groups, inheritedRepeatable || max > 1);
            }
          }
        }
        return;
      }
      case 'group': {
        const ref = attr(node, 'ref') ?? '';
        const group = this.set.lookup('group', this.set.resolveQName(node, ref));
        if (!group) {
          this.problems.error('unknown-group', `group ${ref} is not defined`, this.set.at(node));
          return;
        }
        if (groups.has(group.node)) {
          this.problems.error('circular-group', `group ${ref} contains itself`, this.set.at(node));
          return;
        }
        const compositor = xsChildren(group.node)[0];
        for (let k = 0; k < times && compositor; k += 1) {
          this.particle(
            compositor,
            group.doc,
            path,
            depth,
            out,
            new Set([...groups, group.node]),
            inheritedRepeatable || max > 1,
          );
        }
        return;
      }
      case 'any':
        for (let k = 0; k < times; k += 1) {
          const child = this.wildcard(node, doc, path, depth + 1, max > 1 || inheritedRepeatable);
          if (child) {
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
   * wildcard is strict, an element of our own in an allowed namespace.
   */
  private wildcard(
    node: Element,
    doc: SchemaDocument,
    path: readonly string[],
    depth: number,
    repeatable: boolean,
  ): InstanceElement | undefined {
    const spec = (attr(node, 'namespace') ?? '##any').trim().split(/\s+/);
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
        attr(c.node, 'abstract') !== 'true' &&
        !path.includes(attr(c.node, 'name') ?? ''),
    );
    if (candidates.length > 0) {
      const chosen = this.options.rng.pick(candidates);
      return this.element(chosen.node, chosen.doc, path, depth, { global: true, repeatable });
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
    return element(ns, 'any', { repeatable, children: [text('any content')] });
  }
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

/** Fewest required descendant elements; recursive paths have infinite cost. */
export const smallestBranch: ChoiceStrategy = ({ branches, set }) => {
  const cache = new Map<Element, number>();
  let cycles = 0;
  const cost = (node: Element, seen: Set<Element>): number => {
    if (seen.has(node)) {
      cycles += 1;
      return Infinity;
    }
    const cached = cache.get(node);
    if (cached !== undefined) return cached;
    const before = cycles;
    const result = compute(node, seen);
    if (cycles === before) cache.set(node, result);
    return result;
  };
  const compute = (node: Element, seen: Set<Element>): number => {
    const min = occurs(node).min;
    if (min === 0) return 0;
    const next = new Set([...seen, node]);
    const kind = node.localName;
    if (kind === 'element') {
      const ref = attr(node, 'ref');
      if (ref !== undefined) {
        const target = set.lookup('element', set.resolveQName(node, ref));
        return target ? min * cost(target.node, next) : Infinity;
      }
      const type = attr(node, 'type');
      const complex = type
        ? set.lookup('complexType', set.resolveQName(node, type))?.node
        : xsChild(node, 'complexType');
      return min * (1 + (complex ? cost(complex, next) : 0));
    }
    if (kind === 'group') {
      const target = set.lookup('group', set.resolveQName(node, attr(node, 'ref') ?? ''));
      return target ? min * xsChildren(target.node).reduce((sum, c) => sum + cost(c, next), 0) : Infinity;
    }
    const children = xsChildren(node).filter(
      (c) => !['attribute', 'attributeGroup', 'simpleType'].includes(c.localName ?? ''),
    );
    if (kind === 'choice') return min * Math.min(...children.map((c) => cost(c, next)));
    let base = 0;
    if (kind === 'extension') {
      const inherited = set.lookup('complexType', set.resolveQName(node, attr(node, 'base') ?? ''));
      if (inherited) base = cost(inherited.node, next);
    }
    return min * (base + children.reduce((sum, c) => sum + cost(c, next), 0));
  };
  let selected = 0;
  let best = Infinity;
  branches.forEach((branch, index) => {
    const value = cost(branch, new Set());
    if (value < best) {
      best = value;
      selected = index;
    }
  });
  return selected;
};
