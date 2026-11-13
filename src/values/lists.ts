// Values the caller lists, by path or by type name. A key that starts with `/` is a path of local names, with `@name`
// for an attribute; `{namespace}local` is a type name with its namespace, and any other key a local type name. A value
// is found under its path first, then under its own type, then under the types that type derives from, nearest first.

import { checkValue } from './check.js';
import type { ValueContext, ValueSource } from './source.js';

export type ValueLists = Readonly<Record<string, string | readonly string[]>>;

/** The keys a value can be listed under, in the order they are tried. */
export function listKeys(context: Pick<ValueContext, 'path' | 'kind' | 'typeName' | 'baseTypeNames'>): string[] {
  const parts = [...context.path];
  if (context.kind === 'attribute') parts[parts.length - 1] = `@${parts.at(-1) ?? ''}`;
  const keys = [`/${parts.join('/')}`];
  for (const type of [context.typeName, ...(context.baseTypeNames ?? [])]) {
    if (type === undefined) continue;
    keys.push(type, type.slice(type.indexOf('}') + 1));
  }
  return keys;
}

/**
 * Values sampled with the run's seeded RNG from the first key that has one meeting the facets. A list whose values
 * all fail the facets passes the question on to the next key.
 */
export function valueLists(lists: ValueLists): ValueSource {
  return {
    value(context) {
      for (const key of listKeys(context)) {
        const configured = Object.hasOwn(lists, key) ? lists[key] : undefined;
        if (configured === undefined) continue;
        const values = (typeof configured === 'string' ? [configured] : configured).filter(
          (value) => checkValue(context.facets, value) === undefined,
        );
        if (values.length > 0) return context.rng.pick(values);
      }
      return undefined;
    },
  };
}

/** Whether the lists name a value for this place, so that it counts as supplied by the caller. */
export function listed(lists: ValueLists, context: Parameters<typeof listKeys>[0]): boolean {
  return listKeys(context).some((key) => Object.hasOwn(lists, key));
}
