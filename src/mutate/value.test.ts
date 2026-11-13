import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { validateXml } from '../validate/xmllint.js';
import { RULES, type ValueRule, isValueRule } from './rules.js';
import { generateViolatingValue, type ValueFacets } from './value.js';

const constructed = (facets: ValueFacets, rule: ValueRule, mustSatisfy?: ValueFacets) => {
  const result = generateViolatingValue({ facets, rule, ...(mustSatisfy ? { mustSatisfy } : {}) });
  if (result.status !== 'constructed') throw new Error(`${rule}: ${result.reason}`);
  return result.value;
};
const refused = (facets: ValueFacets, rule: ValueRule) => {
  const result = generateViolatingValue({ facets, rule });
  if (result.status !== 'not-constructible') throw new Error(`${rule}: constructed ${result.value}`);
  return result;
};

describe('generateViolatingValue', () => {
  it('breaks one length facet of a string and keeps its pattern', () => {
    const code: ValueFacets = { builtin: 'string', patterns: [['[A-Z]{2,8}']], minLength: 3, maxLength: 6 };
    expect(constructed(code, 'facet:minLength')).toMatch(/^[A-Z]{2}$/);
    expect(constructed(code, 'facet:maxLength')).toMatch(/^[A-Z]{7,8}$/);
    expect(constructed(code, 'facet:pattern')).toMatch(/^.{3,6}$/u);
    expect(constructed(code, 'facet:pattern')).not.toMatch(/^[A-Z]+$/);
  });

  it('breaks bounds and digits of a decimal and nothing else', () => {
    const amount: ValueFacets = {
      builtin: 'decimal',
      minInclusive: '0',
      maxExclusive: '1000',
      totalDigits: 6,
      fractionDigits: 2,
    };
    expect(Number(constructed(amount, 'facet:minInclusive'))).toBeLessThan(0);
    expect(Number(constructed(amount, 'facet:maxExclusive'))).toBeGreaterThanOrEqual(1000);
    const fraction = constructed(amount, 'facet:fractionDigits');
    expect(fraction.split('.')[1]?.replace(/0+$/, '').length).toBeGreaterThan(2);
    expect(Number(fraction)).toBeGreaterThanOrEqual(0);
    expect(Number(fraction)).toBeLessThan(1000);
    expect(constructed(amount, 'value:lexical')).not.toMatch(/^-?\d+(\.\d+)?$/);
  });

  it('counts the items of a list', () => {
    const codes: ValueFacets = {
      builtin: 'string',
      variety: 'list',
      item: { builtin: 'int' },
      minLength: 2,
      maxLength: 3,
    };
    expect(constructed(codes, 'facet:maxLength').split(' ').length).toBeGreaterThan(3);
    expect(constructed(codes, 'facet:minLength').split(' ').filter(Boolean).length).toBeLessThan(2);
    const items = constructed(codes, 'value:lexical').split(' ');
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.some((item) => !/^[+-]?\d+$/.test(item))).toBe(true);
  });

  it('takes a value outside an enumeration, and another value than the fixed one', () => {
    const status: ValueFacets = { builtin: 'token', enumeration: ['open', 'closed'] };
    expect(['open', 'closed']).not.toContain(constructed(status, 'facet:enumeration'));
    expect(constructed({ ...status, fixed: 'open' }, 'value:fixed')).toBe('closed');
    expect(constructed({ builtin: 'boolean', enumeration: ['true'] }, 'facet:enumeration')).toMatch(/^(false|0)$/);
  });

  it('keeps a value inside the facets of another version', () => {
    const narrowed: ValueFacets = { builtin: 'string', maxLength: 5 };
    const before: ValueFacets = { builtin: 'string', maxLength: 10 };
    for (let seed = 1; seed <= 20; seed += 1) {
      const result = generateViolatingValue({ facets: narrowed, rule: 'facet:maxLength', mustSatisfy: before, seed });
      expect(result.status).toBe('constructed');
      if (result.status === 'constructed') expect(result.value.length).toBeGreaterThan(5);
      if (result.status === 'constructed') expect(result.value.length).toBeLessThanOrEqual(10);
    }
    const added = generateViolatingValue({
      facets: { builtin: 'token', enumeration: ['a', 'b'] },
      rule: 'facet:enumeration',
      mustSatisfy: { builtin: 'token', enumeration: ['a', 'b', 'c'] },
    });
    expect(added).toEqual({ status: 'constructed', value: 'c', rule: 'facet:enumeration' });
  });

  it('decides couplings that leave no such value', () => {
    expect(refused({ builtin: 'string', length: 9, patterns: [['[0-9]{9}']] }, 'facet:length')).toMatchObject({
      decided: true,
      reason: 'every value of the pattern has a length of 9 to 9',
    });
    expect(refused({ builtin: 'token', enumeration: ['a', 'bb'], maxLength: 2 }, 'facet:maxLength').decided).toBe(true);
    expect(
      refused({ builtin: 'int', maxInclusive: '999', minInclusive: '-999', totalDigits: 3 }, 'facet:totalDigits'),
    ).toMatchObject({ decided: true });
    expect(refused({ builtin: 'integer', fractionDigits: 2 }, 'facet:fractionDigits').decided).toBe(true);
    expect(refused({ builtin: 'decimal', totalDigits: 2, fractionDigits: 2 }, 'facet:fractionDigits').decided).toBe(
      true,
    );
    expect(refused({ builtin: 'string', fixed: 'x', maxLength: 3 }, 'facet:maxLength').decided).toBe(true);
    expect(refused({ builtin: 'string', minLength: 0 }, 'facet:minLength').decided).toBe(true);
    expect(
      refused({ builtin: 'string', variety: 'list', item: { builtin: 'int' }, minLength: 0 }, 'facet:minLength'),
    ).toMatchObject({ decided: true, reason: 'no length is below 0' });
    expect(refused({ builtin: 'unsignedInt', minInclusive: '0' }, 'facet:minInclusive').reason).toContain(
      'only what xs:unsignedInt excludes',
    );
    expect(refused({ builtin: 'string' }, 'value:lexical').reason).toBe('every string is a valid xs:string');
    expect(refused({ builtin: 'string' }, 'facet:maxLength').reason).toBe('the type has no maxLength');
  });

  it('is deterministic for a seed', () => {
    const facets: ValueFacets = { builtin: 'string', patterns: [['[a-z]{3,9}']], maxLength: 5 };
    const a = generateViolatingValue({ facets, rule: 'facet:maxLength', seed: 9 });
    expect(generateViolatingValue({ facets, rule: 'facet:maxLength', seed: 9 })).toEqual(a);
  });

  it('accepts every value rule and rejects malformed facets', () => {
    for (const rule of RULES.filter(isValueRule)) {
      expect(() => generateViolatingValue({ facets: { builtin: 'decimal' }, rule })).not.toThrow();
    }
    expect(() => generateViolatingValue({ facets: { builtin: 'text' }, rule: 'facet:pattern' })).toThrow(TypeError);
    expect(() =>
      generateViolatingValue({ facets: { builtin: 'int', minInclusive: 'x' }, rule: 'facet:pattern' }),
    ).toThrow(TypeError);
    expect(() =>
      generateViolatingValue({ facets: { builtin: 'int' }, rule: 'structure:order' as unknown as ValueRule }),
    ).toThrow(TypeError);
  });

  it('breaks fractionDigits where totalDigits leaves one digit more, whatever the seed', () => {
    const tight: ValueFacets = { builtin: 'decimal', totalDigits: 6, fractionDigits: 5 };
    for (let seed = 1; seed <= 40; seed += 1) {
      const result = generateViolatingValue({ facets: tight, rule: 'facet:fractionDigits', seed });
      expect(result.status, `seed ${seed}`).toBe('constructed');
      if (result.status === 'constructed') expect(result.value).toMatch(/^-?0\.\d{5}[1-9]$/);
    }
  });

  it('never throws, whatever the facets and the rule', () => {
    const rng = createRng(11);
    for (let n = 0; n < 300; n += 1) {
      const facets = randomFacets(rng);
      const mustSatisfy = rng.chance(0.3) ? randomFacets(rng) : undefined;
      for (const rule of RULES.filter(isValueRule)) {
        expect(
          () => generateViolatingValue({ facets, rule, seed: n, ...(mustSatisfy ? { mustSatisfy } : {}) }),
          JSON.stringify({ facets, rule, mustSatisfy }),
        ).not.toThrow();
      }
    }
  });
});

