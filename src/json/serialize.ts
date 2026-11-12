import { type NamespacePlan, planNamespaces, serializeMixed } from '../xml/serialize.js';
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
function primitive(value: string, type: JsonType, numbers: JsonOptions['numbers']): JsonValue {
  if (type === 'string' || (numbers === 'string' && (type === 'integer' || type === 'number'))) {
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
  if (
    !Number.isFinite(number) ||
    (type === 'integer' && !Number.isSafeInteger(number)) ||
    canonicalDecimal(value) !== canonicalDecimal(String(number))
  ) {
    throw new JsonMappingError(
      `number cannot be represented without changing its decimal value: ${value}; use numbers: 'string' or mode: 'tree'`,
    );
  }
  return number;
}
/** A typed value; an xs:list becomes an array of its items, each typed, and an empty list `[]`. */
function typed(value: string, type: JsonType, list: boolean | undefined, numbers: JsonOptions['numbers']): JsonValue {
  if (!list) {
    return primitive(value, type, numbers);
  }
  const trimmed = value.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '');
  return trimmed === '' ? [] : trimmed.split(XML_SPACE).map((item) => primitive(item, type, numbers));
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
  if (!textProperty) {
    throw new TypeError('textProperty must not be empty');
  }
  let plan: NamespacePlan | undefined;
  type JsonObject = { [key: string]: JsonValue };
  type Put = (name: string, identity: string, value: JsonValue) => void;
  const object = (owner: string): { result: JsonObject; put: Put } => {
    const result = Object.create(null) as JsonObject;
    const names = new Map<string, string>();
    const put: Put = (name, identity, value) => {
      if (names.has(name)) {
        throw new JsonMappingError(
          `property collision at ${owner}/${name}: ${names.get(name)} and ${identity}; use mode: 'tree'`,
        );
      }
      names.set(name, identity);
      Object.defineProperty(result, name, { value, enumerable: true, writable: true, configurable: true });
    };
    return { result, put };
  };
  /** Writes elements into one object; each repeated group at this level is an array with an object per occurrence. */
  const writeElements = (owner: string, put: Put, members: readonly InstanceElement[], level: number): void => {
    const properties = new Map<string, InstanceElement[]>();
    for (const child of members) {
      const group = child.groups?.[level];
      const key = group?.key ?? child.name;
      const list = properties.get(key) ?? [];
      if (!group && list.some((item) => item.ns !== child.ns)) {
        throw new JsonMappingError(`namespace collision at ${owner}/${child.name}; use mode: 'tree'`);
      }
      // Content of xs:any never shares a property with a declared element, nor takes the text property.
      if (
        !group &&
        (list.some((item) => !item.wildcard !== !child.wildcard) || (child.wildcard && key === textProperty))
      ) {
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
    const name = (local: string, identity: string): string => {
      if (local === textProperty) {
        throw new JsonMappingError(`property collision at ${node.name}/${local}: ${identity} and the text property`);
      }
      return local;
    };
    for (const attribute of attributes) {
      const identity = `attribute {${attribute.ns}}${attribute.name}`;
      put(name(attribute.name, identity), identity, attribute.value);
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
      const identity = `element {${list[0]?.ns ?? ''}}${local}`;
      put(name(local, identity), identity, list.length > 1 ? list.map(generic) : generic(list[0] ?? node));
    }
    if (children.length === 0 && texts.length > 0) {
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
    if (
      !type &&
      !node.nil &&
      !node.mixed &&
      !node.simpleContent &&
      attributes.length === 0 &&
      children.length === 0 &&
      texts.length > 0
    ) {
      const first = texts[0];
      return typed(texts.map((part) => part.value).join(''), first?.type ?? 'string', first?.list, options.numbers);
    }
    const { result, put } = object(node.name);
    if (type) {
      put('#type', 'xsi:type', type);
    }
    for (const attribute of attributes) {
      put(
        attribute.name,
        `attribute {${attribute.ns}}${attribute.name}`,
        typed(attribute.value, attribute.type, attribute.list, options.numbers),
      );
    }
    if (node.nil) {
      // A nil element with attributes: the attributes and a null text property, never children.
      put(textProperty, 'nil content', null);
    } else if (node.mixed) {
      plan ??= planNamespaces(root, prefixes);
      put(textProperty, 'mixed content', serializeMixed(node, plan));
    } else {
      writeElements(node.name, put, children, 0);
      if (texts.length > 0) {
        const first = texts[0];
        put(
          textProperty,
          'simple content',
          typed(texts.map((part) => part.value).join(''), first?.type ?? 'string', first?.list, options.numbers),
        );
      }
    }
    return result;
  };
  return visit(root);
}
