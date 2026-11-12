import { DOMParser, type Element, type Node } from '@xmldom/xmldom';
import { type At, messageOf, type Problems } from './problems.js';

export const XS = 'http://www.w3.org/2001/XMLSchema';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export type ComponentKind = 'element' | 'attribute' | 'complexType' | 'simpleType' | 'group' | 'attributeGroup';
const KINDS: readonly ComponentKind[] = [
  'element',
  'attribute',
  'complexType',
  'simpleType',
  'group',
  'attributeGroup',
];

/** An expanded name: namespace URI (empty for none) and local name. */
export interface QName {
  ns: string;
  local: string;
}

/** A global component and the document that declares it. */
export interface Component {
  node: Element;
  doc: SchemaDocument;
}

/** The schema texts by path, or a function that reads them. */
export type SchemaSource = Readonly<Record<string, string>> | ((path: string) => string | undefined);

const isElement = (node: Node): node is Element => node.nodeType === 1;

/** The XML Schema element children of a node, without annotations. */
export function xsChildren(node: Node): Element[] {
  const out: Element[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (isElement(child) && child.namespaceURI === XS && child.localName !== 'annotation') {
      out.push(child);
    }
  }
  return out;
}

export function xsChild(node: Node, localName: string): Element | undefined {
  return xsChildren(node).find((child) => child.localName === localName);
}

export function attr(node: Element, name: string): string | undefined {
  return node.hasAttribute(name) ? (node.getAttribute(name) ?? undefined) : undefined;
}

/** The text of the xs:documentation elements of a component: lines joined, paragraphs kept. */
export function documentation(node: Node): string | undefined {
  const texts: string[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!isElement(child) || child.namespaceURI !== XS || child.localName !== 'annotation') {
      continue;
    }
    for (let doc = child.firstChild; doc; doc = doc.nextSibling) {
      if (isElement(doc) && doc.namespaceURI === XS && doc.localName === 'documentation') {
        const text = (doc.textContent ?? '')
          .split(/\r?\n\s*\r?\n/)
          .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
          .filter((paragraph) => paragraph.length > 0)
          .join('\n\n');
        if (text.length > 0) {
          texts.push(text);
        }
      }
    }
  }
  return texts.length > 0 ? texts.join('\n\n') : undefined;
}

/** `{namespace}local`, the key of all component tables. */
export function clark(ns: string, local: string): string {
  return `{${ns}}${local}`;
}

/** An absolute URI such as `https://example.org/a.xsd`. One-letter schemes are left out: they are drive letters. */
export function isAbsoluteUri(path: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(path);
}

/**
 * Joins a relative path to the directory of `from` and normalizes `.` and `..`, with `/` as separator. Backslashes in
 * `relative` count as `/`, as schemas written on Windows sometimes use them in schemaLocation. An absolute URI stays
 * as it is, and a relative path is resolved against `from` if that is a URI.
 */
export function resolvePath(from: string, relative: string): string {
  relative = relative.replace(/\\/g, '/');
  if (isAbsoluteUri(relative)) {
    return relative;
  }
  if (isAbsoluteUri(from)) {
    try {
      return new URL(relative, from).href;
    } catch {
      return relative;
    }
  }
  const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
  return normalizePath(relative.startsWith('/') ? relative : base + relative);
}

export function normalizePath(path: string): string {
  if (isAbsoluteUri(path)) {
    return path;
  }
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '..' && out.length > 0 && out[out.length - 1] !== '..') {
      out.pop();
    } else if (segment !== '.' && segment !== '') {
      out.push(segment);
    }
  }
  return (path.startsWith('/') ? '/' : '') + out.join('/');
}

export class SchemaDocument {
  /** The namespace of its components: its own, or for a chameleon include that of the including document. */
  readonly targetNamespace: string;
  readonly elementQualified: boolean;
  readonly attributeQualified: boolean;
  /** A document without targetNamespace included into a namespace; names without namespace in it mean that one. */
  readonly chameleon: boolean;

