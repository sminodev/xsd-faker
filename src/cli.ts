import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileInput, generateInvalidSamples, generateSampleFiles, listRootsFile } from './node.js';
import type { BatchOptions, NilMode, OptionalMode, Sample, SchemaLimits, ValueLists, XmlValidator } from './index.js';
import { RULES, type Rule } from './mutate/rules.js';
export interface CliOutput {
  stdout(text: string): void;
  stderr(text: string): void;
}
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const HELP = `xsd-faker <entry.xsd> [options]
xsd-faker invalid <entry.xsd> --out-dir <directory> [options]

Generate XML and JSON fixtures from XML Schema 1.0. No network access.
The invalid command writes invalid samples, each breaking one rule; see invalid --help.

  --list-roots                    List global roots as JSON; no generation
  --root <name>                   Local name, prefix:name or {namespace}name
  --format <xml|json|both>         Default: xml
  --out <file>                    Single output; existing files are not overwritten
  --out-dir <directory>           New directory for a batch or paired XML/JSON
  --count <number>                Documents to generate (1..1000; default: 1)
  --seed <number>                 Reproducible starting seed (default: 1)
  --optional-elements <mode>      none, all, random (default: none)
  --optional-attributes <mode>    none, all, random (default: none)
  --nil <never|random>            xsi:nil on nillable elements (default: never)
  --optional-depth <number>       Optional depth below --max-depth (default: 12)
  --max-depth <number>            Hard depth limit, including required content (64)
  --max-nodes <number>            Hard element budget per document (10000)
  --repeat <number>               Requested occurrences, clamped to XSD bounds (1)
  --choice <strategy>             first, smallest, random, all (default: first)
  --coverage                     Prefer unexplored choice branches; bounded by count
  --reach <path>                  Path the document must contain, such as /{urn:o}order/{urn:o}item[2]; repeatable
  --locale <tag>                  Locale values: de or en (default: none)
  --date <ISO date>               Locale reference date (2026-01-15T12:00:00Z)
  --values <file.json>            Value lists keyed by /Root/Element, /Root/@attr or type name
  --json-mode <compact|tree>      Local-name objects (default) or ordered tree
  --json-numbers <number|string>  Default: number; unsafe conversions are refused
  --text-property <name>          Simple/mixed content property (value)
  --schema-location <mode>        none, relative, absolute (default: none)
  --base-dir <directory>          Allowed schema directory (entry directory)
  --max-file-bytes <number>       Bytes of one schema document (4194304)
  --max-total-bytes <number>      Bytes of all schema documents (16777216)
  --max-documents <number>        Schema documents, chameleon copies included (128)
  --attempts <number>             Seeds tried per document (default: 10)
  --template                     Template, not an accepted test instance
  --no-element-values            Template only
  --no-attribute-values          Template only
  --no-validate                  Explicitly unvalidated output
  --help                         Show this help

'all' requires --template. Use --coverage for separate, validated branch examples.
Exit codes: 0 completed, 1 input/runtime error, 2 invalid/incomplete generation or coverage.
`;
function integer(name: string, value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return Number(value);
}
function enumeration<T extends string>(name: string, value: string | undefined, choices: readonly T[], fallback: T): T {
  if (value === undefined) {
    return fallback;
  }
  if (!choices.includes(value as T)) {
    throw new TypeError(`${name} must be ${choices.join(', ')}`);
  }
  return value as T;
}
function readValues(file: string): ValueLists {
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('values must map paths or type names to a string or a non-empty array of strings');
  }
  for (const [key, item] of Object.entries(value)) {
    if (
      key === '' ||
      !(
        typeof item === 'string' ||
        (Array.isArray(item) && item.length > 0 && item.every((v: unknown) => typeof v === 'string'))
      )
    ) {
      throw new TypeError(`values must map ${key} to a string or a non-empty array of strings`);
    }
  }
  return value as ValueLists;
}
function suffix(sample: Sample): string {
  return sample.status === 'template' ? '.template' : sample.status === 'unvalidated' ? '.unvalidated' : '';
}
/** The command implementation is separate from the process entry point so its exit contract can be tested. */
export async function run(
  argv: string[],
  io: CliOutput = { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) },
  validator?: XmlValidator,
): Promise<number> {
  if (argv[0] === 'invalid') return invalid(argv.slice(1), io, validator);
  if (argv.some((arg) => arg === '--profile' || arg.startsWith('--profile='))) {
    io.stderr('--profile was replaced by --locale: use --locale en or --locale de for readable values\n');
    return 1;
  }
  try {
    const { values: flags, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean' },
        'list-roots': { type: 'boolean' },
        root: { type: 'string' },
        format: { type: 'string' },
        out: { type: 'string' },
        'out-dir': { type: 'string' },
        count: { type: 'string' },
        seed: { type: 'string' },
        repeat: { type: 'string' },
        attempts: { type: 'string' },
        'optional-elements': { type: 'string' },
        'optional-attributes': { type: 'string' },
        'optional-depth': { type: 'string' },
        nil: { type: 'string' },
        'max-depth': { type: 'string' },
        'max-nodes': { type: 'string' },
        choice: { type: 'string' },
        coverage: { type: 'boolean' },
        reach: { type: 'string', multiple: true },
        locale: { type: 'string' },
        date: { type: 'string' },
        values: { type: 'string' },
        'json-mode': { type: 'string' },
        'json-numbers': { type: 'string' },
        'text-property': { type: 'string' },
        'schema-location': { type: 'string' },
        'base-dir': { type: 'string' },
        'max-file-bytes': { type: 'string' },
        'max-total-bytes': { type: 'string' },
        'max-documents': { type: 'string' },
        template: { type: 'boolean' },
        'no-element-values': { type: 'boolean' },
        'no-attribute-values': { type: 'boolean' },
        'no-validate': { type: 'boolean' },
      },
    });
    if (flags.help) {
      io.stdout(HELP);
      return 0;
    }
    if (positionals.length !== 1 || !positionals[0]) {
      throw new TypeError('provide one entry XSD; see --help');
    }
    const entry = positionals[0];
    const limits: SchemaLimits = {};
    for (const [flag, key] of [
      ['max-file-bytes', 'maxFileBytes'],
      ['max-total-bytes', 'maxTotalBytes'],
      ['max-documents', 'maxDocuments'],
    ] as const) {
      const value = integer(flag, flags[flag]);
      if (value !== undefined) limits[key] = value;
    }
    const access = {
      ...(flags['base-dir'] ? { baseDirectory: flags['base-dir'] } : {}),
      ...(Object.keys(limits).length > 0 ? { limits } : {}),
    };
    if (flags['list-roots']) {
      io.stdout(`${JSON.stringify(listRootsFile(entry, access), null, 2)}\n`);
      return 0;
    }
    const format = enumeration('format', flags.format, ['xml', 'json', 'both'], 'xml');
    const count = integer('count', flags.count) ?? 1;
    if (flags.out && flags['out-dir']) {
      throw new TypeError('use --out or --out-dir, not both');
    }
    if ((format === 'both' || count > 1) && !flags['out-dir']) {
      throw new TypeError('--out-dir is required for paired output or more than one document');
    }
    const optionalDepth = integer('optional-depth', flags['optional-depth']);
    if (optionalDepth !== undefined && optionalDepth >= (integer('max-depth', flags['max-depth']) ?? 64)) {
      throw new RangeError('--optional-depth (maxDepth) must be lower than --max-depth (maxTotalDepth)');
    }
    if (
      flags.template &&
      (flags['no-element-values'] || flags['no-attribute-values']) &&
      format !== 'xml' &&
      flags['json-mode'] !== 'tree'
    ) {
      throw new TypeError('empty template values require --format xml or --json-mode tree');
    }
    const mode = flags.template ? 'template' : 'instance';
    const options: BatchOptions = {
      count,
      mode,
      seed: integer('seed', flags.seed) ?? 1,
      repeat: integer('repeat', flags.repeat) ?? 1,
      maxTotalDepth: integer('max-depth', flags['max-depth']) ?? 64,
      maxNodes: integer('max-nodes', flags['max-nodes']) ?? 10000,
      attempts: integer('attempts', flags.attempts) ?? 10,
      optionalElements: enumeration<OptionalMode>(
        'optional-elements',
        flags['optional-elements'],
        ['none', 'all', 'random'],
        'none',
      ),
      optionalAttributes: enumeration<OptionalMode>(
        'optional-attributes',
        flags['optional-attributes'],
        ['none', 'all', 'random'],
        'none',
      ),
      choice: enumeration<'first' | 'smallest' | 'random' | 'all'>(
        'choice',
        flags.choice,
        ['first', 'smallest', 'random', 'all'],
        'first',
      ),
      ...(flags.locale !== undefined ? { locale: flags.locale } : {}),
      ...(flags.reach !== undefined ? { reach: flags.reach } : {}),
      coverage: flags.coverage ?? false,
      validate: !(flags['no-validate'] ?? false),
      fillElements: !(flags['no-element-values'] ?? false),
      fillAttributes: !(flags['no-attribute-values'] ?? false),
      json:
        format === 'xml'
          ? false
          : {
              mode: enumeration('json-mode', flags['json-mode'], ['compact', 'tree'], 'compact'),
              numbers: enumeration('json-numbers', flags['json-numbers'], ['number', 'string'], 'number'),
              ...(flags['text-property'] !== undefined ? { textProperty: flags['text-property'] } : {}),
            },
      ...(optionalDepth !== undefined ? { maxDepth: optionalDepth } : {}),
      ...(flags.nil !== undefined ? { nil: enumeration<NilMode>('nil', flags.nil, ['never', 'random'], 'never') } : {}),
      ...(flags.root ? { root: flags.root } : {}),
      ...(flags.date ? { referenceDate: flags.date } : {}),
      ...(flags.values ? { samples: readValues(flags.values) } : {}),
      ...(validator ? { validator } : {}),
      ...(access.limits ? { limits: access.limits } : {}),
    };
    const location = enumeration('schema-location', flags['schema-location'], ['none', 'relative', 'absolute'], 'none');
    if (location !== 'none') {
      const outputDirectory = flags['out-dir']
        ? resolve(flags['out-dir'])
        : flags.out
          ? dirname(resolve(flags.out))
          : process.cwd();
      options.schemaLocation = (
        location === 'absolute' ? resolve(entry) : relative(outputDirectory, resolve(entry))
      ).replaceAll('\\', '/');
    }
    const recordedOptions = { ...options };
    delete recordedOptions.validator;
    const batch = await generateSampleFiles(entry, { ...options, ...access });
    for (const sample of batch.samples) {
      for (const problem of sample.problems) {
        io.stderr(`${problem.severity} ${problem.code}: ${problem.message}\n`);
      }
      for (const error of sample.errors) {
        io.stderr(`${error}\n`);
      }
    }
    if (
      batch.samples.some(
        (s) => ['invalid', 'incomplete'].includes(s.status) || (format !== 'xml' && s.jsonStatus !== 'generated'),
      )
    ) {
      io.stderr('No files written: generation did not satisfy the requested output contract.\n');
      return 2;
    }
    if (mode === 'template' || flags['no-validate']) {
      io.stderr(
        `${mode === 'template' ? 'Template' : 'Unvalidated'} output: do not treat this as a validated test fixture.\n`,
      );
    }
    const outputs = batch.samples.flatMap((sample, index) => {
      const stem = `sample-${String(index + 1).padStart(4, '0')}${suffix(sample)}`;
      return [
        ...(format !== 'json' ? [{ file: `${stem}.xml`, text: sample.xml }] : []),
        ...(format !== 'xml' ? [{ file: `${stem}.json`, text: `${JSON.stringify(sample.json, null, 2)}\n` }] : []),
      ];
    });
    if (flags['out-dir']) {
      const directory = resolve(flags['out-dir']);
      try {
        mkdirSync(directory);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
          throw new Error(`output directory already exists: ${directory}; choose a new --out-dir`, { cause: error });
        }
        throw error;
      }
      try {
        for (const output of outputs) {
          writeFileSync(join(directory, output.file), output.text, { flag: 'wx' });
        }
        writeFileSync(
          join(directory, 'manifest.json'),
          `${JSON.stringify(
            {
              package: { name: 'xsd-faker', version: PACKAGE_VERSION },
              generation: recordedOptions,
              entry: basename(entry),
              format,
              jsonMode: options.json === false ? null : (options.json?.mode ?? 'compact'),
              jsonSchemaValidation: 'not-performed',
              coverage: batch.coverage,
              samples: batch.samples.map((s, i) => ({
                number: i + 1,
                seed: s.seed,
                attempts: s.attempts,
                status: s.status,
                xmlValid: s.valid ?? null,
                jsonStatus: s.jsonStatus,
                problems: s.problems,
                choices: s.choices,
              })),
            },
            null,
            2,
          )}\n`,
          { flag: 'wx' },
        );
      } catch (error) {
        rmSync(directory, { recursive: true, force: true });
        throw error;
      }
      io.stderr(`Wrote ${outputs.length} files and manifest.json to ${directory}\n`);
    } else {
      const output = outputs[0];
      if (!output) {
        throw new Error('no output was generated');
      }
      if (flags.out) {
        writeFileSync(flags.out, output.text, { flag: 'wx' });
      } else {
        io.stdout(output.text);
      }
    }
    if (options.coverage && !batch.coverage.complete) {
      io.stderr(
        `Choice coverage is incomplete: ${batch.coverage.covered}/${batch.coverage.total} encountered branches.\n`,
      );
      return 2;
    }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const INVALID_HELP = `xsd-faker invalid <entry.xsd> --out-dir <directory> [options]

Generate invalid samples: valid samples, each changed to break one rule of the schema, judged by the validator.
Confirmed samples are written as files; manifest.json lists every sample with its status.

  --out-dir <directory>           New directory for the samples and manifest.json (required)
  --root <name>                   Local name, prefix:name or {namespace}name
  --rules <list>                  Comma-separated rules (default: all), such as facet:pattern,structure:order
  --per-path <number>             Samples per rule and place in the schema (default: 1)
  --max-files <number>            Samples in all, chosen evenly across the rules (default: 500)
  --keep-unconfirmed              Also write samples that are not confirmed, under unconfirmed/
  --count <number>                Valid samples to start from (1..1000; default: 1)
  --coverage                     Start from samples that cover the choices; bounded by count
  --seed <number>                 Reproducible starting seed (default: 1)
  --optional-elements <mode>      none, all, random (default: all)
  --optional-attributes <mode>    none, all, random (default: all)
  --repeat <number>               Requested occurrences, clamped to XSD bounds (1)
  --choice <strategy>             first, smallest, random (default: first)
  --reach <path>                  Path the valid samples must contain; repeatable
  --locale <tag>                  Locale values: de or en (default: none)
  --values <file.json>            Value lists keyed by /Root/Element, /Root/@attr or type name
  --base-dir <directory>          Allowed schema directory (entry directory)
  --help                         Show this help

Rules: ${RULES.join(', ')}.
Exit codes: 0 completed, 1 input/runtime error, 2 no valid sample to start from.
`;

