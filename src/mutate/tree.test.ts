import { describe, expect, it } from 'vitest';
import { element, text } from '../xml/tree.js';
import { mapNamespaces } from './namespaces.js';
import { parseExpandedPath } from './path.js';
import { applyTreeMutation } from './tree.js';

const order = () =>
  element('urn:o', 'order', {
    attributes: [{ ns: '', name: 'id', value: 'A1', type: 'string' }],
    children: [
      element('urn:o', 'date', { children: [text('2026-01-15')] }),
      element('urn:o', 'line', { children: [text('x')] }),
      element('urn:o', 'total', { children: [text('3')] }),
    ],
  });
const at = parseExpandedPath;

describe('applyTreeMutation', () => {
  it('changes a copy and names the elements around the change', () => {
    const tree = order();
    const removed = applyTreeMutation(tree, {
      op: 'remove',
      target: at('/order/line'),
      rule: 'structure:missing-element',
    });
    expect(removed).toMatchObject({
      status: 'applied',
      path: '/order/line',
      context: { target: '{urn:o}line', parent: '{urn:o}order', previous: '{urn:o}date', next: '{urn:o}total' },
    });
    expect(tree.children).toHaveLength(3);
  });

  it('repeats, swaps, inserts and adds attributes', () => {
    const repeated = applyTreeMutation(order(), {
      op: 'repeat',
      target: at('/order/line'),
      times: 2,
      rule: 'structure:too-many',
    });
    expect(repeated.status === 'applied' && repeated.tree.children.map((c) => c.kind === 'element' && c.name)).toEqual([
      'date',
      'line',
      'line',
      'line',
      'total',
    ]);
    expect(repeated).toMatchObject({
      context: { next: '{urn:o}total' },
      lines: { target: 4, inserted: [5, 6], next: 7 },
    });
    // Copies of the first of two elements: the validator reports the last one of the run.
    const run = order();
    run.children.splice(2, 0, element('urn:o', 'line', { children: [text('y')] }));
    expect(
      applyTreeMutation(run, { op: 'repeat', target: at('/order/line'), times: 1, rule: 'structure:too-many' }),
    ).toMatchObject({ lines: { target: 4, inserted: [5, 6], next: 6 } });
    const swapped = applyTreeMutation(order(), { op: 'swap-next', target: at('/order/date'), rule: 'structure:order' });
    expect(swapped.status === 'applied' && swapped.tree.children.map((c) => c.kind === 'element' && c.name)).toEqual([
      'line',
      'date',
      'total',
    ]);
    expect(swapped).toMatchObject({
      context: { target: '{urn:o}date', previous: '{urn:o}line', next: '{urn:o}total' },
      lines: { target: 4, previous: 3, next: 5 },
    });
    const node = element('urn:x', 'unknown');
    const inserted = applyTreeMutation(order(), {
      op: 'insert',
      after: at('/order/date'),
      node,
      rule: 'structure:unknown-element',
    });
    expect(inserted).toMatchObject({
      context: { inserted: '{urn:x}unknown', previous: '{urn:o}date', next: '{urn:o}line' },
      lines: { inserted: [4], next: 5 },
    });
    const into = applyTreeMutation(order(), {
      op: 'insert',
      into: at('/order'),
      node,
      rule: 'structure:unknown-element',
    });
    expect(into).toMatchObject({
      context: { parent: '{urn:o}order', previous: '{urn:o}total', inserted: '{urn:x}unknown' },
      lines: { parent: 2, previous: 5, inserted: [6] },
    });
    expect(into.status === 'applied' && into.context.next).toBeUndefined();
    const attribute = applyTreeMutation(order(), {
      op: 'add-attribute',
      target: at('/order'),
      attribute: { ns: '', name: 'extra', value: '1' },
      rule: 'structure:unknown-attribute',
    });
    expect(attribute).toMatchObject({ context: { target: '{urn:o}order', attribute: '{}extra' } });
  });

  it('sets values, nil and xsi:type', () => {
    const value = applyTreeMutation(order(), {
      op: 'set-value',
      target: at('/order/@id'),
      value: '1',
      rule: 'value:lexical',
    });
    expect(value.status === 'applied' && value.tree.attributes[0]?.value).toBe('1');
    const nil = applyTreeMutation(order(), {
      op: 'set-nil',
      target: at('/order/line'),
      keepContent: false,
      rule: 'structure:nil-not-nillable',
    });
    expect(nil.status === 'applied' && nil.tree.children[1]).toMatchObject({ nil: true, children: [] });
    const typed = applyTreeMutation(order(), {
      op: 'set-xsi-type',
      target: at('/order'),
      type: { ns: 'urn:o', name: 'Other' },
      rule: 'structure:foreign-xsi-type',
    });
    expect(typed.status === 'applied' && typed.tree.xsiType).toEqual({ ns: 'urn:o', name: 'Other' });
  });

  it('says why a change does not apply', () => {
    expect(
      applyTreeMutation(order(), { op: 'remove', target: at('/order'), rule: 'structure:missing-element' }),
    ).toEqual({
      status: 'not-applicable',
      reason: 'the root element cannot be removed',
    });
    expect(
      applyTreeMutation(order(), { op: 'remove', target: at('/order/none'), rule: 'structure:missing-element' }).status,
    ).toBe('not-applicable');
    expect(
      applyTreeMutation(order(), { op: 'swap-next', target: at('/order/total'), rule: 'structure:order' }).status,
    ).toBe('not-applicable');
    const twice = order();
    twice.children.splice(1, 0, element('urn:o', 'date'));
    expect(applyTreeMutation(twice, { op: 'swap-next', target: at('/order/date'), rule: 'structure:order' })).toEqual({
      status: 'not-applicable',
      reason: 'the next element has the same name',
    });
  });

  it('answers not-applicable, never throws, for a path without text form or an unknown change', () => {
    for (const ns of ['urn:}', 'urn:{']) {
      for (const mutation of [
        { op: 'remove', target: [{ ns, name: 'order' }], rule: 'structure:missing-element' },
        { op: 'set-value', target: [{ name: 'order' }, { ns, name: 'line' }], value: 'x', rule: 'facet:pattern' },
        { op: 'insert', after: [{ ns, name: 'order' }], node: element('', 'x'), rule: 'structure:unknown-element' },
      ] as const) {
        expect(applyTreeMutation(order(), mutation).status).toBe('not-applicable');
      }
    }
    for (const bogus of [{ op: 'bogus', target: at('/order') }, null, undefined, 42]) {
      expect(applyTreeMutation(order(), bogus as never).status).toBe('not-applicable');
    }
  });
});

