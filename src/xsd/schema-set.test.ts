import { describe, expect, it } from 'vitest';
import { Problems } from './problems.js';
import { documentation, normalizePath, resolvePath, SchemaSet, xsChild } from './schema-set.js';

const XS = 'xmlns:xs="http://www.w3.org/2001/XMLSchema"';

function load(files: Record<string, string>, entry: string) {
  const problems = new Problems();
  const set = new SchemaSet(files, problems);
  const doc = set.load(entry);
  return { set, doc, problems: problems.list };
}

describe('paths', () => {
  it('resolve relative to the importing document', () => {
    expect(resolvePath('a.xsd', 'b.xsd')).toBe('b.xsd');
    expect(resolvePath('dir/a.xsd', '../b.xsd')).toBe('b.xsd');
    expect(resolvePath('dir/a.xsd', 'sub/./b.xsd')).toBe('dir/sub/b.xsd');
    expect(resolvePath('a.xsd', '../b.xsd')).toBe('../b.xsd');
    expect(resolvePath('dir/a.xsd', '..\\types\\b.xsd')).toBe('types/b.xsd');
  });

  it('keep absolute URIs and resolve relative paths against them', () => {
    expect(resolvePath('dir/a.xsd', 'http://example.org/s/b.xsd')).toBe('http://example.org/s/b.xsd');
    expect(resolvePath('http://example.org/s/b.xsd', '../t/c.xsd')).toBe('http://example.org/t/c.xsd');
    expect(normalizePath('https://example.org/s/b.xsd')).toBe('https://example.org/s/b.xsd');
    expect(normalizePath('/x/../y/z.xsd')).toBe('/y/z.xsd');
  });
});

