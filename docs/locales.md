# Locales

Without a locale, every value comes from the facets of its type: a last name of `xs:string` with
`maxLength="30"` becomes something like `Qdnnfugzywaeazi`. A locale gives values that read like real data
where the names in the schema say what a field holds. The schema still decides: every locale value is
checked against the facets, and a field the locale cannot fill gets a facet value as before.

```js
import { generateSampleFile } from 'xsd-faker/node';

const sample = await generateSampleFile('order.xsd', { locale: 'de', seed: 7 });
```

On the command line, use `--locale de`. The built-in locales are `de` and `en`. A tag with a region falls
back along its subtags, so `de-CH` uses `de`. Without `locale`, values come from the facets alone and a
locale draws no random numbers, so a seed gives the same document whether locale support is used elsewhere
or not.

## From profiles to locales

Locales replace the profiles of earlier versions. The option `profile` (`generic`, `retail`, `insurance`,
`logistics`), the CLI option `--profile`, `profileValues` and `PROFILE_NAMES` are gone. A call that still passes
`profile` fails with a `TypeError` that points to `locale`, and `--profile` ends with exit code 1, so that no
call loses its values without notice:

| Before                                              | Now                                           |
| --------------------------------------------------- | --------------------------------------------- |
| `{ profile: 'retail', locale: 'de' }`               | `{ locale: 'de' }`                            |
| `--profile insurance --locale de --date 2026-01-15` | `--locale de --date 2026-01-15`               |
| `profileValues('retail', { locale: 'de' })`         | `localeValues('de')`                          |
| fixed product names or codes of a profile           | `samples` or `--values`, by path or type name |

A locale fills the fields its names reveal, such as names, addresses, dates and identifiers, in any domain. The
retail words of a profile, such as product names, have no locale field; list them in `samples`.

## Where values come from

For each simple value, the first source that has one meeting the facets wins:

1. `fixed` and `default` values of the declaration;
2. `samples`, by path and then by type name;
3. the locale;
4. the facets alone.

`values` replaces the locale with a source of your own; `samples` is still tried first. `localeValues`
returns the locale as a `ValueSource`, for a chain of your own built with `firstOf`.

## Fields

A value's field is read from the local name of its element or attribute, then from the name of its simple
type and the types that type derives from, nearest first. Names are compared in lower case, with umlauts
written out and `_`, `-` and case changes ignored, and a trailing `Type`, `Typ` or a short form such as `Stp`
of a type name is dropped. German and English names lead to the same field, so a German schema can get English data and the
other way round.

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

A compound name is decided by its last word where that word names an identifier, an e-mail address or a
phone number, so `Absender_IK` is an IK and `Customer_Email` an e-mail address. A type called just `Name`
says too little and is not read; only an element or attribute named `Name` counts as a last name. A value
of type `xs:date`, `xs:dateTime`, `xs:gYear` or `xs:gYearMonth` is always a date.

Where the names mislead, `localeFields` names the field of a path or type, with keys as for `samples`;
`null` leaves the value to the facets:

```js
const sample = await generateSampleFile('order.xsd', {
  locale: 'en',
  localeFields: { '/Order/Buyer/Ref': 'person.fullName', Title: null },
});
```

## People and addresses

The name fields of one element belong to one person, and its address fields to one place: in
`<Customer><FirstName/><LastName/><Gender/><Email/></Customer>`, the gender fits the first name and the
e-mail address is made from both names. Salutation and name suffix follow the gender too, `Freifrau` for a
woman and `Freiherr` for a man; a neutral form suits everyone. A neutral person takes only neutral
salutations and name suffixes; where the locale has none, as `de`, those fields get facet values. City,
postcode and state come from the same entry of the locale.

A record also serves the parent of the element that holds its fields: in
`<Person><Name><FirstName/><LastName/></Name><Gender/></Person>`, the gender fits the first name inside
`Name`. Elements beside each other get records of their own, so `Buyer/Name` and `Seller/Name` are two
people, and so does each occurrence of a repeated element and each element of a choice branch. A further
occurrence of a field in the same element, such as the second of three first names, takes another entry of
the same list while the list has one. A record is drawn when the first of its fields is asked for, with one
number from the seeded random source, so its fields never shift other values.

A record value that fails the facets of its field, such as a last name longer than `maxLength`, is replaced
for that field only: by another entry of the locale's list that fits, and otherwise by a facet value. The
other fields keep the record. An empty list never gives a value; the field gets a facet value instead. A
gender with an enumeration takes the code it spells for that gender, such as `w`, `m`, `d` or `F`, `M`,
`X`.

## Dates

