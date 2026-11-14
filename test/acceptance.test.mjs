import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defineLocale,
  generateSample,
  generateSamples,
  listRoots,
  localeFromFaker,
  localeValues,
  toJson,
  validateXml as validator,
} from '../dist/index.js';
import { generateSampleFile } from '../dist/node.js';
import { run } from '../dist/cli.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const order = join(root, 'examples/retail/order.xsd');
const schema = (body, attributes = '') =>
  `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" ${attributes}>${body}</xs:schema>`;
const input = (body, attributes) => ({ entry: 'a.xsd', files: { 'a.xsd': schema(body, attributes) } });
const simple = input('<xs:element name="Count" type="xs:int"/>');
const options = { validator, attempts: 1 };
const generated = (body, settings = {}, attributes) =>
  generateSample(input(body, attributes), { ...options, ...settings });
const okay = (sample) => {
  assert.equal(
    sample.status,
    'valid',
    JSON.stringify({ errors: sample.errors, problems: sample.problems, xml: sample.xml }),
  );
  assert.equal(sample.valid, true);
};
const values = { value: () => 'Test' };
/** Compact JSON objects have no prototype; `deepEqual` compares against ordinary ones. */
const plain = (json) => JSON.parse(JSON.stringify(json));
const model = `<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="Required" type="xs:string"/><xs:element name="Optional" type="xs:string" minOccurs="0"/></xs:sequence><xs:attribute name="mandatory" type="xs:string" use="required"/><xs:attribute name="optional" type="xs:string"/></xs:complexType></xs:element>`;
const choice = `<xs:element name="Root"><xs:complexType><xs:choice><xs:element name="First" type="xs:string"/><xs:element name="Second" type="xs:string"/><xs:element name="Third" type="xs:string"/></xs:choice></xs:complexType></xs:element>`;

for (const optional of ['none', 'all', 'random'])
  for (const seed of [1, 2, 7, 42, 101]) {
    test(`multi-file order / ${optional} / seed ${seed}`, async () => {
      const sample = await generateSampleFile(order, { ...options, seed, optional, repeat: 2, choice: 'random' });
      okay(sample);
      assert.equal(sample.jsonStatus, 'generated');
      assert.ok(Array.isArray(sample.json.Line));
    });
  }
test('reproducibility includes XML, JSON and branch trace', async () => {
  const a = await generateSampleFile(order, {
    ...options,
    seed: 27,
    optional: 'all',
    locale: 'de',
    referenceDate: '2026-01-15T12:00:00Z',
  });
  const b = await generateSampleFile(order, {
    ...options,
    seed: 27,
    optional: 'all',
    locale: 'de',
    referenceDate: '2026-01-15T12:00:00Z',
  });
  okay(a);
  assert.deepEqual(a, b);
});
test('root discovery lists imported roots without choosing them implicitly', async () => {
  const files = {
    'a.xsd': schema(
      '<xs:import namespace="urn:b" schemaLocation="b.xsd"/><xs:element name="One" type="xs:string"/><xs:element name="Two" type="xs:string"/>',
    ),
    'b.xsd': schema('<xs:element name="Other" type="xs:string"/>', 'targetNamespace="urn:b"'),
  };
  const found = listRoots({ files, entry: 'a.xsd' });
  assert.equal(found.roots.length, 3);
  assert.equal(found.roots.filter((r) => r.entryDocument).length, 2);
  await assert.rejects(generateSample({ files, entry: 'a.xsd' }, options), /choose a global root/);
  okay(await generateSample({ files, entry: 'a.xsd' }, { ...options, root: 'Two' }));
});
for (const rootName of ['Root', 't:Root', '{urn:test}Root'])
  test(`root name ${rootName}`, async () => {
    okay(
      await generated(
        '<xs:element name="Root" type="xs:string"/>',
        { root: rootName },
        'targetNamespace="urn:test" xmlns:t="urn:test"',
      ),
    );
  });
test('optional elements and attributes are independent', async () => {
  const a = await generated(model, { optionalElements: 'all', optionalAttributes: 'none', values });
  okay(a);
  assert.match(a.xml, /<Optional>/);
  assert.doesNotMatch(a.xml, / optional=/);
  const b = await generated(model, { optionalElements: 'none', optionalAttributes: 'all', values });
  okay(b);
  assert.doesNotMatch(b.xml, /<Optional>/);
  assert.match(b.xml, / optional=/);
});
test('repeat is respected even when optional nodes are excluded', async () => {
  const sample = await generated(
    '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="Item" type="xs:int" minOccurs="2" maxOccurs="4"/></xs:sequence></xs:complexType></xs:element>',
    { repeat: 3 },
  );
  okay(sample);
  assert.equal(sample.json.Item.length, 3);
});
for (const [repeat, expected] of [
  [1, 2],
  [10, 4],
])
  test(`repeat ${repeat} is clamped to ${expected}`, async () => {
    const sample = await generated(
      '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="Item" type="xs:int" minOccurs="2" maxOccurs="4"/></xs:sequence></xs:complexType></xs:element>',
      { repeat },
    );
    okay(sample);
    assert.equal(sample.json.Item.length, expected);
  });
test('one occurrence of a repeated group remains an array in JSON', async () => {
  const sample = await generated(
    '<xs:element name="Root"><xs:complexType><xs:sequence maxOccurs="3"><xs:element name="Code" type="xs:string"/></xs:sequence></xs:complexType></xs:element>',
    { values },
  );
  okay(sample);
  assert.deepEqual(plain(sample.json), { '#sequence': [{ Code: 'Test' }] });
});
const typed = { value: ({ name }) => (name === 'a' ? '1' : 'x') };
const pair = '<xs:element name="a" type="xs:int"/><xs:element name="b" type="xs:string"/>';
test('a repeated sequence keeps the elements of each occurrence together', async () => {
  const sample = await generated(
    `<xs:element name="R"><xs:complexType><xs:sequence maxOccurs="3">${pair}</xs:sequence></xs:complexType></xs:element>`,
    { repeat: 2, values: typed },
  );
  okay(sample);
  assert.match(sample.xml, /<a>1<\/a>\s*<b>x<\/b>\s*<a>1<\/a>\s*<b>x<\/b>/);
  assert.deepEqual(plain(sample.json), {
    '#sequence': [
      { a: 1, b: 'x' },
      { a: 1, b: 'x' },
    ],
  });
});
test('a repeated choice writes each occurrence as its own branch', async () => {
  let turn = 0;
  const sample = await generated(
    '<xs:element name="R"><xs:complexType><xs:choice maxOccurs="3"><xs:element name="a" type="xs:int"/><xs:element name="b" type="xs:string"/></xs:choice></xs:complexType></xs:element>',
    { repeat: 3, values: typed, choice: () => turn++ % 2 },
  );
  okay(sample);
  assert.deepEqual(plain(sample.json), { '#choice': [{ a: 1 }, { b: 'x' }, { a: 1 }] });
});
test('repeated groups nest and group references use their name', async () => {
  const sample = await generated(
    `<xs:group name="Pair"><xs:sequence>${pair}</xs:sequence></xs:group><xs:element name="R"><xs:complexType><xs:sequence maxOccurs="2"><xs:element name="h" type="xs:string"/><xs:group ref="Pair" maxOccurs="2"/></xs:sequence></xs:complexType></xs:element>`,
    { repeat: 2, values: typed },
  );
  okay(sample);
  const inner = [
    { a: 1, b: 'x' },
    { a: 1, b: 'x' },
  ];
  assert.deepEqual(plain(sample.json), {
    '#sequence': [
      { h: 'x', '#Pair': inner },
      { h: 'x', '#Pair': inner },
    ],
  });
});
test('property names of repeated groups do not depend on the branch taken', async () => {
  const body =
    '<xs:element name="R"><xs:complexType><xs:choice><xs:sequence maxOccurs="2"><xs:element name="a" type="xs:int"/></xs:sequence><xs:sequence maxOccurs="2"><xs:element name="b" type="xs:string"/></xs:sequence></xs:choice></xs:complexType></xs:element>';
  const first = await generated(body, { values: typed });
  okay(first);
  assert.deepEqual(plain(first.json), { '#sequence': [{ a: 1 }] });
  const second = await generated(body, { values: typed, choice: { prefer: ['b'] } });
  okay(second);
  assert.deepEqual(plain(second.json), { '#sequence:2': [{ b: 'x' }] });
});
test('an extension continues the numbering of the repeated groups of its base', async () => {
  const sample = await generated(
    '<xs:complexType name="Base"><xs:sequence maxOccurs="2"><xs:element name="a" type="xs:int"/></xs:sequence></xs:complexType><xs:complexType name="Sub"><xs:complexContent><xs:extension base="Base"><xs:sequence maxOccurs="2"><xs:element name="b" type="xs:string"/></xs:sequence></xs:extension></xs:complexContent></xs:complexType><xs:element name="R" type="Sub"/>',
    { values: typed },
  );
  okay(sample);
  assert.deepEqual(plain(sample.json), { '#sequence': [{ a: 1 }], '#sequence:2': [{ b: 'x' }] });
});
test('an occurrence without elements has no item in JSON', async () => {
  const body =
    '<xs:element name="R"><xs:complexType><xs:sequence minOccurs="2" maxOccurs="2"><xs:element name="a" type="xs:int" minOccurs="0"/></xs:sequence></xs:complexType></xs:element>';
  const empty = await generated(body);
  okay(empty);
  assert.deepEqual(plain(empty.json), {});
  const full = await generated(body, { optional: 'all', values: typed });
  okay(full);
  assert.deepEqual(plain(full.json), { '#sequence': [{ a: 1 }, { a: 1 }] });
});
test('a name repeated only by its group is not an array inside the occurrence', async () => {
  const sample = await generated(
    `<xs:element name="R"><xs:complexType><xs:sequence><xs:element name="a" type="xs:int"/><xs:sequence maxOccurs="2">${pair}</xs:sequence></xs:sequence></xs:complexType></xs:element>`,
    { values: typed },
  );
  okay(sample);
  assert.deepEqual(plain(sample.json), { a: 1, '#sequence': [{ a: 1, b: 'x' }] });
});
test('two references to one group share its property', async () => {
  const sample = await generated(
    `<xs:group name="Pair"><xs:sequence>${pair}</xs:sequence></xs:group><xs:element name="R"><xs:complexType><xs:sequence><xs:group ref="Pair" maxOccurs="2"/><xs:element name="s" type="xs:string"/><xs:group ref="Pair" maxOccurs="2"/></xs:sequence></xs:complexType></xs:element>`,
    { values: typed },
  );
  okay(sample);
  assert.deepEqual(plain(sample.json), {
    '#Pair': [
      { a: 1, b: 'x' },
      { a: 1, b: 'x' },
    ],
    s: 'x',
  });
});
test('collisions inside an occurrence get expanded keys; unsafe numbers there are refused', async () => {
  const p = schema('<xs:element name="a" type="xs:string"/>', 'targetNamespace="urn:p"');
  const main = schema(
    '<xs:import namespace="urn:p" schemaLocation="p.xsd"/><xs:element name="R"><xs:complexType><xs:sequence maxOccurs="2"><xs:element name="a" type="xs:string"/><xs:element ref="p:a"/></xs:sequence></xs:complexType></xs:element>',
    'xmlns:p="urn:p"',
  );
  const clash = await generateSample(
    { entry: 'a.xsd', files: { 'a.xsd': main, 'p.xsd': p } },
    { ...options, root: 'R' },
  );
  okay(clash);
  assert.equal(clash.jsonStatus, 'generated');
  assert.deepEqual(Object.keys(clash.json['#sequence'][0]), ['{}a', '{urn:p}a']);
  const unsafe = await generated(
    '<xs:element name="R"><xs:complexType><xs:sequence maxOccurs="2"><xs:element name="n" type="xs:long" fixed="9223372036854775807"/></xs:sequence></xs:complexType></xs:element>',
  );
  okay(unsafe);
  assert.equal(unsafe.jsonStatus, 'unavailable');
});
const priced = (attribute) =>
  `<xs:complexType name="Amount"><xs:simpleContent><xs:extension base="xs:decimal">${attribute}</xs:extension></xs:simpleContent></xs:complexType><xs:element name="R"><xs:complexType><xs:sequence><xs:element name="Price" type="Amount"/></xs:sequence></xs:complexType></xs:element>`;
test('simple content is an object even without attributes', async () => {
  const optional = priced('<xs:attribute name="currency" type="xs:string"/>');
  for (const optionalAttributes of ['none', 'all', 'random'])
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sample = await generated(optional, { optionalAttributes, seed });
      okay(sample);
      assert.equal(typeof sample.json.Price, 'object');
      assert.equal(typeof sample.json.Price.value, 'number');
    }
  const none = await generated(priced(''));
  okay(none);
  assert.equal(typeof none.json.Price.value, 'number');
});
test('a union of integers and decimals is a number', async () => {
  const sample = await generated(
    '<xs:simpleType name="U"><xs:union memberTypes="xs:integer xs:decimal"/></xs:simpleType><xs:element name="R" type="U"/>',
  );
  okay(sample);
  assert.equal(typeof sample.json, 'number');
});
for (const type of ['long', 'unsignedLong'])
  test(`xs:${type} has JSON by default`, async () => {
    const body = `<xs:element name="R" type="xs:${type}"/>`;
    for (let seed = 1; seed <= 40; seed += 1) {
      const sample = await generated(body, { seed });
      okay(sample);
      assert.equal(sample.jsonStatus, 'generated');
      assert.ok(Number.isSafeInteger(sample.json));
    }
  });
for (const [min, max] of [
  ['0.123', '0.124'],
  ['0.123456', '0.123457'],
])
  test(`decimal bounds ${min}..${max} get the fraction digits they need`, async () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const sample = await generated(
        `<xs:element name="R"><xs:simpleType><xs:restriction base="xs:decimal"><xs:minInclusive value="${min}"/><xs:maxInclusive value="${max}"/></xs:restriction></xs:simpleType></xs:element>`,
        { seed },
      );
      okay(sample);
      assert.equal(sample.jsonStatus, 'generated');
    }
  });
test('a missing value is not reported as a rounding problem', async () => {
  const sample = await generated(
    '<xs:element name="R"><xs:simpleType><xs:restriction base="xs:decimal"><xs:fractionDigits value="1"/><xs:minInclusive value="0.123"/><xs:maxInclusive value="0.124"/></xs:restriction></xs:simpleType></xs:element>',
  );
  assert.equal(sample.status, 'incomplete');
  assert.ok(sample.problems.some((p) => p.code === 'no-value'));
  assert.ok(!sample.problems.some((p) => /without changing its decimal value/.test(p.message)));
});
for (const [facet, value, tokens] of [
  ['maxLength', 5, (n) => n >= 1 && n <= 5],
  ['length', 2, (n) => n === 2],
  ['length', 11, (n) => n === 11],
  ['minLength', 3, (n) => n >= 3],
])
  test(`xs:NMTOKENS ${facet}=${value} counts items`, async () => {
    const sample = await generated(
      `<xs:element name="R"><xs:simpleType><xs:restriction base="xs:NMTOKENS"><xs:${facet} value="${value}"/></xs:restriction></xs:simpleType></xs:element>`,
    );
    okay(sample);
    // A list is a JSON array of its items, one string per NMTOKEN.
    assert.ok(Array.isArray(sample.json) && tokens(sample.json.length), JSON.stringify(sample.json));
    assert.deepEqual(sample.json, sample.xml.match(/<R>([^<]*)<\/R>/)[1].split(' '));
  });
for (const [facet, value, length] of [
  ['maxLength', 10, (n) => n <= 10],
  ['minLength', 30, (n) => n >= 30],
  ['length', 15, (n) => n === 15],
  ['length', 26, (n) => n === 26],
])
  test(`xs:anyURI respects ${facet}=${value}`, async () => {
    const sample = await generated(
      `<xs:element name="R"><xs:simpleType><xs:restriction base="xs:anyURI"><xs:${facet} value="${value}"/></xs:restriction></xs:simpleType></xs:element>`,
    );
    okay(sample);
    assert.ok(length(sample.json.length), sample.json);
  });
const common = 'xmlns:c="urn:common"';
const refElement = (decl) =>
  `<xs:element name="R"><xs:complexType><xs:sequence>${decl}</xs:sequence></xs:complexType></xs:element>`;
for (const [label, decl] of [
  ['fixed', '<xs:element name="Ref" type="xs:QName" fixed="c:Target"/>'],
  ['default', '<xs:element name="Ref" type="xs:QName" default="c:Target"/>'],
  [
    'enumeration',
    '<xs:element name="Ref"><xs:simpleType><xs:restriction base="xs:QName"><xs:enumeration value="c:Target"/></xs:restriction></xs:simpleType></xs:element>',
  ],
  [
    'list',
    '<xs:element name="Ref" fixed="c:One c:Two"><xs:simpleType><xs:list itemType="xs:QName"/></xs:simpleType></xs:element>',
  ],
])
  test(`a QName ${label} value declares its prefix`, async () => {
    const sample = await generated(refElement(decl), {}, common);
    okay(sample);
    assert.match(sample.xml, /xmlns:c="urn:common"/);
  });
