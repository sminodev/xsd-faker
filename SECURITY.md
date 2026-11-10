# Input boundaries

The Node.js reader loads local files only. Its default boundary is the entry XSD's directory. Use
`baseDirectory` or `--base-dir` to include a larger schema directory deliberately. Imports and symlinks
cannot escape that boundary. HTTP URLs are not downloaded. To use an externally named schema, supply
its text through the in-memory API or a reader you control.

Schema input containing a DOCTYPE is rejected. A schema set is limited to 128 documents, 2 MiB per file
and 16 MiB in total. Generated instances default to 10,000 elements and a hard depth of 64. Optional
expansion has a separate depth limit and consumes the same node budget. Excessive content is an error,
not permission to omit it.
Pattern generation also has work and output limits. These limits restrict allocations; they are not a
security sandbox or a guarantee against every expensive regular expression.

A custom `ValueSource`, schema reader or validator is application code. Run only callbacks you trust.
For untrusted schemas or service deployments, put generation and validation in a separately limited
process with an execution deadline. Do not expose this package directly as an unrestricted public service.

The CLI does not overwrite files or output directories. It writes no instance files when generation or
required JSON projection fails. Template and unvalidated output require explicit options and are labelled
accordingly in directory exports (stderr warns for stdout or `--out`). Incomplete choice coverage may
write valid samples and still exit with code 2. Schema-location attributes are references, not proof of validation.

Do not put real health, customer or financial records into example fixtures. Profile values are synthetic
but are not promised to be globally unique, non-deliverable postal addresses or valid business identifiers.
Use private disclosure through the repository owner's contact channel for security-sensitive reports;
do not attach secrets or customer files to public issues.
