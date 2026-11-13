/** XML Schema 1.0 validation with libxml2 in WebAssembly. No network resolution. */
export interface SchemaFiles {
  entry: string;
  files: ReadonlyMap<string, string>;
}
export interface Verdict {
  valid: boolean;
  errors: string[];
  /** The line of each error in its document, where the validator names one. Only for a rejected document. */
  lines?: (number | undefined)[];
}
export type XmlValidator = (schema: SchemaFiles, documents: readonly string[]) => Promise<Verdict[]>;
export class SchemaCompileError extends Error {
  override name = 'SchemaCompileError';
}
/** The default of 32 MiB is too small for documents that `maxNodes` allows. */
const MAX_MEMORY_GIB = 2;
/** One validator run takes at most this many documents, and more only while they stay below the byte limit. */
const BATCH_DOCUMENTS = 200;
const BATCH_BYTES = 8 * 1024 * 1024;

type Library = typeof import('xmllint-wasm');

/**
 * Each document has its own verdict; an unclassified validator error can never turn into success. Documents are
 * validated in batches against one compiled schema; a batch whose output cannot be split into one block per document
 * is validated again one document at a time, so a verdict never depends on the batch it was in.
 */
export async function validateXml(schema: SchemaFiles, documents: readonly string[]): Promise<Verdict[]> {
  if (documents.length === 0) {
    return [];
  }
  const library = await import('xmllint-wasm');
  const verdicts: Verdict[] = [];
  for (const [start, end] of batches(documents)) {
    const indices = Array.from({ length: end - start }, (_, k) => start + k);
    const batch = indices.length > 1 ? await inBatch(library, schema, documents, indices) : undefined;
    for (const index of indices) {
      verdicts.push(batch?.get(index) ?? (await alone(library, schema, documents[index] ?? '', index)));
    }
  }
  return verdicts;
}

function batches(documents: readonly string[]): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  let bytes = 0;
  for (const [index, document] of documents.entries()) {
    const size = document.length;
    if (index > start && (index - start >= BATCH_DOCUMENTS || bytes + size > BATCH_BYTES)) {
      out.push([start, index]);
      start = index;
      bytes = 0;
    }
    bytes += size;
  }
  out.push([start, documents.length]);
  return out;
}

const fileName = (index: number): string => `sample-${index}.xml`;

function run(library: Library, schema: SchemaFiles, xml: { fileName: string; contents: string }[]) {
  return library.validateXML({
    xml,
    schema: [{ fileName: schema.entry, contents: schema.files.get(schema.entry) ?? '' }],
    preload: [...schema.files]
      .filter(([path]) => path !== schema.entry)
      .map(([name, source]) => ({ fileName: name, contents: source })),
    maxMemoryPages: MAX_MEMORY_GIB * library.memoryPages.GiB,
  });
}

async function alone(library: Library, schema: SchemaFiles, contents: string, index: number): Promise<Verdict> {
  try {
    const result = await run(library, schema, [{ fileName: fileName(index), contents }]);
    if (result.valid) return { valid: true, errors: [] };
    return rejected(
      result.errors.map((error) => ({
        message: error.message || error.rawMessage,
        ...(error.loc?.fileName === fileName(index) ? { line: error.loc.lineNumber } : {}),
      })),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/failed to compile|Schemas parser error/i.test(message)) {
      throw new SchemaCompileError(message);
    }
    throw error;
  }
}

function rejected(found: readonly { message: string; line?: number }[]): Verdict {
  const errors = found.map((error) => error.message);
  const lines = found.map((error) => error.line);
  if (errors.length === 0) {
    errors.push('validator rejected the document without a diagnostic');
    lines.push(undefined);
  }
  return { valid: false, errors, lines };
}

/**
 * The verdicts of a batch, or undefined where its output does not split cleanly; the caller then validates each
 * document alone. xmllint writes the messages of its documents one after the other: lines before the first document
 * concern the schema and are repeated for each one, as a run with that document alone would show them.
 */
async function inBatch(
  library: Library,
  schema: SchemaFiles,
  documents: readonly string[],
  indices: readonly number[],
): Promise<Map<number, Verdict> | undefined> {
  let output: string;
  try {
    const result = await run(
      library,
      schema,
      indices.map((index) => ({ fileName: fileName(index), contents: documents[index] ?? '' })),
    );
    output = result.rawOutput;
  } catch {
    // A schema that does not compile, or a resource limit: the single runs report it for their document.
    return undefined;
  }
  const blocks = splitOutput(output, indices);
  if (!blocks) return undefined;
  const verdicts = new Map<number, Verdict>();
  for (const index of indices) {
    const block = blocks.documents.get(index) ?? [];
    if (block.at(-1) === `${fileName(index)} validates`) {
      verdicts.set(index, { valid: true, errors: [] });
      continue;
    }
    verdicts.set(index, rejected(messages([...blocks.preamble, ...block], fileName(index))));
  }
  return verdicts;
}

/** The output lines of each document, in the order of the batch; undefined unless every document has one block. */
export function splitOutput(
  output: string,
  indices: readonly number[],
): { preamble: string[]; documents: Map<number, string[]> } | undefined {
  const lines = output.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const preamble: string[] = [];
  const documents = new Map<number, string[]>();
  let position = -1;
  let closed = false;
  for (const line of lines) {
    const owner = /^sample-(\d+)\.xml(?::\d+:| validates$| fails to validate$)/.exec(line);
    const index = owner ? Number(owner[1]) : undefined;
    if (index !== undefined && index !== indices[position]) {
      // The next document begins; documents must come in order, each once.
      if (index !== indices[position + 1]) return undefined;
      position += 1;
      closed = false;
    } else if (closed || (index === undefined && position < 0)) {
      if (position >= 0) return undefined;
      preamble.push(line);
      continue;
    }
    const key = indices[position] as number;
    const block = documents.get(key) ?? [];
    block.push(line);
    documents.set(key, block);
    if (line === `${fileName(key)} validates` || line === `${fileName(key)} fails to validate`) closed = true;
  }
  if (position !== indices.length - 1) return undefined;
  // Every block ends with its verdict, except a document that is not well-formed: it begins with a parser message.
  for (const index of indices) {
    const block = documents.get(index) ?? [];
    const last = block.at(-1) ?? '';
    const ends = last === `${fileName(index)} validates` || last === `${fileName(index)} fails to validate`;
    if (!ends && !/^sample-\d+\.xml:\d+: (?:parser|namespace|validity) (?:error|warning)/.test(block[0] ?? '')) {
      return undefined;
    }
  }
  return { preamble, documents };
}

/**
 * The messages of a document's lines, as xmllint-wasm parses a run of that document alone: it splits each line at
 * `file:line:`, leaves out the last line of the output and the line that reports success.
 */
function messages(lines: readonly string[], name: string): { message: string; line?: number }[] {
  return lines.slice(0, -1).flatMap((raw) => {
    const [file, line, ...rest] = raw.split(':');
    const located = Boolean(file && line && rest.length > 0);
    if (!located && raw.trim().endsWith(' validates')) return [];
    const message = located ? rest.join(':').trim() || raw : raw;
    return [{ message, ...(located && file === name ? { line: Number.parseInt(line ?? '', 10) } : {}) }];
  });
}
