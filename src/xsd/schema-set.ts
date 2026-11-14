import { DOMParser, type Element, type Node } from '@xmldom/xmldom';
import { scanDoctype } from './doctype.js';
import { SchemaEncodingError, utf8Declaration } from './encoding.js';
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

/** A schema text a reader decoded itself, with the byte count of its file for the size limits. */
export interface SchemaText {
  text: string;
  bytes: number;
}

/**
 * The schema texts by path, or a function that reads them. A text is already decoded: an encoding in its XML
 * declaration is not read. A function may return the file's byte count with the text.
 */
export type SchemaSource = Readonly<Record<string, string>> | ((path: string) => string | SchemaText | undefined);

/** Size limits of the schema input; each one a positive safe integer. */
export interface SchemaLimits {
  /** Bytes of one schema file (UTF-8 bytes of a text). Default: 4194304 (4 MiB). */
  maxFileBytes?: number;
  /** Bytes of all schema documents, each chameleon copy counted again. Default: 16777216 (16 MiB). */
  maxTotalBytes?: number;
  /** Loaded schema documents, each chameleon copy counted. Default: 128. */
  maxDocuments?: number;
}

export const DEFAULT_LIMITS: Readonly<Required<SchemaLimits>> = {
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxDocuments: 128,
};

/** The effective limits: the defaults with the given values, which must be positive safe integers. */
export function effectiveLimits(limits: SchemaLimits | undefined): Required<SchemaLimits> {
  const plain =
    typeof limits === 'object' &&
    limits !== null &&
    [Object.prototype, null].includes(Object.getPrototypeOf(limits) as object | null);
  if (limits !== undefined && !plain) {
    throw new TypeError('limits must be a plain object');
  }
  const out = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof SchemaLimits)[]) {
    const value = limits?.[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`limits.${key} must be a positive safe integer`);
    }
    out[key] = value;
  }
  return out;
}

/** Thrown by a schema source when a file is too large to read; the set reports it as `resource-limit`. */
export class SchemaLimitError extends Error {
  override name = 'SchemaLimitError';
}

/**
 * Thrown by a schema source for a location it must not read: outside its base directory, through a symlink that
 * leads out, an absolute path or a URI. The set reports it as `unsafe-input`.
 */
export class UnsafeLocationError extends Error {
  override name = 'UnsafeLocationError';
}

