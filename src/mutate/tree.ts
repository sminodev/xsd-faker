// Applies mutations to a copy of an instance tree: values, element counts and order, unknown content, xsi:nil
// and xsi:type. The caller supplies the schema constraints needed to choose a mutation; the input is unchanged.

import { elementLines, type SerializeOptions } from '../xml/serialize.js';
import type { InstanceElement } from '../xml/tree.js';
import { type ExpandedPath, formatExpandedPath, locate } from './path.js';
import type { IdentityRule, NilRule, ValueRule } from './rules.js';
export type TreeMutation =
  /** the text of an element of simple content, or the value of an attribute */
  | { op: 'set-value'; target: ExpandedPath; value: string; rule: ValueRule | IdentityRule }
  | { op: 'remove'; target: ExpandedPath; rule: 'structure:missing-element' | 'structure:missing-attribute' }
  /** adds `times` copies of the element directly after it */
  | { op: 'repeat'; target: ExpandedPath; times: number; rule: 'structure:too-many' }
  /** swaps the element with the element right after it, which must have another name */
  | { op: 'swap-next'; target: ExpandedPath; rule: 'structure:order' }
  /** a further element: directly after `after`, or as the last child of `into` */
  | {
      op: 'insert';
      after?: ExpandedPath;
      into?: ExpandedPath;
      node: InstanceElement;
      rule: 'structure:second-branch' | 'structure:unknown-element';
    }
  | {
      op: 'add-attribute';
      target: ExpandedPath;
      attribute: { ns: string; name: string; value: string };
      rule: 'structure:unknown-attribute';
    }
  /** xsi:nil="true"; without `keepContent`, the element loses its content and keeps its attributes */
  | { op: 'set-nil'; target: ExpandedPath; keepContent: boolean; rule: NilRule }
  | {
      op: 'set-xsi-type';
      target: ExpandedPath;
      type: { ns: string; name: string };
      rule: 'structure:foreign-xsi-type';
    };

/** The elements around a change in the changed tree, as `{ns}local`; a validator message names one of them. */
export interface MutationContext {
  /** the changed element, or the element of a changed attribute */
  target: string;
  /** the changed attribute, as `{ns}local` */
  attribute?: string;
  parent?: string;
  /** the element before the change point */
  previous?: string;
  /** the element after the change point */
  next?: string;
  /** an element the change added */
  inserted?: string;
  /** a value the change wrote */
  value?: string;
}

/** The lines of the elements of the context, as `serializeXml` writes the changed tree with its default layout. */
export interface MutationLines {
  target?: number;
  parent?: number;
  previous?: number;
  next?: number;
  /** each element the change added; for `repeat`, every element of that name from the first copy to the end of the run */
  inserted?: number[];
}

export interface AppliedMutation {
  status: 'applied';
  tree: InstanceElement;
  mutation: TreeMutation;
  /** the path of the change, exact, in text form */
  path: string;
  context: MutationContext;
  /** set by `applyTreeMutation`; without it, the classifier ties messages to the change by name and value */
  lines?: MutationLines;
}

export type TreeMutationResult = AppliedMutation | { status: 'not-applicable'; reason: string };

const name = (e: { ns: string; name: string }) => `{${e.ns}}${e.name}`;

/** Human-readable path for diagnostics, including paths that have no serializable form. */
const described = (path: ExpandedPath): string =>
  path
    .map((step) => `/${step.attribute ? '@' : ''}${step.ns === undefined ? '' : `{${step.ns}}`}${step.name}`)
    .join('');

const OPS = new Set([
  'set-value',
  'remove',
  'repeat',
  'swap-next',
  'insert',
  'add-attribute',
  'set-nil',
  'set-xsi-type',
]);

/** Applies a change to a copy of the tree. */
export function applyTreeMutation(tree: InstanceElement, mutation: TreeMutation): TreeMutationResult {
  return mutate(tree, mutation, {});
}

