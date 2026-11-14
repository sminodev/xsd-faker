// Allowed inert DOCTYPE forms and rejected declarations.
import { describe, expect, it } from 'vitest';
import { GenerateError, generateSample } from '../index.js';
import { scanDoctype } from './doctype.js';

const SHARED: Record<string, string> = {
  'rejected-attlist-different-value':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [\n  <!ATTLIST schema xmlns:ds CDATA #FIXED "urn:other">\n]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-attlist-fixed-without-space':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [ <!ATTLIST schema xmlns:ds CDATA#FIXED "urn:test:ds"> ]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-attlist-equal-only-by-character-reference':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [ <!ATTLIST schema xmlns:ds CDATA "urn:test:ds"> ]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:&#100;s" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-attlist-not-stated-on-root':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [\n  <!ATTLIST schema xmlns:ds CDATA #FIXED "urn:test:ds">\n]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema"  targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-doctype-after-root':
    '<?xml version="1.0" encoding="utf-8"?>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n<!DOCTYPE schema>\n',
  'rejected-element-declaration':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [\n  <!ELEMENT schema ANY>\n]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-entity-long-name':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [ <!ENTITY eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee "INJECTED"> ]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string" fixed="&eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee;"/>\n</schema>\n',
  'rejected-entity-name-with-nbsp':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [ <!ENTITY un\u00a0used "x"> ]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-entity-name-with-semicolon':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [ <!ENTITY un;used "x"> ]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-entity-not-literal':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [\n  <!ENTITY a \'&#x26;b;\'>\n]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-entity-without-space':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [ <!ENTITY unused"x"> ]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-entity-used':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [\n  <!ENTITY dsig \'urn:test:ds\'>\n]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="&dsig;" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-entity-value-with-markup':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [ <!ENTITY unused "<a/>"> ]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-external-entity':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [\n  <!ENTITY ext SYSTEM "file:///etc/hosts">\n]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-comment-with-pi-start':
    '<?xml version="1.0" encoding="utf-8"?>\n<!---> <? -->\n<!DOCTYPE schema [ <!ENTITY e "INJECTED"> ]>\n<!-- ?> -->\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string" fixed="&e;"/>\n</schema>\n',
  'rejected-comment-unterminated-in-subset':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [ <!---> ]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-pe-reference':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [\n  <!ENTITY % p \'\'>\n  %p;\n]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-predefined-entity-redeclared':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [ <!ENTITY amp "WRONG"> ]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'allowed-doctype-only-in-comment':
    '<?xml version="1.0" encoding="utf-8"?>\n<!-- The original declaration was removed:\n<!DOCTYPE schema PUBLIC "-//W3C//DTD XMLSchema 200102//EN" "http://www.w3.org/2001/XMLSchema.dtd" [ <!ENTITY dsig \'urn:test:ds\'> ]>\n-->\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'allowed-entity-only-in-comment':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [ <!ENTITY unused "text"> ]>\n<!-- &unused; is only in a comment and is no reference -->\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'allowed-entity-only-in-cdata':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [ <!ENTITY unused "text"> ]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <annotation><documentation><![CDATA[&unused; is text here]]></documentation></annotation>\n  <element name="Sig" type="string"/>\n</schema>\n',
  'allowed-comment-starts-with-hyphen':
    '<?xml version="1.0" encoding="utf-8"?>\n<!---> <!DOCTYPE schema SYSTEM "http://example.invalid/x.dtd"> -->\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'allowed-inert-doctype':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema\n  PUBLIC "-//W3C//DTD XMLSchema 200102//EN" "http://www.w3.org/2001/XMLSchema.dtd"\n [\n   <!ATTLIST schema\n     xmlns:ds CDATA #FIXED "urn:test:ds">\n   <!ENTITY dsig \'urn:test:ds\'>\n   <!ENTITY % p \'\'>\n   <!ENTITY % s \'\'>\n   <!-- a comment in the subset -->\n  ]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'malformed-double-bom':
    '\ufeff\ufeff<?xml version="1.0" encoding="utf-8"?>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'malformed-space-before-bom':
    ' \ufeff<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'malformed-xml-declaration-after-doctype':
    '<!DOCTYPE schema>\n<?xml version="1.0" encoding="utf-8"?>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'rejected-attlist-definitions-without-space':
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE schema [ <!ATTLIST schema xmlns CDATA "http://www.w3.org/2001/XMLSchema"xmlns:ds CDATA "urn:test:ds"> ]>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
  'malformed-space-before-xml-declaration':
    ' <?xml version="1.0" encoding="utf-8"?>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
};
const QUIET = ['allowed-doctype-only-in-comment', 'allowed-comment-starts-with-hyphen'];

const SCHEMA =
  '<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds"><element name="Sig" type="string"/></schema>';
const withSubset = (subset: string, root = SCHEMA) =>
  `<?xml version="1.0"?>\n<!DOCTYPE schema [\n${subset}\n]>\n${root}`;

describe('the DOCTYPE cases', () => {
  it.each(Object.keys(SHARED).filter((name) => name.startsWith('rejected-')))('refuses %s', (name) => {
    expect(scanDoctype(SHARED[name]!)).toMatchObject({ kind: 'unsafe' });
  });

  it('neutralizes a DOCTYPE that restates the namespace declarations and keeps every line in place', () => {
    const text = SHARED['allowed-inert-doctype']!;
    const scan = scanDoctype(text);
    expect(scan.kind).toBe('neutralized');
    const out = scan.kind === 'neutralized' ? scan.text : '';
    expect(out).not.toContain('DOCTYPE');
    expect(out).toHaveLength(text.length);
    expect(out.split('\n').length).toBe(text.split('\n').length);
    expect(out.slice(out.indexOf('<schema'))).toBe(text.slice(text.indexOf('<schema')));
  });

  it.each(Object.keys(SHARED).filter((name) => name.startsWith('malformed-')))('finds %s not XML', (name) => {
    expect(scanDoctype(SHARED[name]!)).toMatchObject({ kind: 'invalid' });
  });

  it.each(Object.keys(SHARED).filter((name) => name.startsWith('allowed-') && !QUIET.includes(name)))(
    'neutralizes %s',
    (name) => {
      expect(scanDoctype(SHARED[name]!).kind).toBe('neutralized');
    },
  );

  it.each(QUIET)('finds no DOCTYPE in %s: it stands in a comment', (name) => {
    expect(scanDoctype(SHARED[name]!)).toEqual({ kind: 'none' });
  });

  it('reads 4 MiB of &amp; after a DOCTYPE in linear time', () => {
    const text = SHARED['allowed-inert-doctype']!.replace(
      '</schema>',
      `<annotation><documentation>${'&amp;'.repeat(838861)}</documentation></annotation></schema>`,
    );
    const started = performance.now();
    expect(scanDoctype(text).kind).toBe('neutralized');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it.each(['allowed-entity-only-in-comment', 'allowed-entity-only-in-cdata'])(
    'neutralizes %s: an entity name in a comment or CDATA is no reference',
    (name) => {
      expect(scanDoctype(SHARED[name]!).kind).toBe('neutralized');
    },
  );

  it('ignores a DOCTYPE that only a comment quotes', () => {
    expect(scanDoctype(SHARED['allowed-doctype-only-in-comment']!)).toEqual({ kind: 'none' });
  });
});

describe('the DOCTYPE profile', () => {
  it.each<[string, string]>([
    ['two DOCTYPEs', `<!DOCTYPE schema>\n<!DOCTYPE schema>\n${SCHEMA}`],
    ['a declaration before the root', `<!ENTITY a 'b'>${SCHEMA}`],
    ['a lower-case doctype', `<!doctype schema>${SCHEMA}`],
    ['an unclosed literal', withSubset("<!ENTITY a 'b>")],
    ['a conditional section', withSubset('<![INCLUDE[ ]]>')],
    ['a notation', withSubset('<!NOTATION n SYSTEM "n">')],
    ['an external parameter entity', withSubset('<!ENTITY % e SYSTEM "e.dtd">')],
    ['a parameter entity with content', withSubset("<!ENTITY % e 'x'>")],
    ['a redefined predefined entity', withSubset("<!ENTITY lt '<'>")],
    ['a processing instruction in the subset', withSubset('<?pi x?>')],
    ['an ATTLIST of another element', withSubset('<!ATTLIST element xmlns:ds CDATA #FIXED "urn:test:ds">')],
    ['an ATTLIST of another attribute', withSubset('<!ATTLIST schema version CDATA "1.0">')],
    ['an ATTLIST without default', withSubset('<!ATTLIST schema xmlns:ds CDATA #IMPLIED>')],
    ['an ATTLIST of another type', withSubset('<!ATTLIST schema xmlns:ds NMTOKEN "urn:test:ds">')],
    [
      'an entity in an attribute value',
      withSubset("<!ENTITY t 'urn:test:ds'>", SCHEMA.replace('targetNamespace="urn:test:ds"', 'targetNamespace="&t;"')),
    ],
    [
      'an entity in text',
      withSubset(
        "<!ENTITY t 'x'>",
        SCHEMA.replace('</schema>', '<annotation><documentation>&t;</documentation></annotation></schema>'),
      ),
    ],
    ['a declaration after the root starts', `${SCHEMA.replace('</schema>', '<!ENTITY a "b"></schema>')}`],
  ])('refuses %s', (_, text) => {
    expect(scanDoctype(text)).toMatchObject({ kind: 'unsafe' });
  });

  it.each<[string, string]>([
    [
      'a prefixed root and its ATTLIST',
      withSubset(
        '<!ATTLIST xs:schema xmlns:xs CDATA #FIXED "http://www.w3.org/2001/XMLSchema">',
        '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"/>',
      ).replace('DOCTYPE schema', 'DOCTYPE xs:schema'),
    ],
    [
      'a SYSTEM identifier, predefined and numeric references',
      `<!DOCTYPE schema SYSTEM "x.dtd">${SCHEMA.replace('</schema>', '<annotation><documentation>&lt;&#65;&#x42;&amp;</documentation></annotation></schema>')}`,
    ],
    [
      'markup in comments, CDATA and processing instructions',
      withSubset(
        '<!-- <!ELEMENT x ANY> -->',
        SCHEMA.replace(
          '</schema>',
          '<!-- &x; <!ENTITY --><annotation><documentation><![CDATA[<!DOCTYPE &y;]]></documentation></annotation><?pi <!ENTITY?></schema>',
        ),
      ),
    ],
  ])('neutralizes %s', (_, text) => {
    expect(scanDoctype(text).kind).toBe('neutralized');
  });

  it('leaves documents without DOCTYPE alone, also with an undeclared entity for the parser to report', () => {
    expect(scanDoctype(SCHEMA)).toEqual({ kind: 'none' });
    expect(scanDoctype(SCHEMA.replace('</schema>', '&x;</schema>'))).toEqual({ kind: 'none' });
  });
});

describe('input that is not well formed, through the API', () => {
  it.each([
    ['malformed-space-before-bom', 'invalid-xml'],
    ['malformed-xml-declaration-after-doctype', 'invalid-xml'],
    ['rejected-attlist-definitions-without-space', 'unsafe-input'],
  ])('refuses %s with a structured error', async (name, code) => {
    const input = { entry: 's.xsd', files: { 's.xsd': SHARED[name]! } };
    const error = await generateSample(input, { seed: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GenerateError);
    expect((error as GenerateError).problems.map((p) => p.code)).toContain(code);
  });

  it('takes the same ATTLIST with the space XML requires between its definitions', () => {
    const spaced = SHARED['rejected-attlist-definitions-without-space']!.replace('"xmlns:ds', '" xmlns:ds');
    expect(scanDoctype(spaced).kind).toBe('neutralized');
  });
});
