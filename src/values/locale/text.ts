// Free text in the words of a locale, for strings without pattern or enumeration that no other field matches. Up to
// 40 characters it is a word group without a period, longer it is sentences. A phrase or sentences of the locale are
// taken as they are where they fit the length facets; otherwise words are put together to an exact length, with the
// last word chosen to fill what is left. Words are separated by one space, with none at either end, so the value
// keeps its length under every whiteSpace rule. Lengths count characters, as the length facets do.

import type { TextData } from 'xsd-faker-locales';
import type { Rng } from '../../rng.js';
import type { Facets } from '../../xsd/facets.js';

/** Up to this length, free text is a word group; beyond, sentences. */
const GROUP_LENGTH = 40;
/** Free text without an upper bound stays this long at most. */
const OPEN_LENGTH = 60;
/** A long upper bound is not used up; text this long reads like a remark. */
const LONG_LENGTH = 160;

const length = (text: string): number => [...text].length;

/** The words of the locale by their length, in their order. */
const buckets = new WeakMap<TextData, Map<number, string[]>>();
function byLength(text: TextData): Map<number, string[]> {
  let found = buckets.get(text);
  if (!found) {
    found = new Map();
    for (const word of text.words) {
      const n = length(word);
      found.set(n, [...(found.get(n) ?? []), word]);
    }
    buckets.set(text, found);
  }
  return found;
}

/** Words joined by single spaces to exactly `target` characters, or undefined if the words cannot make it. */
function wordsOfLength(text: TextData, target: number, rng: Rng): string | undefined {
  const lengths = byLength(text);
  // reachable[x]: x characters can be written as words with single spaces between them.
  const reachable: boolean[] = [false];
  for (let x = 1; x <= target; x += 1) {
    reachable[x] = lengths.has(x) || [...lengths.keys()].some((n) => x - n - 1 >= 1 && reachable[x - n - 1] === true);
  }
  if (!reachable[target]) return undefined;
  const parts: string[] = [];
  let left = target;
  while (left > 0) {
    const candidates = [...lengths.entries()]
      .filter(([n]) => n === left || (left - n - 1 >= 1 && reachable[left - n - 1] === true))
      .flatMap(([, w]) => w);
    const word = rng.pick(candidates);
    parts.push(word);
    const used = length(word);
    left = used === left ? 0 : left - used - 1;
  }
  return parts.join(' ');
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Free text that meets the length facets, or undefined. */
export function freeText(text: TextData, facets: Facets, rng: Rng): string | undefined {
  const min = facets.length ?? facets.minLength ?? (facets.maxLength === 0 ? 0 : 1);
  const max = facets.length ?? facets.maxLength ?? Math.max(min, OPEN_LENGTH);
  if (max === 0) return min === 0 ? '' : undefined;
  if (min > max) return undefined;
  const top = Math.min(max, Math.max(min, LONG_LENGTH));
  const fits = (value: string) => length(value) >= min && length(value) <= top;
  if (top > GROUP_LENGTH) {
    // Sentences in a seeded order, as many as fit.
    const order = [...text.sentences];
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = rng.int(0, i);
      [order[i], order[j]] = [order[j] ?? '', order[i] ?? ''];
    }
    let joined = '';
    for (const sentence of order) {
      const next = joined === '' ? sentence : `${joined} ${sentence}`;
      if (length(next) > top) continue;
      joined = next;
      if (length(joined) >= min && rng.chance(0.5)) break;
    }
    if (joined !== '' && fits(joined)) return joined;
  }
  // Where no sentence fits, a phrase or a word of the locale does, before words are put together. Anything longer
  // than a word group is a sentence.
  const group = (value: string) => fits(value) && length(value) <= GROUP_LENGTH;
  const phrases = text.phrases.filter(group);
  if (phrases.length > 0) return capitalized(rng.pick(phrases));
  const words = text.words.filter(group);
  if (words.length > 0) return capitalized(rng.pick(words));
  if (min <= GROUP_LENGTH) {
    const joined = wordsOfLength(text, rng.int(min, Math.min(top, GROUP_LENGTH)), rng);
    return joined === undefined ? undefined : capitalized(joined);
  }
  const target = rng.int(min, top);
  const body = wordsOfLength(text, target - 1, rng);
  return body === undefined ? undefined : `${capitalized(body)}.`;
}
