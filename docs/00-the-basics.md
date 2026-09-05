# 00 · The basics

Start here. This is the whole project explained without jargon. Nothing in this
file requires you to know anything about AI.

---

## What this project is

A small web app with two features — a chat, and a search over a set of company
documents — built so you can see how an AI feature is wired into an ordinary
web application.

It is a teaching project. The AI part is about 300 lines. Everything else is
normal web development you already know.

---

## The flow

This is the part worth getting right, because everything else follows from it.

```
  1. User types a question in the browser
                    │
  2. Browser sends it to YOUR SERVER          ← never straight to the AI
                    │
  3. Your server searches the company files itself
     and picks the 2-3 most relevant paragraphs
                    │
  4. Your server sends the AI three things:
        · those paragraphs
        · the question
        · "answer using only this"
                    │
  5. The AI writes an answer and sends it back to your server
                    │
  6. Your server passes it on to the browser
```

### The one thing people get wrong

**The AI never receives your files.**

It is a stateless text-in / text-out service sitting on someone else's computer.
It cannot reach your database, your network, or your disk. It only ever sees the
few paragraphs your server chose to paste into the message, and it forgets them
the moment it replies.

Step 3 — the searching — is *your code*. Not the AI's.

### Three practical things that follow from this

**Citations work.** Your server already knows which paragraphs it sent, so it
can label them `[S1]`, `[S2]` and tell the model to cite the label. There is no
magic in the citation feature — it is numbered paragraphs and an instruction.

**A wrong answer is usually your bug, not the AI's.** If the answer is wrong,
nine times out of ten your search sent the wrong paragraph. That is your code,
and you can debug it the way you debug any other query.

**Cost stays bounded.** You are billed per unit of text sent. You send three
paragraphs, not the whole document set. When you get to a project with a million
records, you will never send a million records — you send the three rows that
matter.

---

## What you actually need to know to work on this

Four things. That is the whole list.

1. **Browser → your server → AI.** Never browser → AI. The API key lives on the
   server and must never reach the browser. Same reason your database password
   is not in JavaScript.

2. **You must send the relevant text along with the question.** The model knows
   nothing about your company. If you want an answer about your systems, the
   facts have to be in the message.

3. **Search quality is your responsibility.** Picking which paragraphs to send is
   ordinary search engineering — and it is where most of the quality lives.

4. **Configuration lives in `.env`.** Which AI provider to use, and its key.
   Nothing else needs changing to swap providers.

---

## What you do NOT need to know yet

You will run into words like *vector*, *embedding*, *cosine similarity*, *IDF*,
*normalised*. **None of it is required to build, run or ship this.**

That vocabulary becomes useful on one specific day: when answers start coming
back wrong and you need to work out *why the search picked the wrong paragraph*.
It will make far more sense then, with a concrete bad answer in front of you,
than it does now in the abstract.

It is the same relationship you already have with MySQL. You wrote working
queries for years before you needed to read `EXPLAIN` output. `EXPLAIN` did not
become useful until a query got slow.

When that day arrives, read [03-how-ai-search-works.md](03-how-ai-search-works.md)
and run `npm run trace`, which dumps every intermediate step of a single search
into `test-data/` so you can see exactly where it went wrong.

---

## The under-the-hood bit, in plain words

Only if you are curious. Still not required.

To decide which paragraphs are relevant, the app turns text into numbers so it
can compare texts mathematically.

**Picture a form with 4096 checkboxes, one for every possible word.** Each
paragraph fills in the same form. Two texts that tick a lot of the same boxes are
probably about the same thing.

That is the entire idea. The rest is detail:

- **"4096 numbers, and 4089 of them are zero"** — a short question only uses about
  7 words, so only 7 boxes get ticked. The rest stay empty. Zero simply means
  "this word is not in this text". It is absence, not a special value.

- **Why 4096?** An arbitrary choice. Large enough that two different words rarely
  land in the same box, small enough to stay fast. 2000 or 10000 would work too.

- **Why so many boxes for a 7-word question?** Because the form needs a box for
  every word that might appear in *any* document, not just this question. Every
  text fills in the same form — that is what makes them comparable.

- **Why 7 "tokens" from a 7-word sentence?** *"What authentication does the order
  API use?"* → throw away filler words (what, does, the) → 4 real words → then add
  adjacent pairs (`order_api`, `api_use`, `authenticat_order`) → 7. Pairs are kept
  because "order api" together means something different from "order" and "api"
  separately.

- **Why is the box chosen by `hash(word) % 4096`?** To avoid keeping a giant
  dictionary of every word. It is the same trick as a PHP array's hash bucket:
  hash the key, mod by the table size, and the same key always lands in the same
  slot.

- **Why do some words count more than others?** A word appearing in nearly every
  paragraph ("order", "service") tells you nothing about which paragraph you want,
  so it counts for little. A word appearing in two paragraphs ("certificate") is
  a strong signal, so it counts for a lot. If you have ever tuned MySQL
  `FULLTEXT` relevance, this is the same idea.

---

## Where to go next

| When you want to… | Read |
|---|---|
| See the request path and why it is shaped that way | [01-architecture.md](01-architecture.md) |
| Understand the chat feature and what it costs | [02-how-chat-works.md](02-how-chat-works.md) |
| Understand the search feature properly | [03-how-ai-search-works.md](03-how-ai-search-works.md) |
| Build this in CodeIgniter and MySQL | [04-porting-this-to-codeigniter-mysql.md](04-porting-this-to-codeigniter-mysql.md) |
| Put something like it in front of customers | [05-production-checklist.md](05-production-checklist.md) |
| Look up a word | [06-glossary.md](06-glossary.md) |

Or just run it and click around:

```bash
npm run dev     # http://localhost:3000
```
