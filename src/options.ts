import type { GenerateOptions } from './index.js';
import { checkTextProperty } from './json/serialize.js';
import { effectiveLimits } from './xsd/schema-set.js';
function integer(name: string, value: number | undefined, min: number, max: number): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < min || value > max)) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
}
export function checkOptions(options: GenerateOptions): void {
  integer('seed', options.seed, 0, 0xffffffff - 100000);
  integer('repeat', options.repeat, 1, 10000);
  integer('maxDepth', options.maxDepth, 0, 128);
  integer('maxTotalDepth', options.maxTotalDepth, 1, 256);
  integer('maxNodes', options.maxNodes, 1, 100000);
  integer('attempts', options.attempts, 1, 100);
  effectiveLimits(options.limits);
  // Optional expansion must stop before the hard limit, or every recursive schema would end in depth-limit.
  if (options.maxDepth !== undefined && options.maxDepth >= (options.maxTotalDepth ?? 64)) {
    throw new RangeError('maxDepth must be lower than maxTotalDepth');
  }
  for (const name of ['optional', 'optionalElements', 'optionalAttributes'] as const) {
    const mode = options[name];
    if (mode !== undefined && !['none', 'all', 'random'].includes(mode)) {
      throw new TypeError(`${name} must be none, all or random`);
    }
  }
  if (options.nil !== undefined && options.nil !== 'never' && options.nil !== 'random') {
    throw new TypeError('nil must be never or random');
  }
  if (options.mode !== undefined && options.mode !== 'instance' && options.mode !== 'template') {
    throw new TypeError('mode must be instance or template');
  }
  if (options.choice === 'all' && options.mode !== 'template') {
    throw new TypeError("choice: 'all' requires mode: 'template'; use coverage for separate valid branch examples");
  }
  if ((options.fillElements === false || options.fillAttributes === false) && options.mode !== 'template') {
    throw new TypeError('empty values require template mode');
  }
  if (options.indent !== undefined && !/^[ \t]{0,8}$/.test(options.indent)) {
    throw new TypeError('indent must contain up to eight spaces or tabs');
  }
  if (options.json && options.json.mode !== undefined && !['compact', 'tree'].includes(options.json.mode)) {
    throw new TypeError('json.mode must be compact or tree');
  }
  if (options.json && options.json.textProperty !== undefined) {
    checkTextProperty(options.json.textProperty);
  }
  if (options.json && options.json.numbers !== undefined && !['number', 'string'].includes(options.json.numbers)) {
    throw new TypeError('json.numbers must be number or string');
  }
}
