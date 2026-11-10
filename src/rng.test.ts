import { describe, expect, it } from 'vitest';
import { createRng } from './rng.js';

const take = <T>(n: number, f: () => T): T[] => Array.from({ length: n }, f);

describe('createRng', () => {
  it('gives the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(take(5, () => a.next())).toEqual(take(5, () => b.next()));
  });

  it('gives a different sequence for another seed', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(take(5, () => a.next())).not.toEqual(take(5, () => b.next()));
  });

  it('returns floats in [0, 1)', () => {
    const rng = createRng(7);
    for (const x of take(1000, () => rng.next())) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('int', () => {
  it('stays in [min, max] and reaches both ends', () => {
    const rng = createRng(3);
    const seen = new Set(take(500, () => rng.int(1, 6)));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('works for a single value and negative ranges', () => {
    const rng = createRng(3);
    expect(rng.int(5, 5)).toBe(5);
    for (const x of take(200, () => rng.int(-3, -1))) {
      expect(x).toBeGreaterThanOrEqual(-3);
      expect(x).toBeLessThanOrEqual(-1);
    }
  });

  it('rejects an empty or non-integer range', () => {
    const rng = createRng(3);
    expect(() => rng.int(2, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
  });
});

describe('chance', () => {
  it('never and always', () => {
    const rng = createRng(9);
    expect(take(100, () => (rng.chance(0) ? 1 : 0)).every((x) => x === 0)).toBe(true);
    expect(take(100, () => (rng.chance(1) ? 1 : 0)).every((x) => x === 1)).toBe(true);
  });

  it('is roughly fair at 0.5', () => {
    const rng = createRng(9);
    const hits = take(2000, () => rng.chance(0.5)).filter(Boolean).length;
    expect(hits).toBeGreaterThan(850);
    expect(hits).toBeLessThan(1150);
  });
});

describe('pick', () => {
  it('returns every element sometimes', () => {
    const rng = createRng(11);
    const seen = new Set(take(200, () => rng.pick(['a', 'b', 'c'] as const)));
    expect(seen).toEqual(new Set(['a', 'b', 'c']));
  });

  it('rejects an empty array', () => {
    expect(() => createRng(1).pick([])).toThrow(RangeError);
  });
});
