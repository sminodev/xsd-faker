import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { Problems } from '../xsd/problems.js';
import { SchemaSet, XS, xsChildren } from '../xsd/schema-set.js';
import { type ChoiceSettings, expectedSize, optionalWeight, reachableChoices, smallestBranch } from './choices.js';

function choiceOf(body: string) {
  const set = new SchemaSet(
    {
      'a.xsd': `<xs:schema xmlns:xs="${XS}" xmlns="urn:t" targetNamespace="urn:t" elementFormDefault="qualified">${body}</xs:schema>`,
    },
    new Problems(),
  );
  set.load('a.xsd');
  const choice = set.documents.get('a.xsd')?.root.getElementsByTagNameNS(XS, 'choice')[0];
  if (!choice) throw new Error('no choice');
  return { set, choice, branches: xsChildren(choice) };
}

const settings = (overrides: Partial<ChoiceSettings> = {}): ChoiceSettings => ({
  optionalElements: 'none',
  repeat: 1,
  maxDepth: 12,
  maxTotalDepth: 64,
  ...overrides,
});

describe('smallest: expected output', () => {
  const BRANCHES = `<xs:element name="R"><xs:complexType><xs:choice>
      <xs:element name="A"><xs:complexType><xs:sequence>
        <xs:element name="a1" type="xs:string"/><xs:element name="a2" type="xs:string"/>
      </xs:sequence></xs:complexType></xs:element>
      <xs:element name="B"><xs:complexType><xs:sequence>
        <xs:element name="b" type="xs:string"/><xs:group ref="Extras" minOccurs="0"/>
      </xs:sequence></xs:complexType></xs:element>
    </xs:choice></xs:complexType></xs:element>
    <xs:group name="Extras"><xs:sequence>
      <xs:element name="o1" type="xs:string"/><xs:element name="o2" type="xs:string"/><xs:element name="o3" type="xs:string"/>
    </xs:sequence></xs:group>`;

  it('weighs optional particles with the optional-element setting', () => {
    expect([optionalWeight('none'), optionalWeight('random'), optionalWeight('all')]).toEqual([0, 0.5, 1]);
    const { set, branches } = choiceOf(BRANCHES);
    const sizes = (mode: 'none' | 'random' | 'all') =>
      branches.map((b) => expectedSize(set, b, 0, settings({ optionalElements: mode })));
    expect(sizes('none')).toEqual([3, 2]);
    expect(sizes('random')).toEqual([3, 3.5]);
    expect(sizes('all')).toEqual([3, 5]);
  });

  it('picks the branch with the smallest expected output, the first one on a tie', () => {
    const { set, choice, branches } = choiceOf(BRANCHES);
    const pick = (overrides: Partial<ChoiceSettings>) =>
      smallestBranch({
        node: choice,
        branches,
        path: ['R'],
        set,
        rng: createRng(1),
        depth: 0,
        settings: settings(overrides),
      });
    expect(pick({ optionalElements: 'none' })).toBe(1);
    expect(pick({ optionalElements: 'all' })).toBe(0);
    // Without settings in the context only required content counts.
    expect(smallestBranch({ node: choice, branches, path: ['R'], set, rng: createRng(1) })).toBe(1);
  });

  it('counts no optional content from maxDepth on, and required recursion as infinite', () => {
    const { set, branches } = choiceOf(`<xs:element name="R"><xs:complexType><xs:choice>
        <xs:element name="Opt" type="Node"/><xs:element name="Req" type="Loop"/>
      </xs:choice></xs:complexType></xs:element>
      <xs:complexType name="Node"><xs:sequence><xs:element name="child" type="Node" minOccurs="0"/></xs:sequence></xs:complexType>
      <xs:complexType name="Loop"><xs:sequence><xs:element name="next" type="Loop"/></xs:sequence></xs:complexType>`);
    const [opt, req] = branches;
    if (!opt || !req) throw new Error('branches');
    expect(expectedSize(set, opt, 0, settings({ optionalElements: 'all', maxDepth: 3 }))).toBe(3);
    expect(expectedSize(set, opt, 2, settings({ optionalElements: 'all', maxDepth: 3 }))).toBe(1);
    expect(expectedSize(set, req, 0, settings({ optionalElements: 'all' }))).toBe(Infinity);
  });

  it('clamps repeat to the occurrence bounds', () => {
    const { set, branches } = choiceOf(`<xs:element name="R"><xs:complexType><xs:choice>
        <xs:element name="A" minOccurs="2" maxOccurs="4" type="xs:string"/>
      </xs:choice></xs:complexType></xs:element>`);
    const [a] = branches;
    if (!a) throw new Error('branch');
    expect([1, 3, 9].map((repeat) => expectedSize(set, a, 0, settings({ repeat })))).toEqual([2, 3, 4]);
  });
});

describe('reachableChoices', () => {
  it('finds nested choices through types and groups, optional ones only when asked', () => {
    const { set, branches } = choiceOf(`<xs:element name="R"><xs:complexType><xs:choice>
        <xs:element name="A" type="xs:string"/>
        <xs:element name="B" type="Inner"/>
      </xs:choice></xs:complexType></xs:element>
      <xs:complexType name="Inner"><xs:sequence>
        <xs:group ref="G"/>
        <xs:choice minOccurs="0"><xs:element name="p" type="xs:string"/><xs:element name="q" type="xs:string"/></xs:choice>
      </xs:sequence></xs:complexType>
      <xs:group name="G"><xs:choice><xs:element name="x" type="xs:string"/><xs:element name="y" type="xs:string"/></xs:choice></xs:group>`);
    const [a, b] = branches;
    if (!a || !b) throw new Error('branches');
    expect(reachableChoices(set, a, true)).toEqual([]);
    expect(reachableChoices(set, b, false)).toHaveLength(1);
    expect(reachableChoices(set, b, true)).toHaveLength(2);
  });
});
