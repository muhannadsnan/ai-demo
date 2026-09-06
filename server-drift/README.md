# server-drift

Everything about *running* this project on a server: images, orchestration,
deployment, and the procedures for when it breaks.

Separate from the application code on purpose. Application code answers "what
does it do"; this directory answers "what happens at 23:00 when it stops doing
it", which is a different discipline and worth showing separately.

---

## The decision: Docker Compose on a single VPS

Yes — containers are the right call here, and for the reason you already
identified: **portability**. But it is worth being explicit about the trade,
because "use Docker" is not automatically correct.

### Why it fits this project

- **One definition, three environments.** The same stack runs on your Mint
  laptop, on a Windows machine through WSL2, and on the VPS. This is the exact
  problem the VirtualBox-plus-SSH-plus-shared-folder setup was solving, minus
  the several GB of guest OS and the manual configuration that lives only in
  your memory.
- **The configuration is the documentation.** `docker-compose.yml` states what
  runs, how it is networked, what it is allowed to consume, and how it is
  checked for liveness. A reviewer reads it in two minutes. A hand-configured
  server takes an afternoon to reverse-engineer, and only if you are still
  there to be asked.
- **Reproducible.** Pinned image versions mean the Postgres you develop against
  is the Postgres in production. No "works on my machine".
- **It is what employers expect** for new work, which matters given this is
  partly a portfolio piece.

### The honest counter-argument

For a single VPS running a single app, plain `apt install` plus systemd units is
genuinely simpler, has no daemon in the path, and some infrastructure teams
prefer it. Containers add a layer, and container networking is one more thing
that can be wrong at 23:00.

The portability requirement settles it. You explicitly want this to move between
machines, and that is precisely where the hand-configured server loses.

### What is deliberately NOT here

- **Kubernetes.** One node, one app, no autoscaling requirement. It would add
  significant operational surface for zero benefit, and on a portfolio project
  it reads as résumé-driven rather than considered. Being able to explain *why
  you did not use it* demonstrates more judgement than using it would.
- **A VM image.** Superseded by containers for this purpose. Keep VirtualBox for
  when you genuinely need to test a full OS install, not for shipping an app.
- **A managed platform** (Vercel, Railway, Fly). They would work, and they would
  also hide exactly the layer you are trying to demonstrate competence in.

---

## Build it in stages

This is the part most people get wrong. Do not stand the whole stack up at once.

| Stage | What is added | Why this order |
|---|---|---|
| **1** | App + Caddy (TLS) | Prove build → deploy → HTTPS → healthcheck against a small, known-good app |
| **2** | Postgres + migrations | Add persistent state once deployment is boring — **done** |
| **3** | Ingest service + schedule | The Brreg/Skatteetaten pipelines |
| **4** | Search (Meilisearch or Postgres FTS) | Only once you know queries are actually slow |
| **5** | AI layer | Last, on top of everything already working |

All five stages live in **this** directory — they are phases of one deployment,
not different places. Stages 2 and 3 run on the same server as stage 1; adding
them means adding services to the compose file, not moving anything.

**Stage 1 is in this directory and works today** — it deploys the ai-demo, which
needs no database. When a certificate fails to issue or a container cannot reach
another, you are debugging one new thing rather than four at once.

Do not debug Let's Encrypt and a 3.4M-row import on the same evening.

---

## What is here now

```
server-drift/
  Dockerfile               multi-stage build; 138 MB image, non-root, healthcheck
  docker-compose.local.yml run it on a laptop: HTTP on :8080, no domain needed
  Caddyfile.local          the proxy config for that
  docker-compose.yml       stage 1 on a server: app + TLS proxy
  Caddyfile                reverse proxy, automatic Let's Encrypt, SSE-aware
  Makefile                 deploy / rollback / logs / health
  .env.example             copy to .env on the server
  RUNBOOK.md               what to do when it breaks
  SCHEDULING.md            how the import jobs get run on a schedule
  docker-compose.data.yml  stage 2 skeleton: Postgres + ingest  (not used yet)
  systemd/                 example timer units for the import jobs
```

