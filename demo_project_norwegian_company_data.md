# Demo Project — Norwegian Company Data Platform

*A portfolio project to showcase data-integration, systems, and AI-agent competence. Prepared 2026-09-04.*

**Concept:** Build a mini purehelp.no / proff.no lookalike using only public data sources. Not intended to compete — purely to demonstrate the skills of building, running, and integrating a production-grade data platform.

---

## Public Norwegian company data sources

### 1. Brreg Enhetsregisteret — the foundation

The main company registry. Everything else joins to this on `organisasjonsnummer`.

| Property | Value |
|---|---|
| Bulk CSV download | `https://data.brreg.no/enhetsregisteret/api/enheter/lastned/csv` |
| Bulk JSON | `https://data.brreg.no/enhetsregisteret/api/enheter/lastned` |
| Single-company API | `https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}` |
| Search API | `https://data.brreg.no/enhetsregisteret/api/enheter?navn=X&organisasjonsform=AS` |
| Size | ~150MB gz, ~800MB extracted, ~1.17M rows |
| Update cadence | Daily |
| Auth | None |
| License | NLOD (Norsk Lisens for Offentlige Data) — free commercial use with attribution |

**Fields include:** orgnr, navn, organisasjonsform, næringskode, forretningsadresse, postadresse, stiftelsesdato, vedtektsdato, vedtektsfestetFormaal, telefon, mobil, epostadresse, hjemmeside, antallAnsatte, konkurs, underAvvikling, underTvangsavviklingEllerTvangsopplosning, maalform, sisteInnsendteAarsregnskap, registreringsdatoEnhetsregisteret, kapital.belop, kapital.antallAksjer, erIKonsern, overordnetEnhet.

### 2. Brreg Roller/Totalbestand — all active roles

For officers, board members, auditors, accountants, contact persons.

| Property | Value |
|---|---|
| Bulk JSON download | `https://data.brreg.no/enhetsregisteret/api/roller/totalbestand` |
| Single-entity API | `https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}/roller` |
| Size | ~124MB gz, ~2.9GB JSON, ~3.4M role rows |
| Update cadence | Nightly regeneration (available from ~04:00 CEST) |
| Auth | None |
| License | NLOD |

**Fields:** orgnr, rolletype (STYR/DAGL/KONT/INNH/REVI/REGN etc.), person (fornavn/mellomnavn/etternavn, foedselsdato, adresse), for corporate role-holders (organisasjonsnummer, navn), fratraadt (removed) flag.

### 3. Brreg Kunngjøringer — official announcements

Bankruptcies, mergers, dissolutions, name changes, capital changes, etc.

| Property | Value |
|---|---|
| API | `https://data.brreg.no/enhetsregisteret/api/oppdateringer/enheter` |
| Kunngjøring API | `https://data.brreg.no/kunngjoringer/api/kunngjoringer` |
| Update cadence | Continuous |
| Auth | None |
| License | NLOD |

Good for building "recent changes" feeds and history timelines on company profiles.

### 4. Skatteetaten Aksjonærregisteret — shareholder data

Annual snapshot of who owns shares in Norwegian AS companies.

