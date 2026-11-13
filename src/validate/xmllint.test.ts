import { describe, expect, it } from 'vitest';
import { SchemaCompileError, splitOutput, validateXml } from './xmllint.js';

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

  it('gives a batch the verdicts and messages of single runs', async () => {
    const documents = [
      '<R xmlns="urn:t"><n>7</n></R>',
      '<R xmlns="urn:t">\n<n>12</n></R>',
      '<R xmlns="urn:t"><n>7</n>',
      '<R xmlns="urn:t"><m/></R>',
      '<R xmlns="urn:t"><n>1</n></R>',
    ];
    const batch = await validateXml(schema, documents);
    const single = await Promise.all(documents.map(async (d) => (await validateXml(schema, [d]))[0]));
    expect(batch).toEqual(single);
    expect(batch.map((v) => v.valid)).toEqual([true, false, false, false, true]);
    expect(batch[1]).toEqual({ valid: false, errors: [expect.stringContaining('maxInclusive')], lines: [2] });
    expect(batch[2]?.errors[0]).toMatch(/^parser error/);
  });

  it('repeats schema warnings for each rejected document, as a single run does', async () => {
    const warned = {
      entry: 'w.xsd',
      files: new Map([
        [
          'w.xsd',
          `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
            <xs:import namespace="urn:other" schemaLocation="missing.xsd"/>
            <xs:element name="R" type="xs:int"/></xs:schema>`,
        ],
      ]),
    };
    const documents = ['<R>1</R>', '<R>x</R>', '<R>y</R>'];
    const batch = await validateXml(warned, documents);
    expect(batch).toEqual(await Promise.all(documents.map(async (d) => (await validateXml(warned, [d]))[0])));
    expect(batch[0]).toEqual({ valid: true, errors: [] });
    expect(batch[2]?.errors.some((e) => e.includes('Skipping the import'))).toBe(true);
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

describe('splitOutput', () => {
  it('splits the output into one block per document, the schema lines first', () => {
    const output = [
      'w.xsd:3: element import: Schemas parser warning : skipped',
      'sample-4.xml validates',
      'sample-5.xml:1: parser error : Premature end of data',
      '<R>',
      '   ^',
      'sample-6.xml:2: Schemas validity error : bad',
      'sample-6.xml fails to validate',
      '',
    ].join('\n');
    const split = splitOutput(output, [4, 5, 6]);
    expect(split?.preamble).toEqual(['w.xsd:3: element import: Schemas parser warning : skipped']);
    expect(split?.documents.get(5)).toEqual(['sample-5.xml:1: parser error : Premature end of data', '<R>', '   ^']);
    expect(split?.documents.get(6)).toHaveLength(2);
  });

  it('gives up on output it cannot attribute', () => {
    // out of order
    expect(splitOutput('sample-1.xml validates\nsample-0.xml validates\n', [0, 1])).toBeUndefined();
    // a document without output
    expect(splitOutput('sample-0.xml validates\n', [0, 1])).toBeUndefined();
    // a line after a verdict that names no document
    expect(splitOutput('sample-0.xml validates\nstray\nsample-1.xml validates\n', [0, 1])).toBeUndefined();
    // a block without a verdict that is not a parser message
    expect(splitOutput('sample-0.xml:1: Schemas validity error : x\nsample-1.xml validates\n', [0, 1])).toBeUndefined();
  });
});
