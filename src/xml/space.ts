// XML white space is #x20, #x9, #xA and #xD only (XML 1.0, production S). Other Unicode spaces, such as U+00A0, are
// ordinary characters: whiteSpace="collapse" and list separation leave them alone, unlike String.trim() and \s.

const EDGES = /^[ \t\n\r]+|[ \t\n\r]+$/g;
const RUNS = /[ \t\n\r]+/;

/** The text without XML white space at either end. */
export function trimXmlSpace(text: string): string {
  return text.replace(EDGES, '');
}

/** The tokens of a text separated by XML white space; none for a text of white space only. */
export function splitXmlSpace(text: string): string[] {
  const trimmed = trimXmlSpace(text);
  return trimmed === '' ? [] : trimmed.split(RUNS);
}