const NUMBERS = ['decimal', 'integer', 'int', 'unsignedByte', 'double', 'float'];
const DATES = ['date', 'dateTime', 'time', 'gYear', 'gYearMonth', 'gDay', 'duration'];
const OTHERS = ['string', 'token', 'NCName', 'boolean', 'hexBinary', 'base64Binary', 'anyURI', 'language'];
const DATE_BOUNDS: Readonly<Record<string, string[]>> = {
  date: ['2020-01-01', '2021-06-30Z', '2019-12-31+05:00'],
  dateTime: ['2020-01-01T00:00:00', '2021-06-30T12:00:00Z'],
  time: ['08:00:00', '17:30:00Z'],
  gYear: ['2000', '2030Z'],
  gYearMonth: ['2020-01', '2024-12Z'],
  gDay: ['---10'],
  duration: ['P1D', 'PT36H'],
};

/** Facets of any shape the API accepts: atomic, list and union, numbers, dates, strings, binary, INF bounds. */
function randomFacets(rng: ReturnType<typeof createRng>, depth = 0): ValueFacets {
  const maybe = <T>(value: T) => (rng.chance(0.35) ? value : undefined);
  const shape = depth > 0 ? 0 : rng.int(0, 9);
  if (shape === 8) {
    return {
      builtin: 'string',
      variety: 'list',
      item: randomFacets(rng, depth + 1),
      ...(rng.chance(0.5) ? { maxLength: rng.int(0, 4) } : {}),
      ...(rng.chance(0.3) ? { minLength: rng.int(0, 3) } : {}),
    };
  }
  if (shape === 9) {
    return {
      builtin: 'anySimpleType',
      variety: 'union',
      members: [randomFacets(rng, depth + 1), randomFacets(rng, depth + 1)],
      ...(rng.chance(0.4) ? { enumeration: ['5', 'true', '2020-01-01', 'x'] } : {}),
      ...(rng.chance(0.3) ? { patterns: [['[0-9a-z-]+']] } : {}),
    };
  }
  const builtin = rng.pick([...NUMBERS, ...DATES, ...OTHERS]);
  const numeric = NUMBERS.includes(builtin);
  const total = rng.int(1, 6);
  const bounds = DATE_BOUNDS[builtin];
  const binary = builtin === 'float' || builtin === 'double';
  const candidate: Record<string, unknown> = {
    builtin,
    enumeration: maybe(
      rng.pick([
        ['1', '22', 'abc'],
        ['0a', 'FF'],
        ['true', '0'],
        ['+5', '7'],
      ]),
    ),
    patterns: maybe([[rng.pick(['[0-9]{3}', '[A-Z]+', '.{1,4}', 'a|bb|ccc', '\\d{2}-\\d{2}', '[^x]*'])]]),
    length: numeric || bounds ? undefined : maybe(rng.int(0, 5)),
    minLength: numeric || bounds ? undefined : maybe(rng.int(0, 4)),
    maxLength: numeric || bounds ? undefined : maybe(rng.int(0, 6)),
    totalDigits: numeric && !binary ? maybe(total) : undefined,
    fractionDigits: builtin === 'decimal' ? maybe(rng.int(0, total)) : undefined,
    minInclusive: numeric
      ? maybe(binary && rng.chance(0.3) ? '-INF' : String(rng.int(-1500, 1500)))
      : bounds
        ? maybe(rng.pick(bounds))
        : undefined,
    maxExclusive: numeric
      ? maybe(binary && rng.chance(0.3) ? 'INF' : String(rng.int(-50, 2000)))
      : bounds
        ? maybe(rng.pick(bounds))
        : undefined,
    whiteSpace: builtin === 'string' ? maybe(rng.pick(['preserve', 'replace', 'collapse'])) : undefined,
    fixed: maybe(rng.pick(['1', '+5', 'true', '0A'])),
  };
  return Object.fromEntries(Object.entries(candidate).filter(([, v]) => v !== undefined)) as unknown as ValueFacets;
}

