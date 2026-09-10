# Data provenance and licensing

Where every dataset came from, what licence it carries, and what may be
published. Written to be readable by someone who asks *"how did you get this,
and are you allowed to?"* — a reasonable question about a demo holding 27 years
of Norwegian company accounts.

**Short answer: it is public data. Most of it was taken from the official
sources directly; the historical accounts came from an earlier project of mine
whose collection I cannot fully document, so only the part with a documented
origin is ever published. One dataset contains personal data and is not
published at all.**

---

## The sources

| Dataset | Rows | Source | Licence | Publishable |
|---|---|---|---|---|
| `enheter` | 1,173,013 | Brønnøysundregistrene, bulk CSV | NLOD | Yes, with attribution |
| `roller` | 3,418,541 | Brønnøysundregistrene, bulk JSON | NLOD | Yes, with attribution |
| `regnskap` (`kilde='brreg-api'`) | current period | Brønnøysundregistrene, per-company API | NLOD | Yes, with attribution |
| `regnskap` (`kilde='historikk'`) | 1999–2024 | earlier project, collection not fully documented | figures are Brreg's (NLOD) | **No — local development only** |
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

A fair question, and the honest answer has two halves that are worth keeping
apart, because they are not equally well documented.

**The current period comes from Brønnøysundregistrene directly.** Their public
API at `data.brreg.no/regnskapsregisteret/regnskap/{orgnr}` requires no key and
no registration. What it does not offer is a bulk download — it serves **one
company per request**, and **only the most recent period**. This project fetches
from it one organisation number at a time, throttled. Those rows carry
`kilde = 'brreg-api'`: exact kroner, currency known, and re-derivable by anyone
who cares to repeat the exercise.

**The historical years came from an earlier project of mine**, assembled over
several months by more than one collection method. I do not hold a complete
record of every step, so this document makes no claim about how each part of it
was obtained.

What *can* be stated is what was checked. Before the historical data was
trusted, fourteen fields across the resultatregnskap and balanse were compared
against the live Brreg API and matched exactly once scaled by ×1000, for four
companies including one reporting in USD. See `server-drift/README.md`. Those
rows carry `kilde = 'historikk'` — rounded to the nearest thousand, currency not
recorded.

That column is not decoration. It is what keeps the two halves separable, and
the separation is the point:

> **Anything this project publishes serves `kilde = 'brreg-api'` only.** The
> historical rows exist to develop against locally.

As of September 2026 the platform is not publicly deployed, and the accounting
data has never left this machine.

### Why the distinction matters

The figures themselves are Brreg's and carry NLOD, which permits redistribution
with attribution. But a licence on the facts is not the whole question. In the
EEA a *compilation* can carry a database right of its own, earned by the
investment in assembling it, even when every individual fact inside it is free
to use. So "the numbers are public" answers less than it appears to, and the
honest position is to publish the half whose origin is documented rather than to
argue about the half that is not.

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
SELECT * FROM aksjeeie;   -- the view: no personal data
```

| | In `aksjeeie_persondata` (table) | In `aksjeeie` (view) |
|---|---|---|
| Corporate shareholder name and orgnr | yes | **yes** — a company is not a person |
| Ownership percentage | yes | **yes** |
| Individual's name | yes | no |
| Individual's birth year | yes | no |
| Individual's postcode and town | yes | no |

An individual appears as an anonymous row carrying only a percentage. The
ownership graph — including recursive company-owns-company traversal — survives
completely. The people do not appear.

**The safe name is the obvious one.** `aksjeeie` is the view; the table is called
`aksjeeie_persondata`. Writing the natural query — `SELECT * FROM aksjeeie` —
gives you the filtered data, and reading the personal columns requires
deliberately naming a table that says what it holds. Safety that depends on
remembering a longer name eventually fails.

The raw file is kept in `data/`, which is gitignored and has never been
committed.

---

## If someone asks

- **"Is this legal?"** Yes. Brreg data is NLOD — free to republish with
  attribution. The shareholder data is not republished in identifiable form.
- **"How did you get the history?"** The current period comes from Brreg's
  public API, one company at a time, throttled — no key, no special access. The
  older years came from an earlier project of mine and I do not have a complete
  record of how every part was collected, so I do not claim one. I verified the
  figures against the API before trusting them, I label every row with its
  source, and I publish only the rows I can account for.
- **"So can you publish the history?"** I don't. `kilde = 'brreg-api'` is the
  only source served publicly; the rest is local development data. Facts under
  NLOD are free to redistribute, but a compilation can carry a database right
  of its own — so the answer here is a deployment rule, not an argument.
- **"What about GDPR?"** The one dataset containing personal data is stored but
  not published, and the separation is enforced in the database by a view rather
  than by convention.
