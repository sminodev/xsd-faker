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
  type ElementFacts,
  type ValueFacts,
} from './generate/walker.js';
import { type Base, type InvalidMatrix, type InvalidOptions, runMatrix } from './mutate/matrix.js';
import { toJson, JsonMappingError, type JsonOptions, type JsonValue } from './json/serialize.js';
import { checkOptions } from './options.js';
import { parseExpandedPath } from './mutate/path.js';
import { createRng } from './rng.js';
import { judge, validateXml, type SchemaFiles, type Verdict, type XmlValidator } from './validate/xmllint.js';
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
export { de, defineLocale, en, extendLocale, localeFromFaker } from 'xsd-faker-locales';
export type {
  AddressData,
  ContactData,
  DeepPartial,
  FakerList,
  FakerLocaleDefinition,
  FakerOptions,
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
export { RULES } from './mutate/rules.js';
export type { IdentityRule, NilRule, Rule, ValueRule } from './mutate/rules.js';
export { formatExpandedPath, parseExpandedPath } from './mutate/path.js';
export type { ExpandedPath, ExpandedStep } from './mutate/path.js';
export { generateViolatingValue } from './mutate/value.js';
export type { ValueFacets, ViolatingValue, ViolatingValueRequest } from './mutate/value.js';
export { applyTreeMutation } from './mutate/tree.js';
export type {
  AppliedMutation,
  MutationContext,
  MutationLines,
  TreeMutation,
  TreeMutationResult,
} from './mutate/tree.js';
export { classifyVerdict, parseDiagnostic } from './mutate/classify.js';
export type { Classification, ConfirmationStatus, Diagnostic } from './mutate/classify.js';
export { mapNamespaces } from './mutate/namespaces.js';
export type { NamespaceMapping } from './mutate/namespaces.js';
export type { InvalidMatrix, InvalidOptions, InvalidSample, NotConstructible } from './mutate/matrix.js';
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
  /**
   * Paths the document has to contain, such as `/{urn:o}order/{urn:o}item[2]/@code`: their optional ancestors,
   * choice branches, substitution group members and xsi:type alternatives are taken. A path the schema does not
   * allow gives the warning `unreachable-path`. Decisions a path fixes do not count for coverage.
   */
  reach?: readonly string[];
  /** Optional-element expansion depth. Root depth is zero. Default: 12, and always lower than maxTotalDepth. */
  maxDepth?: number;
  /** Hard limit including required content. Default: 64. Exceeding it is a generation error. */
  maxTotalDepth?: number;
  maxNodes?: number;
  /** Replaces `locale`; `samples` is still tried first. */
  values?: ValueSource;
  /** Values from a locale, by tag such as `de` or `en`, or a locale from `defineLocale`. Default: none. */
  locale?: string | LocaleData;
  /** Reference date for locale-generated dates. */
  referenceDate?: string;
  /** Overrides locale field recognition by path or type name. */
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
/** Schema-loading options shared by generation and root discovery. */
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
 * Converts stack exhaustion during schema traversal to a `resource-limit` error.
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
/** Optional schema metadata collected by the walker for each sample. */
type FactsBySample = Map<Sample, Map<object, ElementFacts | ValueFacts>>;
async function generatePrepared(
  prepared: Prepared,
  options: GenerateOptions,
  observe?: AttemptObserver,
  facts?: FactsBySample,
  /** verdicts known in advance, by document text */
  known?: Map<string, Verdict>,
): Promise<Sample> {
  const template = options.mode === 'template';
  const validate = !template && (options.validate ?? true);
  const attempts = validate ? (options.attempts ?? 10) : 1;
  const namespacePrefixes = prefixes(prepared.set, options.prefixes);
  const values = source(options);
  const reach = options.reach?.map(parseExpandedPath);
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
      ...(reach !== undefined && reach.length > 0 ? { reach } : {}),
      userSupplied: (target) => options.samples !== undefined && listed(options.samples, target),
      rng: createRng(seed),
      ...(facts ? { facts: true } : {}),
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
      const cached = known?.get(xml);
      const [verdict] = cached ? [cached] : await judge(options.validator ?? validateXml, prepared.schemas, [xml]);
      if (!verdict) throw new TypeError('validator must return exactly one explicit verdict per document');
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
    facts?.set(last, walker.facts);
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
/** Documents generated ahead and validated together, without coverage. */
const SPECULATION = 50;
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
async function batch(
  input: GenerateInput,
  options: BatchOptions,
  extra: { prepared?: Prepared; facts?: FactsBySample } = {},
): Promise<SampleBatch> {
  checkOptions(options);
  const count = options.count ?? 1;
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) {
    throw new RangeError('count must be an integer from 1 to 1000');
  }
  if (options.coverage && (options.mode === 'template' || options.validate === false)) {
    throw new TypeError('coverage requires validated instance mode');
  }
  const prepared = extra.prepared ?? prepare(input, options);
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
      if (visit.fixed || accepted.get(visit.id)?.has(visit.branch)) continue;
      const counts = failures.get(visit.id) ?? Array.from({ length: visit.branches }, () => 0);
      counts[visit.branch] = (counts[visit.branch] ?? 0) + 1;
      failures.set(visit.id, counts);
    }
  };
  const samples: Sample[] = [];
  let seed = options.seed ?? 1;
  // Without coverage, the next documents do not depend on each other's verdicts: their first attempts are
  // generated ahead and validated together, and each document then takes its verdict from there.
  const judged = new Map<string, Verdict>();
  const ahead = new Set<number>();
  const validating = options.mode !== 'template' && options.validate !== false;
  for (let i = 0; i < count; i += 1) {
    if (validating && !options.coverage && count - i > 1 && !ahead.has(seed)) {
      const seeds = Array.from({ length: Math.min(SPECULATION, count - i) }, (_, k) => seed + k);
      const drafts = [];
      for (const next of seeds) {
        ahead.add(next);
        drafts.push((await generatePrepared(prepared, { ...options, seed: next, validate: false })).xml);
      }
      const verdicts = await judge(options.validator ?? validateXml, prepared.schemas, drafts);
      drafts.forEach((xml, k) => {
        const verdict = verdicts[k];
        if (verdict) judged.set(xml, verdict);
      });
    }
    const sample = await generatePrepared(
      prepared,
      { ...options, seed, ...(options.coverage ? { choice: balanced } : {}) },
      options.coverage ? recordFailures : undefined,
      extra.facts,
      judged,
    );
    samples.push(sample);
    for (const visit of sample.choices) {
      // A decision that a path of reach fixed is neither open nor covered.
      if (visit.fixed) continue;
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

export interface InvalidSampleOptions extends BatchOptions, InvalidOptions {}

/**
 * Generates and validates samples intended to violate one schema rule each. Optional elements and attributes
 * default to `all` to expose more rules for mutation.
 */
export async function generateInvalidSamples(
  input: GenerateInput,
  options: InvalidSampleOptions = {},
): Promise<InvalidMatrix> {
  try {
    return await invalid(input, options);
  } catch (error) {
    throw tooDeep(error);
  }
}

async function invalid(input: GenerateInput, options: InvalidSampleOptions): Promise<InvalidMatrix> {
  // Validate supplied options before the defaults below override json and the optional modes.
  checkOptions(options);
  if (options.mode === 'template' || options.validate === false) {
    throw new TypeError('invalid samples require validated instance mode');
  }
  const settings: BatchOptions = {
    ...options,
    ...(options.optional === undefined && options.optionalElements === undefined ? { optionalElements: 'all' } : {}),
    ...(options.optional === undefined && options.optionalAttributes === undefined
      ? { optionalAttributes: 'all' }
      : {}),
    json: false,
  };
  const prepared = prepare(input, settings);
  let facts: FactsBySample = new Map();
  let samples: Sample[];
  try {
    ({ samples } = await batch(input, settings, { prepared, facts }));
  } catch (error) {
    // All optional elements of a large schema can exceed maxNodes; then the samples keep to required elements,
    // unless the caller chose the optional elements.
    const chosen = options.optional !== undefined || options.optionalElements !== undefined;
    if (chosen || !(error instanceof GenerateError) || !error.problems.some((p) => p.code === 'resource-limit')) {
      throw error;
    }
    settings.optionalElements = 'none';
    facts = new Map();
    ({ samples } = await batch(input, settings, { prepared, facts }));
  }
  const bases: Base[] = samples
    .filter((sample) => sample.status === 'valid')
    .map((sample) => ({ tree: sample.tree, seed: sample.seed, facts: facts.get(sample) ?? new Map() }));
  const layout = {
    prefixes: prefixes(prepared.set, settings.prefixes),
    ...(settings.indent !== undefined ? { indent: settings.indent } : {}),
    ...(settings.schemaLocation !== undefined ? { schemaLocation: settings.schemaLocation } : {}),
  };
  return runMatrix(
    bases,
    {
      set: prepared.set,
      schemas: prepared.schemas,
      validator: settings.validator ?? validateXml,
      layout,
      serialize: (tree) => serializeXml(tree, layout),
      reach: async (path, seed) => {
        const { coverage, ...rest } = settings;
        void coverage;
        const sample = await generatePrepared(prepared, { ...rest, reach: [path], seed, validate: false });
        return sample.tree;
      },
    },
    options,
  );
}
