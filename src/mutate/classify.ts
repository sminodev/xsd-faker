// Reads the messages of libxml2 and decides whether a rejected document was rejected for the rule its mutation
// aims at. A message alone is not enough: "This element is not expected" follows a missing element, a surplus one,
// a wrong order, an unknown element and a second branch of a choice alike. So each message is judged against the
// change: which element it names, on which line, with which value, and which elements stand around the change. Every
// message of a document has to fit, and one of them has to state the rule itself.

import type { Verdict } from '../validate/xmllint.js';
import { splitXmlSpace } from '../xml/space.js';
import type { Rule } from './rules.js';
import type { AppliedMutation } from './tree.js';

export interface Diagnostic {
  /** the element the message is about, as `{ns}local` */
  node?: string;
  /** the attribute the message is about, as `{ns}local` */
  attribute?: string;
  /** the rule the message names on its own; structural messages that several rules cause name none */
  rule?: Rule;
  /** what the message says, where several rules share it */
  kind?:
    | 'not-expected'
    | 'missing-child'
    | 'invalid-value'
    | 'invalid-items'
    | 'empty-content'
    | 'abstract-type'
    | 'no-key-value';
  /** the elements libxml2 expected instead, as `{ns}local` */
  expected?: string[];
  /** the value the message quotes */
  value?: string;
  /** the type the message names for an invalid value, such as `xs:int` */
  type?: string;
}

export type ConfirmationStatus = 'confirmed' | 'other-cause' | 'accepted' | 'not-checkable';

export interface Classification {
  status: ConfirmationStatus;
  diagnostics: (Diagnostic & { message: string; line?: number; matches: boolean })[];
  reason?: string;
}

const FACETS = new Set([
  'length',
  'minLength',
  'maxLength',
  'pattern',
  'enumeration',
  'minInclusive',
  'maxInclusive',
  'minExclusive',
  'maxExclusive',
  'totalDigits',
  'fractionDigits',
]);

/** libxml2 names at most this many expected elements; the one that is missing may be cut off. */
const EXPECTED_LIMIT = 10;

/** `local` and `{ns}local` as libxml2 writes them, always as `{ns}local`. */
const expanded = (name: string): string => (name.startsWith('{') ? name : `{}${name}`);

const names = (list: string): string[] =>
  list
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map(expanded);

/** What one libxml2 message says. Unknown messages, and anything but a string, give an empty result. */
export function parseDiagnostic(message: string): Diagnostic {
  if (typeof message !== 'string') return {};
  const text = message.replace(/^Schemas validity (?:error|warning) : /, '');
  const head = /^Element '([^']+)'(?:, attribute '([^']+)')?: ([\s\S]*)$/.exec(text);
  if (!head) return {};
  const node = expanded(head[1] ?? '');
  const where: Diagnostic = {
    node,
    ...(head[2] !== undefined ? { attribute: expanded(head[2]) } : {}),
  };
  const body = head[3] ?? '';
  let m: RegExpExecArray | null;
  if ((m = /^\[facet '(\w+)'\] /.exec(body)) && FACETS.has(m[1] ?? '')) {
    const value = /The value '([\s\S]*?)' /.exec(body)?.[1];
    return { ...where, rule: `facet:${m[1]}` as Rule, ...(value !== undefined ? { value } : {}) };
  }
  if ((m = /^'([\s\S]*)' is not a valid value of the (local )?(atomic|list|union) type(?: '([^']*)')?\.$/.exec(body))) {
    const aggregate = m[3] !== 'atomic';
    return {
      ...where,
      kind: aggregate ? 'invalid-items' : 'invalid-value',
      value: m[1] ?? '',
      ...(m[4] !== undefined ? { type: m[4] } : {}),
    };
  }
  if ((m = /^The (?:actual )?value '([\s\S]*)' does not match the fixed value constraint '[\s\S]*'\.$/.exec(body))) {
    return { ...where, rule: 'value:fixed', value: m[1] ?? '' };
  }
  if ((m = /^This element is not expected\.(?: Expected is (?:one of )?\( ([\s\S]*) \)\.)?$/.exec(body))) {
    return { ...where, kind: 'not-expected', ...(m[1] !== undefined ? { expected: names(m[1]) } : {}) };
  }
  if (/^(?:Character|Element) content is not allowed, because the content type is empty\.$/.test(body)) {
    return { ...where, kind: 'empty-content' };
  }
  if (body === 'The type definition is abstract.') return { ...where, kind: 'abstract-type' };
  if ((m = /^Missing child element\(s\)\.(?: Expected is (?:one of )?\( ([\s\S]*) \)\.)?$/.exec(body))) {
    return { ...where, kind: 'missing-child', ...(m[1] !== undefined ? { expected: names(m[1]) } : {}) };
  }
  // An identity constraint whose field has no value, because the value itself is invalid.
  if (body.startsWith('Warning: No precomputed value available')) return { ...where, kind: 'no-key-value' };

  if ((m = /^The attribute '([^']+)' is required but missing\.$/.exec(body))) {
    return { node, attribute: expanded(m[1] ?? ''), rule: 'structure:missing-attribute' };
  }
  if (/^The attribute '[^']+' is not allowed\.$/.test(body)) return { ...where, rule: 'structure:unknown-attribute' };
  if (body === "The element is not 'nillable'.") return { ...where, rule: 'structure:nil-not-nillable' };
  if (/^Neither character nor element content is allowed,? because the element (?:is|was) 'nilled'\.$/.test(body)) {
    return { ...where, rule: 'structure:nil-with-content' };
  }
  if (/^The element cannot be 'nilled' because there is a fixed value constraint defined for it\.$/.test(body)) {
    return { ...where, rule: 'structure:nil-with-fixed' };
  }
  if (
    /specified by xsi:type, is blocked or not validly derived|of the xsi:type attribute does not resolve/.test(body)
  ) {
    return { node, rule: 'structure:foreign-xsi-type' };
  }
  return where;
}

