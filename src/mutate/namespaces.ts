// Rewrites the namespaces of an instance tree, so that a document of one version of a schema can be read against
// another version whose namespaces differ, such as by a version number at the end.

import type { InstanceElement } from '../xml/tree.js';

export interface NamespaceMapping {
  /** old namespace URI -> new namespace URI */
  namespaces: Readonly<Record<string, string>>;
  /** expanded attribute name in the new namespaces, `{ns}local` -> new value; only these values change */
  attributes?: Readonly<Record<string, string>>;
}

/**
 * A copy of the tree in the new namespaces: elements, attributes, xsi:type, the namespaces of QName values and the
 * planned JSON keys. `applied` lists each rewrite once, as `old -> new` or `@{ns}local: old -> new`.
 */
export function mapNamespaces(
  tree: InstanceElement,
  mapping: NamespaceMapping,
): { tree: InstanceElement; applied: string[] } {
  if (typeof mapping !== 'object' || mapping === null || typeof mapping.namespaces !== 'object') {
    throw new TypeError('mapping.namespaces must map namespace URIs to namespace URIs');
  }
  const copy = structuredClone(tree);
  const applied = new Set<string>();
  const map = (ns: string): string => {
    const target = Object.hasOwn(mapping.namespaces, ns) ? mapping.namespaces[ns] : undefined;
    if (target === undefined || target === ns) return ns;
    applied.add(`${ns} -> ${target}`);
    return target;
  };
  // `{ns}local` and `@{ns}local` keys of the JSON form
  const key = (value: string | undefined): string | undefined => {
    const m = value === undefined ? null : /^(@?)\{([^}]*)\}(.*)$/.exec(value);
    return m ? `${m[1]}{${map(m[2] ?? '')}}${m[3]}` : value;
  };
  const visit = (element: InstanceElement): void => {
    element.ns = map(element.ns);
    const elementKey = key(element.key);
    if (elementKey !== undefined) element.key = elementKey;
    if (element.xsiType) element.xsiType = { ...element.xsiType, ns: map(element.xsiType.ns) };
    if (element.valueNamespaces) {
      element.valueNamespaces = Object.fromEntries(
        Object.entries(element.valueNamespaces).map(([prefix, ns]) => [prefix, map(ns)]),
      );
    }
    for (const attribute of element.attributes) {
      attribute.ns = map(attribute.ns);
      const attributeKey = key(attribute.key);
      if (attributeKey !== undefined) attribute.key = attributeKey;
      const name = `{${attribute.ns}}${attribute.name}`;
      const value =
        mapping.attributes && Object.hasOwn(mapping.attributes, name) ? mapping.attributes[name] : undefined;
      if (value !== undefined && value !== attribute.value) {
        applied.add(`@${name}: ${attribute.value} -> ${value}`);
        attribute.value = value;
        delete attribute.normalized;
        delete attribute.binary;
      }
    }
    for (const child of element.children) if (child.kind === 'element') visit(child);
  };
  visit(copy);
  return { tree: copy, applied: [...applied] };
}
