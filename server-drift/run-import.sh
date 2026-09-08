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

  # Daily, after the incremental update has landed. Recomputes the 20 toplists
  # so the pages read one small table instead of aggregating five million
  # accounting rows per visitor.
  topplister)    exec node ingest/generer-topplister.mjs ;;

  *) echo "ukjent jobb: ${1:-<ingen>}" >&2
     echo "gyldige: oppdateringer enheter roller referansedata regnskap topplister" >&2
     exit 64 ;;
esac
