# Invalid samples

`generateInvalidSamples` creates negative test cases by changing valid samples to violate one schema rule:
a facet constraint, a required element, an attribute restriction or another supported rule. Each changed
document is validated, and its diagnostics are checked against the intended violation. Only confirmed
samples should be used as negative examples; other outcomes include a status and reason.

```sh
npx xsd-faker invalid examples/retail/order.xsd --out-dir order-invalid --count 3 --coverage --seed 7
```

```js
import { generateInvalidSamples, fileInput } from 'xsd-faker/node';

const matrix = await generateInvalidSamples(fileInput('examples/retail/order.xsd'), { count: 3, coverage: true });
for (const sample of matrix.samples.filter((s) => s.status === 'confirmed')) {
  console.log(sample.rule, sample.path, sample.diagnostics[0]?.message);
}
console.log(matrix.counts);
```

The generator first creates valid samples using `count`, `coverage`, `seed`, `reach` and the other generation
options. Optional elements and attributes default to `all` to expose more rules for mutation; set them to
`none` to generate only required content. If including all optional elements exceeds `maxNodes`, generation
retries with `optionalElements: 'none'`, unless you explicitly chose an optional-element setting.

## Rules

| Rule                                                                                                                                                                                                                            | The change                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facet:length`, `facet:minLength`, `facet:maxLength`, `facet:pattern`, `facet:enumeration`, `facet:minInclusive`, `facet:maxInclusive`, `facet:minExclusive`, `facet:maxExclusive`, `facet:totalDigits`, `facet:fractionDigits` | a value that breaks this facet and meets every other facet of its type                                                                               |
| `value:lexical`                                                                                                                                                                                                                 | a value outside the lexical space or the range of the built-in type, such as `2026-02-30` for `xs:date`                                              |
| `value:fixed`                                                                                                                                                                                                                   | a value other than the fixed value of the declaration, compared as values: `+5` is the fixed value `5`, `1` is `true`                                |
| `structure:missing-element`                                                                                                                                                                                                     | an element removed where its particle has no more than `minOccurs` elements and its model groups must occur, a choice only if no branch can be empty |
| `structure:too-many`                                                                                                                                                                                                            | copies of an element beyond `maxOccurs`, outside repeated model groups, unless it holds an ID or the field of a key                                  |
| `structure:order`                                                                                                                                                                                                               | an element swapped with the element right after it, of another name, both in an `xs:sequence` that does not repeat                                   |
| `structure:unknown-element`                                                                                                                                                                                                     | an element of a namespace of its own, where the content model has no wildcard                                                                        |
| `structure:second-branch`                                                                                                                                                                                                       | the first element of another branch after the branch taken, in a choice that occurs once and has no branch that can be empty                         |
| `structure:missing-attribute`                                                                                                                                                                                                   | a required attribute removed                                                                                                                         |
| `structure:unknown-attribute`                                                                                                                                                                                                   | an attribute a restriction prohibits, or one the type does not declare and no attribute wildcard admits                                              |
| `structure:nil-not-nillable`                                                                                                                                                                                                    | `xsi:nil="true"` on an element that is not nillable; its content stays, because the validator still reads it                                         |
| `structure:nil-with-content`                                                                                                                                                                                                    | `xsi:nil="true"` on a nillable element that keeps its content                                                                                        |
| `structure:nil-with-fixed`                                                                                                                                                                                                      | `xsi:nil="true"` on a nillable element with a fixed value                                                                                            |
| `structure:foreign-xsi-type`                                                                                                                                                                                                    | `xsi:type` naming a complex type that does not derive from the declared type, or `xs:string` where the schema has none                               |
| `identity:duplicate-id`                                                                                                                                                                                                         | an ID given the value of another ID of the document, also of a type derived from `xs:ID`                                                             |
| `identity:dangling-idref`                                                                                                                                                                                                       | an `xs:IDREF` or `xs:IDREFS` naming no ID of the document                                                                                            |

`RULES` lists them in this order, which is also the order of the samples. Content admitted by a wildcard is not
changed by the matrix.

A declaration with a fixed value uses only `value:fixed` for value mutations. For a type with an enumeration,
only `facet:enumeration` is used: a value outside the allowed set would break that constraint as well as any
targeted facet. Identity mutations also leave fixed and enumerated values unchanged.

Fixed values are compared by value. For example, `+5` and `5` represent the same integer, so the matrix does
not use one to violate the other, even though libxml2 rejects the different spelling on an element.
Length facets of an `xs:list` count items.

Bounds of `xs:date`, `xs:dateTime`, `xs:time`, `xs:gYear` and `xs:gYearMonth` use XML Schema's ordering.
A value without a time zone and a bound with one have no defined order when they are less than 14 hours
apart; such a value counts as breaking the bound. The matrix does not compare bounds of `xs:duration`,
`xs:gMonth`, `xs:gMonthDay` or `xs:gDay`; for those types it constructs only `value:lexical` mutations.

A value that breaks exactly one rule may be impossible to construct. Every value matching `[0-9]{9}` has
nine characters, so no value can break `length="9"` while keeping that pattern. Likewise, an integer between
`-999` and `999` cannot violate `totalDigits="3"`. These cases are reported as not constructible, with a reason.
The matrix also excludes changes that would break a second rule the validator does not detect, such as
changing an ID that another node references.

## Status

| Status          | Meaning                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confirmed`     | the intended violation is confirmed by matching validation diagnostics or, for dangling ID references, by the separate integrity check                                             |
| `other-cause`   | the validator rejects it, but a message points to another rule, element or value, or none states the rule; or the ID check of the document finds another cause                     |
| `accepted`      | the validator accepts the document and, for dangling ID references, the integrity check finds no violation                                                                         |
| `not-checkable` | the intended violation cannot be confirmed because diagnostics are missing or unrecognized, a required integrity check is absent, or the validator has a known checking limitation |

