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
| `002_enheter.sql` | First draft of the companies table — superseded by 004 |
| `004_enheter_from_real_data.sql` | Companies, rewritten against the actual 90-column CSV |
| `005_restore_roller_fk.sql` | Re-adds the foreign key that 004's `DROP ... CASCADE` removed |
| `003_roller.sql` | First draft of roles — superseded by 006 |
| `006_roller_from_real_data.sql` | Roles, rewritten against the real nested JSON |
| `007_person_name_index_not_partial.sql` | Removes a partial-index trap (see below) |
| `008_reference_data.sql` | Counties, municipalities, industry codes, postcodes |
| `009_svalbard.sql` | Adds Svalbard, which SSB's municipality list omits |
| `010_soft_delete.sql` | Marks deregistered companies instead of deleting them |
| `011_referential_integrity.sql` | Adds three foreign keys, after making the data satisfy them |
| `012_roller_history.sql` | Keeps ended roles instead of destroying them each import |
| `013_regnskap.sql` | Annual accounts, plus a log of every fetch attempt |
| `014_aksjeeie.sql` | Shareholdings, with a personal-data-free view for publishing |
| `015_regnskap_kilde.sql` | Marks each accounting row's source and precision |
| `016_valuta_default.sql` | Defaults historical currency to NOK, unless the API said otherwise |
| `017_round_to_thousand.sql` | Stores all amounts at thousand granularity, for consistency |
| `018_rename_aksjeeie.sql` | Makes the safe name the obvious one |
| `019_rename_aksjonar.sql` | Shortens to `aksjonar` / `aksjonar_persondata` |
| `020_import_logg.sql` | Records every import run, for the status page |

### What the real data changed

The draft schema in 002 was written from documentation. A real download
(154 MB gzipped, 801 MB of CSV, **1,467,160 companies, 90 columns**) contradicted
it in five ways that mattered:

| Guess in 002 | Reality |
|---|---|
| One industry code | **Three** (`naeringskode1..3`) |
| `antall_ansatte` nullable integer | Filled on **6.7%** of rows, with a separate `harRegistrertAntallAnsatte` flag. Without it, "reported zero" and "never reported" are indistinguishable |
| One `kommunenummer`, addresses as jsonb | **Two** addresses, already flat, seven parts each, two different kommunenummer. Business address 97% filled, postal 18% |
| `kapital_belop` as bigint | Has two decimals **and a currency** — NOK and EUR both occur |
| Embed `vedtektsfestetFormaal` | Filled on **43.6%**. `aktivitet` holds the same kind of text at **100%** |

This is why the schema was not designed in advance of the download. Correcting
it cost one migration.

**Note for the ingest:** twelve database columns were deliberately renamed to be
shorter than the CSV headers (`underTvangsavviklingEllerTvangsopplosning` →
`under_tvangsavvikling`, and similar). The import script therefore needs an
explicit CSV-column-to-database-column map; automatic snake_casing will not
line up.

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

## What is loaded

| Table | Rows | Source | Notes |
|---|---|---|---|
| `enheter` | 1,173,013 | CSV, 154 MB gzipped | 90 columns, 9 indexes |
| `roller` | 3,418,541 | JSON, 130 MB gzipped / 2.8 GB raw | 2.70M people, 0.71M firms |
| `regnskap` | 4,959,968 | bulk history + live API | 1999-2025, 448,600 companies |
| `aksjeeie_persondata` | 3,092,787 | Skatteetaten CSV, 303 MB | **restricted — read the `aksjeeie` view** |
| `roller_historikk` | grows | reconciliation | roles that have ended |
| `naeringskoder` | 1,785 | SSB Klass API | hierarchical |
| `postnummer` | 5,122 | Bring, **ISO-8859-1** | |
| `kommuner` | 359 | SSB + Svalbard + Jan Mayen | |
| `fylker` | 18 | SSB + Svalbard + Jan Mayen | |

**5.7 GB**, 16 migrations, 5 validated foreign keys.

### Running the imports

```bash
node ingest/import-enheter.mjs              # companies      ~30s
node ingest/import-roller.mjs               # roles          ~95s
node ingest/import-reference.mjs            # lookup tables  ~5s
node ingest/import-aksjeeie.mjs             # shareholdings  ~235s
node ingest/import-regnskap-historikk.mjs   # 27y of accounts ~275s
node ingest/fetch-regnskap.mjs --seed       # exact current-year figures
```

