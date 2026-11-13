import { defineLocale, de } from 'xsd-faker-locales';
import { describe, expect, it } from 'vitest';
import { generateSample } from '../../index.js';
import type { FieldKey } from './fields.js';
import { resolveLocale } from './index.js';

const NAMES = ['constructor', '__proto__', 'toString'] as const;
const XS = 'http://www.w3.org/2001/XMLSchema';

/** A schema whose root, child elements, attributes and types carry one of the names of Object.prototype. */
const schema = (root: string) => `<xs:schema xmlns:xs="${XS}">
  <xs:element name="${root}" type="${root}"/>
  <xs:complexType name="${root}">
    <xs:sequence>
      ${NAMES.map((n) => `<xs:element name="${n}" type="xs:string"/>`).join('\n      ')}
      <xs:element name="typed" type="${root}Value"/>
    </xs:sequence>
    ${NAMES.map((n) => `<xs:attribute name="${n}" type="xs:string" use="required"/>`).join('\n    ')}
  </xs:complexType>
  <xs:simpleType name="${root}Value"><xs:restriction base="xs:string"><xs:maxLength value="40"/></xs:restriction></xs:simpleType>
</xs:schema>`;

const input = (root: string) => ({ entry: 's.xsd', files: { 's.xsd': schema(root) } });

describe('names of Object.prototype in a schema with a locale', () => {
  for (const root of NAMES) {
    it(`generate a valid document for the root ${root}`, async () => {
      for (const locale of ['de', 'en']) {
        const sample = await generateSample(input(root), { locale, seed: 3 });
        expect(sample.status, `${root} ${locale}`).toBe('valid');
        expect(Object.getPrototypeOf({})).toBe(Object.prototype);
      }
    });
  }

  it('let localeFields name them as paths and type names, own keys only', async () => {
    const fields = JSON.parse(
      '{"/constructor/__proto__":"person.lastName","constructorValue":"person.firstName","constructor":null}',
    ) as Record<string, FieldKey | null>;
    const sample = await generateSample(input('constructor'), { locale: de, localeFields: fields, seed: 3 });
    expect(sample.status).toBe('valid');
    const json = JSON.stringify(sample.json);
    expect(json).toContain('__proto__');
    // A first name from the locale for the type named in localeFields, a last name for the path.
    const typed = /<typed>([^<]*)<\/typed>/.exec(sample.xml)?.[1] ?? '';
    expect(de.person.firstName.female.concat(de.person.firstName.male, de.person.firstName.neutral)).toContain(typed);
    const last = /<__proto__>([^<]*)<\/__proto__>/.exec(sample.xml)?.[1] ?? '';
    expect(de.person.lastName).toContain(last);
  });

  it('are no locale tag, and no locale field in locale data', () => {
    for (const name of NAMES) expect(() => resolveLocale(name), name).toThrow(TypeError);
    const patch = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(() => defineLocale('xx', { extends: de, ...patch })).toThrow(/__proto__ is not a locale field/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
