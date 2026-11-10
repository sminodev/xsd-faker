// The lexical forms of the built-in types (XML Schema Part 2, 3.2), written as XML Schema patterns.

import { INTEGERS } from '../xsd/facets.js';
import { combinePatterns, translateBody } from '../xsd/xsd-regex.js';

const TZ = '(Z|(\\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))?';
// Four digits or more, without leading zeros beyond four digits; XML Schema 1.0 has no year 0000.
const YEAR = '-?([1-9][0-9]{3,}|0[0-9]{2}[1-9]|0[0-9][1-9][0-9]|0[1-9][0-9]{2})';
// Years divisible by 4, except centuries that are not divisible by 400.
const LEAP_YEAR =
  '-?([1-9][0-9]*([0-9]{2}(0[48]|[2468][048]|[13579][26])|([02468][048]|[13579][26])00)' +
  '|[0-9]{2}(0[48]|[2468][048]|[13579][26])|(0[48]|[2468][048]|[13579][26])00)';
const MONTH = '(0[1-9]|1[0-2])';
const DAY = '(0[1-9]|[12][0-9]|3[01])';
// The days each month has, apart from 29 February.
const MONTH_DAY =
  '((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|1[0-9]|2[0-8]))';
const DATE = `(${YEAR}-${MONTH_DAY}|${LEAP_YEAR}-02-29)`;
const TIME = '(([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?|(24:00:00(\\.0+)?))';
const SECONDS = '([0-9]+(\\.[0-9]*)?|\\.[0-9]+)S';
const DURATION_TIME = `T([0-9]+H([0-9]+M)?(${SECONDS})?|[0-9]+M(${SECONDS})?|${SECONDS})`;
const DURATION =
  `-?P([0-9]+Y([0-9]+M)?([0-9]+D)?(${DURATION_TIME})?|[0-9]+M([0-9]+D)?(${DURATION_TIME})?` +
  `|[0-9]+D(${DURATION_TIME})?|${DURATION_TIME})`;
const NCNAME = '[\\i-[:]][\\c-[:]]*';
const DECIMAL = '[+\\-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)';
const INTEGER = '[+\\-]?[0-9]+';

export const LEXICAL: Readonly<Record<string, string>> = {
  date: `${DATE}${TZ}`,
  dateTime: `${DATE}T${TIME}${TZ}`,
  time: `${TIME}${TZ}`,
  duration: DURATION,
  gYear: `${YEAR}${TZ}`,
  gYearMonth: `${YEAR}-${MONTH}${TZ}`,
  gMonth: `--${MONTH}${TZ}`,
  gMonthDay: `--(${MONTH_DAY}|02-29)${TZ}`,
  gDay: `---${DAY}${TZ}`,
  language: '[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*',
  Name: '\\i\\c*',
  NCName: NCNAME,
  ID: NCNAME,
  IDREF: NCNAME,
  ENTITY: NCNAME,
  NMTOKEN: '\\c+',
  NMTOKENS: '\\c+( \\c+)*',
  IDREFS: `${NCNAME}( ${NCNAME})*`,
  ENTITIES: `${NCNAME}( ${NCNAME})*`,
  hexBinary: '([0-9a-fA-F]{2})*',
  base64Binary: '([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?',
  QName: `(${NCNAME}:)?${NCNAME}`,
  boolean: 'true|false|1|0',
  decimal: DECIMAL,
  float: `${DECIMAL}([eE]${INTEGER})?|-?INF|NaN`,
  double: `${DECIMAL}([eE]${INTEGER})?|-?INF|NaN`,
  integer: INTEGER,
};

const cache = new Map<string, RegExp>();

/** The regular expression of a built-in type's lexical form; undefined if any text is allowed. */
export function lexicalRegExp(builtin: string): RegExp | undefined {
  const source = LEXICAL[builtin] ?? (INTEGERS[builtin] !== undefined ? LEXICAL['integer'] : undefined);
  if (source === undefined) {
    return undefined;
  }
  let regex = cache.get(builtin);
  if (regex === undefined) {
    regex = new RegExp(combinePatterns([[translateBody(source)]]), 'u');
    cache.set(builtin, regex);
  }
  return regex;
}
