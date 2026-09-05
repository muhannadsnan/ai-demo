# Incident Runbook

## Severity levels

- **Sev 1** — customers cannot place orders, or money is being mis-charged.
  Page immediately, wake people up, all hands.
- **Sev 2** — a partner integration is down, or imports have failed for more
  than one cycle. Handle during business hours unless it is peak season.
- **Sev 3** — degraded but working. Ticket it.

## Orders stuck in `validated`

Almost always the warehouse assignment worker has died. Check
`supervisorctl status order-assign`. If it is stopped, restart it and then
re-drive the backlog with `php index.php orders reassign --state=validated`.
If the worker is running but the backlog is growing, the usual cause is a stock
service timeout; check the Order Service logs for `stock_check_timeout`.

## Bus queue depth alarm

The alarm fires when the Redis list `bus:outbound` exceeds 10,000 entries.
First check whether a single partner is failing and blocking a worker: run
`php index.php bus stats --by-partner`. A single slow partner can occupy several
workers because delivery is synchronous. The mitigation is to pause that partner
with `php index.php bus pause --partner=`, drain the rest, then resume.

## Import did not run

Check cron on the Import Runner host first, then disk space in `/var/imports`,
which has filled twice because the 90 day retention cleanup silently failed.
If the source file simply never arrived, do not fabricate an empty run; leave
the job unrun so the reconciliation report continues to flag it.

## Certificate expiry

Mutual TLS partner certificates expire in April. The symptom is a sudden
`SSL peer certificate` error for exactly one partner, with everything else
healthy. Renewal requires contacting the partner's technical contact, which
typically takes two to five working days, so start in February.

## Escalation

If a Sev 1 is not understood within 45 minutes, escalate to the platform lead.
If customer data may have been exposed or corrupted, notify the data protection
officer the same day regardless of severity; this is a GDPR requirement and the
72 hour clock starts at the moment of awareness, not at the moment of diagnosis.
