import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSample, generateSamples, listRoots, toJson, validateXml as validator } from '../dist/index.js';
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
    profile: 'retail',
    referenceDate: '2026-01-15T12:00:00Z',
  });
  const b = await generateSampleFile(order, {
    ...options,
    seed: 27,
    optional: 'all',
    profile: 'retail',
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
  );
  okay(sample);
  assert.ok(Array.isArray(sample.json.Code));
  assert.equal(sample.json.Code.length, 1);
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
test('separate branch samples produce accepted coverage', async () => {
  const batch = await generateSamples(input(choice), { ...options, count: 3, coverage: true });
  batch.samples.forEach(okay);
  assert.equal(batch.coverage.covered, 3);
  assert.equal(batch.coverage.complete, true);
  assert.equal(batch.coverage.scope, 'encountered-choices');
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
    { profile: 'retail', samples: { '/Root/Fixed': '99', '/Root/Currency': 'EUR' } },
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
test('element/attribute collisions preserve XML and refuse compact JSON', async () => {
  const sample = await generated(
    '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="code" type="xs:string"/></xs:sequence><xs:attribute name="code" type="xs:string" use="required"/></xs:complexType></xs:element>',
  );
  okay(sample);
  assert.equal(sample.jsonStatus, 'unavailable');
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
test('DOCTYPE is rejected before parsing', async () => {
  await assert.rejects(
    generateSample(
      { entry: 'a.xsd', files: { 'a.xsd': '<!DOCTYPE schema [<!ENTITY demo "x">]>' + simple.files['a.xsd'] } },
      options,
    ),
    /DOCTYPE/,
  );
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
test('custom profile values must still meet facets', async () => {
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
      await run([order, '--format', 'both', '--out-dir', out, '--profile', 'retail', '--seed', '7'], c.io, validator),
      0,
      c.result.err,
    );
    assert.deepEqual(readdirSync(out).sort(), ['manifest.json', 'sample-0001.json', 'sample-0001.xml']);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.samples[0].status, 'valid');
    assert.equal(manifest.jsonSchemaValidation, 'not-performed');
    assert.equal(manifest.package.version, '0.2.0');
    assert.equal(manifest.generation.profile, 'retail');
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
    test(`synthetic ${domain} profile / seed ${seed}`, async () => {
      const sample = await generateSampleFile(join(root, 'examples', domain, file), {
        ...options,
        seed,
        profile: domain,
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
test('profile enumerations vary with seeded generation', async () => {
  const batch = await generateSamples(
    input(
      '<xs:element name="Box"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="S"/><xs:enumeration value="M"/><xs:enumeration value="L"/></xs:restriction></xs:simpleType></xs:element>',
    ),
    { count: 20, profile: 'generic' },
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

test('profiles do not freeze retries at a date outside unsupported temporal bounds', async () => {
  const sample = await generated(
    '<xs:element name="D"><xs:simpleType><xs:restriction base="xs:date"><xs:minInclusive value="2027-01-01"/></xs:restriction></xs:simpleType></xs:element>',
    { profile: 'generic', attempts: 10 },
  );
  okay(sample);
  assert.ok(sample.json >= '2027-01-01');
});
test('oversized file is refused by the file reader before returning its contents', async () => {
  const { fileInput } = await import('../dist/node.js');
  const dir = mkdtempSync(join(tmpdir(), 'xsd-size-'));
  try {
    const file = join(dir, 'large.xsd');
    writeFileSync(file, ' '.repeat(2 * 1024 * 1024 + 1));
    const source = fileInput(file);
    assert.throws(() => source.files(source.entry), /2 MiB/);
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
