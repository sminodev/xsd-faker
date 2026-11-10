// Parses an XML Schema regular expression (XML Schema Part 2, Appendix F) into a syntax tree.
//
// Grammar, with the names of the functions below:
//
//   regExp    ::= branch ( '|' branch )*            parseAlternation
//   branch    ::= piece*                            parseSequence
//   piece     ::= atom quantifier?                  parsePiece
//   quantifier::= '?' | '*' | '+' | '{' n ( ',' m? )? '}'
//   atom      ::= char | '.' | escape | '[' class ']' | '(' regExp ')'
//
// An XML Schema pattern always matches the whole value, so there are no anchors: ^ and $ are ordinary characters.

import {
  CATEGORIES,
  type CharSet,
  complement,
  DOT,
  fromRegExp,
  MULTI_ESCAPES,
  normalize,
  single,
  subtract,
  union,
} from './charset.js';

export type RegexNode =
  | { kind: 'char'; value: string }
  | { kind: 'set'; set: CharSet }
  | { kind: 'sequence'; items: RegexNode[] }
  | { kind: 'alternation'; options: RegexNode[] }
  | { kind: 'repeat'; item: RegexNode; min: number; max: number };

export class RegexSyntaxError extends Error {
  override name = 'RegexSyntaxError';
}

/** Characters that need a backslash to stand for themselves. */
const SYNTAX = new Set(['\\', '|', '.', '?', '*', '+', '(', ')', '{', '}', '-', '[', ']', '^', '$']);
const SINGLE: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t' };

/** One parsed escape: a single character, or a set of characters. */
type Escape = { char: string } | { set: CharSet };

