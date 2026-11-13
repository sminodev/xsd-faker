// What a change does to the IDs, references and keys of a document. libxml2 does not check that a reference names an
// ID, so a change that leaves a reference without its ID breaks a second rule unseen; the ID check of the generator
// finds it. Repeating an element that holds the field of an xs:key or xs:unique repeats a key value, a second rule
// that libxml2 does see: such elements are left out of `structure:too-many`.

import type { Element } from '@xmldom/xmldom';
import type { ElementFacts, ValueFacts } from '../generate/walker.js';
import { checkIdentities, identityKind, type IdentityKind, type IdentitySlot } from '../generate/identities.js';
import type { InstanceElement, InstanceText } from '../xml/tree.js';
import type { Facets } from '../xsd/facets.js';
import { attr, xsChildren } from '../xsd/schema-set.js';
import { formatExpandedPath, paths } from './path.js';
import type { TreeMutation } from './tree.js';

/** An ID or a reference of a document, by the exact path of the element or attribute that holds it. */
export interface Identity {
  holder: string;
  /** the value is the text of the element at `holder` */
  text: boolean;
  kind: IdentityKind;
  facets: Facets;
  value: string;
  validated: boolean;
}

type Facts = Map<object, ElementFacts | ValueFacts>;

const textOf = (element: InstanceElement): InstanceText | undefined => {
  if (element.children.some((c) => c.kind === 'element')) return undefined;
  const text = element.children.find((c) => c.kind === 'text');
  return text?.kind === 'text' ? text : undefined;
};

/** The IDs and references of a document. */
export function identities(tree: InstanceElement, facts: Facts): Identity[] {
  const out: Identity[] = [];
  for (const { path, element, attribute } of paths(tree)) {
    const holder = attribute ?? (element.nil ? undefined : textOf(element));
    const known = holder && facts.get(holder);
    if (!holder || known?.kind !== 'value') continue;
    const kind = identityKind(known.facets);
    if (kind !== 'id' && kind !== 'idref' && kind !== 'idrefs') continue;
    const owner = facts.get(element);
    out.push({
      holder: formatExpandedPath(path),
      text: attribute === undefined,
      kind,
      facets: known.facets,
      value: holder.value,
      validated: !known.schemaless && !(owner?.kind === 'element' && owner.schemaless),
    });
  }
  return out;
}

/**
 * The findings of the ID check on the document after a change. A value that breaks its type is no ID or reference
 * for the validator; a fixed value changed to another valid value still is.
 */
export function integrityAfter(before: readonly Identity[], mutation: TreeMutation): string[] {
  let after = before.map((identity) => ({ ...identity }));
  const target = 'target' in mutation ? formatExpandedPath(mutation.target) : undefined;
  const inside = (holder: string) => target !== undefined && (holder === target || holder.startsWith(`${target}/`));
  switch (mutation.op) {
    case 'set-value': {
      const keeps = mutation.rule === 'value:fixed' || mutation.rule.startsWith('identity:');
      after = after.flatMap((identity) =>
        identity.holder !== target ? [identity] : keeps ? [{ ...identity, value: mutation.value }] : [],
      );
      break;
    }
    case 'remove':
      after = after.filter((identity) => !inside(identity.holder));
      break;
    case 'repeat': {
      const copied = after.filter((identity) => inside(identity.holder));
      for (let k = 1; k <= mutation.times; k += 1) {
        after.push(...copied.map((identity) => ({ ...identity, holder: `${identity.holder} (copy ${k})` })));
      }
      break;
    }
    case 'set-nil':
      // Without content, the element keeps its own attributes only.
      if (!mutation.keepContent) {
        after = after.filter(
          (identity) =>
            !inside(identity.holder) ||
            (identity.holder !== target && /^\/@[^/]*$/.test(identity.holder.slice(target?.length ?? 0))),
        );
      }
      break;
    default:
      break;
  }
  return checkIdentities(after.map(slot));
}

function slot(identity: Identity): IdentitySlot {
  return {
    kind: identity.kind,
    facets: identity.facets,
    path: identity.holder,
    adjustable: false,
    validated: identity.validated,
    get: () => identity.value,
    set: () => undefined,
  };
}