describe('generateViolatingValue in the value space', () => {
  const values = (facets: ValueFacets, rule: ValueRule, seeds = 30, mustSatisfy?: ValueFacets) => {
    const out: string[] = [];
    for (let seed = 1; seed <= seeds; seed += 1) {
      const result = generateViolatingValue({ facets, rule, seed, ...(mustSatisfy ? { mustSatisfy } : {}) });
      if (result.status === 'constructed') out.push(result.value);
    }
    return out;
  };

  it('compares a fixed value by value, not by spelling', () => {
    const flag = values({ builtin: 'boolean', fixed: '1' }, 'value:fixed');
    expect(flag.length).toBeGreaterThan(0);
    expect(flag.every((v) => v === 'false' || v === '0')).toBe(true);
    const level = values({ builtin: 'int', fixed: '+5' }, 'value:fixed');
    expect(level.length).toBeGreaterThan(0);
    expect(level.some((v) => Number(v) === 5)).toBe(false);
    expect(values({ builtin: 'hexBinary', fixed: '0A' }, 'value:fixed').some((v) => v.toUpperCase() === '0A')).toBe(
      false,
    );
    expect(values({ builtin: 'float', fixed: '1.0' }, 'value:fixed').some((v) => Number(v) === 1)).toBe(false);
    const day = values({ builtin: 'date', fixed: '2026-01-01Z' }, 'value:fixed');
    expect(day).not.toContain('2026-01-01+00:00');
    expect(day).not.toContain('2026-01-01Z');
  });

  it('takes no value of an enumeration that differs only in spelling or whitespace', () => {
    const hex = values({ builtin: 'hexBinary', enumeration: ['0a', 'ff'], length: 1 }, 'facet:enumeration', 300);
    expect(hex.length).toBeGreaterThan(0);
    expect(hex.some((v) => ['0A', 'FF', '0a', 'ff', '0A'.toLowerCase()].includes(v))).toBe(false);
    const union: ValueFacets = {
      builtin: 'anySimpleType',
      variety: 'union',
      members: [{ builtin: 'int' }, { builtin: 'boolean' }],
      enumeration: ['5', 'true'],
    };
    const outside = values(union, 'facet:enumeration', 300);
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.some((v) => v.trim() === 'true' || /^\s*\+?0*5\s*$/.test(v))).toBe(false);
  });

  it('orders dates and keeps the bounds of a type, its items and its members', () => {
    const since: ValueFacets = { builtin: 'date', minInclusive: '2020-01-01', maxExclusive: '2021-01-01' };
    for (const rule of ['facet:minInclusive', 'facet:maxExclusive'] as const) {
      const found = values(since, rule, 20);
      expect(found.length, rule).toBe(20);
      for (const v of found) {
        if (rule === 'facet:minInclusive') expect(v < '2020-01-01', v).toBe(true);
        else expect(v >= '2021-01-01', v).toBe(true);
      }
    }
    const patterned: ValueFacets = { ...since, patterns: [['\\d{4}-0[1-6]-\\d{2}']] };
    const offPattern = values(patterned, 'facet:pattern', 20);
    expect(offPattern.length).toBeGreaterThan(0);
    for (const v of offPattern.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
      expect(v >= '2020-01-01' && v < '2021-01-01', v).toBe(true);
    }
    expect(values(since, 'value:lexical', 5)).toHaveLength(5);
    const listed: ValueFacets = {
      builtin: 'string',
      variety: 'list',
      item: { builtin: 'date', minInclusive: '2020-01-01' },
      maxLength: 2,
    };
    const long = values(listed, 'facet:maxLength', 20);
    expect(long.length).toBeGreaterThan(10);
    for (const v of long)
      expect(
        v.split(' ').every((d) => d >= '2020-01-01'),
        v,
      ).toBe(true);
    const either: ValueFacets = {
      builtin: 'anySimpleType',
      variety: 'union',
      members: [{ builtin: 'date', minInclusive: '2020-01-01' }, { builtin: 'gYear' }],
      patterns: [['\\d{4}(-\\d{2}-\\d{2})?']],
    };
    for (const v of values(either, 'facet:pattern', 30)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) expect(v.trim() >= '2020-01-01', v).toBe(true);
    }
  });

  it('writes no space around a date, which libxml2 does not take', () => {
    const day = values({ builtin: 'date', enumeration: ['2026-01-01'] }, 'facet:enumeration', 300);
    expect(day.filter((v) => v !== v.trim())).toEqual([]);
  });

  it('reads the value of a union as the member that reads it normalizes it', () => {
    const when: ValueFacets = {
      builtin: 'anySimpleType',
      variety: 'union',
      members: [{ builtin: 'date', minInclusive: '2020-01-01' }, { builtin: 'gYear' }],
      patterns: [['[0-9\\-]+', 'x']],
    };
    for (const v of values(when, 'facet:pattern', 30)) expect(v.trim(), JSON.stringify(v)).not.toMatch(/^[0-9-]+$/);
  });

  it('gives up only the bound rules where a type has no order here', () => {
    const span: ValueFacets = { builtin: 'duration', maxInclusive: 'P1Y' };
    expect(generateViolatingValue({ facets: span, rule: 'facet:maxInclusive' })).toMatchObject({
      status: 'not-constructible',
      decided: false,
    });
    expect(generateViolatingValue({ facets: span, rule: 'value:lexical' }).status).toBe('constructed');
    const mixed: ValueFacets = { builtin: 'date', minInclusive: '2020-01-01Z' };
    for (const v of values(mixed, 'facet:minInclusive', 10)) expect(v.endsWith('Z'), v).toBe(true);
  });

  it('keeps a value inside a type of the same family with another built-in type', () => {
    const now: ValueFacets = { builtin: 'int', maxInclusive: '100' };
    const before: ValueFacets = { builtin: 'integer', maxInclusive: '150' };
    const found = values(now, 'facet:maxInclusive', 20, before);
    expect(found).toHaveLength(20);
    for (const v of found) expect(Number(v) > 100 && Number(v) <= 150, v).toBe(true);
    const words = values({ builtin: 'token', maxLength: 3 }, 'facet:maxLength', 20, {
      builtin: 'string',
      maxLength: 6,
    });
    expect(words).toHaveLength(20);
    const lists = values(
      { builtin: 'string', variety: 'list', item: { builtin: 'int', maxInclusive: '9' }, maxLength: 2 },
      'facet:maxLength',
      20,
      { builtin: 'string', variety: 'list', item: { builtin: 'int', minInclusive: '5' } },
    );
    expect(lists).toHaveLength(20);
    for (const v of lists)
      expect(
        v.split(' ').every((n) => Number(n) >= 5 && Number(n) <= 9),
        v,
      ).toBe(true);
  });

  it('puts the digits of a decimal where its bounds are', () => {
    const large = values({ builtin: 'decimal', minInclusive: '999', fractionDigits: 2 }, 'facet:fractionDigits', 20);
    expect(large).toHaveLength(20);
    for (const v of large) expect(Number(v)).toBeGreaterThanOrEqual(999);
    const negative = values({ builtin: 'decimal', maxInclusive: '-1000', totalDigits: 5 }, 'facet:totalDigits', 20);
    expect(negative).toHaveLength(20);
    for (const v of negative) expect(Number(v)).toBeLessThanOrEqual(-1000);
  });

  it('decides only with a proof', () => {
    expect(constructed({ builtin: 'token', enumeration: ['a', 'bbb'], maxLength: 2 }, 'facet:maxLength')).toBe('bbb');
    expect(constructed({ builtin: 'string', length: 2, patterns: [['[a-z]{5}']] }, 'facet:length')).toMatch(
      /^[a-z]{5}$/,
    );
    expect(constructed({ builtin: 'int', fixed: '5', patterns: [['[0-9]']] }, 'facet:pattern')).toMatch(/^(\+5|05)$/);
    expect(refused({ builtin: 'string', variety: 'list', item: { builtin: 'string' } }, 'value:lexical')).toMatchObject(
      {
        decided: true,
      },
    );
    expect(
      refused(
        { builtin: 'anySimpleType', variety: 'union', members: [{ builtin: 'int' }, { builtin: 'string' }] },
        'value:lexical',
      ),
    ).toMatchObject({ decided: true });
    expect(
      refused(
        { builtin: 'decimal', minInclusive: '-9.99', maxInclusive: '9.99', fractionDigits: 2, totalDigits: 4 },
        'facet:totalDigits',
      ),
    ).toMatchObject({ decided: true });
    expect(
      generateViolatingValue({
        facets: { builtin: 'string', length: 3, patterns: [['[a-z]+']] },
        rule: 'facet:pattern',
        mustSatisfy: { builtin: 'string', length: 4 },
      }),
    ).toMatchObject({ status: 'not-constructible', decided: true });
  });

  it('reads INF and -INF as bounds of a float, without throwing', () => {
    const open: ValueFacets = { builtin: 'float', minInclusive: '0', maxInclusive: 'INF' };
    expect(Number(constructed(open, 'facet:minInclusive'))).toBeLessThan(0);
    expect(refused(open, 'facet:maxInclusive').decided).toBe(false);
    expect(constructed(open, 'value:lexical')).toBeDefined();
    expect(constructed({ builtin: 'double', maxExclusive: 'INF' }, 'facet:maxExclusive')).toBe('INF');
    expect(constructed({ builtin: 'double', minExclusive: '-INF', maxInclusive: '5' }, 'facet:maxInclusive')).not.toBe(
      'NaN',
    );
  });
});

