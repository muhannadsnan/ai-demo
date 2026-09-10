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
| `021_import_cursor.sql` | Where each incremental feed has been read to |
| `022_savnet_for_sletting.sql` | Confirms a disappearance before calling it a deletion |

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

### Scheduling

Docker has no scheduler; the host does. `systemd/` holds a template service and
five timers, and `run-import.sh` is the single entry point both systemd and a
human use — running a job by hand is the same command the timer runs.

```bash
sudo ./systemd/install.sh /opt/nordata
systemctl list-timers 'nordata@*'
journalctl -u nordata@oppdateringer -f
sudo systemctl start nordata@oppdateringer     # run one now
```

| Job | Schedule | What it does |
|---|---|---|
| `oppdateringer` | daily 04:00 | Asks Brreg what changed, fetches only those companies |
| `enheter` | Sunday 02:00 | Full file: catches anything the feed missed |
| `roller` | Sunday 03:00 | Full roles reload, archiving ended roles |
| `referansedata` | Monday 05:00 | Counties, municipalities, NACE, postcodes |
| `regnskap` | 1st of month 06:00 | Refreshes accounts older than 90 days |
| `topplister` | daily 04:30 | Refreshes `regnskap_siste` and `eierskap_kant`, then recomputes the toplists |
| `embedding` | daily 05:15 | Embeds descriptions that are new or rewritten |

`Persistent=true` means a job missed because the machine was off runs at next
boot rather than being skipped silently.

**The timers are deployment artefacts, not something a development machine
runs.** They are installed by `systemd/install.sh` on a server. Nothing is
scheduled until you run it, so a laptop with this repo checked out does no
background work at all.

To catch up after a long gap — before a demo, say — one command runs everything
in dependency order:

```bash
./run-import.sh alt
```

This works because the daily job is cursor-based. `import-oppdateringer.mjs`
stores the last `oppdateringsid` it handled in `import_cursor`, so a gap of one
day and a gap of six months are the same operation: start where you stopped and
keep going. `alt` passes `--maks 0` to lift the per-run event cap, which exists
to keep a nightly run short and is exactly the wrong limit when catching up.

It runs the full files first anyway, so even if the change feed had aged out
entirely the data would still be complete; the cursor then only has to cover
what changed since those files were published.

### Incremental updates, and why gaps are safe

`import-oppdateringer.mjs` reads Brreg's change feed. Every event carries an
increasing `oppdateringsid`; the last one handled is stored in `import_cursor`,
and the next run asks for everything after it.

That is what makes interruptions harmless. A "what changed yesterday" query
loses those days permanently if a run is missed. A cursor just returns a larger
batch — the importer can be off for a week, fail, or be deliberately paused, and
it resumes exactly where it stopped.

`--maks` caps how many companies one run will fetch, and the cursor advances
only past events actually processed, so the remainder is simply the start of the
next run.

### The bulk download is not complete

Discovered while testing the incremental import: companies exist that are **live
in Brreg's API** — active, not bankrupt, registered in 2009 — and **absent from
the bulk CSV**.

That broke the deletion logic. The full import marked them deleted because they
were not in the file; the incremental revived them because the API said they
existed. Both correct, and together a nightly flip-flop.

So absence is now recorded rather than acted on: a missing company gets
`savnet_siden`, and only becomes `slettet_dato` if it is still missing after a
seven-day grace period. Anything the API confirms alive has both cleared. One
source disagreeing with another is a question, not a verdict.

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

### Toplists: precomputed, because the query is the expensive part

`ingest/generer-topplister.mjs` writes 20 rankings into the `topplister` table
once a day. The page then reads one small table: **4 ms**, against 8.4 s if the
biggest aggregate ran per visitor.

Three things are worth knowing about how it is built.

**The lists are data, not code.** Each entry in `ingest/topplister.mjs` carries
its SQL *and* its column definitions, and the definitions are stored alongside
the results. The Vue page renders whatever columns the row describes, so adding
a 21st list is adding an entry to one array — no endpoint, no template, no
migration.

**The rows never travel through Node.** Each list is a single
`INSERT ... SELECT jsonb_agg(...) FROM (<the query>) ON CONFLICT DO UPDATE`.
Postgres builds the JSON and stores it in the same statement.

**A failed list keeps its old data.** If a query breaks, the error goes in
`feilmelding` and the previous rows stay put, so one bad query cannot blank the
page. This was tested by accident: running the job with the production compose
file failed all 20 lists at once, and every list still served its previous data.

#### The filter that stops the lists being wrong

