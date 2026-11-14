// Compact JSON contract cases. Trees include the metadata supplied by the walker; expected results cover
// document structure and individual values.
import { describe, expect, it } from 'vitest';
import { element, type InstanceAttribute, type InstanceElement, text } from '../xml/tree.js';
import { JsonMappingError, toJson } from './serialize.js';

const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
const attribute = (ns: string, name: string, value: string, extra: Partial<InstanceAttribute> = {}) => ({
  ns,
  name,
  value,
  type: 'string' as const,
  ...extra,
});
const wild = (node: InstanceElement): InstanceElement => ({ ...node, wildcard: true });

describe('lists', () => {
  const L = 'urn:v:list';
  const tree = element(L, 'R', {
    attributes: [attribute('', 'codes', 'red  green', { list: true })],
    children: [
      element(L, 'Numbers', { children: [text(' 1 +02\n 3 ', 'integer', true)] }),
      element(L, 'Short', { children: [text('4 5', 'integer', true)] }),
      element(L, 'Repeated', { children: [text('6', 'integer', true)], repeatable: true }),
      element(L, 'Repeated', { children: [text('7 8', 'integer', true)], repeatable: true }),
      element(L, 'Empty', { children: [text('', 'integer', true)] }),
      element(L, 'Tokens', { children: [text('a b', 'string', true)] }),
      element(L, 'Refs', { children: [text('e1 e2', 'string', true)] }),
      element(L, 'Pick', { children: [text('+01 002', 'integer', true)] }),
      element(L, 'Entry', { attributes: [attribute('', 'id', 'e1')], repeatable: true }),
      element(L, 'Entry', { attributes: [attribute('', 'id', 'e2')], repeatable: true }),
    ],
  });

  it('writes a list as an array of typed items, also in attributes and repetitions', () => {
    expect(plain(toJson(tree))).toEqual({
      codes: ['red', 'green'],
      Numbers: [1, 2, 3],
      Short: [4, 5],
      Repeated: [[6], [7, 8]],
      Empty: [],
      Tokens: ['a', 'b'],
      Refs: ['e1', 'e2'],
      Pick: [1, 2],
      Entry: [{ id: 'e1' }, { id: 'e2' }],
    });
  });

  it('keeps list items as strings with numbers: string, and lists in simple content', () => {
    expect(plain(toJson(element(L, 'Z', { children: [text('1 2', 'integer', true)] }), { numbers: 'string' }))).toEqual(
      ['1', '2'],
    );
    const simple = element(L, 'S', { children: [text('1.5 2', 'number', true)], attributes: [] });
    simple.simpleContent = true;
    expect(plain(toJson(simple))).toEqual({ value: [1.5, 2] });
  });
});

describe('xsi:nil', () => {
  const N = 'urn:v:nil';
  const nil = (node: InstanceElement): InstanceElement => ({ ...node, nil: true });
  const b = nil(element(N, 'B', { attributes: [attribute('', 'w', 'EUR')] }));
  b.simpleContent = true;
  const tree = element(N, 'R', {
    children: [
      nil(element(N, 'D')),
      nil(element(N, 'A', { attributes: [attribute('', 'kind', 'x')] })),
      b,
      nil(element(N, 'K')),
      element(N, 'L', { children: [text('1', 'integer')], repeatable: true }),
      nil(element(N, 'L', { repeatable: true })),
      element(N, 'N', { children: [text('7', 'integer')] }),
      // xsi:type D brings the attributes of D, also on a nil element.
      { ...nil(element(N, 'P', { attributes: [attribute('', 'extra', 'e')] })), xsiType: { ns: N, name: 'D' } },
    ],
  });

  it('writes nil as null, or with attributes as an object with a null text property', () => {
    expect(plain(toJson(tree))).toEqual({
      D: null,
      A: { kind: 'x', value: null },
      B: { w: 'EUR', value: null },
      K: null,
      L: [1, null],
      N: 7,
      P: { '#type': '{urn:v:nil}D', extra: 'e', value: null },
    });
  });

  it('writes an attribute named like the text property of a nil element as @value', () => {
    const named = nil(element(N, 'A', { attributes: [attribute('', 'value', 'x')] }));
    expect(plain(toJson(element(N, 'R', { children: [named] })))).toEqual({ A: { '@value': 'x', value: null } });
  });

  it('never writes xsi:* attributes as properties', () => {
    const xsi = 'http://www.w3.org/2001/XMLSchema-instance';
    const node = element(N, 'E', { attributes: [attribute(xsi, 'type', 'T'), attribute('', 'a', '1')] });
    expect(plain(toJson(element(N, 'R', { children: [node] })))).toEqual({ E: { a: '1' } });
  });
});

