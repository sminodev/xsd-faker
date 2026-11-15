# xsd-faker-locales

Locale data for [xsd-faker](https://github.com/sminodev/xsd-faker#readme): first and last names, titles, name prefixes and suffixes,
streets, cities with their postcodes, phone number patterns, e-mail domains and common words, for German
(`de`) and English with US addresses (`en`). The package provides data and helpers for defining locales.
xsd-faker maps schema fields to locale values.

xsd-faker includes and re-exports this package. When using xsd-faker, import locale helpers from it:

```js
import { extendLocale, de } from 'xsd-faker';
import { generateSampleFile } from 'xsd-faker/node';

const office = extendLocale(de, { person: { title: ['Dr.', 'Prof.'] } });
const sample = await generateSampleFile('order.xsd', { locale: office });
```

## Without xsd-faker

Tools that need locale data without xsd-faker can depend on this package directly:

```js
import { defineLocale, extendLocale, de, en } from 'xsd-faker-locales';

// Override selected fields; arrays replace the corresponding lists in the base locale.
const deAT = defineLocale('de-AT', {
  extends: de,
  address: {
    places: [{ city: 'Wien', postcodes: ['1010', '1020'] }],
    states: [],
    country: { code: 'AT', name: 'Österreich' },
  },
});

// Replace a list, or use { arrays: 'append' } to add entries.
const office = extendLocale(en, { person: { title: ['Dr.', 'Prof.', 'Rev.'] } });
```

`defineLocale` validates the data and throws a `TypeError` identifying the first invalid field. The types
`LocaleData`, `PersonData`, `AddressData`, `ContactData` and `TextData` describe the shape; the
[locale guide](https://github.com/sminodev/xsd-faker/blob/main/docs/locales.md#adding-a-locale) lists every field.

`localeFromFaker(definition)` converts locale data from your own faker-js installation;
this package does not depend on faker-js.

See [SOURCES.md](SOURCES.md) for data provenance. The built-in phone patterns and e-mail domains use
ranges reserved for fiction and examples. Custom locales and faker-js data may use other ranges.
