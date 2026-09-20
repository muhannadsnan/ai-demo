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

# ---------------------------------------------------------------- wait for net
#
# Every job here talks to a public API, and on this machine they fire the second
# it wakes from suspend — measured to the second:
#
#   11:28:04  Starting nordata@oppdateringer
#   11:28:04  PM: suspend exit
#   11:28:05  NetworkManager: enp7s0 unmanaged -> unavailable
#   11:28:05  Failed with result 'exit-code'
#   11:28:05  Link is Down
#
# The job died before the interface came back. systemd's network-online.target
# cannot help: it was reached on the last boot and stays active, so it is not
# re-evaluated on resume and `Wants=`/`After=` are no-ops. Restart=on-failure
# does recover it, but fifteen minutes later and with a failed run on the
# status page for something that was never broken.
#
# So the check belongs here, where it works for boot and resume alike: ask the
# host we are about to use whether it is reachable, and wait if it is not.
# A real endpoint, not the host root: https://data.brreg.no/ resets the
# connection, so checking it would have failed forever and made every job wait
# out the timeout — a worse failure than the one being fixed. This one answers
# 200 in about 120 ms and returns a single row.
PROVE_URL="https://data.brreg.no/enhetsregisteret/api/kommuner?size=1"

# 60 x 5s = five minutes: longer than any resume takes, short enough that a
# genuinely offline machine fails today rather than hanging until the unit's
# two-hour timeout.
MAKS_FORSOK=60
PAUSE=5

vent_paa_nett() {
  local forsok=0
  until curl -sSf -o /dev/null --max-time 5 "$PROVE_URL" 2>/dev/null; do
    forsok=$((forsok + 1))
    if [ "$forsok" -ge "$MAKS_FORSOK" ]; then
      echo "nettverket kom ikke opp innen $((MAKS_FORSOK * PAUSE))s — avbryter" >&2
      exit 1
    fi
    [ "$forsok" = 1 ] && echo "venter på nettverk …"
    sleep "$PAUSE"
  done
  [ "$forsok" -gt 0 ] && echo "  nettverk oppe etter $((forsok * PAUSE))s"
  return 0
}

# Jobs that read only from the local database need no network.
case "${1:-}" in
  topplister) ;;
  *) vent_paa_nett ;;
esac

case "${1:-}" in
  # Daily. Asks Brreg what changed and fetches only those companies.
  oppdateringer) exec node ingest/import-oppdateringer.mjs --maks 20000 --throttle 120 ;;

  # Weekly. The complete file: catches anything the change feed missed, and
  # drives the savnet/slettet reconciliation.
  enheter)       exec node ingest/import-enheter.mjs ;;
  roller)        exec node ingest/import-roller.mjs ;;

  # Weekly. Small lookup tables.
  referansedata) exec node ingest/import-reference.mjs ;;

  # Daily. Fetches accounts for companies the register says have filed a year
  # we do not hold — enheter.siste_innsendte_aarsregnskap, kept current by the
  # oppdateringer job above. Quiet most of the year, busy April to July when
  # filings are due. Measured at 87 companies/sec: the initial backlog of 4,850
  # took 59 seconds.
  regnskap)      exec node ingest/fetch-regnskap.mjs --nye ;;

  # One-off, and again if the data is ever suspect. Refetches every company
  # that has ever filed, ~1.4 hours at the default concurrency. This is about
  # correctness rather than freshness: the bulk history calls every row NOK,
  # and the API says otherwise for about one percent of them.
  regnskap-alle) exec node ingest/fetch-regnskap.mjs --alle ;;

  # Monthly backstop for what the filing signal cannot see — a company
  # restating a year we already hold does not change the year number.
  regnskap-gamle) exec node ingest/fetch-regnskap.mjs --stale 180 --limit 20000 ;;

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
     echo "gyldige: oppdateringer enheter roller referansedata regnskap regnskap-alle regnskap-gamle topplister embedding alt" >&2
     exit 64 ;;
esac