test('a QName attribute value declares its prefix', async () => {
  const sample = await generated(
    '<xs:element name="R"><xs:complexType><xs:attribute name="ref" type="xs:QName" fixed="c:Target" use="required"/></xs:complexType></xs:element>',
    {},
    common,
  );
  okay(sample);
  assert.match(sample.xml, /xmlns:c="urn:common"/);
});
test('a pattern on a union is met', async () => {
  for (let seed = 1; seed <= 10; seed += 1) {
    const sample = await generated(
      '<xs:simpleType name="U"><xs:union memberTypes="xs:string xs:integer"/></xs:simpleType><xs:simpleType name="P"><xs:restriction base="U"><xs:pattern value="[A-Z]{3}"/></xs:restriction></xs:simpleType><xs:element name="R" type="P"/>',
      { seed },
    );
    okay(sample);
    assert.match(sample.json, /^[A-Z]{3}$/);
  }
});
test('an untyped element writes its fixed value', async () => {
  const sample = await generated(
    '<xs:element name="R"><xs:complexType><xs:sequence><xs:element name="Mode" fixed="AUTO"/></xs:sequence></xs:complexType></xs:element>',
  );
  okay(sample);
  assert.equal(plain(sample.json).Mode, 'AUTO');
});
test('mixed content with a fixed value holds that text', async () => {
  const sample = await generated(
    '<xs:element name="R" fixed="AUTO"><xs:complexType mixed="true"><xs:sequence><xs:element name="b" type="xs:string" minOccurs="0"/></xs:sequence></xs:complexType></xs:element>',
  );
  okay(sample);
  assert.equal(plain(sample.json).value, 'AUTO');
});
test('an element of an abstract type is reported before validation', async () => {
  const sample = await generated(
    '<xs:complexType name="Shape" abstract="true"><xs:sequence><xs:element name="id" type="xs:string"/></xs:sequence></xs:complexType><xs:element name="R" type="Shape"/>',
  );
  assert.equal(sample.status, 'incomplete');
  assert.ok(sample.problems.some((p) => p.code === 'unsupported' && /abstract type Shape/.test(p.message)));
});
test('mixed content keeps the prefixes of the XML', async () => {
  const sample = await generated(
    '<xs:element name="R"><xs:complexType mixed="true"><xs:sequence><xs:element name="b" type="xs:string"/></xs:sequence></xs:complexType></xs:element>',
    { values, prefixes: { 'urn:t': 't' } },
    'targetNamespace="urn:t" elementFormDefault="qualified"',
  );
  okay(sample);
  assert.match(sample.xml, /<R xmlns="urn:t">/);
  assert.match(sample.json.value, /<b xmlns="urn:t">Test<\/b>/);
});
test('tree JSON records the occurrence of each element', async () => {
  const sample = await generated(
    `<xs:element name="R"><xs:complexType><xs:sequence maxOccurs="2">${pair}</xs:sequence></xs:complexType></xs:element>`,
    { repeat: 2, json: { mode: 'tree' } },
  );
  okay(sample);
  assert.deepEqual(
    sample.json.children.map((child) => child.groups),
    [1, 1, 2, 2].map((occurrence) => [{ key: '#sequence', occurrence }]),
  );
});
test('choice first and preferred choose a single branch', async () => {
  const a = await generated(choice);
  okay(a);
  assert.match(a.xml, /<First>/);
  assert.doesNotMatch(a.xml, /<Second>/);
  const b = await generated(choice, { choice: { prefer: ['Third'] } });
  okay(b);
  assert.match(b.xml, /<Third>/);
});
test('smallest branch resolves descendants rather than only immediate children', async () => {
  const body =
    '<xs:element name="Root"><xs:complexType><xs:choice><xs:element name="Large"><xs:complexType><xs:sequence><xs:element name="A" type="xs:string"/><xs:element name="B" type="xs:string"/></xs:sequence></xs:complexType></xs:element><xs:element name="Small" type="xs:string"/></xs:choice></xs:complexType></xs:element>';
  const sample = await generated(body, { choice: 'smallest' });
  okay(sample);
  assert.match(sample.xml, /<Small>/);
  assert.doesNotMatch(sample.xml, /<Large>/);
});
const strings = (names, optional = false) =>
  names.map((n) => `<xs:element name="${n}" type="xs:string"${optional ? ' minOccurs="0"' : ''}/>`).join('');
const branch = (name, required, optional = []) =>
  `<xs:element name="${name}"><xs:complexType><xs:sequence>${strings(required)}${strings(optional, true)}</xs:sequence></xs:complexType></xs:element>`;
const rootChoice = (...branches) =>
  `<xs:element name="Root"><xs:complexType><xs:choice>${branches.join('')}</xs:choice></xs:complexType></xs:element>`;