describe('wildcard content', () => {
  const A = 'urn:v:any';
  const F = 'urn:foreign';
  const prefixes = new Map([[F, 'f']]);
  const ext = (children: InstanceElement[], attributes: InstanceAttribute[] = []) =>
    element(A, 'R', {
      children: [element(A, 'Head', { children: [text('k')] }), element(A, 'Ext', { attributes, children })],
    });

  it('maps elements admitted by xs:any without the schema', () => {
    const tree = ext(
      [
        wild(element(F, 'x', { children: [text('one')], repeatable: true })),
        wild(element(F, 'y', { attributes: [attribute(F, 'b', '2')], children: [text('two')] })),
        wild(
          element(F, 'z', {
            children: [text('\n    '), element(F, 'w', { children: [text('deep')] }), text('\n  ')],
          }),
        ),
        wild(element(F, 'x', { children: [text(' more ')], repeatable: true })),
        wild(
          element(F, 'm', {
            children: [
              text('before'),
              element(F, 'b', { children: [text('bold')] }),
              // an element without content, here with an empty text as a fixed="" value leaves it, closes itself
              element(F, 'i', { children: [text('')] }),
              text('after'),
            ],
          }),
        ),
        wild(element(F, 'empty')),
        wild(element(F, 'attronly', { attributes: [attribute('', 'a', '1')] })),
        wild(element(F, 'value', { children: [text('v')] })),
      ],
      [attribute(F, 'a', '1'), attribute(F, 'value', 'w')],
    );
    expect(plain(toJson(tree, {}, prefixes))).toEqual({
      Head: 'k',
      Ext: {
        a: '1',
        x: ['one', ' more '],
        y: { b: '2', value: 'two' },
        z: { w: 'deep' },
        m: { value: 'before<f:b xmlns:f="urn:foreign">bold</f:b><f:i xmlns:f="urn:foreign"/>after' },
        empty: '',
        '@value': 'w',
        '{urn:foreign}value': 'v',
        attronly: { a: '1' },
      },
    });
  });

  it('writes one occurrence as a value, even of a repeatable particle, and typed values as strings', () => {
    const tree = ext([wild(element(F, 'x', { children: [text('12', 'integer')], repeatable: true }))]);
    expect(plain(toJson(tree))).toEqual({ Head: 'k', Ext: { x: '12' } });
  });

  it('refuses an attribute and a child of the same name, and one name in two namespaces', () => {
    const both = ext([wild(element(F, 'x', { children: [text('2')] }))], [attribute(F, 'x', '1')]);
    expect(() => toJson(both)).toThrow(JsonMappingError);
    const twoNamespaces = ext([
      wild(element(F, 'x', { children: [text('1')] })),
      wild(element('urn:other', 'x', { children: [text('2')] })),
    ]);
    expect(() => toJson(twoNamespaces)).toThrow(/namespace collision/);
  });

  it('refuses wildcard content named like a declared element, and keys one named like the text property {ns}local', () => {
    const declared = element(A, 'R', {
      children: [element(A, 'Head', { children: [text('k')] }), wild(element(A, 'Head', { children: [text('w')] }))],
    });
    expect(() => toJson(declared)).toThrow(JsonMappingError);
    const named = ext([wild(element(F, 'value', { children: [text('v')] }))]);
    expect(plain(toJson(named))).toMatchObject({ Ext: { [`{${F}}value`]: 'v' } });
    const inner = ext([wild(element(F, 'o', { children: [element(F, 'value', { children: [text('v')] })] }))]);
    expect(plain(toJson(inner))).toMatchObject({ Ext: { o: { [`{${F}}value`]: 'v' } } });
  });

  it('writes a wildcard attribute named like the text property as @value', () => {
    const attributed = wild(element(F, 'y', { attributes: [attribute(F, 'value', '2')], children: [text('two')] }));
    expect(plain(toJson(ext([attributed])))).toMatchObject({ Ext: { y: { '@value': '2', value: 'two' } } });
  });
});

