import { de, defineLocale, en } from 'xsd-faker-locales';
import { describe, expect, it } from 'vitest';
import { createRng } from '../../rng.js';
import type { Facets } from '../../xsd/facets.js';
import type { ValueContext, ValueScope } from '../source.js';
import { localeValues, resolveLocale } from './index.js';
import { drawAddress, drawPerson, fill, forGender, formsFor } from './records.js';

const text = (extra: Partial<Facets> = {}): Facets => ({
  builtin: 'string',
  variety: 'atomic',
  patterns: [],
  ...extra,
});
const scope = (instanceId: number, name = 'Person'): ValueScope => ({
  name,
  path: ['R', name],
  instanceId,
  state: new Map(),
});

function asker(locale = de, options = {}) {
  const source = localeValues(locale, options);
  const rng = createRng(7);
  return (name: string, scopes: ValueScope[], facets = text({ maxLength: 60 }), extra: Partial<ValueContext> = {}) =>
    source.value({
      facets,
      name,
      path: ['R', 'Person', name],
      kind: 'element',
      rng,
      scopes,
      baseTypeNames: [],
      ...extra,
    });
}

describe('localeValues', () => {
  it('takes all name fields of one element from one person, and a new person for the next occurrence', () => {
    const ask = asker();
    const first = scope(1);
    const email = ask('E_Mail', [first]) ?? '';
    const given = ask('Vorname', [first]) ?? '';
    const family = ask('Nachname', [first]) ?? '';
    expect(
      email.startsWith(
        `${given.toLowerCase().replace(/ü/g, 'ue').replace(/ö/g, 'oe').replace(/ä/g, 'ae').replace(/ß/g, 'ss')}.`,
      ),
    ).toBe(true);
    expect(ask('Nachname', [first])).not.toBe(family);
    const people = new Set(Array.from({ length: 20 }, (_, i) => ask('Nachname', [scope(i + 2)])));
    expect(people.size).toBeGreaterThan(5);
  });

  it('takes city, postcode and state from one place', () => {
    const ask = asker();
    for (let i = 1; i <= 30; i += 1) {
      const at = [scope(i, 'Anschrift')];
      const city = ask('Ort', at);
      const postcode = ask('Postleitzahl', at);
      const state = ask('Bundesland', at);
      const place = de.address.places.find((p) => p.city === city);
      expect(place?.postcodes).toContain(postcode);
      expect(de.address.states.find((s) => s.code === place?.state)?.name).toBe(state);
    }
  });

  it('falls back for one field only when the value of the record does not fit', () => {
    const ask = asker();
    const at = [scope(1)];
    const short = ask('Nachname', at, text({ maxLength: 4 })) ?? '';
    expect([...short].length).toBeLessThanOrEqual(4);
    expect(de.person.lastName).toContain(short);
    expect(ask('Nachname', at, text({ maxLength: 60 }))).not.toBe(short);
  });

  it("gives a name suffix and a salutation of the person's gender, neutral forms to everyone", () => {
    const ask = asker();
    const suffix = de.person.nameSuffix;
    for (let i = 1; i <= 80; i += 1) {
      const at = [scope(i)];
      const gender = ask('Geschlecht', at, text({ enumeration: ['w', 'm', 'd', 'x'] }));
      const name = ask('Namenszusatz', at, text({ maxLength: 20 })) ?? '';
      const salutation = ask('Anrede', at, text({ maxLength: 20 })) ?? '';
      if (gender === 'w') expect([...suffix.female, ...suffix.neutral]).toContain(name);
      if (gender === 'm') expect([...suffix.male, ...suffix.neutral]).toContain(name);
      if (gender === 'w') expect(de.person.salutation.female).toContain(salutation);
      if (gender === 'm') expect(de.person.salutation.male).toContain(salutation);
    }
    const english = asker(en);
    for (let i = 1; i <= 40; i += 1) {
      const at = [scope(i)];
      const gender = english('gender', at, text({ enumeration: ['F', 'M', 'X'] }));
      if (gender === 'F') expect(en.person.nameSuffix.neutral).toContain(english('nameSuffix', at));
    }
  });

  it('writes the gender as the enumeration spells it', () => {
    const ask = asker();
    const codes = new Set(
      Array.from({ length: 40 }, (_, i) =>
        ask('Geschlecht', [scope(i + 1)], text({ enumeration: ['w', 'm', 'd', 'x'] })),
      ),
    );
    expect([...codes].every((c) => ['w', 'm', 'd', 'x'].includes(c ?? ''))).toBe(true);
    expect(codes.has('w') && codes.has('m')).toBe(true);
    const english = asker(en)('gender', [scope(1)], text({ enumeration: ['F', 'M', 'U'] }));
    expect(['F', 'M', 'U']).toContain(english);
  });

  it('lets fields name the field of a path or type, or leave it to the facets', () => {
    const ask = asker(de, { fields: { '/R/Person/Kennung': 'id.kvnr', Note_Type: null } });
    expect(ask('Kennung', [scope(1)], text({ patterns: [['[A-Z][0-9]{9}']] }))).toMatch(/^[A-Z][0-9]{9}$/);
    const left = ask('Bemerkung', [scope(1)], text({ maxLength: 20 }), { typeName: '{urn:t}Note_Type' }) ?? '';
    expect(left).not.toMatch(/ /);
    expect(() => localeValues(de, { fields: { x: 'person.nickname' as 'text' } })).toThrow(TypeError);
  });

  it('works without any element around the value', () => {
    expect(de.person.firstName.female.concat(de.person.firstName.male)).toContain(asker()('Vorname', []));
  });

  it('resolves tags along their subtags and keeps a defined locale', () => {
    expect(resolveLocale('de-CH')).toBe(de);
    expect(resolveLocale('EN-us')).toBe(en);
    const own = defineLocale('fr', { extends: en, person: { lastName: ['Martin'] } });
    expect(resolveLocale(own)).toBe(own);
    expect(() => resolveLocale('fr')).toThrow('unknown locale fr; built in are de and en');
  });
});

