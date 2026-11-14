# Generation rules

The generator reads XSD directly. A JSON Schema conversion is not used to reconstruct XML order,
attributes or namespace declarations. One instance tree feeds both serializers.

## Instance or template

Instance mode chooses one particle per occurrence of `xs:choice`, respects occurrence limits and
validates the XML. Repeated choice groups can select a branch on each occurrence; a choice does not
necessarily mean that only one branch name can appear anywhere in the document.

Substitution groups and `xsi:type` are decided the same way. Where a particle refers to the head of a
substitution group, each occurrence chooses among the head, unless it is abstract, and the members that
may replace it, also members of members. Where an element has a named complex type, it chooses among
that type, unless it is abstract, and the named complex types derived from it, by extension or
restriction; a type other than the declared one is written as `xsi:type` with a declared prefix.
`block` on the element, on the head or the declared type and `blockDefault` exclude alternatives, as do
`block` on intermediate types for substitution groups and `final` on the head, following XML Schema 1.0.
Abstract elements and types are never written themselves. The choice strategy, coverage and
`smallest` treat these alternatives like branches. An element of a simple type keeps its declared type:
choosing among the many built-in and schema types derived from it is outside the generator's scope.

In a template, every member of a substitution group is written; an element still has one type.

Template mode can put every branch into one document and can leave values empty. It is useful for
reading a schema, but the result is not an accepted test instance. Even when a particular template
happens to validate, the template API does not claim that it was checked.

## Repetitions and recursion

For an included particle, `repeat` is a fixed requested count, defaulting to 1. The seed does not
randomize that count. It is clamped between `minOccurs` and `maxOccurs`; `unbounded` still uses the finite
requested count. For example, with `minOccurs="2"` and `maxOccurs="5"`, `repeat: 1` produces two
occurrences, `repeat: 3` produces three, and `repeat: 9` produces five. The same setting applies to each
included particle, including repeating groups and their children. A zero-maximum particle is omitted.

Optional inclusion is a separate decision:

| Setting                      | Generated content                                              |
| ---------------------------- | -------------------------------------------------------------- |
| `optional: 'none'` (default) | Required elements and attributes only                          |
| `optional: 'all'`            | Required and optional elements and attributes                  |
| `optional: 'random'`         | Required content plus optional content selected using the seed |

`nil` decides separately whether an element that occurs is written as nil: `'never'` (default) never does
and draws no random numbers, so it does not affect what a seed produces otherwise; `'random'` makes each
occurrence of a nillable element without a `fixed` value nil with chance one half. A nil element keeps
the attributes its type declares, required ones included, and has no content. `choice: 'smallest'` does
not count nil.

`optionalElements` and `optionalAttributes` override the shorthand independently. An omitted optional
element also omits its entire subtree. Included optional elements use the same `repeat` rule as required
elements, so they occur at least once. Optional expansion remains subject to the depth limit below.
In instance mode, `optional: 'all'` includes optional content within the selected choice branch; it does
not select every alternative of `xs:choice`. Random choice selection can therefore change which names
appear in an array even though `repeat` itself is fixed.

