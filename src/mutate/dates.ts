// The order of date and time values, as XML Schema 1.0 compares them for bounds and equal values: a value with a
// time zone is an instant; one without stands for any instant within 14 hours of its local reading, so it compares
// with an instant only where that whole span lies on one side. Types without a total order here, such as duration
// and gMonth, give no moment.

import type { Rng } from '../rng.js';

/** The types whose values have a moment here. */
export const ORDERED_DATES: ReadonlySet<string> = new Set(['date', 'dateTime', 'time', 'gYear', 'gYearMonth']);

/** A value on the time line: the instant in milliseconds, or the local reading as if it were UTC. */
export interface Moment {
  ms: number;
  zoned: boolean;
}

const ZONE = '(Z|[+-]\\d{2}:\\d{2})?';
const YEAR = '(-?\\d{4,})';
const FORMS: Readonly<Record<string, RegExp>> = {
  date: new RegExp(`^${YEAR}-(\\d{2})-(\\d{2})${ZONE}$`),
  dateTime: new RegExp(`^${YEAR}-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2}(?:\\.\\d+)?)${ZONE}$`),
  time: new RegExp(`^(\\d{2}):(\\d{2}):(\\d{2}(?:\\.\\d+)?)${ZONE}$`),
  gYear: new RegExp(`^${YEAR}${ZONE}$`),
  gYearMonth: new RegExp(`^${YEAR}-(\\d{2})${ZONE}$`),
};
const FOURTEEN_HOURS = 14 * 3600 * 1000;
/** The day `time` values are read on. */
const REFERENCE = { year: 1972, month: 12, day: 31 };

/** The moment of a value of an ordered type, or undefined for a value it cannot read. */
export function momentOf(builtin: string, lexical: string): Moment | undefined {
  const form = FORMS[builtin];
  const m = form?.exec(lexical.trim());
  if (!m) return undefined;
  const n = (i: number) => Number(m[i]);
  let parts: { year: number; month: number; day: number; hour: number; minute: number; second: number };
  let zone: string | undefined;
  switch (builtin) {
    case 'date':
      parts = { year: n(1), month: n(2), day: n(3), hour: 0, minute: 0, second: 0 };
      zone = m[4];
      break;
    case 'dateTime':
      parts = { year: n(1), month: n(2), day: n(3), hour: n(4), minute: n(5), second: n(6) };
      zone = m[7];
      break;
    case 'time':
      parts = { ...REFERENCE, hour: n(1), minute: n(2), second: n(3) };
      zone = m[4];
      break;
    case 'gYear':
      parts = { year: n(1), month: 1, day: 1, hour: 0, minute: 0, second: 0 };
      zone = m[2];
      break;
    default:
      parts = { year: n(1), month: n(2), day: 1, hour: 0, minute: 0, second: 0 };
      zone = m[3];
  }
  const ms = instant(parts);
  if (ms === undefined) return undefined;
  if (zone === undefined) return { ms, zoned: false };
  if (zone === 'Z') return { ms, zoned: true };
  const sign = zone.startsWith('-') ? -1 : 1;
  const [hours, minutes] = zone.slice(1).split(':').map(Number) as [number, number];
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes > 0)) return undefined;
  return { ms: ms - sign * (hours * 60 + minutes) * 60000, zoned: true };
}

function instant(p: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): number | undefined {
  // XML Schema 1.0 has no year 0: -0001 is the year before 0001.
  if (p.year === 0 || Math.abs(p.year) > 200000) return undefined;
  if (p.month < 1 || p.month > 12 || p.minute > 59 || p.second >= 60) return undefined;
  if (p.hour > 24 || (p.hour === 24 && (p.minute !== 0 || p.second !== 0))) return undefined;
  const year = p.year < 0 ? p.year + 1 : p.year;
  const days = new Date(0);
  days.setUTCFullYear(year, p.month, 0);
  if (p.day < 1 || p.day > days.getUTCDate()) return undefined;
  const d = new Date(0);
  d.setUTCFullYear(year, p.month - 1, p.day);
  d.setUTCHours(p.hour, p.minute, 0, 0);
  return d.getTime() + p.second * 1000;
}

/** -1, 0 or 1, or undefined where XML Schema leaves the order of the two values open. */
export function compareMoments(a: Moment, b: Moment): number | undefined {
  if (a.zoned === b.zoned) return Math.sign(a.ms - b.ms);
  const [zoned, local, flip] = a.zoned ? [a, b, 1] : [b, a, -1];
  if (zoned.ms < local.ms - FOURTEEN_HOURS) return -flip;
  if (zoned.ms > local.ms + FOURTEEN_HOURS) return flip;
  return undefined;
}

/** The value of a moment in the lexical form of the type, with `Z` for a moment with a time zone. */
export function formatMoment(builtin: string, moment: Moment): string | undefined {
  const d = new Date(moment.ms);
  if (Number.isNaN(d.getTime())) return undefined;
  const pad = (x: number, width = 2) => String(x).padStart(width, '0');
  const jsYear = d.getUTCFullYear();
  const year = jsYear <= 0 ? jsYear - 1 : jsYear;
  const yyyy = `${year < 0 ? '-' : ''}${pad(Math.abs(year), 4)}`;
  const date = `${yyyy}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const zone = moment.zoned ? 'Z' : '';
  switch (builtin) {
    case 'date':
      return `${date}${zone}`;
    case 'dateTime':
      return `${date}T${time}${zone}`;
    case 'time':
      return `${time}${zone}`;
    case 'gYear':
      return `${yyyy}${zone}`;
    case 'gYearMonth':
      return `${yyyy}-${pad(d.getUTCMonth() + 1)}${zone}`;
    default:
      return undefined;
  }
}

const DAY = 24 * 3600 * 1000;
/** The step between two values of a type, about: a year, a month, a day or a second. */
const STEP: Readonly<Record<string, number>> = {
  gYear: 366 * DAY,
  gYearMonth: 31 * DAY,
  date: DAY,
  dateTime: 1000,
  time: 1000,
};

/**
 * A moment beyond a bound, on the side `direction` (-1 below, 1 above), `steps` steps of the type away; 0 steps is
 * the bound itself. The result can still fall on the bound for a coarse type; the caller checks it.
 */
export function momentBeside(builtin: string, bound: Moment, direction: -1 | 1, steps: number): Moment {
  return { ms: bound.ms + direction * steps * (STEP[builtin] ?? DAY), zoned: bound.zoned };
}

/** A moment between two moments of the same kind, or near one of them where the other is missing. */
export function momentBetween(builtin: string, low: Moment | undefined, high: Moment | undefined, rng: Rng): Moment {
  const step = STEP[builtin] ?? DAY;
  const span = 3650 * DAY;
  const from = low?.ms ?? (high ? high.ms - span : Date.UTC(1990, 0, 1));
  const to = high?.ms ?? from + span;
  const zoned = low?.zoned ?? high?.zoned ?? false;
  const steps = Math.max(0, Math.floor((to - from) / step));
  return { ms: from + rng.int(0, Math.min(steps, 2 ** 31)) * step, zoned };
}