/**
 * The elements whose copies would repeat the value of an xs:key or xs:unique, or give one of its fields a second
 * node: the elements a selector selects, and those between them and the nodes of their fields.
 */
export function keyHolders(tree: InstanceElement, facts: Facts): Set<InstanceElement> {
  const out = new Set<InstanceElement>();
  const parents = new Map<InstanceElement, InstanceElement>();
  const all = (element: InstanceElement): InstanceElement[] => {
    const list = [element];
    for (const child of element.children) {
      if (child.kind !== 'element') continue;
      parents.set(child, element);
      list.push(...all(child));
    }
    return list;
  };
  const everything = all(tree);
  /** Marks the element and its ancestors up to, without, `top`. */
  const mark = (from: InstanceElement, top: InstanceElement) => {
    for (let e: InstanceElement | undefined = from; e && e !== top; e = parents.get(e)) out.add(e);
  };
  for (const scope of everything) {
    const known = facts.get(scope);
    if (known?.kind !== 'element') continue;
    for (const constraint of xsChildren(known.decl)) {
      if (constraint.localName !== 'key' && constraint.localName !== 'unique') continue;
      const children = xsChildren(constraint);
      const selector = children.find((c) => c.localName === 'selector');
      const fields = children.filter((c) => c.localName === 'field');
      const selected = selector && evaluate(scope, attr(selector, 'xpath') ?? '', selector);
      if (!selected) {
        // A selector this reading does not follow: every element inside the scope counts.
        for (const e of all(scope)) if (e !== scope) out.add(e);
        continue;
      }
      for (const element of selected) {
        mark(element, scope);
        for (const field of fields) {
          const nodes = evaluate(element, attr(field, 'xpath') ?? '', field);
          if (!nodes) for (const e of all(element)) out.add(e);
          else for (const node of nodes) if (node !== element) mark(node, element);
        }
      }
    }
  }
  return out;
}

/**
 * The elements an XPath of a selector or field leads to from `from`; for an attribute, its element. Undefined for an
 * expression outside the subset XML Schema 1.0 allows. An unprefixed name matches any namespace, which can only mark
 * more elements than the validator does, never fewer.
 */
function evaluate(from: InstanceElement, xpath: string, scope: Element): InstanceElement[] | undefined {
  const found = new Set<InstanceElement>();
  for (const alternative of xpath.split('|')) {
    let path = alternative.trim();
    let current: InstanceElement[] = [from];
    if (path.startsWith('.//')) {
      path = path.slice(3);
      current = descendants(from);
    }
    const steps = path.split('/').map((step) => step.trim());
    for (const [i, step] of steps.entries()) {
      if (step === '.' || step === 'self::node()') continue;
      const attribute = /^(?:@|attribute::)\s*(.+)$/.exec(step);
      const test = nameTest(attribute ? (attribute[1] ?? '') : step.replace(/^child::\s*/, ''), scope);
      if (!test) return undefined;
      if (attribute) {
        if (i !== steps.length - 1) return undefined;
        current = current.filter((e) => e.attributes.some((a) => test(a.ns, a.name)));
        continue;
      }
      current = current.flatMap((e) =>
        e.children.filter((c): c is InstanceElement => c.kind === 'element' && test(c.ns, c.name)),
      );
    }
    for (const e of current) found.add(e);
  }
  return [...found];
}

function descendants(element: InstanceElement): InstanceElement[] {
  const out = [element];
  for (const child of element.children) if (child.kind === 'element') out.push(...descendants(child));
  return out;
}

function nameTest(text: string, scope: Element): ((ns: string, name: string) => boolean) | undefined {
  if (text === '*') return () => true;
  const m = /^(?:([^\s:*]+):)?([^\s:]+)$/.exec(text);
  if (!m) return undefined;
  const local = m[2] ?? '';
  const ns = m[1] === undefined ? undefined : (scope.lookupNamespaceURI(m[1]) ?? undefined);
  return (nodeNs, name) => (local === '*' || name === local) && (ns === undefined || nodeNs === ns);
}