A root `.dockerignore` keeps the build context at ~500 kB instead of shipping
`node_modules` to the daemon.

### What has actually been tested

| Claim | Status |
|---|---|
| Image builds, 138 MB, runs as non-root | verified |
| Healthcheck reports `healthy` | verified |
| `knowledge/` ships in the runtime layer | verified — `/api/knowledge` answers from inside the container |
| Search, SSE streaming, SSR all work in the container | verified |
| Both compose files are schema-valid | verified with `docker compose config` |
| `ingest` is excluded from `up` by its profile | verified — `config --services` lists only app, db, proxy |
| SSE survives the proxy | verified by measurement, **and the reason was not what I assumed** — see the note in `Caddyfile` |
| Cold start | verified — 181 ms to first successful request |
| No compiler or `node_modules` in the runtime image | verified |
| Let's Encrypt issuance | **not tested** — needs a real domain |

## Running it locally — no domain, no TLS

This is the path to use while there is no server:

```bash
cd server-drift
docker compose -f docker-compose.local.yml up -d --build
# http://localhost:8080
```

Plain HTTP on port 8080. No certificates, nothing to own, nothing to configure.
It runs the same image and the same proxy as production, so the only difference
is the missing TLS layer.

## Running it on a server

```bash
# once, on Mint — Docker is installed but the Compose plugin is not
sudo apt install docker-compose-v2

cd server-drift
cp .env.example .env && chmod 600 .env   # set DOMAIN and TLS_EMAIL
make deploy
make ps
```

Point the domain's A record at the server **before** the first `make deploy`, or
Caddy's certificate request fails and you will burn one of the five duplicate
certificates Let's Encrypt allows per week.

Locally, without a domain, just run the image directly:

```bash
docker build -f server-drift/Dockerfile -t ai-demo:local ..
docker run --rm -p 3000:3000 -e NUXT_AI_PROVIDER=mock ai-demo:local
```

---

## Sizing, when the company data arrives

Rough shape of the Norwegian dataset in Postgres, indexes included:

| Table | Rows | Approx. on disk |
|---|---|---|
| `enheter` | 1.17M | ~2 GB |
| `roller` | 3.4M | ~1.5 GB |
| `aksjonaerer` | 3M | ~1 GB |

Disk is not the problem — any VPS gives you 40 GB. **RAM is.** A 4 GB box
running Postgres, Meilisearch, Nuxt and an ingest job at the same time will
swap, and the nightly ingest is exactly when it will hurt.

**A VPS does not grow by itself.** You get exactly the RAM you paid for at
provisioning time. Growing means changing plan and rebooting — on Hetzner that
is a few minutes of downtime, and disk can only ever grow, never shrink. So
choose with headroom rather than planning to react.

Two options, both defensible:

- Move to 8 GB. On Hetzner that is a couple of euros a month more, and it is the
  boring correct answer.
- Stay at 4 GB and drop Meilisearch, using Postgres full-text search instead.
  One less service, one less thing to explain, and at 1.17M rows with a decent
  GIN index it is fast enough.

Also: **run the ingest as a separate container with its own memory limit.** A
runaway import must not be able to take the database down with it. That is what
the `deploy.resources.limits` block in the compose file is for, and it is worth
setting on every service rather than only the ones you are worried about.

---

## Stage 2 — the database

Running locally as part of `docker-compose.local.yml`. Postgres 16 on a named
volume, published on 5432 so pgAdmin or DBeaver can reach it. The server
overlay (`docker-compose.data.yml`) deliberately does **not** publish that port.

```bash
docker compose -f docker-compose.local.yml up -d
./migrate.sh status     # what has run, what has not
./migrate.sh            # apply everything pending
```

### Migrations

`migrate.sh` is about fifty lines of shell, not a framework. It keeps a
`schema_migrations` table and runs the files in `migrations/` that are not in
it. Each file runs inside a transaction, so a failure rolls the file back and
does not write the ledger — a failed migration leaves the database exactly as it
was, and re-running is safe.