describe('localeValues: nesting, repetition and empty lists', () => {
  const person = (id: number, name = 'Person'): ValueScope[] => [scope(1000 + id, 'Liste'), scope(id, name)];
  const female = new Set(de.person.firstName.female);
  const male = new Set(de.person.firstName.male);
  const gender = text({ enumeration: ['w', 'm', 'd', 'x'] });

  it("shares a record with the parent of the element that holds it, not with the parent's other children", () => {
    const ask = asker();
    for (let i = 1; i <= 60; i += 1) {
      const outer = person(i);
      const inner = [...outer, scope(500 + i, 'Name')];
      const first = ask('Vorname', inner) ?? '';
      const code = ask('Geschlecht', outer, gender);
      if (code === 'w') expect(female.has(first), first).toBe(true);
      if (code === 'm') expect(male.has(first), first).toBe(true);
      // The salutation, asked first in the parent, serves the name inside.
      const before = person(100 + i);
      const salutation = ask('Anrede', before);
      const given = ask('Vorname', [...before, scope(700 + i, 'Name')]) ?? '';
      if (salutation === 'Frau') expect(female.has(given), given).toBe(true);
      if (salutation === 'Herr') expect(male.has(given), given).toBe(true);
    }
    const buyers = new Set<string>();
    for (let i = 1; i <= 20; i += 1) {
      const deal = [scope(2000 + i, 'Vertrag')];
      const buyer = ask('Nachname', [...deal, scope(3000 + i, 'Kaeufer'), scope(4000 + i, 'Name')]) ?? '';
      const seller = ask('Nachname', [...deal, scope(5000 + i, 'Verkaeufer'), scope(6000 + i, 'Name')]) ?? '';
      buyers.add(buyer === seller ? 'same' : 'different');
    }
    expect(buyers.has('different')).toBe(true);
  });

  it('gives further occurrences of a field in one element further entries of the same list', () => {
    const ask = asker();
    for (let i = 1; i <= 20; i += 1) {
      const at = [scope(i)];
      const names = [ask('Vorname', at), ask('Vorname', at), ask('Vorname', at)].map((n) => n ?? '');
      expect(new Set(names).size).toBe(3);
      const lists = [female, male].filter((list) => names.every((n) => list.has(n)));
      expect(lists.length, names.join(' ')).toBe(1);
    }
  });

  it('never gives an empty value, and no gendered salutation or name suffix to a neutral person', () => {
    const ask = asker(en);
    for (let i = 1; i <= 20; i += 1) expect(ask('nobilityPrefix', [scope(i)])).not.toBe('');
    const prefixes = new Set(Array.from({ length: 20 }, (_, i) => ask('nobilityPrefix', [scope(100 + i)])));
    expect([...prefixes].some((p) => en.person.nobilityPrefix.includes(p ?? ''))).toBe(false);
    expect(forGender(de.person.firstName, 'neutral')).toEqual(de.person.firstName.neutral);
    expect(formsFor(de.person.salutation, 'neutral')).toEqual([]);
    expect(formsFor(de.person.nameSuffix, 'neutral')).toEqual([]);
    expect(formsFor(en.person.salutation, 'neutral')).toEqual(['Mx.']);
    expect(formsFor(en.person.nameSuffix, 'male')).toEqual(['Jr.', 'Sr.', 'II', 'III', 'IV']);
    let neutral = 0;
    for (let seed = 1; seed <= 3000; seed += 1) {
      const p = drawPerson(de, createRng(seed));
      if (p.gender !== 'neutral') continue;
      neutral += 1;
      expect(p.firstName).not.toBe('');
      // Without neutral forms, salutation and name suffix are left to the facets.
      expect(p.salutation).toBe('');
      expect(p.nameSuffix).toBe('');
    }
    expect(neutral).toBeGreaterThan(0);
    // The fields then get facet values, never Frau, Herr, Freifrau or Freiherr.
    const de2 = asker(de);
    const gendered = new Set([
      ...de.person.salutation.female,
      ...de.person.salutation.male,
      ...de.person.nameSuffix.female,
      ...de.person.nameSuffix.male,
    ]);
    for (let i = 1; i <= 300; i += 1) {
      const at = [scope(9000 + i)];
      if (de2('Geschlecht', at, text({ enumeration: ['w', 'm', 'd'] })) !== 'd') continue;
      expect(gendered.has(de2('Anrede', at) ?? '')).toBe(false);
      expect(gendered.has(de2('Namenszusatz', at, text({ maxLength: 20 })) ?? '')).toBe(false);
    }
  });

  it('writes building numbers without a leading zero in any part', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const { houseNumber } = drawAddress(de, createRng(seed));
      expect(houseNumber).not.toMatch(/(^|[^0-9])0/);
    }
    expect(fill('##-##/?', createRng(1), true)).toMatch(/^[1-9][0-9]-[1-9][0-9]\/[A-Z]$/);
  });

  it('checks a raw locale object and the reference date with clear messages', () => {
    expect(() => localeValues({ tag: 'xx', person: de.person } as unknown as typeof de)).toThrow(
      'locale xx: address is missing',
    );
    for (const date of ['5', '2026-02-30', '2026-13-01', '15.01.2026', '2026-01-15T25:00Z']) {
      expect(() => localeValues(de, { referenceDate: date }), date).toThrow(TypeError);
    }
    for (const date of ['2026-01-15', '2026-01-15T12:00:00Z', '2026-01-15T12:00+01:00']) {
      expect(() => localeValues(de, { referenceDate: date }), date).not.toThrow();
    }
  });
});