export function parsePattern(source: string): RegexNode {
  if (source.length > 16384) throw new RegexSyntaxError('pattern exceeds 16384 characters');
  let i = 0;

  const fail = (message: string): never => {
    throw new RegexSyntaxError(`${message} at position ${i} of /${source}/`);
  };
  const peek = (): string | undefined => source[i];

  /** Reads the character at `i` as a whole code point, also outside the Basic Multilingual Plane. */
  const readChar = (): string => {
    const char = String.fromCodePoint(source.codePointAt(i) ?? 0);
    i += char.length;
    return char;
  };

  /** Reads an escape; `i` points behind the backslash. */
  const readEscape = (): Escape => {
    const c = source[i];
    if (c === undefined) {
      return fail('pattern ends with a backslash');
    }
    i += 1;
    const single = SINGLE[c];
    if (single !== undefined) {
      return { char: single };
    }
    if (SYNTAX.has(c)) {
      return { char: c };
    }
    const multi = MULTI_ESCAPES[c];
    if (multi !== undefined) {
      return { set: multi };
    }
    if (c === 'p' || c === 'P') {
      if (source[i] !== '{') {
        return fail(`\\${c} needs {name}`);
      }
      const end = source.indexOf('}', i);
      if (end < 0) {
        return fail('unterminated category escape');
      }
      const name = source.slice(i + 1, end);
      i = end + 1;
      if (!CATEGORIES.has(name)) {
        return fail(
          name.startsWith('Is') ? `block escape \\${c}{${name}} is not supported` : `unknown category ${name}`,
        );
      }
      return { set: fromRegExp(`\\${c}{${name}}`) };
    }
    return fail(`unknown escape \\${c}`);
  };

  const asSet = (escape: Escape): CharSet => ('set' in escape ? escape.set : normalize(single(escape.char)));

  /** One character of a class: a character, an escape, or a range such as a-z. */
  const readClassItem = (): CharSet => {
    const start: Escape = peek() === '\\' ? (i++, readEscape()) : { char: readChar() };
    if ('char' in start && peek() === '-' && source[i + 1] !== '[' && source[i + 1] !== ']') {
      i += 1;
      const end: Escape = peek() === '\\' ? (i++, readEscape()) : { char: readChar() };
      if (!('char' in end)) {
        return fail('a range must end with a single character');
      }
      const from = start.char.codePointAt(0) ?? 0;
      const to = end.char.codePointAt(0) ?? 0;
      if (from > to) {
        return fail(`range ${start.char}-${end.char} is out of order`);
      }
      return [{ from, to }];
    }
    return asSet(start);
  };

  /** A character class: [abc], [^abc], [a-z], or a subtraction [a-z-[aeiou]]; `i` points at '['. */
  const readClass = (): CharSet => {
    i += 1;
    const negated = peek() === '^';
    if (negated) {
      i += 1;
    }
    let set: CharSet = [];
    let first = true;
    for (;;) {
      const c = peek();
      if (c === undefined) {
        return fail('unterminated character class');
      }
      if (c === ']' && !first) {
        i += 1;
        break;
      }
      if (c === '-' && source[i + 1] === '[' && !first) {
        i += 1;
        const removed = readClass();
        if (peek() !== ']') {
          return fail('a class subtraction must end the class');
        }
        i += 1;
        set = subtract(negated ? complement(set) : set, removed);
        return set;
      }
      if (c === '[') {
        return fail('unescaped [ inside a character class');
      }
      first = false;
      set = union(set, readClassItem());
    }
    return negated ? complement(set) : set;
  };

  /** An atom: a character, '.', an escape, a class or a group. */
  const parseAtom = (): RegexNode => {
    const c = peek();
    if (c === '(') {
      i += 1;
      const inner = parseAlternation();
      if (peek() !== ')') {
        return fail('missing )');
      }
      i += 1;
      return inner;
    }
    if (c === '[') {
      return { kind: 'set', set: readClass() };
    }
    if (c === '.') {
      i += 1;
      return { kind: 'set', set: DOT };
    }
    if (c === '\\') {
      i += 1;
      const escape = readEscape();
      return 'char' in escape ? { kind: 'char', value: escape.char } : { kind: 'set', set: escape.set };
    }
    if (c === undefined || c === ')' || c === '|' || c === '?' || c === '*' || c === '+' || c === '{') {
      return fail(`unexpected ${c === undefined ? 'end' : c}`);
    }
    return { kind: 'char', value: readChar() };
  };

  /** Reads a number of a quantifier such as {2,5}. */
  const readNumber = (): number => {
    const start = i;
    while (peek() !== undefined && /[0-9]/.test(peek() as string)) {
      i += 1;
    }
    if (i === start) {
      return fail('a quantifier needs a number');
    }
    return Number(source.slice(start, i));
  };

  // An atom with an optional quantifier.
  const parsePiece = (): RegexNode => {
    const item = parseAtom();
    const c = peek();
    if (c === '?') {
      i += 1;
      return { kind: 'repeat', item, min: 0, max: 1 };
    }
    if (c === '*') {
      i += 1;
      return { kind: 'repeat', item, min: 0, max: Infinity };
    }
    if (c === '+') {
      i += 1;
      return { kind: 'repeat', item, min: 1, max: Infinity };
    }
    if (c === '{') {
      i += 1;
      const min = readNumber();
      let max = min;
      if (peek() === ',') {
        i += 1;
        max = peek() === '}' ? Infinity : readNumber();
      }
      if (peek() !== '}') {
        return fail('missing } of a quantifier');
      }
      i += 1;
      if (max < min) {
        return fail(`quantifier {${min},${max}} is out of order`);
      }
      return { kind: 'repeat', item, min, max };
    }
    return item;
  };

  // Pieces up to the next '|', ')' or the end.
  const parseSequence = (): RegexNode => {
    const items: RegexNode[] = [];
    while (peek() !== undefined && peek() !== '|' && peek() !== ')') {
      items.push(parsePiece());
    }
    return items.length === 1 ? (items[0] as RegexNode) : { kind: 'sequence', items };
  };

  // Branches separated by '|'.
  function parseAlternation(): RegexNode {
    const options = [parseSequence()];
    while (peek() === '|') {
      i += 1;
      options.push(parseSequence());
    }
    return options.length === 1 ? (options[0] as RegexNode) : { kind: 'alternation', options };
  }

  const tree = parseAlternation();
  if (i < source.length) {
    fail(`unexpected ${source[i]}`);
  }
  return tree;
}
