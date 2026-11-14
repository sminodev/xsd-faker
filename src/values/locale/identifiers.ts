// Identifiers of the German health system with a check digit. Each check digit follows the published procedure:
//
// - KVNR, the unchangeable part of the health insurance number: a letter, eight digits, a check digit. The letter
//   becomes two digits (A = 01 … Z = 26); the ten digits are weighted 1, 2, 1, 2, … from the left, products above 9
//   count with their digit sum, and the sum modulo 10 is the check digit. Digits 2 to 9 never repeat one digit more
//   than three times in a row and never contain 666. (Richtlinie nach § 290 SGB V, Stand 21.10.2025.)
// - IK, the institution code: nine digits, the ninth a check digit over digits 3 to 8, weighted 1, 2, 1, 2, … from
//   the right, products as digit sums, sum modulo 10. (Gemeinsames Rundschreiben Institutionskennzeichen, 1.2.5.)
// - LANR, the lifelong physician number: six digits, a check digit, a two-digit specialty code. Digits 1 to 6 are
//   weighted 4, 9, 4, 9, … from the left; the check digit is 10 minus the sum modulo 10, and 0 instead of 10.
//   (Vereinbarung ANRV nach § 293 SGB V, § 4.)
// - PZN, the pharmaceutical number: seven digits weighted 1 to 7, the sum modulo 11 is the check digit; a sum
//   leaving 10 is never issued. (IFA, Technische Hinweise zur PZN-Codierung.)
//
// KVNR and IK generation prefers ranges that are not issued to real people or institutions:
//
// - KVNR: the numbers the allocation rule excludes, with a digit four times in a row or 666 among digits 2 to 9.
//   Test cards of the electronic health card use such numbers as X0000nnnnP, so that prefix is left out.
// - IK: the classification 97 to 99 (the first two digits), reserved for internal use and never issued. Where the
//   schema demands another prefix, the IK 109500969, which exists for tests of the statutory health insurance and
//   belongs to no real payer, if it fits.
//
// LANR and PZN have no such range: their values have a valid check digit in the issued range and may match a real
// number. So may a KVNR or an IK whose schema allows nothing from these ranges.

import { createRng, type Rng } from '../../rng.js';

export type IdentifierKind = 'kvnr' | 'ik' | 'lanr' | 'pzn';

const digitSum = (n: number): number => (n > 9 ? Math.floor(n / 10) + (n % 10) : n);
const digits = (text: string): number[] => [...text].map(Number);

/** The check digit of a KVNR from its letter and eight digits. */
export function kvnrCheckDigit(body: string): number {
  const letter = String(body.charCodeAt(0) - 64).padStart(2, '0');
  const sum = digits(letter + body.slice(1, 9)).reduce((s, d, i) => s + digitSum(d * (i % 2 === 0 ? 1 : 2)), 0);
  return sum % 10;
}

/** The check digit of an IK from its first eight digits. */
export function ikCheckDigit(body: string): number {
  const used = digits(body.slice(2, 8)).reverse();
  return used.reduce((s, d, i) => s + digitSum(d * (i % 2 === 0 ? 1 : 2)), 0) % 10;
}

/** The check digit of a LANR from its first six digits. */
export function lanrCheckDigit(body: string): number {
  const sum = digits(body.slice(0, 6)).reduce((s, d, i) => s + d * (i % 2 === 0 ? 4 : 9), 0);
  return (10 - (sum % 10)) % 10;
}

/** The check digit of a PZN from its first seven digits; undefined for digits that are never issued. */
export function pznCheckDigit(body: string): number | undefined {
  const remainder = digits(body.slice(0, 7)).reduce((s, d, i) => s + d * (i + 1), 0) % 11;
  return remainder === 10 ? undefined : remainder;
}

interface Identifier {
  /** the form of a complete identifier */
  shape: RegExp;
  /** a draft in that form with any digit where the check digit goes */
  draft: (rng: Rng) => string;
  /** the draft with its check digit, or undefined if no identifier can be made from it */
  complete: (draft: string) => string | undefined;
}

const digitsOf = (rng: Rng, count: number): string => Array.from({ length: count }, () => rng.int(0, 9)).join('');

