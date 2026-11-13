// The DOCTYPE profile of schema input. A DTD never reaches a parser or validator: one DOCTYPE of a narrow, inert form
// is replaced by spaces (newlines stay, so line numbers do not move), everything else that a DTD could do is refused.
//
// Allowed in the internal subset: comments; general entities with a purely literal value that the document does not
// use; empty parameter entities that nothing references; CDATA ATTLIST declarations for namespace attributes of the
// root element whose default the root element already carries, explicitly and with the same value. A PUBLIC or SYSTEM
// identifier is only text and is never read. The scan follows the XML grammar where it matters for the decision:
// comments end at the first `-->` after `<!--`, white space stands where XML requires it, names consist of XML name
// characters. It reads the text once, from left to right.

import { NAME_CHAR, NAME_START_CHAR } from './namechars.js';

/**
 * What the scan found: no DOCTYPE, an inert one replaced in `text`, a refused one, or a text that is not XML before
 * any DOCTYPE question arises (a second byte order mark, anything before the XML declaration).
 */
export type DoctypeScan =
  | { kind: 'none' }
  | { kind: 'neutralized'; text: string }
  | { kind: 'unsafe'; reason: string }
  | { kind: 'invalid'; reason: string };

const PREDEFINED = new Set(['lt', 'gt', 'amp', 'apos', 'quot']);
const SPACE = /[ \t\r\n]/;
const NAME = new RegExp(`[${NAME_START_CHAR}][${NAME_CHAR}]*`, 'uy');
const REFERENCE = new RegExp(`&(?:#[0-9]+|#x[0-9a-fA-F]+|([${NAME_START_CHAR}][${NAME_CHAR}]*));`, 'uy');

class Unsafe extends Error {}
class Invalid extends Error {}

export function scanDoctype(text: string): DoctypeScan {
  try {
    return scan(text);
  } catch (error) {
    if (error instanceof Unsafe) return { kind: 'unsafe', reason: error.message };
    if (error instanceof Invalid) return { kind: 'invalid', reason: error.message };
    throw error;
  }
}

