import { describe, expect, it } from 'vitest';
import { element, text } from '../xml/tree.js';
import { formatExpandedPath, locate, parseExpandedPath, paths } from './path.js';

describe('expanded paths', () => {
  it('read namespaces, positions and a final attribute', () => {
    expect(parseExpandedPath('/{urn:o}order/{urn:o}item[2]/@{}code')).toEqual([
      { ns: 'urn:o', name: 'order' },
      { ns: 'urn:o', name: 'item', position: 2 },
      { ns: '', name: 'code', attribute: true },
    ]);
    expect(parseExpandedPath('/order/@code')).toEqual([{ name: 'order' }, { name: 'code', attribute: true }]);
    expect(parseExpandedPath('/{http://example.org/a/b}order')).toEqual([
      { ns: 'http://example.org/a/b', name: 'order' },
    ]);
  });

  it('write the form they were read from', () => {
    for (const text of ['/{urn:o}order/{urn:o}item[2]/@{}code', '/order/{}item', '/{a/b}x[3]']) {
      expect(formatExpandedPath(parseExpandedPath(text))).toBe(text);
    }
    expect(formatExpandedPath(parseExpandedPath('/{urn:o}order[1]'))).toBe('/{urn:o}order');
  });

  it('reject what is not a path', () => {
    for (const bad of [
      'order',
      '/',
      '/a/@b/c',
      '/a/@b[2]',
      '/a/@b[1]',
      '/a[0]',
      '/{urn:o',
      '/a b',
      '/a}/b',
      '/{a}}b',
      '/{a{b}}c',
      '/a/text()',
      '/a/*',
    ]) {
      expect(() => parseExpandedPath(bad), bad).toThrow(TypeError);
    }
  });

  it('refuse a position beyond the safe integers when reading', () => {
    expect(() => parseExpandedPath('/R/Item[9007199254740993]')).toThrow(/safe integer/);
    expect(parseExpandedPath('/R/Item[9007199254740991]')[1]?.position).toBe(9007199254740991);
  });

  it('refuse to write a path that does not read back', () => {
    for (const bad of [
      [{ ns: 'urn:{a', name: 'x' }],
      [{ ns: 'urn:a}', name: 'x' }],
      [{ name: 'a b' }],
      [{ name: '' }],
      [{ name: 'x', position: 0 }],
      [{ name: 'x', position: 1.5 }],
      [{ name: 'x', attribute: true }, { name: 'y' }],
      [{ name: 'x' }, { name: 'y', attribute: true, position: 2 }],
      [],
    ]) {
      expect(() => formatExpandedPath(bad), JSON.stringify(bad)).toThrow(TypeError);
    }
  });

  it('lead to elements and attributes, a bare name in any namespace', () => {
    const tree = element('urn:o', 'order', {
      children: [
        element('urn:o', 'item'),
        element('urn:o', 'item', { attributes: [{ ns: '', name: 'code', value: 'x', type: 'string' }] }),
      ],
    });
    const found = locate(tree, parseExpandedPath('/order/item[2]/@code'));
    expect(found?.kind === 'attribute' && found.attribute.value).toBe('x');
    expect(locate(tree, parseExpandedPath('/{urn:x}order'))).toBeUndefined();
    expect(locate(tree, parseExpandedPath('/order/item[3]'))).toBeUndefined();
  });

  it('list every node with its exact path', () => {
    const tree = element('', 'a', { children: [element('', 'b', { children: [text('1')] }), element('', 'b')] });
    expect([...paths(tree)].map((p) => formatExpandedPath(p.path))).toEqual(['/{}a', '/{}a/{}b', '/{}a/{}b[2]']);
  });
});