  constructor(
    readonly path: string,
    readonly root: Element,
    into?: string,
  ) {
    const own = attr(root, 'targetNamespace') ?? '';
    this.chameleon = own === '' && into !== undefined && into !== '';
    this.targetNamespace = this.chameleon ? (into ?? '') : own;
    this.elementQualified = attr(root, 'elementFormDefault') === 'qualified';
    this.attributeQualified = attr(root, 'attributeFormDefault') === 'qualified';
  }
}

/** The key of a chameleon copy of a document in `SchemaSet.documents`. */
function chameleonKey(path: string, namespace: string): string {
  return `${path} ${clark(namespace, '')}`;
}

/**
 * The schema documents reachable from an entry document through xs:import and xs:include, with their global
 * components by expanded name. A document without targetNamespace that a namespaced document includes (a chameleon
 * include) is loaded once per namespace it is included into, each time as its own copy: its components take that
 * namespace, and so do the names in it that would otherwise have none.
 */
export class SchemaSet {
  /** Exact texts parsed for this run; validation must use the same bytes. */
  readonly sourceTexts = new Map<string, string>();
  private loadedBytes = 0;
  /** Each group or attribute group redefined in xs:redefine, with the definition it replaces. */
  private readonly replaced = new Map<Element, Component>();
  /**
   * By path, and by path and namespace for chameleon copies; null while a document is being loaded or if it could
   * not be loaded.
   */
  readonly documents = new Map<string, SchemaDocument | null>();
  /** the targetNamespace each loaded file declares itself */
  private readonly ownNamespace = new Map<string, string>();
  /** the document of each loaded root element, to find the file of a node */
  private readonly byRoot = new Map<Element, SchemaDocument>();
  readonly components: Record<ComponentKind, Map<string, Component>> = {
    element: new Map(),
    attribute: new Map(),
    complexType: new Map(),
    simpleType: new Map(),
    group: new Map(),
    attributeGroup: new Map(),
  };
  private readonly read: (path: string) => string | undefined;

  constructor(
    source: SchemaSource,
    private readonly problems: Problems,
  ) {
    this.read =
      typeof source === 'function' ? source : (path) => (Object.hasOwn(source, path) ? source[path] : undefined);
  }

  /**
   * Loads a document and everything it imports or includes.
   *
   * @param into - the target namespace of the document that includes this one
   */
  load(path: string, from?: At, into?: string): SchemaDocument | undefined {
    path = normalizePath(path);
    let key = this.ownNamespace.get(path) === '' && into ? chameleonKey(path, into) : path;
    if (this.documents.has(key)) {
      return this.documents.get(key) ?? undefined;
    }
    if (this.documents.size >= 128) {
      this.problems.error('resource-limit', 'schema set exceeds 128 documents', from);
      return undefined;
    }
    this.documents.set(key, null);
    const at = { ...from, file: from?.file ?? path };
    const text = this.text(path, at);
    if (text === undefined) {
      return undefined;
    }
    let root: Element | null;
    try {
      const xml = new DOMParser({
        onError: (level, message) => {
          if (level !== 'warning') {
            throw new Error(message);
          }
        },
      }).parseFromString(text.replace(/^[\uFEFF\s]+/, ''), 'text/xml');
      root = xml.documentElement;
    } catch (e) {
      this.problems.error('invalid-xml', `${path}: ${messageOf(e)}`, { file: path });
      return undefined;
    }
    if (!root || root.namespaceURI !== XS || root.localName !== 'schema') {
      this.problems.error('not-a-schema', `${path} is not an XML Schema document`, { file: path });
      return undefined;
    }
    const doc = new SchemaDocument(path, root, into);
    this.ownNamespace.set(path, attr(root, 'targetNamespace') ?? '');
    if (doc.chameleon && key === path) {
      // Only now is it known that this include is a chameleon one; its copy has its own key.
      this.documents.delete(path);
      key = chameleonKey(path, doc.targetNamespace);
    }
    this.documents.set(key, doc);
    this.byRoot.set(root, doc);
    for (const child of xsChildren(root)) {
      const at = { file: path, node: child };
      const name = attr(child, 'name');
      const kind = KINDS.find((k) => k === child.localName);
      if (kind !== undefined && name !== undefined) {
        const table = this.components[kind];
        const id = clark(doc.targetNamespace, name);
        const known = table.get(id);
        if (known === undefined) {
          table.set(id, { node: child, doc });
        } else if (known.node !== child) {
          this.problems.error(
            'duplicate-component',
            `${child.localName} ${name} is defined in ${known.doc.path} and ${path}`,
            at,
          );
        }
      } else if (child.localName === 'import' || child.localName === 'include') {
        const location = attr(child, 'schemaLocation');
        if (location === undefined) {
          if (child.localName === 'include') {
            this.problems.error('missing-file', 'xs:include without schemaLocation', at);
          }
          continue;
        }
        const include = child.localName === 'include';
        const target = this.load(resolvePath(path, location), at, include ? doc.targetNamespace : undefined);
        if (target && !include && (attr(child, 'namespace') ?? '') !== target.targetNamespace) {
          this.problems.error('namespace-mismatch', `import namespace does not match ${target.path}`, at);
        }
        if (target && include && target.targetNamespace !== doc.targetNamespace) {
          this.problems.error(
            'namespace-mismatch',
            `${target.path} has the target namespace "${target.targetNamespace}" and cannot be included into "${doc.targetNamespace}"`,
            at,
          );
        }
      } else if (child.localName === 'redefine') {
        this.redefine(child, doc, at);
      } else if (child.localName === 'override') {
        this.problems.error('unsupported-redefine', 'xs:override is not supported', at);
      }
    }
    return doc;
  }

