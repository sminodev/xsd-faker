// The compact JSON forms of the shared JSON contract: each tree is the instance of a contract case's valid*.xml,
// with the metadata the walker records, and must give exactly its valid*.json.
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
    });
  });

  it('refuses a nil element whose attribute takes the text property', () => {
    const clash = nil(element(N, 'A', { attributes: [attribute('', 'value', 'x')] }));
    expect(() => toJson(element(N, 'R', { children: [clash] }))).toThrow(JsonMappingError);
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
          element(F, 'm', { children: [text('before'), element(F, 'b', { children: [text('bold')] }), text('after')] }),
        ),
        wild(element(F, 'empty')),
      ],
      [attribute(F, 'a', '1')],
    );
    expect(plain(toJson(tree, {}, prefixes))).toEqual({
      Head: 'k',
      Ext: {
        a: '1',
        x: ['one', ' more '],
        y: { b: '2', value: 'two' },
        z: { w: 'deep' },
        m: { value: 'before<f:b xmlns:f="urn:foreign">bold</f:b>after' },
        empty: '',
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

  it('refuses wildcard content named like a declared element or the text property', () => {
    const declared = element(A, 'R', {
      children: [element(A, 'Head', { children: [text('k')] }), wild(element(A, 'Head', { children: [text('w')] }))],
    });
    expect(() => toJson(declared)).toThrow(JsonMappingError);
    const named = ext([wild(element(F, 'value', { children: [text('v')] }))]);
    expect(() => toJson(named)).toThrow(JsonMappingError);
    const inner = ext([wild(element(F, 'o', { children: [element(F, 'value', { children: [text('v')] })] }))]);
    expect(() => toJson(inner)).toThrow(/text property/);
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
