import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = (path: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', path), 'utf8')) as {
    version: string;
    scripts?: Record<string, string>;
    files?: string[];
    dependencies?: Record<string, string>;
  };

// Checks the package manifests. test/consumer.mjs verifies installation and use of the tarballs.
describe('the package manifests', () => {
  const faker = manifest('package.json');
  const locales = manifest('packages/locales/package.json');

  it('name a build before packing and dist among the files of each package', () => {
    for (const pkg of [faker, locales]) {
      expect(pkg.scripts?.prepack).toMatch(/npm run build/);
      expect(pkg.files).toContain('dist');
    }
  });

  it('make xsd-faker depend on the version of the locale package', () => {
    const range = faker.dependencies?.['xsd-faker-locales'] ?? '';
    expect(range).toBe(`^${locales.version}`);
  });
});
