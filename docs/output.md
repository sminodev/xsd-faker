# XML and JSON output

Both outputs describe the same generated instance. JSON is not generated in a second independent run.
The public `tree` result contains namespace-aware elements, attributes and ordered children.

## XML

The serializer keeps child order, writes namespace declarations and escapes text and attributes.
The root namespace is the default namespace when doing so does not qualify local elements incorrectly.
Qualified attributes get prefixes; the XML namespace uses its reserved `xml` prefix. A prefix in an `xs:QName`
value keeps its spelling and is declared on the element that holds the value, unless the root already binds it.
Nothing inside mixed content is indented, so the markup matches the string in the JSON form. An element
without content, also one whose content is an empty text, closes itself (`<br/>`) in both.
`xsi:nil` and `xsi:type` use the `xsi` prefix. The namespace of an `xsi:type` value always gets a prefix,
also where it is the default namespace of element names; a type without namespace keeps the default
namespace off, as an unqualified element does.

`schemaLocation` writes `xsi:schemaLocation` for a namespaced root or
`xsi:noNamespaceSchemaLocation` for a root without a namespace. It is only a schema hint. The validator
uses the explicit loaded schema set, not the presence of that attribute.

## Compact JSON

Compact mode describes the content of the root; there is no extra root-name wrapper.

