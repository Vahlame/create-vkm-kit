# Domain: data & SQL

Load this when the task runs against a database or dataset — SELECT/DML/DDL, migrations, ETL, cleaning,
deduplication, analysis (relational or document stores).

## Deliver a better result

1. **Rehearse every destructive DML/DDL before you run it:** run the SELECT with the SAME `WHERE` first
   and record the row count; have a restorable backup or a rehearsed `ROLLBACK`. After the
   UPDATE/DELETE, compare affected rows to that count — a mismatch is an immediate `ROLLBACK`.
2. **Zero string-concatenation of external input into SQL** — 100% parameterized/placeholders. One
   concatenation is a blocking defect.
3. **Validate with aggregates, not "a few rows that look fine":** counts by group, control sums,
   min/max, nulls per column — before and after. Put the numbers in the deliverable.
4. **Conserve data:** input rows = output rows + justified excluded rows.
5. **Check the plan on big tables** (`EXPLAIN`/`EXPLAIN ANALYZE`) — an unjustified full scan needs an
   index or a rewrite. Test on real volume, not the dev sample.
6. **Migrations are reversible** (a down script) or preceded by a verified restorable backup.

## Edge cases (profile or test each)

- NULL in a filter/join → decide with the user whether NULL enters the criterion; record it.
- Duplicates in a "unique" key → `COUNT(DISTINCT)` vs `COUNT(*)`; stop and dedup before transforming.
- Empty string vs NULL → normalize with an explicit, documented rule.
- Boundary dates (month/year end, DST) → pin an explicit timezone in the query; don't "fix" the datum.
- Encoding / non-ASCII → fix at ingestion (the source), not by patching the output.
- Empty table → the pipeline ends cleanly with 0 rows, no crash.

## Anti-patterns

- ❌ Running an UPDATE/DELETE on the live DB "because the WHERE is obvious" → SELECT-count → backup → run → compare.
- ❌ Validating a transform by eyeballing rows → validate with aggregates.
- ❌ Assuming one timezone or that keys "can't" duplicate → profile first (`COUNT(DISTINCT)`, dated ranges).
