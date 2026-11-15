# Development

Use Node.js 22.13 or later and `npm ci`. The package is TypeScript compiled to ES modules with `tsc`.
Runtime dependencies are `@xmldom/xmldom`, `xmllint-wasm` and `xsd-faker-locales`.

## Source layout

```text
src/
  index.ts             public generation API, results, roots and bounded batches
  node.ts              local file reader and directory boundary
  cli.ts, bin.ts       command implementation and process entry point
  options.ts           runtime checks for public options
  xsd/                 schema loading and redefine, the DOCTYPE scanner, facets, diagnostics, regex
                       translation and the XML name tables
  regex/               pattern parser and bounded string generation
  values/              facet values, value lists, composition and locale values
  generate/walker.ts   XSD traversal: the instance tree, attributes, values and JSON keys
  generate/choices.ts  branch selection, size estimates and reachable choices
  generate/alternatives.ts  substitution group members and xsi:type candidates
  generate/identities.ts    ID and IDREF planning with its integrity check
  xml/                 ordered instance tree and XML serialization
  json/serialize.ts    compact/tree JSON projection
  validate/xmllint.ts  explicit libxml2 verdicts, in batches against one compiled schema
  mutate/              invalid samples: paths, violating values, tree changes, libxml2 message
                       classification, namespace mapping, mutation planning and validation
packages/locales/     the locale data package: types, defineLocale, extendLocale and the built-in locales
```

`xsd/namechars.ts` holds the character classes of XML 1.0, Second Edition, Appendix B, which XML Schema 1.0
uses for its name types and for `\i` and `\c`.

The flow is `load → choose root → walk → plan IDs → describe values → serialize → validate`. Each simple
value carries its normalized form and numeric type so JSON serialization preserves its value. The walker
assigns compact JSON keys from the content model. Locales
only suggest values. They do not change cardinality, choices, namespaces or the schema itself. The
instance tree is the shared boundary between XML and JSON; do not add a second generator for the JSON
path.

## A walk through one schema

[`examples/order/order.xsd`](../examples/order/order.xsd) describes a synthetic business order for an office
supplies retailer. It includes a customer reference, company and contact details, packaged products, prices
and a choice between collection and delivery. The example uses three schema files. Commands below run from
the repository root.

### Generate an order

```sh
npm ci
npm run build
node dist/bin.js examples/order/order.xsd --seed 7 --locale de --optional-elements all \
  --values examples/order/values.json
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:example:order" xmlns:c="urn:example:common" created="2026-01-15T09:30:00Z">
  <OrderNumber>PO-544257</OrderNumber>
  <Title>Nachbestellung Bürobedarf</Title>
  <CustomerRef>C-13252</CustomerRef>
  <Express>true</Express>
  <Level>0</Level>
  <Pickup>true</Pickup>
  <Wanted>2026-01-22</Wanted>
  <Packages>2</Packages>
  <c:Note>Oqrzqxvbej <c:b>Der Termin wurde auf Wunsch um eine Woche verschoben.</c:b></c:Note>
  <DiscountCode>OFFICE09</DiscountCode>
  <DiscountPercent>18.9</DiscountPercent>
  <Contact>
    <c:Company>Beispielbüro GmbH</c:Company>
    <c:FullName>Marlene Fricke</c:FullName>
    <c:Email>marlene.fricke@firma.example</c:Email>
    <c:Phone>+49 69 90009929</c:Phone>
  </Contact>
  <Line>
    <Item>Kugelschreiber, Großpackung</Item>
    <Quantity>9</Quantity>
    <Price currency="USD">11.25</Price>
    <Tag>Bürobedarf</Tag>
    <Packaging>
      <Box>M</Box>
      <Weight>0.9</Weight>
    </Packaging>
  </Line>
  <Attachment>vKj9m7z0fTqVy9o=</Attachment>
  <Extensions>
    <c:Note>Gl <c:b>Bitte nutzen Sie den ausgewiesenen Weg durch den Garten.</c:b></c:Note>
  </Extensions>
</Order>
```

`--locale de` supplies German contact details and text. `values.json` sets the related order and fulfilment
dates and a product tag; these values are tried before the locale. With the same package version, schema and
options, the seed reproduces the document. `--optional-elements all`
includes fields such as `Contact`, `Price` and `Packaging`, so their nested structure is visible. Omit the flag
to generate only required elements. Optional attributes still follow their own setting: `version` and `channel`
are absent, while the required `created` and `currency` attributes are present.

