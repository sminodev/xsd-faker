# xsd-faker-locales

Locale data for [xsd-faker](../../README.md): first and last names, titles, name prefixes and suffixes,
streets, cities with their postcodes, phone number patterns, e-mail domains and common words, for German
(`de`) and English with US addresses (`en`). The package holds data and the tools to define it; xsd-faker
decides which field of a schema gets which value.

xsd-faker installs this package and exports all of it, so with xsd-faker you import from `xsd-faker` and
never need this package in your own dependencies:

```js
import { extendLocale, de } from 'xsd-faker';
import { generateSampleFile } from 'xsd-faker/node';

const office = extendLocale(de, { person: { title: ['Dr.', 'Prof.'] } });
const sample = await generateSampleFile('order.xsd', { locale: office });
```

## Without xsd-faker

A tool that only needs the data, such as a test data builder of its own, depends on this package directly:

```js
import { defineLocale, extendLocale, de, en } from 'xsd-faker-locales';

// Parts of a locale on top of another one: objects fall back field by field, arrays as a whole.
const deAT = defineLocale('de-AT', {
  extends: de,
  address: {
    places: [{ city: 'Wien', postcodes: ['1010', '1020'] }],
    states: [],
    country: { code: 'AT', name: 'Österreich' },
  },
});

// A copy with some lists replaced, or added to with { arrays: 'append' }.
const office = extendLocale(en, { person: { title: ['Dr.', 'Prof.', 'Rev.'] } });
```

`defineLocale` checks the data and throws a `TypeError` with the path of the first mistake. The types
`LocaleData`, `PersonData`, `AddressData`, `ContactData` and `TextData` describe the shape; the
[locale guide](../../docs/locales.md#adding-a-locale) lists every field.

`localeFromFaker(definition)` makes a locale from the locale data of faker-js that you install yourself;
this package does not depend on faker-js.

The origin of each list is in [SOURCES.md](SOURCES.md). Phone numbers and e-mail domains are reserved for
fiction and examples, so generated data reaches nobody.
