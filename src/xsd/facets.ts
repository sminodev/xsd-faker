// The facets of a simple type: its restriction chain followed down to a built-in type, with the facets of all steps
// merged into one description of the allowed values. The raw facets are kept, because values are both generated
// and checked against them.

import { compareDecimal } from '../values/decimal.js';
import type { Element } from '@xmldom/xmldom';
import type { At, Problems } from './problems.js';
import { attr, type QName, type SchemaSet, XS, xsChild, xsChildren } from './schema-set.js';
import { splitXmlSpace, trimXmlSpace } from '../xml/space.js';

export interface Bound {
  /** Original bound, retained for exact decimal and large-integer arithmetic. */
  lexical?: string;
  value: number;
  exclusive: boolean;
}

export interface Facets {
  /** Local name of the built-in type at the bottom of the chain, such as `string` or `decimal`. */
  builtin: string;
  variety: 'atomic' | 'list' | 'union';
  /** The allowed values; the last restriction step with enumerations wins. */
  enumeration?: string[];
  /** The restriction with those values; its namespaces say what prefixes in them stand for. */
  enumerationNode?: Element;
  /** Raw XML Schema patterns, one array per restriction step: alternatives within a step, all steps apply. */
  patterns: string[][];
  length?: number;
  minLength?: number;
  maxLength?: number;
  /** Numeric bounds, for number types only. */
  min?: Bound;
  max?: Bound;
  totalDigits?: number;
  fractionDigits?: number;
  /** A non-numeric bound that still requires final validator checks. */
  unsupportedBounds?: boolean;
  /** The whiteSpace facet; without it, the built-in type decides. */
  whiteSpace?: 'preserve' | 'replace' | 'collapse';
  /** The item type of a list. */
  item?: Facets;
  /** The member types of a union. */
  members?: Facets[];
}

/** A simple type given by name or as an anonymous xs:simpleType element. */
export type SimpleTypeRef = QName | Element;

const isElement = (type: SimpleTypeRef): type is Element => 'nodeType' in type;

/** Built-in integer types and their value ranges. */
export const INTEGERS: Readonly<Record<string, { min?: number; max?: number }>> = {
  integer: {},
  nonPositiveInteger: { max: 0 },
  negativeInteger: { max: -1 },
  nonNegativeInteger: { min: 0 },
  positiveInteger: { min: 1 },
  long: {},
  int: { min: -2147483648, max: 2147483647 },
  short: { min: -32768, max: 32767 },
  byte: { min: -128, max: 127 },
  unsignedLong: { min: 0 },
  unsignedInt: { min: 0, max: 4294967295 },
  unsignedShort: { min: 0, max: 65535 },
  unsignedByte: { min: 0, max: 255 },
};

const NUMBERS = ['decimal', 'float', 'double'];

/**
 * The value of a literal of xs:float or xs:double: the nearest 32-bit float or double, INF and -INF past the
 * largest finite one. `1e39` is INF as an xs:float, `1e-50` is 0.
 */
export function binaryValue(builtin: 'float' | 'double', text: string): number {
  const t = text.trim();
  const number = t === 'INF' ? Infinity : t === '-INF' ? -Infinity : t === 'NaN' ? NaN : Number(t);
  return builtin === 'float' ? Math.fround(number) : number;
}

/** The largest finite value of xs:float and xs:double, as a bound. */
export const FINITE: Readonly<Record<'float' | 'double', Bound>> = {
  float: { value: 3.4028234663852886e38, lexical: '3.4028234663852886e38', exclusive: false },
  double: { value: Number.MAX_VALUE, lexical: '1.7976931348623157e308', exclusive: false },
};
/** Built-in list types and their item types; their length facets count items. */
const LISTS: Readonly<Record<string, string>> = { NMTOKENS: 'NMTOKEN', IDREFS: 'IDREF', ENTITIES: 'ENTITY' };
const OTHER_BUILTINS = [
  'anySimpleType',
  'anyType',
  'string',
  'normalizedString',
  'token',
  'language',
  'Name',
  'NCName',
  'ID',
  'IDREF',
  'IDREFS',
  'ENTITY',
  'ENTITIES',
  'NMTOKEN',
  'NMTOKENS',
  'QName',
  'NOTATION',
  'anyURI',
  'boolean',
  'base64Binary',
  'hexBinary',
  'date',
  'dateTime',
  'time',
  'duration',
  'gYear',
  'gYearMonth',
  'gMonth',
  'gMonthDay',
  'gDay',
];

export function isNumeric(builtin: string): boolean {
  return INTEGERS[builtin] !== undefined || NUMBERS.includes(builtin);
}

export function isKnownBuiltin(local: string): boolean {
  return isNumeric(local) || OTHER_BUILTINS.includes(local);
}

