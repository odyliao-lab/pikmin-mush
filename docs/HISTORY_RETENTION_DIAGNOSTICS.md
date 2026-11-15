# Read-only job retention diagnostics

`GET /api/admin/retention/diagnostics?after=0` uses the existing signed-in
administrator check only. Controller credentials do not authorize it. Responses
are private/no-store, contain no row payloads, and do not enable cross-origin
reads. There is no write method, schema migration, refresh, arbitrary SQL/table
selection, or change to retention. Errors return a generic 503.

Each call examines at most five jobs in ascending primary-key order after a
validated numeric cursor. A sixth ID is read only to determine `hasMore`.
Eligibility is evaluated only after this bounded candidate selection. Use the
returned `nextCursor` for the next page. There is no automatic pagination.
`scope: job_id_page`, `snapshot: false`, `truncated`, and `stopReason` explicitly
identify scope and incomplete results. A page is not the full pending backlog.
Concurrent changes mean pages must not be treated as a transaction snapshot.

Categories distinguish retention window, nonterminal state, latest job and child
references. Eligible jobs are measured inside D1; no plan, config, location,
message, recovery JSON, or list of row IDs is returned. The cursor is a numeric
continuation token only. `oversize_raw_lower_bound` proves the recovery record is
too large using the sum of raw TEXT byte lengths, without constructing its JSON.
A smaller lower bound does not prove the row fits: remaining rows use the exact
same JSON field representation as the current archive schema, with a 500000-byte
per-row raw-input guard. Before JSON construction, the sum of raw text bytes
multiplied by six plus a conservative 4096-byte fixed-schema overhead must fit
within the remaining 2 MiB JSON work budget. The same raw-byte bound is rechecked
inside SQL to guard concurrent growth. This upper bound is reserved after each
measurement. Conservative budget rejections remain explicitly unclassified.
`oversize_backup_json` and `within_backup_row_limit` use exact JSON lengths.
Unmeasured rows are explicitly unclassified. Schema drift fails closed until the
fixed column allowlist is reviewed against the recovery format. Every column is
checked with SQLite typeof, including again inside the JSON CASE guard; unexpected
TEXT/BLOB in numeric columns (or non-TEXT in text columns) is unclassified_type
and cannot bypass the size budget.

The two-second budget stops issuing new work; it cannot interrupt a running D1
statement. Five-row primary-key selection bounds row count, and SQL CASE guards
bound worst-case JSON construction even if a row changes between queries. Measuring raw
TEXT byte lengths still incurs database I/O, potentially for a large row.
Do not repeatedly poll or exhaustively paginate during overload. These limits
are per request, not global rate limiting. This diagnostic does not establish
that any particular production job is oversized until its page is observed.

All 500 KB row / 2 MiB archive batch / atomic backup / lease / retention period
protections are unchanged. A fit classification does not authorize deletion.
