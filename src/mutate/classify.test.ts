import { describe, expect, it } from 'vitest';
import { validateXml } from '../validate/xmllint.js';
import { serializeXml } from '../xml/serialize.js';
import { element, type InstanceElement, text } from '../xml/tree.js';
import { classifyVerdict, parseDiagnostic } from './classify.js';
import { parseExpandedPath } from './path.js';
import { type AppliedMutation, applyTreeMutation, type TreeMutation } from './tree.js';

const E = 'Schemas validity error : ';
const tree = element('urn:t', 'r', {
  children: [element('urn:t', 'a', { children: [text('1')] }), element('urn:t', 'b', { children: [text('2')] })],
});
const applied = (mutation: TreeMutation): AppliedMutation => {
  const result = applyTreeMutation(tree, mutation);
  if (result.status !== 'applied') throw new Error(result.reason);
  return result;
};
const missingA = applied({ op: 'remove', target: parseExpandedPath('/r/a'), rule: 'structure:missing-element' });

describe('parseDiagnostic', () => {
  it('reads node, attribute, rule and expected elements', () => {
    expect(parseDiagnostic(`${E}Element '{urn:t}b': This element is not expected. Expected is ( {urn:t}a ).`)).toEqual({
      node: '{urn:t}b',
      kind: 'not-expected',
      expected: ['{urn:t}a'],
    });
    expect(
      parseDiagnostic(
        `${E}Element 'r', attribute 'n': [facet 'maxLength'] The value 'abc' has a length of '3'; this exceeds the allowed maximum length of '2'.`,
      ),
    ).toEqual({
      node: '{}r',
      attribute: '{}n',
      rule: 'facet:maxLength',
      value: 'abc',
    });
    expect(parseDiagnostic(`${E}Element '{urn:t}r': The attribute 'req' is required but missing.`)).toEqual({
      node: '{urn:t}r',
      attribute: '{}req',
      rule: 'structure:missing-attribute',
    });
    expect(parseDiagnostic('parser error : Premature end of data')).toEqual({});
    for (const odd of [null, undefined, 42, {}]) expect(parseDiagnostic(odd as never)).toEqual({});
  });
});

