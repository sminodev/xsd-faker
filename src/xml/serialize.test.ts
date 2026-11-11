import { DOMParser, type Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { escapeAttribute, planNamespaces, serializeMixed, serializeXml } from './serialize.js';
import { element, type InstanceElement, text } from './tree.js';

const A = 'urn:a';
const B = 'urn:b';

/** Parses the output again and lists every element as {namespace}name, to check what a parser reads. */
function readBack(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out: string[] = [];
  const walk = (e: Element) => {
    out.push(`{${e.namespaceURI ?? ''}}${e.localName}`);
    for (const a of [...e.attributes].filter((x) => !x.name.startsWith('xmlns'))) {
      out.push(`@{${a.namespaceURI ?? ''}}${a.localName}=${a.value}`);
    }
    for (const child of [...e.childNodes]) {
      if (child.nodeType === 1) {
        walk(child as Element);
      }
    }
  };
  if (doc.documentElement) {
    walk(doc.documentElement);
  }
  return out;
}

const order = (): InstanceElement =>
  element(A, 'Order', {
    attributes: [{ ns: '', name: 'version', value: '1.0', type: 'string' }],
    children: [
      element(A, 'Title', { children: [text('Books & more')] }),
      element(B, 'Note', { children: [text('x < y')] }),
    ],
  });

describe('planNamespaces', () => {
  it('uses the root namespace as default and prefixes for the others', () => {
    const plan = planNamespaces(order());
    expect(plan.defaultNs).toBe(A);
    expect([...plan.prefixes]).toEqual([[B, 'ns1']]);
  });

  it('takes preferred prefixes when they are free', () => {
    expect(planNamespaces(order(), new Map([[B, 'c']])).prefixes.get(B)).toBe('c');
    expect(planNamespaces(order(), new Map([[B, 'xml']])).prefixes.get(B)).toBe('ns1');
  });

  it('gives up the default namespace when an element has no namespace', () => {
    const tree = element(A, 'Root', { children: [element('', 'local')] });
    const plan = planNamespaces(tree);
    expect(plan.defaultNs).toBeUndefined();
    expect(plan.prefixes.get(A)).toBe('ns1');
  });

  it('keeps prefixes of QName values away from other namespaces', () => {
    const tree = element(A, 'Root', { children: [element(B, 'Item')] });
    tree.valueNamespaces = { c: 'urn:c' };
    expect(planNamespaces(tree, new Map([[B, 'c']])).prefixes.get(B)).toBe('ns1');
  });

  it('gives namespaced attributes a prefix even for the default namespace', () => {
    const tree = element(A, 'Root', { attributes: [{ ns: A, name: 'id', value: '1', type: 'string' }] });
    const plan = planNamespaces(tree);
    expect(plan.defaultNs).toBe(A);
    expect(plan.prefixes.get(A)).toBe('ns1');
  });
});

describe('serializeXml', () => {
  it('writes an indented document with escaped text', () => {
    expect(serializeXml(order())).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Order xmlns="urn:a" xmlns:ns1="urn:b" version="1.0">',
        '  <Title>Books &amp; more</Title>',
        '  <ns1:Note>x &lt; y</ns1:Note>',
        '</Order>',
        '',
      ].join('\n'),
    );
  });

  it('writes what a parser reads back with the same namespaces', () => {
    const tree = element(A, 'Root', {
      attributes: [{ ns: B, name: 'code', value: 'K', type: 'string' }],
      children: [element('', 'local', { children: [element(B, 'Item')] })],
    });
    expect(readBack(serializeXml(tree))).toEqual(['{urn:a}Root', '@{urn:b}code=K', '{}local', '{urn:b}Item']);
  });

  it('indents nothing inside mixed content', () => {
    const tree = element('', 'p', {
      children: [text('a '), element('', 'q', { children: [element('', 'r', { children: [text('x')] })] })],
    });
    expect(serializeXml(tree, { declaration: false })).toBe('<p>a <q><r>x</r></q></p>\n');
  });

  it('keeps text content unindented and writes empty elements short', () => {
    const tree = element('', 'p', {
      children: [text('a '), element('', 'b', { children: [text('bold')] }), element('', 'br')],
    });
    expect(serializeXml(tree, { declaration: false })).toBe('<p>a <b>bold</b><br/></p>\n');
  });

  it('adds the schema location', () => {
    expect(serializeXml(element(A, 'Root'), { declaration: false, schemaLocation: 'order.xsd' })).toBe(
      '<Root xmlns="urn:a" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:a order.xsd"/>\n',
    );
  });

  it('declares the prefixes of QName values on the element that holds them', () => {
    const tree = element('', 'Root', { children: [element('', 'Ref', { children: [text('c:Target')] })] });
    const ref = tree.children[0] as InstanceElement;
    ref.valueNamespaces = { c: 'urn:c' };
    expect(serializeXml(tree, { declaration: false, indent: '' })).toBe(
      '<Root><Ref xmlns:c="urn:c">c:Target</Ref></Root>\n',
    );
  });

  it('does not repeat a declaration the root already has', () => {
    const tree = element('', 'Root', { children: [element(B, 'Ref', { children: [text('c:Target')] })] });
    const ref = tree.children[0] as InstanceElement;
    ref.valueNamespaces = { c: B };
    expect(serializeXml(tree, { declaration: false, indent: '', prefixes: new Map([[B, 'c']]) })).toBe(
      '<Root xmlns:c="urn:b"><c:Ref>c:Target</c:Ref></Root>\n',
    );
  });

  it('writes mixed content with the document prefixes and the declarations each child needs', () => {
    const note = element(A, 'Note', {
      children: [
        text('Ring '),
        element(B, 'b', {
          children: [text('twice')],
          attributes: [{ ns: A, name: 'lang', value: 'de', type: 'string' }],
        }),
        text(' & '),
        element(A, 'i', { children: [element(B, 'u')] }),
        text('.'),
      ],
    });
    note.mixed = true;
    const root = element(A, 'Root', { children: [note] });
    const plan = planNamespaces(root, new Map([[B, 'c']]));
    expect(serializeMixed(note, plan)).toBe(
      'Ring <c:b xmlns:c="urn:b" xmlns:ns1="urn:a" ns1:lang="de">twice</c:b> &amp; ' +
        '<i xmlns="urn:a" xmlns:c="urn:b"><c:u/></i>.',
    );
    expect(serializeXml(root, { indent: '', declaration: false, prefixes: new Map([[B, 'c']]) })).toContain(
      '<Note>Ring <c:b ns1:lang="de">twice</c:b> &amp; <i><c:u/></i>.</Note>',
    );
  });

  it('escapes attribute values', () => {
    expect(escapeAttribute('a"b<c&d\ne')).toBe('a&quot;b&lt;c&amp;d&#10;e');
  });
});
