# Import Routines

## Overview

The Import Runner pulls partner data files, validates them, and loads them into
staging tables before Core promotes them into production tables. Nothing is ever
written directly from a file into a production table.

## Schedule

| Job | Schedule (Europe/Oslo) | Source |
|---|---|---|
| `import:price-lists` | 01:15 daily | SFTP, CSV |
| `import:stock-levels` | every 30 minutes | Partner REST API |
| `import:carrier-tracking` | 02:00 and 14:00 | SFTP, fixed width |
| `import:customs-codes` | 03:30 Mondays | SFTP, XML |

Jobs are triggered by cron on the Import Runner host. They are not distributed;
if that host is down, nothing runs and there is no alert until the daily
reconciliation report at 07:00 notices missing data.

## The staging pattern

Every import follows the same four phases:

1. **Fetch** — download to `/var/imports/incoming/{job}/{date}/`. Files are kept
   for 90 days for audit purposes.
2. **Parse and validate** — row-level validation into `staging_{entity}`. Rows
   that fail validation are written to `staging_{entity}_rejects` with a reason
   code; they do not abort the run.
3. **Reconcile** — compare staging against production and compute the delta.
4. **Promote** — apply the delta inside a single transaction.

A run is considered failed if more than 5 percent of rows are rejected. In that
case promotion is skipped entirely and the run is marked `needs_review`.

## Encoding problems

Partner files are inconsistently encoded. The parser attempts UTF-8 first, then
ISO-8859-1, then Windows-1252. Norwegian characters æ, ø and å are the usual
casualty. Two partners send UTF-8 with a byte order mark, which must be stripped
before the first column is read or the header match fails silently.

## Idempotency

Imports are safe to re-run for the same file. The runner records a SHA-256 hash
of each processed file in `import_file_log`. Re-processing an already-seen hash
logs a warning and exits with status 0. To force a re-run, pass `--force`, which
skips the hash check but not the staging phases.

## Common failure causes

The three most common causes of a failed import, in order of frequency: partner
changed a column order without notice; SFTP credentials rotated without telling
us; a file arrived truncated because the partner uploaded while we were pulling.
The third is mitigated by requiring partners to write a `.done` marker file,
which about half of them actually do.
