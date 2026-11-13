// One minimal schema per rule in test/rules: every invalid sample of that rule has to be confirmed by the validator
// this package installs. A new version of the validator that words a message differently fails here first.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { generateInvalidSamples } from '../index.js';
import { RULES, type Rule } from './rules.js';

const folder = join(import.meta.dirname, '..', '..', 'test', 'rules');
const schemas = readdirSync(folder).filter((f) => f.endsWith('.xsd'));
const ruleOf = (file: string) => file.replace(/\.xsd$/, '').replace('-', ':') as Rule;
/** Elements of a schema that must get a sample of its rule, by local name. */
const REQUIRED: Partial<Record<Rule, string[]>> = {
  'facet:minInclusive': ['due'],
  'facet:minExclusive': ['due'],
  'facet:maxInclusive': ['due'],
  'facet:maxExclusive': ['due'],
  'facet:maxLength': ['dates'],
  'value:fixed': ['express', 'priority', 'checksum'],
  'value:lexical': ['reference'],
  'identity:duplicate-id': ['code'],
  'structure:too-many': ['stop'],
};

describe('gold corpus', () => {
  it('has one schema per rule', () => {
    expect(schemas.map(ruleOf).sort()).toEqual([...RULES].sort());
  });

  it('runs against the validator version it was confirmed with', () => {
    const require = createRequire(import.meta.url);
    const { version } = require('xmllint-wasm/package.json') as { version: string };
    expect(version).toBe('5.3.0');
  });

  for (const file of schemas) {
    const rule = ruleOf(file);
    it(`confirms every sample of ${rule}`, async () => {
      const input = { files: { [file]: readFileSync(join(folder, file), 'utf8') }, entry: file };
      // With all optional elements and with none, which leaves more expected elements open in the messages.
      const samples = [];
      for (const optionalElements of ['all', 'none'] as const) {
        const matrix = await generateInvalidSamples(input, {
          root: 'order',
          rules: [rule],
          perRuleAndPath: 10,
          count: 2,
          optionalElements,
        });
        samples.push(...matrix.samples);
      }
      expect(samples.length).toBeGreaterThan(0);
      for (const local of REQUIRED[rule] ?? []) {
        expect(
          samples.some((s) => new RegExp(`[}/@]${local}(\\[\\d+\\])?$`).test(s.path)),
          local,
        ).toBe(true);
      }
      const unconfirmed = samples
        .filter((s) => s.status !== 'confirmed')
        .map((s) => `${s.status} ${s.path} ${s.value ?? ''}: ${s.diagnostics.map((d) => d.message).join(' | ')}`);
      expect(unconfirmed).toEqual([]);
    });
  }

  it('reports a fixed value on an attribute reference, which libxml2 does not check, as not checkable', async () => {
    const files = {
      'a.xsd': `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:a" xmlns="urn:a">
        <xs:attribute name="kind" type="xs:string"/>
      </xs:schema>`,
      'order.xsd': `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:a="urn:a">
        <xs:import namespace="urn:a" schemaLocation="a.xsd"/>
        <xs:element name="order"><xs:complexType><xs:attribute ref="a:kind" fixed="simple"/></xs:complexType></xs:element>
      </xs:schema>`,
    };
    const matrix = await generateInvalidSamples({ files, entry: 'order.xsd' }, { rules: ['value:fixed'] });
    expect(matrix.samples.map((s) => [s.status, s.reason])).toEqual([
      ['not-checkable', 'libxml2 does not check a fixed value on an attribute that refers to a global attribute'],
    ]);
  });

  it('leaves out changes that would leave a reference without its ID, and copies of key fields', async () => {
    const files = {
      'parts.xsd': `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="order">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="part" minOccurs="2" maxOccurs="2">
                <xs:complexType><xs:attribute name="id" type="PartId" use="required"/></xs:complexType>
              </xs:element>
              <xs:element name="use"><xs:complexType><xs:attribute name="ref" type="xs:IDREF" use="required"/></xs:complexType></xs:element>
              <xs:element name="item" maxOccurs="3">
                <xs:complexType><xs:sequence><xs:element name="no" type="xs:int"/></xs:sequence></xs:complexType>
              </xs:element>
              <xs:element name="pick" type="xs:int"/>
            </xs:sequence>
          </xs:complexType>
          <xs:unique name="itemNo"><xs:selector xpath="item"/><xs:field xpath="no"/></xs:unique>
        </xs:element>
        <xs:simpleType name="PartId"><xs:restriction base="xs:ID"><xs:maxLength value="12"/></xs:restriction></xs:simpleType>
      </xs:schema>`,
    };
    for (let seed = 1; seed <= 4; seed += 1) {
      const matrix = await generateInvalidSamples({ files, entry: 'parts.xsd' }, { seed, perRuleAndPath: 10 });
      expect(matrix.bases).toBeGreaterThan(0);
      // The part whose ID the reference names keeps its ID: no change to it, its attribute or its element.
      const xml = matrix.samples[0]?.xml ?? '';
      const named = /ref="([^"]+)"/.exec(xml)?.[1];
      const position = [...xml.matchAll(/<part id="([^"]+)"/g)].findIndex((m) => m[1] === named) + 1;
      expect(position).toBeGreaterThan(0);
      const part = `/{}order/{}part${position > 1 ? `[${position}]` : ''}`;
      const removesOrChangesTheId = (rule: string) =>
        rule.startsWith('facet:') ||
        rule.startsWith('value:') ||
        ['structure:missing-attribute', 'structure:missing-element', 'identity:duplicate-id'].includes(rule);
      const touched = matrix.samples.filter(
        (s) => (s.path === part || s.path === `${part}/@{}id`) && removesOrChangesTheId(s.rule),
      );
      expect(touched.map((s) => s.rule)).toEqual([]);
      expect(
        matrix.notConstructible.filter((n) => n.reason.startsWith('the change would also break an ID')).length,
      ).toBeGreaterThan(0);
      // Copies of an item would repeat the value of a unique field.
      expect(matrix.samples.some((s) => s.rule === 'structure:too-many' && /item|no/.test(s.path))).toBe(false);
      expect(matrix.samples.filter((s) => s.status !== 'confirmed').map((s) => `${s.rule} ${s.path}`)).toEqual([]);
    }
  });
});
