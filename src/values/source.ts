// The walker asks a ValueSource for simple values. firstOf checks each candidate before accepting it.

import type { Rng } from '../rng.js';
import type { Facets } from '../xsd/facets.js';
import { checkValue } from './check.js';
import { generateValue } from './generate.js';

export interface ValueContext {
  facets: Facets;
  /** local name of the element or attribute */
  name: string;
  /** local names from the root down to this element or attribute */
  path: readonly string[];
  kind: 'element' | 'attribute';
  rng: Rng;
  /** the expanded name `{namespace}local` of the value's type; absent for an anonymous or a built-in type */
  typeName?: string;
  /** the named types the value's type derives from, nearest first, without built-in types */
  baseTypeNames?: readonly string[];
  /**
   * The elements of complex type around the value, outermost first. For an attribute, and for the text of simple
   * content, the element that holds it comes last.
   */
  scopes?: readonly ValueScope[];
}

/** One element instance around a value; a source keeps what belongs to that instance in `state`. */
export interface ValueScope {
  /** local name of the element */
  name: string;
  /** local names from the root down to the element */
  path: readonly string[];
  /** unique within the document; a repeated element has a new one for each occurrence */
  instanceId: number;
  state: Map<string, unknown>;
}

export interface ValueSource {
  /** A value that satisfies `context.facets`, or undefined if the source has none. */
  value(context: ValueContext): string | undefined;
}

/** Values made from the facets alone. */
export const facetValues: ValueSource = {
  value: ({ facets, rng }) => generateValue(facets, rng),
};

/** Asks the sources in turn and takes the first value that satisfies the facets. */
export function firstOf(...sources: ValueSource[]): ValueSource {
  return {
    value(context) {
      for (const source of sources) {
        const value = source.value(context);
        if (value !== undefined && checkValue(context.facets, value) === undefined) {
          return value;
        }
      }
      return undefined;
    },
  };
}