describe('substitution groups and xsi:type', () => {
  const V = 'urn:v:sub';
  const XSD = 'http://www.w3.org/2001/XMLSchema';
  const typed = (node: InstanceElement, ns: string, name: string): InstanceElement => ({
    ...node,
    xsiType: { ns, name },
  });
  const doc = (name: string, children: InstanceElement[]) => element(V, name, { children, repeatable: true });

  it('keys members by their own name and writes xsi:type as #type with the expanded name', () => {
    const preis = typed(
      element(V, 'Price', {
        attributes: [attribute('', 'currency', 'EUR'), attribute('', 'source', 'x')],
        children: [text('4.99', 'number')],
      }),
      V,
      'EuroAmount',
    );
    preis.simpleContent = true;
    const tree = element(V, 'R', {
      children: [
        doc('Invoice', [
          element(V, 'Number', { children: [text('1')] }),
          element(V, 'Amount', { children: [text('9.5', 'number')] }),
        ]),
        doc('Credit', [element(V, 'Number', { children: [text('2')] })]),
        typed(
          element(V, 'Vehicle', {
            children: [
              element(V, 'Plate', { children: [text('K')] }),
              element(V, 'Seats', { children: [text('4', 'integer')] }),
            ],
          }),
          V,
          'Car',
        ),
        element(V, 'Pet', { children: [element(V, 'Name', { children: [text('a')] })], repeatable: true }),
        typed(
          element(V, 'Pet', {
            children: [element(V, 'Name', { children: [text('b')] }), element(V, 'Breed', { children: [text('c')] })],
            repeatable: true,
          }),
          V,
          'Dog',
        ),
        // xsi:type="xs:decimal" names the declared type: the tree has no xsiType, and the value stays plain.
        element(V, 'Count', { children: [text('5', 'number')] }),
        preis,
      ],
    });
    expect(plain(toJson(tree))).toEqual({
      Invoice: [{ Number: '1', Amount: 9.5 }],
      Credit: [{ Number: '2' }],
      Vehicle: { '#type': '{urn:v:sub}Car', Plate: 'K', Seats: 4 },
      Pet: [{ Name: 'a' }, { '#type': '{urn:v:sub}Dog', Name: 'b', Breed: 'c' }],
      Count: 5,
      Price: { '#type': '{urn:v:sub}EuroAmount', currency: 'EUR', source: 'x', value: 4.99 },
    });
  });

  it('refuses another type on an element of a simple type (mapping-error-xsitype-simple-type)', () => {
    const zahl = typed(element(V, 'Count', { children: [text('5', 'integer')] }), XSD, 'integer');
    expect(() => toJson(element(V, 'R', { children: [zahl] }))).toThrow(/simple type, has no JSON form/);
  });

  it('writes a type without namespace as {}local, and nil with #type as a null text property', () => {
    const nil = { ...typed(element('', 'E'), '', 'T'), nil: true };
    expect(plain(toJson(element('', 'R', { children: [nil] })))).toEqual({ E: { '#type': '{}T', value: null } });
  });

  it('refuses #type next to a repeated group named type', () => {
    const member = element(V, 'a', { children: [text('1')] });
    member.groups = [{ key: '#type', occurrence: 1 }];
    expect(() => toJson(typed(element(V, 'R', { children: [member] }), V, 'T'))).toThrow(JsonMappingError);
  });
});

