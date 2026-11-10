// A seeded pseudo-random number generator: the same seed always gives the same sequence, so a sample can be
// generated again from its seed. Every random decision of the generator goes through this interface.

export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max], both included. */
  int(min: number, max: number): number;
  /** true with probability `p` (0 never, 1 always). */
  chance(p: number): boolean;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

/** mulberry32: a small, fast generator with 32 bits of state. Good enough for test data, not for cryptography. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Local functions instead of methods: `const { pick } = rng` keeps working, because nothing depends on `this`.
export function createRng(seed: number): Rng {
  const next = mulberry32(seed);

  function int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      throw new RangeError(`int(${min}, ${max}) needs integers with min <= max`);
    }
    return min + Math.floor(next() * (max - min + 1));
  }

  function chance(p: number): boolean {
    return next() < p;
  }

  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('pick() needs a non-empty array');
    }
    return items[int(0, items.length - 1)] as T;
  }

  return { next, int, chance, pick };
}
