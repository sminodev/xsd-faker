import { describe, expect, it } from 'vitest';
import { generateSample } from '../index.js';

const XS = 'http://www.w3.org/2001/XMLSchema';
const sample = (facets: string, seed = 1) =>
  generateSample(
    {
      entry: 's.xsd',
      files: {
        's.xsd': `<xs:schema xmlns:xs="${XS}"><xs:element name="v"><xs:simpleType><xs:restriction base="xs:float">${facets}</xs:restriction></xs:simpleType></xs:element></xs:schema>`,
      },
    },
    { seed },
  );
const typed = (attributes: string) =>
  generateSample(
    {
      entry: 's.xsd',
      files: { 's.xsd': `<xs:schema xmlns:xs="${XS}"><xs:element name="v" type="xs:float"${attributes}/></xs:schema>` },
    },
    { seed: 1 },
  );
const text = (xml: string) => /<v>([^<]*)<\/v>/.exec(xml)?.[1] ?? '';

describe('xs:float literals past the largest finite float', () => {
  it('keep generated values finite and valid below a bound that is INF', async () => {
    for (const facets of [
      '<xs:maxExclusive value="1e39"/>',
      '<xs:maxInclusive value="3.4028236e38"/>',
      '<xs:minExclusive value="-1e39"/><xs:maxExclusive value="1e39"/>',
    ]) {
      for (let seed = 1; seed <= 5; seed += 1) {
        const s = await sample(facets, seed);
        expect(s.status, facets).toBe('valid');
        expect(Number.isFinite(Math.fround(Number(text(s.xml)))), text(s.xml)).toBe(true);
        expect(s.jsonStatus).toBe('generated');
      }
    }
  });

  it('give INF or -INF where a bound leaves nothing else', async () => {
    const above = await sample('<xs:minInclusive value="1e39"/>');
    expect([above.status, text(above.xml), above.json]).toEqual(['valid', 'INF', 'INF']);
    const below = await sample('<xs:maxInclusive value="-1e39"/>');
    expect([below.status, text(below.xml), below.json]).toEqual(['valid', '-INF', '-INF']);
  });

  it('map fixed, default and enumerated literals that are INF to the string INF', async () => {
    for (const [attributes, json] of [
      [' fixed="1e39"', 'INF'],
      [' fixed="-1e39"', '-INF'],
      [' fixed="3.4028236e38"', 'INF'],
      [' default="1e39"', 'INF'],
    ] as const) {
      const s = await typed(attributes);
      expect([s.status, s.jsonStatus, s.json], attributes).toEqual(['valid', 'generated', json]);
    }
    const listed = await sample('<xs:enumeration value="1e39"/>');
    expect([listed.status, listed.json]).toEqual(['valid', 'INF']);
  });

  it('keep a literal that underflows to 0 valid', async () => {
    const s = await typed(' fixed="1e-50"');
    expect(s.status).toBe('valid');
    expect(Math.fround(s.json as number)).toBe(0);
  });
});