describe('name collisions', () => {
  const A = 'urn:v:a';
  const B = 'urn:v:b';
  // The keys are planned by the walker from the content model: b:raceCode may occur, so both raceCode take their
  // expanded names, also in a document without b (valid-without-b); the attribute rows meets the element rows.
  const tree = (withB: boolean) =>
    element(A, 'R', {
      attributes: [attribute('', 'rows', '3', { type: 'integer', key: '@rows' })],
      children: [
        { ...element(A, 'raceCode', { children: [text('x')] }), key: `{${A}}raceCode` },
        ...(withB ? [{ ...element(B, 'raceCode', { children: [text('y')] }), key: `{${B}}raceCode` }] : []),
        element(A, 'rows', { children: [text('r')] }),
        ...(withB
          ? [
              element(A, 'Pair', {
                attributes: [attribute('', 'value', 'a')],
                children: [element(A, 'value', { children: [text('e')] })],
              }),
              {
                ...element(A, 'Price', {
                  attributes: [attribute('', 'value', 'v')],
                  children: [text('4.5', 'number')],
                }),
                simpleContent: true,
              },
            ]
          : []),
      ],
    });

  it('gives colliding elements their expanded names, attributes @local, also next to the text property (valid, valid-without-b)', () => {
    expect(plain(toJson(tree(true)))).toEqual({
      '@rows': 3,
      '{urn:v:a}raceCode': 'x',
      '{urn:v:b}raceCode': 'y',
      rows: 'r',
      Pair: { '@value': 'a', '{urn:v:a}value': 'e' },
      Price: { '@value': 'v', value: 4.5 },
    });
    expect(plain(toJson(tree(false)))).toEqual({ '@rows': 3, '{urn:v:a}raceCode': 'x', rows: 'r' });
    expect(Object.keys(toJson(tree(true)) as object)).toEqual([
      '@rows',
      '{urn:v:a}raceCode',
      '{urn:v:b}raceCode',
      'rows',
      'Pair',
      'Price',
    ]);
  });

  it('still refuses an unplanned collision', () => {
    const unplanned = element(A, 'R', {
      children: [element(A, 'raceCode', { children: [text('x')] }), element(B, 'raceCode', { children: [text('y')] })],
    });
    expect(() => toJson(unplanned)).toThrow(JsonMappingError);
  });
});

describe('INF, -INF and NaN', () => {
  const number = (value: string, extra: Partial<InstanceAttribute> = {}) => text(value, 'number', extra.list ?? false);
  const tree = element('', 'R', {
    attributes: [attribute('', 'att', '-INF', { type: 'number', binary: 'double' })],
    children: [
      element('', 'd', { children: [{ ...number('INF'), binary: 'double' }] }),
      element('', 'f', { children: [{ ...number('NaN'), binary: 'float' }], repeatable: true }),
      element('', 'f', { children: [{ ...number('1.5'), binary: 'float' }], repeatable: true }),
      element('', 'l', { children: [{ ...number('1 INF -INF NaN', { list: true }), binary: 'double' }] }),
      element('', 'b', { children: [{ ...number('INF'), binary: 'double' }] }),
    ],
  });

  it('writes the special values as strings in attributes, repetitions and lists (valid)', () => {
    expect(plain(toJson(tree))).toEqual({
      att: '-INF',
      d: 'INF',
      f: ['NaN', 1.5],
      l: [1, 'INF', '-INF', 'NaN'],
      b: 'INF',
    });
  });
});

