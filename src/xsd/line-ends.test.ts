import { describe, expect, it } from 'vitest';
import { generateSample } from '../index.js';
import { validateXml } from '../validate/xmllint.js';

const XS = 'http://www.w3.org/2001/XMLSchema';
const CHARACTERS = [
  ['U+0085', '\u0085', '&#x85;'],
  ['U+2028', ' ', '&#x2028;'],
  ['U+2029', ' ', '&#x2029;'],
] as const;
const FACETS = {
  enumeration: (v: string) =>
    `<xs:element name="r"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="${v}"/></xs:restriction></xs:simpleType></xs:element>`,
  fixed: (v: string) => `<xs:element name="r" type="xs:string" fixed="${v}"/>`,
  pattern: (v: string) =>
    `<xs:element name="r"><xs:simpleType><xs:restriction base="xs:string"><xs:pattern value="${v}"/></xs:restriction></xs:simpleType></xs:element>`,
};

describe('line ends of XML 1.0 in schema text', () => {
  for (const [name, raw, reference] of CHARACTERS) {
    for (const [facet, declare] of Object.entries(FACETS)) {
      it(`keep ${name} in ${facet}, written raw or as a character reference`, async () => {
        for (const written of [raw, reference]) {
          const xsd = `<?xml version="1.0" encoding="UTF-8"?>\n<xs:schema xmlns:xs="${XS}">${declare(`a${written}b`)}</xs:schema>`;
          const input = { entry: 's.xsd', files: { 's.xsd': xsd } };
          const sample = await generateSample(input, { seed: 1 });
          expect(sample.status, `${facet} ${JSON.stringify(written)}`).toBe('valid');
          expect(sample.json).toBe(`a${raw}b`);
          // The judge: libxml2 takes the character itself and refuses a space in its place.
          const schemas = { entry: 's.xsd', files: new Map([['s.xsd', xsd]]) };
          const [same, space] = await validateXml(schemas, [`<r>a${raw}b</r>`, '<r>a b</r>']);
          expect([same?.valid, space?.valid]).toEqual([true, false]);
        }
      });
    }
  }

  it('still end lines at CR LF and CR', async () => {
    const xsd = `<xs:schema xmlns:xs="${XS}">\r\n<xs:element name="r" type="xs:string" fixed="a&#xD;b"/>\r</xs:schema>`;
    const sample = await generateSample({ entry: 's.xsd', files: { 's.xsd': xsd } }, { seed: 1 });
    expect(sample.status).toBe('valid');
  });
});