A diagnostic alone does not identify the violated rule. libxml2 reports a missing `A` before `B` as
`Element 'B': This element is not expected. Expected is ( A ).` The same wording can indicate an extra
element, incorrect order, an unknown element or a second choice branch. Classification therefore checks
the element name, line number, quoted value and surrounding nodes against the mutation. Line numbers
distinguish elements with the same name. Diagnostics about a whole list or union value, an identity
constraint without a value or an abstract declared type must accompany a diagnostic identifying the rule;
on their own they are `other-cause`. A value outside the lexical space of a union is the exception: libxml2
reports only the message about the whole value, and that message states the rule.

libxml2 does not resolve ID references, so the generator also checks IDs and references in every changed
document. This check confirms `identity:dangling-idref` only when the validator accepts the rest of the
document. For every other rule, an ID-check finding counts as a second cause.

## Limits

| Option           | Default | Meaning                                                                     |
| ---------------- | ------- | --------------------------------------------------------------------------- |
| `rules`          | all     | only these rules                                                            |
| `perRuleAndPath` | `1`     | samples for one rule at one place of the schema, the path without positions |
| `maxFiles`       | `500`   | maximum total samples, distributed across rules                             |

Selection is deterministic for a seed. If a mutation cannot be constructed, another candidate is tried
for the same rule and path, then for another path of the same rule. `skipped` counts the planned changes
left out by the limits and never tried. All documents are validated against one compiled schema, in batches.

## The result

`matrix.samples` contains every applied change, including unconfirmed ones. Each entry records its `rule`,
`path`, `status`, `diagnostics`, `seed`, `xml` and `tree`, plus `facet`, `value` and `reason` where applicable.
Diagnostics include line numbers where available; the seed identifies the valid sample used as the base.

`matrix.notConstructible` lists changes that could not be made, with their rule, path and reason.
`decided: true` means the change is impossible; `false` means the search found no suitable value or could
not compare the constraints. `matrix.counts` summarizes these outcomes and each sample status.
`matrix.bases` counts the valid samples from which the changes were made.

The CLI writes the confirmed samples as `0001-facet-pattern.xml` and so on, and `manifest.json` with every sample:
`number`, `file` (`null` for one not written), `rule`, `path`, `facet`, `value`, `expected` (`invalid`), `status`,
`diagnostics`, `reason` and `seed`, with the counts and the list of changes that were not constructible.
`--keep-unconfirmed` also writes the other samples, under `unconfirmed/`. `xsd-faker invalid --help` lists the
options.

## Building blocks

