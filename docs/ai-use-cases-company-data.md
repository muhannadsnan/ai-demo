# AI use cases · Norwegian company data platform

Companion to `demo_project_norwegian_company_data.md`. That file covers the data
sources and the stack; this one covers what the AI layer actually does.

Assumes the platform is already built and working: a database refreshed daily
and weekly from Brreg and Skatteetaten, with pages for **Foretak info**,
**Regnskap**, and **Roller / Aksjonærer**.

---

## The principle that decides everything

> **Your code decides. The AI explains.**

Every safe feature below computes its answer deterministically — in SQL, in your
own code — and uses the model for *language*: understanding the request on the
way in, or writing prose on the way out.

The unsafe features let the model decide a fact.

Two examples of the same feature, one safe and one not:

| | Safe | Unsafe |
|---|---|---|
| Risk flags | SQL finds negative equity, auditor resigned, 3 name changes in 2 years. Model writes the paragraph explaining them. | Model reads the accounts and decides whether the company is risky. |
| Ownership | Recursive CTE walks the shareholder chain. Model turns the result into a sentence. | Model infers who probably controls the company. |

Hold that line and most of the risk in this project disappears.

---

## Design decisions worth settling early

### Natural language → query: emit a filter spec, not SQL

Let the model produce a **JSON filter spec** that your code compiles into SQL,
rather than SQL directly.

```json
{
  "fylke": "Vestland",
  "nace_prefix": "49",
  "ansatte_min": 50,
  "har_regnskap_aar": 2025,
  "orderBy": "driftsinntekter",
  "direction": "desc",
  "limit": 50
}
```

Three reasons, in order of how much they will actually bite you:

1. **Correctness.** A syntactically valid query can still be silently wrong — a
   bad join against `roller` duplicates rows and doubles the revenue figure, and
   neither you nor the user can see it in the output. A filter spec has a small,
   testable surface: you unit-test the compiler once and every query is right.
2. **Multi-tenancy later.** The day you add per-user permissions, a filter spec
   carries the predicate automatically. Free-form SQL does not.
3. **Resource safety.** A perfectly legal `SELECT` can cartesian-join 1.17M
   enheter against 3.4M roller. A read-only database user does not protect you
   from that; a compiler that always emits `LIMIT` does.

**Run the query through a read-only database user regardless.** That is a real
control and costs nothing. Defence in depth.

**Do not use a second model to validate the first model's SQL.** A security
boundary has to be deterministic. If a rule can be expressed as a check, write
it as code; if it cannot be, a model will not enforce it reliably either — and
the text being validated is influenced by the user, which is exactly the input
you should trust least.

If you do want free-form SQL later, the deterministic version is: parse it with
a real SQL parser, assert a single statement, assert `SELECT` only, assert every
referenced table is on a whitelist, inject `LIMIT`, and set `statement_timeout`.
A curated view with the joins already correct removes most of the remaining risk.

### Cache model output on a content hash, not a timestamp

Generated summaries cost money, so regenerate them only when the underlying
facts change.

Store the hash of the inputs alongside the output. On each run, hash the current
inputs; if it differs, regenerate.

A timestamp is not equivalent. A daily Brreg reimport touches `updated_at` on
rows whose values are identical — timestamp-based invalidation would regenerate
over a million summaries every night for no reason. The hash only changes when
the content changes.

Two refinements that matter at this scale:

- **Two stages.** Use the timestamp as a cheap pre-filter to find candidate
  rows, then hash only those. You never hash the whole table.
- **Hash only what the output depends on.** If the summary uses name, employee
  count, revenue and bankruptcy status, hash those four fields. An address
  change then does not invalidate a summary that never mentioned the address.

This is the same `content_hash` pattern already used by the import routines,
applied to a different kind of expensive work.

---

## The use cases

### 1 · Search and query understanding

- **Free text → structured filters.** `"logistikk bergen over 50 ansatte"`
  becomes a filter spec. Lighter than full natural-language querying and it
  covers most of what people actually type.
- **Result-set summarisation.** *"127 matches, mostly Vestland, median 12
  employees, 8 filed accounts late."*
- **Cross-language queries.** English questions against Norwegian data. Cheap to
  add and it demonstrates something keyword search fundamentally cannot do.
- **Show the generated query.** Displaying the filters that were applied builds
  trust and makes a wrong answer debuggable instead of mysterious.

### 2 · Per-company question answering

The strongest fit in the project, because `kunngjøringer` are text and text is
what retrieval is for.

- *"What happened to this company in the last two years?"* — a timeline built
  from announcements, role changes and filed accounts.
- Auto-generated profile summary: what the company does, size, trend, ownership,
  anything notable.
