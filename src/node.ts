import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  type BatchOptions,
  type GenerateInput,
  type GenerateOptions,
  GenerateError,
  generateSample,
  generateSamples,
  listRoots,
} from './index.js';
import { decodeSchema } from './xsd/encoding.js';
import {
  effectiveLimits,
  isAbsoluteUri,
  SchemaLimitError,
  type SchemaLimits,
  UnsafeLocationError,
} from './xsd/schema-set.js';
export * from './index.js';
export interface FileAccessOptions {
  /** Allowed schema directory. Defaults to the entry file's directory; symlinks cannot escape it. */
  baseDirectory?: string;
  /** The schema size limits; `maxFileBytes` is also checked against the file size before reading. */
  limits?: SchemaLimits;
}
export function fileInput(entryFile: string, access: FileAccessOptions = {}): GenerateInput {
  try {
    return localInput(entryFile, access);
  } catch (error) {
    // Preserve the same option errors as the in-memory API.
    if (error instanceof GenerateError || error instanceof TypeError || error instanceof RangeError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new GenerateError(message, [{ code: 'missing-file', severity: 'error', message, file: entryFile }]);
  }
}
function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
function localInput(entryFile: string, access: FileAccessOptions): GenerateInput {
  const { maxFileBytes } = effectiveLimits(access.limits);
  // Use the entry path's directory as the default boundary, before resolving symlinks.
  const lexical = resolve(entryFile);
  const named = join(realpathOrSelf(dirname(lexical)), basename(lexical));
  const base = realpathSync(resolve(access.baseDirectory ?? dirname(named)));
  const confined = (file: string): boolean => {
    const part = relative(base, file);
    return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
  };
  const unsafe = (message: string) =>
    new GenerateError(message, [{ code: 'unsafe-input', severity: 'error', message, file: entryFile }]);
  if (!confined(named)) throw unsafe('entry is outside baseDirectory');
  const entry = realpathSync(named);
  if (!confined(entry)) throw unsafe('entry is a symlink that leads out of baseDirectory');
  return {
    entry: relative(base, entry).split(sep).join('/'),
    files(path) {
      // Require relative local paths so every reference goes through the boundary checks below; URIs are not fetched.
      if (/^file:/i.test(path) || isAbsolute(path)) {
        throw new UnsafeLocationError('only relative local schema locations are allowed');
      }
      if (isAbsoluteUri(path)) {
        throw new Error(
          'only relative local schema locations are allowed; use an in-memory source to map external URIs',
        );
      }
      const candidate = resolve(base, ...path.split('/'));
      if (!confined(candidate)) {
        throw new UnsafeLocationError('the path escapes baseDirectory');
      }
      let actual: string;
      try {
        actual = realpathSync(candidate);
      } catch {
        return undefined;
      }
      if (!confined(actual)) {
        throw new UnsafeLocationError('a symlink leads out of baseDirectory');
      }
      const size = statSync(actual).size;
      if (size > maxFileBytes) {
        throw new SchemaLimitError(`schema document ${path} has ${size} bytes, more than maxFileBytes ${maxFileBytes}`);
      }
      // Decoded by its byte order mark and XML declaration; the limits count the file's bytes.
      const bytes = readFileSync(actual);
      return { text: decodeSchema(bytes, path), bytes: bytes.length };
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
  return listRoots(fileInput(entry, options), options);
}