The matrix components are exported for use in other tools, such as schema-version comparisons.
They work on the instance tree and on plain data, without the schema.

### Paths

A path identifies a tree node, for example `/{urn:example:order}Order/{urn:example:order}Line[2]/@{}id`.
`{ns}local` selects a namespace, `{}local` selects no namespace, and a bare name matches any namespace, as
in `samples` paths. Positions count matching siblings from 1; `@` marks an attribute in the final step.

`parseExpandedPath` reads the text into steps `{ ns?, name, position?, attribute? }`. `formatExpandedPath`
writes explicit namespaces in braces and leaves names bare when `ns` is absent. It omits position 1 and
writes positions from 2 onward. Parsing that output preserves the path's meaning. Invalid path text or a
path that cannot be represented, such as a namespace containing a brace, throws `TypeError`.
The `reach` option and the manifest use this notation.

### Values

`generateViolatingValue({ facets, rule, mustSatisfy?, seed? })` returns `{ status: 'constructed', value }` or
`{ status: 'not-constructible', reason, decided }`. `facets` describes a simple type as plain data (`ValueFacets`):

| Field                              | Meaning                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `builtin`                          | the local name of the built-in type the derivation ends in, such as `decimal` or `NMTOKENS` |
| `variety`                          | `atomic`, `list` or `union`; default `list` for the built-in list types, otherwise `atomic` |
| `item`, `members`                  | the item type of a list, the member types of a union                                        |
| `enumeration`                      | the allowed values                                                                          |
| `patterns`                         | one array per restriction step: a value matches one pattern of each step                    |
| `length`, `minLength`, `maxLength` | the tightest value along the derivation; for a list, counts of items                        |
| `minInclusive` … `maxExclusive`    | the tightest bounds, as written in the schema                                               |
| `totalDigits`, `fractionDigits`    | the tightest values                                                                         |
| `whiteSpace`                       | the effective rule; without it, the rule of the built-in type                               |
| `fixed`                            | the fixed value of the element or attribute declaration                                     |

A constructed value breaks `rule` while meeting every other facet in `facets`. If `mustSatisfy` is supplied,
it must meet those constraints too. This lets you find a value that one schema version accepts and another
rejects, including when their built-in types differ, such as `int` and `integer`. Comparisons use values
rather than spellings: `0a` and `0A` are the same `hexBinary` value.

For a result with status `not-constructible`, `decided: true` means no such value exists. `false` means the
search found none or could not compare the facets, such as bounds of `xs:duration`. `INF` and `-INF` are
supported bounds for `float` and `double`. Values of `xs:QName` and `xs:NOTATION` need namespace bindings
and are not constructed.

### Changes to a tree

`applyTreeMutation(tree, mutation)` applies one change to a copy of the tree and returns `{ status: 'applied',
tree, path, context, lines }`. If the mutation cannot be applied, it returns `{ status: 'not-applicable', reason }`.
The supported operations are
`set-value`, `remove`, `repeat` (`times` copies after the element), `swap-next` (with the element right after it,
which must have another name), `insert` (an element after `after`, or as the last child of `into`),
`add-attribute`, `set-nil` and `set-xsi-type`, each with the `rule` it aims at. `context` names the elements
around the change in the changed tree as `{ns}local`: `target`, `parent`, `previous` and `next`, the elements
before and after the change point, and `inserted`. `lines` gives the line of each of them, and of every inserted
copy, as `serializeXml` writes the changed tree with its default layout.

### Reading the validator

`classifyVerdict(verdict, applied, { integrity })` classifies a changed document using the validator result.
`parseDiagnostic` parses individual messages. `integrity` contains ID-check findings, which confirm
`identity:dangling-idref` but count as another cause for other rules. `validateXml` returns diagnostic
line numbers in `lines`; the classifier compares them with `applied.lines`.
If you serialize the document with a different layout, `applied.lines` must match that layout. Without
`verdict.lines`, the classifier can associate messages with the change only by name and value.

### Namespaces

`mapNamespaces(tree, { namespaces, attributes })` rewrites the namespaces of a copy of the tree: elements,
attributes, `xsi:type`, the namespaces of QName values and the keys of the JSON form. Attribute values change only
where `attributes` names them, by expanded name in the new namespaces. `applied` lists each rewrite.
