import { type NamespacePlan, planNamespaces, serializeMixed } from '../xml/serialize.js';
import type { InstanceElement, InstanceText, JsonType } from '../xml/tree.js';
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
      } else {
        put(
          key,
          `element {${first.ns}}${key}`,
          list.length > 1 || list.some((child) => child.repeatable) ? list.map(visit) : visit(first),
        );
      }
    }
  };
  const visit = (node: InstanceElement): JsonValue => {
    const children = node.children.filter((child): child is InstanceElement => child.kind === 'element');
    const texts = node.children.filter((child): child is InstanceText => child.kind === 'text');
    if (
      !node.mixed &&
      !node.simpleContent &&
      node.attributes.length === 0 &&
      children.length === 0 &&
      texts.length > 0
    ) {
      return primitive(texts.map((part) => part.value).join(''), texts[0]?.type ?? 'string', options.numbers);
    }
    const { result, put } = object(node.name);
    for (const attribute of node.attributes) {
      put(
        attribute.name,
        `attribute {${attribute.ns}}${attribute.name}`,
        primitive(attribute.value, attribute.type, options.numbers),
      );
    }
    if (node.mixed) {
      plan ??= planNamespaces(root, prefixes);
      put(textProperty, 'mixed content', serializeMixed(node, plan));
    } else {
      writeElements(node.name, put, children, 0);
      if (texts.length > 0) {
        put(
          textProperty,
          'simple content',
          primitive(texts.map((part) => part.value).join(''), texts[0]?.type ?? 'string', options.numbers),
        );
      }
    }
    return result;
  };
  return visit(root);
}
