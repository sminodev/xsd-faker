import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import type { ValueSource } from '../values/source.js';
import { serializeXml } from '../xml/serialize.js';
import { Problems } from '../xsd/problems.js';
import { SchemaSet, XS } from '../xsd/schema-set.js';
import { firstBranch, preferBranches, randomBranch, type WalkOptions, Walker } from './walker.js';

/** Every simple value is "v", so the tests see the structure only. */
const constant: ValueSource = { value: () => 'v' };

function walk(body: string, options: Partial<WalkOptions> = {}, root = 'R', extra = 'elementFormDefault="qualified"') {
  const problems = new Problems();
  const set = new SchemaSet(
    { 'a.xsd': `<xs:schema xmlns:xs="${XS}" xmlns="urn:t" targetNamespace="urn:t" ${extra}>${body}</xs:schema>` },
    problems,
  );
  set.load('a.xsd');
  const component = set.components.element.get(`{urn:t}${root}`);
  if (!component) {
    throw new Error(`no element ${root}`);
  }
  const walker = new Walker(set, problems, {
    optional: 'none',
    repeat: 1,
    choice: firstBranch,
    maxDepth: 12,
    values: constant,
    rng: createRng(1),
    ...options,
  });
  const tree = walker.root(component);
  const xml = serializeXml(tree, { indent: '', declaration: false }).trim().replace(' xmlns="urn:t"', '');
  return { xml, tree, problems: problems.list };
}

const SEQUENCE = `
  <xs:element name="R"><xs:complexType><xs:sequence>
    <xs:element name="a" type="xs:string"/>
    <xs:element name="b" type="xs:string" minOccurs="0"/>
    <xs:element name="c" type="xs:string" maxOccurs="3"/>
  </xs:sequence></xs:complexType></xs:element>`;

describe('Walker: content models', () => {
  it('writes only required content in mode none, in document order', () => {
    expect(walk(SEQUENCE).xml).toBe('<R><a>v</a><c>v</c></R>');
  });

  it('adds optional elements in mode all and repeats up to maxOccurs', () => {
    expect(walk(SEQUENCE, { optional: 'all', repeat: 5 }).xml).toBe('<R><a>v</a><b>v</b><c>v</c><c>v</c><c>v</c></R>');
  });

  it('marks repeatable elements in the tree', () => {
    const { tree } = walk(SEQUENCE);
    expect(tree.children.map((c) => (c.kind === 'element' ? `${c.name}:${c.repeatable}` : ''))).toEqual([
      'a:false',
      'c:true',
    ]);
  });

  const CHOICE = `
    <xs:element name="R"><xs:complexType><xs:choice>
      <xs:element name="pickup" type="xs:string"/>
      <xs:group ref="Delivery"/>
    </xs:choice></xs:complexType></xs:element>
    <xs:group name="Delivery"><xs:sequence>
      <xs:element name="date" type="xs:string"/><xs:element name="time" type="xs:string" minOccurs="0"/>
    </xs:sequence></xs:group>`;

  it('takes the first branch of a choice by default', () => {
    expect(walk(CHOICE).xml).toBe('<R><pickup>v</pickup></R>');
  });

  it('takes the branch that mentions a preferred element, also through a group', () => {
    expect(walk(CHOICE, { choice: preferBranches(['time']) }).xml).toBe('<R><date>v</date></R>');
  });

  it('reaches every branch with random choices', () => {
    const seen = new Set(
      Array.from({ length: 20 }, (_, seed) => walk(CHOICE, { choice: randomBranch, rng: createRng(seed) }).xml),
    );
    expect(seen).toEqual(new Set(['<R><pickup>v</pickup></R>', '<R><date>v</date></R>']));
  });

  it('leaves out particles with maxOccurs 0', () => {
    const body = `<xs:element name="R"><xs:complexType><xs:sequence>
      <xs:element name="a" type="xs:string"/><xs:element name="gone" type="xs:string" maxOccurs="0"/>
    </xs:sequence></xs:complexType></xs:element>`;
    expect(walk(body, { optional: 'all' }).xml).toBe('<R><a>v</a></R>');
  });

  it('stops optional recursion at maxDepth', () => {
    const body = `<xs:element name="R" type="Node"/>
      <xs:complexType name="Node"><xs:sequence><xs:element name="child" type="Node" minOccurs="0"/></xs:sequence></xs:complexType>`;
    expect(walk(body, { optional: 'all', maxDepth: 2 }).xml).toBe('<R><child><child/></child></R>');
  });
});

describe('Walker: types and attributes', () => {
  it('puts the content of the base type first for an extension', () => {
    const body = `<xs:element name="R" type="Contact"/>
      <xs:complexType name="Party"><xs:sequence><xs:element name="name" type="xs:string"/></xs:sequence>
        <xs:attribute name="id" type="xs:string" use="required"/></xs:complexType>
      <xs:complexType name="Contact"><xs:complexContent><xs:extension base="Party">
        <xs:sequence><xs:element name="email" type="xs:string"/></xs:sequence>
      </xs:extension></xs:complexContent></xs:complexType>`;
    expect(walk(body).xml).toBe('<R id="v"><name>v</name><email>v</email></R>');
  });

  it('writes required, fixed and optional attributes, and drops prohibited ones of a restriction', () => {
    const body = `<xs:element name="R" type="Narrow"/>
      <xs:complexType name="Wide"><xs:attribute name="a" type="xs:string" use="required"/>
        <xs:attribute name="b" type="xs:string"/><xs:attribute name="c" type="xs:string" fixed="1.0"/></xs:complexType>
      <xs:complexType name="Narrow"><xs:complexContent><xs:restriction base="Wide">
        <xs:attribute name="b" use="prohibited"/>
      </xs:restriction></xs:complexContent></xs:complexType>`;
    expect(walk(body).xml).toBe('<R a="v"/>');
    expect(walk(body, { optional: 'all' }).xml).toBe('<R a="v" c="1.0"/>');
  });

  it('writes simple content with its attributes, also through an attribute group', () => {
    const body = `<xs:element name="R"><xs:complexType><xs:simpleContent><xs:extension base="xs:decimal">
        <xs:attributeGroup ref="Money"/></xs:extension></xs:simpleContent></xs:complexType></xs:element>
      <xs:attributeGroup name="Money"><xs:attribute name="currency" type="xs:string" use="required"/></xs:attributeGroup>`;
    const { xml, tree } = walk(body);
    expect(xml).toBe('<R currency="v">v</R>');
    expect(tree.children[0]).toEqual({ kind: 'text', value: 'v', type: 'number' });
  });

  it('uses fixed and default values of elements', () => {
    const body = `<xs:element name="R"><xs:complexType><xs:sequence>
      <xs:element name="a" type="xs:string" fixed="F"/><xs:element name="b" type="xs:string" default="D"/>
    </xs:sequence></xs:complexType></xs:element>`;
    expect(walk(body).xml).toBe('<R><a>F</a><b>D</b></R>');
  });

  it('leaves local elements without namespace when they are unqualified', () => {
    const { tree } = walk(SEQUENCE, {}, 'R', '');
    expect(tree.ns).toBe('urn:t');
    expect(tree.children.map((c) => (c.kind === 'element' ? c.ns : 'text'))).toEqual(['', '']);
  });

  it('reports unknown types and groups', () => {
    const body = `<xs:element name="R"><xs:complexType><xs:sequence>
      <xs:element name="a" type="Missing"/><xs:group ref="Nowhere"/>
    </xs:sequence></xs:complexType></xs:element>`;
    expect(walk(body).problems.map((p) => p.code)).toEqual(['unknown-type', 'unknown-group']);
  });
});
