# Locales

A locale supplies readable names, addresses, dates, contact details and free text for recognized schema
fields. Each value must satisfy the field's facets. If the locale cannot supply a suitable value, the
facet generator handles the field. Without a locale, values come directly from the facets.

```js
import { generateSampleFile } from 'xsd-faker/node';

const sample = await generateSampleFile('order.xsd', { locale: 'de', seed: 7 });
```

On the command line, use `--locale de`. The built-in locales are `de` and `en`. A tag with a region falls
back along its subtags, so `de-CH` uses `de`.

## Where values come from

Values are selected in this order:

1. `fixed` and `default` values of the declaration;
2. `samples`, by path and then by type name;
3. the locale;
4. the facets alone.

`values` replaces the locale with a source of your own; `samples` is still tried first. `localeValues`
returns the locale as a `ValueSource`, for a chain of your own built with `firstOf`.

## Fields

Field recognition checks the local element or attribute name first, then the simple type name and its
base types, nearest first. Names are compared in lower case, with umlauts
written out and `_`, `-` and case changes ignored, and a trailing `Type`, `Typ` or a short form such as `Stp`
is removed from type names. German and English names map to the same fields, so either language can be
used with either locale.

| Field                   | Names, for example                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `person.firstName`      | `Vorname`, `firstName`, `givenName`                                                           |
| `person.lastName`       | `Nachname`, `lastName`, `surname`, `Familienname`; `Name` as an element                       |
| `person.fullName`       | `fullName`, `customerName`, `patientName`                                                     |
| `person.title`          | `Titel`, `academicTitle`                                                                      |
| `person.nobilityPrefix` | `Vorsatzwort`, `nobilityPrefix`                                                               |
| `person.nameSuffix`     | `Namenszusatz`, `nameSuffix`                                                                  |
| `person.salutation`     | `Anrede`, `salutation`                                                                        |
| `person.gender`         | `Geschlecht`, `gender`, `sex`                                                                 |
| `address.street`        | `Strasse`, `Straße`, `street`                                                                 |
| `address.houseNumber`   | `Hausnummer`, `houseNumber`, `buildingNumber`                                                 |
| `address.streetLine`    | `Strasse_und_Hausnummer`, `streetAddress`, `addressLine1`                                     |
| `address.postcode`      | `Postleitzahl`, `PLZ`, `postcode`, `postalCode`, `zip`                                        |
| `address.city`          | `Ort`, `Wohnort`, `Stadt`, `city`, `town`                                                     |
| `address.state`         | `Bundesland`, `state`, `province`                                                             |
| `address.country`       | `Land`, `country`, `countryCode`                                                              |
| `address.supplement`    | `Anschriftenzusatz`, `addressLine2`                                                           |
| `contact.phone`         | `Telefon`, `Telefonnummer`, `phone`, `Fax`                                                    |
| `contact.mobile`        | `Mobilnummer`, `Handy`, `mobile`                                                              |
| `contact.email`         | `E_Mail`, `Mailadresse`, `email`                                                              |
| `date.birth`            | `Geburtsdatum`, `birthDate`, `dateOfBirth`                                                    |
| `date.future`           | a date whose name has `Ende`, `Ablauf`, `bis`, `end`, `until`, `expiry` or `due`              |
| `date.past`             | any other date name: a German word ending in `datum`, or `date`                               |
| `id.kvnr`               | `KVNR`, `Krankenversichertennummer`, `Versichertennummer`                                     |
| `id.ik`                 | `IK`, `Institutionskennzeichen`                                                               |
| `id.lanr`               | `LANR`, `Arztnummer`, `Lebenslange_Arztnummer`                                                |
| `id.pzn`                | `PZN`, `Pharmazentralnummer`                                                                  |
| `text`                  | any other string without pattern or enumeration, unless its name says number, code, key or ID |

The last word of a compound name identifies the field if it names an identifier, e-mail address or
phone number: `Absender_IK` is an IK and `Customer_Email` an e-mail address. The type name `Name` is too
general for field recognition; only an element or attribute named `Name` counts as a last name. A value
of type `xs:date`, `xs:dateTime`, `xs:gYear` or `xs:gYearMonth` is always a date.