/** The facets as an anonymous simple type, leaving out one facet or the fixed value. */
function simpleType(f: ValueFacets, skip?: string): string {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const parts: string[] = [];
  for (const value of skip === 'enumeration' ? [] : (f.enumeration ?? [])) {
    parts.push(`<xs:enumeration value="${esc(value)}"/>`);
  }
  for (const pattern of skip === 'pattern' ? [] : (f.patterns?.[0] ?? []))
    parts.push(`<xs:pattern value="${esc(pattern)}"/>`);
  for (const name of [
    'length',
    'minLength',
    'maxLength',
    'minInclusive',
    'minExclusive',
    'maxInclusive',
    'maxExclusive',
    'totalDigits',
    'fractionDigits',
    'whiteSpace',
  ] as const) {
    const value = f[name];
    if (value !== undefined && name !== skip) parts.push(`<xs:${name} value="${esc(String(value))}"/>`);
  }
  if (f.variety === 'list') {
    return `<xs:simpleType><xs:restriction><xs:simpleType><xs:list>${simpleType(f.item ?? { builtin: 'string' })}</xs:list></xs:simpleType>${parts.join('')}</xs:restriction></xs:simpleType>`;
  }
  if (f.variety === 'union') {
    const members = (f.members ?? []).map((m) => simpleType(m)).join('');
    return `<xs:simpleType><xs:restriction><xs:simpleType><xs:union>${members}</xs:union></xs:simpleType>${parts.join('')}</xs:restriction></xs:simpleType>`;
  }
  return `<xs:simpleType><xs:restriction base="xs:${f.builtin}">${parts.join('')}</xs:restriction></xs:simpleType>`;
}

