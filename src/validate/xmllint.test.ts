import { describe, expect, it } from 'vitest';
import { SchemaCompileError, validateXml } from './xmllint.js';

const XSD = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:t" xmlns="urn:t" elementFormDefault="qualified">
  <xs:include schemaLocation="types/count.xsd"/>
  <xs:element name="R"><xs:complexType><xs:sequence><xs:element name="n" type="Count"/></xs:sequence></xs:complexType></xs:element>
</xs:schema>`;
const TYPES = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:t">
  <xs:simpleType name="Count"><xs:restriction base="xs:int"><xs:maxInclusive value="9"/></xs:restriction></xs:simpleType>
</xs:schema>`;
const schema = {
  entry: 'a.xsd',
  files: new Map([
    ['a.xsd', XSD],
    ['types/count.xsd', TYPES],
  ]),
};

describe('validateXml', () => {
  it('judges each document on its own, with included files in subfolders', async () => {
    const verdicts = await validateXml(schema, ['<R xmlns="urn:t"><n>7</n></R>', '<R xmlns="urn:t"><n>12</n></R>']);
    expect(verdicts[0]).toEqual({ valid: true, errors: [] });
    expect(verdicts[1]?.valid).toBe(false);
    expect(verdicts[1]?.errors.join()).toContain('maxInclusive');
  });

  it('returns nothing for no documents', async () => {
    expect(await validateXml(schema, [])).toEqual([]);
  });

  it('has room for a large document', async () => {
    const list = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="R"><xs:complexType><xs:sequence>
        <xs:element name="n" type="xs:string" maxOccurs="unbounded"/>
      </xs:sequence></xs:complexType></xs:element></xs:schema>`;
    const document = `<R>${'<n>v</n>'.repeat(1_200_000)}</R>`;
    const verdicts = await validateXml({ entry: 'l.xsd', files: new Map([['l.xsd', list]]) }, [document]);
    expect(verdicts).toEqual([{ valid: true, errors: [] }]);
  }, 60_000);

  it('throws if the schema does not compile', async () => {
    const broken = { entry: 'a.xsd', files: new Map([['a.xsd', XSD.replace('type="Count"', 'type="Missing"')]]) };
    await expect(validateXml(broken, ['<R xmlns="urn:t"/>'])).rejects.toThrow(SchemaCompileError);
  });
});
