#!/usr/bin/env bash
#
# Apply pending SQL migrations, in order, exactly once each.
#
# Deliberately a shell script and not a framework. The whole mechanism is:
# a table recording which files have run, and a loop that runs the ones that
# have not. That is all any migration tool does, and having it visible is worth
# more here than a dependency.
#
#   ./migrate.sh            apply pending migrations
#   ./migrate.sh status     show what has run and what has not
#
# Uses the db container, so no psql needed on the host.

set -euo pipefail
cd "$(dirname "$0")"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.local.yml}"
DB_USER="${POSTGRES_USER:-app}"
DB_NAME="${POSTGRES_DB:-nordata}"

psql_run() {
  docker compose -f "$COMPOSE_FILE" exec -T db \
    psql -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$DB_NAME" "$@"
}

# The ledger. Every migration tool has one; ours is four columns.
psql_run -c "
  SET client_min_messages = warning;
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    text        PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    duration_ms integer
  );" > /dev/null

applied() { psql_run -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$1';"; }

if [[ "${1:-apply}" == "status" ]]; then
  printf '%-28s %s\n' "MIGRATION" "STATUS"
  for f in migrations/*.sql; do
    name=$(basename "$f")
    if [[ -n "$(applied "$name")" ]]; then
      printf '%-28s %s\n' "$name" "applied"
    else
      printf '%-28s %s\n' "$name" "PENDING"
    fi
  done
  exit 0
fi

pending=0
for f in migrations/*.sql; do
  name=$(basename "$f")
  [[ -n "$(applied "$name")" ]] && continue

  echo "applying $name"
  start=$(date +%s%3N)

  # Each migration runs inside a single transaction. If it fails halfway, the
  # whole file rolls back and the ledger is not written — so a failed migration
  # leaves the database exactly as it was, and re-running is safe.
  {
    echo "BEGIN;"
    cat "$f"
    echo "INSERT INTO schema_migrations (filename, duration_ms) VALUES ('$name', 0);"
    echo "COMMIT;"
  } | psql_run > /dev/null

  ms=$(( $(date +%s%3N) - start ))
  psql_run -c "UPDATE schema_migrations SET duration_ms = $ms WHERE filename = '$name';" > /dev/null
  echo "  ok (${ms}ms)"
  pending=$((pending + 1))
done

[[ $pending -eq 0 ]] && echo "nothing to apply — schema is up to date"
exit 0
