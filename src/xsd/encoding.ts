// The character encoding of a schema file: taken from its byte order mark and XML declaration, then decoded strictly.
// Supported are UTF-8 (the default), UTF-16 with a byte order mark, ISO-8859-1 (each byte its code point) and
// US-ASCII. A replacement character never stands in for a byte that does not decode.

/** Why the bytes of a schema file give no text: an encoding outside the supported set, or bytes that do not decode. */
export class SchemaEncodingError extends Error {
  override name = 'SchemaEncodingError';
  constructor(
    readonly code: 'unsupported-encoding' | 'invalid-xml',
    message: string,
  ) {
    super(message);
  }
}

type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'latin1' | 'ascii';

const NAMES: Readonly<Record<string, Encoding | 'utf-16'>> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  'utf-16': 'utf-16',
  utf16: 'utf-16',
  'iso-8859-1': 'latin1',
  iso_8859_1: 'latin1',
  'iso_8859-1': 'latin1',
  latin1: 'latin1',
  'us-ascii': 'ascii',
  ascii: 'ascii',
};

/** The encoding an XML declaration names, by label in any case; own entries only, so `constructor` names none. */
const encodingOf = (label: string): Encoding | 'utf-16' | undefined => {
  const key = label.toLowerCase();
  return Object.hasOwn(NAMES, key) ? NAMES[key] : undefined;
};

/** The encoding named in the XML declaration at the start of `text`, if any. */
export function declaredEncoding(text: string): string | undefined {
  const declaration = /^\uFEFF?<\?xml[ \t\r\n][^>]*?\?>/.exec(text)?.[0];
  return (
    declaration && /[ \t\r\n]encoding[ \t\r\n]*=[ \t\r\n]*(["'])([A-Za-z][A-Za-z0-9._-]*)\1/.exec(declaration)?.[2]
  );
}

/**
 * Decodes the bytes of a schema file. A byte order mark stays in the text as U+FEFF, so that a second one can be
 * recognized; the XML declaration is left as it is.
 */
export function decodeSchema(bytes: Uint8Array, path: string): string {
  let bom: Encoding | undefined;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bom = 'utf-8';
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) bom = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) bom = 'utf-16be';
  // Without a byte order mark the declaration is ASCII; with one, it is read from the decoded text.
  const head = bom ? undefined : declaredEncoding(latin1(bytes.subarray(0, declarationEnd(bytes, path))));
  let encoding: Encoding = bom ?? 'utf-8';
  if (head !== undefined) {
    const named = encodingOf(head);
    if (named === undefined)
      throw new SchemaEncodingError('unsupported-encoding', `${path}: encoding ${head} is not supported`);
    if (named === 'utf-16') throw new SchemaEncodingError('invalid-xml', `${path}: UTF-16 without a byte order mark`);
    encoding = named;
  }
  const text = decode(bytes, encoding, path);
  if (bom) {
    const declared = declaredEncoding(text);
    const named = declared === undefined ? undefined : encodingOf(declared);
    if (declared !== undefined && named === undefined) {
      throw new SchemaEncodingError('unsupported-encoding', `${path}: encoding ${declared} is not supported`);
    }
    const fits = named === undefined || named === bom || (named === 'utf-16' && bom !== 'utf-8');
    if (!fits) {
      throw new SchemaEncodingError('invalid-xml', `${path}: the byte order mark contradicts encoding ${declared}`);
    }
  }
  return text;
}

/**
 * Where the XML declaration at the start of the bytes ends, after its `?>`, or 0 without one. The whole declaration
 * is read, however long, so that its encoding is never missed; one that does not end is no XML.
 */
function declarationEnd(bytes: Uint8Array, path: string): number {
  const start = [0x3c, 0x3f, 0x78, 0x6d, 0x6c]; // <?xml
  if (!start.every((b, k) => bytes[k] === b) || ![0x20, 0x09, 0x0d, 0x0a].includes(bytes[5] ?? 0)) return 0;
  for (let k = 6; k + 1 < bytes.length; k += 1) {
    if (bytes[k] === 0x3f && bytes[k + 1] === 0x3e) return k + 2;
    if (bytes[k] === 0x3c) break;
  }
  throw new SchemaEncodingError('invalid-xml', `${path}: the XML declaration does not end with ?>`);
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let k = 0; k < bytes.length; k += 0x8000) out += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return out;
}

function decode(bytes: Uint8Array, encoding: Encoding, path: string): string {
  if (encoding === 'latin1') return latin1(bytes);
  if (encoding === 'ascii') {
    const at = bytes.findIndex((b) => b > 0x7f);
    if (at >= 0) throw new SchemaEncodingError('invalid-xml', `${path}: byte ${bytes[at]} at ${at} is not US-ASCII`);
    return latin1(bytes);
  }
  try {
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SchemaEncodingError('invalid-xml', `${path}: the bytes are not valid ${encoding.toUpperCase()}`);
  }
}

/**
 * The text as libxml2 should read it: already decoded, so an encoding in the XML declaration becomes UTF-8, the
 * encoding the text is passed in.
 */
export function utf8Declaration(text: string): string {
  return text.replace(
    /^(\uFEFF?<\?xml[ \t\r\n][^>]*?[ \t\r\n]encoding[ \t\r\n]*=[ \t\r\n]*)(["'])[A-Za-z][A-Za-z0-9._-]*\2/,
    '$1$2UTF-8$2',
  );
}