function scan(text: string): DoctypeScan {
  let i = 0;
  const at = (s: string) => text.startsWith(s, i);
  const space = (): boolean => {
    const start = i;
    while (i < text.length && SPACE.test(text.charAt(i))) i += 1;
    return i > start;
  };
  /** White space that XML requires here. */
  const required = (where: string): void => {
    if (!space()) throw new Unsafe(`the DOCTYPE lacks white space ${where}`);
  };
  /** Moves past `open`, then past the first `close` after it; false if the text ends first, for the parser. */
  const skip = (open: string, close: string): boolean => {
    const found = text.indexOf(close, i + open.length);
    if (found < 0) return false;
    i = found + close.length;
    return true;
  };
  const readName = (): string | undefined => {
    NAME.lastIndex = i;
    const match = NAME.exec(text);
    if (!match) return undefined;
    i = NAME.lastIndex;
    return match[0];
  };
  const name = (what: string): string => {
    const found = readName();
    if (found === undefined) throw new Unsafe(`the DOCTYPE has no valid ${what}`);
    // A name runs until a character that may follow it: white space, a quote, or the end of the declaration.
    if (i < text.length && !/[ \t\r\n"'>[\]]/.test(text.charAt(i))) {
      throw new Unsafe(`the ${what} ${found} in the DOCTYPE is followed by a character that is no name character`);
    }
    return found;
  };
  const literal = (what: string): string => {
    const quote = text.charAt(i);
    if (quote !== '"' && quote !== "'") throw new Unsafe(`the DOCTYPE has no quoted ${what}`);
    const end = text.indexOf(quote, i + 1);
    if (end < 0) throw new Unsafe(`the ${what} in the DOCTYPE is not closed`);
    const value = text.slice(i + 1, end);
    i = end + 1;
    return value;
  };
  const keyword = (word: string): boolean => {
    if (!at(word) || !SPACE.test(text.charAt(i + word.length))) return false;
    i += word.length;
    return true;
  };

  // At most one byte order mark, and nothing before the XML declaration.
  if (text.charAt(0) === '\uFEFF') i = 1;
  if (text.charAt(i) === '\uFEFF') throw new Invalid('the text starts with more than one byte order mark');
  const declaration = (from: number) => /^<\?xml[ \t\r\n?]/.test(text.slice(from, from + 6));
  if (declaration(i)) {
    if (!skip('<?', '?>')) return { kind: 'none' };
  } else {
    const start = i;
    space();
    if (i > start && declaration(i)) throw new Invalid('white space before the XML declaration');
    i = start;
  }

  // The prolog: comments, processing instructions, at most one DOCTYPE, then the root element.
  let doctype: { start: number; end: number } | undefined;
  const defaults: { element: string; name: string; value: string }[] = [];
  for (;;) {
    space();
    // A byte order mark belongs at the very start; anywhere else in the prolog it is a character out of place.
    if (text.charAt(i) === '\uFEFF') throw new Invalid('a byte order mark that is not at the start');
    if (at('<!--')) {
      if (!skip('<!--', '-->')) return { kind: 'none' };
    } else if (at('<?')) {
      if (declaration(i)) throw new Invalid('an XML declaration that is not at the start');
      if (!skip('<?', '?>')) return { kind: 'none' };
    } else if (at('<!DOCTYPE') && SPACE.test(text.charAt(i + 9))) {
      if (doctype) throw new Unsafe('more than one DOCTYPE');
      const start = i;
      i += 9;
      doctypeDeclaration();
      doctype = { start, end: i };
    } else if (at('<!')) {
      throw new Unsafe('a markup declaration outside an allowed DOCTYPE');
    } else {
      break;
    }
  }

  function doctypeDeclaration(): void {
    required('after DOCTYPE');
    name('root name');
    const spaced = space();
    if (keyword('SYSTEM') || keyword('PUBLIC')) {
      if (!spaced) throw new Unsafe('the DOCTYPE lacks white space before its external identifier');
      const pub = text.slice(i - 6, i) === 'PUBLIC';
      required('after SYSTEM or PUBLIC');
      if (pub) {
        literal('public identifier');
        required('between the public and the system identifier');
      }
      literal('system identifier');
      space();
    }
    if (at('[')) {
      i += 1;
      subset();
      space();
    }
    if (!at('>')) throw new Unsafe('the DOCTYPE is not closed');
    i += 1;
  }

  function subset(): void {
    for (;;) {
      space();
      if (at(']')) {
        i += 1;
        return;
      }
      if (at('<!--')) {
        if (!skip('<!--', '-->')) throw new Unsafe('a comment in the DOCTYPE is not closed');
      } else if (at('%')) {
        throw new Unsafe('the DOCTYPE uses a parameter entity');
      } else if (at('<!ENTITY')) {
        i += 8;
        entity();
      } else if (at('<!ATTLIST')) {
        i += 9;
        attlist();
      } else if (at('<!ELEMENT') || at('<!NOTATION')) {
        throw new Unsafe('the DOCTYPE declares an element or a notation');
      } else if (at('<![')) {
        throw new Unsafe('the DOCTYPE has a conditional section');
      } else {
        throw new Unsafe('the DOCTYPE has a declaration outside the allowed profile');
      }
    }
  }

  function entity(): void {
    required('after <!ENTITY');
    const parameter = at('%');
    if (parameter) {
      i += 1;
      required('after % in a parameter entity declaration');
    }
    const entityName = name('entity name');
    required(`after the entity name ${entityName}`);
    if (at('SYSTEM') || at('PUBLIC')) throw new Unsafe(`the DOCTYPE declares the external entity ${entityName}`);
    const value = literal(`value of entity ${entityName}`);
    space();
    if (!at('>')) throw new Unsafe(`the declaration of entity ${entityName} has more than a literal value`);
    i += 1;
    if (parameter && value !== '') throw new Unsafe(`the parameter entity ${entityName} is not empty`);
    if (!parameter && PREDEFINED.has(entityName)) throw new Unsafe(`the DOCTYPE redefines the entity ${entityName}`);
    if (/[&%<]/.test(value)) throw new Unsafe(`the value of entity ${entityName} is not purely literal`);
  }

  function attlist(): void {
    required('after <!ATTLIST');
    const element = name('ATTLIST element');
    for (;;) {
      const spaced = space();
      if (at('>')) {
        i += 1;
        return;
      }
      if (!spaced) throw new Unsafe('the ATTLIST lacks white space before an attribute definition');
      const attribute = name('ATTLIST attribute');
      required(`after the ATTLIST attribute ${attribute}`);
      const type = name(`type of ${attribute}`);
      required(`after the type of ${attribute}`);
      if (attribute !== 'xmlns' && !attribute.startsWith('xmlns:')) {
        throw new Unsafe(`the ATTLIST declares ${attribute}, not a namespace attribute`);
      }
      if (type !== 'CDATA') throw new Unsafe(`the ATTLIST gives ${attribute} the type ${type}`);
      if (at('#FIXED')) {
        i += 6;
        required(`after #FIXED of ${attribute}`);
      } else if (at('#')) {
        throw new Unsafe(`the ATTLIST has no default value for ${attribute}`);
      }
      const value = literal(`default of ${attribute}`);
      if (/[&<]/.test(value)) throw new Unsafe(`the default of ${attribute} is not purely literal`);
      defaults.push({ element, name: attribute, value });
    }
  }

  // The root start tag: every ATTLIST default must already be written there, with the same value.
  const rootAttributes = new Map<string, string>();
  let rootName: string | undefined;
  const rootStart = i;
  if (at('<') && !at('</')) {
    i += 1;
    rootName = readName();
    for (;;) {
      const spaced = space();
      if (at('>') || at('/>') || !spaced) break;
      const attribute = readName();
      if (attribute === undefined) break;
      space();
      if (!at('=')) break;
      i += 1;
      space();
      const quote = text.charAt(i);
      const end = quote === '"' || quote === "'" ? text.indexOf(quote, i + 1) : -1;
      if (end < 0) break;
      rootAttributes.set(attribute, text.slice(i + 1, end));
      i = end + 1;
    }
  }
  for (const d of defaults) {
    if (d.element !== rootName) throw new Unsafe(`the ATTLIST applies to ${d.element}, not to the root element`);
    const written = rootAttributes.get(d.name);
    if (written === undefined)
      throw new Unsafe(`the ATTLIST supplies ${d.name}, which the root element does not write`);
    if (written !== d.value) throw new Unsafe(`the ATTLIST default of ${d.name} differs from the root element`);
  }

  // From the root start tag on, so that its attribute values are checked too.
  i = rootStart;
  body(doctype !== undefined);
  if (!doctype) return { kind: 'none' };
  const blank = text.slice(doctype.start, doctype.end).replace(/[^\r\n]/g, ' ');
  return { kind: 'neutralized', text: text.slice(0, doctype.start) + blank + text.slice(doctype.end) };

  /**
   * The rest of the document: no further markup declaration, and, with a DOCTYPE, no entity of its own in text or
   * attribute values; comments, CDATA sections and processing instructions are skipped.
   */
  function body(entities: boolean): void {
    let quote = '';
    let inTag = false;
    while (i < text.length) {
      const c = text.charAt(i);
      if (quote) {
        if (c === quote) quote = '';
        else if (c === '&') {
          reference();
          continue;
        }
        i += 1;
      } else if (c === '<') {
        if (at('<!--')) {
          if (!skip('<!--', '-->')) return;
        } else if (at('<![CDATA[')) {
          if (!skip('<![CDATA[', ']]>')) return;
        } else if (at('<?')) {
          if (!skip('<?', '?>')) return;
        } else if (at('<!')) {
          throw new Unsafe('a markup declaration after the root element starts');
        } else {
          inTag = true;
          i += 1;
        }
      } else if (c === '&') {
        reference();
      } else {
        if (inTag && (c === '"' || c === "'")) quote = c;
        if (inTag && c === '>') inTag = false;
        i += 1;
      }
    }

    function reference(): void {
      REFERENCE.lastIndex = i;
      const match = REFERENCE.exec(text);
      if (entities && match?.[1] !== undefined && !PREDEFINED.has(match[1])) {
        throw new Unsafe(`the document uses the entity &${match[1]}; of its DOCTYPE`);
      }
      i = match ? REFERENCE.lastIndex : i + 1;
    }
  }
}