A "largest revenue" list is a magnet for bad data — one misfiled number
outranks every real company. The top of the list was `STRØM HANSEN NUF` at
145 billion, up 129,868 % in a year, when its previous ten years all sit near
110 million: the filing is in kroner where the rest of the file is in thousands.

Before assuming an import bug, it is worth measuring. 19 of 232,531 companies
jumped more than 500× from 2024 to 2025 — and **16 of 231,525 did the same from
2023 to 2024**. The same rate in a year the importer handled differently means
this is steady noise in the source, not something the import introduced.

0.008 % of rows is harmless in aggregate and fatal to a ranking, so the accounts
lists drop any year that grew more than 50× over the previous one. With that
filter the list reads KLP, Helse Sør-Øst, DNB, Hydro, Coop, TotalEnergies —
which is the actual top of Norwegian business.

### Free-text search over what companies say they do

`aktivitet` and `vedtektsfestet_formaal` are prose the company wrote about
itself. 940,807 rows have a real description; 1,172,704 have one of the two.
This is the only genuinely unstructured text in the dataset, and it holds what
no code can express: NACE has 738 leaf codes and Norwegian business does not fit
in 738 boxes.

Migration 027 adds a stored `tsvector` column over name, activity and purpose,
weighted A/B/C, with a GIN index and the `norwegian` text search configuration
so "sveising" also matches "sveiser".

| | unindexed | with the GIN index |
|---|---|---|
| `undervannssveising` | 6,629 ms (seq scan) | **0.065 ms** |

It finds things the structured columns cannot: 687 companies working on
*kunstig intelligens*, 117 *hundepensjonat*, 95 doing drone inspection, 2 doing
underwater welding. Combined with the other filters it answers questions like
"AI companies in Oslo with revenue over 5 million" — six of them.

The column is `GENERATED ALWAYS ... STORED`, so the importers never write to it
and it cannot drift out of date; the incremental import was re-run against the
new schema to confirm it still promotes cleanly.

### No person is named in a toplist

Role holders are public in Brønnøysundregistrene and the company pages show them
as the register does — one company at a time. A national *ranking* of named
individuals is a different thing: it is profiling, a new purpose the register was
not published for, and it is the highest-visibility, lowest-value place to do it.

So the toplists name no one. "Flest styreverv" was dropped rather than
anonymised, because without the name it had no row identity left. "Norges
mektigste kvinner" ranks one row per person but labels her by the largest
company she leads — the ranking is real, the name is one click away on the
company page where the register itself publishes it.

Its score logs every dimension before adding them (revenue, employees,
subsidiaries controlled, other board seats), so no single one runs away with the
list. Ranking on raw seat count put one woman who chairs 259 kindergartens in
twelve of the top twelve rows.

### Running the embeddings somewhere other than this machine

The embedding pass is the only part of this project that wants a GPU, and it is
worth being clear about what that means for hosting.

The vectors live in PostgreSQL, not in the repository: about 2.5 GB in the
database volume, and the git checkout does not change size at all. So there are
two ways to get them onto a server.

**Carry them.** `pg_dump` the `enheter_embedding` table and restore it. It is a
one-off transfer of finished work, and the nightly job then only ever embeds
descriptions that changed — a few thousand rows, which any CPU handles in
seconds.

**Regenerate them.** Point `OLLAMA_BASE_URL` at wherever Ollama runs and start
the job. On a CPU-only host the same pass takes hours rather than 100 minutes,
which is fine as a one-off and irrelevant afterwards.

The job is resumable either way: each row stores a hash of the text it was built
from, so it can be stopped and restarted at any point and picks up where it
left off.

**Why this ran on Ollama first, and why it no longer does.** The original
argument had three parts, and the first one was wrong: that 1.1 million
embedding calls to a paid API would be "a real bill for a portfolio project".
Priced rather than assumed, the corpus is 92 million characters — about 31M
tokens — which at $0.02 per million is **roughly 6 kroner** for the entire
1.11M. That is not a bill, and cost was never the real argument.

The two honest reasons were: the descriptions are public register data, but
sending a million of them to a third party is a decision that should be
deliberate; and the run is bounded work on hardware already sitting there.

What settled it in practice was operations. On a 4 GB laptop GPU the local pass
ran at 36–48 texts/sec, wedged the driver twice — the second time badly enough
that stopping the container did not release it — and died once on a single
failed `fetch` after 486,912 rows. The same corpus through
`text-embedding-3-small` runs at ~230/sec: about 80 minutes rather than five
hours, on any machine, with no GPU at all.

So the default is now `EMBED_PROVIDER=openai`, and Ollama remains as the other
implementation for anyone who would rather the text never left the network.
Both are behind the same two functions in `ingest/embed-foretak.mjs`.