describe('classifyVerdict', () => {
  it('confirms a missing element reported at its next sibling or at its parent', () => {
    const next = {
      valid: false,
      errors: [`${E}Element '{urn:t}b': This element is not expected. Expected is ( {urn:t}a ).`],
    };
    expect(classifyVerdict(next, missingA).status).toBe('confirmed');
    const missingB = applied({ op: 'remove', target: parseExpandedPath('/r/b'), rule: 'structure:missing-element' });
    const parent = {
      valid: false,
      errors: [`${E}Element '{urn:t}r': Missing child element(s). Expected is ( {urn:t}b ).`],
    };
    expect(classifyVerdict(parent, missingB).status).toBe('confirmed');
  });

  it('takes a missing element after a counted particle, which libxml2 does not name', () => {
    const missingB = applied({ op: 'remove', target: parseExpandedPath('/r/b'), rule: 'structure:missing-element' });
    const parent = {
      valid: false,
      errors: [`${E}Element '{urn:t}r': Missing child element(s). Expected is ( {urn:t}a ).`],
    };
    expect(classifyVerdict(parent, missingB).status).toBe('confirmed');
  });

  it('takes a missing element that a full list of expected elements leaves out', () => {
    const missingB = applied({ op: 'remove', target: parseExpandedPath('/r/b'), rule: 'structure:missing-element' });
    const ten = Array.from({ length: 10 }, (_, i) => `{urn:t}o${i}`).join(', ');
    const full = {
      valid: false,
      errors: [`${E}Element '{urn:t}r': Missing child element(s). Expected is one of ( ${ten} ).`],
    };
    expect(classifyVerdict(full, missingB).status).toBe('confirmed');
    const nine = Array.from({ length: 9 }, (_, i) => `{urn:t}o${i}`).join(', ');
    const short = {
      valid: false,
      errors: [`${E}Element '{urn:t}r': Missing child element(s). Expected is one of ( ${nine} ).`],
    };
    expect(classifyVerdict(short, missingB).status).toBe('other-cause');
  });

  it('takes a missing element reported without a list of expected elements', () => {
    const missingB = applied({ op: 'remove', target: parseExpandedPath('/r/b'), rule: 'structure:missing-element' });
    const bare = { valid: false, errors: [`${E}Element '{urn:t}r': Missing child element(s).`] };
    expect(classifyVerdict(bare, missingB).status).toBe('confirmed');
  });

  it('reads a message that runs over several lines as one', () => {
    const value = applied({ op: 'set-value', target: parseExpandedPath('/r/a'), value: 'x', rule: 'facet:pattern' });
    const verdict = {
      valid: false,
      errors: [`${E}Element '{urn:t}a': [facet 'pattern'] The value 'x' is not accepted by the pattern '[`, `]+'.`],
      lines: [3, undefined],
    };
    const result = classifyVerdict(verdict, value);
    expect(result.status).toBe('confirmed');
    expect(result.diagnostics).toHaveLength(1);
  });

  it('needs every message to fit', () => {
    const verdict = {
      valid: false,
      errors: [
        `${E}Element '{urn:t}b': This element is not expected. Expected is ( {urn:t}a ).`,
        `${E}Element '{urn:t}b': [facet 'pattern'] The value '2' is not accepted by the pattern 'x'.`,
      ],
      lines: [3, 3],
    };
    const result = classifyVerdict(verdict, missingA);
    expect(result.status).toBe('other-cause');
    expect(result.diagnostics.map((d) => [d.matches, d.line])).toEqual([
      [true, 3],
      [false, 3],
    ]);
  });

  it('tells a message about the wrong element from the right one', () => {
    const verdict = {
      valid: false,
      errors: [`${E}Element '{urn:t}r': Missing child element(s). Expected is ( {urn:t}c ).`],
    };
    expect(classifyVerdict(verdict, missingA).status).toBe('other-cause');
  });

  it('reports accepted documents, unknown messages and references', () => {
    expect(classifyVerdict({ valid: true, errors: [] }, missingA).status).toBe('accepted');
    expect(classifyVerdict({ valid: false, errors: ['something else'] }, missingA).status).toBe('not-checkable');
    const dangling = applied({
      op: 'set-value',
      target: parseExpandedPath('/r/a'),
      value: 'ghost',
      rule: 'identity:dangling-idref',
    });
    expect(classifyVerdict({ valid: true, errors: [] }, dangling).status).toBe('not-checkable');
    expect(
      classifyVerdict({ valid: true, errors: [] }, dangling, { integrity: ['the reference ghost names no ID'] }).status,
    ).toBe('confirmed');
    expect(
      classifyVerdict({ valid: true, errors: [] }, dangling, {
        integrity: ['the reference ghost names no ID', 'the reference other names no ID'],
      }).status,
    ).toBe('other-cause');
  });

  it('takes an ID check that finds another cause as other-cause', () => {
    const value = applied({ op: 'set-value', target: parseExpandedPath('/r/a'), value: 'x', rule: 'facet:pattern' });
    const verdict = {
      valid: false,
      errors: [`${E}Element '{urn:t}a': [facet 'pattern'] The value 'x' is not accepted by the pattern 'y'.`],
      lines: [3],
    };
    expect(classifyVerdict(verdict, value).status).toBe('confirmed');
    expect(classifyVerdict(verdict, value, { integrity: ['reference "k" at /r/b names no ID'] })).toMatchObject({
      status: 'other-cause',
      reason: 'the ID check reports another cause',
    });
  });

  it('needs a message that states the rule, not only one that accompanies it', () => {
    const value = applied({ op: 'set-value', target: parseExpandedPath('/r/a'), value: 'x', rule: 'facet:maxLength' });
    const items = {
      valid: false,
      errors: [`${E}Element '{urn:t}a': 'x' is not a valid value of the local list type.`],
    };
    expect(classifyVerdict(items, value)).toMatchObject({
      status: 'other-cause',
      reason: 'no message states the rule itself',
    });
    const typed = applied({
      op: 'set-xsi-type',
      target: parseExpandedPath('/r/a'),
      type: { ns: 'urn:t', name: 'T' },
      rule: 'structure:foreign-xsi-type',
    });
    const abstract = { valid: false, errors: [`${E}Element '{urn:t}a': The type definition is abstract.`] };
    expect(classifyVerdict(abstract, typed).status).toBe('other-cause');
  });

  it('reads a surplus element reported without a list of expected elements', () => {
    expect(parseDiagnostic(`${E}Element 'a': This element is not expected.`)).toEqual({
      node: '{}a',
      kind: 'not-expected',
    });
    const next = { valid: false, errors: [`${E}Element '{urn:t}b': This element is not expected.`] };
    expect(classifyVerdict(next, missingA).status).toBe('confirmed');
  });

  it('is not-checkable without a message, and reads a line with a head of its own as a message', () => {
    const value = applied({ op: 'set-value', target: parseExpandedPath('/r/a'), value: 'y', rule: 'facet:pattern' });
    const fitting = `${E}Element '{urn:t}a': [facet 'pattern'] The value 'y' is not accepted by the pattern 'x'.`;
    expect(classifyVerdict({ valid: false, errors: [] }, value).status).toBe('not-checkable');
    expect(
      classifyVerdict({ valid: false, errors: [fitting, 'internal error: xmlSchemaVDocWalk'] }, value).status,
    ).toBe('not-checkable');
    expect(
      classifyVerdict(
        { valid: false, errors: [fitting, "Element '{urn:t}other': This element is not expected."] },
        value,
      ).status,
    ).toBe('other-cause');
  });

  it('tells the changed value from another one in the messages', () => {
    const value = applied({ op: 'set-value', target: parseExpandedPath('/r/a'), value: 'y', rule: 'facet:pattern' });
    const quote = (v: string) =>
      `${E}Element '{urn:t}a': [facet 'pattern'] The value '${v}' is not accepted by the pattern 'x'.`;
    expect(classifyVerdict({ valid: false, errors: [quote('y'), quote('OTHER')], lines: [3, 9] }, value).status).toBe(
      'other-cause',
    );
    expect(classifyVerdict({ valid: false, errors: [quote('OTHER')], lines: [3] }, value).status).toBe('other-cause');
    expect(classifyVerdict({ valid: false, errors: [quote('y')], lines: [9] }, value).status).toBe('other-cause');
  });

  it('takes the second of two equal IDs wherever the validator reports it', () => {
    const duplicate = applied({
      op: 'set-value',
      target: parseExpandedPath('/r/a'),
      value: 'k',
      rule: 'identity:duplicate-id',
    });
    const verdict = {
      valid: false,
      errors: [`${E}Element '{urn:t}b': 'k' is not a valid value of the atomic type 'xs:ID'.`],
    };
    expect(classifyVerdict(verdict, duplicate).status).toBe('confirmed');
  });
});

