# Development

Use Node.js 22.12 or later and `npm ci`. The package is TypeScript compiled to ES modules with `tsc`.
The only runtime dependencies are `@xmldom/xmldom` and `xmllint-wasm`.

## Source layout

```text
src/
  index.ts             public generation API, results, roots and bounded batches
  node.ts              local file reader and directory boundary
  cli.ts, bin.ts       command implementation and process entry point
  options.ts           runtime checks for public options
  xsd/                 schema loading, facets, diagnostics and regex translation
  regex/               pattern parser and bounded string generation
  values/              facet values, composition and small synthetic profiles
  generate/walker.ts   XSD traversal and choice strategies
  xml/                 ordered instance tree and XML serialization
  json/serialize.ts    compact/tree JSON projection
  validate/xmllint.ts  explicit libxml2 verdicts
```

The flow is `load → choose root → walk → serialize → validate`. Profiles only suggest values. They do
not change cardinality, choices, namespaces or the schema itself. The instance tree is the shared
boundary between XML and JSON; do not add a second generator for the JSON path.

## Checks

```sh
npm run typecheck
npm run build
npm test
npm run test:acceptance
npm run format:check
npm run verify
```

`npm run verify` runs typecheck, build, unit tests and acceptance tests in that order. The
`src/**/*.test.ts` suite uses Vitest. It covers the parser, random source, facets, walker,
serialization and validation. The `XSD_CORPUS` suite runs only when that variable names a directory of
schemas; otherwise no corpus tests are registered. Each generated corpus sample must have
`status: 'valid'`, not just a positive validator verdict.

`test/acceptance.test.mjs` uses Node's test runner against the public entry points in `dist/` and the
regular WASM validator. Build before running `node --test test/acceptance.test.mjs` directly. It covers
paired output, branch strategies, limits, filesystem access, CLI exit codes
and the synthetic examples. It does not use mocks for successful XSD validation. Some rejection tests
inject a failing validator to test error handling.

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
npm pack
```

Inspect the tarball and install it into a separate consumer project. Use the exported package paths,
not imports from `src/`. Verify XML generation with the default validator on the supported Node
versions. The package includes `dist/`, public documentation, synthetic examples, `LICENSE` and the npm manifest.
Private reviews, test sources and working notes are excluded.

Publishing is not part of these scripts. Before a release, check the package name, repository metadata
and version.
