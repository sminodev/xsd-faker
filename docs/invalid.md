# Invalid samples

A test suite needs documents a consumer must reject as well as documents it must accept. `generateInvalidSamples`
starts from valid samples and changes each one so that it breaks one rule of the schema: a value that breaks one
facet, a missing element, an unknown attribute and so on. The validator then judges every changed document, and
its messages decide whether the document breaks exactly that rule. Only such confirmed documents are negative
examples; the others are reported with the reason.

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

The valid samples come from the usual options, `count`, `coverage`, `seed`, `reach` and the others. Optional
elements and attributes default to `all` here, so that more of the schema can be broken; set them to `none` for
changes to required content only. Where all optional elements of a large schema exceed `maxNodes`, the default
falls back to `none` for elements.

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
changed: the schema says nothing about it.

A declaration with a fixed value has only the rule `value:fixed`, and a type with an enumeration only
`facet:enumeration`: any other value breaks those first. The identity rules leave such values alone as well.
libxml2 compares a fixed value on an element as text and rejects `+5` for `5`; XML Schema compares values and
accepts it, so the matrix never writes such a value. Length facets of an `xs:list` count its items. Bounds of
`xs:date`, `xs:dateTime`, `xs:time`, `xs:gYear` and `xs:gYearMonth` are compared as XML Schema orders these
values: a value without time zone and a bound with one, less than 14 hours apart, have no order, and such a value
counts as breaking the bound. The bounds of `xs:duration`, `xs:gMonth`, `xs:gMonthDay` and `xs:gDay` are not
compared here; for such a type only `value:lexical` is constructed.

A value can be impossible to construct. For example, every value of `[0-9]{9}` has nine characters, so with
`length="9"` no value breaks the length and still matches the pattern. Likewise, within the bounds `-999` to `999`
no integer has more than three digits, and an enumeration allows only its values: unless one of them breaks
another facet, every other value breaks the enumeration as well. Such cases are counted as not constructible,
with the reason, and not generated. So are changes that would break a second rule the validator does not see,
such as a changed ID that a reference names.

## Status

