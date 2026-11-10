import { DOMParser, type Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { escapeAttribute, planNamespaces, serializeXml } from './serialize.js';
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

  it('escapes attribute values', () => {
    expect(escapeAttribute('a"b<c&d\ne')).toBe('a&quot;b&lt;c&amp;d&#10;e');
  });
});
