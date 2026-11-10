# API

The package exports `generateSample`, `generateSamples`, `listRoots`, serializers and value-source
helpers. `xsd-faker/node` adds `generateSampleFile`, `generateSampleFiles`, `listRootsFile` and `fileInput`.
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
An abstract declaration appearing in this list is not a promise of substitution-group support.

## Options

| Option                           | Default                  | Meaning                                                                                                                                            |
| -------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root`                           | single entry declaration | Global root to generate                                                                                                                            |
| `seed`                           | `1`                      | First seed; failed attempts advance it                                                                                                             |
| `optional`                       | `none`                   | Shorthand for both optional-node settings                                                                                                          |
| `optionalElements`               | `optional`               | `none`, `all` or `random`                                                                                                                          |
| `optionalAttributes`             | `optional`               | Independent optional attribute setting                                                                                                             |
| `repeat`                         | `1`                      | Desired occurrences, bounded by XSD minimum and maximum                                                                                            |
| `choice`                         | `first`                  | `first`, `smallest`, `random`, `{ prefer: [...] }`, or a strategy function                                                                         |
| `maxDepth`                       | `12`                     | Optional-element expansion depth; root is depth zero. Must be lower than `maxTotalDepth`; without it, the default is lowered below `maxTotalDepth` |
| `maxTotalDepth`                  | `64`                     | Hard depth limit, including required elements                                                                                                      |
| `maxNodes`                       | `10000`                  | Hard element-count limit                                                                                                                           |
| `attempts`                       | `10`                     | Maximum candidate documents per call, at most 100                                                                                                  |
| `mode`                           | `instance`               | `instance` or `template`; `choice: 'all'` needs template mode                                                                                      |
| `validate`                       | `true`                   | XML validation; template mode always remains unvalidated                                                                                           |
| `validator`                      | libxml2/WASM             | Explicit alternative XML validator callback                                                                                                        |
| `values`                         | facet generator          | Custom value source                                                                                                                                |
| `profile`                        | none                     | `generic`, `retail`, `insurance`, `logistics`                                                                                                      |
| `locale`                         | `en`                     | Profile vocabulary; also accepts `de`                                                                                                              |
| `referenceDate`                  | fixed profile date       | Date used by a selected profile                                                                                                                    |
| `samples`                        | none                     | Value lists keyed by local-name paths                                                                                                              |
| `json`                           | compact projection       | `false` disables JSON; otherwise `JsonOptions`                                                                                                     |
| `indent`                         | two spaces               | XML indentation, up to eight spaces/tabs                                                                                                           |
| `schemaLocation`                 | none                     | Root schema-assignment hint                                                                                                                        |
| `prefixes`                       | schema prefixes          | Namespace URI to preferred prefix                                                                                                                  |
| `fillElements`, `fillAttributes` | `true`                   | Setting either to false requires template mode                                                                                                     |

`choice: 'smallest'` estimates required descendant counts, resolves groups and type inheritance, and
uses declaration order to break ties. It is not a complete schema satisfiability solver. Cyclic paths
have infinite cost. Optional particles cost zero even with `optionalElements: 'all'`, so the selected
branch need not produce the smallest actual output. `{ prefer: [...] }` selects the first declared
branch mentioning any listed name, with `first` as fallback; the list is not a priority ordering.
An unavailable value or a mandatory recursive path can still prevent generation.

The CLI uses the same generation defaults. Its differently named flags map as follows:

| CLI flag                                     | API option / manifest key                               |
| -------------------------------------------- | ------------------------------------------------------- |
| `--optional-depth`                           | `maxDepth`                                              |
| `--max-depth`                                | `maxTotalDepth`                                         |
| `--values`                                   | `samples` (JSON file contents)                          |
| `--date`                                     | `referenceDate`                                         |
| `--base-dir`                                 | `baseDirectory` (file access only)                      |
| `--schema-location none\|relative\|absolute` | `schemaLocation` (resolved path, or omitted for `none`) |

`values` replaces the selected `profile`; `samples` is tried before that source. To compose more
sources, use `firstOf`. `locale` and `referenceDate` only affect a selected profile. `coverage: true`
uses its own choice strategy and overrides `choice`. CLI JSON settings have no effect with `--format xml`.

## Errors

Generation functions return promises. Loading errors, unsafe inputs, missing or ambiguous roots and
`maxNodes` exhaustion reject with `GenerateError`, whose `problems` carry diagnostics. Invalid options
reject with `RangeError` or `TypeError`. Invalid schemas rejected by libxml2 produce `SchemaCompileError`;
validator execution failures and errors thrown by custom callbacks also reject. Use `try`/`catch`
around `await` when your application needs to recover. `fileInput` and root discovery are synchronous:
file setup errors throw; discovery diagnostics are returned in `problems`.

These rejections are distinct from a returned unsuccessful sample. For example, exceeding
`maxTotalDepth` returns `incomplete` with `depth-limit`; exceeding `maxNodes` rejects immediately.

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
import { firstOf, valueLists, profileValues, facetValues } from 'xsd-faker';
import { generateSampleFile } from 'xsd-faker/node';

const source = firstOf(
  valueLists({ '/Order/Contact/Email': ['orders@example.invalid'] }),
  profileValues('retail', { locale: 'de', referenceDate: '2026-01-15T12:00:00Z' }),
  facetValues,
);
const sample = await generateSampleFile('examples/retail/order.xsd', { values: source, seed: 7 });
```

`firstOf` checks candidates against the supported simple-type facets before accepting them. A raw
`ValueSource` is also allowed; its output is checked by final document validation rather than assumed
correct. Failed candidates can consume a later seed. Do not use nondeterministic callbacks when fixtures
must be reproducible. `fixed` and `default` values on generated declarations bypass the source.

Value-list paths are local-name paths, not XPath. `/Order/@version` identifies an attribute.
When namespaces make such a path ambiguous, use a custom strategy and inspect the schema context or keep
separate runs. The current value context does not expose a namespace-qualified path.

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
attempts. Coverage prefers branches not yet accepted in validated XML,
then less-tried branches. Failed attempts do not count. The report's scope is `encountered-choices`:
optional content omitted from generation, unreachable types and combinations of branches are not
claimed as covered. `complete` means all branches of those encountered choices were accepted at least
once. Inspect `total` as well: a document with no encountered choices has no choice evidence.

## Filesystem boundary

The file API confines access to the entry directory by default, including after resolving symlinks.
For sibling schema folders, set `baseDirectory` to their common parent. The entry must also be within it.
The in-memory API can map externally named imports to explicit local texts without downloading them.