| File | Contains |
|---|---|
| `001_extensions.sql` | `pg_trgm` for fuzzy name matching, `unaccent` for å/ø/æ |
| `002_enheter.sql` | Companies — typed columns, raw jsonb, content hash, six indexes |
| `003_roller.sql` | Board members, CEOs, auditors — with a person/company check constraint |

Each table keeps three things beyond the obvious columns: the untouched API
payload in `raw` (so a field you did not extract does not mean a full re-import),
a `content_hash` (so re-imports skip unchanged rows), and `created_at` /
`updated_at`.

**Verified:** migrations apply, re-running is a no-op, and a row survives the
database container being destroyed and recreated — because the data is in a
volume, not in the container.

### The schema is a first draft, on purpose

These tables were written from the **field list in the planning document**, not
from inspecting a real Brreg download. That is scaffolding, not a finished
design, and some of it will be wrong: exact field names, which columns are
actually nullable, real value ranges, whether `antall_ansatte` is ever absent
rather than zero, how addresses vary in practice.

The right sequence is: download one file, look at it, then correct the schema.
That correction is a new migration — `004_fix_enheter.sql` — which is precisely
why migrations exist and why the first draft being imperfect costs almost
nothing. Having tables to load into now beats waiting for perfect knowledge.

What is *not* provisional is the shape: typed columns for what gets queried,
`raw` jsonb for everything else, a content hash for skip-if-unchanged, and
indexes chosen for real queries. That part holds regardless of what the files
turn out to contain.

### Not yet written

The ingest code. Stage 2 gives you a database and a place to run jobs; the jobs
that download Brreg files and load them are stage 3. Sources, sizes, update
cadence and licences for all ten datasets are in
`../demo_project_norwegian_company_data.md`.

## Which language for the import jobs

Genuinely open, and the answer depends on what you want the project to say.

| | Case for it | Case against |
|---|---|---|
| **Node** | Same language as the app, so **one image and one build** for both. Shared model and validation code. Fewest moving parts. | Weaker story if you want to be read as a data engineer. |
| **Python** | What most data-engineering roles expect. Best libraries for messy CSV, encodings, dataframes. | A second language, a second image, duplicated model code. |
| **Go** | Your colleague is right: one static binary, no dependency tree, a ~15 MB image, and fast. Excellent for exactly this shape of job. | More code for the boring CSV and JSON work, and a third language to keep in your head. |

**Recommendation: Node**, at least to begin with. The goal is to demonstrate
*integration and operations*, not language breadth, and one image covering both
the app and the jobs is the clearest thing to point at. Switch a single job to
Python or Go later if it earns it — the container boundary means that is a
contained change, which is itself part of the argument for containers.

The dependency concern behind the Go suggestion is real, and worth separating
from the language: the fix is a lockfile, a multi-stage build, and no dev
dependencies in the runtime image. That is already how `Dockerfile` works here —
138 MB, of which the application is 2.3 MB.

## What actually demonstrates operations skill

Nearly every portfolio project has a `docker-compose.yml`. Almost none has the
following, which is what separates someone who ran `docker compose up` once from
someone who has operated a system:

- **A runbook.** Named failure modes with the command to run for each. See
  `RUNBOOK.md`.
- **A restore that has actually been performed.** Not a backup script — a
  documented drill with the date it was last run and how long it took. *Making*
  a backup and *restoring* one are different operations, and only the second
  proves anything. Almost nobody does this, which is exactly why being able to
  say "last restore drill: 12 March, 18 minutes" lands in an interview.
- **Backups that are verified**, not just written. A backup nobody has restored
  is a hypothesis.
- **Resource limits on every service**, so one process cannot starve the others.
- **Log rotation**, because the most common cause of a dead small VPS is a full
  disk.
- **Versioned migrations** with a working `down`, applied by the deploy rather
  than by hand.
- **A rollback that is one command** and names a specific version.

Stage 1 already covers limits, log rotation, healthchecks and one-command
rollback. Backups and the restore drill arrive with Postgres at stage 2.
