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

describe('the packages', () => {
  const faker = manifest('package.json');
  const locales = manifest('packages/locales/package.json');

  it('each build their dist when packed, so a clean checkout packs complete tarballs', () => {
    for (const pkg of [faker, locales]) {
      expect(pkg.scripts?.prepack).toMatch(/npm run build/);
      expect(pkg.files).toContain('dist');
    }
  });

  it('depend on each other in a version the locale package has', () => {
    const range = faker.dependencies?.['xsd-faker-locales'] ?? '';
    expect(range).toBe(`^${locales.version}`);
  });
});