All are idempotent. `import-enheter` skips unchanged rows by content hash and
marks companies that have disappeared; `import-roller` archives ended roles
rather than deleting them.

### Amounts are stored in thousands

The bulk historical source arrives rounded to tusen kroner; the live API returns
exact kroner. Keeping both meant one column held two precisions, so a company's
2024 and 2025 figures were not strictly comparable and any aggregate silently
mixed them.

All amounts are therefore **rounded to the nearest thousand on write**, and
presented as *"tall i tusen"*. The exact API response is preserved in
`regnskap.raw`, so the precise figures remain available if ever needed.

Verified: zero rows sit off a thousand boundary.

## Stage 3 — the importer

```bash
node ingest/import-enheter.mjs            # defaults to ../data/raw/enheter.csv.gz
```

`fetch -> staging -> promote`, the same shape as the existing partner file
imports:

1. **COPY into a staging table where every column is text.** No parsing, no
   type errors — get the rows in as fast as the disk allows. Postgres's bulk
   loader does this in about 8 seconds for 800 MB.
2. **Cast and upsert in one statement**, so the work happens inside Postgres
   rather than shuttling rows through Node.

Staging exists so a bad row cannot leave the real table half-updated:
everything lands somewhere disposable first and is promoted in one transaction.
The staging table is `UNLOGGED` — it skips the write-ahead log, which roughly
halves the load time and is safe precisely because it is disposable.

### Measured on the real dataset

| | |
|---|---|
| Source | 154 MB gzipped, 809 MB in Postgres |
| Records | **1,173,013** |
| First run | 65 s |
| Second run, nothing changed | **29 s, zero rows written** |
| Fuzzy name search (`ILIKE '%nordvik%'`) | **4.2 ms**, 216 matches, via the trigram index |

`ingest/column-map.mjs` holds the CSV-header-to-column mapping and the type of
each field. Both the staging DDL and the upsert are generated from it, so the
mapping exists in exactly one place.

### Accounting history, and why it does not come from the API

Brreg's accounts API serves **only the most recent period**. There is no year
parameter — `?år=2023`, `?aar=2023` and `?regnskapstype=KONSERN` were all tried
and all return the same current period. Revenue trends cannot be built from it.

History therefore comes from an earlier bulk collection, loaded by
`ingest/import-regnskap-historikk.mjs`. **It was verified before being trusted**:
fourteen fields across the resultatregnskap and balanse were compared against the
live API and matched exactly once scaled by ×1000, for four companies including
one reporting in USD. The source stores *tusen kroner*.

Only the columns Brreg itself publishes are imported. Two more are derived
exactly and checked against the API: `driftskostnad` = inntekter − driftsresultat,
`sum_eiendeler` = anleggsmidler + omløpsmidler.

Every row records its own provenance and precision:

| `kilde` | Meaning |
|---|---|
| `brreg-api` | Exact kroner, current period, currency known |
| `historikk` | Rounded to the nearest 1000, currency **NULL** |

`valuta` is deliberately NULL on historical rows rather than assumed to be NOK —
Equinor reports in USD, and labelling dollars as kroner would corrupt every
comparison built on it.

Two things the numbers revealed:

- **7,408,725 rows parsed became 4,959,968 stored.** The source holds 808,682
  companies; only 448,600 still exist in Brreg's current file. The other 360,082
  were deregistered over 27 years, have no company row to attach to, and no
  profile page to appear on.
- **0.56% of rows have a non-December fiscal year end** — 41,406 of them, June
  and September mostly. The first version of the loader wrote 31 December for
  everything, which stores the wrong period and can collide in the primary key
  when a company later switches to a calendar year. Now it uses the month column
  that was there all along.

### Shareholdings — and the one table that is not freely publishable

`aksjeeie` is different from everything else here. Brreg data is NLOD: free to
republish with attribution. Skatteetaten's Aksjonærregisteret is not. It is
released under the same criteria as the tax lists, and the covering message
states that the extract contains personal data and that the recipient must
comply with personopplysningsloven.

Of 3,092,787 shareholdings, **2,526,639 identify a private individual** by name,
birth year, postcode and town.

So personal columns are isolated and a view exists without them:

```sql
SELECT * FROM aksjeeie   -- the VIEW: corporate holders in full, individuals anonymous
```

