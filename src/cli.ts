import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { generateSampleFiles, listRootsFile } from './node.js';
import type { BatchOptions, OptionalMode, ProfileName, Sample, ValueLists, XmlValidator } from './index.js';
export interface CliOutput {
  stdout(text: string): void;
  stderr(text: string): void;
}
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const HELP = `xsd-faker <entry.xsd> [options]

Generate XML and JSON fixtures from XML Schema 1.0. No network access.

  --list-roots                    List global roots as JSON; no generation
  --root <name>                   Local name, prefix:name or {namespace}name
  --format <xml|json|both>         Default: xml
  --out <file>                    Single output; existing files are not overwritten
  --out-dir <directory>           New directory for a batch or paired XML/JSON
  --count <number>                Documents to generate (1..1000; default: 1)
  --seed <number>                 Reproducible starting seed (default: 1)
  --optional-elements <mode>      none, all, random (default: none)
  --optional-attributes <mode>    none, all, random (default: none)
  --optional-depth <number>       Optional depth below --max-depth (default: 12)
  --max-depth <number>            Hard depth limit, including required content (64)
  --max-nodes <number>            Hard element budget per document (10000)
  --repeat <number>               Requested occurrences, clamped to XSD bounds (1)
  --choice <strategy>             first, smallest, random, all (default: first)
  --coverage                     Prefer unexplored choice branches; bounded by count
  --profile <name>                generic, retail, insurance, logistics (default: none)
  --locale <en|de>                Locale for synthetic profile vocabulary (en)
  --date <ISO date>               Profile reference date (2026-01-15T12:00:00Z)
  --values <file.json>            Value lists keyed by /Root/Element or /Root/@attr
  --json-mode <compact|tree>      Local-name objects (default) or ordered tree
  --json-numbers <number|string>  Default: number; unsafe conversions are refused
  --text-property <name>          Simple/mixed content property (value)
  --schema-location <mode>        none, relative, absolute (default: none)
  --base-dir <directory>          Allowed schema directory (entry directory)
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
    throw new TypeError('values must be an object of absolute local-name paths and strings or string arrays');
  }
  for (const [key, item] of Object.entries(value)) {
    if (
      !key.startsWith('/') ||
      !(
        typeof item === 'string' ||
        (Array.isArray(item) && item.length > 0 && item.every((v: unknown) => typeof v === 'string'))
      )
    ) {
      throw new TypeError(`invalid value list: ${key}`);
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
        'max-depth': { type: 'string' },
        'max-nodes': { type: 'string' },
        choice: { type: 'string' },
        coverage: { type: 'boolean' },
        profile: { type: 'string' },
        locale: { type: 'string' },
        date: { type: 'string' },
        values: { type: 'string' },
        'json-mode': { type: 'string' },
        'json-numbers': { type: 'string' },
        'text-property': { type: 'string' },
        'schema-location': { type: 'string' },
        'base-dir': { type: 'string' },
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
    const access = flags['base-dir'] ? { baseDirectory: flags['base-dir'] } : {};
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
      ...(flags.profile !== undefined
        ? {
            profile: enumeration<ProfileName>(
              'profile',
              flags.profile,
              ['generic', 'retail', 'insurance', 'logistics'],
              'generic',
            ),
          }
        : {}),
      locale: enumeration('locale', flags.locale, ['en', 'de'], 'en'),
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
      ...(flags.root ? { root: flags.root } : {}),
      ...(flags.date ? { referenceDate: flags.date } : {}),
      ...(flags.values ? { samples: readValues(flags.values) } : {}),
      ...(validator ? { validator } : {}),
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
    const { validator: _validator, ...recordedOptions } = options;
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
          throw new Error(`output directory already exists: ${directory}; choose a new --out-dir`);
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