  /**
   * xs:redefine: includes a document and replaces its groups and attribute groups. A self-reference in the new
   * definition means the one it replaces; every other reference, also from the redefined document, the new one.
   * Redefined types are not supported.
   */
  private redefine(node: Element, doc: SchemaDocument, at: At & { node: Element }): void {
    const location = attr(node, 'schemaLocation');
    if (location === undefined) {
      this.problems.error('missing-file', 'xs:redefine without schemaLocation', at);
      return;
    }
    const target = this.load(resolvePath(doc.path, location), at, doc.targetNamespace);
    if (target && target.targetNamespace !== doc.targetNamespace) {
      this.problems.error(
        'namespace-mismatch',
        `${target.path} has the target namespace "${target.targetNamespace}" and cannot be redefined into "${doc.targetNamespace}"`,
        at,
      );
      return;
    }
    for (const definition of xsChildren(node)) {
      const here = { file: doc.path, node: definition };
      const kind = definition.localName;
      const name = attr(definition, 'name') ?? '';
      if (kind === 'simpleType' || kind === 'complexType') {
        this.problems.error('unsupported-redefine', `redefining xs:${kind} ${name} is not supported`, here);
        continue;
      }
      if ((kind !== 'group' && kind !== 'attributeGroup') || name === '') {
        this.problems.error('invalid-redefine', `xs:redefine cannot contain xs:${kind ?? ''}`, here);
        continue;
      }
      const id = clark(doc.targetNamespace, name);
      const previous = this.components[kind].get(id);
      if (!target || !previous) {
        if (target) this.problems.error('unknown-group', `xs:redefine of ${kind} ${name}: no such ${kind}`, here);
        continue;
      }
      const selves = [...definition.getElementsByTagNameNS(XS, kind)].filter((ref) => {
        const value = attr(ref, 'ref');
        if (value === undefined) return false;
        const qname = this.resolveQName(ref, value);
        return clark(qname.ns, qname.local) === id;
      });
      if (selves.length > 1) {
        this.problems.error(
          'invalid-redefine',
          `the redefinition of ${kind} ${name} refers to itself more than once`,
          here,
        );
        continue;
      }
      const self = selves[0];
      if (self && kind === 'group' && (attr(self, 'minOccurs') ?? '1') !== '1') {
        this.problems.error('invalid-redefine', `the self-reference of group ${name} must occur exactly once`, here);
        continue;
      }
      if (self && kind === 'group' && (attr(self, 'maxOccurs') ?? '1') !== '1') {
        this.problems.error('invalid-redefine', `the self-reference of group ${name} must occur exactly once`, here);
        continue;
      }
      this.replaced.set(definition, previous);
      this.components[kind].set(id, { node: definition, doc });
    }
  }