| Status          | Meaning                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confirmed`     | the validator rejects the document, every message fits the change, and one of them states the rule                                                             |
| `other-cause`   | the validator rejects it, but a message points to another rule, element or value, or none states the rule; or the ID check of the document finds another cause |
| `accepted`      | the validator accepts it: the change did not break the schema as expected                                                                                      |
| `not-checkable` | the validator cannot decide it: a message the classifier cannot read, or a rejection without a message                                                         |

A message alone does not tell the rule. libxml2 reports a missing element `A` before `B` as `Element 'B': This
element is not expected. Expected is ( A ).`, and a surplus element, a wrong order, an unknown element and a second
branch with the same words. So each message is read together with the change: the element it names, on the line
of that element, the value it quotes, and the elements around the change, such as the sibling after a removed
element. The line tells two elements of one name apart. A message about the whole value of a list or union, an
identity constraint without a value and an abstract declared type only accompany a message that states the rule;
on their own they are `other-cause`. A value outside the lexical space of a union is the exception: libxml2
reports only the message about the whole value, and that message states the rule.

libxml2 does not resolve references. So every changed document also goes through the ID check of the generator:
`identity:dangling-idref` is confirmed by it, and the validator has to accept the document; for every other rule,
a finding of the ID check is a second cause.

## Limits

| Option           | Default | Meaning                                                                                        |
| ---------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `rules`          | all     | only these rules                                                                               |
| `perRuleAndPath` | `1`     | samples for one rule at one place of the schema, the path without positions                    |
| `maxFiles`       | `500`   | samples in all; beyond it every rule gives up its share in turn, so all rules stay represented |

The choice is deterministic for a seed. A change that cannot be made, such as a second branch no document reaches,
gives its turn to the next change of the same place, or of the same rule. `skipped` counts the planned changes
left out by the limits and never tried. All documents are validated against one compiled schema, in batches.

## The result

`matrix.samples` holds every applied change with `rule`, `path`, `facet` and `value` where they apply, `status`,
`diagnostics` (the messages with their line), `reason`, `seed` (of the valid sample it came from), `xml` and
`tree`. `matrix.notConstructible` lists rule, path, reason and whether the reason is `decided` or the search found
nothing. `matrix.counts` counts each status and the changes that were not constructible, and `bases` the valid
samples the changes start from.

The CLI writes the confirmed samples as `0001-facet-pattern.xml` and so on, and `manifest.json` with every sample:
`number`, `file` (`null` for one not written), `rule`, `path`, `facet`, `value`, `expected` (`invalid`), `status`,
`diagnostics`, `reason` and `seed`, with the counts and the list of changes that were not constructible.
`--keep-unconfirmed` also writes the other samples, under `unconfirmed/`. `xsd-faker invalid --help` lists the
options.

## Building blocks

The parts of the matrix are exported for tools of their own, such as a comparison of two versions of a schema.
They work on the instance tree and on plain data, without the schema.

### Paths

A path names a node of the tree by expanded names: `/{urn:example:order}Order/{urn:example:order}Line[2]/@{}id`.
`{ns}local` is that namespace, `{}local` no namespace, and a name without braces matches any namespace, as the paths
of `samples` do. Positions count elements of that name among their siblings, from 1. `parseExpandedPath` reads
the text form into steps `{ ns?, name, position?, attribute? }`; `formatExpandedPath` writes the exact form,
always with braces and with positions from 2, which reads back to the same path. A path that has no such form,
such as a namespace with a brace, throws a `TypeError`; so does text that is not a path. The option `reach` and
the manifest use this form.

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

The value breaks `rule` of `facets` and meets every other facet, and all facets of `mustSatisfy` too: a value
that a type of one version accepts and another rejects, also where the versions differ in the built-in type, such
as `int` and `integer`. Values are compared in the value space, as for an enumeration: `0a` is the `hexBinary`
`0A`. `decided: true` comes with a proof that no such value exists; `false` means the search found none, or the
facets cannot be compared, such as the bounds of an `xs:duration`. `INF` and `-INF` bound a `float` or `double`
like any other value. Values of `xs:QName` and `xs:NOTATION` need namespace bindings and are not constructed.

### Changes to a tree

`applyTreeMutation(tree, mutation)` applies one change to a copy of the tree and returns `{ status: 'applied',
tree, path, context, lines }` or `{ status: 'not-applicable', reason }`; it does not throw. The changes are
`set-value`, `remove`, `repeat` (`times` copies after the element), `swap-next` (with the element right after it,
which must have another name), `insert` (an element after `after`, or as the last child of `into`),
`add-attribute`, `set-nil` and `set-xsi-type`, each with the `rule` it aims at. `context` names the elements
around the change in the changed tree as `{ns}local`: `target`, `parent`, `previous` and `next`, the elements
before and after the change point, and `inserted`. `lines` gives the line of each of them, and of every inserted
copy, as `serializeXml` writes the changed tree with its default layout.

### Reading the validator

`classifyVerdict(verdict, applied, { integrity })` gives the status of a changed document from the verdict of the
validator, with each message read by `parseDiagnostic`. `integrity` are the findings of an ID check of the
document: the reference of `identity:dangling-idref`, and for every other rule a second cause. `validateXml` gives
each rejected document the line of each message in `lines`; the classifier compares them with `applied.lines`.
A document written in another layout than the default needs those lines for that layout; where `verdict.lines` is
missing, messages are tied to the change by name and value only.

### Namespaces

`mapNamespaces(tree, { namespaces, attributes })` rewrites the namespaces of a copy of the tree: elements,
attributes, `xsi:type`, the namespaces of QName values and the keys of the JSON form. Attribute values change only
where `attributes` names them, by expanded name in the new namespaces. `applied` lists each rewrite.
