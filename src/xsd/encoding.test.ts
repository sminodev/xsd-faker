import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateSampleFile } from '../node.js';
import { decodeSchema, SchemaEncodingError } from './encoding.js';

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
// The bytes of "Müller" in UTF-8, C3 BC, are also two characters of ISO-8859-1: Ã and ¼.
const muller = [0x4d, 0xc3, 0xbc, 0x6c, 0x6c, 0x65, 0x72];
const schema = (declaration: string) =>
  bytes(
    declaration,
    '\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r"><xs:simpleType>',
    '<xs:restriction base="xs:string"><xs:enumeration value="',
    muller,
    '"/></xs:restriction></xs:simpleType></xs:element></xs:schema>\n',
  );

describe('decodeSchema', () => {
  it('reads the encoding of an XML declaration of any length', () => {
    for (const padding of [0, 600, 5000]) {
      const declaration = `<?xml version="1.0"${' '.repeat(padding)} encoding="ISO-8859-1"?>`;
      const text = decodeSchema(schema(declaration), 'a.xsd');
      expect(text, `padding ${padding}`).toContain('value="MÃ¼ller"');
    }
  });

  it('refuses a declaration that does not end', () => {
    const open = bytes(`<?xml version="1.0"${' '.repeat(600)} encoding="ISO-8859-1"\n<xs:schema/>`);
    expect(() => decodeSchema(open, 'a.xsd')).toThrow(SchemaEncodingError);
    expect(() => decodeSchema(open, 'a.xsd')).toThrow(/does not end/);
  });

  it('refuses a label that names no supported encoding, also one Object.prototype has, with or without a BOM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xsd-encoding-label-'));
    try {
      for (const label of ['constructor', 'toString', 'hasOwnProperty', 'windows-1252']) {
        for (const bom of [[], [0xef, 0xbb, 0xbf]]) {
          const input = bytes(
            bom,
            `<?xml version="1.0" encoding="${label}"?><xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="R" type="xs:string"/></xs:schema>`,
          );
          const error = (() => {
            try {
              decodeSchema(input, 'a.xsd');
            } catch (e) {
              return e;
            }
            return undefined;
          })();
          expect(error, `${label} ${bom.length}`).toBeInstanceOf(SchemaEncodingError);
          expect((error as SchemaEncodingError).code).toBe('unsupported-encoding');
          const file = join(dir, 'a.xsd');
          writeFileSync(file, input);
          const failure = (await generateSampleFile(file, { seed: 1 }).catch((e: unknown) => e)) as {
            problems?: { code: string }[];
          };
          expect(
            failure.problems?.map((p) => p.code),
            `${label} ${bom.length}`,
          ).toEqual(['unsupported-encoding']);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gives the value of the declared encoding through the file API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xsd-long-declaration-'));
    try {
      const file = join(dir, 'a.xsd');
      writeFileSync(file, schema(`<?xml version="1.0"${' '.repeat(600)} encoding="ISO-8859-1"?>`));
      const sample = await generateSampleFile(file, { seed: 1 });
      expect(sample.status).toBe('valid');
      expect(sample.json).toBe('MÃ¼ller');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
