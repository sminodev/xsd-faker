// Generates a random string that matches a parsed pattern.

import type { Rng } from '../rng.js';
import { codePointAt, size } from './charset.js';
import { parsePattern, type RegexNode } from './parse.js';

export interface GenerateStringOptions {
  /** How many repetitions beyond the minimum an unbounded quantifier (*, +, {n,}) may add. Default: 3. */
  maxExtraRepeats?: number;
}

export class UngeneratableError extends Error {
  override name = 'UngeneratableError';
}

export function generateString(node: RegexNode, rng: Rng, options: GenerateStringOptions = {}): string {
  const extra = options.maxExtraRepeats ?? 3;
  if (!Number.isSafeInteger(extra) || extra < 0 || extra > 65536)
    throw new RangeError('maxExtraRepeats must be an integer from 0 to 65536');
  let visits = 0;
  let emitted = 0;
  const walk = (n: RegexNode): string => {
    if (++visits > 100000) throw new UngeneratableError('pattern expansion exceeds its work budget');
    switch (n.kind) {
      case 'char':
        emitted += n.value.length;
        if (emitted > 65536) throw new UngeneratableError('pattern output exceeds 65536 characters');
        return n.value;
      case 'set': {
        const count = size(n.set);
        if (count === 0) {
          throw new UngeneratableError('a character class matches no character the generator can produce');
        }
        if (++emitted > 65536) throw new UngeneratableError('pattern output exceeds 65536 characters');
        return String.fromCodePoint(codePointAt(n.set, rng.int(0, count - 1)));
      }
      case 'sequence':
        return n.items.map(walk).join('');
      case 'alternation':
        return walk(rng.pick(n.options));
      case 'repeat': {
        const max = n.max === Infinity ? n.min + extra : n.max;
        if (!Number.isSafeInteger(n.min) || n.min < 0 || n.min > 65536)
          throw new UngeneratableError('pattern repetition exceeds 65536');
        const times = rng.int(n.min, Math.min(max, 65536));
        let out = '';
        for (let k = 0; k < times; k += 1) {
          out += walk(n.item);
        }
        return out;
      }
      default: {
        const unknown: never = n;
        throw new Error(`unknown node ${JSON.stringify(unknown)}`);
      }
    }
  };
  return walk(node);
}

/** Parses an XML Schema pattern and generates one matching string. */
export function stringFromPattern(pattern: string, rng: Rng, options?: GenerateStringOptions): string {
  return generateString(parsePattern(pattern), rng, options);
}
