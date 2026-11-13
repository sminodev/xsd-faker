// Dates counted from the reference date: a birth date lies one to ninety years back, a date that ends something
// within two years ahead, any other date within two years back. The format follows the type: ISO forms for the
// built-in date types and for a string without pattern, and for a string with a pattern the first common form the
// pattern accepts.

import type { Rng } from '../../rng.js';
import type { Facets } from '../../xsd/facets.js';
import { checkValue } from '../check.js';

export type DateWindow = 'birth' | 'past' | 'future';

const DAY = 86_400_000;
const YEAR = 365.2425 * DAY;

/** Forms tried for a string type, in this order. */
const STRING_FORMS = [
  'YYYYMMDD',
  'YYYY-MM-DD',
  'DD.MM.YYYY',
  'YYYYMMDDhhmmss',
  'YYYY-MM-DDThh:mm:ss',
  'YYYYMMDDhhmm',
  'YYYY-MM-DD hh:mm:ss',
  'YYYYMM',
  'YYYY',
];

const BUILTIN_FORMS: Readonly<Record<string, string>> = {
  date: 'YYYY-MM-DD',
  dateTime: 'YYYY-MM-DDThh:mm:ss',
  gYearMonth: 'YYYY-MM',
  gYear: 'YYYY',
};

function format(form: string, instant: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const parts: Record<string, string> = {
    YYYY: pad(instant.getUTCFullYear(), 4),
    MM: pad(instant.getUTCMonth() + 1),
    DD: pad(instant.getUTCDate()),
    hh: pad(instant.getUTCHours()),
    mm: pad(instant.getUTCMinutes()),
    ss: pad(instant.getUTCSeconds()),
  };
  return form.replace(/YYYY|MM|DD|hh|mm|ss/g, (part) => parts[part] ?? part);
}

/** A date in the window, written in a form the facets accept; undefined if none does. */
export function dateValue(window: DateWindow, reference: Date, facets: Facets, rng: Rng): string | undefined {
  const start = reference.getTime();
  const [from, to] =
    window === 'birth'
      ? [start - 90 * YEAR, start - YEAR]
      : window === 'future'
        ? [start + DAY, start + 2 * YEAR]
        : [start - 2 * YEAR, start];
  const day = Math.floor(from / DAY) + rng.int(0, Math.floor((to - from) / DAY));
  const instant = new Date(day * DAY + rng.int(7, 18) * 3_600_000 + rng.int(0, 59) * 60_000 + rng.int(0, 59) * 1000);
  const builtin = Object.hasOwn(BUILTIN_FORMS, facets.builtin) ? BUILTIN_FORMS[facets.builtin] : undefined;
  // A string without a pattern takes the ISO form; with one, the first form the pattern accepts.
  const forms = builtin !== undefined ? [builtin] : facets.patterns.length === 0 ? ['YYYY-MM-DD'] : STRING_FORMS;
  for (const form of forms) {
    const value = format(form, instant);
    if (checkValue(facets, value) === undefined) return value;
  }
  return undefined;
}
