import type { Element } from '@xmldom/xmldom';
import {
  type ChoiceContext,
  type ChoiceStrategy,
  type ChoiceVisit,
  choiceId,
  type NilMode,
  firstBranch,
  type OptionalMode,
  preferBranches,
  randomBranch,
  reachableChoices,
  smallestBranch,
  Walker,
  LimitError,
} from './generate/walker.js';
import { toJson, JsonMappingError, type JsonOptions, type JsonValue } from './json/serialize.js';
import { checkOptions } from './options.js';
import { createRng } from './rng.js';
import { validateXml, type SchemaFiles, type XmlValidator } from './validate/xmllint.js';
import { listed, valueLists, type ValueLists } from './values/lists.js';
import { localeValues, type FieldKey } from './values/locale/index.js';
import type { LocaleData } from 'xsd-faker-locales';
import { facetValues, firstOf, type ValueSource } from './values/source.js';
import { serializeXml } from './xml/serialize.js';
import { elements, type InstanceElement } from './xml/tree.js';
import { type Problem, Problems } from './xsd/problems.js';
import {
  attr,
  clark,
  type Component,
  effectiveLimits,
  type SchemaDocument,
  type SchemaLimits,
  SchemaSet,
  type SchemaSource,
  XS,
} from './xsd/schema-set.js';
export type {
  ChoiceContext,
  ChoiceKind,
  ChoiceSettings,
  ChoiceStrategy,
  ChoiceVisit,
  NilMode,
  OptionalMode,
} from './generate/walker.js';
export { firstBranch, randomBranch, smallestBranch, preferBranches } from './generate/walker.js';
export { toJson, JsonMappingError } from './json/serialize.js';
export type { JsonOptions, JsonValue } from './json/serialize.js';
export type { ValueContext, ValueScope, ValueSource } from './values/source.js';
export { facetValues, firstOf } from './values/source.js';
export { valueLists } from './values/lists.js';
export type { ValueLists } from './values/lists.js';
export { FIELD_KEYS, localeValues, LOCALES } from './values/locale/index.js';
export type { FieldKey, LocaleOptions } from './values/locale/index.js';
export { defineLocale, extendLocale, localeFromFaker } from 'xsd-faker-locales';
export type {
  AddressData,
  ContactData,
  Gendered,
  LocaleData,
  LocaleInput,
  PersonData,
  Place,
  Region,
  StreetData,
  TextData,
} from 'xsd-faker-locales';
export type { GroupOccurrence, InstanceElement, InstanceNode } from './xml/tree.js';
export { serializeXml } from './xml/serialize.js';
export type { Problem, ProblemCode } from './xsd/problems.js';
export type { SchemaLimits, SchemaSource, SchemaText } from './xsd/schema-set.js';
export { DEFAULT_LIMITS, SchemaEncodingError, SchemaLimitError, UnsafeLocationError } from './xsd/schema-set.js';
export { validateXml, SchemaCompileError } from './validate/xmllint.js';
export type { SchemaFiles, Verdict, XmlValidator } from './validate/xmllint.js';
export interface GenerateOptions extends LoadOptions {
  root?: string;
  seed?: number;
  /** Default: none. Separate settings take precedence. */
  optional?: OptionalMode;
  optionalElements?: OptionalMode;
  optionalAttributes?: OptionalMode;
  /** Default: never. `random` writes a nillable element without a fixed value as nil with chance one half. */
  nil?: NilMode;
  repeat?: number;
  choice?:
    | 'first'
    | 'smallest'
    | 'random'
    | 'all'
    | {
        prefer: string[];
      }
    | ChoiceStrategy;
  /** Optional-element expansion depth. Root depth is zero. Default: 12, and always lower than maxTotalDepth. */
  maxDepth?: number;
  /** Hard limit including required content. Default: 64. Exceeding it is a generation error. */
  maxTotalDepth?: number;
  maxNodes?: number;
  /** Replaces `locale`; `samples` is still tried first. */
  values?: ValueSource;
  /** Values from a locale, by tag such as `de` or `en`, or a locale from `defineLocale`. Default: none. */
  locale?: string | LocaleData;
  /** The day a locale counts dates from. */
  referenceDate?: string;
  /** The field a locale gives a value for, by path or type name, where the names of the schema do not tell. */
  localeFields?: Readonly<Record<string, FieldKey | null>>;
  /** Values by path or type name, tried before every other source. */
  samples?: ValueLists;
  /** Instance mode validates by default. Template mode never claims validity. */
  mode?: 'instance' | 'template';
  validate?: boolean;
  validator?: XmlValidator;
  attempts?: number;
  indent?: string;
  schemaLocation?: string;
  /** Namespace URI -> preferred prefix. */
  prefixes?: Readonly<Record<string, string>>;
  json?: false | JsonOptions;
  /** Empty values are allowed only in template mode. */
  fillElements?: boolean;
  fillAttributes?: boolean;
}
export interface GenerateInput {
  files: SchemaSource;
  entry: string;
}
/** Options of reading the schema set, shared by generation and the root listing. */
export interface LoadOptions {
  /** Size limits of the schema input; see `SchemaLimits`. */
  limits?: SchemaLimits;
}
export type SampleStatus = 'valid' | 'invalid' | 'incomplete' | 'unvalidated' | 'template';
export interface Sample {
  xml: string;
  tree: InstanceElement;
  json?: JsonValue;
  jsonStatus: 'generated' | 'unavailable' | 'not-requested';
  /** XML validation only. JSON projection is not independently JSON-Schema-validated. */
  valid: boolean | undefined;
  status: SampleStatus;
  seed: number;
  attempts: number;
  errors: string[];
  problems: Problem[];
  /** The decisions of the document: choices, substitution group members and xsi:type alternatives. */
  choices: ChoiceVisit[];
}
export interface RootElement {
  name: string;
  namespace: string;
  expandedName: string;
  file: string;
  abstract: boolean;
  entryDocument: boolean;
}
export class GenerateError extends Error {
  override name = 'GenerateError';
  constructor(
    message: string,
    readonly problems: Problem[],
  ) {
    super(message);
  }
}
interface Prepared {
  set: SchemaSet;
  doc: SchemaDocument;
  root: Component;
  loading: Problem[];
  schemas: SchemaFiles;
}
function load(
  input: GenerateInput,
  options: LoadOptions,
): {
  set: SchemaSet;
  doc: SchemaDocument;
  problems: Problem[];
} {
  const problems = new Problems();
  const set = new SchemaSet(input.files, problems, options.limits);
  const doc = set.load(input.entry);
  if (!doc || problems.list.some((p) => p.severity === 'error')) {
    throw new GenerateError(`cannot load schema: ${problems.list.map((p) => p.message).join('; ')}`, problems.list);
  }
  return { set, doc, problems: problems.list };
}
/** Lists declarations across the loaded schema set. Abstract roots are visible but not generated directly. */
export function listRoots(
  input: GenerateInput,
  options: LoadOptions = {},
): {
  roots: RootElement[];
  problems: Problem[];
} {
  try {
    return rootsOf(input, options);
  } catch (error) {
    throw tooDeep(error);
  }
}
/**
 * A schema that nests deeper than the call stack reaches is a `resource-limit`, never a RangeError leaving the API;
 * there is no schema and no document then.
 */