Use `localeFields` to override field recognition by path or type name, with the same keys as `samples`.
Set a key to `null` to use facet generation for that field:

```js
const sample = await generateSampleFile('order.xsd', {
  locale: 'en',
  localeFields: { '/Order/Buyer/Ref': 'person.fullName', Title: null },
});
```

## People and addresses

The name fields within one element share a person record, and its address fields share an address record.
In `<Customer><FirstName/><LastName/><Gender/><Email/></Customer>`, the first name matches the generated
gender and the e-mail address uses both names. Salutations and name suffixes also follow that gender;
neutral forms can be used for any gender. A neutral person receives only neutral salutations and suffixes.
If the locale has none, as with `de`, those fields fall back to facet generation. City, postcode and state
come from the same place in the locale data.

A nested record can also serve its parent. In
`<Person><Name><FirstName/><LastName/></Name><Gender/></Person>`, the parent's gender matches the first
name inside `Name`. Sibling elements such as `Buyer/Name` and `Seller/Name` receive separate records,
as do repeated occurrences and elements in choice branches. A repeated field within one record, such as
the second of three first names, uses another entry from the same list if an unused entry is available.

If a record value fails its field's facets, only that field is replaced. The generator first tries another
entry from the locale list, then falls back to facet generation. The other fields keep their record values.
An empty list also causes a fallback. For a gender field with an enumeration, the generator uses a matching
code such as `w`, `m`, `d` or `F`, `M`, `X`.

## Dates

Dates are relative to `referenceDate`, an ISO date or timestamp. A timestamp without a time zone, such as
`2026-01-15T00:30:00`, is interpreted as UTC, so results do not depend on the machine's time zone.
Birth dates are one to ninety years earlier. End, expiry and due
dates are up to two years later; other dates are up to two years earlier. Words such as `Ende`, `Ablauf`,
`bis`, `end`, `until` or `expiry` identify future dates even without `datum` or `date` in the name:
`GueltigBis`, `Leistungsende` and `validUntil` produce future dates for both built-in date types and
string types recognized as dates.

Built-in date types and strings without a pattern use ISO forms, such as `2026-01-15`. For a string with
a pattern, the first matching format is used: `YYYYMMDD`, `YYYY-MM-DD`, `DD.MM.YYYY`, `YYYYMMDDhhmmss`,
`YYYY-MM-DDThh:mm:ss`, `YYYYMMDDhhmm`, `YYYY-MM-DD hh:mm:ss`, `YYYYMM` or `YYYY`.

## Identifiers

Four identifiers of the German health system get a valid check digit, in every locale:

| Field     | Form                                           | Check digit                                                                                     |
| --------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `id.kvnr` | a letter and nine digits, such as `A000500015` | the letter as two digits (A = 01), weights 1, 2, 1, 2, …, digit sums of the products, modulo 10 |
| `id.ik`   | nine digits, such as `260326822`               | digits 3 to 8, weights 1, 2, … from the right, digit sums, modulo 10                            |
| `id.lanr` | six digits, a check digit and a specialty code | digits 1 to 6 weighted 4, 9, 4, 9, …; 10 minus the sum modulo 10, 0 for 10                      |
| `id.pzn`  | eight digits, such as `27580899`               | digits weighted 1 to 7, modulo 11; a remainder of 10 is never issued                            |

KVNR and IK values preferentially use ranges that are not issued to real people or institutions:

- KVNRs contain four consecutive identical digits or `666` among digits 2 to 9, such as `J222256102`.
  The allocation rules exclude these numbers. The prefix `X0000` is excluded from generation because
  electronic health card test cards use it.
- IKs start with 97, 98 or 99, which are reserved for internal use, such as `979865620`. If the schema
  requires another prefix, `109500969` is tried when it satisfies the facets. This IK is used for
  statutory health insurance tests and does not identify a real payer.

