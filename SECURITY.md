# Input boundaries

The Node.js reader loads local files only. Its default boundary is the directory where the entry XSD is
named, also when the entry is a symlink. Use `baseDirectory` or `--base-dir` to include a larger schema
directory deliberately. A location outside that boundary is an `unsafe-input` error and is not read: a path
that escapes it, a symlink that leads out of it (the entry's included), an absolute path or a `file:` URI.
HTTP URLs are not downloaded; they are `missing-file`. To use an externally named schema, supply its text
through the in-memory API or a reader you control.

The file reader decodes a schema file by its byte order mark and XML declaration: UTF-8 (the default),
UTF-16 with a byte order mark, ISO-8859-1 (each byte its code point) and US-ASCII. Another encoding is
`unsupported-encoding`; bytes that do not decode, or a byte order mark the declaration contradicts, are
`invalid-xml`. No replacement character stands in for an undecodable byte. A text passed to the in-memory
API is already decoded, so its declared encoding is not read. Parser and validator get the same decoded text,
its declaration saying UTF-8.

No DTD reaches the XML parser or the validator. A schema document may have one DOCTYPE of a narrow, inert
form, one that restates the namespace declarations of the `schema` element and declares unused entities:
comments, unused general entities with a purely literal value, unused empty parameter entities, and CDATA
ATTLIST defaults for namespace attributes that the `schema` element already writes with the same value. Its
PUBLIC or SYSTEM identifier is never read. Such a DOCTYPE is replaced by spaces, keeping line numbers, for
parsing and validation alike, and reported once per file as the warning `neutralized-doctype`. Every other
DOCTYPE, an entity reference of its own in the document, and any other markup declaration are `unsafe-input`
errors. The scan follows the XML grammar where it decides: a comment ends at the first `-->` after `<!--`, so
a DOCTYPE quoted in a comment is ignored; white space stands where XML requires it; names consist of XML name
characters, of any length; an entity value with `<` is not literal. A second byte order mark or anything
before the XML declaration is `invalid-xml`. The scan reads the text once.

A schema set is limited to 4 MiB per file, 16 MiB in total and 128 documents by default. `limits`
(`maxFileBytes`, `maxTotalBytes`, `maxDocuments`; CLI `--max-file-bytes`, `--max-total-bytes`,
`--max-documents`) changes them, with positive safe integers only; no value means unlimited, and `limits`
itself must be a plain object. The file reader counts the bytes of the file and checks its size before
reading; a text from the in-memory API counts its UTF-8 bytes. `maxFileBytes` applies to each file once;
each further parse copy of a chameleon document counts as a document and with its bytes against
`maxTotalBytes` again. An exceeded limit is a `resource-limit` error naming the
effective value. Generated instances default to 10,000 elements and a hard depth of 64. Optional
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

Do not put real health, customer or financial records into example fixtures. Profile values are synthetic
but are not promised to be globally unique, non-deliverable postal addresses or valid business identifiers.
Use private disclosure through the repository owner's contact channel for security-sensitive reports;
do not attach secrets or customer files to public issues.