- Always cite: link every claim back to the announcement or filing it came from.

### 3 · Similar companies

Compare the **statutory purpose text** (`vedtektsfestetFormaal`) rather than the
NACE code. NACE is a hand-maintained classification and far too coarse — two
companies filed under the same code can be completely different businesses,
while two genuinely similar companies often sit under different codes.

This is the single best use of embeddings in this dataset (see the note at the
end of this file), and the clearest demonstration of something keyword search
cannot do.

Related: **free-text description → suggested NACE code**, which is a plain
classification task and very reliable.

### 4 · Watchlists and monitoring

Commercially the most valuable category — it is what the incumbents actually
sell — and technically it is your existing cron plus a saved filter spec.

- *"Alert me when any company in Bergen with more than 50 employees goes
  bankrupt"* → a natural-language request becomes a stored filter that runs daily.
- Daily or weekly digest summarising what changed across a watchlist.
- Change narration: *"Eksempel AS changed auditor and filed accounts 40 days late."*

### 5 · Extraction — the input side

Underrated, and among the most reliable things a model does, because the output
is schema-shaped and therefore checkable.

- Upload a PDF annual report or contract → extract orgnr, parties, amounts,
  dates → link to companies already in the database.
- Paste messy text (*"met someone from Eksempel Logistikk in Bergen"*) → resolve
  to an organisation number.
- Normalise inconsistent company-name variants across sources.

### 6 · Ownership and people

- *"Who ultimately controls this company?"* — a recursive CTE walks the
  shareholder chain; the model turns the resulting graph into a sentence.
- *"What else does this person own or sit on the board of?"* — name plus birth
  year resolution.
- Narrate an ownership diagram in plain language for people who cannot read it.

### 7 · Flags and narratives

Deterministic detection, model narration. Never the reverse.

Detect in SQL: negative equity, auditor resigned, repeated name changes, an
address shared with dozens of other entities, accounts filed late, sudden
capital changes. Then have the model explain the flags in plain Norwegian.

**Legal caution.** Do not frame this as a credit score or a creditworthiness
assessment. That is regulated-adjacent and a genuine exposure on a public
portfolio project. Frame it as *"observations from public records"*, show the
raw facts alongside the prose, and let the reader draw the conclusion.

### 8 · Internal and operational uses

The safest place to start, because no customer ever sees a hallucination.

- Explain import failures in plain language from the reject log.
- Cluster and label reject reasons across a run.
- Generate the daily reconciliation report as prose.
- Suggest name-normalisation rules from the variants actually observed.

### 9 · Agent with tools

The step beyond single-shot querying. Give the model a small set of tools —
`search_companies`, `get_accounts`, `get_roles`, `traverse_ownership` — and let
it plan several steps.

*"Compare the three largest logistics companies in Bergen by revenue growth"*
requires a search, three account fetches, a calculation, then a summary.

This is the genuine "AI agent" capability, and the MCP angle from the project
plan. It is also where cost, latency and failure all compound — build it last,
once the individual tools are reliable on their own.

---

## Suggested order

1. **Per-company summary and "what happened recently"** — best result for the
   effort, and it is the pattern from the ai-demo applied to real data.
2. **Structured search from free text** — covers most real queries, low risk.
3. **Similar companies** from purpose text — the thing keyword search visibly
   cannot do.
4. **Watchlist alerts** — turns a lookup tool into a product.
5. **Agent with tools** — the finale, once 1–4 give it something solid to call.

Internal ops uses (§8) can be slotted in anywhere; they are the lowest-risk
place to get the first AI call into production.

---

## A note on "embeddings"

An embedding turns a piece of text into a **position** — a set of coordinates.
Texts that mean similar things end up close together.

Picture every company's purpose text placed on a very large map. Freight
companies cluster in one region, hairdressers in another, software firms in a
third. Nobody drew those borders; the positions come from the meaning of the
words. "Find similar companies" then just means "find the nearest neighbours".

The important part: two companies can be neighbours **without sharing a single
word**. *"Transport av gods på vei"* and *"Distribusjon av varer med lastebil"*
have almost nothing in common lexically and land right next to each other.
Keyword search can never make that connection; this is precisely what it buys you.

In practice: compute the position once per company (batched, at import time),
store it, and finding neighbours is a distance query. Postgres with the
`pgvector` extension does this natively. The list of coordinates is what the
literature calls a *vector* — but you do not need to know what any individual
number means, only that closer means more similar.

**Cost note.** One embedding per company across 1.17M companies is a real,
one-off expense — worth pricing before committing, and worth restricting to a
useful subset (say, AS companies with filed accounts) for a demo.