Two things that switching costs, and neither is optional:

- **Every vector must be rebuilt.** nomic returns 768 numbers,
  text-embedding-3-small returns 1536, and even at equal width the two models
  place meaning in unrelated coordinate spaces — a mixed index is not degraded,
  it is meaningless. Migration 031 truncates rather than converts.
- **The distance cutoff must be re-measured.** `AiProvider.distanseTak` travels
  with the provider for the same reason `relevanceFloor` does. A number carried
  across models does not error; the filter just stops filtering.

### Chat and embeddings are configured separately

`NUXT_AI_PROVIDER` picks the chat model; `NUXT_EMBEDDING_PROVIDER` picks the
embedder, defaulting to the same one.

They are separate because they can be swapped on completely different terms. A
chat model can be changed whenever you like — a different model just answers
differently. An embedder cannot: every stored vector was produced by one
specific model, and the question must be embedded by that same model or the
comparison is meaningless. 1.11 million rows is not something to rebuild because
the chat model changed.

Switching the index to OpenAI while the config still said `ollama` made this
concrete: the query side embedded questions with nomic into 768 numbers and
compared them to 1536-number vectors, and every semantic search returned a bare
503. The split is what lets this machine run chat locally and free while
semantic search matches the vectors that are actually in the database.

### Semantic search, and the indexes behind the filters

Keyword search (migration 027) finds a company only if it wrote the word you
typed. Migration 028 adds the other half: every description is embedded into a
list of numbers positioned so that texts meaning similar things land near each
other, so "folk som passer hunder" can find a hundepensjonat that wrote none of
those words. Migration 031 moved that from nomic-embed-text (768 numbers, local)
to text-embedding-3-small (1536, hosted) — see above for why.

Three things were measured rather than assumed.

**Batch size.** Under Ollama on a 3060: 230 texts/sec at batch 16, 265 at 64,
285 at 256, and past that the GPU is saturated while a bigger batch only makes a
failure more expensive to retry. Under OpenAI the constraint is the token budget
per request rather than a saturation point, and 512 descriptions is ~15k tokens
— measured at ~230/sec end to end, so about 80 minutes for the full 1.11M.

**halfvec, not vector.** pgvector stores `vector` as 4-byte floats — 2.9 GB
before the index. halfvec is 2 bytes, and the precision lost sits far below the
noise in "are these two business descriptions similar".

**Task prefixes — and that they are model-specific.** nomic-embed-text is
trained with `search_document:` on what is indexed and `search_query:` on what
is asked. text-embedding-3-small has no such convention, so the prefixes are
applied only under Ollama; adding them there would embed the literal words
"search query" into every question. The indexing side and the query side test
the same condition, because if one prefixes and the other does not the ranking
goes quietly wrong rather than failing. Without them the right company
still won, but by 0.011 over the wrong one; with them, by 0.029. Three times the
separation, which is the difference between a usable relevance cutoff and one
that admits an eiendomsutvikler into a search for dog sitters. This was caught
after 78,000 rows and cost seven minutes to redo — it would have cost 100
minutes at the end.

A near-miss worth recording: the first evaluation looked catastrophic — a query
for *kunstig intelligens* returned machine rental firms. The model was fine.
The job runs in organisation-number order and had not yet reached the AI
companies, so the test was measuring an index that was 7% built.

#### Which index serves which filter

Verified with EXPLAIN ANALYZE, not assumed:

| Filter | Index | Added for this |
|---|---|---|
| Name (`ILIKE`) | `enheter_navn_trgm_idx` (GIN trigram), or the sort index when hits are dense | no — 004 |
| What they do, keyword | `enheter_fritekst_idx` (GIN tsvector) | **yes — 027** |
| What they do, meaning | `enheter_embedding_hnsw` | **yes — 028** |
| Municipality, county | `enheter_sok_sortering_idx` | no — 023 |
| Industry (NACE) | `enheter_naering_idx`, `naeringskoder_parent_idx` for the tree walk | no — 004, 008 |
| Employees, default sort | `enheter_sok_sortering_idx` | no — 023 |
| Five accounts ranges | `regnskap_siste_*_idx`, one per field, all partial `WHERE rimelig` | **yes — 026** |
| Ownership network | `eierskap_kant_eier_idx`, `eierskap_kant_selskap_idx` | **yes — 029** |
| Sort by name / newest / oldest | `enheter_sort_navn_idx`, `enheter_sort_registrert_idx`, `enheter_sort_stiftet_idx` | **yes — 030** |

So the advanced filters and sorting needed five migrations of new indexes;
geography, industry, employees and name search all ran on indexes that were
already there.