| Property | Value |
|---|---|
| Access | Manual request via Skatteetaten's form, ~5-day SLA, ShareFile link with ~1-week TTL |
| URL | `https://www.skatteetaten.no/skjema/aksjonarregisteret-innsyn/` |
| Format | Semicolon-delimited CSV, UTF-8 with BOM, 9 columns |
| Size | ~300MB, ~3M rows |
| Update cadence | Annual (May, for prior year's ownership) |
| Auth | None (public data, just gated by request form) |
| License | Public — free to redistribute with attribution |

Fields: Orgnr, Selskap, Aksjeklasse, Navn aksjonær, Fødselsår/orgnr, Postnr/sted, Landkode, Antall aksjer, Antall aksjer selskap.

### 5. Regnskapsregisteret — annual accounts

Filed accounts for all reporting companies.

| Property | Value |
|---|---|
| API | `https://data.brreg.no/regnskapsregisteret/regnskap/{orgnr}` |
| Bulk download | Not directly bulk-available for free; individual queries per orgnr |
| Format | JSON per company, per accounting year |
| Auth | None |
| License | NLOD |

Contains: driftsinntekter, driftskostnader, driftsresultat, sum eiendeler, sum egenkapital, sum gjeld, ansatte, revisor, etc.

### 6. Løsøreregisteret (Pledges) — via Brreg

| Property | Value |
|---|---|
| API / bulk | Not directly downloadable in bulk from Brreg |
| Alternative | Public search at `brreg.no/produkter-og-tjenester/losoreregisteret/` per query |
| Note | For a demo you can skip this — hardest source to work with |

### 7. NACE / bransjekoder — SSB

| Property | Value |
|---|---|
| API | `https://data.ssb.no/api/klass/v1/classifications/6/codes` |
| CSV | Available via SSB's classifications site |
| Update cadence | Rarely (schema-level changes) |
| Auth | None |
| License | Free / SSB open data |

### 8. Kommunenr / Fylkesnr — SSB standard codes

| Property | Value |
|---|---|
| API | `https://data.ssb.no/api/klass/v1/classifications/131/codes` (kommuner) |
| Auth | None |
| License | Free |

### 9. Postnummer register — Posten / Bring

| Property | Value |
|---|---|
| Download | `https://www.bring.no/tjenester/adressetjenester/postnummer/postnummertabeller-veiledninger` (tab-separated CSV) |
| Update cadence | ~Weekly |
| Auth | None |
| License | Free |

### 10. Konkursregisteret — from Brreg feed

Already covered via kunngjøringer + enheter status.

---

## Bonus: non-Norwegian data that could enrich the demo

| Source | Use |
|---|---|
| **EU VIES** (VAT validation) — `ec.europa.eu/taxation_customs/vies` | Cross-border B2B validation |
| **OpenCorporates API** (free tier) — `opencorporates.com/api_accounts/new` | Cross-jurisdiction company data |
| **GLEIF LEI data** — `www.gleif.org/en/lei-data/global-lei-index` | International legal entity identifiers |
| **Companies House UK** — bulk download for UK data | Cross-Nordic comparison |
| **Bolagsverket SE** and **CVR DK** | Nordic company registers, similar APIs |

Adding one Nordic neighbor gives your demo cross-border appeal for regional employers.

---

## Suggested architecture for the demo

Given you want to show data-integration + systems chops:

### Backend / pipeline
- **Language:** Python (rich data ecosystem, easy for reviewers to read) or Node.js (matches Vue/Nuxt stack, keeps it JS-only). PHP works if you want to reuse muscle memory but harder to explain to modern reviewers.
- **Database:** PostgreSQL — better JSON/JSONB support than MySQL, excellent for this kind of data. Free, well-known, expected in modern hiring.
- **Fetch pipeline:** cron + Python scripts or Node scheduled tasks
- **Job orchestration:** simple cron is fine for demo; if you want to look modern add [Dagster](https://dagster.io) or [Prefect](https://prefect.io) as a small showcase
- **Full-text search:** Meilisearch (drop-in, extremely fast setup) or Typesense — makes the company search feel snappy
- **Cache:** Redis if you want to show ops-maturity (optional)

### Frontend (your Vue/Nuxt)
- **Nuxt 3** with SSR — good for SEO on company profile pages
- **UI:** Nuxt UI or Vuetify or your own Tailwind styling
- **Charts:** ECharts or Chart.js for financial trends (like Purehelp's revenue charts)
- **Search:** Meilisearch's Vue integration for instant search
- **Map:** MapLibre GL for showing company locations by kommune

### Hosting
- **Nordic VPS:** [Hetzner](https://www.hetzner.com/) (~5€/mo for a 4GB VPS — enough for demo), [UpCloud](https://upcloud.com) (Finnish), or [DigitalOcean](https://www.digitalocean.com/) if you prefer
- **Domain:** cheap `.no` from [domeneshop.no](https://domeneshop.no) or `.dev`/`.app` from Namecheap
- **SSL:** Let's Encrypt (free, automated via Caddy or nginx + certbot)
- **CI/CD:** GitHub Actions (free tier), auto-deploy on push
- **Everything in Docker Compose** — showcases modern ops practices

### AI-agent bonus layer (this is the killer for your CV)
- **Claude / OpenAI API** as a natural-language query interface: "Show me all AS companies in Bergen with more than 50 employees that filed accounts last year"
- **MCP server** exposing your DB as tools to Claude
- **Vector embeddings** on company `formaal` for "find similar companies" search
- **RAG over kunngjøringer** for "what happened to this company in the last year"

This one bonus feature = you're now showcasing systems engineering AND modern AI agent capability in a single project. That's a very rare combined portfolio in the market.

---

## What to showcase specifically that maps to your existing skills

Design the demo to visibly demonstrate what you actually do well:

1. **Multi-source data integration** — show the same company enriched with Brreg + Aksjonærregisteret + Regnskap + Roller in one profile page. Mirrors your CS + Brreg + Skatteetaten + PT integration.
2. **Incremental vs bulk update patterns** — daily Brreg roller reconciler with set-diff, weekly Brreg enheter refresh, annual aksjonar rebuild. Mirrors your production cron cascade.
3. **Data quality handling** — dedup, name normalization, historical name tracking (like `org_histnavn`). Mirrors your aksjonar reconciliation + histnavn work.
4. **Person resolution** — link shareholders across companies via name+birthyear matching. Same fuzzy-match problem you solved with the 4-rule cascade.
5. **Historical timeline per company** — from kunngjøringer + roller changes. Mirrors what Purehelp does.
6. **Search + filter at scale** — 1M+ companies, sub-100ms search. Shows you understand indexes.
7. **Ownership network graph** — who owns whom, up to N levels deep. Mirrors your aksjonar graph knowledge.
8. **Financial trend charts** — revenue/EBITDA over years. Mirrors Purehelp's ranking/analysis features.

Each of these can be a section in your demo. Each maps to a bullet on your CV.

---

## Legal / IP notes — important

- **Brreg data (NLOD license):** completely fine to redistribute for commercial or non-commercial use. Just attribute source somewhere ("Kilde: Enhetsregisteret / Brønnøysundregistrene" in a footer).
- **Skatteetaten aksjonar data:** also public, redistributable.
- **Kunngjøringer:** public data, redistributable.
- **Don't scrape purehelp.no or proff.no.** They add their own value on top and their terms prohibit redistribution. Fetch from the primary sources only.
- **Don't call it a Purehelp/Proff competitor in copy.** Frame as "Norwegian company data demo — for portfolio / educational purposes." No trademark issues.
- **Consider a footer:** *"Demo project — data from Brønnøysundregistrene under NLOD. Not affiliated with any commercial provider."*

---

## Concrete first steps (weekend project pace)

1. **Day 1:** Set up a Hetzner VPS with Docker Compose (nginx + Postgres + Meilisearch). Download Brreg enheter CSV. Write a Python or Node ingest script. Verify ~1.17M rows land cleanly.
2. **Day 2:** Add Brreg roller ingest. Write the company profile page in Nuxt showing name, address, roles.
3. **Day 3:** Add search UI backed by Meilisearch. Sub-second full-text search over 1M companies.
4. **Day 4-5:** Add annual accounts fetching per company (on-demand from Brreg API + cache), add revenue chart.
5. **Day 6-7:** Add ownership data (aksjonærregisteret or aksjonar-lite from what's in Brreg). Add "companies related to this person" query.
6. **Weekend 2:** Add the AI-agent chat layer — "ask about any Norwegian company in natural language" using Claude API + your DB as tools via MCP.

Even the first two days already give you a working demo you can send links to.

---

## What to put in your CV / interview pitch

> "Bygde en demoplattform for norske foretaksdata: daglig ingest fra Brønnøysundregistrenes åpne datasett (~1.17M enheter, ~3.4M roller), integrert med Skatteetatens aksjonærregister og valgfrie regnskapsdata. Full-text-søk under 100ms, ownership-graf med rekursiv aksjonær-oppslag, og en AI-agent-chat-layer via Claude API + MCP. Stack: Postgres, Meilisearch, Nuxt 3, Python for pipelines, Docker Compose på VPS. Live på [URL]. Prosjektet demonstrerer kompetanse med multi-kilde data-integrering, batch og streaming pipelines, datakvalitet-handling, og AI-agent-utvikling."

That paragraph plus a working link is the strongest possible CV entry a data-systems engineer can have right now.