/** The JSON type of a value: what a JSON form of the sample would use. */
export function jsonTypeOf(facets: Facets): 'integer' | 'number' | 'boolean' | 'string' {
  if (facets.variety === 'union') {
    const types = new Set((facets.members ?? []).map(jsonTypeOf));
    if (types.size === 1) {
      return [...types][0] ?? 'string';
    }
    // Integers are numbers too, so such a union can stay numeric.
    return types.size > 1 && [...types].every((type) => type === 'integer' || type === 'number') ? 'number' : 'string';
  }
  if (facets.variety === 'list') {
    return 'string';
  }
  if (INTEGERS[facets.builtin] !== undefined || (isNumeric(facets.builtin) && facets.fractionDigits === 0)) {
    return 'integer';
  }
  if (isNumeric(facets.builtin)) {
    return 'number';
  }
  return facets.builtin === 'boolean' ? 'boolean' : 'string';
}

/** The JSON form of a value: its type, or for an xs:list an array with items of that type. */
export function jsonFormOf(facets: Facets): { type: 'integer' | 'number' | 'boolean' | 'string'; list: boolean } {
  if (facets.variety === 'list') {
    return { type: facets.item ? jsonTypeOf(facets.item) : 'string', list: true };
  }
  return { type: jsonTypeOf(facets), list: false };
}

/** Whether the values of a type are or can contain QNames, whose prefixes the document has to declare. */
export function holdsQNames(facets: Facets): boolean {
  return (
    ['QName', 'NOTATION'].includes(facets.builtin) ||
    (facets.item !== undefined && holdsQNames(facets.item)) ||
    (facets.members ?? []).some(holdsQNames)
  );
}

/** The restriction that enumerates `value`, also in a member of a union. */
export function enumerationScope(facets: Facets, value: string): Element | undefined {
  if (facets.enumeration?.includes(value)) {
    return facets.enumerationNode;
  }
  for (const member of facets.members ?? []) {
    const node = enumerationScope(member, value);
    if (node) {
      return node;
    }
  }
  return undefined;
}

/** The tighter of two bounds: for a lower bound the larger value, for an upper bound the smaller one. */
function tighter(a: Bound | undefined, b: Bound, lower: boolean): Bound {
  if (a === undefined) {
    return b;
  }
  const order = compareDecimal(b.lexical ?? String(b.value), a.lexical ?? String(a.value)) ?? b.value - a.value;
  if (order === 0) return { ...a, exclusive: a.exclusive || b.exclusive };
  return (lower ? order > 0 : order < 0) ? b : a;
}

export class FacetReader {
  constructor(
    private readonly set: SchemaSet,
    private readonly problems: Problems,
  ) {}

  private at(node: Element | undefined): At | undefined {
    return node && this.set.at(node);
  }

  /**
   * The facets of a simple type.
   *
   * @param from - the node that names the type, where problems with the name are reported
   */
  read(type: SimpleTypeRef, from?: Element, seen = new Set<Element>()): Facets {
    if (!isElement(type)) {
      if (type.ns === XS) {
        if (!isKnownBuiltin(type.local)) {
          this.problems.error('unknown-type', `xs:${type.local} is not a built-in type`, this.at(from));
          return { builtin: 'string', variety: 'atomic', patterns: [] };
        }
        return this.builtin(type.local);
      }
      const found = this.set.lookup('simpleType', type);
      if (!found) {
        this.problems.error('unknown-type', `simple type {${type.ns}}${type.local} is not defined`, this.at(from));
        return { builtin: 'string', variety: 'atomic', patterns: [] };
      }
      type = found.node;
    }
    if (seen.has(type)) {
      this.problems.error('circular-type', 'circular simple type derivation', this.at(type));
      return { builtin: 'string', variety: 'atomic', patterns: [] };
    }
    seen.add(type);

    const restriction = xsChild(type, 'restriction');
    if (restriction) {
      const base = attr(restriction, 'base');
      const inner = xsChild(restriction, 'simpleType');
      const facets =
        base !== undefined
          ? this.read(this.set.resolveQName(restriction, base), restriction, seen)
          : inner
            ? this.read(inner, restriction, seen)
            : this.builtin('anySimpleType');
      return this.restrict(facets, restriction);
    }
    const list = xsChild(type, 'list');
    if (list) {
      const itemType = attr(list, 'itemType');
      const inner = xsChild(list, 'simpleType');
      const item = itemType
        ? this.read(this.set.resolveQName(list, itemType), list, seen)
        : inner
          ? this.read(inner, list, seen)
          : this.builtin('string');
      return { builtin: 'string', variety: 'list', patterns: [], item };
    }
    const union = xsChild(type, 'union');
    if (union) {
      const named = splitXmlSpace(attr(union, 'memberTypes') ?? '').map((q) =>
        this.read(this.set.resolveQName(union, q), union, new Set(seen)),
      );
      const inner = xsChildren(union)
        .filter((c) => c.localName === 'simpleType')
        .map((c) => this.read(c, union, new Set(seen)));
      return { builtin: 'anySimpleType', variety: 'union', patterns: [], members: [...named, ...inner] };
    }
    return this.builtin('anySimpleType');
  }

