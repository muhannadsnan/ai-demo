#!/usr/bin/env bash
#
# Single entry point for scheduled imports. systemd calls this with a job name.
#
#   ./run-import.sh oppdateringer
#
# Kept as a script rather than putting the node commands in the unit files, so
# that the schedule and the work stay separate: changing what a job does never
# means touching systemd, and running a job by hand is the same command the
# timer runs.

set -euo pipefail
cd "$(dirname "$0")"

export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

case "${1:-}" in
  # Daily. Asks Brreg what changed and fetches only those companies.
  oppdateringer) exec node ingest/import-oppdateringer.mjs --maks 20000 --throttle 120 ;;

  # Weekly. The complete file: catches anything the change feed missed, and
  # drives the savnet/slettet reconciliation.
  enheter)       exec node ingest/import-enheter.mjs ;;
  roller)        exec node ingest/import-roller.mjs ;;

  # Weekly. Small lookup tables.
  referansedata) exec node ingest/import-reference.mjs ;;

  # Monthly. Refreshes accounts older than 90 days for companies already known.
  regnskap)      exec node ingest/fetch-regnskap.mjs --stale 90 --limit 2000 --throttle 1000 ;;

  # Daily, after the incremental update has landed. Refreshes the two
  # materialised views and recomputes the toplists, so the pages read small
  # finished tables instead of aggregating five million accounting rows and
  # three million shareholdings per visitor.
  topplister)    exec node ingest/generer-topplister.mjs ;;

  # Daily. Embeds descriptions that are new or rewritten since last time; the
  # content hash means a normal night is a few thousand rows, not a million.
  embedding)     exec node ingest/embed-foretak.mjs ;;

  # Everything, in dependency order. This is the "the machine has been off for
  # months and I need current data" button.
  #
  # It works because the daily job is cursor-based: import-oppdateringer.mjs
  # remembers the last oppdateringsid it handled, so a gap of one day and a gap
  # of six months are the same operation — start where you stopped and keep
  # going. --maks 0 removes the per-run event cap, which exists to keep a
  # nightly run short and is exactly wrong when catching up.
  #
  # The full files run first anyway, so even if the change feed had aged out
  # entirely the data would be complete; the cursor then only has to cover what
  # changed since the files were published.
  alt)
    set -x
    ./run-import.sh referansedata
    ./run-import.sh enheter
    ./run-import.sh roller
    node ingest/import-oppdateringer.mjs --maks 0 --throttle 120
    ./run-import.sh regnskap
    ./run-import.sh topplister
    ./run-import.sh embedding
    ;;

  *) echo "ukjent jobb: ${1:-<ingen>}" >&2
     echo "gyldige: oppdateringer enheter roller referansedata regnskap topplister embedding alt" >&2
     exit 64 ;;
esac
