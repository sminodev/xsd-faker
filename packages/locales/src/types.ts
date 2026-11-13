// The shape of a locale. Every list is plain data, so a locale can be written as an object literal or loaded from
// JSON. Patterns use `#` for a digit; street patterns refer to the street lists with `{stem}`, `{suffix}` and `{name}`.

/** One list for each grammatical gender, as names, salutations and name suffixes need. */
export interface Gendered {
  female: readonly string[];
  male: readonly string[];
  /** May be empty. */
  neutral: readonly string[];
}

export interface PersonData {
  firstName: Gendered;
  lastName: readonly string[];
  /** Academic titles such as `Dr.`; may be empty. */
  title: readonly string[];
  /** Words before the last name such as `von`; may be empty. */
  nobilityPrefix: readonly string[];
  /**
   * Words that belong to a name without being part of it, such as `Freiherr` and `Freifrau` or `Jr.`; each list may
   * be empty. A neutral form suits every person.
   */
  nameSuffix: Gendered;
  salutation: Gendered;
}

/** A city with postcodes that belong to it, and the code of its state or region. */
export interface Place {
  city: string;
  /** Postcodes of the city; `#` stands for a digit, for a locale that knows only the form of its postcodes. */
  postcodes: readonly string[];
  /** The code of an entry of `AddressData.states`. */
  state?: string;
}

/** A state, region or country: a code and a name. */
export interface Region {
  code: string;
  name: string;
}

export interface StreetData {
  /** How a street name is formed, such as `{stem}{suffix}` or `{stem} {suffix}`; repeat an entry to weight it. */
  patterns: readonly string[];
  stems: readonly string[];
  suffixes: readonly string[];
  /** Complete street names. */
  names: readonly string[];
}

export interface AddressData {
  street: StreetData;
  /** How street and building number are written on one line: `{street} {number}` or `{number} {street}`. */
  streetLine: readonly string[];
  /** Patterns such as `##` or `#a`; the first digit of a number is never 0. */
  buildingNumber: readonly string[];
  /** Additions such as a building part or a floor; may contain `#`; may be empty. */
  supplement: readonly string[];
  places: readonly Place[];
  /** The states or regions that `Place.state` refers to; may be empty. */
  states: readonly Region[];
  /** The country of the places; may be missing where it is not known, and a country field gets a facet value then. */
  country?: Region;
}

export interface ContactData {
  /** Phone number patterns, such as `030 23125###`. Use numbers reserved for fiction or tests. */
  phone: readonly string[];
  /** Mobile number patterns; may be empty, the phone patterns stand in for it then. */
  mobile: readonly string[];
  /** Domains for e-mail addresses. Use reserved domains such as `example.com` or `*.example`. */
  emailDomain: readonly string[];
}

export interface TextData {
  /** Common words without spaces, for free text of any length. */
  words: readonly string[];
  /** Short word groups without a final period. */
  phrases: readonly string[];
  /** Complete sentences ending with a period. */
  sentences: readonly string[];
}

/** A complete locale, as `defineLocale` returns it. */
export interface LocaleData {
  /** A BCP 47 language tag such as `de`, `de-AT` or `en`. */
  readonly tag: string;
  readonly person: PersonData;
  readonly address: AddressData;
  readonly contact: ContactData;
  readonly text: TextData;
}

/** Any part of a locale: objects may be partial, arrays are always given whole. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** The data `defineLocale` takes: a complete locale, or parts of one on top of the locale it `extends`. */
export type LocaleInput = DeepPartial<Omit<LocaleData, 'tag'>> & {
  /** The locale this one falls back to for everything it does not give. */
  extends?: LocaleData;
};