describe('generateViolatingValue judged by the validator', () => {
  const schema = (f: ValueFacets, skip?: string) => {
    const fixed = f.fixed !== undefined && skip !== 'fixed' ? ` fixed="${f.fixed}"` : '';
    const xsd = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="v"${fixed}>${simpleType(f, skip)}</xs:element></xs:schema>`;
    return { entry: 's.xsd', files: new Map([['s.xsd', xsd]]) };
  };
  const doc = (value: string) => `<v>${value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\r/g, '&#13;')}</v>`;
  const judge = async (f: ValueFacets, values: string[], skip?: string) => {
    try {
      return (await validateXml(schema(f, skip), values.map(doc))).map((v) => v.valid);
    } catch {
      return undefined;
    }
  };

  it('breaks the facet it names and keeps the others', async () => {
    const rng = createRng(5);
    const wrong: string[] = [];
    let checked = 0;
    for (let n = 0; n < 240; n += 1) {
      const facets = randomFacets(rng);
      // Only types the validator compiles; an element compares a fixed value as text, so none here.
      const { fixed, ...plain } = facets;
      void fixed;
      if ((await judge(plain, [])) === undefined) continue;
      const made = RULES.filter(isValueRule)
        .filter((rule) => rule !== 'value:fixed')
        .map((rule) => ({ rule, result: generateViolatingValue({ facets: plain, rule, seed: n }) }))
        .flatMap(({ rule, result }) => (result.status === 'constructed' ? [{ rule, value: result.value }] : []));
      if (made.length === 0) continue;
      const full = await judge(
        plain,
        made.map((m) => m.value),
      );
      if (!full) continue;
      for (const [i, { rule, value }] of made.entries()) {
        checked += 1;
        if (full[i]) wrong.push(`accepted ${rule} ${JSON.stringify(value)} ${JSON.stringify(plain)}`);
        if (rule === 'value:lexical') continue;
        const without = await judge(plain, [value], rule.slice(rule.indexOf(':') + 1));
        if (without && !without[0])
          wrong.push(`second cause ${rule} ${JSON.stringify(value)} ${JSON.stringify(plain)}`);
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(wrong).toEqual([]);
  }, 60000);
});