- Elements and attributes use local names as keys. Where names collide, the keys are planned from the whole
  content model, branches and members this sample leaves out included, so they never depend on the sample:
  elements of one local name from several namespaces all take `{namespace}local` (`{}local` without
  namespace); an attribute named like an element becomes `@local` while the element keeps its name; one local
  name of several attribute namespaces gives each `@{namespace}local`. The text property's name is reserved
  in every object; see [the text property](#the-text-property) and [Collisions](#collisions).
- Simple text becomes a string, number or boolean according to the declared type, as the validator reads it:
  after the whitespace rule of the type, and for a union as its first accepting member normalizes it. A fixed
  value `"   123   "` on `xs:integer` becomes `123`, `"ENU "` on a union of `xs:gYearMonth`, `xs:language` and
  `xs:normalizedString` becomes `"ENU"`; the XML keeps the spelling. Only XML white space (space, tab, line feed,
  carriage return) is replaced, collapsed or separates list items; U+00A0 and other Unicode spaces stay, so
  `"\u00a0A\u00a0"` on `xs:token` remains `"\u00a0A\u00a0"`.
- Repeated elements become arrays even when this sample contains one occurrence. A name declared in
  multiple particles of one object is conservatively array-valued, including alternatives and inherited
  groups.
- A repeating model group becomes one property holding an array with an object per occurrence; see
  [Repeated groups](#repeated-groups).
- A complex type with simple content is an object with any attributes and a `value` property, also when
  this sample has no attributes. An element of a simple type is a plain value.
- Mixed content uses `value` containing an XML fragment string, also where its content model has repeated
  groups (no `#…` arrays there), and `""` when it is empty. Simple content always has `value` too, `""` when
  empty. The child markup keeps the prefixes of the XML, and each child element declares the namespaces its
  names use, so that the string can be read on its own: `Ring <c:b xmlns:c="urn:example:common">twice</c:b>.`
- A list (`xs:list`, also `xs:NMTOKENS`, `xs:IDREFS` and `xs:ENTITIES`) is an array of its items, in
  elements, attributes and simple content alike: `<Numbers> 1 +02 3 </Numbers>` becomes `[1, 2, 3]`, an empty
  list `[]`. Each item is typed like a single value of the item type. A repeated list element is an array
  of such arrays. A pattern on a list applies to the whole lexical value and cannot be read from the array.
- Unions use a shared member JSON type when all members agree, with integers counted as numbers;
  otherwise they use strings. A union with a list member is a string.
- `xs:float` and `xs:double` values `INF`, `-INF` and `NaN` are the strings `"INF"`, `"-INF"` and `"NaN"`, also
  in attributes, lists, unions and simple content; finite values stay numbers. The generator writes these
  values where the schema gives them, as a fixed value or an enumeration, not at random.
- An element written with `xsi:nil="true"` is `null`, or with attributes an object with the attributes
  and `value: null`; see [Nil](#nil).
- Content admitted by `xs:any` is mapped without the schema; see [Wildcard content](#wildcard-content). So is an
  element of type `xs:anyType`, declared or for want of a type, unless `xsi:type` names a complex type; the
  generator writes it empty, `""`, or with its fixed value.
- A member of a substitution group uses its own local name; see
  [Substitution groups and xsi:type](#substitution-groups-and-xsitype).
- `xsi:*` attributes, like namespace declarations, never become properties.
- Missing optional content is absent, not a `null` placeholder.

For example, `<Price currency="EUR">4.99</Price>` becomes:

```json
{ "currency": "EUR", "value": 4.99 }
```

### The text property

`textProperty` changes the text property's name, `value` by default. It must be an NCName other than
`__proto__`, or exactly `#text`; anything else is a `TypeError`, and the CLI ends with an input error. So
it never meets a key of the form `{ns}local`, `@local`, `#type` or a group key. That name is reserved in
every object, whether the object holds text or not, so that a key never depends on the sample (a nil
element, for example, adds the text property to an object with attributes). An attribute of that name
becomes `@` and its name, an element `{namespace}local`; the text property keeps its name:

- `<Price value="v">4.5</Price>` becomes `{ "@value": "v", "value": 4.5 }`;
- `<a:Pair value="a"><a:value>e</a:value></a:Pair>` becomes `{ "@value": "a", "{urn:example:a}value": "e" }`.

For schemas with many attributes or elements named `value`, `textProperty: '#text'` (CLI `--text-property
'#text'`) keeps their keys plain: no XML name starts with `#`. Only a repeated group named `text`, whose
key is also `#text`, would collide; that is refused.

### Repeated groups

The elements of one occurrence of a repeating `xs:sequence`, `xs:choice` or `xs:group` reference stay
together. For a sequence of `a` and `b` that occurs twice:

```json
{
  "#sequence": [
    { "a": 1, "b": "x" },
    { "a": 2, "b": "y" }
  ]
}
```

The property is `#sequence`, `#choice`, or `#` and the group's name for a reference, such as `#Address`.
A further group of the same name in the object adds `:2`, `:3` in document order, counting the groups of a
base type first and every branch of a choice, also those this sample did not take. Names start with `#`,
so they cannot collide with an element or attribute. Each occurrence follows the same rules, so repeated
groups nest. An occurrence without any element has no item, because XML cannot show it.

`xsd-to-jsonschema` writes the same form, so a compact JSON sample can be validated against the JSON
Schema it generates for the same XSD.

### Nil

With `nil: 'random'`, a nillable element can be written as `<D xsi:nil="true"/>`. Its JSON form is `null`;
in a repeated element, the item is `null`: `[1, null]`. A nil element with attributes is an object with
the attributes and the text property `null`, without children: `<Address kind="home" xsi:nil="true"/>`
becomes `{ "kind": "home", "value": null }`. An attribute named like the text property is `@value` there
too.

### Substitution groups and xsi:type

Where a substitution group allows members, the key is the local name of the element that occurs:
`<Invoice>` instead of the abstract head `<Document>` becomes `Invoice`. With `maxOccurs > 1` on the
particle, each member's key is an array. The total number of members across keys, and their order among
each other, cannot be read from the JSON.

An element written with `xsi:type` is an object with `#type`, the expanded name of the type, followed by
the properties of that type:

```json
{ "#type": "{urn:example}Car", "Plate": "K", "Seats": 4 }
```

A type without namespace is written `{}local`. An element of its declared type has no `#type`. Simple
content with `xsi:type` is an object with `#type`, the attributes and the typed value under the text
property: `{ "#type": "{urn:example}EuroAmount", "currency": "EUR", "value": 4.99 }`. A nil element with
`xsi:type` keeps `#type` next to `value: null`. A repeated group named `type`, whose key is also `#type`,
makes the object a collision, which is refused wherever the element's type has alternatives `xsi:type` could
name, in a sample without `xsi:type` too.

An element of a simple type has no JSON form for any other type: `xsi:type` naming the declared type
itself changes nothing, and any other type is refused like a collision, leaving the XML intact. The
generator writes `xsi:type` only for complex types, including simple content, so its own samples do not
meet this limit.

### Wildcard content

Elements admitted by `xs:any` are mapped without the schema, whatever `processContents` says and also when
a global declaration of the schema matches them:

- An element without attributes and children is its text, unchanged: `<f:x> more </f:x>` becomes
  `" more "`, an empty element `""`. A value the schema types as a number stays a string.
- With attributes, it is an object: the attributes as strings under their local names, the text under the
  text property where it is not empty: `<f:y f:b="2">two</f:y>` becomes `{ "b": "2", "value": "two" }`,
  `<f:y f:b="2"/>` becomes `{ "b": "2" }`.
- Children are mapped by the same rule under their local names. Whitespace-only text between children is
  treated as formatting and left out, so indented foreign XML stays an object.
- Children together with other text keep the mixed form: the text property holds the inner content as an
  XML fragment, `{ "value": "before<f:b xmlns:f=\"urn:foreign\">bold</f:b>after" }`.
- Several siblings with the same name are an array, a single one is a value. Unlike declared elements,
  the form therefore depends on how often the name occurs in this sample.

A name used by two namespaces among siblings, an attribute and a child of the same local name, and
wildcard elements named like a declared element of the same object are refused. Names like the text
property follow [the text property](#the-text-property) here too. The generator does not pick global
elements or placeholder names that a declared element of the same object uses, nor names that wildcard
content of another namespace already uses there. It does not invent attributes for `xs:anyAttribute`.

### Collisions

For

```xml
<a:R xmlns:a="urn:example:a" xmlns:b="urn:example:b" rows="3"><a:raceCode>x</a:raceCode><b:raceCode>y</b:raceCode><a:rows>r</a:rows></a:R>
```

where the schema declares `a:raceCode`, an optional `b:raceCode`, `a:rows` and the attribute `rows`, compact
JSON is

```json
{ "@rows": 3, "{urn:example:a}raceCode": "x", "{urn:example:b}raceCode": "y", "rows": "r" }
```

and a sample without `b:raceCode` keeps `{urn:example:a}raceCode`. Mixed content keeps its elements in the text
property, so its attributes keep their names. Keys starting with `@`, `{` or `#` cannot be element names.

### Refusals

A collision the content model does not show, such as wildcard content of two namespaces, leaves XML
intact, sets `jsonStatus` to `unavailable`, and adds a `json-mapping` diagnostic. Tree mode is the
alternative.

Numbers are checked before conversion. An unsafe integer, a non-finite value or a decimal whose serialized
JavaScript number would change the decimal value is refused. `xs:double` and `xs:float` are no decimals: the
value of an `xs:double` is the double nearest to its text, so every finite double has its JSON number, also
`2.7457332729808998E126`. An `xs:float` value is the nearest 32-bit float; its JSON number is the double read
from the text, and it is refused only where that double rounds to another float or beyond the float range. A
union value follows the member that reads it. The value generator stays in the exact range
when the bounds allow it, so this concerns fixed values, custom values and bounds beyond that range.
`numbers: 'string'` keeps all numeric lexical values as JSON strings. It changes the JSON contract and will
not satisfy a schema expecting numbers.

Compact JSON cannot preserve the ordering of interleaved child elements or every XML lexical detail.
It is not a general, reversible XML-to-JSON mapping. Use tree mode for those consumers.

## Tree JSON

`json: { mode: 'tree' }` returns the generated instance tree as ordinary JSON. It keeps:

- Namespace URI and local name for each element and attribute.
- Ordered child nodes, including text.
- Lexical strings and their intended JSON type.
- Repeatability, repeated-group occurrence and mixed-content metadata, and markers for list values, nil
  elements and wildcard content.
- For a simple value whose spelling differs from what the validator reads, `normalized` with that value, and
  `binary` (`float` or `double`) for values of those types.
- The planned compact key as `key` where it differs from the local name, and `anyType` for elements of that
  type; `typeable` where the type has alternatives `xsi:type` could name.

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