function tooDeep(error: unknown): unknown {
  if (!(error instanceof RangeError) || !/call stack/i.test(error.message)) return error;
  const message = 'the schema nests deeper than the generator can follow';
  return new GenerateError(message, [{ code: 'resource-limit', severity: 'error', message }]);
}
function rootsOf(
  input: GenerateInput,
  options: LoadOptions,
): {
  roots: RootElement[];
  problems: Problem[];
} {
  effectiveLimits(options.limits);
  const { set, doc, problems } = load(input, options);
  const roots = [...set.components.element].map(([expandedName, component]) => ({
    name: attr(component.node, 'name') ?? '',
    namespace: component.doc.targetNamespace,
    expandedName,
    file: component.doc.path,
    abstract: ['true', '1'].includes(attr(component.node, 'abstract') ?? ''),
    entryDocument: component.doc === doc,
  }));
  return { roots, problems };
}
function prepare(input: GenerateInput, options: GenerateOptions): Prepared {
  const { set, doc, problems } = load(input, options);
  const choices = [...set.components.element].filter(([, c]) => c.doc === doc);
  let id: string | undefined;
  const requested = options.root;
  if (requested === undefined) {
    if (choices.length === 1) {
      id = choices[0]?.[0];
    }
  } else if (requested.startsWith('{')) {
    id = requested;
  } else if (requested.includes(':')) {
    const qn = set.resolveQName(doc.root, requested);
    id = clark(qn.ns, qn.local);
  } else {
    id = clark(doc.targetNamespace, requested);
  }
  const root = id === undefined ? undefined : set.components.element.get(id);
  if (!root) {
    const issue: Problem = {
      severity: 'error',
      code: requested === undefined ? 'root-required' : 'unknown-root',
      file: doc.path,
      message:
        requested === undefined
          ? `choose a global root element; entry declarations: ${choices.map(([name]) => name).join(', ') || '(none)'}`
          : `unknown root element "${options.root}"; use --list-roots or listRoots() to inspect available roots`,
    };
    throw new GenerateError(issue.message, [...problems, issue]);
  }
  return { set, doc, root, loading: problems, schemas: { entry: doc.path, files: set.sourceTexts } };
}
function strategy(choice: GenerateOptions['choice']): ChoiceStrategy {
  if (typeof choice === 'function') {
    return choice;
  }
  if (choice === 'random') {
    return randomBranch;
  }
  if (choice === 'smallest') {
    return smallestBranch;
  }
  if (typeof choice === 'object' && choice !== null && Array.isArray(choice.prefer)) {
    return preferBranches(choice.prefer);
  }
  if (choice === undefined || choice === 'first' || choice === 'all') {
    return firstBranch;
  }
  throw new TypeError('unknown choice strategy');
}
function prefixes(set: SchemaSet, configured: GenerateOptions['prefixes']): Map<string, string> {
  const out = new Map<string, string>();
  for (const document of set.documents.values()) {
    const attributes = document?.root.attributes;
    for (let i = 0; attributes && i < attributes.length; i += 1) {
      const a = attributes.item(i);
      if (a?.prefix === 'xmlns' && a.value !== XS && !out.has(a.value)) {
        out.set(a.value, a.localName ?? '');
      }
    }
  }
  for (const [namespace, prefix] of Object.entries(configured ?? {})) {
    out.set(namespace, prefix);
  }
  return out;
}
function source(options: GenerateOptions): ValueSource {
  const base =
    options.values ??
    (options.locale !== undefined
      ? localeValues(options.locale, {
          ...(options.referenceDate !== undefined ? { referenceDate: options.referenceDate } : {}),
          ...(options.localeFields !== undefined ? { fields: options.localeFields } : {}),
        })
      : facetValues);
  return options.samples ? firstOf(valueLists(options.samples), base) : base;
}
/** Called after each attempt with its branch trace and status; coverage uses it to plan the next choices. */
type AttemptObserver = (choices: Sample['choices'], status: SampleStatus) => void;
async function generatePrepared(
  prepared: Prepared,
  options: GenerateOptions,
  observe?: AttemptObserver,
): Promise<Sample> {
  const template = options.mode === 'template';
  const validate = !template && (options.validate ?? true);
  const attempts = validate ? (options.attempts ?? 10) : 1;
  const namespacePrefixes = prefixes(prepared.set, options.prefixes);
  const values = source(options);
  let last: Sample | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const seed = (options.seed ?? 1) + attempt;
    const problems = new Problems();
    const walker = new Walker(prepared.set, problems, {
      optional: options.optional ?? 'none',
      ...(options.optionalElements !== undefined ? { optionalElements: options.optionalElements } : {}),
      ...(options.optionalAttributes !== undefined ? { optionalAttributes: options.optionalAttributes } : {}),
      repeat: options.repeat ?? 1,
      nil: options.nil ?? 'never',
      choice: strategy(options.choice),
      allBranches: options.choice === 'all',
      maxDepth: options.maxDepth ?? Math.min(12, (options.maxTotalDepth ?? 64) - 1),
      maxTotalDepth: options.maxTotalDepth ?? 64,
      maxNodes: options.maxNodes ?? 10000,
      values,
      userSupplied: (target) => options.samples !== undefined && listed(options.samples, target),
      rng: createRng(seed),
    });
    let tree: InstanceElement;
    try {
      tree = walker.root(prepared.root);
    } catch (error) {
      if (error instanceof LimitError) {
        problems.error('resource-limit', error.message);
        throw new GenerateError(error.message, [...prepared.loading, ...problems.list]);
      }
      throw error;
    }
    if (template) {
      problems.warning('template-only', 'template output is not an accepted test instance');
      for (const node of elements(tree)) {
        if (options.fillAttributes === false) {
          for (const a of node.attributes) {
            a.value = '';
          }
        }
        if (options.fillElements === false) {
          for (const child of node.children) {
            if (child.kind === 'text') {
              child.value = '';
            }
          }
        }
      }
    }
    const xml = serializeXml(tree, {
      prefixes: namespacePrefixes,
      ...(options.indent !== undefined ? { indent: options.indent } : {}),
      ...(options.schemaLocation !== undefined ? { schemaLocation: options.schemaLocation } : {}),
    });
    let json: JsonValue | undefined;
    let jsonStatus: Sample['jsonStatus'] = 'not-requested';
    if (options.json !== false) {
      try {
        json = toJson(tree, options.json ?? {}, namespacePrefixes);
        jsonStatus = 'generated';
      } catch (error) {
        if (!(error instanceof JsonMappingError)) {
          throw error;
        }
        problems.warning('json-mapping', error.message);
        jsonStatus = 'unavailable';
      }
    }
    let valid: boolean | undefined;
    let errors: string[] = [];
    if (validate) {
      const verdicts = await (options.validator ?? validateXml)(prepared.schemas, [xml]);
      const verdict = verdicts[0];
      if (verdicts.length !== 1 || !verdict || typeof verdict.valid !== 'boolean' || !Array.isArray(verdict.errors)) {
        throw new TypeError('validator must return exactly one explicit verdict per document');
      }
      valid = verdict.valid;
      errors = verdict.errors;
    }
    const issues = [...prepared.loading, ...problems.list];
    const status: SampleStatus = template
      ? 'template'
      : issues.some((p) => p.severity === 'error')
        ? 'incomplete'
        : valid === true
          ? 'valid'
          : valid === false
            ? 'invalid'
            : 'unvalidated';
    last = {
      xml,
      tree,
      ...(json !== undefined ? { json } : {}),
      jsonStatus,
      valid,
      status,
      seed,
      attempts: attempt + 1,
      errors,
      problems: issues,
      choices: walker.choices,
    };
    observe?.(walker.choices, status);
    if (!validate || status === 'valid') {
      return last;
    }
  }
  if (!last) {
    throw new Error('no generation attempt was performed');
  }
  return last;
}
/** Generates one document. Inspect status; a returned object is not automatically a valid instance. */
export async function generateSample(input: GenerateInput, options: GenerateOptions = {}): Promise<Sample> {
  checkOptions(options);
  try {
    return await generatePrepared(prepare(input, options), options);
  } catch (error) {
    throw tooDeep(error);
  }
}
export interface BatchOptions extends GenerateOptions {
  count?: number;
  coverage?: boolean;
}
export interface Coverage {
  scope: 'encountered-choices';
  covered: number;
  total: number;
  complete: boolean;
  /** Substitution groups and xsi:type also give the kind and the expanded name of the uncovered alternative. */
  uncovered: {
    id: string;
    branch: number;
    kind?: 'substitution' | 'type';
    alternative?: string;
  }[];
}
export interface SampleBatch {
  samples: Sample[];
  coverage: Coverage;
}
/** Failed attempts after which a branch not yet accepted yields to other open branches in coverage planning. */
const FAILURE_LIMIT = 2;
/** Bounded branch exploration. Coverage counts accepted XML instances, not attempts or templates. */
export async function generateSamples(input: GenerateInput, options: BatchOptions = {}): Promise<SampleBatch> {
  try {
    return await batch(input, options);
  } catch (error) {
    throw tooDeep(error);
  }
}
async function batch(input: GenerateInput, options: BatchOptions): Promise<SampleBatch> {
  checkOptions(options);
  const count = options.count ?? 1;
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) {
    throw new RangeError('count must be an integer from 1 to 1000');
  }
  if (options.coverage && (options.mode === 'template' || options.validate === false)) {
    throw new TypeError('coverage requires validated instance mode');
  }
  const prepared = prepare(input, options);
  const known = new Map<string, number>();
  /** the kind and alternatives of substitution groups and xsi:type decisions */
  const named = new Map<string, { kind: 'substitution' | 'type'; alternatives: string[] }>();
  const accepted = new Map<string, Set<number>>();
  const tried = new Map<string, number[]>();
  /** Failed attempts per branch not yet accepted. A failed document does not show which of its branches failed it. */
  const failures = new Map<string, number[]>();
  const reach = new Map<Element, string[]>();
  const penalized = (id: string, branch: number): boolean =>
    !accepted.get(id)?.has(branch) && (failures.get(id)?.[branch] ?? 0) >= FAILURE_LIMIT;
  /** Branches still open, and not penalized, in the choices already encountered below this branch. */
  const openBelow = (context: ChoiceContext, branch: Element): number => {
    let ids = reach.get(branch);
    if (!ids) {
      const follow = (context.settings?.optionalElements ?? 'none') !== 'none';
      ids = [...new Set(reachableChoices(context.set, branch, follow).map((node) => choiceId(context.set, node)))];
      reach.set(branch, ids);
    }
    let open = 0;
    for (const id of ids) {
      for (let b = 0; b < (known.get(id) ?? 0); b += 1) {
        if (!accepted.get(id)?.has(b) && !penalized(id, b)) open += 1;
      }
    }
    return open;
  };
  // Tiers, then the less tried branch; ties keep declaration order, and nothing here is random:
  // 0. open branches;
  // 1. accepted branches that lead to open branches of encountered choices, the most of them first;
  // 2. open branches that failed FAILURE_LIMIT attempts without an accepted document, fewest failures first;
  // 3. other accepted branches.
  // A penalized branch is tried again as soon as tiers 0 and 1 are empty, and the penalty ends once it is accepted.
  const balanced: ChoiceStrategy = (context) => {
    const id = choiceId(context.set, context.node);
    known.set(id, context.branches.length);
    const attempts = tried.get(id) ?? context.branches.map(() => 0);
    const score = (branch: number): [number, number, number] => {
      const tries = attempts[branch] ?? 0;
      if (penalized(id, branch)) return [2, failures.get(id)?.[branch] ?? 0, tries];
      if (!accepted.get(id)?.has(branch)) return [0, tries, 0];
      const node = context.branches[branch];
      const open = node ? openBelow(context, node) : 0;
      return open > 0 ? [1, -open, tries] : [3, tries, 0];
    };
    const lower = (a: readonly number[], b: readonly number[]): boolean => {
      const i = a.findIndex((value, k) => value !== b[k]);
      return i >= 0 && (a[i] ?? 0) < (b[i] ?? 0);
    };
    let selected = 0;
    let best = score(0);
    for (let branch = 1; branch < context.branches.length; branch += 1) {
      const candidate = score(branch);
      if (lower(candidate, best)) {
        best = candidate;
        selected = branch;
      }
    }
    attempts[selected] = (attempts[selected] ?? 0) + 1;
    tried.set(id, attempts);
    return selected;
  };
  // Only planning uses failures; they never make a branch unreachable or remove it from the coverage total.
  const recordFailures: AttemptObserver = (choices, status) => {
    if (status === 'valid') return;
    for (const visit of choices) {
      if (accepted.get(visit.id)?.has(visit.branch)) continue;
      const counts = failures.get(visit.id) ?? Array.from({ length: visit.branches }, () => 0);
      counts[visit.branch] = (counts[visit.branch] ?? 0) + 1;
      failures.set(visit.id, counts);
    }
  };
  const samples: Sample[] = [];
  let seed = options.seed ?? 1;
  for (let i = 0; i < count; i += 1) {
    const sample = await generatePrepared(
      prepared,
      { ...options, seed, ...(options.coverage ? { choice: balanced } : {}) },
      options.coverage ? recordFailures : undefined,
    );
    samples.push(sample);
    for (const visit of sample.choices) {
      known.set(visit.id, visit.branches);
      if (visit.kind) named.set(visit.id, { kind: visit.kind, alternatives: visit.alternatives ?? [] });
      if (sample.status === 'valid') {
        const branches = accepted.get(visit.id) ?? new Set<number>();
        branches.add(visit.branch);
        accepted.set(visit.id, branches);
      }
    }
    seed = sample.seed + 1;
  }
  const uncovered: Coverage['uncovered'] = [];
  let total = 0;
  for (const [id, branches] of known) {
    total += branches;
    for (let branch = 0; branch < branches; branch += 1) {
      if (!accepted.get(id)?.has(branch)) {
        const alternative = named.get(id);
        uncovered.push(
          alternative
            ? {
                id,
                branch,
                kind: alternative.kind,
                ...(alternative.alternatives[branch] !== undefined
                  ? { alternative: alternative.alternatives[branch] }
                  : {}),
              }
            : { id, branch },
        );
      }
    }
  }
  return {
    samples,
    coverage: {
      scope: 'encountered-choices',
      total,
      covered: total - uncovered.length,
      // Without an accepted document nothing was shown, even where the schema has no choice.
      complete: uncovered.length === 0 && samples.some((sample) => sample.status === 'valid'),
      uncovered,
    },
  };
}
