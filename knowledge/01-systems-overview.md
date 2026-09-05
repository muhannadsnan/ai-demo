# Systems Overview

Fictional documentation for a mid-size logistics company, "Nordvik Logistics".
It exists so the search demo has something realistic to retrieve. Replace it
with your own documents to see the demo work on real material.

## The system landscape

Nordvik runs five services that together form the platform:

- **Core** — the original PHP CodeIgniter monolith. Owns customers, orders and
  invoices. Still the system of record for anything money-related.
- **Order Service** — extracted from Core in 2021. Owns order lifecycle and
  fulfilment state. Talks to Core over an internal REST API.
- **Integration Bus** — a queue-backed router that moves messages between Core,
  Order Service and roughly forty external partners.
- **Import Runner** — scheduled jobs that pull partner files (CSV, XML, fixed
  width) from SFTP and normalise them into the staging tables.
- **Portal** — the customer-facing Vue 3 front end. Speaks only to Core and
  Order Service, never directly to the bus.

## Ownership and on-call

Core and Import Runner are owned by the Platform team. Order Service is owned by
Fulfilment. The Integration Bus has no dedicated owner and is maintained on a
best-effort basis by whoever is on call, which is a known organisational risk
recorded in the 2024 architecture review.

On-call rotation is weekly, Monday 09:00 to Monday 09:00. The primary responder
acknowledges within 15 minutes during business hours and 30 minutes out of hours.

## Environments

There are three environments: `dev`, `staging` and `prod`. Staging holds a
scrubbed copy of production data refreshed every Sunday at 02:00. Partner
credentials in staging point at partner sandboxes, never at live endpoints.
Deployments to prod happen Tuesday and Thursday afternoons; there is a freeze
from 20 December to 6 January because that is peak shipping season.

## Technology constraints

Core runs PHP 8.1 on CodeIgniter 3. Migrating to CodeIgniter 4 has been
discussed since 2022 and remains unscheduled. MySQL 8.0 is the primary database.
Redis is used for sessions and for the Integration Bus queue. There is no
message broker such as RabbitMQ or Kafka; the bus uses Redis lists, which is
adequate at current volume but has no dead-letter support built in.