async function invalid(argv: string[], io: CliOutput, validator?: XmlValidator): Promise<number> {
  try {
    const { values: flags, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean' },
        root: { type: 'string' },
        'out-dir': { type: 'string' },
        rules: { type: 'string' },
        'per-path': { type: 'string' },
        'max-files': { type: 'string' },
        'keep-unconfirmed': { type: 'boolean' },
        count: { type: 'string' },
        coverage: { type: 'boolean' },
        seed: { type: 'string' },
        'optional-elements': { type: 'string' },
        'optional-attributes': { type: 'string' },
        repeat: { type: 'string' },
        choice: { type: 'string' },
        reach: { type: 'string', multiple: true },
        locale: { type: 'string' },
        values: { type: 'string' },
        'base-dir': { type: 'string' },
      },
    });
    if (flags.help) {
      io.stdout(INVALID_HELP);
      return 0;
    }
    if (positionals.length !== 1 || !positionals[0]) throw new TypeError('provide one entry XSD; see invalid --help');
    if (!flags['out-dir']) throw new TypeError('--out-dir is required');
    const entry = positionals[0];
    const rules = flags.rules?.split(',').map((rule) => rule.trim());
    for (const rule of rules ?? []) {
      if (!RULES.includes(rule as Rule)) throw new TypeError(`unknown rule ${rule}; rules are ${RULES.join(', ')}`);
    }
    const perRuleAndPath = integer('per-path', flags['per-path']);
    const maxFiles = integer('max-files', flags['max-files']);
    const options = {
      count: integer('count', flags.count) ?? 1,
      coverage: flags.coverage ?? false,
      seed: integer('seed', flags.seed) ?? 1,
      repeat: integer('repeat', flags.repeat) ?? 1,
      optionalElements: enumeration<OptionalMode>(
        'optional-elements',
        flags['optional-elements'],
        ['none', 'all', 'random'],
        'all',
      ),
      optionalAttributes: enumeration<OptionalMode>(
        'optional-attributes',
        flags['optional-attributes'],
        ['none', 'all', 'random'],
        'all',
      ),
      choice: enumeration<'first' | 'smallest' | 'random'>(
        'choice',
        flags.choice,
        ['first', 'smallest', 'random'],
        'first',
      ),
      ...(rules ? { rules: rules as Rule[] } : {}),
      ...(perRuleAndPath !== undefined ? { perRuleAndPath } : {}),
      ...(maxFiles !== undefined ? { maxFiles } : {}),
      ...(flags.reach !== undefined ? { reach: flags.reach } : {}),
      ...(flags.root ? { root: flags.root } : {}),
      ...(flags.locale !== undefined ? { locale: flags.locale } : {}),
      ...(flags.values ? { samples: readValues(flags.values) } : {}),
    };
    const access = flags['base-dir'] ? { baseDirectory: flags['base-dir'] } : {};
    const matrix = await generateInvalidSamples(fileInput(entry, access), {
      ...options,
      ...(validator ? { validator } : {}),
    });
    if (matrix.bases === 0) {
      io.stderr('No files written: no valid sample to start from.\n');
      return 2;
    }
    const directory = resolve(flags['out-dir']);
    try {
      mkdirSync(directory);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        throw new Error(`output directory already exists: ${directory}; choose a new --out-dir`, { cause: error });
      }
      throw error;
    }
    try {
      const keep = flags['keep-unconfirmed'] ?? false;
      if (keep) mkdirSync(join(directory, 'unconfirmed'));
      let written = 0;
      const samples = matrix.samples.map((sample, i) => {
        const name = `${String(i + 1).padStart(4, '0')}-${sample.rule.replace(':', '-')}.xml`;
        const file = sample.status === 'confirmed' ? name : keep ? `unconfirmed/${name}` : null;
        if (file !== null) {
          writeFileSync(join(directory, file), sample.xml, { flag: 'wx' });
          written += 1;
        }
        const { xml: _xml, tree: _tree, ...entryOf } = sample;
        void _xml;
        void _tree;
        return { number: i + 1, file, ...entryOf, expected: 'invalid' };
      });
      writeFileSync(
        join(directory, 'manifest.json'),
        `${JSON.stringify(
          {
            package: { name: 'xsd-faker', version: PACKAGE_VERSION },
            generation: options,
            entry: basename(entry),
            counts: matrix.counts,
            bases: matrix.bases,
            skipped: matrix.skipped,
            samples,
            notConstructible: matrix.notConstructible,
          },
          null,
          2,
        )}\n`,
        { flag: 'wx' },
      );
      const c = matrix.counts;
      io.stderr(
        `Wrote ${written} files and manifest.json to ${directory}: ${c.confirmed} confirmed, ${c['other-cause']} other cause, ` +
          `${c.accepted} accepted, ${c['not-checkable']} not checkable, ${c['not-constructible']} not constructible.\n`,
      );
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
