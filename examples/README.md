# Examples

All schemas and value overrides in this directory are synthetic. They are test fixtures, not official
industry formats or production records.

| Example   | Entry                    | What it demonstrates                                                                                                                               |
| --------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retail    | `retail/order.xsd`       | Imports/includes, choices, groups, attributes, inheritance, mixed content and wildcards                                                            |
| Insurance | `insurance/claim.xsd`    | Constrained identifiers, monetary simple content and alternative claim shapes                                                                      |
| Logistics | `logistics/shipment.xsd` | An address, repeated packages, weight constraints and transport choices                                                                            |
| Order     | `order/order.xsd`        | Office supplies order with locale data and bounded values; used in the [development walkthrough](../docs/development.md#a-walk-through-one-schema) |

Each `generated/` directory contains three paired XML/JSON files and the `manifest.json` written by the
CLI. A choice coverage report is scoped to encountered choices; it is not every possible branch
combination. The XML and JSON in a pair come from one instance tree.

From the repository root, after `npm run build`, reproduce the files with this command (shown for
insurance; retail and logistics use their own entry):

```sh
node dist/bin.js examples/insurance/claim.xsd --locale en \
  --optional-elements all --optional-attributes all --repeat 2 --seed 7 \
  --count 3 --coverage --format both --out-dir insurance-check
diff -r examples/insurance/generated insurance-check
```

The CLI never writes into an existing directory, so generate into a new one and compare. An empty diff
confirms that the checked-in files match the current source build and recorded options.
The locale data comes from the `xsd-faker-locales` package in `packages/locales`, not from these example
folders.

`values.json` shows optional local-name value overrides. Add `--values examples/insurance/values.json`
to use them; doing so intentionally changes the generated fixture.
