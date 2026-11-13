import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import type { ValueContext, ValueSource } from '../values/source.js';
import { serializeXml } from '../xml/serialize.js';
import { Problems } from '../xsd/problems.js';
import { SchemaSet, XS, xsChildren } from '../xsd/schema-set.js';
import {
  type ChoiceSettings,
  expectedSize,
  firstBranch,
  optionalWeight,
  preferBranches,
  randomBranch,
  reachableChoices,
  smallestBranch,
  type WalkOptions,
  Walker,
} from './walker.js';

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

describe('Walker: what a value source learns', () => {
  /** Runs the walker and returns, for each value asked for, its path and what the context says about it. */
  function asked(body: string, options: Partial<WalkOptions> = {}) {
    const contexts: ValueContext[] = [];
    walk(body, { values: { value: (context) => (contexts.push(context), '1') }, ...options });
    return contexts.map((c) => ({
      path: c.path.join('/'),
      typeName: c.typeName,
      baseTypeNames: c.baseTypeNames,
      scopes: c.scopes?.map((s) => `${s.name}#${s.instanceId}`),
    }));
  }

  it('names the type of a value and the types it derives from, nearest first', () => {
    const body = `<xs:element name="R"><xs:complexType><xs:sequence>
        <xs:element name="a" type="Code"/>
        <xs:element name="b"><xs:simpleType><xs:restriction base="Code"><xs:maxLength value="3"/></xs:restriction></xs:simpleType></xs:element>
        <xs:element name="c" type="xs:string"/>
        <xs:element name="d" type="Money"/>
      </xs:sequence><xs:attribute name="e" type="Narrow" use="required"/></xs:complexType></xs:element>
      <xs:simpleType name="Base"><xs:restriction base="xs:token"/></xs:simpleType>
      <xs:simpleType name="Code"><xs:restriction base="Base"/></xs:simpleType>
      <xs:simpleType name="Narrow"><xs:restriction base="Code"><xs:length value="1"/></xs:restriction></xs:simpleType>
      <xs:complexType name="Money"><xs:simpleContent><xs:extension base="Amount"/></xs:simpleContent></xs:complexType>
      <xs:simpleType name="Amount"><xs:restriction base="xs:decimal"/></xs:simpleType>`;
    const types = asked(body).map(({ path, typeName, baseTypeNames }) => ({ path, typeName, baseTypeNames }));
    expect(types).toEqual([
      { path: 'R/e', typeName: '{urn:t}Narrow', baseTypeNames: ['{urn:t}Code', '{urn:t}Base'] },
      { path: 'R/a', typeName: '{urn:t}Code', baseTypeNames: ['{urn:t}Base'] },
      { path: 'R/b', typeName: undefined, baseTypeNames: ['{urn:t}Code', '{urn:t}Base'] },
      { path: 'R/c', typeName: undefined, baseTypeNames: [] },
      { path: 'R/d', typeName: '{urn:t}Money', baseTypeNames: ['{urn:t}Amount'] },
    ]);
  });

  it('gives each occurrence of an element of complex type its own scope', () => {
    const body = `<xs:element name="R"><xs:complexType><xs:sequence>
        <xs:element name="P" maxOccurs="2"><xs:complexType><xs:sequence>
          <xs:element name="n" type="xs:string"/></xs:sequence>
          <xs:attribute name="id" type="xs:string" use="required"/></xs:complexType></xs:element>
        <xs:element name="t" type="xs:string"/>
      </xs:sequence></xs:complexType></xs:element>`;
    expect(asked(body, { repeat: 2 }).map(({ path, scopes }) => ({ path, scopes }))).toEqual([
      { path: 'R/P/id', scopes: ['R#1', 'P#2'] },
      { path: 'R/P/n', scopes: ['R#1', 'P#2'] },
      { path: 'R/P/id', scopes: ['R#1', 'P#3'] },
      { path: 'R/P/n', scopes: ['R#1', 'P#3'] },
      { path: 'R/t', scopes: ['R#1'] },
    ]);
  });
});

/** The schema set and the branches of the first xs:choice in R's content. */
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