const IDENTIFIERS: Record<IdentifierKind, Identifier> = {
  kvnr: {
    shape: /^[A-Z][0-9]{9}$/,
    draft: (rng) => String.fromCharCode(65 + rng.int(0, 25)) + digitsOf(rng, 9),
    complete: (draft) => {
      const number = draft.slice(1, 9);
      if (/(\d)\1\1\1/.test(number) || number.includes('666')) return undefined;
      return draft.slice(0, 9) + String(kvnrCheckDigit(draft));
    },
  },
  ik: {
    shape: /^[0-9]{9}$/,
    draft: (rng) => digitsOf(rng, 9),
    complete: (draft) => draft.slice(0, 8) + String(ikCheckDigit(draft)),
  },
  lanr: {
    shape: /^[0-9]{9}$/,
    draft: (rng) => `${digitsOf(rng, 7)}00`,
    complete: (draft) => draft.slice(0, 6) + String(lanrCheckDigit(draft)) + draft.slice(7),
  },
  pzn: {
    shape: /^[0-9]{8}$/,
    draft: (rng) => digitsOf(rng, 8),
    complete: (draft) => {
      const check = pznCheckDigit(draft);
      return check === undefined ? undefined : draft.slice(0, 7) + String(check);
    },
  },
};

/** A range of identifiers that is never issued. */
interface TestRange {
  /** an identifier of the range, built on the schema's draft where there is one, or undefined for this attempt */
  draft: (rng: Rng, schemaDraft: string | undefined) => string | undefined;
  /** identifiers to try once no draft of the range fits */
  fallback: readonly string[];
}

const TEST_RANGES: Partial<Record<IdentifierKind, TestRange>> = {
  kvnr: {
    draft: (rng, schemaDraft) => {
      const base =
        schemaDraft !== undefined && IDENTIFIERS.kvnr.shape.test(schemaDraft)
          ? schemaDraft
          : String.fromCharCode(65 + rng.int(0, 25)) + digitsOf(rng, 9);
      const number = [...base.slice(1, 9)];
      // A run of one digit of the draft fits a pattern that narrows the digits; 666 may not.
      if (rng.chance(base === schemaDraft ? 0.8 : 0.5)) {
        const start = rng.int(0, 4);
        // A digit the draft has at these places, so that a pattern such as [1-5]{8} still matches the run.
        const digit = number[start + rng.int(0, 3)] ?? '0';
        number.fill(digit, start, start + 4);
      } else {
        const start = rng.int(0, 5);
        number.fill('6', start, start + 3);
      }
      const body = (base[0] ?? 'A') + number.join('');
      return body.startsWith('X0000') ? undefined : body + String(kvnrCheckDigit(body));
    },
    fallback: [],
  },
  ik: {
    draft: (rng) => {
      const body = `9${rng.int(7, 9)}${digitsOf(rng, 6)}`;
      return body + String(ikCheckDigit(body));
    },
    fallback: ['109500969'],
  },
};

/** Maximum candidate attempts per range. */
const DRAFTS = 20;

/**
 * An identifier with a valid check digit: from the identifier's test range where one exists and a value of it fits
 * the facets, otherwise from the issued range. A draft from the issued range comes from the schema's own pattern
 * where that pattern yields the identifier's form, so a fixed prefix or specialty code stays; otherwise from the
 * usual form.
 */
export function identifier(
  kind: IdentifierKind,
  rng: Rng,
  fromFacets: () => string | undefined,
  fits: (value: string) => boolean = () => true,
): string | undefined {
  const { shape, draft, complete } = IDENTIFIERS[kind];
  const sub = createRng(rng.int(0, 0x7fffffff));
  // Draw the initial candidate before choosing a range to keep RNG consumption stable when a test value fits.
  // Only retries in the issued range consume additional draws.
  const first = fromFacets();
  const test = TEST_RANGES[kind];
  if (test) {
    for (let attempt = 0; attempt < DRAFTS; attempt += 1) {
      const value = test.draft(sub, attempt % 2 === 0 ? first : undefined);
      if (value !== undefined && fits(value)) return value;
    }
    const fallback = test.fallback.find(fits);
    if (fallback !== undefined) return fallback;
  }
  for (let attempt = 0; attempt < DRAFTS; attempt += 1) {
    const schemaDraft = attempt === 0 ? first : attempt % 2 === 0 ? fromFacets() : undefined;
    const candidate = schemaDraft !== undefined && shape.test(schemaDraft) ? schemaDraft : draft(sub);
    const value = complete(candidate);
    if (value !== undefined) return value;
  }
  return undefined;
}
