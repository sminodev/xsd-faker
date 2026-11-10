# Generation rules

The generator reads XSD directly. A JSON Schema conversion is not used to reconstruct XML order,
attributes or namespace declarations. One instance tree feeds both serializers.

## Instance or template

Instance mode chooses one particle per occurrence of `xs:choice`, respects occurrence limits and
validates the XML. Repeated choice groups can select a branch on each occurrence; a choice does not
necessarily mean that only one branch name can appear anywhere in the document.

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

`optionalElements` and `optionalAttributes` override the shorthand independently. An omitted optional
element also omits its entire subtree. Included optional elements use the same `repeat` rule as required
elements, so they occur at least once. Optional expansion remains subject to the depth limit below.
In instance mode, `optional: 'all'` includes optional content within the selected choice branch; it does
not select every alternative of `xs:choice`. Random choice selection can therefore change which names
appear in an array even though `repeat` itself is fixed.

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

Generated declarations use their `fixed` or `default` value first. Without one, a custom source, value
list or profile can supply candidates. The facet generator handles supported enums, patterns, ranges,
lengths, lists and unions. It tries a bounded number of candidates; failure produces a diagnostic.

Pattern generation draws from printable ASCII (`U+0020` to `U+007E`) and literal characters or ranges
written in the pattern, such as `[ä-ü]`. A non-ASCII-only category such as `\p{Lo}` has no candidates in
the default universe. Unicode block escapes (`\p{Is...}`) are unsupported. Generation remains bounded.

Numeric bounds retain their decimal spelling and are evaluated with integer arithmetic, including
64-bit integers. Decimal generation chooses up to four fraction digits; narrower intervals may need a
custom value source. Numeric parsing is bounded to 1000 digits and finite numeric bounds.

The default facet generator is seeded. Profile dates use an explicit reference date, fixed by default.
For unsupported temporal bounds, profiles
fall back to seeded facet candidates (years 1990–2030); final validation still decides.
Domain vocabulary is synthetic. XSD validity does not establish real-world validity of a policy number,
address, payment instruction or relationship between two fields.

## Supported boundaries

| Area                                  | Current behaviour                                                                                                                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imports and includes                  | Local, transitive loading with namespace checks and a source snapshot                                                                                                                                                                          |
| Namespace-changing/chameleon includes | Rejected rather than silently rebound                                                                                                                                                                                                          |
| `sequence`, `all`, groups             | Traversed in declaration order; occurrences applied to the group and its children                                                                                                                                                              |
| `choice`                              | First, smallest-required-descendant estimate, random, preferred names, custom callback or explicit template                                                                                                                                    |
| Attributes and attribute groups       | Required, optional and prohibited uses; expanded names distinguish namespaces                                                                                                                                                                  |
| Complex extension/restriction         | Base attributes and supported content model handling; final XSD validation is decisive                                                                                                                                                         |
| Simple content                        | Text plus attributes                                                                                                                                                                                                                           |
| Mixed content                         | Ordered instance children; XML is validated; compact JSON contains an XML fragment string                                                                                                                                                      |
| `xs:any`                              | Eligible known global declaration, or a placeholder for permitted lax/skip content; strict unresolved wildcard fails                                                                                                                           |
| `xs:anyAttribute`                     | No arbitrary optional attributes are invented                                                                                                                                                                                                  |
| Primitive restrictions                | Supported lengths, enumerations, numeric bounds/digits and translatable XSD patterns                                                                                                                                                           |
| Lists and unions                      | Generated as XML lexical values; JSON projection follows the documented type convention                                                                                                                                                        |
| Abstract elements/substitution groups | No general substitution selection; abstract required declarations are reported                                                                                                                                                                 |
| Abstract types and `xsi:type`         | No derived-type selection                                                                                                                                                                                                                      |
| `nillable`                            | Normal content may be generated; no explicit nil-generation policy                                                                                                                                                                             |
| `key`, `keyref`, `unique`             | No relational value planning; a diagnostic is emitted and final validation checks the instance                                                                                                                                                 |
| `xs:IDREF`, `xs:IDREFS`               | Reference planning is unsupported. An error-level `identity-planning` diagnostic prevents `valid`, including custom/fixed values and list/union types containing references. The default libxml2 validator does not establish IDREF integrity. |
| `xs:ID`                               | Independent NCName words; no document-wide value planning                                                                                                                                                                                      |
| `xs:ENTITY(IES)`, `xs:NOTATION`       | No declaration-based value planning; a warning is emitted and final validation may fail                                                                                                                                                        |
| Date/time bounds                      | No general temporal constraint solver; unsupported bounds are reported and final validation still applies                                                                                                                                      |
| `redefine`, XSD 1.1                   | Outside the supported contract; not a claim of XSD 1.1 conformance                                                                                                                                                                             |
| Unsupported regular expressions       | Bounded generation fails visibly; no unrestricted regex solver                                                                                                                                                                                 |

This table describes generation behaviour, not complete XSD conformance. A valid result for one schema
is evidence for that instance, not for every construct or document in a domain. A custom value source
can help with some unsupported planning problems, but it does not extend the validator's schema dialect.

## Diagnostics and validation

Diagnostics contain a stable code, severity, message and source position where available. Errors mean
generation cannot claim completion. Warnings explain limitations requiring attention. An error-free
walk without validation remains `unvalidated`.

XML validation uses libxml2 through `xmllint-wasm` by default. Missing dependencies, schema compilation
failures and validator execution errors reject; they are not treated as an empty list of errors. Each
input document receives its own explicit validity result. An alternate validator can be injected and is
responsible for its own dialect, resource limits and correctness.

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
