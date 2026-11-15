# Input boundaries

The Node.js reader loads local files only. Its default boundary is the directory containing the entry
XSD path, even if the entry is a symlink. Use `baseDirectory` or `--base-dir` to allow access to a larger
schema directory. Paths and symlinks that escape the boundary are rejected with `unsafe-input`, including
an entry symlink that points outside it. Absolute paths and `file:` URIs in schema references are also
rejected. HTTP URLs are not downloaded and produce `missing-file`. To use an externally named schema,
supply its text through the in-memory API or a reader you control.

The file reader uses the byte order mark and XML declaration to decode UTF-8 (the default), UTF-16 with
a byte order mark, ISO-8859-1 and US-ASCII. Other encodings produce `unsupported-encoding`. Undecodable
bytes and conflicts between the byte order mark and declaration produce `invalid-xml`; invalid bytes
are never replaced silently. Text supplied to the in-memory API is already decoded. The parser and
validator receive the same text, with its encoding declaration set to UTF-8.

No DTD reaches the XML parser or validator. A schema document may contain one inert DOCTYPE with:

- Comments.
- Unused general entities with literal values containing no `&`, `%` or `<`.
- Unused, empty parameter entities.
- CDATA ATTLIST defaults for namespace attributes already present on the `schema` element with the same values.

PUBLIC and SYSTEM identifiers are never fetched. An allowed DOCTYPE is replaced with spaces before
parsing and validation, preserving line numbers, and produces one `neutralized-doctype` warning per file.
Other DOCTYPE declarations, references to custom entities and other markup declarations produce
`unsafe-input`. A DOCTYPE inside a comment is ignored. A second byte order mark or content before the
XML declaration produces `invalid-xml`. The DOCTYPE scan takes time proportional to the input length.

A schema set is limited to 4 MiB per file, 16 MiB in total and 128 documents by default. `limits`
(`maxFileBytes`, `maxTotalBytes`, `maxDocuments`; CLI `--max-file-bytes`, `--max-total-bytes`,
`--max-documents`) overrides these defaults. Each limit must be a positive safe integer; unlimited values are not
supported. `limits` must be a plain object. The file reader counts the bytes of the file and checks its size before
reading; text from the in-memory API is measured in UTF-8 bytes. `maxFileBytes` applies to each file once.
A chameleon schema is parsed separately for each namespace into which it is included; each copy counts
toward `maxDocuments`, and its bytes count toward `maxTotalBytes`. Exceeding a limit produces a
`resource-limit` error naming the effective value.

Generated instances default to a limit of 10,000 elements and a hard depth of 64. Optional
expansion has a separate depth limit and consumes the same node budget. XML validation may use up to
2 GiB of WebAssembly memory. Excessive content is an error, not permission to omit it.
Pattern generation also has work and output limits. These limits restrict allocations; they are not a
security sandbox or a guarantee against every expensive regular expression.

A custom `ValueSource`, schema reader or validator is application code. Run only callbacks you trust.
For untrusted schemas or service deployments, put generation and validation in a separately limited
process with an execution deadline. Do not expose this package directly as an unrestricted public service.

The CLI does not overwrite files or output directories. It writes no instance files when generation or
required JSON projection fails. Template and unvalidated output require explicit options and are labelled
accordingly in directory exports (stderr warns for stdout or `--out`). Incomplete choice coverage may
write valid samples and still exit with code 2. Schema-location attributes are references, not proof of validation.

Do not put real health, customer or financial records into example fixtures. Generated data is synthetic;
values may repeat across samples or coincide with real names, addresses or identifiers.
XSD validity does not imply business validity.
Use private disclosure through the repository owner's contact channel for security-sensitive reports;
do not attach secrets or customer files to public issues.
