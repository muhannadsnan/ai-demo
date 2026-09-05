# Scheduling the import jobs

You already run imports on a schedule at work: cron fires at 01:15 and runs
`php index.php import:price-lists`. Nothing about that changes here. The only
new question containers introduce is **where the scheduler lives**.

**Docker has no scheduler.** It cannot run anything at a time — it only starts
containers when something tells it to. The clock always lives somewhere else.

## The one decision

```
   Option A — the clock lives INSIDE a container
   ┌──────────────────────────────┐
   │ container (always running)   │
   │   cron daemon                │        ✗ avoid
   │     └─ 01:15 → import        │
   └──────────────────────────────┘

   Option B — the clock lives on the HOST
   ┌───────────────┐   01:15    ┌────────────────────────┐
   │ host          │ ─────────► │ container starts,      │   ✓ do this
   │ cron / systemd│            │ runs the import,       │
   │               │ ◄───────── │ exits, disappears      │
   └───────────────┘  exit code └────────────────────────┘
```

## Why not option A

It looks tidier — everything in one box — and it is a trap:

- Container logs show what the *main* process prints. Cron prints nothing; it
  mails output to a local mailbox nobody reads. `docker logs` stays empty and a
  failing import is silent for weeks.
- Cron does not inherit the container's environment variables, so your database
  password is simply absent when the job runs.
- The container must stay running all day to hold a clock, occupying memory
  around the clock to do something for six minutes a night.

## Why option B

The host already has a scheduler that works, that you trust, and whose logs you
know how to read. Let it start a container per run.

Your command changes by one line:

```bash
# at work, today
php index.php import:price-lists

# here
docker compose run --rm ingest import price-lists
```

`--rm` means the container is deleted when the job finishes. Between runs it
occupies nothing — which matters when PostgreSQL is using most of the RAM.

Running it by hand is the *identical* command, which is what you want at 08:00
when the overnight run failed and you need to re-drive it.

## Plain cron

Simplest option. Put this in `crontab -e`:

```cron
15 1 * * *  cd /opt/app/server-drift && docker compose run --rm ingest import price-lists >> /var/log/import.log 2>&1
```

Works fine. You lose a schedule overview and structured logs.

## systemd timers

Slightly more setup, meaningfully better to operate. Two files per job.

`/etc/systemd/system/import-prices.service` — *what* to run:

```ini
[Unit]
Description=Import partner price lists

[Service]
Type=oneshot
WorkingDirectory=/opt/app/server-drift
ExecStart=/usr/bin/docker compose run --rm ingest import price-lists
```

`/etc/systemd/system/import-prices.timer` — *when* to run it:

```ini
[Unit]
Description=Run the price list import nightly

[Timer]
OnCalendar=*-*-* 01:15:00
Persistent=true

[Install]
WantedBy=timers.target
```

Then:

```bash
sudo systemctl enable --now import-prices.timer

systemctl list-timers              # every job and its next run, in one view
journalctl -u import-prices -f     # real logs, with exit codes
sudo systemctl start import-prices # run it right now, by hand
```

What this buys over cron:

| | cron | systemd timer |
|---|---|---|
| See the whole schedule | read the crontab | `systemctl list-timers` |
| Logs | wherever you redirected them | `journalctl`, with exit codes |
| Missed run (server was down) | skipped silently | `Persistent=true` runs it at boot |
| Run manually | retype the command | `systemctl start <name>` |
| Prevent overlapping runs | `flock`, by hand | built in |

That last row matters for imports specifically: if last night's run is somehow
still going, cron cheerfully starts a second one on top of it.
