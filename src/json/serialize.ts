import { type NamespacePlan, planNamespaces, serializeMixed } from '../xml/serialize.js';
import { compareDecimal } from '../values/decimal.js';
import { NAME_CHAR, NAME_START_CHAR } from '../xsd/namechars.js';
import type { InstanceAttribute, InstanceElement, InstanceText, JsonType } from '../xml/tree.js';

const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
/** XML whitespace, which separates list items; other Unicode spaces do not. */
const XML_SPACE = /[ \t\n\r]+/;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };
export interface JsonOptions {
  /** compact maps local names to properties; tree retains namespaces, order and lexical values. */
  mode?: 'compact' | 'tree';
  textProperty?: string;
  /** Strings avoid rounding large integers and high-precision decimals. Default: number. */
  numbers?: 'number' | 'string';
}
export class JsonMappingError extends Error {
  override name = 'JsonMappingError';
}
const NCNAME = new RegExp(`^(?!.*:)[${NAME_START_CHAR}][${NAME_CHAR}]*$`, 'u');
/**
 * Accepts an NCName other than `__proto__`, or `#text`. This excludes qualified element/attribute keys
 * and reserved metadata keys; a group named `text` can still collide with `#text`.
 */
export function checkTextProperty(name: unknown): void {
  if (typeof name !== 'string' || (name !== '#text' && (!NCNAME.test(name) || name === '__proto__'))) {
    throw new TypeError("textProperty must be an NCName other than __proto__, or '#text'");
  }
}
function canonicalDecimal(value: string): string | undefined {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!m || `${m[2]}${m[3] ?? ''}` === '') {
    return undefined;
  }
  const exponent = Number(m[4] ?? '0');
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10000) {
    return undefined;
  }
  const raw = `${m[2]}${m[3] ?? ''}`.replace(/^0+/, '');
  if (!raw) {
    return '0';
  }
  const digits = raw.replace(/0+$/, '');
  return `${m[1] === '-' ? '-' : ''}${digits}e${exponent - (m[3]?.length ?? 0) + raw.length - digits.length}`;
}
const float = new Float32Array(1);
const floatBits = new Uint32Array(float.buffer);
/** The float next to `f` in the direction of `toward`. */
function nextFloat(f: number, toward: number): number {
  if (f === 0) {
    return Math.sign(toward) * 2 ** -149;
  }
  float[0] = f;
  floatBits[0] = (floatBits[0] ?? 0) + (toward > f === f > 0 ? 1 : -1);
  return float[0] ?? f;
}
/** The exact decimal value of a double, as `digits` or `digitse-k`. */
function exactDecimal(d: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, d);
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
  const exponent = (biased === 0 ? 1 : biased) - 1075;
  const sign = bits >> 63n ? '-' : '';
  return exponent >= 0
    ? `${sign}${mantissa << BigInt(exponent)}`
    : `${sign}${mantissa * 5n ** BigInt(-exponent)}e${exponent}`;
}
/**
 * Whether the double `d` read from `text` stands for the same xs:float value: the nearest 32-bit float to the text.
 * Rounding to a double first and then to a float differs from rounding the text to a float directly only where the
 * double lies exactly halfway between two floats; there the text decides.
 */
