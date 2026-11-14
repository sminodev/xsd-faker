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
  generate/walker.ts   XSD traversal and choice strategies
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
npm pack
npm pack --workspace packages/locales
```

Both packages build themselves when packed, so a clean checkout after `npm ci` gives complete tarballs. Install
the pair, `xsd-faker` and `xsd-faker-locales`, into a separate consumer project. Use the exported package paths,
not imports from `src/`. Verify XML generation with the default validator on the supported Node
versions. The package includes `dist/`, public documentation, synthetic examples, `LICENSE` and the npm manifest.
Test sources are excluded.

Publishing is not part of these scripts. Before a release, check the package name, repository metadata
and version. Publish `xsd-faker-locales` first: `xsd-faker` depends on it, and its install fails until a matching
version of the locale package is on the registry.