  /**
   * The group or attribute group a `ref` refers to. Inside the redefinition of a group of that name, it is the
   * definition the redefinition replaces.
   */
  reference(kind: 'group' | 'attributeGroup', node: Element): Component | undefined {
    const name = this.resolveQName(node, attr(node, 'ref') ?? '');
    for (let up = node.parentNode; up; up = up.parentNode) {
      const previous = isElement(up) ? this.replaced.get(up) : undefined;
      if (!previous || !isElement(up)) continue;
      const own = clark(this.documentOf(up)?.targetNamespace ?? '', attr(up, 'name') ?? '');
      if (up.localName === kind && own === clark(name.ns, name.local)) return previous;
      break;
    }
    return this.lookup(kind, name);
  }

  /** The text of a schema file, read and checked once; undefined after a reported problem. */
  private text(path: string, at: At): string | undefined {
    const known = this.sourceTexts.get(path);
    if (known !== undefined) {
      return known;
    }
    let text: string | undefined;
    try {
      text = this.read(path);
    } catch (e) {
      this.problems.error('missing-file', `schema document ${path} could not be read: ${messageOf(e)}`, at);
      return undefined;
    }
    if (text === undefined || text === null) {
      this.problems.error('missing-file', `schema document ${path} not found`, at);
      return undefined;
    }
    text = String(text);
    const bytes = new TextEncoder().encode(text).length;
    this.loadedBytes += bytes;
    if (bytes > 2 * 1024 * 1024 || this.loadedBytes > 16 * 1024 * 1024) {
      this.problems.error('resource-limit', 'schema input exceeds the 2 MiB file or 16 MiB set limit', { file: path });
      return undefined;
    }
    if (/<!DOCTYPE\b/i.test(text)) {
      this.problems.error('unsafe-input', 'DOCTYPE declarations are not accepted in schema input', { file: path });
      return undefined;
    }
    this.sourceTexts.set(path, text);
    return text;
  }

  /** Resolves a QName written in an attribute value against the namespaces in scope of `node`. */
  resolveQName(node: Element, qname: string): QName {
    const colon = qname.indexOf(':');
    const prefix = colon < 0 ? null : qname.slice(0, colon);
    const local = colon < 0 ? qname : qname.slice(colon + 1);
    if (prefix === 'xml') {
      return { ns: XML_NS, local };
    }
    // xmldom finds the default namespace with '' only; the DOM standard also accepts null.
    const ns =
      prefix === null ? node.lookupNamespaceURI('') || node.lookupNamespaceURI(null) : node.lookupNamespaceURI(prefix);
    if (prefix !== null && !ns) {
      this.problems.error('unknown-prefix', `prefix ${prefix} of ${qname} is not declared`, this.at(node));
      return { ns: '', local };
    }
    // In a chameleon include, a name without namespace refers to the namespace the document was included into.
    const doc = ns ? undefined : this.documentOf(node);
    return { ns: ns || (doc?.chameleon ? doc.targetNamespace : ''), local };
  }

  lookup(kind: ComponentKind, name: QName): Component | undefined {
    return this.components[kind].get(clark(name.ns, name.local));
  }

  /** The place of a node for a problem: its file, line and column. */
  at(node: Node): At {
    return { file: this.pathOf(node), node };
  }

  /** The path of the document a node belongs to. */
  pathOf(node: Node): string | undefined {
    return this.documentOf(node)?.path;
  }

  /** The loaded document a node belongs to; each chameleon copy has its own nodes. */
  documentOf(node: Node): SchemaDocument | undefined {
    const root = node.ownerDocument?.documentElement;
    return root ? this.byRoot.get(root) : undefined;
  }
}