/** Applies a mutation and records context line numbers using the caller's serialization layout. */
export function mutate(tree: InstanceElement, mutation: TreeMutation, layout: SerializeOptions): TreeMutationResult {
  const no = (reason: string): TreeMutationResult => ({ status: 'not-applicable', reason });
  if (typeof mutation !== 'object' || mutation === null || !OPS.has((mutation as { op?: unknown }).op as string)) {
    const op = (mutation as { op?: unknown } | null)?.op;
    return no(`not a change: ${typeof op === 'string' ? op : typeof mutation}`);
  }
  const where = mutation.op === 'insert' ? (mutation.after ?? mutation.into) : mutation.target;
  if (!where) return no('insert needs after or into');
  let path: string;
  try {
    path = formatExpandedPath(where);
  } catch (error) {
    return no(`the path has no text form: ${(error as Error).message}`);
  }
  const copy = structuredClone(tree);
  const found = locate(copy, where);
  if (!found) return no(`no node at ${described(where)}`);
  /** The context by element, named and with its line once the change is done. */
  interface Around {
    target: InstanceElement;
    attribute?: string;
    parent?: InstanceElement;
    previous?: InstanceElement;
    next?: InstanceElement;
    inserted?: InstanceElement[];
    value?: string;
  }
  const done = (around: Around): TreeMutationResult => {
    const lines = elementLines(copy, layout);
    const line = (e: InstanceElement | undefined) => (e === undefined ? undefined : lines.get(e));
    const context: MutationContext = { target: name(around.target) };
    const at: MutationLines = {};
    const own = line(around.target);
    if (own !== undefined) at.target = own;
    if (around.attribute !== undefined) context.attribute = around.attribute;
    for (const role of ['parent', 'previous', 'next'] as const) {
      const e = around[role];
      if (!e) continue;
      context[role] = name(e);
      const n = line(e);
      if (n !== undefined) at[role] = n;
    }
    if (around.inserted?.[0]) {
      context.inserted = name(around.inserted[0]);
      at.inserted = around.inserted.map(line).filter((n): n is number => n !== undefined);
    }
    if (around.value !== undefined) context.value = around.value;
    return { status: 'applied', tree: copy, mutation, path, context, lines: at };
  };
  const elementAt = (parent: InstanceElement, index: number, step: 1 | -1): InstanceElement | undefined => {
    for (let i = index; i >= 0 && i < parent.children.length; i += step) {
      const child = parent.children[i];
      if (child?.kind === 'element') return child;
    }
    return undefined;
  };

  if (found.kind === 'attribute') {
    const { element, attribute, index } = found;
    const around = { target: element, attribute: name(attribute) };
    if (mutation.op === 'set-value') {
      attribute.value = mutation.value;
      delete attribute.normalized;
      delete attribute.binary;
      return done({ ...around, value: mutation.value });
    }
    if (mutation.op === 'remove') {
      element.attributes.splice(index, 1);
      return done(around);
    }
    return no(`${mutation.op} does not apply to an attribute`);
  }

  const { element, parent, index } = found;
  switch (mutation.op) {
    case 'set-value': {
      if (element.children.some((c) => c.kind === 'element') || element.mixed) {
        return no('the element has element content');
      }
      const text = element.children.find((c) => c.kind === 'text');
      if (text?.kind === 'text') {
        text.value = mutation.value;
        delete text.normalized;
        delete text.binary;
      } else {
        element.children = [{ kind: 'text', value: mutation.value, type: 'string' }];
      }
      return done({ target: element, value: mutation.value });
    }
    case 'remove': {
      if (!parent) return no('the root element cannot be removed');
      parent.children.splice(index, 1);
      const previous = elementAt(parent, index - 1, -1);
      const next = elementAt(parent, index, 1);
      return done({ target: element, parent, ...(previous ? { previous } : {}), ...(next ? { next } : {}) });
    }
    case 'repeat': {
      if (!parent) return no('the root element cannot repeat');
      if (!Number.isSafeInteger(mutation.times) || mutation.times < 1 || mutation.times > 1000) {
        return no('times must be an integer from 1 to 1000');
      }
      const copies = Array.from({ length: mutation.times }, () => structuredClone(element));
      parent.children.splice(index + 1, 0, ...copies);
      const next = elementAt(parent, index + 1 + mutation.times, 1);
      // The validator reports the first element beyond maxOccurs, which is the last of the run of that name: every
      // element of the name from the first copy to the end of the run counts as added.
      const run: InstanceElement[] = [];
      for (const child of parent.children.slice(index + 1)) {
        if (child.kind !== 'element') continue;
        if (name(child) !== name(element)) break;
        run.push(child);
      }
      return done({ target: element, parent, previous: element, inserted: run, ...(next ? { next } : {}) });
    }
    case 'swap-next': {
      if (!parent) return no('the root element has no siblings');
      const offset = parent.children.slice(index + 1).findIndex((c) => c.kind === 'element');
      const other = parent.children[index + 1 + offset];
      if (offset < 0 || other?.kind !== 'element') return no('no element after it');
      if (name(other) === name(element)) return no('the next element has the same name');
      parent.children[index] = other;
      parent.children[index + 1 + offset] = element;
      const next = elementAt(parent, index + 2 + offset, 1);
      return done({ target: element, parent, previous: other, ...(next ? { next } : {}) });
    }
    case 'insert': {
      const node = structuredClone(mutation.node);
      if (mutation.after) {
        if (!parent) return no('nothing can follow the root element');
        const next = elementAt(parent, index + 1, 1);
        parent.children.splice(index + 1, 0, node);
        return done({ target: element, parent, previous: element, inserted: [node], ...(next ? { next } : {}) });
      }
      if (element.children.some((c) => c.kind === 'text' && c.value.trim() !== '') && !element.mixed) {
        return no('the element has simple content');
      }
      element.children = element.children.filter((c) => c.kind === 'element' || element.mixed);
      const previous = elementAt(element, element.children.length - 1, -1);
      element.children.push(node);
      return done({ target: element, parent: element, inserted: [node], ...(previous ? { previous } : {}) });
    }
    case 'add-attribute': {
      const { ns, name: local, value } = mutation.attribute;
      if (element.attributes.some((a) => a.ns === ns && a.name === local)) return no('the attribute is already there');
      element.attributes.push({ ns, name: local, value, type: 'string' });
      return done({ target: element, attribute: `{${ns}}${local}` });
    }
    case 'set-nil': {
      if (element.nil) return no('the element is nil already');
      element.nil = true;
      if (!mutation.keepContent) element.children = [];
      else if (element.children.length === 0) return no('the element has no content to keep');
      return done({ target: element });
    }
    case 'set-xsi-type': {
      element.xsiType = { ...mutation.type };
      return done({ target: element, value: `{${mutation.type.ns}}${mutation.type.name}` });
    }
    default:
      return no('not a change');
  }
}
