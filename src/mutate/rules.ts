// The rules an invalid sample breaks, one per file. The same list names what a mutation aims at and what the
// classifier reads from a validator message; its order is the order of the invalid samples.

export const RULES = [
  'facet:length',
  'facet:minLength',
  'facet:maxLength',
  'facet:pattern',
  'facet:enumeration',
  'facet:minInclusive',
  'facet:maxInclusive',
  'facet:minExclusive',
  'facet:maxExclusive',
  'facet:totalDigits',
  'facet:fractionDigits',
  'value:lexical',
  'value:fixed',
  'structure:missing-element',
  'structure:too-many',
  'structure:order',
  'structure:unknown-element',
  'structure:second-branch',
  'structure:missing-attribute',
  'structure:unknown-attribute',
  'structure:nil-not-nillable',
  'structure:nil-with-content',
  'structure:nil-with-fixed',
  'structure:foreign-xsi-type',
  'identity:duplicate-id',
  'identity:dangling-idref',
] as const;

export type Rule = (typeof RULES)[number];
/** The rules a single value breaks. */
export type ValueRule = Extract<Rule, `facet:${string}` | `value:${string}`>;
export type IdentityRule = Extract<Rule, `identity:${string}`>;
export type NilRule = Extract<Rule, `structure:nil-${string}`>;

export const isValueRule = (rule: string): rule is ValueRule => rule.startsWith('facet:') || rule.startsWith('value:');