Dates count from `referenceDate`: a birth date lies one to ninety years back, a date whose element name says
it ends something up to two years ahead, any other date up to two years back. A name ends something with a
word such as `Ende`, `Ablauf`, `bis`, `end`, `until` or `expiry`, also without `datum` or `date` in it:
`GueltigBis`, `Leistungsende` and `validUntil` lie ahead, whether their type is `xs:date` or a string type
named like a date. The built-in date types and a string without pattern get the ISO form, such as
`2026-01-15`. A string with a pattern gets the first of these forms the pattern accepts: `YYYYMMDD`,
`YYYY-MM-DD`, `DD.MM.YYYY`, `YYYYMMDDhhmmss`, `YYYY-MM-DDThh:mm:ss`, `YYYYMMDDhhmm`, `YYYY-MM-DD hh:mm:ss`,
`YYYYMM` and `YYYY`.

## Identifiers

Four identifiers of the German health system get a valid check digit, in every locale:

| Field     | Form                                           | Check digit                                                                                     |
| --------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `id.kvnr` | a letter and nine digits, such as `A000500015` | the letter as two digits (A = 01), weights 1, 2, 1, 2, …, digit sums of the products, modulo 10 |
| `id.ik`   | nine digits, such as `260326822`               | digits 3 to 8, weights 1, 2, … from the right, digit sums, modulo 10                            |
| `id.lanr` | six digits, a check digit and a specialty code | digits 1 to 6 weighted 4, 9, 4, 9, …; 10 minus the sum modulo 10, 0 for 10                      |
| `id.pzn`  | eight digits, such as `27580899`               | digits weighted 1 to 7, modulo 11; a remainder of 10 is never issued                            |

The other digits come from the schema's pattern when it gives the identifier's form, so a fixed part of the
pattern stays; otherwise they are random. A KVNR never repeats a digit more than three times in a row and
never contains `666`. An enumeration on the type comes first.

## Free text

A string without pattern or enumeration that matches no other field gets free text in the locale's words,
unless its name says it holds a number, a code, a key or an ID, such as `Kundennummer`,
`Tarifschluessel` or `orderId`; those keep facet values. Up to 40 characters it is a word group without a
period, such as `Hinterhaus links`; beyond, it is sentences. A phrase or sentence of the locale is used as
it is where it fits the length facets; otherwise words are joined to the exact length, with single spaces
and none at either end, so the length holds under every `whiteSpace` rule. A long `maxLength` is not used
up: free text stays under 160 characters unless `minLength` asks for more.

## Domain values

A locale knows people, addresses, dates and contact details, not the codes of a domain. Supply those as
value lists keyed by the name of their simple type, so that one entry covers every place the type is used:

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

A locale is plain data in the shape of `LocaleData`: `person`, `address`, `contact` and `text`. Its types
are exported by `xsd-faker-locales` and by `xsd-faker`. `defineLocale(tag, data)` checks the data and
returns a frozen locale; with `extends`, the data only needs the parts that differ. Objects fall back field
by field, arrays are replaced as a whole, so a list never mixes two languages:

```js
import { defineLocale, de } from 'xsd-faker-locales';
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

A mistake is a `TypeError` that names its path, such as `locale de-CH: address.places[0].postcodes must not
be empty`, so a locale fails when it is defined and not halfway through generation. `extendLocale(base,
patch)` returns a copy of a locale with some data replaced; with `{ arrays: 'append' }` its arrays are added
to the existing ones instead:

```js
import { extendLocale, en } from 'xsd-faker-locales';

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

`localeFromFaker(definition)` builds a locale from the locale data of [faker-js](https://fakerjs.dev), which
you install and import yourself; neither package depends on it. The object is read for its shape: first
names by gender, last names, titles among the name prefixes, street names and building number patterns, and
where faker-js has cities, the cities with its states and the country of its metadata, named by its default
country. Without cities, city, postcode, state and country come together from the base locale, so an address
never mixes two countries. Where the metadata names no country, pass it, as in `localeFromFaker(fr, {
country: 'FR' })`; otherwise the country of the cities stays open and a country field gets a facet value,
never the country of the base locale. For a definition without cities, `country` is a `TypeError`: its addresses
come from the base locale, country included. Entries a locale cannot hold, such as ones with control characters,
are left out; `?` in a postcode pattern stands for a letter. faker-js has no postcodes per city, so each
city gets the locale's postcode pattern, and the address of a generated document does not combine a real
city with its real postcode. Everything else comes from the base locale, `de` for a German tag and `en`
otherwise:

```js
import { de as fakerDe } from '@faker-js/faker';
import { localeFromFaker } from 'xsd-faker-locales';

const locale = localeFromFaker(fakerDe, { tag: 'de-x-faker' });
const sample = await generateSampleFile('order.xsd', { locale });
```

The data then comes from your faker-js installation and follows its license. A seed reproduces a document
only with the same faker-js version.
