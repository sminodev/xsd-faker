# API

The package exports `generateSample`, `generateSamples`, `listRoots`, `generateInvalidSamples`, serializers and
value-source helpers, and the building blocks of [invalid samples](invalid.md#building-blocks). `xsd-faker/node`
adds `generateSampleFile`, `generateSampleFiles`, `listRootsFile` and `fileInput`.
The generated declarations in `dist/` are the complete TypeScript reference. File examples below run
from the repository root after `npm run build`; use your own schema paths in a consumer project.

## In-memory input

```js
import { generateSample } from 'xsd-faker';

const sample = await generateSample(
  {
    entry: 'main.xsd',
    files: {
      'main.xsd': `
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="Count" type="xs:positiveInteger"/>
      </xs:schema>`,
    },
  },
  { seed: 7 },
);

if (sample.status !== 'valid') {
  throw new Error(JSON.stringify({ status: sample.status, errors: sample.errors, problems: sample.problems }));
}
console.log(sample.xml);
if (sample.jsonStatus === 'generated') console.log(sample.json);
else console.error(sample.problems);
```

`files` can be a synchronous `(path: string) => string | undefined` reader. Relative imports resolve
against the importing document, not the process working directory. Each loaded text is snapshotted:
the validator receives the same text the generator parsed, not a second read from a changing source.
Missing files, unsafe inputs and loader errors reject with `GenerateError`.

The in-memory API does not itself read the filesystem. Browser bundling and the browser-specific WASM
adapter are not part of the tested Node.js contract.

## Roots

```js
import { listRootsFile } from 'xsd-faker/node';
const { roots, problems } = listRootsFile('examples/retail/order.xsd');
if (problems.length) console.warn(problems);
console.log(roots);
```

Each root has `name`, `namespace`, `expandedName`, `file`, `abstract` and `entryDocument` fields.
Discovery includes imported global declarations. Automatic selection uses a single declaration in the
entry document; otherwise provide `root`. Explicit roots accept a local name in the entry namespace,
a prefix declared on the entry schema, or an expanded name such as `{urn:example:order}Order`.
An abstract declaration appears in this list but cannot be generated as the root; generate an element that
refers to it, and a member is chosen.

## Options

| Option                           | Default                  | Meaning                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root`                           | single entry declaration | Global root to generate                                                                                                                                                                                                                |
| `seed`                           | `1`                      | First seed; failed attempts advance it                                                                                                                                                                                                 |
| `optional`                       | `none`                   | Shorthand for both optional-node settings                                                                                                                                                                                              |
| `optionalElements`               | `optional`               | `none`, `all` or `random`                                                                                                                                                                                                              |
| `optionalAttributes`             | `optional`               | Independent optional attribute setting                                                                                                                                                                                                 |
| `nil`                            | `never`                  | `random` writes nillable elements as `xsi:nil="true"` with chance one half; `never` draws no random numbers                                                                                                                            |
| `repeat`                         | `1`                      | Desired occurrences, bounded by XSD minimum and maximum                                                                                                                                                                                |
| `choice`                         | `first`                  | `first`, `smallest`, `random`, `{ prefer: [...] }`, or a strategy function                                                                                                                                                             |
| `reach`                          | none                     | Paths the document has to contain, such as `/{urn:o}Order/{urn:o}Line[2]/@{}id`; see [Paths](#paths)                                                                                                                                   |
| `maxDepth`                       | `12`                     | Optional-element expansion depth; root is depth zero. Must be lower than `maxTotalDepth`; without it, the default is lowered below `maxTotalDepth`                                                                                     |
| `maxTotalDepth`                  | `64`                     | Hard depth limit, including required elements                                                                                                                                                                                          |
| `maxNodes`                       | `10000`                  | Hard element-count limit                                                                                                                                                                                                               |
| `attempts`                       | `10`                     | Maximum candidate documents per call, at most 100                                                                                                                                                                                      |
| `mode`                           | `instance`               | `instance` or `template`; `choice: 'all'` needs template mode                                                                                                                                                                          |
| `validate`                       | `true`                   | XML validation; template mode always remains unvalidated                                                                                                                                                                               |
| `validator`                      | libxml2/WASM             | Explicit alternative XML validator callback                                                                                                                                                                                            |
| `values`                         | facet generator          | Custom value source; replaces `locale`                                                                                                                                                                                                 |
| `locale`                         | none                     | Locale values: a tag such as `de` or `en`, or a locale from `defineLocale`; see [Locales](locales.md)                                                                                                                                  |
| `referenceDate`                  | `2026-01-15T12:00:00Z`   | The day a locale counts dates from                                                                                                                                                                                                     |
| `localeFields`                   | none                     | The field a locale fills, by path or type name; `null` leaves a value to the facets; see [Locales](locales.md#fields)                                                                                                                  |
| `samples`                        | none                     | Value lists keyed by local-name paths or type names; tried before every other source                                                                                                                                                   |
| `json`                           | compact projection       | `false` disables JSON; otherwise `JsonOptions`                                                                                                                                                                                         |
| `indent`                         | two spaces               | XML indentation, up to eight spaces/tabs                                                                                                                                                                                               |
| `schemaLocation`                 | none                     | Root schema-assignment hint                                                                                                                                                                                                            |
| `prefixes`                       | schema prefixes          | Namespace URI to preferred prefix                                                                                                                                                                                                      |
| `fillElements`, `fillAttributes` | `true`                   | Setting either to false requires template mode                                                                                                                                                                                         |
| `limits`                         | see meaning              | Schema input limits `{ maxFileBytes, maxTotalBytes, maxDocuments }`, defaults 4194304, 16777216 and 128; positive safe integers only. Also accepted by `listRoots` and the file API, which checks `maxFileBytes` before reading a file |

`DEFAULT_LIMITS` holds the default limits. A schema reader of your own returns the text, or `{ text, bytes }`
(`SchemaText`) to have the limits count the bytes of its file. It can throw `SchemaLimitError` for a file that is
too large (`resource-limit`), `UnsafeLocationError` for a location it must not read (`unsafe-input`) and
`SchemaEncodingError` for bytes it cannot decode (`invalid-xml` or `unsupported-encoding`); any other error is
`missing-file`.

`choice: 'smallest'` selects the branch with the fewest expected elements under the current options,
resolving groups and type inheritance. Occurrences follow `repeat` within the XSD bounds. Optional
particles count fully with `optionalElements: 'all'`, not at all with `'none'`, and by half with
`'random'`, its inclusion chance. From `maxDepth` on they count zero because they are not generated
there, so optional recursion has a finite cost; required recursion has infinite cost. A nested choice
counts with its own smallest branch. Ties keep declaration order. Attributes and text are not counted,
and the estimate is not a schema satisfiability solver. A strategy function receives the same inputs:
the choice element, its branches, the element path, the schema set, the seeded random source, `depth`
and `settings` (`optionalElements`, `repeat`, `maxDepth`, `maxTotalDepth`), so it can delegate to
`smallestBranch`. Strategies also decide substitution groups and `xsi:type`; `kind` tells them apart:

| `kind`         | `node`                                    | `branches`                                                       | `depth`                      |
| -------------- | ----------------------------------------- | ---------------------------------------------------------------- | ---------------------------- |
| `choice`       | the `xs:choice`                           | its particles that may occur                                     | element holding the choice   |
| `substitution` | the `xs:element` particle naming the head | global element declarations, the head first unless abstract      | element holding the particle |
| `type`         | the element declaration                   | complex type definitions, the declared one first unless abstract | the element itself           |

`smallest` counts a substitution group or a set of types with its smallest alternative.
`{ prefer: [...] }` selects the first declared branch mentioning any listed name, a member by its name and a
type by its name, with `first` as fallback; the list is not a priority ordering.
An unavailable value or a mandatory recursive path can still prevent generation.

The CLI uses the same generation defaults. Its differently named flags map as follows:

| CLI flag                                                   | API option / manifest key                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `--optional-depth`                                         | `maxDepth`                                                           |
| `--max-depth`                                              | `maxTotalDepth`                                                      |
| `--values`                                                 | `samples` (JSON file contents)                                       |
| `--date`                                                   | `referenceDate`                                                      |
| `--base-dir`                                               | `baseDirectory` (file access only)                                   |
| `--max-file-bytes`, `--max-total-bytes`, `--max-documents` | `limits.maxFileBytes`, `limits.maxTotalBytes`, `limits.maxDocuments` |
| `--schema-location none\|relative\|absolute`               | `schemaLocation` (resolved path, or omitted for `none`)              |
| `--reach` (repeatable)                                     | `reach`                                                              |

The manifest records the generation options as given; `locale` appears in it only when `--locale` is set.

`values` replaces the locale; `samples` is tried before either source. To compose more sources, use
`firstOf`. `referenceDate` only affects a locale. `coverage: true`
uses its own choice strategy and overrides `choice`; decisions fixed by `reach` stay fixed. CLI JSON settings have no effect with `--format xml`.

## Errors

Generation functions return promises. Loading errors, unsafe inputs, missing or ambiguous roots and
`maxNodes` exhaustion reject with `GenerateError`, whose `problems` carry diagnostics. Invalid options
reject with `RangeError` or `TypeError`. Invalid schemas rejected by libxml2 produce `SchemaCompileError`;
validator execution failures and errors thrown by custom callbacks also reject. Use `try`/`catch`
around `await` when your application needs to recover. `fileInput` and root discovery are synchronous:
file setup errors throw; discovery diagnostics are returned in `problems`.

These rejections are distinct from a returned unsuccessful sample. For example, exceeding
`maxTotalDepth` returns `incomplete` with `depth-limit`; exceeding `maxNodes` rejects immediately.

### Problem codes

Each problem has a `code`, a `severity` and a message. An error prevents a completed status; when it comes from
loading, from the root or from a resource limit, the call rejects with `GenerateError` and returns neither schema
nor document. A warning describes a limitation and leaves the status alone.

| Code                                                                    | Severity         | Meaning                                                                                                                                    |
| ----------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `missing-file`                                                          | error            | A schema document could not be found or read, or names a URI other than `file:`                                                            |
| `invalid-xml`                                                           | error            | A schema document is not well-formed XML, has bytes that do not decode, a second byte order mark or text before its XML declaration        |
| `unsupported-encoding`                                                  | error            | A schema file declares an encoding other than UTF-8, UTF-16, ISO-8859-1 or US-ASCII                                                        |
| `unsafe-input`                                                          | error            | A location outside the boundary, or a DOCTYPE or entity outside the inert profile; nothing of it is read                                   |
| `neutralized-doctype`                                                   | warning          | An inert DOCTYPE was left out before parsing and validation                                                                                |
| `resource-limit`                                                        | error            | A size limit of the schema input, `maxNodes`, or nesting deeper than the generator can follow                                              |
| `not-a-schema`                                                          | error            | The root of a schema document is not `xs:schema`                                                                                           |
| `namespace-mismatch`                                                    | error            | An import, include or redefine does not match the target namespace of the document it reads                                                |
| `duplicate-component`                                                   | error            | Two documents define the same global component                                                                                             |
| `unknown-prefix`                                                        | error            | A QName uses a prefix that is not declared                                                                                                 |
| `unsupported-redefine`                                                  | error            | `xs:redefine` of a simple or complex type, or `xs:override`                                                                                |
| `invalid-redefine`                                                      | error            | A redefined group refers to itself more than once, or with other occurrences than one                                                      |
| `root-required`                                                         | error            | The entry document declares several global elements and no `root` was given                                                                |
| `unknown-root`                                                          | error            | The requested `root` is not a global element of the schema set                                                                             |
| `unknown-element`, `unknown-attribute`, `unknown-group`, `unknown-type` | error            | A reference names no declaration or definition                                                                                             |
| `circular-group`                                                        | error            | A group or attribute group contains itself                                                                                                 |
| `circular-type`                                                         | error            | A type derives from itself, also through `xs:list itemType` or a union member                                                              |
| `invalid-facet`                                                         | error            | A facet value is not valid for its facet                                                                                                   |
| `depth-limit`                                                           | error            | Required content nests deeper than `maxTotalDepth`                                                                                         |
| `no-value`                                                              | error            | No value satisfies the facets within the bounded attempts                                                                                  |
| `unsupported`                                                           | error or warning | A construct the generator cannot produce (error), or a bound it does not plan and leaves to validation (warning)                           |
| `identity-planning`                                                     | error or warning | An ID or reference that cannot be planned or resolved (error); identity constraints, entities and notations that are not planned (warning) |
| `template-only`                                                         | warning          | Template output, not an accepted test instance                                                                                             |
| `json-mapping`                                                          | warning          | The compact JSON form is unavailable for this sample; the XML stays valid                                                                  |
| `unreachable-path`                                                      | warning          | A path of `reach` that the document does not contain                                                                                       |

## Result

Inspect `status`, `errors` and `problems` before using a result:

| Status        | Meaning                                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| `valid`       | XML validation passed and generation has no error-level diagnostics               |
| `invalid`     | The XSD validator rejected the XML after the bounded attempts                     |
| `incomplete`  | Generation reported an error, such as an unresolved required value or depth limit |
| `unvalidated` | Validation was explicitly disabled; no validity claim                             |
| `template`    | Developer template; no validity claim                                             |

`valid` is the XML validator's boolean verdict, or `undefined` when not run. Use `status`, not just the
presence of `xml`, as the generation result. `valid` can be true while `status` is `incomplete`,
for example when an unresolved value happens to leave a schema-valid empty string. Operational validator
failures reject the promise instead
of being returned as a successful sample. A custom validator must return one explicit verdict per input.

`jsonStatus` is `generated`, `unavailable` or `not-requested`. A JSON collision does not make otherwise
valid XML invalid: it makes the compact JSON unavailable. The CLI refuses a request for JSON or paired
output when that projection is unavailable. `jsonStatus: 'generated'` is not JSON Schema validation.

`seed` identifies the returned attempt. `attempts` counts candidate documents, and `choices` records
the selected branches by stable schema location. Reproduction requires the same input texts, options,
package version and deterministic callbacks, not only the seed.

## Custom values

```js
import { firstOf, valueLists, localeValues } from 'xsd-faker';
import { generateSampleFile } from 'xsd-faker/node';

const source = firstOf(
  valueLists({ '/Order/Contact/Email': ['orders@example.invalid'] }),
  localeValues('de', { referenceDate: '2026-01-15T12:00:00Z' }),
);
const sample = await generateSampleFile('examples/retail/order.xsd', { values: source, seed: 7 });
```

`firstOf` checks candidates against the supported simple-type facets before accepting them. A raw
`ValueSource` is also allowed; its output is checked by final document validation rather than assumed
correct. Failed candidates can consume a later seed. Do not use nondeterministic callbacks when fixtures
must be reproducible. `fixed` and `default` values on generated declarations bypass the source.

`localeValues(locale, { referenceDate, fields })` falls back to facet values itself, so it can end a `firstOf`
chain. `xsd-faker` also exports everything of the locale package it installs: `defineLocale`, `extendLocale`,
`localeFromFaker`, the locales `de` and `en` and the locale types; `LOCALES` holds the built-in locales by tag and
`FIELD_KEYS` lists the fields.

A value-list key that starts with `/` is a local-name path, not XPath; `/Order/@version` identifies an
attribute. `{namespace}local` names a simple type with its namespace, and any other key names a type by its
local name. A value is looked up under its path, then its own type, then each type it derives from, nearest
first; a key whose values all fail the facets passes on to the next one. A type key covers every place the
type is used, also through an anonymous restriction of it:

```js
const sample = await generateSampleFile('claim.xsd', {
  samples: { DiagnosisCode: ['J06.9', 'M54.5', 'R51'], '/Claim/@status': 'open' },
});
```

A `ValueSource` receives a `ValueContext`: the `facets`, the local `name`, the `path` of local names, the
`kind` (`element` or `attribute`) and the seeded `rng`. `typeName` is the expanded name `{namespace}local`
of a named type, absent for an anonymous or built-in one, and `baseTypeNames` lists the named types it
derives from, nearest first. `scopes` lists the elements of complex type around the value, outermost first,
each with its `name`, `path`, an `instanceId` that is new for every occurrence, and a `state` map where a
source can keep what belongs to that occurrence, such as one person for all name fields of a `Person`
element. For an attribute and for simple content, the element that holds the value comes last.

## Batch and branch coverage

```js
import { generateSampleFiles } from 'xsd-faker/node';

const batch = await generateSampleFiles('examples/insurance/claim.xsd', {
  count: 12,
  coverage: true,
  optionalElements: 'all',
  seed: 7,
});

for (const sample of batch.samples) {
  if (sample.status !== 'valid') {
    throw new Error(JSON.stringify({ status: sample.status, errors: sample.errors, problems: sample.problems }));
  }
  if (sample.jsonStatus !== 'generated') console.error(sample.problems);
}
console.log(batch.coverage);
```

`count` is a hard bound from 1 to 1000. Coverage with template mode or `validate: false` rejects with
`TypeError`. Each batch sample starts after the previous sample's returned seed, including failed
attempts. Coverage prefers branches not yet accepted in validated XML, the less-tried one first. Among
accepted branches it prefers the one leading to the most open branches of decisions already encountered
below it, then the less-tried one. Ties keep declaration order; the strategy uses no randomness. Failed
attempts do not count as covered. A branch not yet accepted that was part of two failed attempts yields
to the other open branches, and to accepted branches leading to them, then is tried again; once accepted,
it is treated like any other branch. A failed document does not show which branch caused the failure, so
this changes only the order of attempts: the branch stays in `total` and in `uncovered`, and is never
reported as unreachable. The report's scope is `encountered-choices`:
optional content omitted from generation, unreachable types and combinations of branches are not
claimed as covered. `complete` means at least one document was accepted and all branches of the
encountered choices were accepted at least once. A batch without an accepted document is never
complete. Inspect `total` as well: an accepted document with no encountered choices is complete with
`total: 0`, which is no choice evidence.

Choices include substitution groups and the types `xsi:type` can name: each allowed member or concrete
type is a branch of the decision where it was encountered. A decision with a single alternative, such as an
abstract type with one concrete derived type, has nothing to cover. For these decisions, `sample.choices`
entries carry `kind` (`substitution` or `type`) and `alternatives`, the expanded names of all
alternatives, and `uncovered` entries carry `kind` and the `alternative` that is still open. Coverage
names reached places in the schema and their alternatives, not combinations or value ranges.

A choice is identified by its place in the schema, not by the element path that reaches it. A choice in
a named type or group that several elements use therefore counts once. For example, if `Customer` and
`Supplier` both have the type `Party`, whose content chooses `Street` or `POBox`, a sample with
`Customer/Street` and another with `Supplier/POBox` complete that choice; `Customer/POBox` need not
appear in any sample.

## Paths

`reach` takes paths the document has to contain. Along each path, the generator takes the optional elements that
lead to it, the branch of each choice, the member of a substitution group and the `xsi:type` alternative that
lead to the next step, and as many occurrences as its position asks for. An optional attribute at the end of a
path is written. Elsewhere `optional*`, `choice` and `repeat` decide as usual:

```js
const sample = await generateSampleFile('examples/retail/order.xsd', {
  reach: ['/{urn:example:order}Order/{urn:example:order}Line[2]/{urn:example:order}Packaging'],
});
```

A step is `{ns}local`, `{}local` for no namespace, or a bare `local` that matches any namespace, as in the paths
of `samples`; `@` marks an attribute, which only the last step may name, and `[n]` the position among siblings of
that name, from 1. A path the schema does not allow gives the warning `unreachable-path`, and the document is
generated without it. Without `reach`, no random number is drawn differently.

With `coverage`, the decisions along the paths are fixed and coverage plans only the others. A fixed decision
appears in `sample.choices` with `fixed: true` and counts neither as covered nor as open, so `complete` speaks for
the other decisions. To cover the branches inside a request but never the response next to it:

```js
const batch = await generateSampleFiles('message.xsd', {
  count: 4,
  coverage: true,
  reach: ['/{urn:example:message}Message/{urn:example:message}Request'],
});
```

## Invalid samples

`generateInvalidSamples(input, options)` changes valid samples so that each breaks one rule of the schema and
returns them with the validator's judgement; [Invalid samples](invalid.md) describes the rules, the status of a
sample, the limits and the manifest of `xsd-faker invalid`.

The parts of the matrix are exported on their own; [Building blocks](invalid.md#building-blocks) describes them:

| Export                                                                       | What it does                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `RULES`                                                                      | the rules in their order; types `Rule`, `ValueRule`, `NilRule`, `IdentityRule`   |
| `parseExpandedPath`, `formatExpandedPath`                                    | read and write the text form of a path; types `ExpandedPath`, `ExpandedStep`     |
| `generateViolatingValue`                                                     | a value that breaks one facet of `ValueFacets` and keeps the others              |
| `applyTreeMutation`                                                          | one change to a copy of an instance tree, with the elements and lines around it  |
| `classifyVerdict`, `parseDiagnostic`                                         | the status of a changed document from the validator's messages, one message read |
| `mapNamespaces`                                                              | a copy of an instance tree in other namespaces                                   |
| types `InvalidMatrix`, `InvalidSample`, `NotConstructible`, `InvalidOptions` | the result and the options of `generateInvalidSamples`                           |

`validateXml` judges many documents against one compiled schema: it validates them in batches and gives each
document its own verdict, with the messages a run of that document alone would give. Where the output of a batch
cannot be attributed to its documents, each document is validated alone.

## Filesystem boundary

The file API confines access to the entry directory by default, including after resolving symlinks.
For sibling schema folders, set `baseDirectory` to their common parent. The entry must also be within it.
The in-memory API can map externally named imports to explicit local texts without downloading them.