describe('classifyVerdict with the messages of the validator', () => {
  const XS = 'http://www.w3.org/2001/XMLSchema';
  const judge = async (xsd: string, change: AppliedMutation) => {
    const schemas = { entry: 's.xsd', files: new Map([['s.xsd', `<xs:schema xmlns:xs="${XS}">${xsd}</xs:schema>`]]) };
    const [verdict] = await validateXml(schemas, [serializeXml(change.tree)]);
    return classifyVerdict(verdict ?? { valid: true, errors: [] }, change).status;
  };
  const apply = (base: InstanceElement, mutation: TreeMutation): AppliedMutation => {
    const result = applyTreeMutation(base, mutation);
    if (result.status !== 'applied') throw new Error(result.reason);
    return result;
  };
  const at = parseExpandedPath;
  const code =
    '<xs:simpleType><xs:restriction base="xs:string"><xs:pattern value="[A-Z]{3}"/></xs:restriction></xs:simpleType>';
  const items = `<xs:element name="doc"><xs:complexType><xs:sequence><xs:element name="item" minOccurs="2" maxOccurs="2">
    <xs:complexType><xs:sequence><xs:element name="code">${code}</xs:element></xs:sequence></xs:complexType>
    </xs:element></xs:sequence></xs:complexType></xs:element>`;
  const doc = () =>
    element('', 'doc', {
      children: [1, 2].map(() => element('', 'item', { children: [element('', 'code', { children: [text('ABC')] })] })),
    });

  it('tells two elements of one name apart by their lines', async () => {
    const other = apply(doc(), {
      op: 'set-value',
      target: at('/doc/item[2]/code'),
      value: 'zz9',
      rule: 'facet:pattern',
    });
    const both = apply(other.tree, {
      op: 'set-value',
      target: at('/doc/item/code'),
      value: 'q',
      rule: 'facet:pattern',
    });
    expect(await judge(items, both)).toBe('other-cause');
    const unchanged = apply(other.tree, {
      op: 'set-value',
      target: at('/doc/item/code'),
      value: 'ABC',
      rule: 'facet:pattern',
    });
    expect(await judge(items, unchanged)).toBe('other-cause');
    const alone = apply(doc(), { op: 'set-value', target: at('/doc/item/code'), value: 'q', rule: 'facet:pattern' });
    expect(await judge(items, alone)).toBe('confirmed');
    const attribute = {
      attribute: { ns: '', name: 'unknown', value: 'x' },
      rule: 'structure:unknown-attribute',
    } as const;
    const first = apply(doc(), { op: 'add-attribute', target: at('/doc/item[2]'), ...attribute });
    expect(await judge(items, apply(first.tree, { op: 'add-attribute', target: at('/doc/item'), ...attribute }))).toBe(
      'other-cause',
    );
  });

  it('tells a missing element of one group from the same element missing in another', async () => {
    const group = (n: string) =>
      `<xs:element name="${n}"><xs:complexType><xs:sequence><xs:element name="A" type="xs:string"/><xs:element name="B" type="xs:string"/></xs:sequence></xs:complexType></xs:element>`;
    const xsd = `<xs:element name="doc"><xs:complexType><xs:sequence>${group('g1')}${group('g2')}</xs:sequence></xs:complexType></xs:element>`;
    const base = element('', 'doc', {
      children: ['g1', 'g2'].map((g) =>
        element('', g, { children: ['A', 'B'].map((n) => element('', n, { children: [text('x')] })) }),
      ),
    });
    const second = apply(base, { op: 'remove', target: at('/doc/g2/A'), rule: 'structure:missing-element' });
    expect(
      await judge(
        xsd,
        apply(second.tree, { op: 'remove', target: at('/doc/g1/A'), rule: 'structure:missing-element' }),
      ),
    ).toBe('other-cause');
    expect(
      await judge(xsd, apply(base, { op: 'remove', target: at('/doc/g1/A'), rule: 'structure:missing-element' })),
    ).toBe('confirmed');
  });
});
