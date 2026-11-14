// The alternatives XML Schema allows in place of a declaration: the members of a substitution group instead of its
// head, and with xsi:type the complex types derived from an element's declared complex type. Both follow XML Schema
// 1.0 Structures: Substitution Group OK (Transitive), 3.3.6, and Element Locally Valid (Element) 4.3 with Type
// Derivation OK (Complex), 3.4.6. Abstract declarations and types are never alternatives themselves.

import type { Element } from '@xmldom/xmldom';
import { attr, clark, type Component, type QName, type SchemaSet, XS, xsChild, xsChildren } from '../xsd/schema-set.js';
import { splitXmlSpace } from '../xml/space.js';

type Method = 'extension' | 'restriction' | 'substitution';

/** Declared type; substitution group members without an explicit type inherit the head's type. */
export type DeclaredType =
  { kind: 'named'; qname: QName; from: Element } | { kind: 'anonymous'; node: Element } | { kind: 'none' };

/** A type: a definition in the schema set, or a built-in type by its local name. */
type TypeRef = Element | string;

/** The base of each built-in type that is not primitive; primitives derive from anySimpleType. */
const BUILTIN_BASE: Readonly<Record<string, string>> = {
  normalizedString: 'string',
  token: 'normalizedString',
  language: 'token',
  Name: 'token',
  NCName: 'Name',
  ID: 'NCName',
  IDREF: 'NCName',
  ENTITY: 'NCName',
  NMTOKEN: 'token',
  integer: 'decimal',
  nonPositiveInteger: 'integer',
  negativeInteger: 'nonPositiveInteger',
  long: 'integer',
  int: 'long',
  short: 'int',
  byte: 'short',
  nonNegativeInteger: 'integer',
  unsignedLong: 'nonNegativeInteger',
  unsignedInt: 'unsignedLong',
  unsignedShort: 'unsignedInt',
  unsignedByte: 'unsignedShort',
  positiveInteger: 'nonNegativeInteger',
  anySimpleType: 'anyType',
};

export const isAbstract = (node: Element): boolean => ['true', '1'].includes(attr(node, 'abstract') ?? '');

/** The head of a declaration's substitution group, if it names one that exists. */
function headOf(set: SchemaSet, decl: Element): Component | undefined {
  const name = splitXmlSpace(attr(decl, 'substitutionGroup') ?? '')[0];
  return name ? set.lookup('element', set.resolveQName(decl, name)) : undefined;
}

export function declaredType(set: SchemaSet, decl: Element, seen = new Set<Element>()): DeclaredType {
  const name = attr(decl, 'type');
  if (name !== undefined) return { kind: 'named', qname: set.resolveQName(decl, name), from: decl };
  const anonymous = xsChild(decl, 'complexType') ?? xsChild(decl, 'simpleType');
  if (anonymous) return { kind: 'anonymous', node: anonymous };
  seen.add(decl);
  const head = headOf(set, decl);
  return head && !seen.has(head.node) ? declaredType(set, head.node, seen) : { kind: 'none' };
}

/** A named type as a definition of the set, or the local name of a built-in type. */
function typeRef(set: SchemaSet, qname: QName): TypeRef | undefined {
  if (qname.ns === XS) return qname.local;
  return set.lookup('complexType', qname)?.node ?? set.lookup('simpleType', qname)?.node;
}

function typeOf(set: SchemaSet, decl: Element): TypeRef | undefined {
  const declared = declaredType(set, decl);
  if (declared.kind === 'named') return typeRef(set, declared.qname);
  return declared.kind === 'anonymous' ? declared.node : 'anyType';
}

/** One derivation step: derived type, method and base type. */
interface Step {
  type: TypeRef;
  method: 'extension' | 'restriction';
  base: TypeRef;
}

function baseStep(set: SchemaSet, type: TypeRef): Step | undefined {
  if (typeof type === 'string') {
    const base = BUILTIN_BASE[type] ?? (type === 'anyType' ? undefined : 'anySimpleType');
    return base === undefined ? undefined : { type, method: 'restriction', base };
  }
  const content = xsChild(type, 'simpleContent') ?? xsChild(type, 'complexContent');
  const derivation = content ? xsChildren(content)[0] : xsChild(type, 'restriction');
  const name = derivation && attr(derivation, 'base');
  if (!derivation || name === undefined) {
    // A complex type without derivation restricts anyType; a list or union is derived from anySimpleType.
    return { type, method: 'restriction', base: type.localName === 'complexType' ? 'anyType' : 'anySimpleType' };
  }
  const base = typeRef(set, set.resolveQName(derivation, name));
  return base === undefined
    ? undefined
    : { type, method: derivation.localName === 'extension' ? 'extension' : 'restriction', base };
}

/** The steps from `type` up to `ancestor`, or undefined if it does not derive from it. */
function derivation(set: SchemaSet, type: TypeRef, ancestor: TypeRef): Step[] | undefined {
  const steps: Step[] = [];
  const seen = new Set<TypeRef>();
  for (let current: TypeRef = type; current !== ancestor;) {
    if (seen.has(current)) return undefined;
    seen.add(current);
    const step = baseStep(set, current);
    if (!step) return undefined;
    steps.push(step);
    current = step.base;
  }
  return steps;
}

/** A block or final value as a set of methods; `#all` means all of them. */
function methods(value: string | undefined): Set<Method> {
  const words = splitXmlSpace(value ?? '');
  return new Set(
    words.includes('#all')
      ? ['extension', 'restriction', 'substitution']
      : words.filter((w): w is Method => ['extension', 'restriction', 'substitution'].includes(w)),
  );
}