### The schema and JSON

`Order` connects these declarations:

| File                | What to look for                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `order.xsd`         | Order and customer references, delivery choice, tracking attributes and repeated `Line` element                                            |
| `line.xsd`          | Included into the order namespace; defines `Line` with quantity, price, tags and nested packaging                                          |
| `common/common.xsd` | Imported under `urn:example:common`; defines shared text, bounded numeric and currency types, contact inheritance and mixed-content `Note` |

An include adds declarations in the same namespace; an import makes another namespace available. All three files
are needed to load this example. `Contact` extends `Party`, which holds the company and full name, with email and phone fields. `Price` restricts `Amount`
to require a currency attribute and limits the decimal amount to 5–50 with at most two fraction digits. The default choice strategy picks the first branch,
so this document contains `Pickup` rather than `DeliveryDate`.

Use the same options to generate the JSON representation:

```sh
node dist/bin.js examples/order/order.xsd --seed 7 --locale de --optional-elements all \
  --values examples/order/values.json --format json
```

```json
{
  "created": "2026-01-15T09:30:00Z",
  "OrderNumber": "PO-544257",
  "Title": "Nachbestellung Bürobedarf",
  "CustomerRef": "C-13252",
  "Express": true,
  "Level": 0,
  "Pickup": true,
  "Wanted": "2026-01-22",
  "Packages": 2,
  "Note": {
    "value": "Oqrzqxvbej <c:b xmlns:c=\"urn:example:common\">Der Termin wurde auf Wunsch um eine Woche verschoben.</c:b>"
  },
  "DiscountCode": "OFFICE09",
  "DiscountPercent": 18.9,
  "Contact": {
    "Company": "Beispielbüro GmbH",
    "FullName": "Marlene Fricke",
    "Email": "marlene.fricke@firma.example",
    "Phone": "+49 69 90009929"
  },
  "Line": [
    {
      "Item": "Kugelschreiber, Großpackung",
      "Quantity": 9,
      "Price": {
        "currency": "USD",
        "value": 11.25
      },
      "Tag": ["Bürobedarf"],
      "Packaging": {
        "Box": "M",
        "Weight": 0.9
      }
    }
  ],
  "Attachment": "vKj9m7z0fTqVy9o=",
  "Extensions": {
    "Note": {
      "value": "Gl <c:b xmlns:c=\"urn:example:common\">Bitte nutzen Sie den ausgewiesenen Weg durch den Garten.</c:b>"
    }
  }
}
```

XML and JSON come from one instance tree. Compare these parts:

- `Line` and `Tag` are arrays even with one item, because the schema allows repetition.
- `Express` and `Pickup` become booleans. Integer and decimal values, such as `Quantity` and `Weight`, become
  JSON numbers. `Wanted` is a union of month and date types; the supplied date remains a string.
- `Price` becomes an object with `currency` and numeric `value`, preserving its attribute and decimal text.
- `Note` preserves its mixed text and markup in `value`. The imported namespace remains visible in that markup.
  `Extensions` uses a lax wildcard, here filled by the available `c:Note` declaration.

The small catalogue contains cartons of paper, bulk packs of pens and cartons of folders. A line orders 1–10
packs, each priced between 5 and 50 in `EUR`, `USD` or `CHF`. A package weighs 0.1–5 kg, discounts range from
0 to 30 percent, and the order has at most five lines. Patterns constrain the order number, customer reference
and discount code. These are example business rules; see [Output](output.md) for the XML-to-JSON mapping.

### Generation flow

The CLI calls `generateSampleFiles` in `src/node.ts`. This uses `fileInput` to create a file source and passes
it to `generateSamples` in `src/index.ts`. For a single sample in your own code, `generateSampleFile` calls
`generateSample` with the same file source. Both paths use `prepare` and `generatePrepared` below.
By default, file reads are confined to the entry file's directory, which includes `common/` in this example.

1. **Loading.** `load` creates a `SchemaSet` (`src/xsd/schema-set.ts`) and loads `order.xsd`, `line.xsd` and
   `common/common.xsd`. Each file is decoded and checked for DOCTYPE declarations before parsing. The set retains
   the parsed source text so generation and validation use the same schema snapshot.
