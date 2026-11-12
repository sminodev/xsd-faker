// Character sets as sorted, non-overlapping ranges of code points.
//
// Strings are generated from printable ASCII (U+0020 to U+007E). Whatever a pattern allows, the generator draws from
// that subset of it: \d gives 0-9, \p{L} gives A-Z and a-z, [^abc] gives the printable ASCII characters except a, b
// and c. A subset is always safe: every generated string still matches the pattern. A class written with characters
// outside ASCII, such as [ä-ü], keeps them.

import { NAME_CHAR as NAME_CHAR_CLASS, NAME_START_CHAR } from '../xsd/namechars.js';

/** An inclusive range of code points. */
export interface Range {
  from: number;
  to: number;
}

export type CharSet = readonly Range[];

export const UNIVERSE: CharSet = [{ from: 0x20, to: 0x7e }];

/** Sorts and merges ranges, so that they are sorted and neither overlap nor touch. */
export function normalize(ranges: readonly Range[]): CharSet {
  const sorted = [...ranges].filter((r) => r.from <= r.to).sort((a, b) => a.from - b.from);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last && range.from <= last.to + 1) {
      last.to = Math.max(last.to, range.to);
    } else {
      out.push({ ...range });
    }
  }
  return out;
}

export function union(...sets: CharSet[]): CharSet {
  return normalize(sets.flat());
}

/** The code points of `a` that are not in `b`. */
export function subtract(a: CharSet, b: CharSet): CharSet {
  const out: Range[] = [];
  for (const range of a) {
    let pieces: Range[] = [{ ...range }];
    for (const cut of b) {
      pieces = pieces.flatMap((p) => {
        if (cut.to < p.from || cut.from > p.to) {
          return [p];
        }
        const left = { from: p.from, to: cut.from - 1 };
        const right = { from: cut.to + 1, to: p.to };
        return [left, right].filter((r) => r.from <= r.to);
      });
    }
    out.push(...pieces);
  }
  return normalize(out);
}

/** Everything in the universe that is not in `set`. */
export function complement(set: CharSet): CharSet {
  return subtract(UNIVERSE, set);
}

export function size(set: CharSet): number {
  return set.reduce((n, r) => n + (r.to - r.from + 1), 0);
}

/** The code point at position `index` when the set is counted from its smallest member. */
export function codePointAt(set: CharSet, index: number): number {
  let rest = index;
  for (const range of set) {
    const width = range.to - range.from + 1;
    if (rest < width) {
      return range.from + rest;
    }
    rest -= width;
  }
  throw new RangeError(`index ${index} is outside a set of ${size(set)} code points`);
}

export function single(char: string): CharSet {
  const code = char.codePointAt(0) ?? 0;
  return [{ from: code, to: code }];
}

/** The characters of the universe that match a JavaScript regular expression for one character. */
export function fromRegExp(source: string): CharSet {
  const test = new RegExp(`^${source}$`, 'u');
  const ranges: Range[] = [];
  for (const { from, to } of UNIVERSE) {
    for (let code = from; code <= to; code += 1) {
      if (test.test(String.fromCodePoint(code))) {
        ranges.push({ from: code, to: code });
      }
    }
  }
  return normalize(ranges);
}

// The multi-character escapes of XML Schema, restricted to the universe; \i and \c as XML 1.0, Second Edition.
const NAME_START = fromRegExp(`[${NAME_START_CHAR}]`);
const NAME_CHAR = fromRegExp(`[${NAME_CHAR_CLASS}]`);
const SPACE = fromRegExp('[ \\t\\n\\r]');
const WORD = fromRegExp('[^\\p{P}\\p{Z}\\p{C}]');

export const MULTI_ESCAPES: Readonly<Record<string, CharSet>> = {
  d: fromRegExp('\\p{Nd}'),
  D: fromRegExp('\\P{Nd}'),
  s: SPACE,
  S: complement(SPACE),
  i: NAME_START,
  I: complement(NAME_START),
  c: NAME_CHAR,
  C: complement(NAME_CHAR),
  w: WORD,
  W: complement(WORD),
};

/** `.` matches everything except line breaks. */
export const DOT: CharSet = complement(fromRegExp('[\\n\\r]'));

/** The Unicode categories XML Schema knows; \p{IsBasicLatin} and other blocks are not supported. */
export const CATEGORIES = new Set([
  'L',
  'Lu',
  'Ll',
  'Lt',
  'Lm',
  'Lo',
  'M',
  'Mn',
  'Mc',
  'Me',
  'N',
  'Nd',
  'Nl',
  'No',
  'P',
  'Pc',
  'Pd',
  'Ps',
  'Pe',
  'Pi',
  'Pf',
  'Po',
  'Z',
  'Zs',
  'Zl',
  'Zp',
  'S',
  'Sm',
  'Sc',
  'Sk',
  'So',
  'C',
  'Cc',
  'Cf',
  'Co',
  'Cn',
]);
