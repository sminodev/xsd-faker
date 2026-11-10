/** XML Schema 1.0 validation with libxml2 in WebAssembly. No network resolution. */
export interface SchemaFiles {
  entry: string;
  files: ReadonlyMap<string, string>;
}
export interface Verdict {
  valid: boolean;
  errors: string[];
}
export type XmlValidator = (schema: SchemaFiles, documents: readonly string[]) => Promise<Verdict[]>;
export class SchemaCompileError extends Error {
  override name = 'SchemaCompileError';
}
/** Each document has its own verdict; an unclassified validator error can never turn into success. */
export async function validateXml(schema: SchemaFiles, documents: readonly string[]): Promise<Verdict[]> {
  if (documents.length === 0) {
    return [];
  }
  const { validateXML } = await import('xmllint-wasm');
  const verdicts: Verdict[] = [];
  for (const [index, contents] of documents.entries()) {
    try {
      const result = await validateXML({
        xml: [{ fileName: `sample-${index}.xml`, contents }],
        schema: [{ fileName: schema.entry, contents: schema.files.get(schema.entry) ?? '' }],
        preload: [...schema.files]
          .filter(([path]) => path !== schema.entry)
          .map(([fileName, source]) => ({ fileName, contents: source })),
      });
      const errors = result.errors.map((error) => error.message || error.rawMessage);
      if (!result.valid && errors.length === 0) {
        errors.push('validator rejected the document without a diagnostic');
      }
      verdicts.push({ valid: result.valid === true, errors });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/failed to compile|Schemas parser error/i.test(message)) {
        throw new SchemaCompileError(message);
      }
      throw error;
    }
  }
  return verdicts;
}
