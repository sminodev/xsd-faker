import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { generateSampleFile } from './node.js';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
/** xsd-faker guides; the locale package README also covers standalone use. */
const GUIDES = [
  'README.md',
  'CONTRIBUTING.md',
  'examples/README.md',
  ...readdirSync(join(root, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
];

/** The names each code example imports, by module. */
function imports(markdown: string): { module: string; name: string }[] {
  const out: { module: string; name: string }[] = [];
  for (const block of markdown.matchAll(/```(?:js|ts|javascript|typescript)\n([\s\S]*?)```/g)) {
    for (const m of (block[1] ?? '').matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)) {
      for (const part of (m[1] ?? '').split(',')) {
        const name = part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0];
        if (name) out.push({ module: m[2] ?? '', name });
      }
    }
  }
  return out;
}

/** Every export of a module, types included. */
function exportsOf(...files: string[]): Map<string, Set<string>> {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(root, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => undefined,
    },
  );
  const program = ts.createProgram(
    files.map((f) => join(root, f)),
    config?.options ?? {},
  );
  const checker = program.getTypeChecker();
  const out = new Map<string, Set<string>>();
  for (const file of files) {
    const source = program.getSourceFile(join(root, file));
    const symbol = source && checker.getSymbolAtLocation(source);
    out.set(file, new Set(symbol ? checker.getExportsOfModule(symbol).map((s) => s.name) : []));
  }
  return out;
}

describe('documentation', () => {
  const exported = exportsOf('src/index.ts', 'src/node.ts', 'packages/locales/src/index.ts');
  const modules: Record<string, Set<string> | undefined> = {
    'xsd-faker': exported.get('src/index.ts'),
    'xsd-faker/node': exported.get('src/node.ts'),
  };

  it('imports only what xsd-faker exports', () => {
    const missing = [...GUIDES, 'packages/locales/README.md'].flatMap((file) =>
      imports(read(file))
        .filter(({ module }) => module === 'xsd-faker' || module.startsWith('xsd-faker/'))
        .filter(({ module, name }) => !modules[module]?.has(name))
        .map(({ module, name }) => `${file}: ${name} from ${module}`),
    );
    expect(missing).toEqual([]);
    expect(GUIDES.flatMap((file) => imports(read(file))).length).toBeGreaterThan(10);
  });

  it('never imports from the locale package, which comes with xsd-faker', () => {
    const direct = GUIDES.filter((file) => imports(read(file)).some(({ module }) => module === 'xsd-faker-locales'));
    expect(direct).toEqual([]);
  });

  it('can rely on xsd-faker exporting everything of the locale package', () => {
    const own = modules['xsd-faker'] ?? new Set();
    const locales = [...(exported.get('packages/locales/src/index.ts') ?? [])];
    expect(locales.length).toBeGreaterThan(5);
    expect(locales.filter((name) => !own.has(name))).toEqual([]);
  });
});

describe('the walk-through of the development guide', () => {
  it('shows the XML and JSON the example generates with seed 7', async () => {
    const guide = read('docs/development.md');
    const section = guide.slice(guide.indexOf('## A walk through one schema'), guide.indexOf('## Checks'));
    const xml = /```xml\n([\s\S]*?)```/.exec(section)?.[1];
    const json = /```json\n([\s\S]*?)```/.exec(section)?.[1];
    const sample = await generateSampleFile(join(root, 'examples/order/order.xsd'), {
      seed: 7,
      optionalElements: 'all',
      locale: 'de',
      samples: JSON.parse(read('examples/order/values.json')) as Record<string, string[]>,
    });
    expect(sample.status).toBe('valid');
    expect(sample.xml).toBe(xml);
    expect(sample.json).toEqual(JSON.parse(json ?? 'null'));
  });
});
