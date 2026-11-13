// Paths of expanded names into an instance tree: `/{urn:o}order/{urn:o}item[2]/@code`. A step names an element by
// namespace and local name, the last step may name an attribute. `{}local` has no namespace, a bare `local` matches
// any namespace, as the paths of `samples` do. Positions count elements of that name among their siblings, from 1.

import type { InstanceAttribute, InstanceElement } from '../xml/tree.js';

export interface ExpandedStep {
  /** namespace URI, '' for none; undefined matches any namespace */
  ns?: string;
  name: string;
  /** among the siblings of this name, from 1; default 1 */
  position?: number;
  /** the step names an attribute; only the last step may */
  attribute?: boolean;
}

export type ExpandedPath = readonly ExpandedStep[];

const STEP = /^(@)?(?:\{([^{}]*)\})?([^\s/@{}[\]()*]+)(?:\[([1-9][0-9]*)\])?$/;
const NAME = /^[^\s/@{}[\]()*]+$/;

/** Reads the text form of a path; throws a TypeError for one that is not well formed. */
export function parseExpandedPath(text: string): ExpandedPath {
  if (typeof text !== 'string' || !text.startsWith('/') || text.length < 2) {
    throw new TypeError(`a path starts with / and names at least one element: ${String(text)}`);
  }
  const steps: ExpandedStep[] = [];
  let depth = 0;
  let start = 1;
  for (let i = 1; i <= text.length; i += 1) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    if (depth < 0 || depth > 1) throw new TypeError(`unbalanced braces in ${text}`);
    if ((c === '/' && depth === 0) || i === text.length) {
      if (depth !== 0) throw new TypeError(`unbalanced braces in ${text}`);
      const part = text.slice(start, i);
      const m = STEP.exec(part);
      if (!m) throw new TypeError(`not a step of a path: "${part}" in ${text}`);
      if (m[4] !== undefined && !Number.isSafeInteger(Number(m[4]))) {
        throw new TypeError(`a position must be a safe integer: "${part}" in ${text}`);
      }
      const step: ExpandedStep = {
        ...(m[2] !== undefined ? { ns: m[2] } : {}),
        name: m[3] ?? '',
        ...(m[4] !== undefined && m[4] !== '1' ? { position: Number(m[4]) } : {}),
        ...(m[1] ? { attribute: true } : {}),
      };
      if (step.attribute && m[4] !== undefined) {
        throw new TypeError(`an attribute has no position: ${text}`);
      }
      steps.push(step);
      start = i + 1;
    }
  }
  if (steps.slice(0, -1).some((step) => step.attribute)) {
    throw new TypeError(`only the last step of a path may name an attribute: ${text}`);
  }
  return steps;
}

/**
 * The text form of a path: namespaces in braces, `{}` for none, positions from 2. Reading it gives the path back;
 * a path that has no such form, such as a namespace with a brace, throws a TypeError.
 */
export function formatExpandedPath(path: ExpandedPath): string {
  if (!Array.isArray(path) || path.length === 0) throw new TypeError('a path names at least one element');
  return path
    .map((step: ExpandedStep, i) => {
      if (typeof step !== 'object' || step === null) throw new TypeError('a step of a path must be an object');
      if (step.ns !== undefined && (typeof step.ns !== 'string' || /[{}]/.test(step.ns))) {
        throw new TypeError(`a namespace with a brace cannot be written in a path: ${String(step.ns)}`);
      }
      if (typeof step.name !== 'string' || !NAME.test(step.name)) {
        throw new TypeError(`not a name of a path: ${String(step.name)}`);
      }
      const position = step.position ?? 1;
      if (!Number.isSafeInteger(position) || position < 1) {
        throw new TypeError(`a position counts from 1: ${String(step.position)}`);
      }
      if (step.attribute && (i < path.length - 1 || position !== 1)) {
        throw new TypeError('only the last step of a path may name an attribute, without a position');
      }
      const ns = step.ns === undefined ? '' : `{${step.ns}}`;
      return `/${step.attribute ? '@' : ''}${ns}${step.name}${position > 1 ? `[${position}]` : ''}`;
    })
    .join('');
}

const matches = (step: ExpandedStep, node: { ns: string; name: string }): boolean =>
  node.name === step.name && (step.ns === undefined || step.ns === node.ns);

/** Where a path leads in a tree: the element, its parent and its index among the parent's children, or an attribute. */
export type Located =
  | { kind: 'element'; element: InstanceElement; parent?: InstanceElement; index: number }
  | { kind: 'attribute'; element: InstanceElement; attribute: InstanceAttribute; index: number };

export function locate(root: InstanceElement, path: ExpandedPath): Located | undefined {
  const [first, ...rest] = path;
  if (!first || first.attribute || !matches(first, root) || (first.position ?? 1) !== 1) return undefined;
  let current: Located = { kind: 'element', element: root, index: 0 };
  for (const step of rest) {
    if (current.kind !== 'element') return undefined;
    const element: InstanceElement = current.element;
    if (step.attribute) {
      const index = element.attributes.findIndex((a) => matches(step, a));
      const attribute = element.attributes[index];
      if (!attribute) return undefined;
      current = { kind: 'attribute', element, attribute, index };
      continue;
    }
    let seen = 0;
    const index = element.children.findIndex(
      (child) => child.kind === 'element' && matches(step, child) && (seen += 1) === (step.position ?? 1),
    );
    const child = element.children[index];
    if (child?.kind !== 'element') return undefined;
    current = { kind: 'element', element: child, parent: element, index };
  }
  return current;
}

/** The exact path of every element and attribute of a tree, the root first, each element before its attributes. */
export function* paths(
  root: InstanceElement,
): Generator<{ path: ExpandedStep[]; element: InstanceElement; attribute?: InstanceAttribute }> {
  const visit = function* (
    element: InstanceElement,
    path: ExpandedStep[],
  ): Generator<{ path: ExpandedStep[]; element: InstanceElement; attribute?: InstanceAttribute }> {
    yield { path, element };
    for (const attribute of element.attributes) {
      yield { path: [...path, { ns: attribute.ns, name: attribute.name, attribute: true }], element, attribute };
    }
    const counts = new Map<string, number>();
    for (const child of element.children) {
      if (child.kind !== 'element') continue;
      const key = `{${child.ns}}${child.name}`;
      const position = (counts.get(key) ?? 0) + 1;
      counts.set(key, position);
      yield* visit(child, [...path, { ns: child.ns, name: child.name, ...(position > 1 ? { position } : {}) }]);
    }
  };
  yield* visit(root, [{ ns: root.ns, name: root.name }]);
}