2. **Choosing the root.** `prepare` selects `Order`, the entry document's only global element. The imported
   `Note` is available to references and wildcards but does not make this root selection ambiguous. Use the
   `root` option when the entry declares several global elements.
3. **Walking.** `generatePrepared` runs the generation attempts. Each creates a `Walker` and calls `walker.root()`
   (`src/generate/walker.ts`). The walker builds the attributes and follows the sequence, choice and nested types.
   Its `FacetReader` (`src/xsd/facets.ts`) follows each simple type's derivation chain and combines constraints,
   such as the enumeration of `Currency` or the bounds and fraction digits of `Kilogram`.
4. **Values.** For this call, listed values in `samples` are tried first, then `localeValues('de')`
   (`src/values/locale/index.ts`). The locale uses `facetValues` (`src/values/source.ts`) for fields it cannot fill.
   `facetValues` calls `generateValue` (`src/values/generate.ts`), which checks candidates with `checkValue`.
   If the source returns `undefined`, the walker writes an empty value and records a `no-value`
   problem. Branch decisions use the strategies in `src/generate/choices.ts`.
5. **The instance tree.** The result is an `InstanceElement` (`src/xml/tree.ts`). Within the first `Line`,
   `Quantity` stores text with an integer type. `Price` keeps its attribute and decimal text together:

   ```text
   {"kind":"element","ns":"urn:example:order","name":"Quantity","attributes":[],
    "children":[{"kind":"text","value":"9","type":"integer"}],"repeatable":false}
   {"kind":"element","ns":"urn:example:order","name":"Price",
    "attributes":[{"ns":"","name":"currency","value":"USD","type":"string"}],
    "children":[{"kind":"text","value":"11.25","type":"number"}],"repeatable":false,"simpleContent":true}
   ```

   Text nodes keep their XML text and JSON type. The serializers can therefore preserve `11.25` as a decimal
   value while producing different XML and JSON shapes.

6. **Output.** `serializeXml` (`src/xml/serialize.ts`) and `toJson` (`src/json/serialize.ts`) write the same tree.
7. **Validation.** `judge` (`src/validate/xmllint.ts`) calls the validator and checks its result. The default is
   libxml2 compiled to WebAssembly. A custom validator must return one verdict per document, with a boolean
   `valid` and an array of error strings. A malformed result throws `TypeError`.
8. **Status.** In this validated instance mode, the sample is `valid` only if the validator accepts it **and**
   no generator problem has error severity. Otherwise, generation retries with the next seed, up to `attempts`
   (10 by default). `sample.seed` identifies the returned attempt. Operational errors, such as a validator
   exception, reject the call instead of triggering a retry.

To inspect `Price` yourself:

```sh
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { generateSampleFile } from './dist/node.js';
const samples = JSON.parse(readFileSync('examples/order/values.json', 'utf8'));
const sample = await generateSampleFile('examples/order/order.xsd', {
  seed: 7, locale: 'de', optionalElements: 'all', samples,
});
const line = sample.tree.children.find((c) => c.name === 'Line');
console.log(JSON.stringify(line.children.find((c) => c.name === 'Price')));
"
```

### Custom sample values

`ValueSource` in `src/values/source.ts` is the extension point for sample data. Its `value` method receives
facets, local names and the expanded type name. It returns a string, including for numeric types, or
`undefined` when it has no value. This ES module fixes the currency to `EUR` while keeping the German locale
and its fallback to facet generation:

```js
import { readFileSync } from 'node:fs';
import { firstOf, localeValues } from 'xsd-faker';
import { generateSampleFile } from 'xsd-faker/node';

const currencies = {
  value: (context) => (context.typeName === '{urn:example:common}Currency' ? 'EUR' : undefined),
};
const samples = JSON.parse(readFileSync('examples/order/values.json', 'utf8'));
const sample = await generateSampleFile('examples/order/order.xsd', {
  seed: 7,
  optionalElements: 'all',
  samples,
  values: firstOf(currencies, localeValues('de')),
});
console.log(sample.status, sample.json.Line[0].Price);
```

`firstOf` accepts the first candidate that satisfies the facets. Matching the expanded type name covers
`Currency` from the imported common schema wherever it is used. A custom `values` source replaces the
`locale` option, so locale generation is included explicitly in this composition. Other generated values
can change because the custom source consumes fewer random numbers.