const taken = (sample) => sample.xml.match(/<Root>\s*<(\w+)/)?.[1];
test('smallest counts optional content as the optional-element setting generates it', async () => {
  // A: 2 required children. B: 1 required child and 5 optional ones.
  const body = rootChoice(branch('A', ['a1', 'a2']), branch('B', ['b1'], ['o1', 'o2', 'o3', 'o4', 'o5']));
  const all = await generated(body, { choice: 'smallest', optional: 'all' });
  okay(all);
  assert.equal(taken(all), 'A');
  const none = await generated(body, { choice: 'smallest', optional: 'none' });
  okay(none);
  assert.equal(taken(none), 'B');
});
test('smallest weighs optional content by half with optional random', async () => {
  // Expected elements with none / random / all: A 1/5/9, B 5/5/5, C 2/4/6.
  const body = rootChoice(
    branch('A', [], ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']),
    branch('B', ['b1', 'b2', 'b3', 'b4']),
    branch('C', ['c1'], ['c2', 'c3', 'c4', 'c5']),
  );
  const expected = { none: 'A', random: 'C', all: 'B' };
  for (const [optional, name] of Object.entries(expected)) {
    for (const seed of [1, 2, 3]) {
      const sample = await generated(body, { choice: 'smallest', optional, seed });
      okay(sample);
      assert.equal(taken(sample), name, `${optional} / seed ${seed}`);
    }
  }
});
test('smallest keeps the first branch on a tie in the expected output', async () => {
  // Both produce two elements under optional all; Second has fewer required children.
  const body = rootChoice(branch('First', ['f1']), branch('Second', [], ['s1']));
  const sample = await generated(body, { choice: 'smallest', optional: 'all' });
  okay(sample);
  assert.equal(taken(sample), 'First');
});
test('smallest follows optional recursion only as deep as generation does', async () => {
  // Rec nests itself optionally: 2 elements per level until maxDepth stops optional content. Flat has 3 elements.
  const body = `<xs:complexType name="T"><xs:sequence><xs:element name="v" type="xs:string"/><xs:element name="Rec" type="T" minOccurs="0"/></xs:sequence></xs:complexType>${rootChoice(
    '<xs:element name="Rec" type="T"/>',
    branch('Flat', ['f1', 'f2']),
  )}`;
  const shallow = await generated(body, { choice: 'smallest', optional: 'all', maxDepth: 1 });
  okay(shallow);
  assert.equal(taken(shallow), 'Rec');
  const deep = await generated(body, { choice: 'smallest', optional: 'all', maxDepth: 3 });
  okay(deep);
  assert.equal(taken(deep), 'Flat');
  const required = await generated(body, { choice: 'smallest', optional: 'none' });
  okay(required);
  assert.equal(taken(required), 'Rec');
});
test('smallest treats required recursion as infinite but optional recursion as finite', async () => {
  const body = `<xs:complexType name="Loop"><xs:sequence><xs:element name="Again" type="Loop"/></xs:sequence></xs:complexType><xs:complexType name="T"><xs:sequence><xs:element name="v" type="xs:string"/><xs:element name="Rec" type="T" minOccurs="0"/></xs:sequence></xs:complexType>${rootChoice(
    '<xs:element name="Again" type="Loop"/>',
    '<xs:element name="Rec" type="T"/>',
  )}`;
  const sample = await generated(body, { choice: 'smallest', optional: 'all' });
  okay(sample);
  assert.equal(taken(sample), 'Rec');
});
test('smallest counts occurrences as repeat requests them, within the XSD bounds', async () => {
  // A: 1 child, repeatable up to 5 times. B: 3 required children.
  const body = rootChoice(
    '<xs:element name="A"><xs:complexType><xs:sequence><xs:element name="a" type="xs:string" maxOccurs="5"/></xs:sequence></xs:complexType></xs:element>',
    branch('B', ['b1', 'b2', 'b3']),
  );
  const once = await generated(body, { choice: 'smallest', repeat: 1 });
  okay(once);
  assert.equal(taken(once), 'A');
  const many = await generated(body, { choice: 'smallest', repeat: 9 });
  okay(many);
  assert.equal(taken(many), 'B');
});
test('all branches require an explicit template request', async () => {
  await assert.rejects(generated(choice, { choice: 'all' }), /requires mode/);
  const sample = await generated(choice, { choice: 'all', mode: 'template' });
  assert.equal(sample.status, 'template');
  assert.equal(sample.valid, undefined);
  for (const name of ['First', 'Second', 'Third']) assert.match(sample.xml, new RegExp(`<${name}>`));
  const [verdict] = await validator({ entry: 'a.xsd', files: new Map(Object.entries(input(choice).files)) }, [
    sample.xml,
  ]);
  assert.equal(verdict.valid, false);
});
test('a template writes one occurrence of a repeated choice per branch, a sequence branch together', async () => {
  const body =
    '<xs:element name="R"><xs:complexType><xs:sequence><xs:choice maxOccurs="unbounded"><xs:element name="a" type="xs:int"/><xs:sequence><xs:element name="b" type="xs:string"/><xs:element name="c" type="xs:string"/></xs:sequence></xs:choice><xs:element name="d" type="xs:string"/></xs:sequence></xs:complexType></xs:element>';
  const sample = await generated(body, { choice: 'all', mode: 'template', values: typed });
  assert.equal(sample.status, 'template');
  assert.deepEqual(plain(sample.json), { '#choice': [{ a: 1 }, { b: 'x', c: 'x' }], d: 'x' });
  const twice = await generated(body, { choice: 'all', mode: 'template', values: typed, repeat: 2 });
  assert.deepEqual(plain(twice.json)['#choice'], [{ a: 1 }, { b: 'x', c: 'x' }, { a: 1 }, { b: 'x', c: 'x' }]);
  // A choice that occurs once still has no group property.
  const once = await generated(choice, { choice: 'all', mode: 'template', values: typed });
  assert.deepEqual(Object.keys(plain(once.json)), ['First', 'Second', 'Third']);
});
test('separate branch samples produce accepted coverage', async () => {
  const batch = await generateSamples(input(choice), { ...options, count: 3, coverage: true });
  batch.samples.forEach(okay);
  assert.equal(batch.coverage.covered, 3);
  assert.equal(batch.coverage.complete, true);
  assert.equal(batch.coverage.scope, 'encountered-choices');
});
test('coverage looks ahead to open branches below an accepted branch', async () => {
  // Only C leads to a further choice. Rotation alone would take A again in the fourth sample.
  const body = rootChoice(
    '<xs:element name="A" type="xs:string"/>',
    '<xs:element name="B" type="xs:string"/>',
    '<xs:element name="C"><xs:complexType><xs:choice><xs:element name="X" type="xs:string"/><xs:element name="Y" type="xs:string"/></xs:choice></xs:complexType></xs:element>',
  );
  const batch = await generateSamples(input(body), { ...options, count: 4, coverage: true });
  batch.samples.forEach(okay);
  assert.deepEqual(batch.samples.map(taken), ['A', 'B', 'C', 'C']);
  assert.equal(batch.coverage.total, 5);
  assert.equal(batch.coverage.complete, true);
  const again = await generateSamples(input(body), { ...options, count: 4, coverage: true });
  assert.deepEqual(
    again.samples.map((s) => s.xml),
    batch.samples.map((s) => s.xml),
  );
});
test('coverage reports bounded incompleteness', async () => {
  const batch = await generateSamples(input(choice), { ...options, count: 1, coverage: true });
  assert.equal(batch.coverage.complete, false);
  assert.equal(batch.coverage.uncovered.length, 2);
});
test('invalid attempts do not count as covered branches', async () => {
  const batch = await generateSamples(input(choice), {
    ...options,
    count: 3,
    coverage: true,
    validator: async () => [{ valid: false, errors: ['rejected'] }],
  });
  assert.equal(batch.coverage.covered, 0);
  assert.equal(batch.coverage.complete, false);
});
const contractList = `<xs:simpleType name="IntList"><xs:list itemType="xs:integer"/></xs:simpleType><xs:simpleType name="Color"><xs:restriction base="xs:token"><xs:enumeration value="red"/><xs:enumeration value="green"/></xs:restriction></xs:simpleType><xs:simpleType name="ColorList"><xs:list itemType="Color"/></xs:simpleType><xs:simpleType name="ShortList"><xs:restriction base="IntList"><xs:minLength value="1"/><xs:maxLength value="3"/></xs:restriction></xs:simpleType><xs:simpleType name="Pair"><xs:restriction base="IntList"><xs:enumeration value="1 2"/><xs:enumeration value="3 4"/></xs:restriction></xs:simpleType><xs:simpleType name="Mixed"><xs:list><xs:simpleType><xs:union memberTypes="xs:int xs:decimal"/></xs:simpleType></xs:list></xs:simpleType><xs:element name="R"><xs:complexType><xs:sequence><xs:element name="Numbers" type="IntList"/><xs:element name="Short" type="ShortList"/><xs:element name="Repeated" type="IntList" maxOccurs="2"/><xs:element name="Tokens" type="xs:NMTOKENS"/><xs:element name="Pick" type="Pair"/><xs:element name="Mixed" type="Mixed"/><xs:element name="Simple"><xs:complexType><xs:simpleContent><xs:extension base="IntList"><xs:attribute name="colors" type="ColorList"/></xs:extension></xs:simpleContent></xs:complexType></xs:element></xs:sequence><xs:attribute name="codes" type="ColorList"/></xs:complexType></xs:element>`;
test('lists are JSON arrays of typed items in elements, attributes, repetitions and simple content', async () => {
  const items = (lexical, type) =>
    lexical
      .trim()
      .split(/\s+/)
      .filter((item) => item !== '')
      .map((item) => (type === 'string' ? item : Number(item)));
  for (const seed of [1, 2, 3, 4, 5]) {
    const sample = await generated(
      contractList,
      { seed, optional: 'all', repeat: 2 },
      'xmlns="urn:v:list" targetNamespace="urn:v:list" elementFormDefault="qualified"',
    );
    okay(sample);
    const xml = (name) =>
      [...sample.xml.matchAll(new RegExp(`<${name}(?: [^>]*)?>([^<]*)</${name}>`, 'g'))].map((m) => m[1]);
    const json = plain(sample.json);
    assert.deepEqual(json.Numbers, items(xml('Numbers')[0], 'integer'));
    assert.deepEqual(json.Short, items(xml('Short')[0], 'integer'));
    assert.deepEqual(
      json.Repeated,
      xml('Repeated').map((v) => items(v, 'integer')),
    );
    assert.equal(json.Repeated.length, 2);
    assert.deepEqual(json.Tokens, items(xml('Tokens')[0], 'string'));
    assert.ok(
      [
        [1, 2],
        [3, 4],
      ].some((pair) => JSON.stringify(pair) === JSON.stringify(json.Pick)),
    );
    // Items of a union of numbers are numbers.
    assert.deepEqual(json.Mixed, items(xml('Mixed')[0], 'number'));
    assert.deepEqual(json.Simple.value, items(xml('Simple')[0], 'integer'));
    assert.deepEqual(json.Simple.colors, items(/colors="([^"]*)"/.exec(sample.xml)[1], 'string'));
    assert.deepEqual(json.codes, items(/codes="([^"]*)"/.exec(sample.xml)[1], 'string'));
  }
});
test('a union with a list member stays a string', async () => {
  const sample = await generated(
    '<xs:simpleType name="L"><xs:list itemType="xs:int"/></xs:simpleType><xs:element name="R"><xs:simpleType><xs:union memberTypes="L xs:boolean"/></xs:simpleType></xs:element>',
    { seed: 3 },
  );
  okay(sample);
  assert.equal(typeof sample.json, 'string');
});
const contractNil = `<xs:element name="R"><xs:complexType><xs:sequence><xs:element name="D" type="xs:date" nillable="true"/><xs:element name="A" nillable="true"><xs:complexType><xs:sequence><xs:element name="Place" type="xs:string"/></xs:sequence><xs:attribute name="kind" type="xs:string" use="required"/></xs:complexType></xs:element><xs:element name="B" nillable="true"><xs:complexType><xs:simpleContent><xs:extension base="xs:decimal"><xs:attribute name="w" type="xs:string"/></xs:extension></xs:simpleContent></xs:complexType></xs:element><xs:element name="K" nillable="true" minOccurs="0"><xs:complexType><xs:sequence><xs:element name="X" type="xs:int"/></xs:sequence></xs:complexType></xs:element><xs:element name="L" type="xs:int" nillable="true" maxOccurs="3"/><xs:element name="F" type="xs:int" nillable="true" fixed="5"/></xs:sequence></xs:complexType></xs:element>`;
const nilNamespace = 'xmlns="urn:v:nil" targetNamespace="urn:v:nil" elementFormDefault="qualified"';
test("nil: 'random' writes nillable elements as nil, valid and with the contract's JSON forms", async () => {
  const seen = new Set();
  for (let seed = 1; seed <= 24; seed += 1) {
    const sample = await generated(contractNil, { seed, nil: 'random', optional: 'random', repeat: 3 }, nilNamespace);
    okay(sample);
    const json = plain(sample.json);
    const nilled = (name) =>
      [...sample.xml.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'g'))].map((m) => m[1].includes('xsi:nil="true"'));
    if (nilled('D')[0]) assert.equal(json.D, null);
    if (nilled('A')[0]) assert.deepEqual(json.A, { kind: json.A.kind, value: null });
    if (nilled('B')[0]) assert.ok(json.B === null || json.B.value === null);
    if (nilled('K')[0]) assert.equal(json.K, null);
    nilled('L').forEach((isNil, i) => assert.equal(json.L[i] === null, isNil));
    for (const name of ['D', 'A', 'B', 'K', 'L']) if (nilled(name).some(Boolean)) seen.add(name);
    // A fixed value excludes nil; a nil element keeps its required attribute and has no content.
    assert.equal(nilled('F')[0], false);
    assert.doesNotMatch(sample.xml, /xsi:nil="true">/);
  }
  assert.deepEqual([...seen].sort(), ['A', 'B', 'D', 'K', 'L']);
});
test("nil: 'never' draws no random numbers and changes nothing", async () => {
  for (const seed of [1, 9]) {
    const settings = { seed, optional: 'random', choice: 'random', repeat: 2 };
    const before = await generated(contractNil, settings, nilNamespace);
    const never = await generated(contractNil, { ...settings, nil: 'never' }, nilNamespace);
    assert.deepEqual(never, before);
    assert.doesNotMatch(never.xml, /xsi:nil/);
  }
  await assert.rejects(generated(contractNil, { nil: 'always' }, nilNamespace), /nil must be never or random/);
});
test('wildcard content follows the schemaless JSON rule: one occurrence is a value, values are strings', async () => {
  const xs = 'xmlns:xs="http://www.w3.org/2001/XMLSchema"';
  const files = {
    'a.xsd': `<xs:schema ${xs} xmlns="urn:v:any" targetNamespace="urn:v:any" elementFormDefault="qualified"><xs:import namespace="urn:foreign" schemaLocation="f.xsd"/><xs:element name="R"><xs:complexType><xs:sequence><xs:element name="Head" type="xs:string"/><xs:element name="Ext"><xs:complexType><xs:sequence><xs:any namespace="##other" processContents="lax" maxOccurs="unbounded"/></xs:sequence></xs:complexType></xs:element><xs:element name="Lokal"><xs:complexType><xs:sequence><xs:element name="any" type="xs:string"/><xs:any namespace="##local" processContents="skip" maxOccurs="2"/></xs:sequence></xs:complexType></xs:element></xs:sequence></xs:complexType></xs:element></xs:schema>`,
    'f.xsd': `<xs:schema ${xs} targetNamespace="urn:foreign"><xs:element name="Count" type="xs:int"/></xs:schema>`,
  };
  const one = await generateSample({ entry: 'a.xsd', files }, { ...options, values: { value: () => '7' } });
  okay(one);
  const json = plain(one.json);
  // The global element of another namespace, typed xs:int in its schema, is a string here and not an array.
  assert.deepEqual(json.Ext, { Count: '7' });
  // The placeholder does not take the declared name `any`.
  assert.deepEqual(json.Lokal, { any: '7', any2: 'any content' });
  const two = await generateSample({ entry: 'a.xsd', files }, { ...options, repeat: 2, values: { value: () => '7' } });
  okay(two);
  assert.deepEqual(plain(two.json).Ext, { Count: ['7', '7'] });
  assert.deepEqual(plain(two.json).Lokal.any2, ['any content', 'any content']);
});
const contractPolymorphism = `<xs:complexType name="DocType"><xs:sequence><xs:element name="Number" type="xs:string"/></xs:sequence></xs:complexType><xs:element name="Document" type="DocType" abstract="true"/><xs:element name="Invoice" substitutionGroup="Document"><xs:complexType><xs:complexContent><xs:extension base="DocType"><xs:sequence><xs:element name="Amount" type="xs:decimal"/></xs:sequence></xs:extension></xs:complexContent></xs:complexType></xs:element><xs:element name="Credit" type="DocType" substitutionGroup="Document"/><xs:complexType name="Vehicle" abstract="true"><xs:sequence><xs:element name="Plate" type="xs:string"/></xs:sequence></xs:complexType><xs:complexType name="Car"><xs:complexContent><xs:extension base="Vehicle"><xs:sequence><xs:element name="Seats" type="xs:int"/></xs:sequence></xs:extension></xs:complexContent></xs:complexType><xs:complexType name="Animal"><xs:sequence><xs:element name="Name" type="xs:string"/></xs:sequence></xs:complexType><xs:complexType name="Dog"><xs:complexContent><xs:extension base="Animal"><xs:sequence><xs:element name="Breed" type="xs:string" minOccurs="0"/></xs:sequence></xs:extension></xs:complexContent></xs:complexType><xs:element name="R"><xs:complexType><xs:sequence><xs:element ref="Document" maxOccurs="2"/><xs:element name="Vehicle" type="Vehicle"/><xs:element name="Pet" type="Animal" maxOccurs="2"/><xs:element name="Count" type="xs:decimal"/><xs:element name="Price" type="Amount" minOccurs="0"/></xs:sequence></xs:complexType></xs:element><xs:complexType name="Amount"><xs:simpleContent><xs:extension base="xs:decimal"><xs:attribute name="currency" type="xs:string" use="required"/></xs:extension></xs:simpleContent></xs:complexType><xs:complexType name="EuroAmount"><xs:simpleContent><xs:extension base="Amount"><xs:attribute name="source" type="xs:string"/></xs:extension></xs:simpleContent></xs:complexType>`;
const subNamespace = 'xmlns="urn:v:sub" targetNamespace="urn:v:sub" elementFormDefault="qualified"';
test('substitution group members and xsi:type alternatives are chosen like branches and counted in coverage', async () => {
  const batch = await generateSamples(input(contractPolymorphism, subNamespace), {
    ...options,
    root: 'R',
    count: 3,
    coverage: true,
    optional: 'all',
  });
  batch.samples.forEach(okay);
  const members = new Set();
  const pets = new Set();
  const prices = new Set();
  for (const sample of batch.samples) {
    const json = plain(sample.json);
    // The abstract head and the abstract type never occur; Car, the only concrete type, needs no decision.
    assert.doesNotMatch(sample.xml, /<(\w+:)?Document\b/);
    const prefix = /xmlns:(\w+)="urn:v:sub"/.exec(sample.xml)[1];
    assert.match(sample.xml, new RegExp(`<Vehicle xsi:type="${prefix}:Car">`));
    assert.equal(json.Vehicle['#type'], '{urn:v:sub}Car');
    for (const name of ['Invoice', 'Credit']) {
      if (json[name] === undefined) continue;
      members.add(name);
      assert.ok(Array.isArray(json[name]));
    }
    for (const pet of json.Pet) pets.add(pet['#type'] ?? 'Animal');
    // A simple type keeps a plain value; simple content with xsi:type has #type, attributes and value.
    assert.equal(typeof json.Count, 'number');
    assert.doesNotMatch(sample.xml, /<Count xsi:type/);
    prices.add(json.Price['#type'] ?? 'Amount');
    assert.equal(typeof json.Price.value, 'number');
    assert.equal(typeof json.Price.currency, 'string');
  }
  assert.deepEqual([...prices].sort(), ['Amount', '{urn:v:sub}EuroAmount']);
  assert.deepEqual([...members].sort(), ['Credit', 'Invoice']);
  assert.deepEqual([...pets].sort(), ['Animal', '{urn:v:sub}Dog']);
  assert.equal(batch.coverage.total, 6);
  assert.equal(batch.coverage.complete, true);
  const one = await generateSamples(input(contractPolymorphism, subNamespace), {
    ...options,
    root: 'R',
    count: 1,
    coverage: true,
  });
  assert.deepEqual(
    one.coverage.uncovered.map(({ kind, alternative }) => [kind, alternative]),
    [
      ['substitution', '{urn:v:sub}Credit'],
      ['type', '{urn:v:sub}Dog'],
    ],
  );
});
const derived = `<xs:complexType name="T"><xs:sequence><xs:element name="a" type="xs:string"/><xs:element name="b" type="xs:string" minOccurs="0"/></xs:sequence></xs:complexType><xs:complexType name="Ext"><xs:complexContent><xs:extension base="T"><xs:sequence><xs:element name="e" type="xs:string"/></xs:sequence></xs:extension></xs:complexContent></xs:complexType><xs:complexType name="Res"><xs:complexContent><xs:restriction base="T"><xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence></xs:restriction></xs:complexContent></xs:complexType><xs:complexType name="Closed" block="#all"><xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence></xs:complexType><xs:complexType name="Opened"><xs:complexContent><xs:extension base="Closed"><xs:sequence><xs:element name="o" type="xs:string"/></xs:sequence></xs:extension></xs:complexContent></xs:complexType><xs:element name="H" type="T" block="extension"/><xs:element name="HM" type="Ext" substitutionGroup="H"/><xs:element name="HR" type="Res" substitutionGroup="H"/><xs:element name="S" type="T" block="substitution"/><xs:element name="SM" type="T" substitutionGroup="S"/>`;
const blockRoot = `${derived}<xs:element name="R"><xs:complexType><xs:sequence><xs:element name="NoExt" type="T" block="extension"/><xs:element name="NoRes" type="T" block="restriction"/><xs:element name="C" type="Closed"/><xs:element ref="H"/><xs:element ref="S"/></xs:sequence></xs:complexType></xs:element>`;
test('block on elements and types limits the alternatives as libxml2 does', async () => {
  const seen = { NoExt: new Set(), NoRes: new Set(), C: new Set(), H: new Set(), S: new Set() };
  for (let seed = 1; seed <= 16; seed += 1) {
    const sample = await generated(blockRoot, { seed, choice: 'random', root: 'R' });
    okay(sample);
    for (const name of ['NoExt', 'NoRes', 'C'])
      seen[name].add(new RegExp(`<${name}(?: xsi:type="(\\w+)")?`).exec(sample.xml)[1] ?? '-');
    seen.H.add(/<(H|HM|HR)[ >]/.exec(sample.xml)[1]);
    seen.S.add(/<(S|SM)[ >]/.exec(sample.xml)[1]);
  }
  assert.deepEqual([...seen.NoExt].sort(), ['-', 'Res']);
  assert.deepEqual([...seen.NoRes].sort(), ['-', 'Ext']);
  assert.deepEqual([...seen.C], ['-']);
  // The head blocks extension, so HM (extension) is no member; S blocks substitution altogether.
  assert.deepEqual([...seen.H].sort(), ['H', 'HR']);
  assert.deepEqual([...seen.S], ['S']);
  // libxml2 rejects exactly the excluded alternatives.
  const files = new Map(Object.entries(input(blockRoot).files));
  const doc = (noExt, noRes, c, h, s) =>
    `<R xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><NoExt${noExt}><a>x</a></NoExt><NoRes${noRes}><a>x</a>${noRes.includes('Ext') ? '<e>y</e>' : ''}</NoRes><C${c}><a>x</a></C>${h}${s}</R>`;
  const ok = ['', '', '', '<H><a>x</a></H>', '<S><a>x</a></S>'];
  const variants = [
    [ok, true],
    [[' xsi:type="Ext"', '', '', ok[3], ok[4]], false],
    [['', ' xsi:type="Res"', '', ok[3], ok[4]], false],
    [['', '', ' xsi:type="Opened"', ok[3], ok[4]], false],
    [['', '', '', '<HM><a>x</a><e>y</e></HM>', ok[4]], false],
    [['', '', '', ok[3], '<SM><a>x</a></SM>'], false],
    [[' xsi:type="Res"', ' xsi:type="Ext"', '', '<HR><a>x</a></HR>', ok[4]], true],
  ];
  const verdicts = await validator(
    { entry: 'a.xsd', files },
    variants.map(([parts]) => doc(...parts)),
  );
  assert.deepEqual(
    verdicts.map((v) => v.valid),
    variants.map(([, valid]) => valid),
  );
});
test('block on an intermediate type counts for substitution groups, not for xsi:type, as in libxml2', async () => {
  const body = `<xs:complexType name="T"><xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence></xs:complexType><xs:complexType name="Mid" block="extension"><xs:complexContent><xs:extension base="T"/></xs:complexContent></xs:complexType><xs:complexType name="Leaf"><xs:complexContent><xs:extension base="Mid"/></xs:complexContent></xs:complexType><xs:element name="H" type="T"/><xs:element name="L" type="Leaf" substitutionGroup="H"/><xs:element name="M" type="Mid" substitutionGroup="H"/><xs:element name="R"><xs:complexType><xs:sequence><xs:element ref="H"/><xs:element name="E" type="T"/></xs:sequence></xs:complexType></xs:element>`;
  const batch = await generateSamples(input(body), { ...options, root: 'R', count: 4, coverage: true });
  batch.samples.forEach(okay);
  const all = batch.samples.map((s) => s.xml).join('');
  assert.doesNotMatch(all, /<L>/);
  assert.match(all, /<M>/);
  assert.match(all, /<E xsi:type="Leaf">/);
  const [member] = await validator({ entry: 'a.xsd', files: new Map(Object.entries(input(body).files)) }, [
    '<R><L><a>x</a></L><E><a>x</a></E></R>',
  ]);
  assert.equal(member.valid, false);
});
test('blockDefault applies where an element or type has no block of its own', async () => {
  const body = `${derived}<xs:element name="R"><xs:complexType><xs:sequence><xs:element name="E" type="T"/></xs:sequence></xs:complexType></xs:element>`;
  const types = new Set();
  for (let seed = 1; seed <= 10; seed += 1) {
    const sample = await generated(body, { seed, choice: 'random', root: 'R' }, 'blockDefault="extension"');
    okay(sample);
    types.add(/<E(?: xsi:type="(\w+)")?/.exec(sample.xml)[1] ?? '-');
  }
  assert.deepEqual([...types].sort(), ['-', 'Res']);
});
test('substitution is transitive across namespaces; #type tells types of one local name apart', async () => {
  const xs = 'xmlns:xs="http://www.w3.org/2001/XMLSchema"';
  const files = {
    'a.xsd': `<xs:schema ${xs} xmlns="urn:a" xmlns:b="urn:b" targetNamespace="urn:a" elementFormDefault="qualified"><xs:import namespace="urn:b" schemaLocation="b.xsd"/><xs:complexType name="T"><xs:sequence><xs:element name="v" type="xs:string"/></xs:sequence></xs:complexType><xs:element name="Head" type="T" abstract="true"/><xs:element name="Direct" type="T" substitutionGroup="Head"/><xs:element name="R"><xs:complexType><xs:sequence><xs:element ref="Head" maxOccurs="3"/><xs:element name="E" type="T" maxOccurs="2"/></xs:sequence></xs:complexType></xs:element></xs:schema>`,
    'b.xsd': `<xs:schema ${xs} xmlns:a="urn:a" xmlns="urn:b" targetNamespace="urn:b" elementFormDefault="qualified"><xs:import namespace="urn:a" schemaLocation="a.xsd"/><xs:complexType name="T"><xs:complexContent><xs:extension base="a:T"><xs:sequence><xs:element name="w" type="xs:string"/></xs:sequence></xs:extension></xs:complexContent></xs:complexType><xs:element name="Middle" type="a:T" abstract="true" substitutionGroup="a:Head"/><xs:element name="Leaf" type="T" substitutionGroup="Middle"/></xs:schema>`,
  };
  const batch = await generateSamples(
    { entry: 'a.xsd', files },
    { ...options, root: 'R', count: 3, coverage: true, repeat: 3 },
  );
  batch.samples.forEach(okay);
  assert.equal(batch.coverage.complete, true);
  const all = batch.samples.map((s) => s.xml).join('');
  assert.match(all, /<\w+:Leaf>/);
  assert.match(all, /<Direct>/);
  assert.doesNotMatch(all, /Middle|Head>/);
  const types = new Set(batch.samples.flatMap((s) => plain(s.json).E.map((e) => e['#type'] ?? '-')));
  assert.deepEqual([...types].sort(), ['-', '{urn:b}T']);
});
test('abstract declarations without a concrete alternative are reported, never written', async () => {
  const head = await generated(
    '<xs:element name="Head" type="xs:string" abstract="true"/><xs:element name="R"><xs:complexType><xs:sequence><xs:element ref="Head"/></xs:sequence></xs:complexType></xs:element>',
    { root: 'R' },
  );
  assert.equal(head.status, 'incomplete');
  assert.ok(head.problems.some((p) => p.code === 'unsupported' && /no member/.test(p.message)));
  assert.doesNotMatch(head.xml, /Head/);
  // An optional reference that is left out needs no member.
  const optional = await generated(
    '<xs:element name="Head" type="xs:string" abstract="true"/><xs:element name="R"><xs:complexType><xs:sequence><xs:element ref="Head" minOccurs="0"/></xs:sequence></xs:complexType></xs:element>',
    { root: 'R' },
  );
  okay(optional);
  const type = await generated(
    '<xs:complexType name="A" abstract="true"><xs:sequence><xs:element name="x" type="xs:string"/></xs:sequence></xs:complexType><xs:element name="R" type="A"/>',
  );
  assert.equal(type.status, 'incomplete');
  assert.ok(type.problems.some((p) => /no concrete type/.test(p.message)));
});
test('smallest, prefer and templates treat members and types as branches; nil keeps xsi:type', async () => {
  const body = `${derived}<xs:element name="R"><xs:complexType><xs:sequence><xs:element ref="H"/><xs:element name="E" type="T" nillable="true"/></xs:sequence></xs:complexType></xs:element>`;
  const smallest = await generated(body, { choice: 'smallest', optional: 'all', root: 'R' });
  okay(smallest);
  // The restriction Res has one child, T two with the optional b: H as Res and HR tie, and H comes first.
  assert.match(smallest.xml, /<H xsi:type="Res">/);
  assert.match(smallest.xml, /<E xsi:type="Res">/);
  const preferred = await generated(body, { choice: { prefer: ['Ext'] }, root: 'R' });
  okay(preferred);
  assert.match(preferred.xml, /<E xsi:type="Ext">/);
  const template = await generated(body, { choice: 'all', mode: 'template', root: 'R' });
  assert.match(template.xml, /<H>[\s\S]*<HR>/);
  const abstractNil = await generated(
    '<xs:complexType name="A" abstract="true"><xs:attribute name="k" type="xs:string" use="required"/></xs:complexType><xs:complexType name="B"><xs:complexContent><xs:extension base="A"/></xs:complexContent></xs:complexType><xs:element name="R"><xs:complexType><xs:sequence><xs:element name="E" type="A" nillable="true"/></xs:sequence></xs:complexType></xs:element>',
    { nil: 'random', seed: 2 },
  );
  okay(abstractNil);
  if (/xsi:nil/.test(abstractNil.xml))
    assert.deepEqual(Object.keys(plain(abstractNil.json).E), ['#type', 'k', 'value']);
});
test('a chameleon include takes the namespace of each document that includes it', async () => {
  const xs = 'xmlns:xs="http://www.w3.org/2001/XMLSchema"';
  const files = {
    'main.xsd': `<xs:schema ${xs} xmlns="urn:m" xmlns:a="urn:a" targetNamespace="urn:m" elementFormDefault="qualified"><xs:import namespace="urn:a" schemaLocation="sub/a.xsd"/><xs:include schemaLocation="common/contact.xsd"/><xs:element name="R"><xs:complexType><xs:sequence><xs:element name="Own" type="Contact"/><xs:element name="Foreign" type="a:Contact"/><xs:element ref="a:Note"/></xs:sequence></xs:complexType></xs:element></xs:schema>`,
    'sub/a.xsd': `<xs:schema ${xs} targetNamespace="urn:a"><xs:include schemaLocation="../common/contact.xsd"/></xs:schema>`,
    'common/contact.xsd': `<xs:schema ${xs} elementFormDefault="qualified"><xs:include schemaLocation="values.xsd"/><xs:complexType name="Contact"><xs:sequence><xs:element name="Phone" type="Number"/></xs:sequence><xs:attribute name="kind" type="Number" use="required"/></xs:complexType><xs:element name="Note" type="xs:string"/></xs:schema>`,
    'common/values.xsd': `<xs:schema ${xs}><xs:include schemaLocation="contact.xsd"/><xs:simpleType name="Number"><xs:restriction base="xs:string"><xs:pattern value="[0-9]{4}"/></xs:restriction></xs:simpleType></xs:schema>`,
  };
  const sample = await generateSample({ entry: 'main.xsd', files }, options);
  okay(sample);
  // Qualified local elements of the included type are in the namespace of the including document.
  assert.match(sample.xml, /<Own kind="\d{4}">\s*<Phone>\d{4}<\/Phone>/);
  assert.match(sample.xml, /<Foreign kind="\d{4}">\s*<a:Phone>\d{4}<\/a:Phone>/);
  assert.match(sample.xml, /<a:Note>/);
  const { roots } = listRoots({ entry: 'main.xsd', files });
  assert.deepEqual(roots.map((r) => r.expandedName).sort(), ['{urn:a}Note', '{urn:m}Note', '{urn:m}R']);
});
test('coverage tries other open branches after a route keeps failing, and returns to it later', async () => {
  // B never validates. Without a penalty every later sample takes B again and Y below A stays open.
  const body = rootChoice(
    '<xs:element name="A"><xs:complexType><xs:choice><xs:element name="X" type="xs:string"/><xs:element name="Y" type="xs:string"/></xs:choice></xs:complexType></xs:element>',
    '<xs:element name="B" type="xs:string"/>',
  );
  const rejectB = async (schemas, documents) =>
    documents.map((xml) =>
      xml.includes('<B>') ? { valid: false, errors: ['B rejected'] } : { valid: true, errors: [] },
    );
  const batch = await generateSamples(input(body), { ...options, validator: rejectB, count: 5, coverage: true });
  assert.deepEqual(batch.samples.map(taken), ['A', 'B', 'B', 'A', 'B']);
  assert.match(batch.samples[3].xml, /<Y>/);
  // B stays in the denominator and is reported as uncovered, not as unreachable.
  assert.equal(batch.coverage.total, 4);
  assert.equal(batch.coverage.covered, 3);
  assert.deepEqual(
    batch.coverage.uncovered.map((u) => u.branch),
    [1],
  );
  const within = await generateSamples(input(body), { validator: rejectB, count: 2, coverage: true });
  // Within the attempts of one sample: two failures with B, then A with the open Y.
  assert.equal(within.samples[1].status, 'valid');
  assert.equal(within.samples[1].attempts, 3);
  assert.match(within.samples[1].xml, /<Y>/);
});
test('coverage is never complete without an accepted document', async () => {
  const rejected = async (schemas, documents) => documents.map(() => ({ valid: false, errors: ['rejected'] }));
  const none = await generateSamples(simple, { ...options, count: 2, coverage: true, validator: rejected });
  assert.equal(none.coverage.total, 0);
  assert.equal(none.coverage.complete, false);
  const plainSchema = await generateSamples(simple, { ...options, count: 1, coverage: true });
  assert.equal(plainSchema.coverage.total, 0);
  assert.equal(plainSchema.coverage.complete, true);
});
test('optional recursion terminates without dropping required content', async () => {
  const body =
    '<xs:element name="Root" type="Node"/><xs:complexType name="Node"><xs:sequence><xs:element name="Code" type="xs:string"/><xs:element name="Child" type="Node" minOccurs="0"/></xs:sequence></xs:complexType>';
  const sample = await generated(body, { optional: 'all', maxDepth: 2 });
  okay(sample);
  assert.equal((sample.xml.match(/<Child>/g) ?? []).length, 2);
});
test('required infinite recursion cannot receive a valid generation status', async () => {
  const body =
    '<xs:element name="Root" type="Node"/><xs:complexType name="Node"><xs:sequence><xs:element name="Child" type="Node"/></xs:sequence></xs:complexType>';
  const sample = await generated(body, { maxTotalDepth: 4 });
  assert.equal(sample.status, 'incomplete');
  assert.equal(sample.valid, false);
  assert.ok(sample.problems.some((p) => p.code === 'depth-limit'));
});
test('node budget fails explicitly', async () => {
  await assert.rejects(
    generated(
      '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="Item" type="xs:string" maxOccurs="unbounded"/></xs:sequence></xs:complexType></xs:element>',
      { repeat: 20, maxNodes: 5 },
    ),
    /maxNodes/,
  );
});
test('fixed, default and enumeration take precedence over unsuitable domain values', async () => {
  const sample = await generated(
    '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="Fixed" type="xs:int" fixed="7"/><xs:element name="Default" type="xs:boolean" default="false"/><xs:element name="Currency"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="CHF"/></xs:restriction></xs:simpleType></xs:element></xs:sequence></xs:complexType></xs:element>',
    { locale: 'de', samples: { '/Root/Fixed': '99', '/Root/Currency': 'EUR' } },
  );
  okay(sample);
  assert.equal(sample.json.Fixed, 7);
  assert.equal(sample.json.Default, false);
  assert.equal(sample.json.Currency, 'CHF');
});
test('typed zero and false survive projection', async () => {
  const sample = await generated(
    '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="Zero" type="xs:int" fixed="0"/><xs:element name="Flag" type="xs:boolean" fixed="false"/></xs:sequence></xs:complexType></xs:element>',
  );
  okay(sample);
  assert.equal(sample.json.Zero, 0);
  assert.equal(sample.json.Flag, false);
});
test('unsafe integers are not silently rounded in compact JSON', async () => {
  const sample = await generated('<xs:element name="Root" type="xs:long" fixed="9223372036854775807"/>');
  okay(sample);
  assert.equal(sample.jsonStatus, 'unavailable');
  assert.equal(sample.json, undefined);
  const strings = await generated('<xs:element name="Root" type="xs:long" fixed="9223372036854775807"/>', {
    json: { numbers: 'string' },
  });
  okay(strings);
  assert.equal(strings.json, '9223372036854775807');
});
test('high-precision decimal is refused instead of rounded', async () => {
  const sample = await generated('<xs:element name="Root" type="xs:decimal" fixed="1.1234567890123456789012345"/>');
  okay(sample);
  assert.equal(sample.jsonStatus, 'unavailable');
});
test('an attribute named like an element becomes @name in compact JSON; tree mode keeps both names', async () => {
  const sample = await generated(
    '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="code" type="xs:string"/></xs:sequence><xs:attribute name="code" type="xs:string" use="required"/></xs:complexType></xs:element>',
    { values },
  );
  okay(sample);
  assert.deepEqual(plain(sample.json), { '@code': 'Test', code: 'Test' });
  const projected = toJson(sample.tree, { mode: 'tree' });
  assert.equal(projected.attributes[0].name, 'code');
  assert.equal(projected.children[0].name, 'code');
});
test('mixed content remains an XML fragment string', async () => {
  const sample = await generated(
    '<xs:element name="Root"><xs:complexType mixed="true"><xs:sequence><xs:element name="Bold" type="xs:string"/></xs:sequence></xs:complexType></xs:element>',
    { values },
  );
  okay(sample);
  assert.match(sample.json.value, /<Bold>Test<\/Bold>/);
});
test('unqualified elements and qualified attributes serialize with the right namespaces', async () => {
  const sample = await generated(
    '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="Local" type="xs:string"/></xs:sequence><xs:attribute name="Id" type="xs:string" form="qualified" use="required"/></xs:complexType></xs:element>',
    {},
    'targetNamespace="urn:test"',
  );
  okay(sample);
  assert.match(sample.xml, /<Local>/);
  assert.match(sample.xml, /ns1:Id=/);
});
test('schema assignment is a hint, not validation evidence', async () => {
  const sample = await generated('<xs:element name="Root" type="xs:string"/>', {
    schemaLocation: 'a.xsd',
    validate: false,
  });
  assert.equal(sample.status, 'unvalidated');
  assert.equal(sample.valid, undefined);
  assert.match(sample.xml, /xsi:noNamespaceSchemaLocation="a.xsd"/);
});
test('namespace schema location uses namespace and location as a pair', async () => {
  const sample = await generated(
    '<xs:element name="Root" type="xs:string"/>',
    { schemaLocation: 'a.xsd' },
    'targetNamespace="urn:t"',
  );
  okay(sample);
  assert.match(sample.xml, /xsi:schemaLocation="urn:t a.xsd"/);
});
test('schema source is read once, then snapshotted for validation', async () => {
  let reads = 0;
  const sample = await generateSample(
    {
      entry: 'a.xsd',
      files: () => {
        reads += 1;
        return simple.files['a.xsd'];
      },
    },
    options,
  );
  okay(sample);
  assert.equal(reads, 1);
});
/** The DOCTYPE cases of the profile. */
const DOCTYPE_CASES = {
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
  'malformed-space-before-xml-declaration':
    ' <?xml version="1.0" encoding="utf-8"?>\n<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:ds="urn:test:ds" targetNamespace="urn:test:ds" elementFormDefault="qualified">\n  <element name="Sig" type="string"/>\n</schema>\n',
};
test('a DOCTYPE of the inert profile is neutralized for parser and validator; every other form is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xsd-doctype-'));
  try {
    for (const [name, text] of Object.entries(DOCTYPE_CASES)) {
      const file = join(dir, `${name}.xsd`);
      writeFileSync(file, text);
      if (name.startsWith('rejected-') || name.startsWith('malformed-')) {
        const code = name.startsWith('rejected-') ? 'unsafe-input' : 'invalid-xml';
        await assert.rejects(
          generateSampleFile(file, options),
          (error) => error.problems.some((p) => p.code === code),
          name,
        );
        continue;
      }
      const sample = await generateSampleFile(file, options);
      okay(sample);
      const notes = sample.problems.filter((p) => p.code === 'neutralized-doctype');
      assert.deepEqual(
        notes.map((p) => p.severity),
        ['allowed-doctype-only-in-comment', 'allowed-comment-starts-with-hyphen'].includes(name) ? [] : ['warning'],
        name,
      );
    }
    // An unused literal entity alone is inert; using it is not.
    const inert = '<!DOCTYPE xs:schema [<!ENTITY demo "x">]>' + simple.files['a.xsd'];
    okay(await generateSample({ entry: 'a.xsd', files: { 'a.xsd': inert } }, options));
    await assert.rejects(
      generateSample(
        {
          entry: 'a.xsd',
          files: { 'a.xsd': inert.replace('name="Count"', 'name="Count" id="&demo;"') },
        },
        options,
      ),
      /entity &demo;/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
/** The encoding cases, as bytes. */
const ENCODING_CASES = {
  'latin1-c1-range':
    'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iSVNPLTg4NTktMSI/Pgo8eHM6c2NoZW1hIHhtbG5zOnhzPSJodHRwOi8vd3d3LnczLm9yZy8yMDAxL1hNTFNjaGVtYSI+PHhzOmVsZW1lbnQgbmFtZT0iTmFtZSI+PHhzOnNpbXBsZVR5cGU+PHhzOnJlc3RyaWN0aW9uIGJhc2U9InhzOnN0cmluZyI+PHhzOmVudW1lcmF0aW9uIHZhbHVlPSJNgGxsZXIiLz48L3hzOnJlc3RyaWN0aW9uPjwveHM6c2ltcGxlVHlwZT48L3hzOmVsZW1lbnQ+PC94czpzY2hlbWE+Cg==',
  latin1:
    'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iSVNPLTg4NTktMSI/Pgo8eHM6c2NoZW1hIHhtbG5zOnhzPSJodHRwOi8vd3d3LnczLm9yZy8yMDAxL1hNTFNjaGVtYSI+PHhzOmVsZW1lbnQgbmFtZT0iTmFtZSI+PHhzOnNpbXBsZVR5cGU+PHhzOnJlc3RyaWN0aW9uIGJhc2U9InhzOnN0cmluZyI+PHhzOmVudW1lcmF0aW9uIHZhbHVlPSJN/GxsZXIiLz48L3hzOnJlc3RyaWN0aW9uPjwveHM6c2ltcGxlVHlwZT48L3hzOmVsZW1lbnQ+PC94czpzY2hlbWE+Cg==',
  'unsupported-shift-jis':
    'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iU2hpZnRfSklTIj8+Cjx4czpzY2hlbWEgeG1sbnM6eHM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDEvWE1MU2NoZW1hIj48eHM6ZWxlbWVudCBuYW1lPSJOYW1lIj48eHM6c2ltcGxlVHlwZT48eHM6cmVzdHJpY3Rpb24gYmFzZT0ieHM6c3RyaW5nIj48eHM6ZW51bWVyYXRpb24gdmFsdWU9Ik11ZWxsZXIiLz48L3hzOnJlc3RyaWN0aW9uPjwveHM6c2ltcGxlVHlwZT48L3hzOmVsZW1lbnQ+PC94czpzY2hlbWE+Cg==',
  'malformed-ascii-with-umlaut':
    'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVMtQVNDSUkiPz4KPHhzOnNjaGVtYSB4bWxuczp4cz0iaHR0cDovL3d3dy53My5vcmcvMjAwMS9YTUxTY2hlbWEiPjx4czplbGVtZW50IG5hbWU9Ik5hbWUiPjx4czpzaW1wbGVUeXBlPjx4czpyZXN0cmljdGlvbiBiYXNlPSJ4czpzdHJpbmciPjx4czplbnVtZXJhdGlvbiB2YWx1ZT0iTfxsbGVyIi8+PC94czpyZXN0cmljdGlvbj48L3hzOnNpbXBsZVR5cGU+PC94czplbGVtZW50PjwveHM6c2NoZW1hPgo=',
  'malformed-bom-contradicts-declaration':
    '77u/PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iSVNPLTg4NTktMSI/Pgo8eHM6c2NoZW1hIHhtbG5zOnhzPSJodHRwOi8vd3d3LnczLm9yZy8yMDAxL1hNTFNjaGVtYSI+PHhzOmVsZW1lbnQgbmFtZT0iTmFtZSI+PHhzOnNpbXBsZVR5cGU+PHhzOnJlc3RyaWN0aW9uIGJhc2U9InhzOnN0cmluZyI+PHhzOmVudW1lcmF0aW9uIHZhbHVlPSJNw7xsbGVyIi8+PC94czpyZXN0cmljdGlvbj48L3hzOnNpbXBsZVR5cGU+PC94czplbGVtZW50PjwveHM6c2NoZW1hPgo=',
  'malformed-utf8-bytes':
    'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHhzOnNjaGVtYSB4bWxuczp4cz0iaHR0cDovL3d3dy53My5vcmcvMjAwMS9YTUxTY2hlbWEiPjx4czplbGVtZW50IG5hbWU9Ik5hbWUiPjx4czpzaW1wbGVUeXBlPjx4czpyZXN0cmljdGlvbiBiYXNlPSJ4czpzdHJpbmciPjx4czplbnVtZXJhdGlvbiB2YWx1ZT0iTfxsbGVyIi8+PC94czpyZXN0cmljdGlvbj48L3hzOnNpbXBsZVR5cGU+PC94czplbGVtZW50PjwveHM6c2NoZW1hPgo=',
  'utf16-bom':
    '//48AD8AeABtAGwAIAB2AGUAcgBzAGkAbwBuAD0AIgAxAC4AMAAiACAAZQBuAGMAbwBkAGkAbgBnAD0AIgBVAFQARgAtADEANgAiAD8APgAKADwAeABzADoAcwBjAGgAZQBtAGEAIAB4AG0AbABuAHMAOgB4AHMAPQAiAGgAdAB0AHAAOgAvAC8AdwB3AHcALgB3ADMALgBvAHIAZwAvADIAMAAwADEALwBYAE0ATABTAGMAaABlAG0AYQAiAD4APAB4AHMAOgBlAGwAZQBtAGUAbgB0ACAAbgBhAG0AZQA9ACIATgBhAG0AZQAiAD4APAB4AHMAOgBzAGkAbQBwAGwAZQBUAHkAcABlAD4APAB4AHMAOgByAGUAcwB0AHIAaQBjAHQAaQBvAG4AIABiAGEAcwBlAD0AIgB4AHMAOgBzAHQAcgBpAG4AZwAiAD4APAB4AHMAOgBlAG4AdQBtAGUAcgBhAHQAaQBvAG4AIAB2AGEAbAB1AGUAPQAiAE0A/ABsAGwAZQByACIALwA+ADwALwB4AHMAOgByAGUAcwB0AHIAaQBjAHQAaQBvAG4APgA8AC8AeABzADoAcwBpAG0AcABsAGUAVAB5AHAAZQA+ADwALwB4AHMAOgBlAGwAZQBtAGUAbgB0AD4APAAvAHgAcwA6AHMAYwBoAGUAbQBhAD4ACgA=',
  'utf16be-bom':
    '/v8APAA/AHgAbQBsACAAdgBlAHIAcwBpAG8AbgA9ACIAMQAuADAAIgAgAGUAbgBjAG8AZABpAG4AZwA9ACIAVQBUAEYALQAxADYAIgA/AD4ACgA8AHgAcwA6AHMAYwBoAGUAbQBhACAAeABtAGwAbgBzADoAeABzAD0AIgBoAHQAdABwADoALwAvAHcAdwB3AC4AdwAzAC4AbwByAGcALwAyADAAMAAxAC8AWABNAEwAUwBjAGgAZQBtAGEAIgA+ADwAeABzADoAZQBsAGUAbQBlAG4AdAAgAG4AYQBtAGUAPQAiAE4AYQBtAGUAIgA+ADwAeABzADoAcwBpAG0AcABsAGUAVAB5AHAAZQA+ADwAeABzADoAcgBlAHMAdAByAGkAYwB0AGkAbwBuACAAYgBhAHMAZQA9ACIAeABzADoAcwB0AHIAaQBuAGcAIgA+ADwAeABzADoAZQBuAHUAbQBlAHIAYQB0AGkAbwBuACAAdgBhAGwAdQBlAD0AIgBNAPwAbABsAGUAcgAiAC8APgA8AC8AeABzADoAcgBlAHMAdAByAGkAYwB0AGkAbwBuAD4APAAvAHgAcwA6AHMAaQBtAHAAbABlAFQAeQBwAGUAPgA8AC8AeABzADoAZQBsAGUAbQBlAG4AdAA+ADwALwB4AHMAOgBzAGMAaABlAG0AYQA+AAo=',
  'utf8-without-declaration':
    'PHhzOnNjaGVtYSB4bWxuczp4cz0iaHR0cDovL3d3dy53My5vcmcvMjAwMS9YTUxTY2hlbWEiPjx4czplbGVtZW50IG5hbWU9Ik5hbWUiPjx4czpzaW1wbGVUeXBlPjx4czpyZXN0cmljdGlvbiBiYXNlPSJ4czpzdHJpbmciPjx4czplbnVtZXJhdGlvbiB2YWx1ZT0iTcO8bGxlciIvPjwveHM6cmVzdHJpY3Rpb24+PC94czpzaW1wbGVUeXBlPjwveHM6ZWxlbWVudD48L3hzOnNjaGVtYT4K',
};
test('schema files are decoded by byte order mark and declaration, strictly, and libxml2 reads the same text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xsd-encoding-'));
  const expected = {
    latin1: 'M\u00fcller',
    'latin1-c1-range': 'M\u0080ller',
    'utf16-bom': 'M\u00fcller',
    'utf16be-bom': 'M\u00fcller',
    'utf8-without-declaration': 'M\u00fcller',
  };
  try {
    for (const [name, base64] of Object.entries(ENCODING_CASES)) {
      const file = join(dir, `${name}.xsd`);
      writeFileSync(file, Buffer.from(base64, 'base64'));
      const code = name.startsWith('unsupported-')
        ? 'unsupported-encoding'
        : name.startsWith('malformed-')
          ? 'invalid-xml'
          : undefined;
      if (code) {
        await assert.rejects(
          generateSampleFile(file, options),
          (error) => error.problems.some((p) => p.code === code),
          name,
        );
        continue;
      }
      const sample = await generateSampleFile(file, options);
      okay(sample);
      assert.equal(sample.json, expected[name], name);
    }
    // The text API: a decoded text keeps its declaration of ISO-8859-1, yet libxml2 reads the characters given.
    const text = Buffer.from(ENCODING_CASES.latin1, 'base64').toString('latin1');
    const sample = await generateSample({ entry: 'a.xsd', files: { 'a.xsd': text } }, options);
    okay(sample);
    assert.equal(sample.json, 'M\u00fcller');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('xs:redefine of a group and an attribute group with self-references gives the ordinary form', async () => {
  const files = {
    'schema.xsd':
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- xs:redefine of a group and an attribute group with a self-reference (extension). -->\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns="urn:v:red" targetNamespace="urn:v:red" elementFormDefault="qualified">\n  <xs:redefine schemaLocation="base.xsd">\n    <xs:group name="G"><xs:sequence><xs:group ref="G"/><xs:element name="b" type="xs:string"/></xs:sequence></xs:group>\n    <xs:attributeGroup name="AG"><xs:attributeGroup ref="AG"/><xs:attribute name="y" type="xs:string"/></xs:attributeGroup>\n  </xs:redefine>\n  <xs:element name="R">\n    <xs:complexType>\n      <xs:sequence><xs:group ref="G"/></xs:sequence>\n      <xs:attributeGroup ref="AG"/>\n    </xs:complexType>\n  </xs:element>\n</xs:schema>\n',
    'base.xsd':
      '<?xml version="1.0" encoding="UTF-8"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns="urn:v:red" targetNamespace="urn:v:red" elementFormDefault="qualified">\n  <xs:group name="G"><xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence></xs:group>\n  <xs:attributeGroup name="AG"><xs:attribute name="x" type="xs:string"/></xs:attributeGroup>\n</xs:schema>\n',
  };
  for (const seed of [1, 2, 3]) {
    const sample = await generateSample({ entry: 'schema.xsd', files }, { ...options, seed, optional: 'all' });
    okay(sample);
    assert.deepEqual(Object.keys(sample.json), ['x', 'y', 'a', 'b']);
    assert.ok(Object.values(sample.json).every((value) => typeof value === 'string'));
  }
  // A required attribute added by the redefinition is written too; the old definition alone would leave it out.
  const required = {
    ...files,
    'schema.xsd': files['schema.xsd'].replace('name="y" type="xs:string"', 'name="y" type="xs:string" use="required"'),
  };
  const minimal = await generateSample({ entry: 'schema.xsd', files: required }, options);
  okay(minimal);
  assert.deepEqual(Object.keys(minimal.json), ['y', 'a', 'b']);
  const typeRedefined = {
    ...files,
    'schema.xsd': files['schema.xsd'].replace('</xs:redefine>', '<xs:complexType name="K"/></xs:redefine>'),
  };
  await assert.rejects(generateSample({ entry: 'schema.xsd', files: typeRedefined }, options), (error) =>
    error.problems.some((p) => p.code === 'unsupported-redefine'),
  );
});
test('colliding names get keys planned from the content model, not from the sample', async () => {
  const files = {
    'schema.xsd':
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Collision keys: the same local name from two namespaces (every partner becomes {ns}local), an attribute and an\n     element of the same name (the element stays local, the attribute becomes @local), and the text property name\n     reserved in every object: element {ns}value and attribute @value, also without text (Pair). Keys are planned from\n     the content model, not from the instance. -->\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns="urn:v:a" xmlns:b="urn:v:b" targetNamespace="urn:v:a" elementFormDefault="qualified">\n  <xs:import namespace="urn:v:b" schemaLocation="b.xsd"/>\n  <xs:element name="R">\n    <xs:complexType>\n      <xs:sequence>\n        <xs:element name="raceCode" type="xs:string"/>\n        <xs:element ref="b:raceCode" minOccurs="0"/>\n        <xs:element name="rows" type="xs:string"/>\n        <xs:element name="Pair" minOccurs="0">\n          <xs:complexType><xs:sequence><xs:element name="value" type="xs:string"/></xs:sequence><xs:attribute name="value" type="xs:string"/></xs:complexType>\n        </xs:element>\n        <xs:element name="Price" minOccurs="0">\n          <xs:complexType><xs:simpleContent><xs:extension base="xs:decimal"><xs:attribute name="value" type="xs:string"/></xs:extension></xs:simpleContent></xs:complexType>\n        </xs:element>\n      </xs:sequence>\n      <xs:attribute name="rows" type="xs:int"/>\n    </xs:complexType>\n  </xs:element>\n</xs:schema>\n',
    'b.xsd':
      '<?xml version="1.0" encoding="UTF-8"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:v:b" elementFormDefault="qualified">\n  <xs:element name="raceCode" type="xs:string"/>\n</xs:schema>\n',
  };
  const all = await generateSample({ entry: 'schema.xsd', files }, { ...options, optional: 'all' });
  okay(all);
  assert.deepEqual(Object.keys(all.json), ['@rows', '{urn:v:a}raceCode', '{urn:v:b}raceCode', 'rows', 'Pair', 'Price']);
  assert.deepEqual(Object.keys(all.json.Pair), ['@value', '{urn:v:a}value']);
  assert.equal(typeof all.json['@rows'], 'number');
  assert.deepEqual(Object.keys(all.json.Price), ['@value', 'value']);
  assert.equal(typeof all.json.Price['@value'], 'string');
  assert.equal(typeof all.json.Price.value, 'number');
  const none = await generateSample({ entry: 'schema.xsd', files }, options);
  okay(none);
  assert.deepEqual(Object.keys(none.json), ['{urn:v:a}raceCode', 'rows']);
});
test('INF, -INF and NaN in the XML are JSON strings; generated doubles stay numbers', async () => {
  const contract = await generateSample(
    {
      entry: 'schema.xsd',
      files: {
        'schema.xsd':
          '<?xml version="1.0" encoding="UTF-8"?>\n<!-- INF, -INF and NaN as strings in an element, an attribute, a repeated element and a list; bound facets as in XSD 1.0. -->\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  <xs:simpleType name="DoubleList"><xs:list itemType="xs:double"/></xs:simpleType>\n  <xs:simpleType name="NonNegative"><xs:restriction base="xs:double"><xs:minInclusive value="0"/></xs:restriction></xs:simpleType>\n  <xs:element name="R">\n    <xs:complexType>\n      <xs:sequence>\n        <xs:element name="d" type="xs:double"/>\n        <xs:element name="f" type="xs:float" maxOccurs="3"/>\n        <xs:element name="l" type="DoubleList"/>\n        <xs:element name="b" type="NonNegative"/>\n      </xs:sequence>\n      <xs:attribute name="att" type="xs:double"/>\n    </xs:complexType>\n  </xs:element>\n</xs:schema>\n',
      },
    },
    { ...options, optional: 'all' },
  );
  okay(contract);
  for (const value of [contract.json.att, contract.json.d, ...contract.json.f, ...contract.json.l, contract.json.b])
    assert.equal(typeof value, 'number');
  const special = await generated(
    '<xs:simpleType name="DL"><xs:list itemType="xs:double"/></xs:simpleType><xs:element name="R"><xs:complexType><xs:sequence><xs:element name="d"><xs:simpleType><xs:restriction base="xs:double"><xs:enumeration value="INF"/></xs:restriction></xs:simpleType></xs:element><xs:element name="l" type="DL" fixed="1 INF -INF NaN"/><xs:element name="u" fixed=" NaN "><xs:simpleType><xs:union memberTypes="xs:decimal xs:float"/></xs:simpleType></xs:element></xs:sequence><xs:attribute name="att" type="xs:float" fixed="-INF"/></xs:complexType></xs:element>',
    { optional: 'all' },
  );
  okay(special);
  assert.deepEqual(plain(special.json), { att: '-INF', d: 'INF', l: [1, 'INF', '-INF', 'NaN'], u: 'NaN' });
});
test('only XML white space is collapsed: U+00A0 in a fixed token value stays in XML and JSON', async () => {
  const sample = await generateSample(
    {
      entry: 'schema.xsd',
      files: {
        'schema.xsd':
          '<?xml version="1.0" encoding="UTF-8"?>\n<!-- XML whitespace is only #x20, #x9, #xA and #xD. U+00A0 (no-break space) and other Unicode spaces are kept by\n     replace and collapse. -->\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  <xs:simpleType name="List"><xs:list itemType="xs:token"/></xs:simpleType>\n  <xs:element name="R">\n    <xs:complexType>\n      <xs:sequence>\n        <xs:element name="t" type="xs:token" fixed="&#160;A&#160;"/>\n        <xs:element name="u" type="xs:token"/>\n        <xs:element name="l" type="List"/>\n      </xs:sequence>\n    </xs:complexType>\n  </xs:element>\n</xs:schema>\n',
      },
    },
    options,
  );
  okay(sample);
  assert.match(sample.xml, /<t>\u00a0A\u00a0<\/t>/);
  assert.equal(sample.json.t, '\u00a0A\u00a0');
  assert.ok(Array.isArray(sample.json.l));
});
test('a nil element with xsi:type keeps the attributes of that type', async () => {
  const files = {
    'schema.xsd':
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- xsi:nil on a simple type, a complex type with an attribute, simple content with an attribute, and a repeated element. -->\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns="urn:v:nil" targetNamespace="urn:v:nil" elementFormDefault="qualified">\n  <xs:complexType name="B"/>\n  <xs:complexType name="D"><xs:complexContent><xs:extension base="B"><xs:attribute name="extra" type="xs:string" use="required"/></xs:extension></xs:complexContent></xs:complexType>\n  <xs:element name="R">\n    <xs:complexType>\n      <xs:sequence>\n        <xs:element name="D" type="xs:date" nillable="true"/>\n        <xs:element name="A" nillable="true">\n          <xs:complexType>\n            <xs:sequence><xs:element name="Place" type="xs:string"/></xs:sequence>\n            <xs:attribute name="kind" type="xs:string" use="required"/>\n          </xs:complexType>\n        </xs:element>\n        <xs:element name="B" nillable="true">\n          <xs:complexType><xs:simpleContent><xs:extension base="xs:decimal"><xs:attribute name="w" type="xs:string"/></xs:extension></xs:simpleContent></xs:complexType>\n        </xs:element>\n        <xs:element name="K" nillable="true" minOccurs="0">\n          <xs:complexType><xs:sequence><xs:element name="X" type="xs:int"/></xs:sequence></xs:complexType>\n        </xs:element>\n        <xs:element name="L" type="xs:int" nillable="true" maxOccurs="3"/>\n        <xs:element name="N" type="xs:int" nillable="true"/>\n        <xs:element name="P" type="B" nillable="true" minOccurs="0"/>\n      </xs:sequence>\n    </xs:complexType>\n  </xs:element>\n</xs:schema>\n',
  };
  const forms = new Set();
  for (let seed = 1; seed <= 30; seed += 1) {
    const sample = await generateSample(
      { entry: 'schema.xsd', files },
      { ...options, seed, optional: 'all', nil: 'random', choice: 'random' },
    );
    okay(sample);
    const p = sample.json.P;
    if (p && p['#type'] && p.value === null) forms.add(Object.keys(p).join(','));
  }
  assert.deepEqual([...forms], ['#type,extra,value']);
});
test('mixed content is a fragment, also with repeated groups and when an extension inherits it', async () => {
  const files = {
    'schema.xsd':
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Declared mixed content: the children are always a fragment under the text property, also with repeated groups\n     in the content model; the text property is always present, empty as "". -->\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  <xs:group name="cnt"><xs:choice><xs:element name="b" type="xs:string"/><xs:element name="i" type="xs:string"/></xs:choice></xs:group>\n  <xs:complexType name="Title" mixed="true">\n    <xs:group ref="cnt" minOccurs="0" maxOccurs="unbounded"/>\n    <xs:attribute name="id" type="xs:string"/>\n  </xs:complexType>\n  <xs:element name="R">\n    <xs:complexType>\n      <xs:sequence>\n        <xs:element name="T" type="Title"/>\n        <xs:element name="L" type="Title"/>\n      </xs:sequence>\n    </xs:complexType>\n  </xs:element>\n</xs:schema>\n',
  };
  const sample = await generateSample({ entry: 'schema.xsd', files }, { ...options, optional: 'all', repeat: 2 });
  okay(sample);
  for (const name of ['T', 'L']) {
    assert.deepEqual(Object.keys(sample.json[name]), ['id', 'value']);
    assert.match(sample.json[name].value, /<(b|i)>/);
  }
  // An extension of a mixed type without mixed="true" of its own stays mixed.
  const inherited = await generated(
    '<xs:complexType name="Base" mixed="true"><xs:sequence><xs:element name="b" type="xs:string" minOccurs="0" maxOccurs="unbounded"/></xs:sequence></xs:complexType><xs:element name="t"><xs:complexType><xs:complexContent><xs:extension base="Base"><xs:attribute name="class" type="xs:string"/></xs:extension></xs:complexContent></xs:complexType></xs:element>',
    { optional: 'all', repeat: 2 },
  );
  okay(inherited);
  assert.deepEqual(Object.keys(inherited.json), ['class', 'value']);
  assert.match(inherited.json.value, /^\S+ <b>/);
});
test('a branch that cannot be generated is not chosen; coverage leaves it out', async () => {
  const body =
    '<xs:complexType name="Abs" abstract="true"><xs:sequence><xs:element name="x" type="xs:int"/></xs:sequence></xs:complexType><xs:element name="Head" abstract="true" type="xs:string"/><xs:element name="r"><xs:complexType><xs:sequence><xs:choice><xs:element name="base" type="Abs"/><xs:element name="name" type="xs:string"/></xs:choice><xs:choice><xs:element ref="Head"/><xs:element name="n2" type="xs:string"/></xs:choice></xs:sequence></xs:complexType></xs:element>';
  for (const choice of ['first', 'smallest', 'random'])
    for (const seed of [1, 2, 3]) {
      const sample = await generated(body, { choice, seed, root: 'r' });
      okay(sample);
      assert.deepEqual(Object.keys(sample.json), ['name', 'n2']);
    }
  const batch = await generateSamples(input(body), { ...options, root: 'r', count: 2, coverage: true });
  assert.equal(batch.coverage.complete, true);
});
test('a schema nesting deeper than the call stack is a resource-limit, never a RangeError', async () => {
  const deep = (n) =>
    `<xs:element name="r"><xs:complexType><xs:sequence>${'<xs:sequence>'.repeat(n)}<xs:element name="a" type="xs:int"/>${'</xs:sequence>'.repeat(n)}</xs:sequence></xs:complexType></xs:element>`;
  // libxml2 itself does not compile 500 nested groups, so this one is not validated.
  assert.equal((await generated(deep(500), { validate: false })).status, 'unvalidated');
  await assert.rejects(generated(deep(3000)), (error) => error.problems?.some((p) => p.code === 'resource-limit'));
  let chain = '<xs:group name="G0"><xs:sequence><xs:element name="a" type="xs:int"/></xs:sequence></xs:group>';
  for (let i = 1; i <= 3000; i += 1)
    chain += `<xs:group name="G${i}"><xs:sequence><xs:group ref="G${i - 1}"/></xs:sequence></xs:group>`;
  await assert.rejects(
    generated(`${chain}<xs:element name="r"><xs:complexType><xs:group ref="G3000"/></xs:complexType></xs:element>`),
    (error) => error.problems?.some((p) => p.code === 'resource-limit'),
  );
  const cyclic = await generated(
    '<xs:simpleType name="A"><xs:list itemType="A"/></xs:simpleType><xs:element name="r" type="A"/>',
    { validate: false },
  );
  assert.ok(cyclic.problems.some((p) => p.code === 'circular-type'));
});
test('#type is reserved by a type with alternatives, also in a sample without xsi:type', async () => {
  const sample = await generated(
    '<xs:complexType name="T"><xs:sequence><xs:group ref="type" maxOccurs="2"/></xs:sequence></xs:complexType><xs:group name="type"><xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence></xs:group><xs:complexType name="U"><xs:complexContent><xs:extension base="T"/></xs:complexContent></xs:complexType><xs:element name="r"><xs:complexType><xs:sequence><xs:element name="e" type="T"/></xs:sequence></xs:complexType></xs:element>',
    { repeat: 2 },
  );
  okay(sample);
  assert.doesNotMatch(sample.xml, /xsi:type/);
  assert.equal(sample.jsonStatus, 'unavailable');
});
test('textProperty must be an NCName other than __proto__, or #text', async () => {
  await assert.rejects(generateSample(simple, { ...options, json: { textProperty: '{}value' } }), TypeError);
  okay(await generateSample(simple, { ...options, json: { textProperty: '#text' } }));
  const c = capture();
  assert.equal(await run([order, '--format', 'json', '--text-property', '@value'], c.io, validator), 1);
  assert.match(c.result.err, /textProperty/);
});
test('elements of xs:anyType are mapped like wildcard content, empty as ""', async () => {
  const files = {
    'schema.xsd':
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Elements without a type or of type xs:anyType are mapped like wildcard content (empty as ""); a complex xsi:type\n     uses #type, a simple xsi:type is a mapping error. -->\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  <xs:complexType name="K"><xs:sequence><xs:element name="Name" type="xs:string"/></xs:sequence></xs:complexType>\n  <xs:element name="R">\n    <xs:complexType>\n      <xs:sequence>\n        <xs:element name="free"/>\n        <xs:element name="empty" type="xs:anyType"/>\n        <xs:element name="typed" type="xs:anyType" minOccurs="0"/>\n        <xs:element name="simple" type="xs:anyType" minOccurs="0"/>\n      </xs:sequence>\n    </xs:complexType>\n  </xs:element>\n</xs:schema>\n',
  };
  for (const optional of ['none', 'all']) {
    const sample = await generateSample({ entry: 'schema.xsd', files }, { ...options, optional });
    okay(sample);
    assert.deepEqual(
      plain(sample.json),
      optional === 'none' ? { free: '', empty: '' } : { free: '', empty: '', typed: '', simple: '' },
    );
  }
});
test('wildcard content of two namespaces in one object takes different names', async () => {
  const sample = await generated(
    '<xs:element name="R"><xs:complexType><xs:sequence><xs:any namespace="urn:x" processContents="lax"/><xs:any namespace="urn:y" processContents="lax"/></xs:sequence></xs:complexType></xs:element>',
  );
  okay(sample);
  assert.deepEqual(plain(sample.json), { any: 'any content', any2: 'any content' });
});
test('schema size limits apply to the in-memory API, the file API, the root listing and the CLI', async () => {
  const text = simple.files['a.xsd'];
  const size = text.length; // ASCII only
  okay(await generateSample(simple, { ...options, limits: { maxFileBytes: size } }));
  await assert.rejects(generateSample(simple, { ...options, limits: { maxFileBytes: size - 1 } }), (error) =>
    error.problems.some((p) => p.code === 'resource-limit' && p.message.includes(`maxFileBytes ${size - 1}`)),
  );
  assert.throws(() => listRoots(simple, { limits: { maxTotalBytes: size - 1 } }), /maxTotalBytes/);
  assert.equal(listRoots(simple, { limits: { maxDocuments: 1 } }).roots.length, 1);
  await assert.rejects(generateSample(simple, { ...options, limits: { maxDocuments: 0 } }), RangeError);
  const dir = mkdtempSync(join(tmpdir(), 'xsd-limits-'));
  try {
    const file = join(dir, 'a.xsd');
    writeFileSync(file, text);
    const { listRootsFile } = await import('../dist/node.js');
    assert.throws(
      () => listRootsFile(file, { limits: { maxFileBytes: 10 } }),
      (error) =>
        error.problems.some(
          (p) => p.code === 'resource-limit' && /has \d+ bytes, more than maxFileBytes 10/.test(p.message),
        ),
    );
    const c = capture();
    assert.equal(await run([file, '--max-file-bytes', '10'], c.io, validator), 1);
    assert.match(c.result.err, /maxFileBytes 10/);
    assert.equal(await run([file, '--max-documents', '0'], c.io, validator), 1);
    assert.equal(await run([file, '--list-roots', '--max-total-bytes', String(size)], c.io, validator), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('missing imports fail before a sample is returned', async () => {
  await assert.rejects(
    generated(
      '<xs:import namespace="urn:missing" schemaLocation="missing.xsd"/><xs:element name="Root" type="xs:string"/>',
    ),
    /not found/,
  );
});
test('mismatched import namespaces are rejected', async () => {
  const files = {
    'a.xsd': schema('<xs:import namespace="urn:a" schemaLocation="b.xsd"/><xs:element name="Root" type="xs:string"/>'),
    'b.xsd': schema('<xs:element name="Other" type="xs:string"/>', 'targetNamespace="urn:b"'),
  };
  await assert.rejects(generateSample({ files, entry: 'a.xsd' }, options), /namespace/);
});
test('inherited prototype members are not accepted as file contents', async () => {
  await assert.rejects(generateSample({ files: {}, entry: 'toString' }, options), /not found/);
});
test('invalid options fail before generation', async () => {
  for (const settings of [
    { repeat: 0 },
    { seed: NaN },
    { attempts: 0 },
    { maxNodes: -1 },
    { maxDepth: Infinity },
    { fillElements: false },
  ])
    await assert.rejects(generateSample(simple, { ...options, ...settings }));
});
test('validator failures do not become successful generation', async () => {
  await assert.rejects(
    generateSample(simple, {
      ...options,
      validator: async () => {
        throw new Error('validator unavailable');
      },
    }),
    /unavailable/,
  );
  await assert.rejects(generateSample(simple, { ...options, validator: async () => [] }), /exactly one/);
});
test('invalid candidates retry with an explicit seed sequence', async () => {
  let calls = 0;
  const sample = await generateSample(
    input(
      '<xs:element name="Count"><xs:simpleType><xs:restriction base="xs:int"><xs:maxInclusive value="9"/></xs:restriction></xs:simpleType></xs:element>',
    ),
    { validator, seed: 5, attempts: 3, values: { value: () => (++calls === 1 ? '12' : '3') } },
  );
  okay(sample);
  assert.equal(sample.seed, 6);
  assert.equal(sample.attempts, 2);
});
test('listed values must still meet facets', async () => {
  const sample = await generated(
    '<xs:element name="Code"><xs:simpleType><xs:restriction base="xs:string"><xs:pattern value="[A-Z]{3}"/></xs:restriction></xs:simpleType></xs:element>',
    { samples: { '/Code': ['wrong', 'ABC'] } },
  );
  okay(sample);
  assert.equal(sample.json, 'ABC');
});
test('filesystem import traversal and escaping symlinks are refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xsd-access-'));
  try {
    mkdirSync(join(dir, 'inside'));
    writeFileSync(join(dir, 'outside.xsd'), schema('<xs:complexType name="T"/>'));
    writeFileSync(
      join(dir, 'inside/main.xsd'),
      schema('<xs:include schemaLocation="../outside.xsd"/><xs:element name="R" type="xs:string"/>'),
    );
    await assert.rejects(generateSampleFile(join(dir, 'inside/main.xsd'), options), /escapes/);
    okay(await generateSampleFile(join(dir, 'inside/main.xsd'), { ...options, baseDirectory: dir }));
    symlinkSync(join(dir, 'outside.xsd'), join(dir, 'inside/link.xsd'));
    writeFileSync(
      join(dir, 'inside/main.xsd'),
      schema('<xs:include schemaLocation="link.xsd"/><xs:element name="R" type="xs:string"/>'),
    );
    await assert.rejects(generateSampleFile(join(dir, 'inside/main.xsd'), options), /symlink/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
const capture = () => {
  const result = { out: '', err: '' };
  return {
    result,
    io: {
      stdout: (s) => {
        result.out += s;
      },
      stderr: (s) => {
        result.err += s;
      },
    },
  };
};
test('CLI help and unknown options have explicit exit codes', async () => {
  const c = capture();
  assert.equal(await run(['--help'], c.io, validator), 0);
  assert.match(c.result.out, /--choice/);
  assert.equal(await run([order, '--unknown'], c.io, validator), 1);
});
test('CLI writes one pair from the same sample plus a manifest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xsd-cli-'));
  const out = join(dir, 'fixtures');
  const c = capture();
  try {
    assert.equal(
      await run([order, '--format', 'both', '--out-dir', out, '--locale', 'de', '--seed', '7'], c.io, validator),
      0,
      c.result.err,
    );
    assert.deepEqual(readdirSync(out).sort(), ['manifest.json', 'sample-0001.json', 'sample-0001.xml']);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.samples[0].status, 'valid');
    assert.equal(manifest.jsonSchemaValidation, 'not-performed');
    assert.equal(manifest.package.version, '0.2.0');
    assert.equal(manifest.generation.locale, 'de');
    assert.equal(manifest.generation.seed, 7);
    assert.equal(await run([order, '--format', 'both', '--out-dir', out], c.io, validator), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('CLI never writes invalid instances on validator rejection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xsd-cli-'));
  const out = join(dir, 'fixtures');
  const c = capture();
  try {
    assert.equal(
      await run([order, '--out-dir', out, '--attempts', '1'], c.io, async () => [
        { valid: false, errors: ['rejected'] },
      ]),
      2,
    );
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('CLI template artifacts are labelled and not validated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xsd-cli-'));
  const out = join(dir, 'templates');
  const c = capture();
  try {
    assert.equal(
      await run([order, '--template', '--choice', 'all', '--out-dir', out], c.io, async () => {
        throw new Error('must not be called');
      }),
      0,
      c.result.err,
    );
    assert.ok(readdirSync(out).includes('sample-0001.template.xml'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [domain, file] of [
  ['retail', 'order.xsd'],
  ['insurance', 'claim.xsd'],
  ['logistics', 'shipment.xsd'],
]) {
  for (const seed of [7, 19])
    test(`${domain} example with locale de / seed ${seed}`, async () => {
      const sample = await generateSampleFile(join(root, 'examples', domain, file), {
        ...options,
        seed,
        locale: 'de',
        optional: 'all',
        repeat: 2,
      });
      okay(sample);
      assert.equal(sample.jsonStatus, 'generated');
      assert.doesNotMatch(sample.xml, /NaN|undefined/);
    });
}
test('large regex output is bounded', async () => {
  const sample = await generated(
    '<xs:element name="Code"><xs:simpleType><xs:restriction base="xs:string"><xs:pattern value="a{100000000}"/></xs:restriction></xs:simpleType></xs:element>',
  );
  assert.equal(sample.status, 'incomplete');
  assert.ok(sample.problems.some((p) => p.code === 'no-value'));
});
test('optional expansion depth must stay below the hard depth limit', async () => {
  const body =
    '<xs:element name="Root" type="Node"/><xs:complexType name="Node"><xs:sequence><xs:element name="Child" type="Node" minOccurs="0"/></xs:sequence></xs:complexType>';
  await assert.rejects(
    generated(body, { optional: 'all', maxDepth: 100 }),
    /maxDepth must be lower than maxTotalDepth/,
  );
  const sample = await generated(body, { optional: 'all', maxTotalDepth: 5 });
  okay(sample);
  assert.equal((sample.xml.match(/<Child[ />]/g) ?? []).length, 4);
});
test('maxLength 0 yields the empty string', async () => {
  const sample = await generated(
    '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="Note"><xs:simpleType><xs:restriction base="xs:string"><xs:maxLength value="0"/></xs:restriction></xs:simpleType></xs:element></xs:sequence></xs:complexType></xs:element>',
  );
  okay(sample);
  assert.match(sample.xml, /<Note\/>|<Note><\/Note>/);
  assert.equal(JSON.stringify(sample.json), '{"Note":""}');
});

for (const [pattern, facet, length] of [
  ['[A-Z0-9]+', 'minLength', 8],
  ['\\d*', 'length', 10],
  ['[a-z]{2,}', 'length', 12],
]) {
  test(`unbounded pattern ${pattern} respects ${facet}`, async () => {
    const sample = await generated(
      `<xs:element name="Code"><xs:simpleType><xs:restriction base="xs:string"><xs:pattern value="${pattern}"/><xs:${facet} value="${length}"/></xs:restriction></xs:simpleType></xs:element>`,
    );
    okay(sample);
    assert.ok(sample.json.length >= length);
    if (facet === 'length') assert.equal(sample.json.length, length);
  });
}
for (const [type, lower, upper] of [
  ['long', '100000000000000', '999999999999999'],
  ['long', '9223372036854775806', '9223372036854775807'],
  ['long', '-9223372036854775808', '-9223372036854775807'],
  ['unsignedLong', '18446744073709551614', '18446744073709551615'],
  ['decimal', '100000000000000.01', '100000000000000.02'],
]) {
  test(`exact numeric bounds ${lower}..${upper}`, async () => {
    const sample = await generated(
      `<xs:element name="N"><xs:simpleType><xs:restriction base="xs:${type}"><xs:minInclusive value="${lower}"/><xs:maxInclusive value="${upper}"/></xs:restriction></xs:simpleType></xs:element>`,
      { json: { numbers: 'string' } },
    );
    okay(sample);
    if (type !== 'decimal') {
      assert.ok(BigInt(sample.json) >= BigInt(lower));
      assert.ok(BigInt(sample.json) <= BigInt(upper));
    } else assert.ok([lower, upper].includes(sample.json));
  });
}
test('smallest handles a shared forty-level type graph within a second', async () => {
  const types = Array.from(
    { length: 41 },
    (_, i) =>
      `<xs:complexType name="T${i}">${i === 40 ? '' : `<xs:sequence><xs:element name="a" type="T${i + 1}"/><xs:element name="b" type="T${i + 1}"/></xs:sequence>`}</xs:complexType>`,
  ).join('');
  const start = performance.now();
  const sample = await generated(
    `${types}<xs:element name="R"><xs:complexType><xs:choice><xs:element name="Big" type="T0"/><xs:element name="Small" type="xs:string"/></xs:choice></xs:complexType></xs:element>`,
    { choice: 'smallest' },
  );
  okay(sample);
  assert.match(sample.xml, /<Small>/);
  assert.ok(performance.now() - start < 1000);
});
/** IDs and references read back from the XML: every ID once, every reference to one of them. */
const resolved = (xml, idNames, refNames) => {
  const values = (names) =>
    names.flatMap((name) =>
      [...xml.matchAll(new RegExp(`(?:<${name}>([^<]*)</${name}>| ${name}="([^"]*)")`, 'g'))].map((m) => m[1] ?? m[2]),
    );
  const ids = values(idNames);
  const refs = values(refNames).flatMap((v) => v.trim().split(/\s+/));
  assert.equal(new Set(ids).size, ids.length, `duplicate ID in ${xml}`);
  for (const ref of refs) assert.ok(ids.includes(ref), `${ref} resolves in ${xml}`);
  return { ids, refs };
};
test('IDREF and IDREFS are planned document-wide, forward references included', async () => {
  const body =
    '<xs:element name="R"><xs:complexType><xs:sequence><xs:element name="Forward" type="xs:IDREF"/><xs:element name="Entry" maxOccurs="3"><xs:complexType><xs:sequence><xs:element name="No" type="xs:int"/></xs:sequence><xs:attribute name="id" type="xs:ID" use="required"/><xs:attribute name="ref" type="xs:IDREF"/><xs:attribute name="refs" type="xs:IDREFS"/></xs:complexType></xs:element><xs:element name="Target" type="xs:ID"/></xs:sequence></xs:complexType></xs:element>';
  let refs = 0;
  for (let seed = 1; seed <= 10; seed += 1) {
    const sample = await generated(body, { seed, optional: 'random', repeat: 3 });
    okay(sample);
    assert.ok(!sample.problems.some((p) => p.code === 'identity-planning'));
    refs += resolved(sample.xml, ['id', 'Target'], ['Forward', 'ref', 'refs']).refs.length;
    // JSON carries the planned values, IDREFS as an array.
    for (const entry of plain(sample.json).Entry) if (entry.refs) assert.ok(Array.isArray(entry.refs));
  }
  assert.ok(refs > 20);
});
test('a reference with facets of its own gets an ID that meets them', async () => {
  const body =
    '<xs:simpleType name="Ref"><xs:restriction base="xs:IDREF"><xs:pattern value="R[0-9]{3}"/></xs:restriction></xs:simpleType><xs:element name="R"><xs:complexType><xs:sequence><xs:element name="Target" type="xs:ID" maxOccurs="2"/><xs:element name="Ref" type="Ref"/></xs:sequence></xs:complexType></xs:element>';
  const sample = await generated(body, { repeat: 2 });
  okay(sample);
  const { refs } = resolved(sample.xml, ['Target'], ['Ref']);
  assert.match(refs[0], /^R[0-9]{3}$/);
});
test('the list schema with IDREFS and IDs is complete', async () => {
  const body = `${contractList.replace('<xs:element name="Simple">', '<xs:element name="Refs" type="xs:IDREFS" minOccurs="0"/><xs:element name="Entry" minOccurs="0" maxOccurs="2"><xs:complexType><xs:attribute name="id" type="xs:ID" use="required"/></xs:complexType></xs:element><xs:element name="Simple">')}`;
  const sample = await generated(
    body,
    { optional: 'all', repeat: 2 },
    'xmlns="urn:v:list" targetNamespace="urn:v:list" elementFormDefault="qualified"',
  );
  okay(sample);
  const { refs } = resolved(sample.xml, ['id'], ['Refs']);
  assert.ok(refs.length >= 1);
  assert.deepEqual(plain(sample.json).Refs, refs);
});
test('references the planner cannot meet, and supplied ones, stay incomplete instead of rewritten', async () => {
  const noId = await generated(
    '<xs:element name="R"><xs:complexType><xs:attribute name="ref" type="xs:IDREF" use="required"/></xs:complexType></xs:element>',
  );
  assert.equal(noId.valid, true); // libxml2 does not resolve references
  assert.equal(noId.status, 'incomplete');
  assert.ok(noId.problems.some((p) => p.code === 'identity-planning' && /names no ID/.test(p.message)));
  const body =
    '<xs:element name="R"><xs:complexType><xs:sequence><xs:element name="Target" type="xs:ID"/><xs:element name="Ref" type="xs:IDREF"/></xs:sequence></xs:complexType></xs:element>';
  const supplied = await generated(body, { samples: { '/R/Ref': 'Foreign' } });
  assert.match(supplied.xml, /<Ref>Foreign<\/Ref>/);
  assert.equal(supplied.status, 'incomplete');
  const matching = await generated(body, { samples: { '/R/Ref': 'Foreign', '/R/Target': 'Foreign' } });
  okay(matching);
});
test('name types and \\i, \\c follow XML 1.0, Second Edition, as libxml2 does', async () => {
  const schemaText = schema(
    '<xs:element name="R"><xs:complexType><xs:sequence><xs:element name="N" type="xs:NCName" maxOccurs="unbounded"/><xs:element name="P" maxOccurs="unbounded"><xs:simpleType><xs:restriction base="xs:string"><xs:pattern value="\\i\\c*"/></xs:restriction></xs:simpleType></xs:element><xs:element name="D" maxOccurs="unbounded"><xs:simpleType><xs:restriction base="xs:string"><xs:pattern value="\\d+"/></xs:restriction></xs:simpleType></xs:element></xs:sequence></xs:complexType></xs:element>',
  );
  const files = new Map([['a.xsd', schemaText]]);
  // ä, ą: letters of the Second Edition, ŀ is none; a\u0301: combining mark after a letter; ١: Arabic-Indic digit,
  // allowed after a letter. The Fifth Edition would accept all rejected ones except \u0301a.
  const names = ['ä', 'aą', 'a\u0301', 'a١', 'aŀ', 'ǅa', 'Ⅻ', '١a', '\u0301a', 'Ĳ', 'a\u{10000}', '\u{10000}'];
  const expected = [true, true, true, true, false, false, false, false, false, false, false, false];
  const doc = (n) => `<R><N>${n}</N><P>${n}</P><D>١٢٣</D></R>`;
  const verdicts = await validator({ entry: 'a.xsd', files }, names.map(doc));
  assert.deepEqual(
    verdicts.map((v) => v.valid),
    expected,
  );
  // The generator's own check agrees: a value only XML 1.0, Fifth Edition allows is not generated.
  const literal = await generated(
    '<xs:element name="R"><xs:simpleType><xs:restriction base="xs:NCName"><xs:pattern value="ǅa|Ⅻ"/></xs:restriction></xs:simpleType></xs:element>',
  );
  assert.equal(literal.status, 'incomplete');
  assert.ok(literal.problems.some((p) => p.code === 'no-value'));
  const allowed = await generated(
    '<xs:element name="R"><xs:simpleType><xs:restriction base="xs:NCName"><xs:pattern value="[äą][a-z]\\c"/></xs:restriction></xs:simpleType></xs:element>',
  );
  okay(allowed);
});
test('an xs:double or xs:float value has JSON when its binary value survives; a decimal stays exact', async () => {
  const double = await generated(
    '<xs:element name="r"><xs:simpleType><xs:restriction base="xs:double"><xs:enumeration value="2.7457332729808998E126"/></xs:restriction></xs:simpleType></xs:element>',
  );
  okay(double);
  assert.equal(double.jsonStatus, 'generated');
  assert.equal(double.json, Number('2.7457332729808998E126'));
  const float = await generated(
    '<xs:element name="r"><xs:complexType><xs:attribute name="f" type="xs:float" fixed="0.1"/><xs:attribute name="u" fixed="1E3"><xs:simpleType><xs:union memberTypes="xs:decimal xs:double"/></xs:simpleType></xs:attribute></xs:complexType></xs:element>',
    { optional: 'all' },
  );
  okay(float);
  assert.deepEqual(plain(float.json), { f: 0.1, u: 1000 });
  const decimal = await generated(
    '<xs:element name="r"><xs:simpleType><xs:restriction base="xs:decimal"><xs:enumeration value="0.1000000000000000000001"/></xs:restriction></xs:simpleType></xs:element>',
  );
  okay(decimal);
  assert.equal(decimal.jsonStatus, 'unavailable');
});
test('fixed values reach JSON as the validator reads them: numbers collapsed, unions by member', async () => {
  const number = await generated(
    '<xs:element name="r"><xs:complexType><xs:attribute name="att" type="xs:integer" fixed="   123   "/></xs:complexType></xs:element>',
    { optional: 'all' },
  );
  okay(number);
  assert.match(number.xml, /att=" {3}123 {3}"/);
  assert.deepEqual(plain(number.json), { att: 123 });
  const union = await generated(
    '<xs:element name="root" fixed="ENU "><xs:simpleType><xs:union memberTypes="xs:gYearMonth xs:language xs:normalizedString"/></xs:simpleType></xs:element>',
  );
  okay(union);
  assert.match(union.xml, /<root>ENU <\/root>/);
  assert.equal(union.json, 'ENU');
});
test('a generated QName declares the prefix its pattern asks for, also in lists', async () => {
  const pattern = '<xs:pattern value="[\\i-[:]][\\c-[:]]+:[\\i-[:]][\\c-[:]]+"/>';
  for (const seed of [1, 2, 3, 4, 5]) {
    const atomic = await generated(
      `<xs:element name="r"><xs:simpleType><xs:restriction base="xs:QName">${pattern}</xs:restriction></xs:simpleType></xs:element>`,
      { seed },
    );
    okay(atomic);
    const prefix = /<r xmlns:([^=]+)="urn:example:prefix:\1">\1:/.exec(atomic.xml);
    assert.ok(prefix, atomic.xml);
    const list = await generated(
      `<xs:simpleType name="Q"><xs:restriction base="xs:QName">${pattern}</xs:restriction></xs:simpleType><xs:element name="r"><xs:complexType><xs:attribute name="q" use="required"><xs:simpleType><xs:list itemType="Q"/></xs:simpleType></xs:attribute></xs:complexType></xs:element>`,
      { seed },
    );
    okay(list);
  }
});
test('IDREF cannot produce a false successful status', async () => {
  const sample = await generated(
    '<xs:element name="R"><xs:complexType><xs:attribute name="id" type="xs:ID" use="required"/><xs:attribute name="ref" type="xs:IDREF" use="required" fixed="missing"/></xs:complexType></xs:element>',
  );
  assert.equal(sample.valid, true); // Demonstrates the regular validator limitation.
  assert.equal(sample.status, 'incomplete');
  assert.ok(sample.problems.some((p) => p.code === 'identity-planning' && p.severity === 'error'));
});
test('duplicate child declarations keep arrays across seeds and group references', async () => {
  for (let seed = 1; seed <= 6; seed++) {
    const sample = await generated(
      '<xs:group name="G"><xs:sequence><xs:element name="a" type="xs:int"/><xs:element name="b" type="xs:int"/></xs:sequence></xs:group><xs:element name="R"><xs:complexType><xs:sequence><xs:group ref="G"/><xs:element name="a" type="xs:int" minOccurs="0"/></xs:sequence></xs:complexType></xs:element>',
      { optionalElements: 'random', seed },
    );
    okay(sample);
    assert.ok(Array.isArray(sample.json.a));
  }
});
test('XML parsing preserves CR in the paired JSON value', async () => {
  const { DOMParser } = await import('@xmldom/xmldom');
  const sample = await generated('<xs:element name="R" type="xs:string"/>', { samples: { '/R': ['x\r\ny'] } });
  okay(sample);
  assert.equal(new DOMParser().parseFromString(sample.xml, 'text/xml').documentElement.textContent, sample.json);
});
test('enumerations vary with seeded generation under a locale', async () => {
  const batch = await generateSamples(
    input(
      '<xs:element name="Box"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="S"/><xs:enumeration value="M"/><xs:enumeration value="L"/></xs:restriction></xs:simpleType></xs:element>',
    ),
    { count: 20, locale: 'en' },
  );
  batch.samples.forEach(okay);
  assert.deepEqual(new Set(batch.samples.map((s) => s.json)), new Set(['S', 'M', 'L']));
});
test('missing file generation returns a rejecting promise with GenerateError', async () => {
  const { generateSampleFiles, GenerateError } = await import('../dist/node.js');
  for (const generate of [generateSampleFile, generateSampleFiles]) {
    const pending = generate('/does-not-exist/xsd-faker.xsd');
    assert.ok(pending instanceof Promise);
    await assert.rejects(pending, (e) => e instanceof GenerateError && e.problems[0].code === 'missing-file');
  }
});
test('callback RangeError retains its identity', async () => {
  const error = new RangeError('custom choice failed');
  await assert.rejects(
    generated(choice, {
      choice: () => {
        throw error;
      },
    }),
    (e) => e === error,
  );
});
test('CLI default equals library default and reports incomplete coverage after writing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xsd-cli-'));
  try {
    const file = join(dir, 'schema.xsd');
    writeFileSync(file, schema(choice));
    let stdout = '',
      stderr = '';
    const io = {
      stdout: (s) => {
        stdout += s;
      },
      stderr: (s) => {
        stderr += s;
      },
    };
    assert.equal(await run([file], io), 0);
    assert.equal(stdout, (await generateSampleFile(file)).xml);
    const out = join(dir, 'out');
    assert.equal(await run([file, '--coverage', '--out-dir', out], io), 2);
    assert.equal(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).samples[0].status, 'valid');
    assert.equal(await run([file, '--coverage', '--out-dir', out], io), 1);
    assert.match(stderr, /output directory already exists/);
    assert.equal(await run([file, '--optional-depth', '70'], io), 1);
    assert.match(stderr, /--optional-depth.*--max-depth/);
    assert.equal(await run([file, '--template', '--no-element-values', '--format', 'json'], io), 1);
    assert.match(stderr, /empty template values require/);
    assert.equal(
      await run([file, '--template', '--no-element-values', '--format', 'json', '--json-mode', 'tree'], io),
      0,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('attribute restriction without a compatible type is a schema compile error', async () => {
  const { SchemaCompileError } = await import('../dist/index.js');
  await assert.rejects(
    generated(
      '<xs:simpleType name="Code"><xs:restriction base="xs:string"><xs:pattern value="[A-Z]{3}"/></xs:restriction></xs:simpleType><xs:complexType name="Base"><xs:attribute name="code" type="Code"/></xs:complexType><xs:complexType name="Sub"><xs:complexContent><xs:restriction base="Base"><xs:attribute name="code" use="required"/></xs:restriction></xs:complexContent></xs:complexType><xs:element name="Root" type="Sub"/>',
    ),
    SchemaCompileError,
  );
});

test('a locale does not freeze retries at a date outside unsupported temporal bounds', async () => {
  const sample = await generated(
    '<xs:element name="D"><xs:simpleType><xs:restriction base="xs:date"><xs:minInclusive value="2027-01-01"/></xs:restriction></xs:simpleType></xs:element>',
    { locale: 'en', attempts: 10 },
  );
  okay(sample);
  assert.ok(sample.json >= '2027-01-01');
});
test('unsafe locations are unsafe-input, also an entry symlink that leads out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xsd-unsafe-'));
  try {
    const base = join(dir, 'base');
    mkdirSync(base);
    writeFileSync(join(dir, 'outside.xsd'), simple.files['a.xsd']);
    symlinkSync(join(dir, 'outside.xsd'), join(base, 'link.xsd'));
    const importing = (location) =>
      schema(`<xs:include schemaLocation="${location}"/><xs:element name="R" type="xs:string"/>`);
    for (const location of [
      '../outside.xsd',
      join(dir, 'outside.xsd'),
      `file://${join(dir, 'outside.xsd')}`,
      'link.xsd',
    ]) {
      const entry = join(base, 'main.xsd');
      writeFileSync(entry, importing(location));
      await assert.rejects(
        generateSampleFile(entry, { ...options, root: 'R' }),
        (error) =>
          error.problems.some((p) => p.code === 'unsafe-input') &&
          !error.problems.some((p) => p.code === 'missing-file'),
        location,
      );
    }
    // Without baseDirectory, the base is where the entry is named, not where its symlink leads.
    await assert.rejects(generateSampleFile(join(base, 'link.xsd'), options), (error) =>
      error.problems.some((p) => p.code === 'unsafe-input'),
    );
    await assert.rejects(generateSampleFile(join(base, 'main.xsd'), { ...options, limits: [] }), TypeError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('oversized file is refused by the file reader before returning its contents', async () => {
  const { fileInput } = await import('../dist/node.js');
  const dir = mkdtempSync(join(tmpdir(), 'xsd-size-'));
  try {
    const file = join(dir, 'large.xsd');
    writeFileSync(file, ' '.repeat(4 * 1024 * 1024 + 1));
    const source = fileInput(file);
    assert.throws(() => source.files(source.entry), /more than maxFileBytes 4194304/);
    const raised = fileInput(file, { limits: { maxFileBytes: 4 * 1024 * 1024 + 1 } });
    assert.equal(raised.files(raised.entry).bytes, 4 * 1024 * 1024 + 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('branching optional recursion can be bounded explicitly without changing the hard budget contract', async () => {
  const body =
    '<xs:complexType name="T"><xs:sequence><xs:element name="a" type="T" minOccurs="0"/><xs:element name="b" type="T" minOccurs="0"/><xs:element name="c" type="T" minOccurs="0"/></xs:sequence></xs:complexType><xs:element name="R" type="T"/>';
  await assert.rejects(generated(body, { optionalElements: 'all' }), /maxNodes/);
  okay(await generated(body, { optionalElements: 'all', maxDepth: 3 }));
});

for (const type of [
  '<xs:restriction base="xs:IDREFS"/>',
  '<xs:list itemType="xs:IDREF"/>',
  '<xs:union memberTypes="xs:string xs:IDREF"/>',
]) {
  test(`reference boundary also covers ${type}`, async () => {
    const sample = await generated(`<xs:element name="R"><xs:simpleType>${type}</xs:simpleType></xs:element>`);
    assert.equal(sample.status, 'incomplete');
    assert.ok(sample.problems.some((p) => p.code === 'identity-planning' && p.severity === 'error'));
  });
}
test('arrays remain stable across inherited particles', async () => {
  const body =
    '<xs:complexType name="Base"><xs:sequence><xs:element name="a" type="xs:int"/><xs:element name="b" type="xs:int"/></xs:sequence></xs:complexType><xs:complexType name="Sub"><xs:complexContent><xs:extension base="Base"><xs:sequence><xs:element name="a" type="xs:int" minOccurs="0"/></xs:sequence></xs:extension></xs:complexContent></xs:complexType><xs:element name="R" type="Sub"/>';
  for (const optionalElements of ['none', 'all']) {
    const sample = await generated(body, { optionalElements });
    okay(sample);
    assert.ok(Array.isArray(sample.json.a));
    assert.equal(sample.json.a.length, optionalElements === 'none' ? 1 : 2);
  }
});
test('value lists name a type, also one the value type derives from, in the API and the CLI', async () => {
  const body =
    '<xs:simpleType name="Code"><xs:restriction base="xs:string"><xs:pattern value="[A-Z][0-9]{2}"/></xs:restriction></xs:simpleType><xs:element name="R"><xs:complexType><xs:sequence><xs:element name="a" type="Code"/><xs:element name="b"><xs:simpleType><xs:restriction base="Code"><xs:pattern value="B.*"/></xs:restriction></xs:simpleType></xs:element><xs:element name="c" type="Code"/></xs:sequence></xs:complexType></xs:element>';
  const sample = await generated(body, { samples: { Code: ['A10', 'B20'], '/R/c': 'C30' } });
  okay(sample);
  assert.match(sample.json.a, /^[AB][12]0$/);
  assert.equal(sample.json.b, 'B20');
  assert.equal(sample.json.c, 'C30');
  const dir = mkdtempSync(join(tmpdir(), 'xsd-values-'));
  try {
    writeFileSync(join(dir, 'r.xsd'), schema(body));
    writeFileSync(join(dir, 'values.json'), JSON.stringify({ Code: 'B20' }));
    const c = capture();
    const out = join(dir, 'out.xml');
    assert.equal(
      await run([join(dir, 'r.xsd'), '--values', join(dir, 'values.json'), '--out', out], c.io, validator),
      0,
    );
    assert.equal((readFileSync(out, 'utf8').match(/B20/g) ?? []).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('locale is a known tag, a tag that falls back to one, or a locale object', async () => {
  const body = '<xs:element name="R" type="xs:string"/>';
  okay(await generated(body, { locale: 'de-CH' }));
  await assert.rejects(
    generated(body, { locale: 'fr' }),
    (e) => e instanceof TypeError && /unknown locale fr/.test(e.message),
  );
  await assert.rejects(generated(body, { locale: 'de', referenceDate: 'soon' }), TypeError);
  const c = capture();
  assert.equal(await run([order, '--locale', 'fr'], c.io, validator), 1);
  assert.match(c.result.err, /unknown locale fr/);
});
const personSchema = `<xs:simpleType name="Name_Type"><xs:restriction base="xs:string"><xs:minLength value="1"/><xs:maxLength value="45"/></xs:restriction></xs:simpleType><xs:simpleType name="Datum_Type"><xs:restriction base="xs:string"><xs:pattern value="((19|2[0-9])\\d{2})(0[1-9]|1[012])(0[1-9]|[12][0-9]|3[01])"/></xs:restriction></xs:simpleType><xs:complexType name="Person"><xs:sequence><xs:element name="Krankenversichertennummer"><xs:simpleType><xs:restriction base="xs:string"><xs:pattern value="[A-Z][0-9]{9}"/></xs:restriction></xs:simpleType></xs:element><xs:element name="Vorname" type="Name_Type"/><xs:element name="Nachname" type="Name_Type"/><xs:element name="Geschlecht"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="w"/><xs:enumeration value="m"/><xs:enumeration value="d"/><xs:enumeration value="x"/></xs:restriction></xs:simpleType></xs:element><xs:element name="Geburtsdatum" type="Datum_Type"/><xs:choice><xs:element name="E_Mail" type="Name_Type"/><xs:element name="Telefon" type="Name_Type"/></xs:choice><xs:element name="Anschrift"><xs:complexType><xs:sequence><xs:element name="Strasse" type="Name_Type"/><xs:element name="Hausnummer"><xs:simpleType><xs:restriction base="xs:string"><xs:maxLength value="9"/></xs:restriction></xs:simpleType></xs:element><xs:element name="Postleitzahl"><xs:simpleType><xs:restriction base="xs:string"><xs:maxLength value="10"/></xs:restriction></xs:simpleType></xs:element><xs:element name="Ort" type="Name_Type"/></xs:sequence></xs:complexType></xs:element><xs:element name="Bemerkung" minOccurs="0"><xs:simpleType><xs:restriction base="xs:string"><xs:maxLength value="80"/></xs:restriction></xs:simpleType></xs:element></xs:sequence></xs:complexType><xs:element name="R"><xs:complexType><xs:sequence><xs:element name="Person" type="Person" maxOccurs="3"/></xs:sequence></xs:complexType></xs:element>`;
const kvnrValid = (kvnr) => {
  const digits = String(kvnr.charCodeAt(0) - 64).padStart(2, '0') + kvnr.slice(1, 9);
  const sum = [...digits].reduce((s, d, i) => {
    const p = Number(d) * (i % 2 === 0 ? 1 : 2);
    return s + (p > 9 ? p - 9 : p);
  }, 0);
  return sum % 10 === Number(kvnr[9]);
};
const ascii = (s) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');
test('a locale gives each repeated person its own name, address and number, all valid against the schema', async () => {
  for (const locale of ['de', 'en']) {
    for (let seed = 1; seed <= 8; seed += 1) {
      const sample = await generated(personSchema, { locale, seed, repeat: 3, optional: 'all', choice: 'random' });
      okay(sample);
      const people = sample.json.Person;
      assert.equal(people.length, 3);
      for (const p of people) {
        assert.ok(kvnrValid(p.Krankenversichertennummer), p.Krankenversichertennummer);
        assert.match(p.Geburtsdatum, /^(19|20)\d{6}$/);
        if (p.E_Mail) assert.ok(p.E_Mail.startsWith(`${ascii(p.Vorname)}.`), `${p.E_Mail} ${p.Vorname}`);
        assert.doesNotMatch(p.Nachname, /^[A-Za-z]{12,}$/);
      }
      assert.ok(new Set(people.map((p) => p.Nachname + p.Vorname)).size > 1);
    }
  }
});
test('the same seed and locale give the same document, and other seeds others', async () => {
  const a = await generated(personSchema, { locale: 'de', seed: 4 });
  const b = await generated(personSchema, { locale: 'de', seed: 4 });
  const c = await generated(personSchema, { locale: 'de', seed: 5 });
  assert.equal(a.xml, b.xml);
  assert.notEqual(a.xml, c.xml);
});
test('value lists by type come before the locale, and the locale before the facets', async () => {
  const sample = await generated(personSchema, { locale: 'de', samples: { Name_Type: 'Testname' } });
  okay(sample);
  assert.equal(sample.json.Person[0].Nachname, 'Testname');
  assert.equal(sample.json.Person[0].Anschrift.Strasse, 'Testname');
  assert.ok(kvnrValid(sample.json.Person[0].Krankenversichertennummer));
});
test('a partial locale falls back to the locale it extends', async () => {
  const deCH = defineLocale('de-CH', {
    extends: (await import('xsd-faker-locales')).de,
    address: {
      places: [{ city: 'Zürich', postcodes: ['8001'], state: 'ZH' }],
      states: [{ code: 'ZH', name: 'Zürich' }],
      country: { code: 'CH', name: 'Schweiz' },
    },
  });
  const sample = await generated(personSchema, { locale: deCH, seed: 2 });
  okay(sample);
  assert.equal(sample.json.Person[0].Anschrift.Ort, 'Zürich');
  assert.equal(sample.json.Person[0].Anschrift.Postleitzahl, '8001');
  const { de } = await import('xsd-faker-locales');
  assert.ok([...de.person.firstName.female, ...de.person.firstName.male].includes(sample.json.Person[0].Vorname));
});
test('a locale made from data in the form of faker-js generates with it', async () => {
  const locale = localeFromFaker({
    metadata: { code: 'en_GB', country: 'GB' },
    person: { first_name: { female: ['Ada'], male: ['Alan'] }, last_name: ['Turing'] },
    location: { city_name: ['Bletchley'], postcode: 'MK# #AA', street_name: ['Wilton Avenue'] },
  });
  const sample = await generated(personSchema, { locale, seed: 3 });
  okay(sample);
  const [p] = sample.json.Person;
  assert.equal(p.Nachname, 'Turing');
  assert.equal(p.Anschrift.Ort, 'Bletchley');
  assert.match(p.Anschrift.Postleitzahl, /^MK\d \dAA$/);
});
const s = (name, extra = '') =>
  `<xs:element name="${name}"><xs:simpleType><xs:restriction base="xs:string"><xs:maxLength value="60"/>${extra}</xs:restriction></xs:simpleType></xs:element>`;
test('a record serves the parent of the element that holds its fields: gender, salutation, e-mail and state fit', async () => {
  const body = `<xs:element name="Liste"><xs:complexType><xs:sequence><xs:element name="Person" maxOccurs="unbounded"><xs:complexType><xs:sequence>${s('Anrede')}<xs:element name="Name"><xs:complexType><xs:sequence>${s('Vorname')}${s('Nachname')}</xs:sequence></xs:complexType></xs:element><xs:element name="Geschlecht"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="w"/><xs:enumeration value="m"/><xs:enumeration value="d"/></xs:restriction></xs:simpleType></xs:element>${s('Email')}<xs:element name="Anschrift"><xs:complexType><xs:sequence>${s('Strasse')}${s('Postleitzahl')}${s('Ort')}</xs:sequence></xs:complexType></xs:element>${s('Bundesland')}</xs:sequence></xs:complexType></xs:element></xs:sequence></xs:complexType></xs:element>`;
  const { de } = await import('xsd-faker-locales');
  const female = new Set(de.person.firstName.female);
  const male = new Set(de.person.firstName.male);
  let people = 0;
  for (let seed = 1; seed <= 30; seed += 1) {
    const sample = await generated(body, { locale: 'de', seed, repeat: 3 });
    okay(sample);
    for (const p of sample.json.Person) {
      people += 1;
      if (p.Geschlecht === 'w') assert.ok(female.has(p.Name.Vorname), `${p.Name.Vorname} w`);
      if (p.Geschlecht === 'm') assert.ok(male.has(p.Name.Vorname), `${p.Name.Vorname} m`);
      if (p.Anrede === 'Frau') assert.equal(p.Geschlecht === 'm', false);
      assert.ok(p.Email.startsWith(`${ascii(p.Name.Vorname)}.${ascii(p.Name.Nachname)}`.replace(/ /g, '')), p.Email);
      const place = de.address.places.find((pl) => pl.city === p.Anschrift.Ort);
      assert.equal(de.address.states.find((st) => st.code === place?.state)?.name, p.Bundesland);
    }
  }
  assert.ok(people >= 90);
});
test('IDs stay unique with a locale given as values, as with the locale option', async () => {
  const body =
    '<xs:element name="R"><xs:complexType><xs:sequence><xs:element name="E" maxOccurs="5"><xs:complexType><xs:attribute name="name" type="xs:ID" use="required"/></xs:complexType></xs:element></xs:sequence></xs:complexType></xs:element>';
  for (let seed = 1; seed <= 10; seed += 1) {
    okay(await generated(body, { seed, repeat: 5, values: localeValues('de') }));
    okay(await generated(body, { seed, repeat: 5, locale: 'de' }));
  }
});
test('a locale fills ? in a postcode pattern with a letter and dates that end something lie ahead', async () => {
  const locale = localeFromFaker({
    metadata: { code: 'en_GB', country: 'GB' },
    location: { city_name: ['Bath'], postcode: '??# #??' },
  });
  const body = `<xs:element name="R"><xs:complexType><xs:sequence>${s('Postcode')}<xs:element name="GueltigBis" type="xs:date"/><xs:element name="validUntil" type="xs:date"/>${s('Lieferdatum')}</xs:sequence></xs:complexType></xs:element>`;
  for (let seed = 1; seed <= 10; seed += 1) {
    const sample = await generated(body, { locale, seed, referenceDate: '2026-01-15' });
    okay(sample);
    assert.match(sample.json.Postcode, /^[A-Z]{2}\d [A-Z0-9]{3}$/);
    assert.doesNotMatch(sample.json.Postcode, /\?/);
    assert.ok(sample.json.GueltigBis > '2026-01-15' && sample.json.validUntil > '2026-01-15');
    assert.match(sample.json.Lieferdatum, /^\d{4}-\d\d-\d\d$/);
  }
});
/** Expected output for the default facet generator, without a locale. */
const EXPECTED_WITHOUT_LOCALE =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Kunde id="T">\n  <Vorname>Ofcsmu</Vorname>\n  <Nachname>Rnvoawi</Nachname>\n  <Geburtsdatum>2028-10-14</Geburtsdatum>\n  <Bemerkung>Aamwpruppbjnvkmm</Bemerkung>\n</Kunde>\n';
test('without a locale a fixed probe gives the same document as without locale support', async () => {
  const body = `<xs:element name="Kunde"><xs:complexType><xs:sequence>${s('Vorname')}${s('Nachname')}<xs:element name="Geburtsdatum" type="xs:date"/>${s('Bemerkung')}</xs:sequence><xs:attribute name="id" type="xs:ID" use="required"/></xs:complexType></xs:element>`;
  const sample = await generated(body, { seed: 3 });
  okay(sample);
  assert.equal(sample.xml, EXPECTED_WITHOUT_LOCALE);
  const located = await generated(body, { seed: 3, locale: 'de' });
  assert.notEqual(located.xml, sample.xml);
});
test('the CLI names the entry of a value list that is not a string or a non-empty array of strings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xsd-values-'));
  try {
    writeFileSync(join(dir, 'values.json'), JSON.stringify({ Code: [] }));
    const c = capture();
    assert.equal(await run([order, '--values', join(dir, 'values.json')], c.io, validator), 1);
    assert.match(c.result.err, /values must map Code to a string or a non-empty array of strings/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the invalid command writes confirmed samples and a manifest of every sample', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xsd-invalid-'));
  const out = join(dir, 'matrix');
  const messages = [];
  const io = { stdout: (s) => messages.push(s), stderr: (s) => messages.push(s) };
  try {
    const code = await run(
      ['invalid', join(root, 'examples/insurance/claim.xsd'), '--out-dir', out, '--seed', '7', '--max-files', '20'],
      io,
    );
    assert.equal(code, 0, messages.join(''));
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.samples.length, 20);
    assert.equal(manifest.counts.confirmed, manifest.samples.filter((s) => s.status === 'confirmed').length);
    const files = readdirSync(out).filter((f) => f.endsWith('.xml'));
    assert.deepEqual(
      files,
      manifest.samples.filter((s) => s.file !== null).map((s) => s.file),
    );
    for (const sample of manifest.samples) {
      assert.match(sample.path, /^\/\{urn:example:insurance\}Claim/);
      assert.equal(sample.expected, 'invalid');
    }
    const confirmed = manifest.samples.filter((s) => s.status === 'confirmed');
    const verdicts = await validator(
      {
        entry: 'claim.xsd',
        files: new Map([['claim.xsd', readFileSync(join(root, 'examples/insurance/claim.xsd'), 'utf8')]]),
      },
      confirmed.map((s) => readFileSync(join(out, s.file), 'utf8')),
    );
    assert.ok(verdicts.every((v) => !v.valid));
    assert.equal(await run(['invalid', join(root, 'examples/insurance/claim.xsd'), '--out-dir', out], io), 1);
    assert.equal(
      await run(
        [
          'invalid',
          join(root, 'examples/insurance/claim.xsd'),
          '--out-dir',
          join(dir, 'x'),
          '--rules',
          'facet:nothing',
        ],
        io,
      ),
      1,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the CLI writes a document under a locale for names of Object.prototype', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xsd-proto-names-'));
  try {
    const file = join(dir, 'a.xsd');
    writeFileSync(
      file,
      schema(`<xs:element name="constructor"><xs:complexType><xs:sequence>
        <xs:element name="toString" type="xs:string"/><xs:element name="__proto__" type="xs:string"/>
      </xs:sequence><xs:attribute name="constructor" type="xs:string" use="required"/></xs:complexType></xs:element>`),
    );
    for (const locale of ['de', 'en']) {
      const c = capture();
      assert.equal(await run([file, '--locale', locale], c.io, validator), 0, c.result.err);
      assert.match(c.result.out, /<constructor constructor="/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the option profile, replaced by locale, is refused with a pointer to locale', async () => {
  for (const call of [
    () => generateSample(simple, { ...options, profile: 'retail' }),
    () => generateSamples(simple, { ...options, count: 2, profile: 'retail' }),
    () => generateSample(simple, { ...options, profile: undefined }),
  ]) {
    await assert.rejects(
      call,
      (error) => error instanceof TypeError && /profile was replaced by locale/.test(error.message),
    );
  }
  const c = capture();
  assert.equal(await run([order, '--profile', 'retail'], c.io, validator), 1);
  assert.match(c.result.err, /--profile was replaced by --locale/);
  assert.equal(c.result.out, '');
});