function keepsFloat(text: string, d: number): boolean {
  const f = Math.fround(d);
  if (!Number.isFinite(f)) {
    return false;
  }
  if (f === d) {
    return true;
  }
  const other = nextFloat(f, d);
  if ((f + other) / 2 !== d) {
    return true;
  }
  const side = compareDecimal(text, exactDecimal(d));
  if (side === undefined) {
    return false;
  }
  return side === 0 || f === (side > 0 ? Math.max(f, other) : Math.min(f, other));
}
function primitive(
  value: string,
  type: JsonType,
  numbers: JsonOptions['numbers'],
  binary?: 'float' | 'double',
): JsonValue {
  if (type === 'string') {
    return value;
  }
  // Numbers and booleans always collapse whitespace.
  value = value.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '');
  if (numbers === 'string' && (type === 'integer' || type === 'number')) {
    return value;
  }
  // INF, -INF and NaN of xs:float and xs:double have no JSON number; they stay strings, never Infinity or null.
  if (type === 'number' && (value === 'INF' || value === '-INF' || value === 'NaN')) {
    return value;
  }
  if (value === '') {
    throw new JsonMappingError(`an empty value has no JSON ${type} form; use mode: 'tree'`);
  }
  if (type === 'boolean') {
    if (value === 'true' || value === '1') {
      return true;
    }
    if (value === 'false' || value === '0') {
      return false;
    }
    throw new JsonMappingError(`invalid boolean lexical value: ${value}`);
  }
  const number = Number(value);
  // A literal past the largest finite float or double is INF or -INF of its type, such as 1e39 for xs:float.
  if (binary === 'float' || binary === 'double') {
    const typed = binary === 'float' ? Math.fround(number) : number;
    if (typed === Infinity) return 'INF';
    if (typed === -Infinity) return '-INF';
  }
  // An xs:double is the double nearest to its text, an xs:float the nearest 32-bit float; a decimal is exact.
  const exact =
    binary === 'double'
      ? true
      : binary === 'float'
        ? keepsFloat(value, number)
        : canonicalDecimal(value) === canonicalDecimal(String(number));
  if (!Number.isFinite(number) || (type === 'integer' && !Number.isSafeInteger(number)) || !exact) {
    throw new JsonMappingError(
      `number cannot be represented without changing its decimal value: ${value}; use numbers: 'string' or mode: 'tree'`,
    );
  }
  return number;
}
type Typed = Pick<InstanceText, 'value' | 'type' | 'list' | 'normalized' | 'binary'>;
/** A typed value; an xs:list becomes an array of its items, each typed, and an empty list `[]`. */
function typed(holder: Typed, numbers: JsonOptions['numbers']): JsonValue {
  const value = holder.normalized ?? holder.value;
  if (!holder.list) {
    return primitive(value, holder.type, numbers, holder.binary);
  }
  const trimmed = value.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '');
  return trimmed === ''
    ? []
    : trimmed.split(XML_SPACE).map((item) => primitive(item, holder.type, numbers, holder.binary));
}
/** The text of an element as one typed holder: a single text node as it is, several joined. */
function textOf(texts: readonly InstanceText[]): Typed {
  const [first] = texts;
  if (texts.length === 1 && first) {
    return first;
  }
  const value = texts.map((part) => part.value).join('');
  return {
    value,
    type: first?.type ?? 'string',
    ...(first?.list ? { list: true } : {}),
    ...(first?.binary ? { binary: first.binary } : {}),
  };
}
/** Attributes that become JSON properties: xsi:* control the instance and are never data. */
function dataAttributes(node: InstanceElement): InstanceAttribute[] {
  return node.attributes.filter((attribute) => attribute.ns !== XSI);
}
/**
 * Serializes the same instance used for XML. Collisions fail instead of overwriting data.
 *
 * @param prefixes - the preferred prefixes of the XML, so that mixed content uses the same ones
 */
