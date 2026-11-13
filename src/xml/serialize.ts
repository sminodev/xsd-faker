// Writes an instance tree as XML text. Namespace declarations go on the root element, except those for prefixes in
// QName values: these go on the element that holds the value, because the value has to keep its spelling.

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
  // An xsi:type value without prefix would mean the default namespace, so a type without namespace excludes it.
  const unqualified = all.some((e) => e.ns === '' || e.xsiType?.ns === '');
  const defaultNs = root.ns !== '' && !unqualified ? root.ns : undefined;
  const needPrefix: string[] = [];
  const add = (ns: string) => {
    if (ns !== '' && !needPrefix.includes(ns)) {
      needPrefix.push(ns);
    }
  };
  // A prefix in a QName value keeps its meaning, so no other namespace may take it.
  const valuePrefixes = new Map<string, Set<string>>();
  for (const e of all) {
    if (e.ns !== defaultNs) {
      add(e.ns);
    }
    for (const a of e.attributes) {
      add(a.ns);
    }
    if (e.nil) {
      add(XSI);
    }
    if (e.xsiType) {
      // The type's namespace needs a prefix, even where it is the default namespace of element names.
      add(XSI);
      add(e.xsiType.ns);
    }
    for (const [prefix, ns] of Object.entries(e.valueNamespaces ?? {})) {
      valuePrefixes.set(prefix, (valuePrefixes.get(prefix) ?? new Set()).add(ns));
      if (ns === XSI) {
        add(ns);
      }
    }
  }
  const prefixes = new Map<string, string>();
  const used = new Set(['xml', 'xmlns', 'xsi']);
  const taken = (prefix: string, ns: string) =>
    used.has(prefix) || [...(valuePrefixes.get(prefix) ?? [])].some((other) => other !== ns);
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
    if (prefix === undefined || taken(prefix, ns) || !/^[A-Za-z_][\w.-]*$/.test(prefix)) {
      let n = 1;
      while (taken(`ns${n}`, ns)) {
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

/** Writes elements and text with the prefixes of a plan; `extra` are attributes for the first element. */
function writer(plan: NamespacePlan, indent: string) {
  const qname = (ns: string, name: string, attribute: boolean): string => {
    if (ns === '' || (!attribute && ns === plan.defaultNs)) {
      return name;
    }
    return `${plan.prefixes.get(ns)}:${name}`;
  };
  // Inside mixed content nothing is indented, so that the markup is the same as in the JSON form.
  const write = (node: InstanceNode, depth: number, extra: string[], compact = false): string => {
    if (node.kind === 'text') {
      return escapeText(node.value);
    }
    const name = qname(node.ns, node.name, false);
    const attributes = [
      ...extra,
      ...Object.entries(node.valueNamespaces ?? {})
        .filter(([prefix, ns]) => plan.prefixes.get(ns) !== prefix)
        .map(([prefix, ns]) => `xmlns:${prefix}="${escapeAttribute(ns)}"`),
      ...node.attributes.map((a) => `${qname(a.ns, a.name, true)}="${escapeAttribute(a.value)}"`),
      ...(node.xsiType
        ? [`${qname(XSI, 'type', true)}="${escapeAttribute(qname(node.xsiType.ns, node.xsiType.name, true))}"`]
        : []),
      ...(node.nil ? [`${qname(XSI, 'nil', true)}="true"`] : []),
    ];
    const open = attributes.length > 0 ? `<${name} ${attributes.join(' ')}` : `<${name}`;
    // An element without content closes itself, also when its content is an empty text, so that XML and the
    // fragments of mixed content in JSON spell it alike.
    if (node.children.every((c) => c.kind === 'text' && c.value === '')) {
      return `${open}/>`;
    }
    // Text content is written as it is; only element-only content is indented.
    const mixed = compact || node.children.some((c) => c.kind === 'text');
    if (mixed || indent === '') {
      return `${open}>${node.children.map((c) => write(c, depth + 1, [], mixed)).join('')}</${name}>`;
    }
    const inner = indent.repeat(depth + 1);
    const children = node.children.map((c) => `\n${inner}${write(c, depth + 1, [])}`).join('');
    return `${open}>${children}\n${indent.repeat(depth)}</${name}>`;
  };
  return write;
}

/**
 * The line each element starts on when `serializeXml` writes the tree with these options. A validator names the line
 * of an element's start tag, so its messages can be traced to an element, not only to a name.
 */
export function elementLines(root: InstanceElement, options: SerializeOptions = {}): Map<InstanceElement, number> {
  const indent = options.indent ?? '  ';
  const lines = new Map<InstanceElement, number>();
  const breaks = (text: string) => text.split('\n').length - 1;
  // Follows `writer`: start tags and attribute values hold no line break, text keeps its own. Returns the last line.
  const visit = (node: InstanceNode, line: number, depth: number, compact: boolean): number => {
    if (node.kind === 'text') return line + breaks(node.value);
    lines.set(node, line);
    if (node.children.every((c) => c.kind === 'text' && c.value === '')) return line;
    const mixed = compact || node.children.some((c) => c.kind === 'text');
    let at = line;
    if (mixed || indent === '') {
      for (const child of node.children) at = visit(child, at, depth + 1, mixed);
      return at;
    }
    for (const child of node.children) at = visit(child, at + 1 + breaks(indent) * (depth + 1), depth + 1, false);
    return at + 1 + breaks(indent) * depth;
  };
  visit(root, options.declaration === false ? 1 : 2, 0, false);
  return lines;
}

export function serializeXml(root: InstanceElement, options: SerializeOptions = {}): string {
  const indent = options.indent ?? '  ';
  const plan = planNamespaces(root, options.prefixes);
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
  const body = writer(plan, indent)(root, 0, declarations);
  return options.declaration === false ? `${body}\n` : `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
}

/**
 * Mixed content as one string of markup: the text, and the child elements with the prefixes of the document. Each
 * child element declares the namespaces its names use, so that the string can be read on its own.
 */
export function serializeMixed(node: InstanceElement, plan: NamespacePlan): string {
  const write = writer(plan, '');
  return node.children
    .map((child) => (child.kind === 'text' ? escapeText(child.value) : write(child, 0, declarationsFor(child, plan))))
    .join('');
}

/** The declarations the names in an element and its descendants need: the default namespace, then prefixes by use. */
function declarationsFor(root: InstanceElement, plan: NamespacePlan): string[] {
  let defaultNs: string | undefined;
  const prefixes = new Map<string, string>();
  const use = (ns: string, attribute: boolean) => {
    if (ns === '' || ns === XML_NS) return;
    if (!attribute && ns === plan.defaultNs) {
      defaultNs = ns;
      return;
    }
    const prefix = plan.prefixes.get(ns);
    if (prefix !== undefined) prefixes.set(prefix, ns);
  };
  for (const e of elements(root)) {
    use(e.ns, false);
    for (const a of e.attributes) use(a.ns, true);
    if (e.nil) use(XSI, true);
    if (e.xsiType) {
      use(XSI, true);
      use(e.xsiType.ns, true);
    }
    // A QName value whose prefix the document declares at its root needs the declaration here.
    for (const [prefix, ns] of Object.entries(e.valueNamespaces ?? {})) {
      if (plan.prefixes.get(ns) === prefix) prefixes.set(prefix, ns);
    }
  }
  return [
    ...(defaultNs !== undefined ? [`xmlns="${escapeAttribute(defaultNs)}"`] : []),
    ...[...prefixes].map(([prefix, ns]) => `xmlns:${prefix}="${escapeAttribute(ns)}"`),
  ];
}
