import { describe, expect, it } from 'vitest';
import { Problems } from '../xsd/problems.js';
import { SchemaSet } from '../xsd/schema-set.js';
import { declaredType, expandedName, substitutionCandidates, typeCandidates } from './alternatives.js';

const XS = 'xmlns:xs="http://www.w3.org/2001/XMLSchema"';
function load(body: string, attributes = '') {
  const set = new SchemaSet({ 'a.xsd': `<xs:schema ${XS} ${attributes}>${body}</xs:schema>` }, new Problems());
  set.load('a.xsd');
  return set;
}
const types = `<xs:complexType name="T"><xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence></xs:complexType>
  <xs:complexType name="Mid" block="extension"><xs:complexContent><xs:extension base="T"/></xs:complexContent></xs:complexType>
  <xs:complexType name="Leaf"><xs:complexContent><xs:extension base="Mid"/></xs:complexContent></xs:complexType>
  <xs:complexType name="Res"><xs:complexContent><xs:restriction base="T"><xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence></xs:restriction></xs:complexContent></xs:complexType>`;
const names = (list: { node: Element; doc: { targetNamespace: string } }[]) =>
  list.map((c) => expandedName(c as Parameters<typeof expandedName>[0]));
type Element = import('@xmldom/xmldom').Element;

describe('substitution candidates', () => {
  it('leave out members whose derivation the head makes final, and keep transitive ones', () => {
    const set = load(
      `${types}<xs:element name="H" type="T" final="extension"/><xs:element name="Ext" type="Mid" substitutionGroup="H"/>
       <xs:element name="Same" substitutionGroup="H"/><xs:element name="Sub" type="Res" substitutionGroup="Same"/>`,
    );
    const head = set.components.element.get('{}H')!;
    expect(names(substitutionCandidates(set, head))).toEqual(['{}H', '{}Same', '{}Sub']);
    // A member without a type has the type of its head.
    const same = set.components.element.get('{}Same')!;
    expect(declaredType(set, same.node)).toMatchObject({ kind: 'named', qname: { ns: '', local: 'T' } });
  });

  it('apply block of intermediate types, and of the schema by default', () => {
    const set = load(
      `${types}<xs:element name="H" type="T"/><xs:element name="L" type="Leaf" substitutionGroup="H"/><xs:element name="M" type="Mid" substitutionGroup="H"/>`,
    );
    // Leaf extends Mid, which blocks extension; Mid itself extends T, which blocks nothing.
    expect(names(substitutionCandidates(set, set.components.element.get('{}H')!))).toEqual(['{}H', '{}M']);
    const blocked = load(
      `${types}<xs:element name="H" type="T"/><xs:element name="R" type="Res" substitutionGroup="H"/>`,
      'blockDefault="restriction"',
    );
    expect(names(substitutionCandidates(blocked, blocked.components.element.get('{}H')!))).toEqual(['{}H']);
  });
});

describe('type candidates', () => {
  it('follow derivation chains, but only the element and the declared type block methods', () => {
    const set = load(`${types}<xs:element name="E" type="T"/><xs:element name="F" type="T" block="restriction"/>`);
    const type = set.components.complexType.get('{}T')!;
    // For xsi:type only the element's block and that of the declared type count, not that of Mid.
    expect(names(typeCandidates(set, set.components.element.get('{}E')!.node, type))).toEqual([
      '{}T',
      '{}Mid',
      '{}Leaf',
      '{}Res',
    ]);
    expect(names(typeCandidates(set, set.components.element.get('{}F')!.node, type))).toEqual([
      '{}T',
      '{}Mid',
      '{}Leaf',
    ]);
  });
});
