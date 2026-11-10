import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  type BatchOptions,
  type GenerateInput,
  type GenerateOptions,
  GenerateError,
  generateSample,
  generateSamples,
  listRoots,
} from './index.js';
import { isAbsoluteUri } from './xsd/schema-set.js';
export * from './index.js';
export interface FileAccessOptions {
  /** Allowed schema directory. Defaults to the entry file's directory; symlinks cannot escape it. */
  baseDirectory?: string;
}
export function fileInput(entryFile: string, access: FileAccessOptions = {}): GenerateInput {
  try {
    return localInput(entryFile, access);
  } catch (error) {
    if (error instanceof GenerateError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new GenerateError(message, [{ code: 'missing-file', severity: 'error', message, file: entryFile }]);
  }
}
function localInput(entryFile: string, access: FileAccessOptions): GenerateInput {
  const entry = realpathSync(resolve(entryFile));
  const base = realpathSync(resolve(access.baseDirectory ?? dirname(entry)));
  const confined = (file: string): boolean => {
    const part = relative(base, file);
    return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
  };
  if (!confined(entry)) {
    throw new GenerateError('entry is outside baseDirectory', [
      { code: 'unsafe-input', severity: 'error', message: 'entry is outside baseDirectory', file: entryFile },
    ]);
  }
  return {
    entry: relative(base, entry).split(sep).join('/'),
    files(path) {
      if (isAbsoluteUri(path) || isAbsolute(path)) {
        throw new Error(
          'only relative local schema locations are allowed; use an in-memory source to map external URIs',
        );
      }
      const candidate = resolve(base, ...path.split('/'));
      if (!confined(candidate)) {
        throw new Error('schema path escapes baseDirectory');
      }
      let actual: string;
      try {
        actual = realpathSync(candidate);
      } catch {
        return undefined;
      }
      if (!confined(actual)) {
        throw new Error('schema symlink escapes baseDirectory');
      }
      if (statSync(actual).size > 2 * 1024 * 1024) throw new Error('schema input exceeds the 2 MiB file limit');
      return readFileSync(actual, 'utf8');
    },
  };
}
export async function generateSampleFile(entry: string, options: GenerateOptions & FileAccessOptions = {}) {
  return generateSample(fileInput(entry, options), options);
}
export async function generateSampleFiles(entry: string, options: BatchOptions & FileAccessOptions = {}) {
  return generateSamples(fileInput(entry, options), options);
}
export function listRootsFile(entry: string, options: FileAccessOptions = {}) {
  return listRoots(fileInput(entry, options));
}
