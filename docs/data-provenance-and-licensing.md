# Data provenance and licensing

Where every dataset came from, what licence it carries, and what may be
published. Written to be readable by someone who asks *"how did you get this,
and are you allowed to?"* — a reasonable question about a demo holding 27 years
of Norwegian company accounts.

**Short answer: all of it is public data, obtained from the official sources.
One dataset contains personal data and is therefore not published.**

---

## The sources

| Dataset | Rows | Source | Licence | Publishable |
|---|---|---|---|---|
| `enheter` | 1,173,013 | Brønnøysundregistrene, bulk CSV | NLOD | Yes, with attribution |
| `roller` | 3,418,541 | Brønnøysundregistrene, bulk JSON | NLOD | Yes, with attribution |
| `regnskap` | 4,959,968 | Brønnøysundregistrene, per-company API | NLOD | Yes, with attribution |
| `naeringskoder` | 1,785 | SSB Klass API | Open data | Yes |
| `kommuner`, `fylker` | 377 | SSB Klass API | Open data | Yes |
| `postnummer` | 5,122 | Bring | Free | Yes |
| `aksjeeie` | 3,092,787 | Skatteetaten, on request | **Personal data** | **No — see below** |

---

## NLOD, and the attribution it requires

Most of this is **Norsk lisens for offentlige data (NLOD)**. It permits free
use, including commercial use, and free redistribution. It requires one thing:
**credit the source**.

So any page showing this data must carry, visibly:

> Kilde: Enhetsregisteret / Brønnøysundregistrene

That is not a formality — it is the licence condition, and it is also the
simplest answer to "where did this come from".

---

## "How do you have 27 years of accounts? That is not downloadable."

It is a fair question, and the answer is straightforward: **patience, not
privilege**.

Brønnøysundregistrene publishes annual accounts through a public API at
`data.brreg.no/regnskapsregisteret/regnskap/{orgnr}`. It requires no key and no
registration. What it does not offer is a bulk download — it serves **one
company per request**, and **only the most recent period**.

So a full history is assembled the slow way: request each organisation number
in turn, throttled, over days, and keep what comes back. Do that for a few years
and you accumulate history that no single request can return. That is exactly
how the commercial providers built their archives, and there is nothing
privileged about it — only time.

Two things follow, and both are visible in the schema:

- The figures were **verified against the live API** before being trusted.
  Fourteen fields across the resultatregnskap and balanse matched exactly, for
  four companies including one reporting in USD. See `server-drift/README.md`.
- Every row records its own provenance in `regnskap.kilde`:
  `brreg-api` (exact, current period) or `historikk` (bulk-collected, rounded to
  the nearest thousand).

**Nothing here was scraped from a commercial provider.** Purehelp and Proff add
their own analysis on top of the same public registers and their terms prohibit
redistribution; this project takes only from the primary sources.

---

## The one dataset that is not published

`aksjeeie` — Skatteetaten's Aksjonærregisteret — is different from everything
else here, and the difference is not a technicality.

It is supplied on request rather than downloaded, and the covering message from
Skatteetaten states plainly:

> *Uttrekket inneholder personopplysninger, og mottaker må forholde seg til
> personopplysningsloven for videre bruk av utleverte data.*

Of 3,092,787 shareholdings, **2,526,639 identify a private individual** by name,
birth year, postcode and town. That combination identifies a real person, and
the extract is released under the same criteria as the tax lists, where
republication is restricted.

### How that is handled

The data is stored, because the ownership structure is what makes the project
interesting. It is **not** published in identifiable form:

```sql
SELECT * FROM aksjeeie_offentlig;   -- the view the application reads
```

| | In `aksjeeie` | In `aksjeeie_offentlig` |
|---|---|---|
| Corporate shareholder name and orgnr | yes | **yes** — a company is not a person |
| Ownership percentage | yes | **yes** |
| Individual's name | yes | no |
| Individual's birth year | yes | no |
| Individual's postcode and town | yes | no |

An individual appears as an anonymous row carrying only a percentage. The
ownership graph — including recursive company-owns-company traversal — survives
completely. The people do not appear.

**Public-facing code reads the view, never the table.** The personal columns are
not in the view at all, so a mistake in a query cannot leak them.

The raw file is kept in `data/`, which is gitignored and has never been
committed.

---

## If someone asks

- **"Is this legal?"** Yes. Brreg data is NLOD — free to republish with
  attribution. The shareholder data is not republished in identifiable form.
- **"How did you get the history?"** The public API, one company at a time,
  throttled, over days. No key, no special access, just time.
- **"Did you scrape Purehelp or Proff?"** No. Only the primary registers.
  Their terms prohibit redistribution, which is precisely why they were avoided.
- **"What about GDPR?"** The one dataset containing personal data is stored but
  not published, and the separation is enforced in the database by a view rather
  than by convention.
