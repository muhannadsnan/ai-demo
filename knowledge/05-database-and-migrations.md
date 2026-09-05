# Database and Migrations

## Conventions

MySQL 8.0, InnoDB, `utf8mb4_0900_ai_ci` collation on all new tables. Older
tables created before 2019 are `utf8mb3` and are converted opportunistically
when they are touched for other reasons.

Table names are plural snake_case. Primary keys are `id`, unsigned bigint,
auto increment. Foreign keys are named `{table_singular}_id`. Every table has
`created_at` and `updated_at`; soft deletes use a nullable `deleted_at`.

## Migration policy

Migrations live in `application/migrations/` and use the CodeIgniter migration
class with sequential numbering. Rules that are enforced in code review:

- One logical change per migration file.
- Every migration must have a working `down()`. A migration that cannot be
  reversed must say so explicitly in a comment and be approved by a second
  developer.
- No data migrations in the same file as schema migrations. Data backfills run
  as separate CLI commands so they can be resumed.

## Large table changes

Any `ALTER TABLE` on a table above 10 million rows must use `pt-online-schema-change`
rather than a direct ALTER. Direct ALTERs on `order_events`, `bus_processed_messages`
and `invoice_lines` have caused production locking incidents and are blocked by
review policy.

The five largest tables as of the last review:

| Table | Approximate rows |
|---|---|
| `order_events` | 400 million |
| `bus_processed_messages` | 90 million |
| `invoice_lines` | 62 million |
| `stock_movements` | 38 million |
| `import_file_log` | 4 million |

## Backups

Full backup nightly at 00:30, binlogs shipped continuously, retention 35 days.
Restore has been tested twice; the last successful full restore test took
4 hours 20 minutes for the primary schema. Point-in-time recovery has never
been exercised in a drill, which the architecture review flagged as a gap.

## Connection handling

Core uses persistent connections through CodeIgniter's database driver, with a
pool effectively bounded by PHP-FPM worker count (currently 120 across three web
nodes). `max_connections` on the primary is 500. The read replica is used only
for reporting queries and the nightly reconciliation report, never for anything
in a request path, because replication lag regularly reaches 30 seconds during
the import window.
