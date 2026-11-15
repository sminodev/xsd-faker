# xsd-faker

Generate XML and JSON test fixtures from XML Schema 1.0.

Give it an entry XSD; if the entry declares several root elements, select one explicitly. It follows local
imports and includes, builds an instance tree, chooses values from the schema's constraints, and checks
the XML with libxml2. XML and JSON output come
from the same tree, so a paired fixture contains the same generated values.

Use it for tests and integration examples. It covers a documented XSD subset, not every
schema. A returned sample is not automatically valid: check its `status` and diagnostics.

## Quick start

Requires Node.js 22.13 or later. Install the package in your project:

```sh
npm install xsd-faker
```

The package provides ES module entry points, TypeScript declarations and the `xsd-faker` command.

To try the examples from a clone of the repository:

```sh
npm ci
npm run build
node dist/bin.js examples/retail/order.xsd \
  --locale en --optional-elements all --optional-attributes all \
  --format both --out-dir samples
```

This creates `samples/sample-0001.xml`, `samples/sample-0001.json` and `samples/manifest.json`.
The output directory must not already exist. XML is validated before the CLI writes an instance.

## Library usage

Run this example from the repository root after building. In another project, replace the example
path with your own XSD path; the package also includes examples under `node_modules/xsd-faker/examples/`.

```js
import { generateSampleFile } from 'xsd-faker/node';

const sample = await generateSampleFile('examples/retail/order.xsd', {
  seed: 7,
  locale: 'en',
  optionalElements: 'all',
  optionalAttributes: 'none',
  repeat: 2,
  choice: 'smallest',
});

if (sample.status !== 'valid') {
  throw new Error(JSON.stringify({ status: sample.status, errors: sample.errors, problems: sample.problems }));
}

console.log(sample.xml);

if (sample.jsonStatus === 'generated') {
  console.log(JSON.stringify(sample.json, null, 2));
} else {
  console.error(sample.problems);
}
```

`generateSample()` accepts schema texts or a synchronous reader instead of reading files. `listRoots()`
and `listRootsFile()` list global declarations, including their namespace and source file.
See [the API](docs/api.md) for those forms and batch generation.

`status: 'valid'` means that the XML passed the configured XSD validator and the generator reported no
error-level diagnostics. Generation calls can also reject, for example on loading errors, invalid
options or resource limits; see the [error contract](docs/api.md#errors). It does not mean that the JSON
was checked against a JSON Schema or that the fixture satisfies business rules outside the XSD.

## Choose what to generate

```sh
# Discover roots before choosing one.
npx xsd-faker examples/retail/order.xsd --list-roots

# Generate several separate instances and explore choice branches.
npx xsd-faker examples/insurance/claim.xsd --locale en \
  --count 6 --coverage --format both --out-dir claim-samples

# Create a developer template containing every choice branch.
npx xsd-faker examples/retail/order.xsd --template --choice all \
  --optional-elements all --optional-attributes all --out-dir order-templates
```

Instance mode selects one branch per occurrence of `xs:choice`. Template mode may include incompatible
branches. With `--out-dir`, files are named `sample-NNNN.template.xml`; templates are never
reported as valid test instances. With `--out` or stdout, the CLI warns on stderr instead of choosing a filename.
Use a listed `expandedName` as `--root` to select an imported root.
Coverage mode produces separate documents. Its report describes encountered choices, not every possible
path or combination in the schema.

An incomplete coverage run writes its valid samples but exits with code 2. Use a new output directory
when trying a larger batch.

Run `npx xsd-faker --help` for all options. The [generation rules](docs/generation.md) explain defaults,
recursion limits, repetitions and validation results.

## Sample values

By default, values are generated from the schema's facets. A locale supplies readable names, addresses,
dates, contact details and free text for recognized fields. The built-in locales are `de` and `en`; the
[locale guide](docs/locales.md) explains field recognition and how to add a locale. Dates are relative to
`referenceDate`, which defaults to `2026-01-15T12:00:00Z`, so generation does not depend on today's date.

Use value lists for domain-specific data, such as product or diagnosis codes. Each key is a path of
local names or the name of a simple type:

```js
import { generateSampleFile } from 'xsd-faker/node';

const sample = await generateSampleFile('examples/retail/order.xsd', {
  seed: 7,
  locale: 'en',
  samples: {
    '/Order/Title': ['Integration test order'],
    Currency: ['EUR', 'CHF'],
  },
});
```

Values from these lists and from a locale must still meet the supported facets. `fixed` and `default` values
on generated declarations take precedence. For more control, supply a `ValueSource`; see
[custom values](docs/api.md#custom-values).

## JSON output

The default compact form uses local names as property names, typed numbers and booleans, arrays for
repeatable elements and list values, arrays of objects for repeating groups, and `value` for complex
types with simple content. Nil elements are `null`, or an object with attributes and `value: null`.
An element with `xsi:type` names its type in `#type`. Wildcard content and elements of `xs:anyType`
without `xsi:type` are mapped without the schema.

Names that collide in the content model use qualified keys: `{namespace}local` for elements from several
namespaces, `@local` for an attribute named like an element. The text property is reserved in every object. `INF`,
`-INF` and `NaN` are strings. Collisions that cannot be resolved from the content model and unsafe
numeric conversions make compact JSON unavailable; see [JSON output](docs/output.md).

Use `json: { mode: 'tree' }` or `--json-mode tree` when names, child order and lexical values matter.
Use `json: { numbers: 'string' }` when consumers need decimal values as strings. These are different
contracts, not interchangeable representations. See [JSON output](docs/output.md).

## Invalid samples

`xsd-faker invalid` writes documents a consumer must reject. Each is a valid sample changed to break one rule of
the schema, such as a value outside a facet, a missing element or an unknown attribute. Validation diagnostics
are checked to confirm that the document violates the intended rule. Confirmed samples are written as files;
`manifest.json` lists every sample with its status:

```sh
npx xsd-faker invalid examples/retail/order.xsd --out-dir order-invalid --count 3 --coverage --seed 7
```

`generateInvalidSamples` does the same in code. [Invalid samples](docs/invalid.md) lists the rules, the status
of a sample and the limits.

## Examples

[Retail](examples/retail), [insurance](examples/insurance) and [logistics](examples/logistics) include XSD
inputs and paired example files. The retail example uses imports, includes, groups, inheritance,
repeated elements, mixed content and wildcards. [Examples](examples/README.md) shows how to generate them.

## Development

```sh
npm run typecheck
npm run lint
npm run build
npm test
npm run test:acceptance
npm run format:check
```

[Development](docs/development.md) describes the modules and tests.
[Contributing](CONTRIBUTING.md) explains how to add a focused change.
[Security](SECURITY.md) documents the input boundary, the DOCTYPE profile and the schema size limits
(`limits`, `--max-file-bytes`, `--max-total-bytes`, `--max-documents`).

## License

[MIT](LICENSE)