/**
 * How a message fits the change: it states the rule (`carrier`), it only accompanies such a message (`companion`),
 * it does not fit (false), or the classifier cannot read it (undefined).
 */
type Fit = 'carrier' | 'companion' | false | undefined;

const collapsed = (value: string): string => splitXmlSpace(value).join(' ');

function fits(d: Diagnostic & { line?: number }, applied: AppliedMutation): Fit {
  const { rule } = applied.mutation;
  const c = applied.context;
  const lines = applied.lines ?? {};
  if (d.rule === undefined && d.kind === undefined) return undefined;
  /** The message names this element of the context, on its line where both lines are known. */
  const on = (role: 'target' | 'parent' | 'previous' | 'next'): boolean =>
    c[role] !== undefined &&
    d.node === c[role] &&
    (d.line === undefined || lines[role] === undefined || d.line === lines[role]);
  const onInserted = (): boolean =>
    c.inserted !== undefined &&
    d.node === c.inserted &&
    (d.line === undefined || lines.inserted === undefined || lines.inserted.includes(d.line));
  const atTarget = on('target') && d.attribute === c.attribute;
  // libxml2 quotes the value after whitespace normalization, and an item for an invalid item of a list.
  const quoted =
    d.value === undefined ||
    c.value === undefined ||
    collapsed(d.value) === collapsed(c.value) ||
    splitXmlSpace(c.value).includes(d.value);
  // libxml2 leaves the list out at times, and cuts it after EXPECTED_LIMIT names.
  const expects = (name: string | undefined) =>
    name !== undefined &&
    (d.expected === undefined || d.expected.includes(name) || d.expected.length >= EXPECTED_LIMIT);
  const either = (carrier: boolean, companion = false): Fit => (carrier ? 'carrier' : companion ? 'companion' : false);
  // An identity constraint whose field has no value, because the value itself is invalid.
  const keyless = d.kind === 'no-key-value' && d.node === c.target;
  switch (rule) {
    case 'value:lexical':
      return either(atTarget && quoted && (d.kind === 'invalid-value' || d.kind === 'invalid-items'), keyless);
    case 'value:fixed':
      return either(atTarget && quoted && d.rule === 'value:fixed');
    case 'identity:duplicate-id':
      // The second of two equal IDs is the one reported, which may be the original rather than the change; the type
      // may be one derived from xs:ID. The value written ties the message to the change.
      return either(
        d.kind === 'invalid-value' &&
          d.value !== undefined &&
          c.value !== undefined &&
          d.value.trim() === c.value.trim(),
      );
    case 'identity:dangling-idref':
      return false;
    case 'structure:missing-element':
      // After a particle with a counted maximum, libxml2 expects only that particle again, not the element after it.
      return either(
        (d.kind === 'not-expected' && on('next') && (expects(c.target) || expects(c.previous))) ||
          (d.kind === 'missing-child' && on('parent') && (expects(c.target) || expects(c.previous))),
      );
    case 'structure:too-many':
      // A wildcard after the element may take the surplus copy, and reject the element it had admitted.
      return either(d.kind === 'not-expected' && (onInserted() || on('next')));
    case 'structure:order':
      return either(d.kind === 'not-expected' && (on('previous') || on('target')));
    case 'structure:unknown-element':
    case 'structure:second-branch':
      // An element added to one whose content type is empty: its children and the space around them.
      return either(
        (d.kind === 'not-expected' && onInserted()) ||
          (d.kind === 'empty-content' && on('parent') && c.parent === c.target),
      );
    case 'structure:missing-attribute':
    case 'structure:unknown-attribute':
      return either(d.rule === rule && on('target') && d.attribute === c.attribute);
    case 'structure:foreign-xsi-type':
      // Without a type it may name, the element has its declared type, which may be abstract.
      return either(d.rule === rule && on('target'), d.kind === 'abstract-type' && on('target'));
    case 'structure:nil-not-nillable':
    case 'structure:nil-with-content':
    case 'structure:nil-with-fixed':
      return either(d.rule === rule && on('target'));
    default:
      // A facet: its own message, and for a list or union the message about the whole value that follows it.
      return either(
        atTarget && quoted && d.rule === rule,
        (atTarget && quoted && d.kind === 'invalid-items') || keyless,
      );
  }
}

