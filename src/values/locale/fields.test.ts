import { describe, expect, it } from 'vitest';
import type { Facets } from '../../xsd/facets.js';
import { fieldOf, words } from './fields.js';

const text = (extra: Partial<Facets> = {}): Facets => ({
  builtin: 'string',
  variety: 'atomic',
  patterns: [],
  ...extra,
});
const field = (name: string, typeName?: string, baseTypeNames: string[] = [], facets = text()) =>
  fieldOf({ name, facets, ...(typeName !== undefined ? { typeName } : {}), baseTypeNames });

describe('fieldOf', () => {
  it('reads German and English names alike', () => {
    expect(field('Nachname')).toBe('person.lastName');
    expect(field('lastName')).toBe('person.lastName');
    expect(field('surname')).toBe('person.lastName');
    expect(field('Postleitzahl')).toBe('address.postcode');
    expect(field('zipCode')).toBe('address.postcode');
    expect(field('Strasse_und_Hausnummer')).toBe('address.streetLine');
    expect(field('Straße')).toBe('address.street');
    expect(field('E_Mail')).toBe('contact.email');
    expect(field('Krankenversichertennummer')).toBe('id.kvnr');
    expect(field('Lebenslange_Arztnummer')).toBe('id.lanr');
  });

  it('decides compound names by their last word', () => {
    expect(field('Absender_IK')).toBe('id.ik');
    expect(field('Customer_Email')).toBe('contact.email');
    expect(field('Name_Firma')).toBe('text');
  });

  it('falls back to the type, nearest first, and never reads a name from the type alone', () => {
    expect(field('Kasse', '{urn:t}KVNR_Type')).toBe('id.kvnr');
    expect(field('Wert', '{urn:t}Titel_Type', ['{urn:t}Name_Type'])).toBe('person.title');
    expect(field('Firma', '{urn:t}Name_Type')).toBe('text');
    expect(field('Wert', undefined, ['{urn:t}Postleitzahl_Type'])).toBe('address.postcode');
  });

  it('finds dates by name or type, birth dates in the past and endings ahead', () => {
    const pattern = text({ patterns: [['[0-9]{8}']] });
    expect(field('Geburtsdatum', undefined, [], pattern)).toBe('date.birth');
    expect(field('birthDate', undefined, [], pattern)).toBe('date.birth');
    expect(field('Rechnungsdatum', undefined, [], pattern)).toBe('date.past');
    expect(field('Endedatum', undefined, [], pattern)).toBe('date.future');
    expect(field('Ende_Datum_Uhrzeit', undefined, [], pattern)).toBe('date.future');
    expect(field('Wert', '{urn:t}Datum_Type', [], pattern)).toBe('date.past');
    expect(field('candidate', undefined, [], pattern)).toBeUndefined();
    expect(field('Beginn', undefined, [], text({ builtin: 'date' }))).toBe('date.past');
  });

  it('puts dates ahead whose names end something, also without date in the name', () => {
    const date = text({ builtin: 'date' });
    const pattern = text({ patterns: [['[0-9]{8}']] });
    for (const name of ['GueltigBis', 'Enddatum', 'Leistungsende', 'validUntil', 'expiryDate', 'Ablauf', 'Bis']) {
      expect(field(name, undefined, [], date), name).toBe('date.future');
    }
    expect(field('GueltigBis', '{urn:t}Datum_Type', [], pattern)).toBe('date.future');
    expect(field('validTo', '{urn:t}Date_Type', [], pattern)).toBe('date.future');
    expect(field('GueltigBis', undefined, [], text())).toBe('text');
    expect(field('Beginn', undefined, [], date)).toBe('date.past');
    expect(field('Geburtsdatum', undefined, [], date)).toBe('date.birth');
  });

  it('gives free text only to strings without pattern or enumeration', () => {
    expect(field('Bemerkung')).toBe('text');
    expect(field('Code', undefined, [], text({ patterns: [['[A-Z]{3}']] }))).toBeUndefined();
    expect(field('Code', undefined, [], text({ enumeration: ['A'] }))).toBeUndefined();
    expect(field('Code', undefined, [], text({ builtin: 'NCName' }))).toBeUndefined();
    expect(field('order_ID')).toBeUndefined();
    expect(field('Auftragskennzeichen')).toBeUndefined();
    expect(field('Tarifschluessel')).toBeUndefined();
    expect(field('orderNumber')).toBeUndefined();
  });

  it('splits names into words', () => {
    expect(words('KVNR_Type')).toEqual(['kvnr', 'type']);
    expect(words('DatumUhrzeit_Type')).toEqual(['datum', 'uhrzeit', 'type']);
    expect(words('Absender_IK')).toEqual(['absender', 'ik']);
    expect(words('Straße')).toEqual(['strasse']);
  });
});
