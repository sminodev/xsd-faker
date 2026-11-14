import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateSample } from '../index.js';
import { generateSampleFile } from '../node.js';
import { Problems } from './problems.js';
import { SchemaSet } from './schema-set.js';

const xs = (body: string) => `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">${body}</xs:schema>`;
const leaf = xs('<xs:element name="leaf" type="xs:string"/>');
const root = (location: string) =>
  xs(
    `<xs:include schemaLocation="${location}"/><xs:element name="r"><xs:complexType><xs:sequence><xs:element ref="leaf"/></xs:sequence></xs:complexType></xs:element>`,
  );
const SETS: Record<string, Record<string, string>> = {
  'a .. segment through a directory with no file of the set': { 'e.xsd': root('sub/../leaf.xsd'), 'leaf.xsd': leaf },
  'a . segment': { 'e.xsd': root('./leaf.xsd'), 'leaf.xsd': leaf },
  'a .. segment out of a directory of the set': {
    'e.xsd': root('sub/a.xsd'),
    'sub/a.xsd': xs('<xs:include schemaLocation="../sub2/../leaf.xsd"/>'),
    'leaf.xsd': leaf,
  },
  'a double slash': { 'e.xsd': root('a//leaf.xsd'), 'a/leaf.xsd': leaf },
  'a backslash': { 'e.xsd': root('sub\\..\\leaf.xsd'), 'leaf.xsd': leaf },
};

describe('locations with dot segments inside the schema set', () => {
  for (const [name, files] of Object.entries(SETS)) {
    it(`load and validate: ${name}`, async () => {
      expect((await generateSample({ entry: 'e.xsd', files }, { seed: 1 })).status).toBe('valid');
      const dir = mkdtempSync(join(tmpdir(), 'xsd-locations-'));
      try {
        for (const [file, text] of Object.entries(files)) {
          mkdirSync(dirname(join(dir, file)), { recursive: true });
          writeFileSync(join(dir, file), text);
        }
        expect((await generateSampleFile(join(dir, 'e.xsd'), { seed: 1 })).status).toBe('valid');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it('write the plain form whatever the prefix and however the value is written', async () => {
    const X = 'http://www.w3.org/2001/XMLSchema';
    const child = `<xs:schema xmlns:xs="${X}"><xs:element name="child" type="xs:string"/></xs:schema>`;
    const cases: [string, string, string, string][] = [
      ['a character reference', 'xs', 'sub/../leaf&#46;xsd', 'leaf.xsd'],
      ['an entity reference in the file name', 'xs', 'sub/../a&amp;b.xsd', 'a&b.xsd'],
      ['a prefix outside ASCII', '\u00e4', 'sub/../leaf.xsd', 'leaf.xsd'],
      ['single quotes and a quote in the file name', 'xs', 'sub/../it&apos;s.xsd', "it's.xsd"],
    ];
    for (const [name, p, location, file] of cases) {
      const quote = name.startsWith('single') ? "'" : '"';
      const entry = `<${p}:schema xmlns:${p}="${X}">
  <${p}:include schemaLocation=${quote}${location}${quote}/>
  <${p}:element name="r"><${p}:complexType><${p}:sequence><${p}:element ref="child"/></${p}:sequence></${p}:complexType></${p}:element>
</${p}:schema>`;
      const sample = await generateSample({ entry: 'e.xsd', files: { 'e.xsd': entry, [file]: child } }, { seed: 1 });
      expect(sample.status, name).toBe('valid');
    }
  });

  it('change only the locations of xs:import, xs:include and xs:redefine, each in its own place', async () => {
    const X = 'http://www.w3.org/2001/XMLSchema';
    const entry = `<xs:schema xmlns:xs="${X}" xmlns:o="urn:o">
  <!-- <xs:include schemaLocation="sub/../leaf.xsd"/> -->
  <xs:import namespace="urn:o" schemaLocation="sub/../other.xsd"/>
  <xs:include schemaLocation="sub/../leaf.xsd"/>
  <xs:element name="r"><xs:annotation><xs:appinfo><x schemaLocation="sub/../leaf.xsd"/></xs:appinfo></xs:annotation>
    <xs:complexType><xs:sequence><xs:element ref="leaf"/><xs:element ref="o:other"/></xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;
    const other = `<xs:schema xmlns:xs="${X}" targetNamespace="urn:o"><xs:element name="other" type="xs:string"/></xs:schema>`;
    const files = { 'e.xsd': entry, 'leaf.xsd': leaf, 'other.xsd': other };
    const sample = await generateSample({ entry: 'e.xsd', files }, { seed: 1, validate: false });
    expect(sample.status).toBe('unvalidated');
    expect((await generateSample({ entry: 'e.xsd', files }, { seed: 1 })).status).toBe('valid');
    // The text libxml2 reads: the two locations plain, the comment and the appinfo as they were, no line moved.
    const set = new SchemaSet(files, new Problems());
    set.load('e.xsd');
    const text = set.sourceTexts.get('e.xsd') ?? '';
    expect(text.split('\n').length).toBe(entry.split('\n').length);
    expect(text).toContain('<!-- <xs:include schemaLocation="sub/../leaf.xsd"/> -->');
    expect(text).toContain('<xs:import namespace="urn:o" schemaLocation="other.xsd"/>');
    expect(text).toContain('<xs:include schemaLocation="leaf.xsd"/>');
    expect(text).toContain('<x schemaLocation="sub/../leaf.xsd"/>');
  });

  it('report a location the loader does not find as missing-file', async () => {
    const error = await generateSample(
      { entry: 'e.xsd', files: { 'e.xsd': root('sub/../none.xsd') } },
      { seed: 1 },
    ).catch((e: unknown) => e);
    expect((error as { problems?: { code: string }[] }).problems?.map((p) => p.code)).toContain('missing-file');
  });
});
