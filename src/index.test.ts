import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GenerateError,
  generateSample,
  type Sample,
  type ValueSource,
  validateXml,
  type XmlValidator,
} from './index.js';
import { generateSampleFile, generateSampleFiles } from './node.js';

const ORDER = fileURLToPath(new URL('../examples/retail/order.xsd', import.meta.url));

describe('generateSampleFile with the order example', () => {
  it.each(['none', 'all', 'random'] as const)('writes valid samples in mode %s', async (optional) => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const sample = await generateSampleFile(ORDER, { optional, seed, attempts: 1, choice: 'random', repeat: 2 });
      expect(sample.valid, `seed ${seed}:\n${sample.errors.join('\n')}\n${sample.xml}`).toBe(true);
    }
  });

  it('is reproducible from its seed', async () => {
    const a = await generateSampleFile(ORDER, { optional: 'random', seed: 42 });
    const b = await generateSampleFile(ORDER, { optional: 'random', seed: 42 });
    expect(a.xml).toBe(b.xml);
  });

  it('uses the prefixes of the schema documents', async () => {
    const sample = await generateSampleFile(ORDER, { optional: 'all' });
    expect(sample.xml).toContain('xmlns:c="urn:example:common"');
  });

  it('takes the preferred branch of a choice', async () => {
    const sample = await generateSampleFile(ORDER, { choice: { prefer: ['DeliveryDate'] } });
    expect(sample.xml).toContain('<DeliveryDate>');
    expect(sample.xml).not.toContain('<Pickup>');
  });
});

const XSD = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Count"><xs:simpleType><xs:restriction base="xs:int"><xs:maxInclusive value="9"/></xs:restriction></xs:simpleType></xs:element>
</xs:schema>`;

describe('generateSample', () => {
  it('tries the next seed when a sample is invalid', async () => {
    let calls = 0;
    // The first value breaks maxInclusive on purpose; later ones are fine.
    const flaky: ValueSource = { value: () => (++calls === 1 ? '12' : '3') };
    const sample = await generateSample({ files: { 'a.xsd': XSD }, entry: 'a.xsd' }, { values: flaky, seed: 5 });
    expect(sample).toMatchObject({ valid: true, attempts: 2, seed: 6 });
    expect(sample.xml).toContain('<Count>3</Count>');
  });

  it('returns the last invalid sample when every attempt fails', async () => {
    const broken: ValueSource = { value: () => '12' };
    const sample = await generateSample({ files: { 'a.xsd': XSD }, entry: 'a.xsd' }, { values: broken, attempts: 3 });
    expect(sample).toMatchObject({ valid: false, attempts: 3 });
    expect(sample.errors.join()).toContain('maxInclusive');
  });

  it('does not validate when asked not to', async () => {
    const sample = await generateSample({ files: { 'a.xsd': XSD }, entry: 'a.xsd' }, { validate: false });
    expect(sample.valid).toBeUndefined();
  });

  it('throws if there is no root element to start from', async () => {
    await expect(generateSample({ files: { 'a.xsd': XSD }, entry: 'a.xsd' }, { root: 'Other' })).rejects.toThrow(
      GenerateError,
    );
    await expect(generateSample({ files: {}, entry: 'missing.xsd' })).rejects.toThrow(GenerateError);
  });
});

// Real-world schemas: set XSD_CORPUS to a folder of XSD files to check every entry document in it.
const corpus = process.env['XSD_CORPUS'];

function entryDocuments(folder: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      out.push(...entryDocuments(path));
    } else if (name.endsWith('.xsd')) {
      out.push(path);
    }
  }
  return out;
}

describe.skipIf(corpus === undefined)('corpus in XSD_CORPUS', () => {
  const files = corpus ? entryDocuments(corpus) : [];
  it.each(files.map((f) => [relative(corpus ?? '', f), f]))('%s', async (_, file) => {
    for (const optional of ['none', 'all'] as const) {
      let sample;
      try {
        sample = await generateSampleFile(file, { optional, choice: 'random', attempts: 1 });
      } catch (e) {
        if (e instanceof GenerateError && e.problems.some((p) => p.code === 'root-required')) {
          return; // a document without exactly one global element is not an entry document
        }
        throw e;
      }
      expect(sample.status, `${optional}:\n${sample.errors.slice(0, 5).join('\n')}`).toBe('valid');
    }
  });
});

describe('generateSamples without coverage', () => {
  it('validates documents together and still gives the documents of one at a time', async () => {
    // Rejects some documents, so that some samples need further attempts and shift the seeds after them.
    const calls: number[] = [];
    const validator: XmlValidator = async (schema, documents) => {
      calls.push(documents.length);
      const verdicts = await validateXml(schema, documents);
      return verdicts.map((v, i) =>
        (documents[i]?.length ?? 0) % 3 === 0 ? { valid: false, errors: ['rejected'] } : v,
      );
    };
    const options = { optional: 'random' as const, choice: 'random' as const, attempts: 4, validator };
    const batch = await generateSampleFiles(ORDER, { ...options, count: 12, seed: 3 });
    expect(calls.some((n) => n > 1)).toBe(true);
    const single: Sample[] = [];
    let seed = 3;
    for (let i = 0; i < 12; i += 1) {
      const sample = await generateSampleFile(ORDER, { ...options, seed });
      single.push(sample);
      seed = sample.seed + 1;
    }
    expect(batch.samples.map((s) => [s.seed, s.attempts, s.status, s.xml])).toEqual(
      single.map((s) => [s.seed, s.attempts, s.status, s.xml]),
    );
    expect(batch.samples.some((s) => s.attempts > 1)).toBe(true);
  });
});