/**
 * The status of a changed document from the validator's verdict. `integrity` are the errors of an ID/IDREF check of
 * the document, which the validator does not resolve itself: one that is not about the rule of the change is a
 * second cause.
 */
export function classifyVerdict(
  verdict: Verdict,
  applied: AppliedMutation,
  options: { integrity?: readonly string[] } = {},
): Classification {
  const { rule } = applied.mutation;
  const value = applied.context.value;
  // A message about the value the change wrote, standing apart as a word or in quotes.
  const word =
    value === undefined
      ? undefined
      : new RegExp(`(?:^|[\\s"'])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[\\s"'])`);
  const own = (e: string) =>
    word !== undefined && (rule === 'identity:dangling-idref' || rule === 'identity:duplicate-id') && word.test(e);
  const integrity = options.integrity ?? [];
  const others = integrity.filter((e) => !own(e));
  const another = { reason: 'the ID check reports another cause', diagnostics: others.map((message) => ({ message })) };
  if (rule === 'identity:dangling-idref') {
    if (options.integrity === undefined) {
      return { status: 'not-checkable', diagnostics: [], reason: 'references need an ID/IDREF check' };
    }
    if (!verdict.valid) {
      return { status: 'other-cause', diagnostics: read(verdict, () => false), reason: 'the validator rejected it' };
    }
    const found = integrity.filter(own);
    if (others.length > 0) {
      return {
        status: 'other-cause',
        reason: another.reason,
        diagnostics: integrity.map((message) => ({ message, matches: own(message) })),
      };
    }
    return found.length > 0
      ? { status: 'confirmed', diagnostics: found.map((message) => ({ message, matches: true })) }
      : { status: 'accepted', diagnostics: [] };
  }
  if (verdict.valid) return { status: 'accepted', diagnostics: [] };
  const diagnostics = read(verdict, (d) => fits(d, applied));
  if (diagnostics.length === 0) {
    return { status: 'not-checkable', diagnostics: [], reason: 'the validator rejected it without a message' };
  }
  const result = (status: ConfirmationStatus, reason?: string): Classification => ({
    status,
    diagnostics: [
      ...diagnostics.map(strip),
      ...(status === 'other-cause' && others.length > 0
        ? another.diagnostics.map((d) => ({ ...d, matches: false }))
        : []),
    ],
    ...(reason !== undefined ? { reason } : {}),
  });
  if (diagnostics.some((d) => d.matches === false && d.known)) {
    return result('other-cause', 'a message points to another rule, node or value');
  }
  if (diagnostics.some((d) => !d.known)) return result('not-checkable', 'a message the classifier cannot read');
  if (!diagnostics.some((d) => d.carrier)) return result('other-cause', 'no message states the rule itself');
  if (others.length > 0) return result('other-cause', another.reason);
  return result('confirmed');
}

type Read = Classification['diagnostics'][number] & { known: boolean; carrier: boolean };

/** A message head: `Schemas validity error : `, `parser error : `, a bare `Element '…':` and the like. */
const HEAD = /^(?:[\w .'-]*(?:error|warning) ?: |Element ')/;

/**
 * The messages of a verdict, each whole: a value or pattern with a line break makes libxml2 write its message over
 * several lines. A line without a head of its own continues the message before while that one has a quote open;
 * any other line is a message of its own.
 */
function joined(verdict: Verdict): { message: string; line?: number }[] {
  const out: { message: string; line?: number }[] = [];
  const open = (message: string) => (message.match(/'/g)?.length ?? 0) % 2 === 1;
  verdict.errors.forEach((message, i) => {
    const last = out.at(-1);
    if (last && !HEAD.test(message) && open(last.message)) {
      last.message += `\n${message}`;
      return;
    }
    const line = verdict.lines?.[i];
    out.push({ message, ...(line !== undefined ? { line } : {}) });
  });
  return out;
}

function read(verdict: Verdict, judge: (d: Diagnostic & { line?: number }) => Fit): Read[] {
  return joined(verdict).map(({ message, line }) => {
    const diagnostic = parseDiagnostic(message);
    const fit = judge({ ...diagnostic, ...(line !== undefined ? { line } : {}) });
    return {
      message,
      ...(line !== undefined ? { line } : {}),
      ...diagnostic,
      matches: fit === 'carrier' || fit === 'companion',
      known: fit !== undefined,
      carrier: fit === 'carrier',
    };
  });
}

function strip(diagnostic: Read): Classification['diagnostics'][number] {
  const { known, carrier, ...rest } = diagnostic;
  void known;
  void carrier;
  return rest;
}
