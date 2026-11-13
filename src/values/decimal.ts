import { trimXmlSpace } from '../xml/space.js';

/** Exact decimal arithmetic for facet bounds; bounded to 1000 digits of work. */
export function decimalParts(value: string): { units: bigint; scale: number } | undefined {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(trimXmlSpace(value));
  if (!match || (!match[2] && !match[3])) return undefined;
  const digits = `${match[2] ?? ''}${match[3] ?? ''}`;
  const scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
  if (digits.length > 1000 || !Number.isSafeInteger(scale) || Math.abs(scale) > 1000) return undefined;
  return { units: BigInt(`${match[1] === '-' ? '-' : ''}${digits}`), scale };
}

export function compareDecimal(a: string, b: string): number | undefined {
  const left = decimalParts(a),
    right = decimalParts(b);
  if (!left || !right) return undefined;
  const scale = Math.max(left.scale, right.scale);
  const delta = left.units * 10n ** BigInt(scale - left.scale) - right.units * 10n ** BigInt(scale - right.scale);
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

/** Rounds a bound inward to whole units at the chosen output scale. */
export function boundUnits(value: string, scale: number, lower: boolean, exclusive: boolean): bigint | undefined {
  const parts = decimalParts(value);
  if (!parts) return undefined;
  const shift = scale - parts.scale;
  const divisor = shift < 0 ? 10n ** BigInt(-shift) : 1n;
  const units = shift >= 0 ? parts.units * 10n ** BigInt(shift) : parts.units;
  const remainder = units % divisor;
  let result = units / divisor;
  if (lower && remainder > 0n) result += 1n;
  if (!lower && remainder < 0n) result -= 1n;
  if (exclusive && remainder === 0n) result += lower ? 1n : -1n;
  return result;
}