export function toJson(
  root: InstanceElement,
  options: JsonOptions = {},
  prefixes?: ReadonlyMap<string, string>,
): JsonValue {
  if (options.mode === 'tree') {
    return JSON.parse(JSON.stringify(root)) as JsonValue;
  }
  const textProperty = options.textProperty ?? 'value';
  checkTextProperty(textProperty);
  let plan: NamespacePlan | undefined;
  // The text property's name is reserved in every object, whether it holds text or not: an attribute of that name
  // becomes `@local`, an element `{ns}local`.
  const attributeKey = (attribute: InstanceAttribute): string =>
    attribute.key ?? (attribute.name === textProperty ? `@${attribute.name}` : attribute.name);
  const elementKey = (element: InstanceElement): string =>
    element.key ?? (element.name === textProperty ? `{${element.ns}}${element.name}` : element.name);
  type JsonObject = { [key: string]: JsonValue };
  type Put = (name: string, identity: string, value: JsonValue) => void;
  const object = (
    owner: string,
  ): { result: JsonObject; put: Put; reserve: (name: string, identity: string) => void } => {
    const result = Object.create(null) as JsonObject;
    const names = new Map<string, string>();
    /** Reserves a possible property name to detect collisions before writing data. */
    const reserve = (name: string, identity: string) => {
      names.set(name, identity);
    };
    const put: Put = (name, identity, value) => {
      if (names.has(name)) {
        throw new JsonMappingError(
          `property collision at ${owner}/${name}: ${names.get(name)} and ${identity}; use mode: 'tree'`,
        );
      }
      names.set(name, identity);
      Object.defineProperty(result, name, { value, enumerable: true, writable: true, configurable: true });
    };
    return { result, put, reserve };
  };
  /** Writes elements into one object; each repeated group at this level is an array with an object per occurrence. */
  const writeElements = (owner: string, put: Put, members: readonly InstanceElement[], level: number): void => {
    const properties = new Map<string, InstanceElement[]>();
    for (const child of members) {
      const group = child.groups?.[level];
      const key = group?.key ?? elementKey(child);
      const list = properties.get(key) ?? [];
      if (!group && list.some((item) => item.ns !== child.ns)) {
        throw new JsonMappingError(`namespace collision at ${owner}/${child.name}; use mode: 'tree'`);
      }
      // Content of xs:any never shares a property with a declared element.
      if (!group && list.some((item) => !item.wildcard !== !child.wildcard)) {
        throw new JsonMappingError(
          `property collision at ${owner}/${child.name}: wildcard content and a declared name; use mode: 'tree'`,
        );
      }
      list.push(child);
      properties.set(key, list);
    }
    for (const [key, list] of properties) {
      const first = list[0];
      if (!first) {
        continue;
      }
      if (first.groups?.[level]) {
        const occurrences = new Map<number, InstanceElement[]>();
        for (const child of list) {
          const id = child.groups?.[level]?.occurrence ?? 0;
          occurrences.set(id, [...(occurrences.get(id) ?? []), child]);
        }
        const items = [...occurrences.values()].map((occurrence) => {
          const item = object(owner);
          writeElements(owner, item.put, occurrence, level + 1);
          return item.result;
        });
        put(key, `repeated group ${key}`, items);
      } else if (first.wildcard) {
        // Without the schema, the form follows the count: several occurrences are an array, one is a value.
        put(key, `element {${first.ns}}${key}`, list.length > 1 ? list.map(generic) : generic(first));
      } else {
        put(
          key,
          `element {${first.ns}}${key}`,
          list.length > 1 || list.some((child) => child.repeatable) ? list.map(visit) : visit(first),
        );
      }
    }
  };
  /**
   * Content admitted by xs:any, mapped without the schema: an element without attributes and children is its text,
   * unchanged; otherwise an object with the attributes as strings, the children by the same rule, and the text under
   * the text property. Children together with text that is not only whitespace keep the mixed form, an XML fragment.
   * Whitespace between children is formatting and left out.
   */
  const generic = (node: InstanceElement): JsonValue => {
    const attributes = dataAttributes(node);
    const children = node.children.filter((child): child is InstanceElement => child.kind === 'element');
    const texts = node.children.filter((child): child is InstanceText => child.kind === 'text');
    const content = texts.map((part) => part.value).join('');
    if (attributes.length === 0 && children.length === 0) {
      return content;
    }
    const { result, put } = object(node.name);
    for (const attribute of attributes) {
      put(attributeKey(attribute), `attribute {${attribute.ns}}${attribute.name}`, attribute.value);
    }
    if (children.length > 0 && /[^ \t\n\r]/.test(content)) {
      plan ??= planNamespaces(root, prefixes);
      put(textProperty, 'mixed content', serializeMixed(node, plan));
      return result;
    }
    const byName = new Map<string, InstanceElement[]>();
    for (const child of children) {
      const list = byName.get(child.name) ?? [];
      if (list.some((item) => item.ns !== child.ns)) {
        throw new JsonMappingError(`namespace collision at ${node.name}/${child.name}; use mode: 'tree'`);
      }
      list.push(child);
      byName.set(child.name, list);
    }
    for (const [local, list] of byName) {
      const first = list[0] ?? node;
      put(elementKey(first), `element {${first.ns}}${local}`, list.length > 1 ? list.map(generic) : generic(first));
    }
    // Without children, include a text property only for non-empty text.
    if (children.length === 0 && content !== '') {
      put(textProperty, 'text', content);
    }
    return result;
  };
  const visit = (node: InstanceElement): JsonValue => {
    if (node.wildcard) {
      return generic(node);
    }
    const children = node.children.filter((child): child is InstanceElement => child.kind === 'element');
    const texts = node.children.filter((child): child is InstanceText => child.kind === 'text');
    const attributes = dataAttributes(node);
    // xsi:type is written as `#type` with the expanded name, for complex types and simple content. A value of a
    // simple type has no JSON form for another type: the tree names a type only where it differs from the declared one.
    const type = node.xsiType && `{${node.xsiType.ns}}${node.xsiType.name}`;
    if (type && !node.simpleContent && !node.mixed && children.length === 0 && texts.length > 0) {
      throw new JsonMappingError(`xsi:type ${type} on ${node.name}, an element of a simple type, has no JSON form`);
    }
    if (node.nil && attributes.length === 0 && !type) {
      return null;
    }
    // Map xs:anyType without xsi:type as wildcard content; an empty element becomes "".
    if (node.anyType && !type && !node.nil) {
      return generic(node);
    }
    if (
      !type &&
      !node.nil &&
      !node.mixed &&
      !node.simpleContent &&
      attributes.length === 0 &&
      children.length === 0 &&
      texts.length > 0
    ) {
      return typed(textOf(texts), options.numbers);
    }
    const { result, put, reserve } = object(node.name);
    // The key #type belongs to xsi:type wherever the type has alternatives, used in this sample or not.
    if (type) {
      put('#type', 'xsi:type', type);
    } else if (node.typeable) {
      reserve('#type', 'xsi:type');
    }
    for (const attribute of attributes) {
      put(attributeKey(attribute), `attribute {${attribute.ns}}${attribute.name}`, typed(attribute, options.numbers));
    }
    if (node.nil) {
      // A nil element with attributes: the attributes and a null text property, never children.
      put(textProperty, 'nil content', null);
    } else if (node.mixed) {
      plan ??= planNamespaces(root, prefixes);
      put(textProperty, 'mixed content', serializeMixed(node, plan));
    } else {
      writeElements(node.name, put, children, 0);
      // Simple content always has its text property, empty as "".
      if (texts.length > 0) {
        put(textProperty, 'simple content', typed(textOf(texts), options.numbers));
      } else if (node.simpleContent) {
        put(textProperty, 'simple content', '');
      }
    }
    return result;
  };
  return visit(root);
}
