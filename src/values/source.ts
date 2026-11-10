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
