import { escapeText, serializeXml } from '../xml/serialize.js';
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
/** Serializes the same instance used for XML. Collisions fail instead of overwriting data. */
export function toJson(root: InstanceElement, options: JsonOptions = {}): JsonValue {
  if (options.mode === 'tree') {
    return JSON.parse(JSON.stringify(root)) as JsonValue;
  }
  const textProperty = options.textProperty ?? 'value';
  if (!textProperty) {
    throw new TypeError('textProperty must not be empty');
  }
  const visit = (node: InstanceElement): JsonValue => {
    const children = node.children.filter((child): child is InstanceElement => child.kind === 'element');
    const texts = node.children.filter((child): child is InstanceText => child.kind === 'text');
    if (!node.mixed && node.attributes.length === 0 && children.length === 0 && texts.length > 0) {
      return primitive(texts.map((part) => part.value).join(''), texts[0]?.type ?? 'string', options.numbers);
    }
    const result: {
      [key: string]: JsonValue;
    } = Object.create(null) as {
      [key: string]: JsonValue;
    };
    const names = new Map<string, string>();
    const put = (name: string, identity: string, value: JsonValue): void => {
      if (names.has(name)) {
        throw new JsonMappingError(
          `property collision at ${node.name}/${name}: ${names.get(name)} and ${identity}; use mode: 'tree'`,
        );
      }
      names.set(name, identity);
      Object.defineProperty(result, name, { value, enumerable: true, writable: true, configurable: true });
    };
    for (const attribute of node.attributes) {
      put(
        attribute.name,
        `attribute {${attribute.ns}}${attribute.name}`,
        primitive(attribute.value, attribute.type, options.numbers),
      );
    }
    if (node.mixed) {
      const content = node.children
        .map((child) =>
          child.kind === 'text'
            ? escapeText(child.value)
            : serializeXml(child, { declaration: false, indent: '' }).trimEnd(),
        )
        .join('');
      put(textProperty, 'mixed content', content);
    } else {
      const groups = new Map<string, InstanceElement[]>();
      for (const child of children) {
        const list = groups.get(child.name) ?? [];
        if (list.some((item) => item.ns !== child.ns)) {
          throw new JsonMappingError(`namespace collision at ${node.name}/${child.name}; use mode: 'tree'`);
        }
        list.push(child);
        groups.set(child.name, list);
      }
      for (const [name, group] of groups) {
        const first = group[0];
        if (first) {
          put(
            name,
            `element {${first.ns}}${name}`,
            group.length > 1 || group.some((child) => child.repeatable) ? group.map(visit) : visit(first),
          );
        }
      }
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
