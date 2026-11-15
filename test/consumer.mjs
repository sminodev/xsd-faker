// Packs both packages from a clean source copy and installs the tarballs into an empty project.
// Checks XML generation with the default validator, the installed CLI and the packaged type declarations.
//
// Usage: node test/consumer.mjs [source directory]. Reports failures and exits with code 1.
import { execFileSync, spawnSync } from 'node:child_process';
import console from 'node:console';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const source = resolve(process.argv[2] ?? repo);
const work = mkdtempSync(join(tmpdir(), 'xsd-faker-consumer-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (result.status !== 0) {
    const output = result.error ? result.error.message : `${result.stdout}\n${result.stderr}`;
    throw new Error(`${[command, ...args].join(' ')} failed in ${cwd}:\n${output}`);
  }
  return result.stdout;
}

/** Checks whether a path exists. Only ENOENT counts as missing; other errors propagate. */
function present(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/** Copies source files without build output or dependencies, using tracked and untracked files when Git is available. */
function copySources(to) {
  let files;
  try {
    files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: source,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    files = undefined;
  }
  if (files) {
    for (const file of files) {
      // git ls-files includes tracked files deleted from the working tree.
      if (!present(join(source, file))) continue;
      mkdirSync(dirname(join(to, file)), { recursive: true });
      cpSync(join(source, file), join(to, file));
    }
  } else {
    const skip = /(^|\/)(node_modules|dist|\.git)(\/|$)/;
    cpSync(source, to, { recursive: true, filter: (path) => !skip.test(path.slice(source.length)) });
  }
}

try {
  const clean = join(work, 'source');
  const packs = join(work, 'packs');
  const consumer = join(work, 'consumer');
  mkdirSync(packs);
  mkdirSync(consumer);
  copySources(clean);
  run(npm, ['ci', '--no-audit', '--no-fund'], clean);
  run(npm, ['pack', '--pack-destination', packs], clean);
  run(npm, ['pack', '--workspace', 'packages/locales', '--pack-destination', packs], clean);
  const tarballs = readdirSync(packs)
    .filter((f) => f.endsWith('.tgz'))
    .map((f) => join(packs, f));
  if (tarballs.length !== 2) throw new Error(`expected two tarballs, got ${tarballs.join(', ')}`);

  writeFileSync(join(consumer, 'package.json'), '{ "name": "consumer", "private": true, "type": "module" }\n');
  run(npm, ['install', '--no-audit', '--no-fund', ...tarballs], consumer);
  for (const name of ['xsd-faker', 'xsd-faker-locales']) {
    if (lstatSync(join(consumer, 'node_modules', name)).isSymbolicLink()) throw new Error(`${name} is a link`);
  }

  const schema = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Person"><xs:complexType><xs:sequence>
    <xs:element name="FirstName" type="xs:string"/><xs:element name="LastName" type="xs:string"/>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;
  writeFileSync(join(consumer, 'person.xsd'), schema);
  writeFileSync(
    join(consumer, 'use.mjs'),
    `import { generateSample, LOCALES } from 'xsd-faker';
import { generateSampleFile } from 'xsd-faker/node';
import { de, defineLocale } from 'xsd-faker-locales';
const own = defineLocale('de-x-consumer', { extends: de });
const memory = await generateSample({ entry: 'p.xsd', files: { 'p.xsd': ${JSON.stringify(schema)} } }, { locale: 'de', seed: 7 });
const file = await generateSampleFile('person.xsd', { locale: own, seed: 7 });
if (memory.status !== 'valid' || file.status !== 'valid') throw new Error(JSON.stringify([memory.errors, file.errors]));
if (!Object.keys(LOCALES).includes('de')) throw new Error('no built-in locale de');
console.log(memory.xml);
`,
  );
  const used = run(process.execPath, ['use.mjs'], consumer);
  if (!used.includes('<Person>')) throw new Error(`no document from the library:\n${used}`);

  // Run the installed executable directly to check its shebang and executable permission.
  const cli = run(join(consumer, 'node_modules', '.bin', 'xsd-faker'), ['person.xsd', '--locale', 'de'], consumer);
  if (!cli.includes('<Person>')) throw new Error(`no document from the command:\n${cli}`);

  writeFileSync(
    join(consumer, 'types.ts'),
    `import { generateSample, type GenerateOptions, type Sample } from 'xsd-faker';
import { generateSampleFile } from 'xsd-faker/node';
import { defineLocale, de, type LocaleData } from 'xsd-faker-locales';
const locale: LocaleData = defineLocale('de-x-types', { extends: de });
const options: GenerateOptions = { locale, seed: 1 };
export const memory: Promise<Sample> = generateSample({ entry: 'p.xsd', files: { 'p.xsd': '' } }, options);
export const file: Promise<Sample> = generateSampleFile('person.xsd', options);
`,
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { module: 'nodenext', target: 'es2022', strict: true, noEmit: true, skipLibCheck: false },
      files: ['types.ts'],
    }),
  );
  run(process.execPath, [join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], consumer);
  console.log(`consumer test passed: ${tarballs.map((t) => t.slice(packs.length + 1)).join(', ')}`);
} catch (error) {
  console.error(`consumer test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
