// Recognizes fields from element or attribute names, then type names and base types. Matching ignores case and
// separators and transliterates umlauts: Postleitzahl, postleitzahl and POST_LEITZAHL match the same field.
// German and English aliases are independent of the locale used to generate values.

import type { ValueContext } from '../source.js';

export const FIELD_KEYS = [
  'person.firstName',
  'person.lastName',
  'person.fullName',
  'person.title',
  'person.nobilityPrefix',
  'person.nameSuffix',
  'person.salutation',
  'person.gender',
  'address.street',
  'address.houseNumber',
  'address.streetLine',
  'address.postcode',
  'address.city',
  'address.state',
  'address.country',
  'address.supplement',
  'contact.phone',
  'contact.mobile',
  'contact.email',
  'date.birth',
  'date.past',
  'date.future',
  'id.kvnr',
  'id.ik',
  'id.lanr',
  'id.pzn',
  'text',
] as const;

/** A kind of value a locale can give. */
export type FieldKey = (typeof FIELD_KEYS)[number];

/** Names by field; a `Map`, so that a name such as `constructor` finds nothing inherited. */
const NAMES: ReadonlyMap<string, FieldKey> = names({
  'person.firstName': 'vorname firstname givenname forename rufname',
  'person.lastName': 'nachname lastname surname familienname familyname zuname name',
  'person.fullName': 'fullname vollername personname customername patientname contactname recipientname insuredname',
  'person.title': 'titel akademischertitel academictitle nametitle',
  'person.nobilityPrefix': 'vorsatzwort namensvorsatz nobilityprefix nobiliaryparticle',
  'person.nameSuffix': 'namenszusatz namesuffix',
  'person.salutation': 'anrede salutation',
  'person.gender': 'geschlecht gender sex',
  'address.street': 'strasse strassenname street streetname',
  'address.houseNumber': 'hausnummer hausnr housenumber buildingnumber',
  'address.streetLine': 'strasseundhausnummer strassehausnummer streetaddress addressline addressline1',
  'address.postcode': 'postleitzahl plz postcode postalcode zip zipcode',
  'address.city': 'ort wohnort stadt city town locality',
  'address.state': 'bundesland state province',
  'address.country': 'land country countrycode laenderkennzeichen landeskennzeichen laendercode staat',
  'address.supplement': 'anschriftenzusatz adresszusatz addresssupplement addressline2',
  'contact.phone': 'telefon telefonnummer phone phonenumber telephone fax faxnummer telefax',
  'contact.mobile': 'mobil mobilnummer mobiltelefon handy mobile mobilephone cellphone',
  'contact.email': 'email mail emailadresse mailadresse emailaddress',
  'date.birth': 'geburtsdatum geburtstag birthdate dateofbirth birthday dob',
  'id.kvnr': 'kvnr krankenversichertennummer versichertennummer versichertenid',
  'id.ik': 'ik institutionskennzeichen',
  'id.lanr': 'lanr arztnummer lebenslangearztnummer',
  'id.pzn': 'pzn pharmazentralnummer',
});

/** Ignored type-name suffixes, such as `Type` in `Date_Type` or `Stp`. */
const TYPE_SUFFIXES = new Set(['stp', 'ctp', 'type', 'typ', 't']);
/** Names too general for type-based recognition; matched only on elements and attributes. */
const ELEMENT_ONLY = new Set(['name']);
/** Suffixes sufficient to identify a compound name, as in `Absender_IK` or `Customer_Email`. */
const LAST_WORD = new Set(['ik', 'kvnr', 'lanr', 'pzn', 'email', 'mail', 'mailadresse', 'telefon', 'telefonnummer']);

/** A word that makes a name a date: German compounds end with `datum`, English names have a word of their own. */
const isDateWord = (w: string): boolean =>
  w.endsWith('datum') || ['date', 'datetime', 'timestamp', 'zeitpunkt'].includes(w);
/** A word that puts a date after the reference date. */
const isFutureWord = (w: string): boolean =>
  /^(end|ablauf|faellig)|(ende|bis)$/.test(w) ||
  ['expiry', 'expiration', 'expires', 'due', 'until', 'validto', 'validuntil'].includes(w);
/** Whether a name puts a date after the reference date, as `GueltigBis`, `Enddatum` or `validUntil` do. */
const isFuture = (name: string): boolean => {
  const parts = words(name);
  return parts.some(isFutureWord) || isFutureWord(parts.join(''));
};
/** A word that makes a name a code, a number or a key, which free text would not suit. */
const isCodeWord = (w: string): boolean =>
  /(nummer|kennzeichen|schluessel|kennung|code|referenz)$/.test(w) ||
  ['id', 'nr', 'no', 'number', 'key', 'ref', 'uuid', 'guid', 'code'].includes(w);
const DATE_TYPES = new Set(['date', 'dateTime', 'gYear', 'gYearMonth']);
const TEXT_TYPES = new Set(['string', 'normalizedString', 'token']);

function names(table: Partial<Record<FieldKey, string>>): Map<string, FieldKey> {
  const out = new Map<string, FieldKey>();
  for (const [key, list] of Object.entries(table)) for (const name of list.split(' ')) out.set(name, key as FieldKey);
  return out;
}

/** The words of a name in lower case, umlauts written out: `KVNR_Type` gives `kvnr` and `type`. */
export function words(name: string): string[] {
  return name
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '');
}

/** The field one name stands for. */
function fieldOfName(name: string, type: boolean): FieldKey | undefined {
  let parts = words(name);
  if (type) while (parts.length > 1 && TYPE_SUFFIXES.has(parts.at(-1) ?? '')) parts = parts.slice(0, -1);
  const joined = parts.join('');
  if (type && ELEMENT_ONLY.has(joined)) return undefined;
  const direct = NAMES.get(joined);
  if (direct) return direct;
  const last = parts.at(-1) ?? '';
  if (parts.length > 1 && LAST_WORD.has(last)) return NAMES.get(last);
  if (parts.some(isDateWord)) return parts.some(isFutureWord) ? 'date.future' : 'date.past';
  return undefined;
}

/**
 * Recognizes a field by element/attribute name, then type names, with built-in-type fallbacks for dates
 * and free text. Returns undefined when no field matches.
 */
export function fieldOf(
  context: Pick<ValueContext, 'name' | 'facets' | 'typeName' | 'baseTypeNames'>,
): FieldKey | undefined {
  const types = [context.typeName, ...(context.baseTypeNames ?? [])].filter((t) => t !== undefined);
  const found =
    fieldOfName(context.name, false) ??
    types.reduce<FieldKey | undefined>(
      (key, type) => key ?? fieldOfName(type.slice(type.indexOf('}') + 1), true),
      undefined,
    );
  const { facets } = context;
  // A date by its type, or by the name of its type, lies ahead where the element's name says it ends something.
  const date = DATE_TYPES.has(facets.builtin) && found !== 'date.birth' ? 'date.past' : found;
  if (date === 'date.past' || date === 'date.future') return isFuture(context.name) ? 'date.future' : date;
  if (found !== undefined) return found;
  const free =
    !words(context.name).some(isCodeWord) &&
    facets.variety === 'atomic' &&
    TEXT_TYPES.has(facets.builtin) &&
    facets.patterns.length === 0 &&
    facets.enumeration === undefined;
  return free ? 'text' : undefined;
}