export { SchemaEncodingError } from './encoding.js';

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
  /** the bytes of each file read, charged again for each further chameleon copy */
  private readonly fileBytes = new Map<string, number>();
  readonly limits: Required<SchemaLimits>;
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
  private readonly read: (path: string) => string | SchemaText | undefined;
  /** Locations to hand libxml2 in plain form, by document, until the document is loaded. */
  private readonly plainForms = new Map<string, { node: Element; location: string; relative: string }[]>();

  constructor(
    source: SchemaSource,
    private readonly problems: Problems,
    limits?: SchemaLimits,
  ) {
    this.limits = effectiveLimits(limits);
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
    if (this.documents.size >= this.limits.maxDocuments) {
      this.problems.error(
        'resource-limit',
        `schema set exceeds maxDocuments ${this.limits.maxDocuments} with ${path}`,
        from ?? { file: path },
      );
      return undefined;
    }
    this.documents.set(key, null);
    const at = { ...from, file: from?.file ?? path };
    // A further parse copy of a file already read (a chameleon include into another namespace) counts again.
    const copy = this.sourceTexts.has(path);
    const text = this.text(path, at);
    if (text === undefined || (copy && !this.charge(path, this.fileBytes.get(path) ?? 0))) {
      return undefined;
    }
    let root: Element | null;
    try {
      const xml = new DOMParser({
        // XML 1.0 ends lines with CR LF and CR only; U+0085, U+2028 and U+2029 stay characters, as libxml2 reads them.
        normalizeLineEndings: (source: string) => source.replace(/\r\n?/g, '\n'),
        onError: (level, message) => {
          if (level !== 'warning') {
            throw new Error(message);
          }
        },
      }).parseFromString(text.replace(/^[\uFEFF \t\n\r]+/, ''), 'text/xml');
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
        this.plain(path, child, location);
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
    this.writePlainForms(path, root);
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
    this.plain(doc.path, node, location);
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
  /**
   * Hands libxml2 a location in its plain form. It reads `sub/../leaf.xsd` only where a directory `sub` exists, and
   * none does when no file of it is part of the schema set; so the text it validates names the same file as
   * `leaf.xsd`, relative to the document, the way the loader resolved it.
   */
  private plain(path: string, node: Element, location: string): void {
    if (isAbsoluteUri(location) || isAbsoluteUri(path) || location.startsWith('/')) return;
    const target = resolvePath(path, location);
    const from = path.split('/').slice(0, -1);
    const to = target.split('/');
    let common = 0;
    while (common < from.length && common < to.length - 1 && from[common] === to[common]) common += 1;
    const relative = [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/');
    if (relative === location) return;
    const list = this.plainForms.get(path) ?? [];
    list.push({ node, location, relative });
    this.plainForms.set(path, list);
  }

  /**
   * Writes the plain locations into the text libxml2 validates. The start tags of the text are matched to the
   * elements of the parsed document in document order, so the attribute of exactly that xs:import, xs:include or
   * xs:redefine changes, whatever its prefix and however its value is written; the new value is escaped and no line
   * moves. A location that cannot be written so is reported instead of failing later in libxml2.
   */
  private writePlainForms(path: string, root: Element): void {
    const pending = this.plainForms.get(path);
    const text = this.sourceTexts.get(path);
    if (!pending || text === undefined) return;
    this.plainForms.delete(path);
    const elements: Element[] = [];
    const walk = (element: Element) => {
      elements.push(element);
      for (let child = element.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) walk(child as Element);
      }
    };
    walk(root);
    const tags = startTags(text);
    const edits: { start: number; end: number; value: string }[] = [];
    for (const { node, location, relative } of pending) {
      const index = elements.indexOf(node);
      const tag = tags?.length === elements.length ? tags[index] : undefined;
      const attribute = tag?.attributes.find((a) => a.name === 'schemaLocation');
      const raw = attribute && text.slice(attribute.start, attribute.end);
      if (
        !tag ||
        !attribute ||
        raw === undefined ||
        /[\r\n]/.test(raw) ||
        tag.name.split(':').pop() !== node.localName
      ) {
        this.problems.error(
          'unsupported',
          `${path}: the location ${location} cannot be handed to the validator as ${relative}`,
          { file: path, node },
        );
        continue;
      }
      edits.push({
        start: attribute.start,
        end: attribute.end,
        value: escapeAttributeValue(relative, attribute.quote),
      });
    }
    let out = text;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, edit.start) + edit.value + out.slice(edit.end);
    }
    this.sourceTexts.set(path, out);
  }

  private text(path: string, at: At): string | undefined {
    const known = this.sourceTexts.get(path);
    if (known !== undefined) {
      return known;
    }
    let read: string | SchemaText | undefined;
    try {
      read = this.read(path);
    } catch (e) {
      if (e instanceof SchemaLimitError) {
        this.problems.error('resource-limit', e.message, at);
      } else if (e instanceof UnsafeLocationError) {
        this.problems.error('unsafe-input', `schema document ${path} is not read: ${e.message}`, at);
      } else if (e instanceof SchemaEncodingError) {
        this.problems.error(e.code, e.message, at);
      } else {
        this.problems.error('missing-file', `schema document ${path} could not be read: ${messageOf(e)}`, at);
      }
      return undefined;
    }
    if (read === undefined || read === null) {
      this.problems.error('missing-file', `schema document ${path} not found`, at);
      return undefined;
    }
    let text = typeof read === 'object' ? String(read.text) : String(read);
    // Counted before anything parses the text: the file's bytes if the reader knows them, else the UTF-8 bytes.
    const bytes = typeof read === 'object' ? read.bytes : new TextEncoder().encode(text).length;
    if (bytes > this.limits.maxFileBytes) {
      this.problems.error(
        'resource-limit',
        `schema document ${path} has ${bytes} bytes, more than maxFileBytes ${this.limits.maxFileBytes}`,
        { file: path },
      );
      return undefined;
    }
    this.fileBytes.set(path, bytes);
    if (!this.charge(path, bytes)) return undefined;
    const scan = scanDoctype(text);
    if (scan.kind === 'invalid') {
      this.problems.error('invalid-xml', `${path}: ${scan.reason}`, { file: path });
      return undefined;
    }
    if (scan.kind === 'unsafe') {
      this.problems.error('unsafe-input', `${path}: ${scan.reason}; DTDs are not processed`, { file: path });
      return undefined;
    }
    if (scan.kind === 'neutralized') {
      // Parser and validator get the same text, without the DOCTYPE.
      this.problems.warning(
        'neutralized-doctype',
        `${path}: the DOCTYPE has no effect and is left out; its identifiers are not read`,
        { file: path },
      );
      text = scan.text;
    }
    // The text is decoded already; libxml2 reads it as UTF-8, whatever the declaration said.
    text = utf8Declaration(text);
    this.sourceTexts.set(path, text);
    return text;
  }

  /** Adds bytes to the total budget; false, with a problem, once it is exceeded. */
  private charge(path: string, bytes: number): boolean {
    this.loadedBytes += bytes;
    if (this.loadedBytes <= this.limits.maxTotalBytes) return true;
    this.problems.error(
      'resource-limit',
      `schema set exceeds maxTotalBytes ${this.limits.maxTotalBytes} with ${path}`,
      {
        file: path,
      },
    );
    return false;
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

/** A value for an attribute in the given quotes. */
function escapeAttributeValue(value: string, quote: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&apos;');
}

interface StartTag {
  name: string;
  /** each attribute with the span of its raw value, between the quotes */
  attributes: { name: string; start: number; end: number; quote: string }[];
}

/**
 * The start tags of a well-formed XML text, in document order, with the raw spans of their attribute values;
 * comments, CDATA sections, processing instructions and the DOCTYPE are skipped. Undefined for text it cannot read.
 */
function startTags(text: string): StartTag[] | undefined {
  const tags: StartTag[] = [];
  const space = /[ \t\r\n]/;
  let i = 0;
  const after = (marker: string, from: number) => {
    const at = text.indexOf(marker, from);
    return at < 0 ? -1 : at + marker.length;
  };
  while ((i = text.indexOf('<', i)) >= 0) {
    if (text.startsWith('<!--', i)) i = after('-->', i + 4);
    else if (text.startsWith('<![CDATA[', i)) i = after(']]>', i + 9);
    else if (text.startsWith('<?', i)) i = after('?>', i + 2);
    else if (text.startsWith('</', i)) i = after('>', i + 2);
    else if (text.startsWith('<!', i)) {
      // A DOCTYPE, with an internal subset in brackets and quoted literals.
      let depth = 0;
      let k = i + 2;
      for (; k < text.length; k += 1) {
        const c = text.charAt(k);
        if (c === '"' || c === "'") k = text.indexOf(c, k + 1);
        else if (c === '[') depth += 1;
        else if (c === ']') depth -= 1;
        else if (c === '>' && depth === 0) break;
        if (k < 0) return undefined;
      }
      i = k + 1;
    } else {
      let k = i + 1;
      while (k < text.length && !space.test(text.charAt(k)) && text.charAt(k) !== '/' && text.charAt(k) !== '>') k += 1;
      const tag: StartTag = { name: text.slice(i + 1, k), attributes: [] };
      for (;;) {
        while (space.test(text.charAt(k))) k += 1;
        const c = text.charAt(k);
        if (c === '>' || c === '') break;
        if (c === '/') {
          k += 1;
          continue;
        }
        const nameStart = k;
        while (k < text.length && !space.test(text.charAt(k)) && text.charAt(k) !== '=') k += 1;
        const name = text.slice(nameStart, k);
        while (space.test(text.charAt(k))) k += 1;
        if (text.charAt(k) !== '=') return undefined;
        k += 1;
        while (space.test(text.charAt(k))) k += 1;
        const quote = text.charAt(k);
        if (quote !== '"' && quote !== "'") return undefined;
        const end = text.indexOf(quote, k + 1);
        if (end < 0) return undefined;
        tag.attributes.push({ name, start: k + 1, end, quote });
        k = end + 1;
      }
      tags.push(tag);
      i = k + 1;
    }
    if (i <= 0) return undefined;
  }
  return tags;
}