Corporate holders keep their name and organisation number — an organisation
number is not personal data, and company-owns-company is the half of the graph
worth showing. Individuals appear as a row carrying only a percentage. The
ownership structure survives intact; the people do not appear.

**The safe name is the obvious one.** `aksjeeie` is the view; the table holding
personal data is `aksjeeie_persondata`. The natural query returns the filtered
data, and reaching the raw rows means deliberately typing a name that says so.

File quirks, all of which fail silently:

- **UTF-8 with BOM**, which lands on the first header cell so `Orgnr` never matches.
- **Semicolon** separated.
- **No quoting at all** — and seven shareholder names contain a `"`. A standard
  CSV reader treats the first as an opening quote and swallows the rest of the
  file; Python aborts with "field larger than field limit". COPY is told to use
  `E'\x01'` as the quote character, which cannot occur in the data. All seven
  names survived intact.
- The holder identifier is **dual purpose**: 4 digits is a birth year (a person),
  9 digits is an organisation number (a company), empty is usually a foreign
  holder. That one field is what separates personal from public data.

### Annual accounts

Regnskapsregisteret has no bulk file — one request per organisation number — so
`regnskap` fills two ways:

```bash
node ingest/fetch-regnskap.mjs 923609016     # one company, on demand
node ingest/fetch-regnskap.mjs --seed        # 6,456 companies, ~1.8h at 1s throttle
node ingest/fetch-regnskap.mjs --stale 90    # refresh anything older than 90 days
```

The seed is companies with 50+ employees and accounts filed 2024 or later,
ordered by headcount — ranked by employees rather than revenue, because revenue
is the thing being fetched.

`regnskap_hentelogg` records **every attempt**, including failures. A 404 means
the company has never filed accounts, which is the permanent truth for most of
the register; without recording it, those companies get re-requested on every
page view forever. It also makes the seed resumable — re-running skips anything
already attempted.

`valuta` matters more than it looks: Equinor reports in **USD**, so any sum or
ranking across companies has to group by currency or convert. And a parent files
both `SELSKAP` and `KONSERN` accounts, so mixing the two double-counts revenue —
hence both are in the primary key.

### Role history

`roller` holds current state; `roller_historikk` holds roles that have ended.
Each import archives roles no longer present, inserts genuinely new ones, and
leaves unchanged roles alone so their `forst_sett` date survives — a
slowly-changing dimension, type 2. The previous version truncated and reloaded,
which meant every import destroyed the answer to "who used to run this company".

`roller_historikk` has no foreign key to `enheter` on purpose: role history
should outlive the company being deregistered, which is exactly when someone
wants to look.

Columns are named *first seen* and *last seen*, not *from* and *to*, because
Brreg publishes current state only. The honest claim is when we observed the
role, not when the person took the seat.

### Referential integrity

Five foreign keys, all validated against the loaded data. Two data problems had
to be fixed before three of them could be enforced:

- **60,155 companies carried industry code `00.000`** — Brreg's placeholder
  meaning "Uoppgitt", unspecified. It is not in SSB's classification. A magic
  value meaning "unknown" is what NULL is for; left alone it joins to nothing
  and appears in a `GROUP BY` as though it were a real industry.
- **Jan Mayen**, like Svalbard, is absent from SSB's municipality list.

One foreign key was deliberately not added: `enheter.overordnet_enhet`. Two
companies name a parent missing from the bulk file, although both parents return
HTTP 200 from Brreg's per-company API. The constraint would abort a future
import over two rows in 1.17 million, discovered at 01:15 in a cron log.

### Deregistrations

Brreg does not flag deletions — a deleted company simply stops appearing in the
download. Because the file is a complete snapshot, anything in `enheter` absent
from staging is gone, and the import marks it with `slettet_dato`.

Marked, not deleted, for three reasons: `roller` references `enheter`
ON DELETE CASCADE, so removing a company would silently destroy every board
seat and directorship attached to it; "deregistered on 4 March" is a fact worth
showing; and a company that reappears gets un-marked, so one glitched download
cannot permanently retire a live company.

Verified by inserting a synthetic company absent from the file, running the
import, and confirming it was marked rather than removed.

### A trap worth knowing

`wc -l` reported 1,467,161 lines but there are only 1,173,013 records: 256,822
of them contain newlines inside quoted address fields. Any importer that splits
on newlines rather than parsing CSV properly would mangle a fifth of the file
and never say so.

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
