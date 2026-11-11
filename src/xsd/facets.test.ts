import { describe, expect, it } from 'vitest';
import { FacetReader, jsonTypeOf } from './facets.js';
import { Problems } from './problems.js';
import { SchemaSet, XS } from './schema-set.js';

/** Reads the facets of the named simple type in a schema made of `types`. */
function facetsOf(types: string, name: string) {
  const problems = new Problems();
  const set = new SchemaSet(
    { 'a.xsd': `<xs:schema xmlns:xs="${XS}" xmlns="urn:t" targetNamespace="urn:t">${types}</xs:schema>` },
    problems,
  );
  set.load('a.xsd');
  const facets = new FacetReader(set, problems).read({ ns: 'urn:t', local: name });
  return { facets, problems: problems.list };
}

describe('FacetReader', () => {
  it('follows a restriction chain down to the built-in type', () => {
    const { facets } = facetsOf(
      `<xs:simpleType name="Base"><xs:restriction base="xs:string"><xs:maxLength value="40"/></xs:restriction></xs:simpleType>
       <xs:simpleType name="Name"><xs:restriction base="Base"><xs:minLength value="1"/><xs:maxLength value="20"/></xs:restriction></xs:simpleType>`,
      'Name',
    );
    expect(facets).toEqual({ builtin: 'string', variety: 'atomic', patterns: [], minLength: 1, maxLength: 20 });
  });

  it('keeps the patterns of each step apart and the enumeration of the last step', () => {
    const { facets } = facetsOf(
      `<xs:simpleType name="Code"><xs:restriction base="xs:token"><xs:pattern value="[A-Z]+"/><xs:pattern value="\\d+"/><xs:enumeration value="A"/><xs:enumeration value="B"/></xs:restriction></xs:simpleType>
       <xs:simpleType name="Short"><xs:restriction base="Code"><xs:pattern value=".{1}"/><xs:enumeration value="A"/></xs:restriction></xs:simpleType>`,
      'Short',
    );
    expect(facets.patterns).toEqual([['[A-Z]+', '\\d+'], ['.{1}']]);
    expect(facets.enumeration).toEqual(['A']);
  });

  it('keeps the tightest numeric bounds and digit limits', () => {
    const { facets } = facetsOf(
      `<xs:simpleType name="Amount"><xs:restriction base="xs:decimal"><xs:minInclusive value="0"/><xs:maxInclusive value="1000"/><xs:totalDigits value="6"/><xs:fractionDigits value="2"/></xs:restriction></xs:simpleType>
       <xs:simpleType name="Small"><xs:restriction base="Amount"><xs:minExclusive value="0"/><xs:maxInclusive value="99.5"/><xs:totalDigits value="4"/></xs:restriction></xs:simpleType>`,
      'Small',
    );
    expect(facets.min).toEqual({ value: 0, lexical: '0', exclusive: true });
    expect(facets.max).toEqual({ value: 99.5, lexical: '99.5', exclusive: false });
    expect(facets.totalDigits).toBe(4);
    expect(facets.fractionDigits).toBe(2);
  });

  it('starts integer types with their value range', () => {
    const { facets } = facetsOf(
      `<xs:simpleType name="Level"><xs:restriction base="xs:unsignedByte"><xs:maxInclusive value="9"/></xs:restriction></xs:simpleType>`,
      'Level',
    );
    expect(facets.min).toEqual({ value: 0, exclusive: false });
    expect(facets.max).toEqual({ value: 9, lexical: '9', exclusive: false });
  });

  it('reads lists and unions with their item and member types', () => {
    const { facets } = facetsOf(
      `<xs:simpleType name="Codes"><xs:list itemType="xs:int"/></xs:simpleType>
       <xs:simpleType name="Either"><xs:union memberTypes="xs:date Codes"><xs:simpleType><xs:restriction base="xs:boolean"/></xs:simpleType></xs:union></xs:simpleType>`,
      'Either',
    );
    expect(facets.variety).toBe('union');
    expect(facets.members?.map((m) => `${m.variety}:${m.builtin}`)).toEqual([
      'atomic:date',
      'list:string',
      'atomic:boolean',
    ]);
    expect(facets.members?.[1]?.item?.builtin).toBe('int');
  });

  it('reads the built-in list types as lists of their item type', () => {
    const { facets } = facetsOf(
      `<xs:simpleType name="T"><xs:restriction base="xs:NMTOKENS"><xs:maxLength value="5"/></xs:restriction></xs:simpleType>`,
      'T',
    );
    expect(facets).toMatchObject({ builtin: 'NMTOKENS', variety: 'list', minLength: 1, maxLength: 5 });
    expect(facets.item?.builtin).toBe('NMTOKEN');
  });

  it('reports unknown types, invalid facets and circles', () => {
    expect(
      facetsOf(`<xs:simpleType name="A"><xs:restriction base="Missing"/></xs:simpleType>`, 'A').problems[0]?.code,
    ).toBe('unknown-type');
    expect(
      facetsOf(
        `<xs:simpleType name="A"><xs:restriction base="xs:string"><xs:maxLength value="-1"/></xs:restriction></xs:simpleType>`,
        'A',
      ).problems[0]?.code,
    ).toBe('invalid-facet');
    expect(
      facetsOf(
        `<xs:simpleType name="A"><xs:restriction base="B"/></xs:simpleType><xs:simpleType name="B"><xs:restriction base="A"/></xs:simpleType>`,
        'A',
      ).problems[0]?.code,
    ).toBe('circular-type');
  });
});

describe('jsonTypeOf', () => {
  it('maps built-in types to JSON types', () => {
    const atomic = (builtin: string, extra = {}) => ({ builtin, variety: 'atomic' as const, patterns: [], ...extra });
    expect(jsonTypeOf(atomic('int'))).toBe('integer');
    expect(jsonTypeOf(atomic('decimal'))).toBe('number');
    expect(jsonTypeOf(atomic('decimal', { fractionDigits: 0 }))).toBe('integer');
    expect(jsonTypeOf(atomic('boolean'))).toBe('boolean');
    expect(jsonTypeOf(atomic('date'))).toBe('string');
  });

  it('keeps a union of integers and numbers numeric', () => {
    const atomic = (builtin: string) => ({ builtin, variety: 'atomic' as const, patterns: [] });
    const union = (...members: string[]) => ({
      builtin: 'anySimpleType',
      variety: 'union' as const,
      patterns: [],
      members: members.map(atomic),
    });
    expect(jsonTypeOf(union('integer', 'decimal'))).toBe('number');
    expect(jsonTypeOf(union('int', 'long'))).toBe('integer');
    expect(jsonTypeOf(union('integer', 'date'))).toBe('string');
    expect(jsonTypeOf(union())).toBe('string');
  });
});