#### The one filter that was quietly broken

Municipality was written as `kommunenummer LIKE '4601%'` so that a shorter
prefix would also work. Under the `en_US.utf8` collation this database was
created with, Postgres cannot prove a LIKE prefix maps to a btree range, so it
did not use the index: **253 ms on a parallel sequential scan of 1.17 million
rows** for a sparse municipality. Dense ones hid it completely — Bergen has
57,000 companies, so the sort index found ten matches immediately and returned
in 0.7 ms.

A complete four-digit number now uses `=`. Utsira, the smallest municipality in
the country with 68 companies: **253 ms → 5 ms**.

### Sorting costs the same here as it does in MySQL

Offering a sort dropdown is not free, and the reason is the same one you already
know from MySQL: without an index whose order matches the `ORDER BY`, the
database has to produce every candidate row before it can tell you which ten are
first. PostgreSQL does it as a *top-N heapsort* — it keeps only the best ten in
memory rather than sorting all 1.17 million — which is cheaper than a full sort
and still reads everything.

Measured on an unfiltered search:

| `ORDER BY` | Without index | With index |
|---|---|---|
| `navn` | 318 ms | **0.20 ms** |
| `stiftelsesdato DESC` | 284 ms | **0.14 ms** |
| `registreringsdato DESC` | 281 ms | **0.08 ms** |
| `antall_ansatte DESC` | — | 0.02 ms (already indexed, 023) |

With a matching index the sort stops being a sort: Postgres walks the index in
the order that was asked for, takes ten entries and stops. Migration 030 adds
one index per option, all partial on `slettet_dato IS NULL` to match the
search's own WHERE so deleted companies are not carried in them at all.

Two details that matter more than they look:

**Every sort ends in `navn`.** Without a total order, rows that compare equal
can come back in a different order on the next query, so paginating shows one
company twice and never shows another. A tie-breaker on a unique-ish column
fixes it.

**The index only matters when the filter does not.** Filter to 43 bankrupt
construction companies in Oslo and sorting them is free whatever the column —
there are 43 rows. The indexes earn their keep on the broad searches, which are
exactly the ones a visitor runs first.

### The ownership network, and why it recurses over nodes

The ownership tab walks the corporate shareholding graph in both directions:
up through the companies that own this one, down through the ones it owns.

The first version recursed over *edges* and took 803 ms three levels up from
Equinor, producing 48,588 rows for a network of a few hundred companies.
Ownership graphs are dense with shared paths, and `UNION` over edge rows lets
the same company be re-expanded once for every path that reaches it.

Recursing over *nodes* — collecting companies, then fetching the edges between
the ones that made the cut — makes the identical walk **5 ms**. Same data, same
depth, same result.

The edges themselves are a materialised view (migration 029) rather than an
aggregation of 3.09 million holdings per page view, summed per (owner, company)
so a stake held through two share classes is one edge rather than two.

Only companies are nodes. An individual never appears as a position in an
ownership graph — that is precisely the profile this project does not build —
and the ownership tab reports them as a count instead.

### Colour that contradicts the number it sits on

The accounts table coloured costs and debt inverted — rising costs painted red,
on the reasoning that higher costs are worse. Put beside the revenue row it
produced this:

| | 2024 |
|---|---|
| Driftsinntekter | **green** 127 927 000 (+12 %) |
| Driftskostnader | **red** 127 511 000 (+10 %) |

A red cell reading "+10 %". Both are true and together they are nonsense: costs
rose slower than revenue, which is a good year, and the table painted it as a
bad one. The judgement was wrong because the table cannot make it — whether
rising costs are bad depends entirely on what revenue did, and a single row does
not know.

Costs and debt now show the change without a verdict. Colour is reserved for the
rows where direction is unambiguous, and for negative values.

Two smaller things the same review turned up. A real 0.3 % rise rendered as
"+0 %", which reads as "nothing happened" — percentages under 10 % now carry a
decimal. And changes over 1000 % were suppressed entirely, leaving a coloured
cell with no explanation; they now say `+1000 %+`.

### Gender is inferred from first names, and labelled as such

`kvinner i business` needs a gender per role-holder, which no register
publishes. SSB table 10501 codes first names with a `1` prefix for girls' names
and `2` for boys' — official data, not a guess. `import-fornavn.mjs` loads
2,144 names (1,126 girls', 1,010 boys', 8 in both, stored as `?`), which
classifies 2,400,112 of 2,697,229 person roles.

It is an inference, so every list built on it says so on the page. The
county-level figures land at 18–22 % female CEOs, which matches published
statistics — a useful check that the join is doing what it claims.

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