/** A setting on a declaration or complex type, else the default of its schema document. */
function setting(set: SchemaSet, node: Element, name: 'block' | 'final'): Set<Method> {
  return methods(attr(node, name) ?? attr(set.documentOf(node)?.root ?? node, `${name}Default`));
}

/** The prohibited substitutions of a type: `block` of a complex type; simple and built-in types have none. */
function prohibited(set: SchemaSet, type: TypeRef): Set<Method> {
  return typeof type !== 'string' && type.localName === 'complexType' ? setting(set, type, 'block') : new Set();
}

const caches = new WeakMap<SchemaSet, { members: Map<Element, Component[]>; types: Map<Element, Component[]> }>();
function cache(set: SchemaSet) {
  let entry = caches.get(set);
  if (!entry) {
    entry = { members: new Map(), types: new Map() };
    caches.set(set, entry);
  }
  return entry;
}

/**
 * The declarations that may occur where a particle refers to `head`: the head unless it is abstract, then the
 * members of its substitution group in the order of the schema set, transitively, unless the head blocks
 * substitution or a derivation method on the way is blocked or final.
 */
export function substitutionCandidates(set: SchemaSet, head: Component): Component[] {
  const known = cache(set).members.get(head.node);
  if (known) return known;
  const out = isAbstract(head.node) ? [] : [head];
  const blocking = setting(set, head.node, 'block');
  const final = setting(set, head.node, 'final');
  const headType = typeOf(set, head.node);
  if (!blocking.has('substitution') && headType !== undefined) {
    for (const member of set.components.element.values()) {
      if (member.node === head.node || isAbstract(member.node) || !affiliated(set, member.node, head.node)) continue;
      const memberType = typeOf(set, member.node);
      const steps = memberType === undefined ? undefined : derivation(set, memberType, headType);
      if (!steps) continue;
      const barred = new Set([...blocking, ...final, ...prohibited(set, headType)]);
      for (const step of steps.slice(1)) for (const m of prohibited(set, step.type)) barred.add(m);
      if (steps.every((step) => !barred.has(step.method))) out.push(member);
    }
  }
  cache(set).members.set(head.node, out);
  return out;
}

/** Whether a chain of substitution group affiliations leads from `decl` to `head`. */
function affiliated(set: SchemaSet, decl: Element, head: Element): boolean {
  const seen = new Set<Element>();
  for (let current = headOf(set, decl); current && !seen.has(current.node); current = headOf(set, current.node)) {
    if (current.node === head) return true;
    seen.add(current.node);
  }
  return false;
}

/**
 * The complex types an element of the declared complex type `type` may have: the type unless it is abstract, then
 * the named complex types derived from it in the order of the schema set, unless the abstract flag, the element's
 * `block` or the type's `block` excludes them.
 */
export function typeCandidates(set: SchemaSet, decl: Element, type: Component): Component[] {
  const known = cache(set).types.get(decl);
  if (known) return known;
  const out = isAbstract(type.node) ? [] : [type];
  const barred = new Set([...setting(set, decl, 'block'), ...prohibited(set, type.node)]);
  for (const candidate of set.components.complexType.values()) {
    if (candidate.node === type.node || isAbstract(candidate.node)) continue;
    const steps = derivation(set, candidate.node, type.node);
    if (steps && steps.every((step) => !barred.has(step.method))) out.push(candidate);
  }
  cache(set).types.set(decl, out);
  return out;
}

/** `{namespace}local` of a global declaration or type definition. */
export function expandedName(component: Component): string {
  return clark(component.doc.targetNamespace, attr(component.node, 'name') ?? '');
}

/** Minimum occurrence count. */
const minimum = (node: Element): number => Number(attr(node, 'minOccurs') ?? '1');
const maximum = (node: Element): number => {
  const max = attr(node, 'maxOccurs');
  return max === undefined ? 1 : max === 'unbounded' ? Infinity : Number(max);
};

/**
 * Whether an element has an abstract declared type with no allowed concrete alternative.
 * Such an element cannot have a valid instance.
 */
export function declarationUnavailable(set: SchemaSet, decl: Element): boolean {
  const declared = declaredType(set, decl);
  if (declared.kind !== 'named' || declared.qname.ns === XS) return false;
  const complex = set.lookup('complexType', declared.qname);
  return complex !== undefined && typeCandidates(set, decl, complex).length === 0;
}

/**
 * Whether a particle that has to occur cannot be generated: a required element of an unavailable declaration, a
 * reference to an abstract head without an allowed member, or a group that requires one, or a choice of which every
 * branch is unavailable. Optional particles are always available, since they can be left out.
 */
export function particleUnavailable(set: SchemaSet, particle: Element, seen = new Set<Element>()): boolean {
  if (minimum(particle) === 0 || seen.has(particle)) return false;
  seen.add(particle);
  switch (particle.localName) {
    case 'element': {
      const ref = attr(particle, 'ref');
      if (ref === undefined) return declarationUnavailable(set, particle);
      const head = set.lookup('element', set.resolveQName(particle, ref));
      if (!head) return false;
      const members = substitutionCandidates(set, head);
      return members.every((member) => declarationUnavailable(set, member.node));
    }
    case 'sequence':
    case 'all':
      return xsChildren(particle).some((child) => particleUnavailable(set, child, seen));
    case 'choice': {
      const branches = xsChildren(particle).filter((child) => maximum(child) > 0);
      return branches.length > 0 && branches.every((child) => particleUnavailable(set, child, seen));
    }
    case 'group': {
      const group = set.reference('group', particle);
      return group !== undefined && xsChildren(group.node).some((child) => particleUnavailable(set, child, seen));
    }
    default:
      return false;
  }
}