  /** A built-in type, with the value range of the integer types. */
  private builtin(local: string): Facets {
    const item = LISTS[local];
    if (item !== undefined) {
      return { builtin: local, variety: 'list', patterns: [], minLength: 1, item: this.builtin(item) };
    }
    const facets: Facets = { builtin: local, variety: 'atomic', patterns: [] };
    const range = INTEGERS[local];
    if (range?.min !== undefined) {
      facets.min = { value: range.min, exclusive: false };
    }
    if (range?.max !== undefined) {
      facets.max = { value: range.max, exclusive: false };
    }
    if (local === 'long') {
      facets.min = { value: Number('-9223372036854775808'), lexical: '-9223372036854775808', exclusive: false };
      facets.max = { value: Number('9223372036854775807'), lexical: '9223372036854775807', exclusive: false };
    } else if (local === 'unsignedLong') {
      facets.max = { value: Number('18446744073709551615'), lexical: '18446744073709551615', exclusive: false };
    }
    return facets;
  }

  /** Applies the facets of one restriction step to the facets of its base. */
  restrict(base: Facets, restriction: Element): Facets {
    const out: Facets = { ...base, patterns: [...base.patterns] };
    const patterns: string[] = [];
    const values: string[] = [];
    for (const facet of xsChildren(restriction)) {
      const name = facet.localName ?? '';
      if (name === 'simpleType' || name === 'attribute' || name === 'attributeGroup' || name === 'anyAttribute') {
        continue;
      }
      const value = attr(facet, 'value') ?? '';
      if (name === 'enumeration') {
        values.push(value);
      } else if (name === 'pattern') {
        patterns.push(value);
      } else {
        this.mergeFacet(out, name, value, facet);
      }
    }
    if (patterns.length > 0) {
      out.patterns.push(patterns);
    }
    if (values.length > 0) {
      out.enumeration = values;
      out.enumerationNode = restriction;
    }
    return out;
  }

  /** Merges one facet (other than pattern and enumeration) into `facets`, keeping the tightest limit. */
  private mergeFacet(facets: Facets, name: string, value: string, node: Element): void {
    const count = Number(value);
    switch (name) {
      case 'length':
      case 'minLength':
      case 'maxLength':
      case 'totalDigits':
      case 'fractionDigits':
        if (!/^[ \t\n\r]*\+?[0-9]+[ \t\n\r]*$/.test(value) || (name === 'totalDigits' && count === 0)) {
          this.problems.error(
            'invalid-facet',
            `${name} needs a ${name === 'totalDigits' ? 'positive' : 'non-negative'} integer, not "${value}"`,
            this.at(node),
          );
          return;
        }
        if (name === 'length') {
          facets.length = count;
        } else if (name === 'minLength') {
          facets.minLength = Math.max(facets.minLength ?? 0, count);
        } else if (name === 'maxLength') {
          facets.maxLength = Math.min(facets.maxLength ?? Infinity, count);
        } else if (name === 'totalDigits') {
          facets.totalDigits = Math.min(facets.totalDigits ?? Infinity, count);
        } else {
          facets.fractionDigits = Math.min(facets.fractionDigits ?? Infinity, count);
        }
        return;
      case 'minInclusive':
      case 'minExclusive':
      case 'maxInclusive':
      case 'maxExclusive': {
        if (!isNumeric(facets.builtin)) {
          facets.unsupportedBounds = true;
          this.problems.warning('unsupported', `${name} on xs:${facets.builtin} is not supported`, this.at(node));
          return;
        }
        const lexical = trimXmlSpace(value);
        const bound = Number(lexical);
        if (['INF', '-INF', 'NaN'].includes(lexical)) {
          this.problems.error(
            'unsupported',
            `${name} ${lexical} on xs:${facets.builtin} is not supported`,
            this.at(node),
          );
          return;
        }
        if (lexical === '' || !Number.isFinite(bound) || /[^0-9+\-.eE]/.test(lexical)) {
          this.problems.error('invalid-facet', `${name} needs a number, not "${value}"`, this.at(node));
          return;
        }
        const exclusive = name.endsWith('Exclusive');
        if (name.startsWith('min')) {
          facets.min = tighter(facets.min, { value: bound, lexical, exclusive }, true);
        } else {
          facets.max = tighter(facets.max, { value: bound, lexical, exclusive }, false);
        }
        return;
      }
      case 'whiteSpace':
        if (value === 'preserve' || value === 'replace' || value === 'collapse') {
          facets.whiteSpace = value;
        }
        return;
      default:
        this.problems.error('unsupported', `facet xs:${name} is not supported`, this.at(node));
    }
  }
}
