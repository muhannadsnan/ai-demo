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
cp nordata@*.timer /etc/systemd/system/

systemctl daemon-reload
for t in nordata@*.timer; do
  systemctl enable --now "$t"
  echo "  aktivert $t"
done

echo
systemctl list-timers 'nordata@*' --no-pager
