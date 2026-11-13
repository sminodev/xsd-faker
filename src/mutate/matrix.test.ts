import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateInvalidSamples } from '../index.js';
import { fileInput } from '../node.js';
import { createRng } from '../rng.js';
import { selectChanges } from './matrix.js';
import { RULES, type Rule } from './rules.js';

const order = join(import.meta.dirname, '..', '..', 'examples', 'retail', 'order.xsd');
const input = () => fileInput(order);
const identity = (s: { rule: string; path: string; value?: string; seed: number }) =>
  `${s.rule} ${s.path} ${s.value ?? ''} ${s.seed}`;

describe('generateInvalidSamples', () => {
  it('gives the same samples, in the order of RULES, for a seed', async () => {
    const a = await generateInvalidSamples(input(), { seed: 3, count: 2 });
    const b = await generateInvalidSamples(input(), { seed: 3, count: 2 });
    expect(b.samples.map((s) => s.xml)).toEqual(a.samples.map((s) => s.xml));
    expect(b.counts).toEqual(a.counts);
    const ranks = a.samples.map((s) => RULES.indexOf(s.rule));
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
    const counted = { confirmed: 0, 'other-cause': 0, accepted: 0, 'not-checkable': 0 };
    for (const s of a.samples) counted[s.status] += 1;
    expect({ ...counted, 'not-constructible': a.notConstructible.length }).toEqual(a.counts);
  });

  it('keeps maxFiles, chooses from every rule, and counts the rest as skipped', async () => {
    const all = await generateInvalidSamples(input(), { seed: 3, count: 2, perRuleAndPath: 3 });
    const rules = new Set(all.samples.map((s) => s.rule));
    const limit = rules.size + 4;
    const some = await generateInvalidSamples(input(), { seed: 3, count: 2, perRuleAndPath: 3, maxFiles: limit });
    expect(some.samples).toHaveLength(limit);
    expect(new Set(some.samples.map((s) => s.rule))).toEqual(rules);
    expect(some.samples.length + some.skipped).toBe(all.samples.length + all.skipped);
    const known = new Set(all.samples.map(identity));
    expect(some.samples.every((s) => known.has(identity(s)))).toBe(true);
    const one = await generateInvalidSamples(input(), { seed: 3, count: 2, perRuleAndPath: 1 });
    expect(one.samples.length + one.skipped).toBe(all.samples.length + all.skipped);
    expect(one.skipped).toBeGreaterThan(all.skipped);
  });
});

describe('selectChanges', () => {
  type Fake = { rule: Rule; id: string; works: boolean };
  const fake = (rule: Rule, id: string, works = true): Fake => ({ rule, id, works });
  const attempt = (c: Fake) => Promise.resolve(c.works ? c.id : undefined);

  it('lets the next change of a place stand in for one that cannot be made', async () => {
    const byKey = new Map<string, Fake[]>([
      ['a', [fake('structure:second-branch', 'a1', false), fake('structure:second-branch', 'a2')]],
      ['b', [fake('facet:pattern', 'b1'), fake('facet:pattern', 'b2')]],
    ]);
    expect(await selectChanges(byKey, 1, 10, createRng(1), attempt)).toEqual({ done: ['a2', 'b1'], skipped: 1 });
  });

  it('gives the turn of a place whose changes all fail to the next place of the rule', async () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const byKey = new Map<string, Fake[]>([
        ['a', [fake('structure:second-branch', 'a1', false)]],
        ['b', [fake('structure:second-branch', 'b1')]],
        ['c', [fake('structure:second-branch', 'c1')]],
      ]);
      const { done, skipped } = await selectChanges(byKey, 1, 1, createRng(seed), attempt);
      expect(done).toHaveLength(1);
      expect(['b1', 'c1']).toContain(done[0]);
      expect(skipped).toBeGreaterThanOrEqual(1);
    }
  });
});