`choice: 'smallest'` applies these same rules when it compares branches: it counts the occurrences
`repeat` produces, optional elements according to the optional-element setting, and nothing optional
from `maxDepth` on. The [API reference](api.md#options) gives the weights.

`maxDepth` stops optional expansion and must be lower than `maxTotalDepth`. Required descendants of an
included element remain required.
`maxTotalDepth` (CLI: `--max-depth`) and `maxNodes` (`--max-nodes`) are hard limits:

- Exceeding `maxTotalDepth` returns `incomplete` with a `depth-limit` error.
- Exceeding `maxNodes` rejects immediately with `GenerateError` and `resource-limit`.

Optional expansion also consumes the node budget. For branching recursive types, reduce `maxDepth`
(CLI: `--optional-depth`), for example to 3, or omit optional elements. The node limit does not silently
prune an already selected branch. Neither limit produces a valid truncated document. A mandatory
recursive cycle without a terminating branch cannot be solved by silently cutting
it off. Use a terminating choice strategy or fix the schema when appropriate.

## Values

Generated declarations use their `fixed` or `default` value first. Without one, a value list, a locale or
a custom source can supply candidates. The facet generator handles supported enums, patterns, ranges,
lengths, lists and unions. It tries a bounded number of candidates; failure produces a diagnostic.
Generated values are written after the type's whiteSpace rule, as a validator reads them, so XML and JSON
carry the same value. A `fixed`, `default` or supplied value keeps its spelling in XML; JSON gets it as the
validator reads it, see [output](output.md#compact-json).

A prefix in a QName value means what the schema binds it to. A generated value, from a pattern for example, may
use a prefix the schema does not bind; such a prefix is declared with the namespace `urn:example:prefix:` and the
prefix appended, `xsi` with the XML Schema instance namespace. The prefix `xmlns` cannot be declared and is never
generated.

Pattern generation draws from printable ASCII (`U+0020` to `U+007E`) and literal characters or ranges
written in the pattern, such as `[ä-ü]`. The name types (`Name`, `NCName`, `NMTOKEN`, `QName`, `ID`,
`IDREF`, `ENTITY` and their lists) and `\i`, `\c` in patterns follow the character classes of XML 1.0,
Second Edition, to which XML Schema 1.0 refers, for checking and for generation. Later editions allow
more characters, such as `ǅ` or `Ⅻ`; such values are neither accepted nor generated, and characters
outside the Basic Multilingual Plane are no name characters. `\d` remains every Unicode decimal digit. A
non-ASCII-only category such as `\p{Lo}` has no candidates in the default universe. Unicode block escapes
(`\p{Is...}`) are unsupported. Generation remains bounded.

Numeric bounds retain their decimal spelling and are evaluated with integer arithmetic, including 64-bit
integers. Without bounds that demand otherwise, values stay in the range a JSON number holds exactly.
Decimal generation chooses up to two fraction digits, up to four where `fractionDigits` allows them, and
more when narrow bounds need them. Numeric parsing is bounded to 1000 digits and finite numeric bounds.
`xs:float` and `xs:double` values are written in the same plain decimal form: exponent notation, `INF`,
`-INF` and `NaN` are not generated at random. A bound that overflows the type, such as `1e39` for
`xs:float`, is evaluated as infinity and can require an `INF` or `-INF` value. Fixed or enumerated values
are written as given and checked against the bounds of XML Schema 1.0, where every bound excludes `NaN`. `INF`, `-INF`
and `NaN` as bounds themselves are reported as `unsupported`. A union picks its member with the seed and
writes a value of that member, so in a union of `xs:decimal` and `xs:double` the double member is chosen,
but its values look like decimals and the first member accepts them as well.

The default facet generator is seeded. Locale dates count from an explicit reference date, fixed by
default. For unsupported temporal bounds, a locale falls back to seeded facet candidates (years
1990–2030); final validation still decides. Locale values are synthetic. XSD validity does not establish
real-world validity of a policy number, address, payment instruction or relationship between two fields.

## Supported boundaries

| Area                            | Current behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Imports and includes            | Local, transitive loading with namespace checks and a source snapshot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Chameleon includes              | A document without `targetNamespace` that a namespaced document includes is loaded once per such namespace: its components, and the names without namespace in it, take that namespace. Including a document of another target namespace is a `namespace-mismatch` error                                                                                                                                                                                                                                                                                                                                                                               |
| `sequence`, `all`, groups       | Traversed in declaration order; occurrences applied to the group and its children                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `choice`                        | First, smallest expected output under the current options, random, preferred names, custom callback or explicit template. A branch that cannot be generated is not offered: a required element of an abstract type without allowed derived type, or of an abstract head without allowed member, also inside groups. Only when no branch is left is it reported as `unsupported`                                                                                                                                                                                                                                                                        |
| Attributes and attribute groups | Required, optional and prohibited uses; expanded names distinguish namespaces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Complex extension/restriction   | Base attributes and supported content model handling; final XSD validation is decisive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Simple content                  | Text plus attributes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Mixed content                   | Ordered instance children; XML is validated; compact JSON contains an XML fragment string. An extension without its own `mixed` keeps the mixed content of its base, as libxml2 does; `mixed` on `complexContent` wins over the type's                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `xs:any`                        | Eligible known global declaration, or a placeholder for permitted lax/skip content; strict unresolved wildcard fails. Names declared in the same JSON object are not used, and nothing inside is nil                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `xs:anyAttribute`               | No arbitrary optional attributes are invented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Primitive restrictions          | Supported lengths, enumerations, numeric bounds/digits and translatable XSD patterns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Lists and unions                | Generated as XML lexical values; patterns on the whole value are met; length facets of lists, also of `xs:NMTOKENS`, count items; compact JSON writes a list as an array of typed items                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Substitution groups             | A particle that refers to a head chooses among the head, unless abstract, and its allowed members, transitively, like a choice; `block`, `blockDefault` and the head's `final` are applied. An abstract head without an allowed member is reported as `unsupported`, and an abstract root cannot be generated                                                                                                                                                                                                                                                                                                                                          |
| Abstract types and `xsi:type`   | An element of a named complex type chooses among that type, unless abstract, and the named complex types derived from it that the element's and the type's `block` allow, like a choice; another type is written as `xsi:type`. Elements of simple types never get `xsi:type`. An abstract type without a concrete derived type is reported                                                                                                                                                                                                                                                                                                            |
| `nillable`                      | `nil: 'random'` writes an occurring nillable element without `fixed` as `xsi:nil="true"` with chance one half, keeping the attributes its type declares; the default `'never'` writes normal content                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `key`, `keyref`, `unique`       | No relational value planning; a diagnostic is emitted and final validation checks the instance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `xs:IDREF`, `xs:IDREFS`         | Planned for the whole document: each reference, also a forward one, names an ID of the document that meets its facets; if none does, an unreferenced generated ID is changed to fit. A separate integrity check verifies references because libxml2 does not resolve them: an unresolved reference is an `identity-planning` error and the sample is `incomplete`. Fixed values and values listed in `samples` are checked, not rewritten; values of a locale or a custom `values` source are planned like generated ones. References in a union are not planned and reported the same way. Content admitted with `processContents="skip"` is left out |
| `xs:ID`                         | Generated by the value source and made unique in the document; fixed IDs and IDs listed in `samples` keep their value, and a duplicate among them is reported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `xs:ENTITY(IES)`, `xs:NOTATION` | No declaration-based value planning; a warning is emitted and final validation may fail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Date/time bounds                | No general temporal constraint solver; unsupported bounds are reported and final validation still applies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `redefine`                      | Groups and attribute groups: the redefined document is included, and its group or attribute group is replaced everywhere, also in references from that document. A self-reference in the new definition means the replaced one, so extensions and restrictions follow the redefinition, also in chains and chameleon documents. Redefined simple and complex types and `xs:override` are `unsupported-redefine` errors; a missing target is `unknown-group`, a repeated or repeating self-reference `invalid-redefine`                                                                                                                                 |
| XSD 1.1                         | Outside the supported contract; not a claim of XSD 1.1 conformance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Unsupported regular expressions | Bounded generation fails visibly; no unrestricted regex solver                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

This table describes generation behaviour, not complete XSD conformance. A valid result for one schema
is evidence for that instance, not for every construct or document in a domain. A custom value source
can help with some unsupported planning problems, but it does not extend the validator's schema dialect.

## Diagnostics and validation

Diagnostics contain a stable code, severity, message and source position where available. Errors mean
generation cannot claim completion. Warnings explain limitations requiring attention. An error-free
walk without validation remains `unvalidated`.

XML validation uses libxml2 through `xmllint-wasm` by default. Missing dependencies, schema compilation
failures and validator execution errors reject; they are not treated as an empty list of errors. Each
input document receives its own explicit validity result. The default validator may use up to 2 GiB of
WebAssembly memory; a document that needs more rejects with `libxml2: out of memory`. An alternate validator
can be injected and is responsible for its own dialect, resource limits and correctness.

The CLI exit codes are 0 for the completed requested operation, 1 for input/runtime errors and 2 for
invalid or incomplete generation, unavailable required JSON, or incomplete requested choice coverage.
Invalid/incomplete samples or unavailable requested JSON prevent all instance-file writes. Incomplete
choice coverage is different: the valid samples and manifest are written before exit code 2. Choose a
new directory for a retry.

An explicitly requested template or unvalidated export can complete with code 0; its status is not valid.

## References

- [XML Schema 1.0 Structures](https://www.w3.org/TR/xmlschema-1/)
- [XML Schema 1.0 Datatypes](https://www.w3.org/TR/xmlschema-2/)
- [xmllint-wasm](https://github.com/noppa/xmllint-wasm)