describe('elements of xs:anyType', () => {
  const any = (node: InstanceElement): InstanceElement => ({ ...node, anyType: true });
  const XS = 'http://www.w3.org/2001/XMLSchema';
  const R = (last: InstanceElement) =>
    element('', 'R', {
      children: [
        any(
          element('', 'free', {
            attributes: [attribute('', 'a', '1')],
            children: [element('', 'x', { children: [text('one')] }), element('', 'y', { children: [text('two')] })],
          }),
        ),
        any(element('', 'empty')),
        last,
      ],
    });

  it('maps them like wildcard content, empty as "", and a complex xsi:type with #type (valid)', () => {
    const typed = {
      ...any(element('', 'typed', { children: [element('', 'Name', { children: [text('n')] })] })),
      xsiType: { ns: '', name: 'K' },
    };
    expect(plain(toJson(R(typed)))).toEqual({
      free: { a: '1', x: 'one', y: 'two' },
      empty: '',
      typed: { '#type': '{}K', Name: 'n' },
    });
  });

  it('refuses a simple xsi:type (mapping-error-xsitype-simple)', () => {
    const simple = { ...any(element('', 'simple', { children: [text('5')] })), xsiType: { ns: XS, name: 'int' } };
    expect(() => toJson(R(simple))).toThrow(JsonMappingError);
  });
});

describe('XML white space', () => {
  // Only #x20, #x9, #xA and #xD are XML white space; U+00A0 and U+2003 stay. The walker records the collapsed value
  // of u as `normalized`; t and l need none.
  const tree = element('', 'R', {
    children: [
      element('', 't', { children: [text('\u00a0A\u00a0')] }),
      element('', 'u', { children: [{ ...text('  x\u00a0 y\u2003 '), normalized: 'x\u00a0 y\u2003' }] }),
      element('', 'l', { children: [text('a\u00a0b c', 'string', true)] }),
    ],
  });

  it('keeps other Unicode spaces in values and list items (valid)', () => {
    expect(plain(toJson(tree))).toEqual({ t: '\u00a0A\u00a0', u: 'x\u00a0 y\u2003', l: ['a\u00a0b', 'c'] });
  });

  it('does not trim U+00A0 around numbers', () => {
    const r = element('', 'r', { children: [text('\u00a01', 'integer')] });
    expect(() => toJson(r)).toThrow(JsonMappingError);
  });
});

describe('declared mixed content', () => {
  const mixed = (node: InstanceElement): InstanceElement => ({ ...node, mixed: true });

  it('writes the children as a fragment, also from a repeated group, and empty content as "" (valid)', () => {
    const occurrence = (n: number) => [{ key: '#cnt', occurrence: n }];
    const tree = element('', 'R', {
      children: [
        mixed(
          element('', 'T', {
            attributes: [attribute('', 'id', 't1')],
            children: [
              text('x'),
              { ...element('', 'b', { children: [text('1')] }), groups: occurrence(1) },
              text('y'),
              { ...element('', 'i', { children: [text('2')] }), groups: occurrence(2) },
            ],
          }),
        ),
        mixed(element('', 'L')),
      ],
    });
    expect(plain(toJson(tree))).toEqual({ T: { id: 't1', value: 'x<b>1</b>y<i>2</i>' }, L: { value: '' } });
  });

  it('gives empty simple content its text property', () => {
    const empty = { ...element('', 'P', { attributes: [attribute('', 'w', 'EUR')] }), simpleContent: true };
    expect(plain(toJson(element('', 'R', { children: [empty] })))).toEqual({ P: { w: 'EUR', value: '' } });
  });
});