describe('mapNamespaces', () => {
  it('rewrites elements, attributes, xsi:type, QName values and named attribute values', () => {
    const tree = element('urn:v1', 'order', {
      attributes: [{ ns: '', name: 'version', value: '1.0', type: 'string' }],
      children: [element('urn:v1', 'line')],
    });
    tree.xsiType = { ns: 'urn:v1', name: 'OrderType' };
    tree.valueNamespaces = { p: 'urn:v1' };
    const { tree: mapped, applied } = mapNamespaces(tree, {
      namespaces: { 'urn:v1': 'urn:v2' },
      attributes: { '{}version': '2.0' },
    });
    expect(mapped).toMatchObject({ ns: 'urn:v2', xsiType: { ns: 'urn:v2' }, valueNamespaces: { p: 'urn:v2' } });
    expect(mapped.children[0]).toMatchObject({ ns: 'urn:v2' });
    expect(mapped.attributes[0]?.value).toBe('2.0');
    expect(applied).toEqual(['urn:v1 -> urn:v2', '@{}version: 1.0 -> 2.0']);
    expect(tree.ns).toBe('urn:v1');
  });

  it('drops the binary form of a value it rewrites', () => {
    const tree = element('urn:v1', 'm', {
      attributes: [{ ns: '', name: 'rate', value: '1.5', type: 'number', binary: 'double' }],
    });
    const { tree: mapped } = mapNamespaces(tree, { namespaces: {}, attributes: { '{}rate': '2' } });
    expect(mapped.attributes[0]).toEqual({ ns: '', name: 'rate', value: '2', type: 'number' });
  });
});