A reusable source belongs in `src/values/` with its test; `lists.ts` and `lists.test.ts` are existing examples.
The public generation entry points and real validator are covered by `test/acceptance.test.mjs`.

### Diagnostics

`status` is the generation result. `problems` contains generator diagnostics and their severity; `errors`
contains the validator's messages. For example, a direct source that returns `'75.00'` for `Price`, without
`firstOf` or `samples` to check the candidate, produces `status: 'invalid'`. With seed 7 and the default
10 attempts, the returned seed is 16 and the validator reports:

```text
Schemas validity error : Element '{urn:example:order}Price': [facet 'maxInclusive'] The value '75.00' is greater than the maximum value allowed ('50').
```

The element name and facet identify the failed constraint. A reduced case needs only `Price` and its bound,
not the order's contact or delivery choice. Value generation is tested in `src/values/generate.test.ts`,
content traversal in `src/generate/walker.test.ts`, and behaviour across a complete document in the acceptance
suite.

A positive validator verdict alone does not make a sample valid. If a source returns no value for `Phone`,
the empty string still satisfies its type, `xs:string`. The validator accepts it, but the generator records
`no-value`: `sample.valid` is `true` and `sample.status` is `incomplete`. The API reference describes all
[result states](api.md#result).

## Checks

```sh
npm run typecheck
npm run lint
npm run build
npm test
npm run test:acceptance
npm run format:check
npm run verify
```

`npm run verify` runs typecheck, typed ESLint checks, build, unit tests and acceptance tests in that
order. Typecheck and build compile the locale package first, because the library imports its declarations.
The `src/**/*.test.ts` and `packages/*/src/**/*.test.ts` suites use Vitest. They cover the parser, random
source, facets, walker, alternatives, ID planning, the DOCTYPE profile, redefine, size limits, value lists,
locales, serialization, validation and invalid samples. `test/rules/` holds one minimal schema per rule of
the invalid samples. `src/mutate/gold.test.ts` checks that the pinned version of xmllint-wasm confirms every
sample, catching changes in diagnostic wording that could affect classification. The
`XSD_CORPUS` suite runs only when that variable names a directory of schemas; otherwise no corpus tests
are registered. Each generated corpus sample must have `status: 'valid'`, not just a positive validator
verdict.

`test/acceptance.test.mjs` uses Node's test runner against the public entry points in `dist/` and the
regular WASM validator. Build before running `node --test test/acceptance.test.mjs` directly. It covers
paired output, branch strategies, limits, filesystem access, CLI exit codes
and the synthetic examples. It does not use mocks for successful XSD validation. Some rejection tests
inject a failing validator to test error handling.

ESLint uses the recommended TypeScript rules with type information. `npm run lint:fix` applies
automatic fixes; Prettier handles formatting separately.

## Adding a feature

Start with the smallest XSD showing the missing behaviour. Include a valid and invalid instance, and
make the expected result clear without reading the implementation. Add a focused unit test and, where
it affects generated output, an acceptance case checked by the XSD validator.

Keep changes in the module that owns the rule. A new `ValueSource` is usually enough for different
sample data; a plugin framework is not needed. Changes to JSON projection need tests for collisions and
numeric preservation, not just a snapshot. Changes to retries must preserve the returned seed and
must not turn operational failures into successful validation.

## Package check

```sh
npm run verify
npm run format:check
npm pack --dry-run
npm run test:consumer
npm pack
npm pack --workspace packages/locales
```

`npm run test:consumer` does the consumer check below automatically: it packs both packages from a clean copy of the
sources, installs only the two tarballs into an empty project and generates XML there with the default validator,
runs the command and compiles a TypeScript consumer. CI runs it on every supported Node version.

Both packages build themselves when packed, so a clean checkout after `npm ci` gives complete tarballs. Install
the pair, `xsd-faker` and `xsd-faker-locales`, into a separate consumer project. Use the exported package paths,
not imports from `src/`. Verify XML generation with the default validator on the supported Node
versions. The package includes `dist/`, public documentation, synthetic examples, `LICENSE` and the npm manifest.
Test sources are excluded.

Publishing is not part of these scripts. Before a release, check the package name, repository metadata
and version. Publish `xsd-faker-locales` first: `xsd-faker` depends on it, and its install fails until a matching
version of the locale package is on the registry.
