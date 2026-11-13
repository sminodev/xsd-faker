import { describe, expect, it } from 'vitest';
import { createRng } from '../../rng.js';
import { identifier, ikCheckDigit, kvnrCheckDigit, lanrCheckDigit, pznCheckDigit } from './identifiers.js';

describe('check digits', () => {
  it('of the KVNR, by the numbers of its guideline and the KBV field catalogue', () => {
    expect(kvnrCheckDigit('A00050001')).toBe(5);
    expect(kvnrCheckDigit('C00050002')).toBe(1);
    expect(kvnrCheckDigit('T55555887')).toBe(9);
  });

  it('of the IK, by the example of its circular', () => {
    expect(ikCheckDigit('26032682')).toBe(2);
  });

  it('of the LANR, by the number the KBV uses for physicians without one', () => {
    expect(lanrCheckDigit('999999')).toBe(9);
    expect(lanrCheckDigit('123456')).toBe(6);
  });

  it('of the PZN, by the IFA examples, and none where the remainder is 10', () => {
    expect(pznCheckDigit('2758089')).toBe(9);
    expect(pznCheckDigit('0375286')).toBe(4);
    expect(pznCheckDigit('0000003')).toBeUndefined();
  });
});

describe('identifier', () => {
  const valid = {
    kvnr: (v: string) => /^[A-Z][0-9]{9}$/.test(v) && kvnrCheckDigit(v) === Number(v[9]),
    ik: (v: string) => /^[0-9]{9}$/.test(v) && ikCheckDigit(v) === Number(v[8]),
    lanr: (v: string) => /^[0-9]{9}$/.test(v) && lanrCheckDigit(v) === Number(v[6]),
    pzn: (v: string) => /^[0-9]{8}$/.test(v) && pznCheckDigit(v) === Number(v[7]),
  };

  it('gives the usual form with a valid check digit', () => {
    for (const kind of ['kvnr', 'ik', 'lanr', 'pzn'] as const) {
      for (let seed = 1; seed <= 200; seed += 1) {
        const value = identifier(kind, createRng(seed), () => undefined);
        expect(value !== undefined && valid[kind](value), `${kind} ${value}`).toBe(true);
      }
    }
  });

  it('takes a KVNR from the numbers the allocation rule excludes, never with the prefix of test cards', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const value = identifier('kvnr', createRng(seed), () => undefined) ?? '';
      expect(value.slice(1, 9), value).toMatch(/(\d)\1\1\1|666/);
      expect(value).not.toMatch(/^X0000/);
    }
  });

  it('stays in the test range where a pattern narrows the digits of a KVNR', () => {
    const narrow = /^[A-Z][1-5]{8}[0-9]$/;
    for (let seed = 1; seed <= 2000; seed += 1) {
      const rng = createRng(seed);
      const draft = () =>
        String.fromCharCode(65 + rng.int(0, 25)) + Array.from({ length: 9 }, () => rng.int(1, 5)).join('');
      const value = identifier('kvnr', rng, draft, (v) => narrow.test(v)) ?? '';
      expect(value.slice(1, 9), value).toMatch(/(\d)\1\1\1|666/);
      expect(narrow.test(value), value).toBe(true);
    }
  });

  it('keeps the letter and the other digits of a KVNR draft from the schema', () => {
    const value = identifier('kvnr', createRng(5), () => 'Q123456789') ?? '';
    expect(value[0]).toBe('Q');
    expect(value.slice(1, 9)).toMatch(/(\d)\1\1\1|666/);
    expect(valid.kvnr(value)).toBe(true);
  });

  it('takes an IK from the classification 97 to 99', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      expect(identifier('ik', createRng(seed), () => undefined)).toMatch(/^9[7-9][0-9]{7}$/);
    }
  });

  it('takes the test IK 109500969 where the schema demands the prefix 10', () => {
    const prefix10 = (value: string) => value.startsWith('10');
    expect(identifier('ik', createRng(1), () => '101234567', prefix10)).toBe('109500969');
    expect(valid.ik('109500969')).toBe(true);
  });

  it('falls back to the issued range where no test value fits, keeping the prefix the schema gives', () => {
    const prefix26 = (value: string) => value.startsWith('26');
    const ik = identifier('ik', createRng(1), () => '260000000', prefix26) ?? '';
    expect(ik).toMatch(/^26/);
    expect(valid.ik(ik)).toBe(true);
    const twelve = (value: string) => /^[0-9]{12}$/.test(value);
    expect(identifier('kvnr', createRng(1), () => undefined, twelve)).toMatch(/^[A-Z][0-9]{9}$/);
  });

  it("keeps what the schema's pattern gives, such as a specialty code, and replaces only the check digit", () => {
    expect(identifier('lanr', createRng(3), () => '123456042')).toBe('123456642');
    const usual = identifier('lanr', createRng(3), () => '12345601');
    expect(usual).toMatch(/^[0-9]{7}00$/);
  });
});
