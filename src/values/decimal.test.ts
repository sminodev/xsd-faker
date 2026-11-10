import { expect, it } from 'vitest';
import { boundUnits, compareDecimal } from './decimal.js';
import { checkValue } from './check.js';

it('compares bounds beyond Number precision without rounding their lexical form', () => {
  expect(compareDecimal('9223372036854775806', '9223372036854775807')).toBe(-1);
  expect(compareDecimal('1.2300', '123e-2')).toBe(0);
  expect(
    checkValue(
      {
        builtin: 'long',
        variety: 'atomic',
        patterns: [],
        min: { value: 9223372036854775807, lexical: '9223372036854775807', exclusive: false },
      },
      '9223372036854775806',
    ),
  ).toContain('below');
});
it('rounds exclusive and fractional negative bounds inward', () => {
  expect(boundUnits('-1.21', 1, true, false)).toBe(-12n);
  expect(boundUnits('-1.21', 1, false, false)).toBe(-13n);
  expect(boundUnits('-1.2', 1, true, true)).toBe(-11n);
  expect(boundUnits('-1.2', 1, false, true)).toBe(-13n);
  expect(boundUnits('1e999999', 0, true, false)).toBeUndefined();
});
