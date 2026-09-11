#!/usr/bin/env bash
#
# Install the import timers. Run on the SERVER, not on a laptop.
#
#   sudo ./systemd/install.sh /opt/nordata
#
# Verify afterwards with:
#   systemctl list-timers 'nordata@*'
#   journalctl -u nordata@oppdateringer -f
#   sudo systemctl start nordata@oppdateringer     # run one by hand

set -euo pipefail
ROT="${1:-/opt/nordata}"
[[ $EUID -eq 0 ]] || { echo "må kjøres som root"; exit 1; }
[[ -d "$ROT/server-drift" ]] || { echo "fant ikke $ROT/server-drift"; exit 1; }

cd "$(dirname "$0")"

# The service template hardcodes a path; rewrite it to wherever the project is.
sed "s|/opt/nordata|$ROT|g" nordata@.service > /etc/systemd/system/nordata@.service
# Every timer, daily and periodic. The full-file jobs are safe to schedule now
# that they download their own source conditionally. Before that they read a
# file somebody had fetched by hand, and running them against a stale snapshot
# would have marked every company registered since as missing and retired it
# once the grace period passed.
TIMERE="${TIMERE:-oppdateringer regnskap embedding topplister enheter roller referansedata}"

for navn in $TIMERE; do
  cp "nordata@$navn.timer" /etc/systemd/system/
done

systemctl daemon-reload
for navn in $TIMERE; do
  systemctl enable --now "nordata@$navn.timer"
  echo "  aktivert nordata@$navn.timer"
done

echo
systemctl list-timers 'nordata@*' --no-pager
