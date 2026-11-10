import { describe, expect, it } from 'vitest';
import { parsePattern, RegexSyntaxError } from './parse.js';

const char = (value: string) => ({ kind: 'char', value });

describe('parsePattern', () => {
  it('reads a single character as it is', () => {
    expect(parsePattern('a')).toEqual(char('a'));
  });

  it('reads characters in a row as a sequence', () => {
    expect(parsePattern('ab')).toEqual({ kind: 'sequence', items: [char('a'), char('b')] });
  });

  it('reads branches as an alternation', () => {
    expect(parsePattern('a|bc')).toEqual({
      kind: 'alternation',
      options: [char('a'), { kind: 'sequence', items: [char('b'), char('c')] }],
    });
  });

  it('reads every quantifier as a repeat', () => {
    const repeat = (min: number, max: number) => ({ kind: 'repeat', item: char('a'), min, max });
    expect(parsePattern('a?')).toEqual(repeat(0, 1));
    expect(parsePattern('a*')).toEqual(repeat(0, Infinity));
    expect(parsePattern('a+')).toEqual(repeat(1, Infinity));
    expect(parsePattern('a{3}')).toEqual(repeat(3, 3));
    expect(parsePattern('a{2,}')).toEqual(repeat(2, Infinity));
    expect(parsePattern('a{2,5}')).toEqual(repeat(2, 5));
  });

  it('applies a quantifier to a group', () => {
    expect(parsePattern('(ab){2}')).toEqual({
      kind: 'repeat',
      item: { kind: 'sequence', items: [char('a'), char('b')] },
      min: 2,
      max: 2,
    });
  });

  it('reads classes, escapes and the dot as sets', () => {
    expect(parsePattern('[a-c]')).toEqual({ kind: 'set', set: [{ from: 97, to: 99 }] });
    expect(parsePattern('\\d')).toEqual({ kind: 'set', set: [{ from: 48, to: 57 }] });
    expect(parsePattern('[^ -~]')).toEqual({ kind: 'set', set: [] });
    expect(parsePattern('[a-e-[bd]]')).toEqual({
      kind: 'set',
      set: [
        { from: 97, to: 97 },
        { from: 99, to: 99 },
        { from: 101, to: 101 },
      ],
    });
  });

  it('treats ^ and $ as ordinary characters and unescapes syntax characters', () => {
    expect(parsePattern('^\\.$')).toEqual({ kind: 'sequence', items: [char('^'), char('.'), char('$')] });
  });

  it.each([
    ['(ab', 'missing )'],
    ['[ab', 'unterminated character class'],
    ['a{3,1}', 'out of order'],
    ['*a', 'unexpected *'],
    ['\\q', 'unknown escape'],
    ['\\p{IsBasicLatin}', 'block escape'],
    ['a)', 'unexpected )'],
  ])('rejects /%s/ (%s)', (pattern, message) => {
    expect(() => parsePattern(pattern)).toThrow(RegexSyntaxError);
    expect(() => parsePattern(pattern)).toThrow(message);
  });
});
