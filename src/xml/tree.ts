// The instance tree: a generated document, independent of its output format. The XML serializer writes it as XML;
// a JSON serializer can write the same data as JSON, which is why the tree keeps three facts XML text loses:
// whether an element may repeat (an array in JSON, even with one item), which occurrence of a repeated model group
// it belongs to, and the JSON type of each value.

export type JsonType = 'integer' | 'number' | 'boolean' | 'string';

export interface InstanceAttribute {
  /** namespace URI, '' for none */
  ns: string;
  name: string;
  value: string;
  type: JsonType;
}

export interface InstanceText {
  kind: 'text';
  value: string;
  type: JsonType;
}

/** One occurrence of a repeated model group. */
export interface GroupOccurrence {
  /** the JSON property of the group, for example `#sequence` */
  key: string;
  /** unique in the document */
  occurrence: number;
}

export interface InstanceElement {
  kind: 'element';
  /** namespace URI, '' for none */
  ns: string;
  name: string;
  attributes: InstanceAttribute[];
  children: InstanceNode[];
  /** Text and child elements share an ordered content stream. */
  mixed?: boolean;
  /** the particle allows repeated occurrences, or several particles of one JSON object declare its name */
  repeatable: boolean;
  /** the occurrences of repeated model groups around this element within its parent, outermost first */
  groups?: GroupOccurrence[];
  /** a complex type with simple content: an object in JSON, even without attributes */
  simpleContent?: boolean;
  /** the prefixes of QName values in this element and its attributes, with their namespaces */
  valueNamespaces?: Record<string, string>;
}

export type InstanceNode = InstanceElement | InstanceText;

export function element(
  ns: string,
  name: string,
  parts: { attributes?: InstanceAttribute[]; children?: InstanceNode[]; repeatable?: boolean } = {},
): InstanceElement {
  return {
    kind: 'element',
    ns,
    name,
    attributes: parts.attributes ?? [],
    children: parts.children ?? [],
    repeatable: parts.repeatable ?? false,
  };
}

export function text(value: string, type: JsonType = 'string'): InstanceText {
  return { kind: 'text', value, type };
}

/** Every element of the tree, the root first. */
export function* elements(root: InstanceElement): Generator<InstanceElement> {
  yield root;
  for (const child of root.children) {
    if (child.kind === 'element') {
      yield* elements(child);
    }
  }
}