describe('numbers and normalized values', () => {
  const value = (lexical: string, extra: Partial<InstanceAttribute> = {}) =>
    toJson(element('', 'r', { attributes: [attribute('', 'v', lexical, { type: 'number', ...extra })] }));

  it('checks an xs:double by its value, an xs:float by its 32-bit value and a decimal exactly', () => {
    expect(plain(value('2.7457332729808998E126', { binary: 'double' }))).toEqual({
      v: Number('2.7457332729808998E126'),
    });
    expect(() => value('2.7457332729808998E126')).toThrow(JsonMappingError);
    expect(plain(value('0.1', { binary: 'float' }))).toEqual({ v: 0.1 });
    // A literal past the largest finite value is INF or -INF of its type.
    expect(plain(value('1E39', { binary: 'float' }))).toEqual({ v: 'INF' });
    expect(plain(value('-3.4028236e38', { binary: 'float' }))).toEqual({ v: '-INF' });
    expect(plain(value('1E309', { binary: 'double' }))).toEqual({ v: 'INF' });
    expect(plain(value('1E39', { binary: 'double' }))).toEqual({ v: 1e39 });
    expect(() => value('0.1000000000000000000001')).toThrow(JsonMappingError);
  });

  it('decides a float halfway between two floats after the double by the text', () => {
    // 1 + 2^-24 lies halfway between the floats 1 and 1 + 2^-23; ties go to the even one, 1.
    expect(plain(value('1.000000059604644775390625', { binary: 'float' }))).toEqual({ v: 1.0000000596046448 });
    expect(plain(value('1.0000000596046447753906249', { binary: 'float' }))).toEqual({ v: 1.0000000596046448 });
    // Above the midpoint the float is 1 + 2^-23, which the double 1 + 2^-24 does not read back as.
    expect(() => value('1.0000000596046447753906251', { binary: 'float' })).toThrow(JsonMappingError);
  });

  it('collapses whitespace of numbers and booleans, and uses the normalized value', () => {
    expect(plain(value('   123   ', { type: 'integer' }))).toEqual({ v: 123 });
    expect(plain(value(' true ', { type: 'boolean' }))).toEqual({ v: true });
    expect(plain(value('ENU ', { type: 'string', normalized: 'ENU' }))).toEqual({ v: 'ENU' });
    expect(toJson(element('', 'r', { children: [{ ...text('ENU '), normalized: 'ENU' }] }))).toBe('ENU');
  });
});

describe('reserved keys and the text property option', () => {
  it('keeps #type for xsi:type wherever the type has alternatives, used in the sample or not', () => {
    const member = element('', 'a', { children: [text('1')] });
    member.groups = [{ key: '#type', occurrence: 1 }];
    const typeable = { ...element('', 'R', { children: [member] }), typeable: true };
    expect(() => toJson(typeable)).toThrow(JsonMappingError);
    expect(
      plain(
        toJson({ ...element('', 'R', { children: [element('', 'a', { children: [text('1')] })] }), typeable: true }),
      ),
    ).toEqual({ a: '1' });
  });

  it('accepts an NCName other than __proto__, or #text, as textProperty', () => {
    const tree = {
      ...element('', 'P', { attributes: [attribute('', 'w', 'EUR')], children: [text('1')] }),
      simpleContent: true,
    };
    for (const name of ['{}value', '@value', '#type', '#sequence', '__proto__', 'a:b', '', '1x', 'a b'])
      expect(() => toJson(tree, { textProperty: name })).toThrow(TypeError);
    expect(plain(toJson(tree, { textProperty: '#text' }))).toEqual({ w: 'EUR', '#text': '1' });
    expect(plain(toJson(tree, { textProperty: 'Amount' }))).toEqual({ w: 'EUR', Amount: '1' });
  });

  it('writes no text property for a wildcard element with attributes and empty text', () => {
    const empty = wild(element('', 'w', { attributes: [attribute('', 'a', '1')], children: [text('')] }));
    expect(plain(toJson(element('', 'R', { children: [empty] })))).toEqual({ w: { a: '1' } });
  });

  it('keeps the float or double check over several text nodes', () => {
    const parts = [
      { ...text('2.7457332729808998', 'number'), binary: 'double' as const },
      { ...text('E126', 'number'), binary: 'double' as const },
    ];
    expect(toJson(element('', 'r', { children: parts }))).toBe(Number('2.7457332729808998E126'));
  });
});