describe('SchemaSet', () => {
  it('keeps the entry path when a schema is missing or its reader throws', () => {
    expect(load({}, 'missing.xsd').problems).toEqual([
      expect.objectContaining({ code: 'missing-file', file: 'missing.xsd' }),
    ]);
    const problems = new Problems();
    const set = new SchemaSet(() => {
      throw new Error('EACCES');
    }, problems);
    expect(set.load('blocked.xsd')).toBeUndefined();
    expect(problems.list).toEqual([expect.objectContaining({ code: 'missing-file', file: 'blocked.xsd' })]);
    expect(problems.list[0]?.message).toContain('EACCES');
  });

  it('follows imports and includes and indexes the global components by expanded name', () => {
    const { set, doc, problems } = load(
      {
        'dir/main.xsd': `<xs:schema ${XS} targetNamespace="urn:m" elementFormDefault="qualified">
          <xs:import namespace="urn:o" schemaLocation="../other.xsd"/>
          <xs:include schemaLocation="part.xsd"/>
          <xs:element name="Root" type="xs:string"/>
        </xs:schema>`,
        'dir/part.xsd': `<xs:schema ${XS} targetNamespace="urn:m"><xs:simpleType name="Part"/></xs:schema>`,
        'other.xsd': `<xs:schema ${XS} targetNamespace="urn:o"><xs:complexType name="Other"/></xs:schema>`,
      },
      'dir/main.xsd',
    );
    expect(problems).toEqual([]);
    expect(doc?.elementQualified).toBe(true);
    expect([...set.documents.keys()]).toEqual(['dir/main.xsd', 'other.xsd', 'dir/part.xsd']);
    expect(set.lookup('element', { ns: 'urn:m', local: 'Root' })?.doc.path).toBe('dir/main.xsd');
    expect(set.lookup('simpleType', { ns: 'urn:m', local: 'Part' })).toBeDefined();
    expect(set.lookup('complexType', { ns: 'urn:o', local: 'Other' })).toBeDefined();
  });

  it('reports missing files, documents that are not XML or not an XML Schema, and duplicates', () => {
    const { problems } = load(
      {
        'a.xsd': `<xs:schema ${XS}>\n<xs:import schemaLocation="gone.xsd"/>\n<xs:include schemaLocation="b.xsd"/>
          <xs:import schemaLocation="broken.xsd"/><xs:import schemaLocation="plain.xml"/>
          <xs:simpleType name="T"/></xs:schema>`,
        'b.xsd': `<xs:schema ${XS}><xs:simpleType name="T"/></xs:schema>`,
        'broken.xsd': '<xs:schema',
        'plain.xml': '<a/>',
      },
      'a.xsd',
    );
    expect(problems.map((p) => p.code)).toEqual(['missing-file', 'invalid-xml', 'not-a-schema', 'duplicate-component']);
    expect(problems[0]).toMatchObject({ file: 'a.xsd', line: 2, message: 'schema document gone.xsd not found' });
  });

  it('reports an include and a redefine of another target namespace', () => {
    const { problems } = load(
      {
        'a.xsd': `<xs:schema ${XS} targetNamespace="urn:a">
          <xs:include schemaLocation="other.xsd"/>
          <xs:redefine schemaLocation="other.xsd"/>
        </xs:schema>`,
        'other.xsd': `<xs:schema ${XS} targetNamespace="urn:b"><xs:simpleType name="T"/></xs:schema>`,
      },
      'a.xsd',
    );
    expect(problems).toEqual([
      expect.objectContaining({ code: 'namespace-mismatch', line: 2 }),
      expect.objectContaining({ code: 'namespace-mismatch', line: 3 }),
    ]);
  });

  describe('xs:redefine', () => {
    const base = `<xs:schema ${XS} xmlns="urn:r" targetNamespace="urn:r">
      <xs:group name="G"><xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence></xs:group>
      <xs:group name="User"><xs:sequence><xs:group ref="G"/></xs:sequence></xs:group>
      <xs:attributeGroup name="AG"><xs:attribute name="x"/><xs:attribute name="z"/></xs:attributeGroup>
      <xs:complexType name="T"/>
    </xs:schema>`;
    const redefining = (inner: string, extra = '') => ({
      'base.xsd': base,
      'mid.xsd': `<xs:schema ${XS} xmlns="urn:r" targetNamespace="urn:r">${extra}<xs:redefine schemaLocation="base.xsd">${inner}</xs:redefine></xs:schema>`,
    });
    const extended =
      '<xs:group name="G"><xs:sequence><xs:group ref="G"/><xs:element name="b" type="xs:string"/></xs:sequence></xs:group>';

    it('replaces a group everywhere and lets a self-reference mean the replaced one', () => {
      const { set, problems } = load(redefining(extended), 'mid.xsd');
      expect(problems).toEqual([]);
      const g = set.lookup('group', { ns: 'urn:r', local: 'G' })!;
      expect(set.pathOf(g.node)).toBe('mid.xsd');
      const self = g.node.getElementsByTagNameNS('http://www.w3.org/2001/XMLSchema', 'group')[0]!;
      expect(set.pathOf(set.reference('group', self)!.node)).toBe('base.xsd');
      // A reference from the redefined document itself also gets the new definition.
      const user = set.lookup('group', { ns: 'urn:r', local: 'User' })!;
      const ref = user.node.getElementsByTagNameNS('http://www.w3.org/2001/XMLSchema', 'group')[0]!;
      expect(set.reference('group', ref)).toBe(g);
    });

    it('chains redefinitions, and a restriction replaces without inheriting', () => {
      const files = {
        ...redefining(extended),
        'top.xsd': `<xs:schema ${XS} xmlns="urn:r" targetNamespace="urn:r"><xs:redefine schemaLocation="mid.xsd">${extended}<xs:attributeGroup name="AG"><xs:attribute name="x"/></xs:attributeGroup></xs:redefine></xs:schema>`,
      };
      const { set, problems } = load(files, 'top.xsd');
      expect(problems).toEqual([]);
      const top = set.lookup('group', { ns: 'urn:r', local: 'G' })!;
      const self = (c: { node: import('@xmldom/xmldom').Element }) =>
        c.node.getElementsByTagNameNS('http://www.w3.org/2001/XMLSchema', 'group')[0]!;
      const mid = set.reference('group', self(top))!;
      expect([set.pathOf(top.node), set.pathOf(mid.node), set.pathOf(set.reference('group', self(mid))!.node)]).toEqual(
        ['top.xsd', 'mid.xsd', 'base.xsd'],
      );
      const ag = set.lookup('attributeGroup', { ns: 'urn:r', local: 'AG' })!;
      expect(ag.node.getElementsByTagNameNS('http://www.w3.org/2001/XMLSchema', 'attribute')).toHaveLength(1);
    });

    it('applies to a chameleon document in the namespace it is redefined into', () => {
      const { set, problems } = load(
        {
          'base.xsd': base.replace(' xmlns="urn:r" targetNamespace="urn:r"', ''),
          'mid.xsd': redefining(extended)['mid.xsd'],
        },
        'mid.xsd',
      );
      expect(problems).toEqual([]);
      const g = set.lookup('group', { ns: 'urn:r', local: 'G' })!;
      const self = g.node.getElementsByTagNameNS('http://www.w3.org/2001/XMLSchema', 'group')[0]!;
      expect(set.pathOf(set.reference('group', self)!.node)).toBe('base.xsd');
    });

    it('refuses redefined types, xs:override, missing targets and invalid self-references', () => {
      const codes = (files: Record<string, string>, entry = 'mid.xsd') =>
        load(files, entry).problems.map((p) => p.code);
      expect(codes(redefining('<xs:complexType name="T"/>'))).toEqual(['unsupported-redefine']);
      expect(codes(redefining('<xs:group name="Missing"><xs:sequence/></xs:group>'))).toEqual(['unknown-group']);
      expect(
        codes(
          redefining('<xs:group name="G"><xs:sequence><xs:group ref="G"/><xs:group ref="G"/></xs:sequence></xs:group>'),
        ),
      ).toEqual(['invalid-redefine']);
      expect(
        codes(redefining('<xs:group name="G"><xs:sequence><xs:group ref="G" maxOccurs="2"/></xs:sequence></xs:group>')),
      ).toEqual(['invalid-redefine']);
      expect(codes({ 'a.xsd': `<xs:schema ${XS}><xs:override schemaLocation="b.xsd"/></xs:schema>` }, 'a.xsd')).toEqual(
        ['unsupported-redefine'],
      );
    });
  });
  it('loads a chameleon include once per namespace it is included into', () => {
    const { set, problems } = load(
      {
        'main.xsd': `<xs:schema ${XS} xmlns:a="urn:a" xmlns:b="urn:b" targetNamespace="urn:main">
          <xs:import namespace="urn:a" schemaLocation="a/a.xsd"/>
          <xs:import namespace="urn:b" schemaLocation="b.xsd"/>
        </xs:schema>`,
        'a/a.xsd': `<xs:schema ${XS} targetNamespace="urn:a"><xs:include schemaLocation="../common/c.xsd"/></xs:schema>`,
        'b.xsd': `<xs:schema ${XS} targetNamespace="urn:b"><xs:include schemaLocation="common/c.xsd"/></xs:schema>`,
        'common/c.xsd': `<xs:schema ${XS} elementFormDefault="qualified">
          <xs:include schemaLocation="d.xsd"/>
          <xs:complexType name="C"><xs:sequence><xs:element name="v" type="D"/></xs:sequence></xs:complexType>
          <xs:element name="E" type="C"/>
        </xs:schema>`,
        'common/d.xsd': `<xs:schema ${XS}><xs:include schemaLocation="c.xsd"/><xs:simpleType name="D"><xs:restriction base="xs:string"/></xs:simpleType></xs:schema>`,
      },
      'main.xsd',
    );
    expect(problems).toEqual([]);
    for (const ns of ['urn:a', 'urn:b']) {
      const c = set.components.complexType.get(`{${ns}}C`);
      expect(c?.doc.targetNamespace).toBe(ns);
      expect(c?.doc.chameleon).toBe(true);
      const v = xsChild(xsChild(c!.node, 'sequence')!, 'element')!;
      // A name without namespace in the copy means the namespace it was included into, also through d.xsd.
      expect(set.resolveQName(v, 'D')).toEqual({ ns, local: 'D' });
      expect(set.components.simpleType.has(`{${ns}}D`)).toBe(true);
      expect(set.resolveQName(v, 'xs:string').ns).toBe('http://www.w3.org/2001/XMLSchema');
    }
    // Each copy has its own nodes, and nothing is declared without namespace.
    expect(set.components.complexType.get('{urn:a}C')?.node).not.toBe(set.components.complexType.get('{urn:b}C')?.node);
    expect([...set.components.element.keys()].sort()).toEqual(['{urn:a}E', '{urn:b}E']);
    expect([...set.sourceTexts.keys()].sort()).toEqual([
      'a/a.xsd',
      'b.xsd',
      'common/c.xsd',
      'common/d.xsd',
      'main.xsd',
    ]);
    expect(set.pathOf(set.components.complexType.get('{urn:b}C')!.node)).toBe('common/c.xsd');
  });

  it('keeps a document without namespace as it is where it is not included into a namespace', () => {
    const { set, problems } = load(
      {
        'main.xsd': `<xs:schema ${XS} targetNamespace="urn:a"><xs:include schemaLocation="c.xsd"/><xs:import schemaLocation="c.xsd"/></xs:schema>`,
        'c.xsd': `<xs:schema ${XS}><xs:simpleType name="T"><xs:restriction base="xs:string"/></xs:simpleType></xs:schema>`,
      },
      'main.xsd',
    );
    expect(problems).toEqual([]);
    expect([...set.components.simpleType.keys()].sort()).toEqual(['{urn:a}T', '{}T']);
  });

  it('resolves QNames with the namespaces in scope, including the default namespace', () => {
    const { set, doc, problems } = load(
      { 'a.xsd': `<xs:schema ${XS} xmlns="urn:d" xmlns:p="urn:p"><xs:element name="E" type="T"/></xs:schema>` },
      'a.xsd',
    );
    const element = xsChild(doc!.root, 'element')!;
    expect(set.resolveQName(element, 'T')).toEqual({ ns: 'urn:d', local: 'T' });
    expect(set.resolveQName(element, 'p:T')).toEqual({ ns: 'urn:p', local: 'T' });
    expect(set.resolveQName(element, 'xs:string')).toEqual({ ns: 'http://www.w3.org/2001/XMLSchema', local: 'string' });
    expect(set.resolveQName(element, 'q:T')).toEqual({ ns: '', local: 'T' });
    expect(problems.map((p) => p.code)).toEqual(['unknown-prefix']);
  });
});

describe('documentation', () => {
  it('joins the lines of a paragraph and keeps paragraphs apart', () => {
    const { doc } = load(
      {
        'a.xsd': `<xs:schema ${XS}><xs:element name="E"><xs:annotation><xs:documentation>First
          line   continues.

          Second paragraph.</xs:documentation></xs:annotation></xs:element></xs:schema>`,
      },
      'a.xsd',
    );
    expect(documentation(xsChild(doc!.root, 'element')!)).toBe('First line continues.\n\nSecond paragraph.');
  });
});
