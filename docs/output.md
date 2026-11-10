# XML and JSON output

Both outputs describe the same generated instance. JSON is not generated in a second independent run.
The public `tree` result contains namespace-aware elements, attributes and ordered children.

## XML

The serializer keeps child order, writes namespace declarations and escapes text and attributes.
The root namespace is the default namespace when doing so does not qualify local elements incorrectly.
Qualified attributes get prefixes; the XML namespace uses its reserved `xml` prefix.
Mixed content is not pretty-printed in a way that inserts whitespace into its immediate text stream.

`schemaLocation` writes `xsi:schemaLocation` for a namespaced root or
`xsi:noNamespaceSchemaLocation` for a root without a namespace. It is only a schema hint. The validator
uses the explicit loaded schema set, not the presence of that attribute.

## Compact JSON

Compact mode describes the content of the root; there is no extra root-name wrapper.

- Elements and attributes use local names as keys.
- Simple text becomes a string, number or boolean according to the declared type.
- Repeated particles become arrays even when this sample contains one occurrence. Repeating model
  groups also make their descendant element values repeatable. A name declared in multiple particles
  of the content model is conservatively array-valued, including alternatives and inherited groups.
- Simple content with attributes uses an object containing attributes and a `value` property.
- Mixed content uses `value` containing an XML fragment string. Child markup includes namespace
  declarations needed to interpret it independently of the surrounding document.
- Lists keep their space-separated lexical string. Unions use a shared member JSON type when all
  members agree; otherwise they use strings.
- Missing optional content is absent, not a `null` placeholder.

For example, `<Price currency="EUR">4.99</Price>` becomes:

```json
{ "currency": "EUR", "value": 4.99 }
```

`textProperty` changes the text property's name. If an attribute or child already uses that name, the
projection fails rather than overwriting it.

### Refusals

An attribute and element with the same local name cannot occupy the same key. Neither can two elements
from different namespaces with the same local name. These cases leave XML intact, set `jsonStatus` to
`unavailable`, and add a `json-mapping` diagnostic. Tree mode is the alternative.

Numbers are checked before conversion. An unsafe integer, non-finite value or decimal whose serialized
JavaScript number would change the decimal value is refused. `numbers: 'string'` keeps all numeric lexical
values as JSON strings. It changes the JSON contract and will not satisfy a schema expecting numbers.

Compact JSON cannot preserve the ordering of interleaved child elements or every XML lexical detail.
It is not a general, reversible XML-to-JSON mapping. In particular, grouped occurrences can lose their
grouping once flattened into property arrays. Use tree mode for those consumers.

## Tree JSON

`json: { mode: 'tree' }` returns the generated instance tree as ordinary JSON. It keeps:

- Namespace URI and local name for each element and attribute.
- Ordered child nodes, including text.
- Lexical strings and their intended JSON type.
- Repeatability and mixed-content metadata.

This is the package's own instance-tree format. It preserves the generated instance information, not an
original XML document's prefixes, comments,
attribute ordering or source formatting.

## CLI files

Without `--out` or `--out-dir`, a single output goes to stdout. `--out` writes a file with the name you
choose. `--out-dir` requires a new directory and writes `sample-NNNN.xml` and/or `sample-NNNN.json` plus
`manifest.json`. Template and unvalidated directory exports add `.template` or `.unvalidated` before
the extension. Existing files and directories are refused.

The manifest records the package version, generation options, returned seeds and attempts, sample
statuses, diagnostics and encountered-choice coverage. Its generation keys use API names; see the
[option mapping](api.md#options). Empty template values require XML or tree JSON in the CLI because
empty strings cannot represent typed booleans or numbers in compact JSON.

## Validation contract

XML is checked against XSD. Projection to JSON is a serialization operation, not JSON Schema validation.
The API and CLI do not imply otherwise. The CLI manifest records `jsonSchemaValidation: 'not-performed'`.
