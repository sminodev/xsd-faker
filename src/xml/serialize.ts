// Writes an instance tree as XML text. All namespace declarations go on the root element.

import { elements, type InstanceElement, type InstanceNode } from './tree.js';

const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export interface SerializeOptions {
  /** Indentation per level; '' writes everything on one line. Default: two spaces. */
  indent?: string;
  /** Write the XML declaration. Default: true. */
  declaration?: boolean;
  /** Preferred prefixes by namespace URI, for example from the schema documents. */
  prefixes?: ReadonlyMap<string, string>;
  /** Adds xsi:schemaLocation (or xsi:noNamespaceSchemaLocation) pointing at this schema file. */
  schemaLocation?: string;
}

/** How namespaces are written: an optional default namespace, and a prefix for every other one. */
export interface NamespacePlan {
  defaultNs: string | undefined;
  prefixes: Map<string, string>;
}

/**
 * Plans the namespace declarations of a document.
 *
 * - The namespace of the root becomes the default namespace, unless an element without namespace occurs: it would
 *   then need xmlns="" to leave the default, so every namespace gets a prefix instead.
 * - Every other namespace of an element, and every namespace of an attribute, gets a prefix: attributes never take
 *   the default namespace. Preferred prefixes are used when they are free; otherwise ns1, ns2, ...
 */
export function planNamespaces(
  root: InstanceElement,
  preferred: ReadonlyMap<string, string> = new Map(),
): NamespacePlan {
  const all = [...elements(root)];
  const unqualified = all.some((e) => e.ns === '');
  const defaultNs = root.ns !== '' && !unqualified ? root.ns : undefined;
  const needPrefix: string[] = [];
  const add = (ns: string) => {
    if (ns !== '' && !needPrefix.includes(ns)) {
      needPrefix.push(ns);
    }
  };
  for (const e of all) {
    if (e.ns !== defaultNs) {
      add(e.ns);
    }
    for (const a of e.attributes) {
      add(a.ns);
    }
  }
  const prefixes = new Map<string, string>();
  const used = new Set(['xml', 'xmlns', 'xsi']);
  for (const ns of needPrefix) {
    if (ns === XML_NS) {
      prefixes.set(ns, 'xml');
      continue;
    }
    if (ns === XSI) {
      prefixes.set(ns, 'xsi');
      continue;
    }
    let prefix = preferred.get(ns);
    if (prefix === undefined || used.has(prefix) || !/^[A-Za-z_][\w.-]*$/.test(prefix)) {
      let n = 1;
      while (used.has(`ns${n}`)) {
        n += 1;
      }
      prefix = `ns${n}`;
    }
    used.add(prefix);
    prefixes.set(ns, prefix);
  }
  return { defaultNs, prefixes };
}

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
}

export function escapeAttribute(value: string): string {
  return escapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

export function serializeXml(root: InstanceElement, options: SerializeOptions = {}): string {
  const indent = options.indent ?? '  ';
  const plan = planNamespaces(root, options.prefixes);
  const qname = (ns: string, name: string, attribute: boolean): string => {
    if (ns === '' || (!attribute && ns === plan.defaultNs)) {
      return name;
    }
    return `${plan.prefixes.get(ns)}:${name}`;
  };

  const declarations: string[] = [];
  if (plan.defaultNs !== undefined) {
    declarations.push(`xmlns="${escapeAttribute(plan.defaultNs)}"`);
  }
  for (const [ns, prefix] of plan.prefixes) {
    if (ns !== XML_NS) declarations.push(`xmlns:${prefix}="${escapeAttribute(ns)}"`);
  }
  if (options.schemaLocation !== undefined) {
    if (!plan.prefixes.has(XSI)) declarations.push(`xmlns:xsi="${XSI}"`);
    declarations.push(
      root.ns === ''
        ? `xsi:noNamespaceSchemaLocation="${escapeAttribute(options.schemaLocation)}"`
        : `xsi:schemaLocation="${escapeAttribute(`${root.ns} ${options.schemaLocation}`)}"`,
    );
  }

  const write = (node: InstanceNode, depth: number, extra: string[]): string => {
    if (node.kind === 'text') {
      return escapeText(node.value);
    }
    const name = qname(node.ns, node.name, false);
    const attributes = [
      ...extra,
      ...node.attributes.map((a) => `${qname(a.ns, a.name, true)}="${escapeAttribute(a.value)}"`),
    ];
    const open = attributes.length > 0 ? `<${name} ${attributes.join(' ')}` : `<${name}`;
    if (node.children.length === 0) {
      return `${open}/>`;
    }
    // Text content is written as it is; only element-only content is indented.
    const mixed = node.children.some((c) => c.kind === 'text');
    if (mixed || indent === '') {
      return `${open}>${node.children.map((c) => write(c, depth + 1, [])).join('')}</${name}>`;
    }
    const inner = indent.repeat(depth + 1);
    const children = node.children.map((c) => `\n${inner}${write(c, depth + 1, [])}`).join('');
    return `${open}>${children}\n${indent.repeat(depth)}</${name}>`;
  };

  const body = write(root, 0, declarations);
  return options.declaration === false ? `${body}\n` : `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
}
