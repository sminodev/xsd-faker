# Contributing

Use Node.js 22.13 or later and install the locked dependencies with `npm ci`.
The [development guide](docs/development.md) describes the source layout and test suites.

Keep a pull request focused. For a behaviour change, add a small XSD and a regression test that fails
without the change. Check the resulting XML with a real XSD validator; a snapshot alone is not enough.
Documentation-only changes do not need an artificial code test.

Run `npm run verify` and `npm run format:check`. Update the relevant documentation when an option,
output rule or supported feature changes. Keep limitations visible rather than accepting a plausible
but unvalidated sample.

Do not add real customer, patient or production data to examples. Keep third-party schema licences and
attributions with any fixture you add. Use synthetic schemas when they demonstrate the same behaviour.