LANR and PZN values have valid check digits but no reserved test range; they may match real physician
or product numbers. KVNR and IK generation also falls back to the issued range if twenty attempts from
the test range fail to satisfy the facets. Use explicit values if avoiding real identifiers is a requirement.

Identifier generation preserves restrictions such as fixed prefixes and specialty codes when the schema's
pattern produces the identifier's format. Enumerations take precedence over generated identifiers.

Where a document must hold agreed test numbers, list them in `samples` by path or type name, as for
[domain values](#domain-values); listed values come before the locale.

## Free text

A string without a pattern or enumeration receives free text when no other field matches. Names that
indicate a number, code, key or ID, such as `Kundennummer`, `Tarifschluessel` or `orderId`, keep facet-generated
values. Text up to 40 characters uses a phrase without a period, such as `Hinterhaus links`; longer text uses
sentences. Existing phrases or sentences are used when they fit the length facets. Otherwise, words are
joined to the requested length with single spaces and no leading or trailing space, preserving the length
under every `whiteSpace` rule. Free text is capped at 160 characters unless `minLength` requires more,
even if `maxLength` allows it.

## Domain values

Supply domain-specific codes as value lists keyed by simple type name. One entry then covers every
field using that type:

```js
const sample = await generateSampleFile('claim.xsd', {
  locale: 'de',
  samples: {
    DiagnosisCode: ['J06.9', 'M54.5', 'R51'],
    ProcedureCode: ['5-470.11', '8-930'],
  },
});
```

A key without a slash is a local type name, `{namespace}local` a type name with its namespace, and a key
starting with `/` a path. A type key also applies to restrictions of that type, anonymous ones included.

## Adding a locale

Import locale helpers and types from `xsd-faker`. It exports `defineLocale`, `extendLocale`, `localeFromFaker`,
the built-in locales `de` and `en`, the `LOCALES` lookup by tag, and types such as `LocaleData`.
The data lives in `xsd-faker-locales`, which is installed with xsd-faker. Tools that use only the locale data
can depend on that package directly.

A locale is plain data in the shape of `LocaleData`: `person`, `address`, `contact` and `text`.
`defineLocale(tag, data)` checks the data and
returns a frozen locale. With `extends`, supply only the fields you want to override. Objects are merged
field by field; arrays are replaced as a whole:

```js
import { defineLocale, de } from 'xsd-faker';
import { generateSampleFile } from 'xsd-faker/node';

const deCH = defineLocale('de-CH', {
  extends: de,
  address: {
    places: [
      { city: 'Zürich', postcodes: ['8001', '8002'], state: 'ZH' },
      { city: 'Bern', postcodes: ['3011'], state: 'BE' },
    ],
    states: [
      { code: 'ZH', name: 'Zürich' },
      { code: 'BE', name: 'Bern' },
    ],
    country: { code: 'CH', name: 'Schweiz' },
  },
});

const sample = await generateSampleFile('order.xsd', { locale: deCH });
```

Invalid locale data throws a `TypeError` identifying the field, such as
`locale de-CH: address.places[0].postcodes must not be empty`. Validation happens when the locale is defined.
`extendLocale(base, patch)` returns a copy with the supplied overrides. Use `{ arrays: 'append' }` to
append array entries instead of replacing them:

```js
import { extendLocale, en } from 'xsd-faker';

const office = extendLocale(en, { person: { title: ['Dr.', 'Prof.', 'Rev.'] } });
const more = extendLocale(en, { person: { lastName: ['Okafor', 'Lindqvist'] } }, { arrays: 'append' });
```

### The data

| Field                    | Holds                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `person.firstName`       | `female`, `male` and `neutral` first names; `neutral` may be empty                                                                   |
| `person.lastName`        | last names                                                                                                                           |
| `person.title`           | academic titles; may be empty                                                                                                        |
| `person.nobilityPrefix`  | words before the last name, such as `von`; may be empty                                                                              |
| `person.nameSuffix`      | `female`, `male` and `neutral` words that belong to a name without being part of it, such as `Freifrau` and `Freiherr`; may be empty |
| `person.salutation`      | `female`, `male` and `neutral` salutations                                                                                           |
| `address.street`         | `patterns` such as `{stem}{suffix}` or `{stem} {suffix}`, with `stems`, `suffixes`, `names`                                          |
| `address.streetLine`     | how street and number share a line: `{street} {number}` or `{number} {street}`                                                       |
| `address.buildingNumber` | patterns such as `##` or `#a`, where `#` is a digit; no number starts with 0                                                         |
| `address.supplement`     | additions such as a building part or floor; may be empty                                                                             |
| `address.places`         | cities, each with its postcodes and, optionally, the code of its state                                                               |
| `address.states`         | states or regions with code and name; may be empty                                                                                   |
| `address.country`        | the country's code and name; may be missing, and a country field gets a facet value then                                             |
| `contact.phone`          | phone number patterns; use numbers reserved for fiction or tests                                                                     |
| `contact.mobile`         | mobile number patterns; may be empty                                                                                                 |
| `contact.emailDomain`    | domains for e-mail addresses; use reserved ones such as `example.com`                                                                |
| `text.words`             | common words without spaces                                                                                                          |
| `text.phrases`           | short word groups                                                                                                                    |
| `text.sentences`         | complete sentences                                                                                                                   |

Every entry is a non-empty string without white space at either end. A place's postcodes must belong to
its city: generated addresses take city, postcode and state from the same place, and a place's state must
be in `address.states`. A postcode may contain `#` for a digit and `?` for a capital letter, for a locale
that knows only the form of its postcodes. Free text reaches an exact length when its words can add up to
it with single spaces; a locale with words of two and three characters reaches every length from 2, and a
length the words cannot make is left to the facets.

## A locale from faker-js

`localeFromFaker(definition)` converts locale data from [faker-js](https://fakerjs.dev), which you install
and import separately. Neither xsd-faker nor its locale package depends on faker-js. The adapter reads
first names by gender, last names, titles, street names and building number patterns.

If the definition contains cities, they are used with its states and country metadata. If the country
is missing, supply it explicitly, for example `localeFromFaker(fr, { country: 'FR' })`. Otherwise country
fields use facet generation. Each city uses the locale's postcode pattern because faker-js does not
provide postcodes per city; the result is not guaranteed to be a real city/postcode pair.

Without cities, the full address data comes from the base locale, including the country. Passing
`country` in this case throws a `TypeError`. Other missing data also comes from the base locale:
`de` for a German tag and `en` otherwise. Invalid entries, such as strings containing control characters,
are omitted. In postcode patterns, `?` represents a capital letter.

```js
import { de as fakerDe } from '@faker-js/faker';
import { localeFromFaker } from 'xsd-faker';
import { generateSampleFile } from 'xsd-faker/node';

const locale = localeFromFaker(fakerDe, { tag: 'de-x-faker' });
const sample = await generateSampleFile('order.xsd', { locale });
```

The data then comes from your faker-js installation and follows its license. A seed reproduces a document
only with the same faker-js version.

## From profiles to locales

When upgrading code that uses profiles, replace `profile` and `--profile` with locale settings and value
lists. The API rejects `profile` with a `TypeError` directing callers to `locale`; the CLI rejects
`--profile` with exit code 1. The former exports `profileValues` and `PROFILE_NAMES` are unavailable.

| Profile-based call or value                         | Replacement                                   |
| --------------------------------------------------- | --------------------------------------------- |
| `{ profile: 'retail', locale: 'de' }`               | `{ locale: 'de' }`                            |
| `--profile insurance --locale de --date 2026-01-15` | `--locale de --date 2026-01-15`               |
| `profileValues('retail', { locale: 'de' })`         | `localeValues('de')`                          |
| fixed product names or codes of a profile           | `samples` or `--values`, by path or type name |

This applies to the former `generic`, `retail`, `insurance` and `logistics` profiles. Locales recognize
fields by name across domains; supply domain-specific values, such as product names, through `samples`.
