import { describe, expect, it } from 'vitest';
import { generateSample, generateSamples } from '../index.js';

const schema = (body: string) => ({
  files: {
    'm.xsd': `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns="urn:m" targetNamespace="urn:m"
      elementFormDefault="qualified">${body}</xs:schema>`,
  },
  entry: 'm.xsd',
});

const message = schema(`
  <xs:element name="Message"><xs:complexType><xs:choice>
    <xs:element name="Request"><xs:complexType><xs:choice>
      <xs:element name="Street" type="xs:string"/>
      <xs:element name="POBox" type="xs:string"/>
    </xs:choice></xs:complexType></xs:element>
    <xs:element name="Response" type="xs:string"/>
  </xs:choice></xs:complexType></xs:element>`);

describe('reach', () => {
  it('fixes the branches along a path and leaves the other decisions to coverage', async () => {
    const batch = await generateSamples(message, {
      count: 4,
      coverage: true,
      reach: ['/{urn:m}Message/{urn:m}Request'],
    });
    const bodies = batch.samples.map((s) => s.xml.match(/<(Street|POBox|Response)>/)?.[1]);
    expect(bodies).not.toContain('Response');
    expect(new Set(bodies)).toEqual(new Set(['Street', 'POBox']));
    expect(batch.coverage).toMatchObject({ total: 2, covered: 2, complete: true, uncovered: [] });
    expect(batch.samples[0]?.choices[0]).toMatchObject({ branch: 0, fixed: true });
  });

  it('takes optional ancestors, enough occurrences and an optional attribute', async () => {
    const input = schema(`
      <xs:element name="r"><xs:complexType><xs:sequence>
        <xs:element name="a" minOccurs="0"><xs:complexType><xs:sequence minOccurs="0">
          <xs:element name="item" minOccurs="0" maxOccurs="unbounded"><xs:complexType>
            <xs:attribute name="code" type="xs:string"/>
          </xs:complexType></xs:element>
        </xs:sequence></xs:complexType></xs:element>
        <xs:element name="b" type="xs:string" minOccurs="0"/>
      </xs:sequence></xs:complexType></xs:element>`);
    const sample = await generateSample(input, { reach: ['/{urn:m}r/{urn:m}a/{urn:m}item[3]/@code'] });
    expect(sample.status).toBe('valid');
    expect(sample.xml.match(/<item/g)).toHaveLength(3);
    expect(sample.xml.match(/code="/g)).toHaveLength(1);
    expect(sample.xml).not.toContain('<b>');
    expect(sample.problems).toEqual([]);
  });

  it('matches a step without braces in any namespace', async () => {
    const sample = await generateSample(message, { reach: ['/Message/Response'] });
    expect(sample.xml).toContain('<Response>');
  });

  it('takes the member of a substitution group and the xsi:type a path leads to', async () => {
    const input = schema(`
      <xs:element name="Party" type="PartyType" abstract="true"/>
      <xs:element name="Person" type="PartyType" substitutionGroup="Party"/>
      <xs:element name="Company" type="PartyType" substitutionGroup="Party"/>
      <xs:complexType name="PartyType"><xs:sequence><xs:element name="name" type="xs:string"/></xs:sequence></xs:complexType>
      <xs:complexType name="Vehicle"><xs:sequence><xs:element name="id" type="xs:string"/></xs:sequence></xs:complexType>
      <xs:complexType name="Truck"><xs:complexContent><xs:extension base="Vehicle"><xs:sequence>
        <xs:element name="load" type="xs:int"/>
      </xs:sequence></xs:extension></xs:complexContent></xs:complexType>
      <xs:element name="r"><xs:complexType><xs:sequence>
        <xs:element ref="Party"/>
        <xs:element name="v" type="Vehicle"/>
      </xs:sequence></xs:complexType></xs:element>`);
    const sample = await generateSample(input, {
      root: 'r',
      reach: ['/{urn:m}r/{urn:m}Company', '/{urn:m}r/{urn:m}v/{urn:m}load'],
    });
    expect(sample.status).toBe('valid');
    expect(sample.xml).toContain('<Company>');
    expect(sample.xml).toMatch(/xsi:type="(\w+:)?Truck"/);
    expect(sample.choices.every((c) => c.fixed)).toBe(true);
  });

  it('warns about a path the schema does not allow', async () => {
    const sample = await generateSample(message, { reach: ['/{urn:m}Message/{urn:m}Unknown'] });
    expect(sample.problems).toEqual([
      {
        code: 'unreachable-path',
        severity: 'warning',
        message: 'the document does not reach /{urn:m}Message/{urn:m}Unknown',
      },
    ]);
    await expect(generateSample(message, { reach: ['Message'] })).rejects.toThrow(TypeError);
  });
});
