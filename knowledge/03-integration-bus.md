# Integration Bus

## What it does

The Integration Bus routes messages between internal services and external
partners. It is not a general purpose broker: it is a PHP worker pool reading
from Redis lists, with routing rules stored in the `bus_routes` MySQL table.

## Message shape

Every message is a JSON envelope:

```
{
  "message_id": "uuid v4",
  "type": "order.dispatched",
  "occurred_at": "ISO 8601 UTC",
  "partner_id": 42,
  "payload": { }
}
```

The `message_id` is the idempotency key. Consumers must record processed ids in
`bus_processed_messages` and ignore repeats. Retention on that table is 30 days,
enforced by a nightly cleanup job.

## Delivery guarantees

Delivery is at-least-once, never exactly-once. A partner endpoint that is slow
but eventually succeeds will frequently receive the same message twice, because
the worker's HTTP timeout is 10 seconds while some partners take longer.

## Retry policy

Failed deliveries retry with exponential backoff: 1 minute, 5 minutes, 25
minutes, 2 hours, 10 hours. After the fifth failure the message is moved to the
`bus_failed` table and an alert is raised in the `#integrations` Slack channel.
There is no automatic dead-letter replay; failed messages are replayed manually
using `php index.php bus replay --id=`.

## Partner authentication

Three authentication schemes are in use, because they were added at different
times and no one has consolidated them:

- HMAC-SHA256 signature in the `X-Nordvik-Signature` header (preferred, 28 partners)
- Basic auth over TLS (9 partners, being phased out)
- Mutual TLS with client certificates (3 partners, all Nordic customs authorities)

Certificates for mutual TLS partners expire annually in April. Renewal is a
manual process and has caused an outage in two of the last three years.

## Throughput

Normal weekday volume is 40,000 to 60,000 messages per day, peaking around
09:00 and 16:00. The worker pool runs eight processes. Above roughly 200
messages per second the Redis list depth grows faster than it drains, and the
practical ceiling before manual intervention is about 15 minutes of that load.
