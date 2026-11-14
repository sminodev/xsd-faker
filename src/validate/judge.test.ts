import { describe, expect, it } from 'vitest';
import { generateInvalidSamples, generateSample, generateSamples } from '../index.js';
import { type Verdict, type XmlValidator } from './xmllint.js';

const input = {
  entry: 'a.xsd',
  files: {
    'a.xsd':
      '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="Count" type="xs:int"/></xs:schema>',
  },
};
const ok: Verdict = { valid: true, errors: [] };
/** Malformed results, including adapters that fail only when given multiple documents. */
const BROKEN: Record<string, (n: number) => unknown> = {
  'too few verdicts': (n) => (n > 1 ? [] : [ok]),
  'too many verdicts': (n) => Array.from({ length: n + 1 }, () => ok),
  'a hole in the array': (n) => (n > 1 ? Object.assign(new Array<Verdict>(n), { 0: ok }) : [ok]),
  'a missing verdict': (n) => (n > 1 ? [ok, ...Array.from({ length: n - 1 }, () => undefined)] : [ok]),
  'valid as a string': (n) => Array.from({ length: n }, () => ({ valid: 'true', errors: [] })),
  'errors that are no strings': (n) => Array.from({ length: n }, () => ({ valid: false, errors: [42] })),
  'no array': () => ({ length: 1, 0: ok }),
  'errors with a hole': (n) => Array.from({ length: n }, () => ({ valid: true, errors: new Array<string>(1) })),
  'errors with a hole at the end': (n) =>
    Array.from({ length: n }, () => ({ valid: true, errors: Object.assign(new Array<string>(2), { 0: 'message' }) })),
  'errors with an inherited entry in a hole': (n) =>
    Array.from({ length: n }, () => ({
      valid: true,
      errors: Object.setPrototypeOf(
        new Array<string>(1),
        Object.create(Array.prototype, { 0: { value: 'inherited' } }) as object,
      ) as string[],
    })),
};
const validator = (answer: (n: number) => unknown): XmlValidator =>
  ((_schema, documents) => Promise.resolve(answer(documents.length))) as XmlValidator;

describe('the answer of a custom validator', () => {
  for (const [name, answer] of Object.entries(BROKEN)) {
    it(`is refused with a TypeError: ${name}`, async () => {
      const refused = (e: unknown) => e instanceof TypeError && /exactly one explicit verdict/.test(e.message);
      await expect(generateSamples(input, { count: 3, validator: validator(answer) })).rejects.toSatisfy(refused);
      await expect(generateInvalidSamples(input, { validator: validator(answer) })).rejects.toSatisfy(refused);
      if (answer(1) !== undefined && JSON.stringify(answer(1)) !== JSON.stringify([ok])) {
        await expect(generateSample(input, { validator: validator(answer) })).rejects.toSatisfy(refused);
      }
    });
  }

  it('stops at the first broken answer, without asking the validator again', async () => {
    for (const run of [
      (v: XmlValidator) => generateSample(input, { validator: v }),
      (v: XmlValidator) => generateSamples(input, { count: 3, validator: v }),
      (v: XmlValidator) => generateInvalidSamples(input, { validator: v }),
    ]) {
      let calls = 0;
      const holes: XmlValidator = (_schema, documents) => {
        calls += 1;
        return Promise.resolve(documents.map(() => ({ valid: true, errors: new Array<string>(1) })));
      };
      await expect(run(holes)).rejects.toThrow(TypeError);
      expect(calls).toBe(1);
    }
  });

  it('takes empty and dense errors', async () => {
    for (const errors of [[], ['message']]) {
      const answer = validator((n) => Array.from({ length: n }, () => ({ valid: true, errors })));
      expect((await generateSample(input, { validator: answer })).status).toBe('valid');
      expect((await generateSamples(input, { count: 2, validator: answer })).samples.map((s) => s.status)).toEqual([
        'valid',
        'valid',
      ]);
    }
  });

  it('fails the batch when the callback throws, never passing on to single checks', async () => {
    let calls = 0;
    const throwing: XmlValidator = (_schema, documents) => {
      calls += 1;
      return documents.length > 1 ? Promise.reject(new Error('adapter down')) : Promise.resolve([ok]);
    };
    await expect(generateSamples(input, { count: 3, validator: throwing })).rejects.toThrow('adapter down');
    expect(calls).toBe(1);
  });

  it('is taken as it is when it is well formed, in a batch as for one document', async () => {
    const batch = await generateSamples(input, {
      count: 3,
      validator: validator((n) => Array.from({ length: n }, () => ok)),
    });
    expect(batch.samples.map((s) => s.status)).toEqual(['valid', 'valid', 'valid']);
    expect((await generateSample(input, { validator: validator(() => [ok]) })).status).toBe('valid');
  });
});

describe('the options of the JavaScript API', () => {
  it('take only true or false for boolean options, and false or an object for json', async () => {
    for (const options of [
      { validate: 'false' },
      { validate: 0 },
      { fillElements: 'yes' },
      { fillAttributes: null },
      { json: 42 },
      { json: true },
      { json: 'tree' },
      { json: [] },
      { json: null },
    ]) {
      await expect(generateSample(input, options as never), JSON.stringify(options)).rejects.toThrow(TypeError);
    }
    await expect(generateSamples(input, { count: 2, coverage: 'yes' } as never)).rejects.toThrow(/coverage/);
    for (const options of [{ json: 42 }, { json: 'tree' }, { validate: 'false' }, { coverage: 1 }]) {
      await expect(generateInvalidSamples(input, options as never), JSON.stringify(options)).rejects.toThrow(TypeError);
    }
    for (const options of [{ json: false }, { json: {} }, { json: { mode: 'tree' } }] as const) {
      expect((await generateInvalidSamples(input, options)).bases, JSON.stringify(options)).toBe(1);
    }
    for (const options of [{ validate: false }, { json: false }, { json: {} }, { json: { mode: 'tree' } }] as const) {
      expect((await generateSample(input, options)).xml, JSON.stringify(options)).toContain('<Count>');
    }
    expect((await generateSample(input, { json: false })).jsonStatus).toBe('not-requested');
  });
});
