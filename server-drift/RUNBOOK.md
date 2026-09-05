# Runbook

Named failure modes and the command for each. Written to be readable at 23:00
by someone who did not build the system.

Everything below is for **stage 1** (app + proxy). Database procedures arrive
with stage 2 and are marked as such.

**Is this file worth having yet?** Honestly, barely. At stage 1 the only real
failure is "the container stopped, restart it", and a runbook for that is
ceremony. It earns its place at stage 2, when there is a database that can fill
a disk, imports that can hang, and certificates that can expire — failures where
the fix is not obvious and you will not be thinking clearly. It exists now so
the procedures get written as each service is added, rather than after the first
outage.

---

## Routine operations

| Task | Command |
|---|---|
| Deploy the current commit | `make deploy` |
| See what is actually running | `make version` |
| Roll back | `make rollback VERSION=<sha>` |
| Follow logs | `make logs` |
| Container status and health | `make ps` |
| Which AI backend is live | `make health` |

Deploys tag the image with the git SHA, so `make version` answers "what is in
production" without guessing, and rollback names a specific build.

---

## The site is down

Work in this order.

**1. Is the container running?**

```bash
make ps
```

`Exit 1` or a restart loop → go to logs. `healthy` → the problem is upstream
(DNS, firewall, the proxy).

**2. What do the logs say?**

```bash
make logs
docker compose logs --tail=100 proxy
```

**3. Is the disk full?** The most common cause of a dead small VPS.

```bash
df -h
docker system df          # images and build cache grow without bound
docker system prune -a    # frees space; next deploy rebuilds from scratch
```

Log rotation is configured (10 MB × 3 per service), so runaway logs should not
be the cause — but check before assuming.

**4. Out of memory?**

```bash
free -h
docker stats --no-stream
dmesg | grep -i 'killed process'   # the OOM killer leaves a record
```

If the app was OOM-killed, either raise its limit in `docker-compose.yml` or
find what grew. On a small box, an unbounded ingest job is the usual culprit.

---

## HTTPS is broken / certificate errors

```bash
docker compose logs proxy | grep -i -E 'certificate|acme|error'
```

Common causes, most frequent first:

- **DNS does not point here yet.** Check with `dig +short $DOMAIN`. Let's Encrypt
  validates over HTTP, so the record must resolve to this server before Caddy
  can issue.
- **Port 80 blocked.** ACME validation needs it, even though traffic is served
  on 443. Check the provider's firewall as well as `ufw`.
- **Rate limited.** Let's Encrypt allows 5 duplicate certificates per week. If
  you hit it, you wait — there is no override. This is why the `caddy_data`
  volume matters: destroying it discards valid certificates and forces reissue.

Never `docker compose down -v` on the proxy to "clean up". That deletes the
certificate volume.

---

## The app returns 503 with a message about the AI provider

Working as designed. `requireAiProvider()` turns a configuration mistake into a
503 that names the missing variable rather than a generic error.

```bash
make health
```

Check `NUXT_AI_PROVIDER` and `NUXT_OPENAI_API_KEY` in `server-drift/.env`, then
`make restart`. Environment changes need a container restart; they are read at
boot.

---

## Search returns nothing / 500s on every query

The retrieval index is built at boot by reading `knowledge/` relative to the
working directory. If those files are missing from the image, the container
starts cleanly and then fails on the first search.

```bash
docker compose exec app ls knowledge/
```

Empty → the `COPY` of `knowledge/` was dropped from the Dockerfile, or
`.dockerignore` is excluding it. Rebuild.

---

## Deploy made things worse

```bash
make version                    # note the current sha
make rollback VERSION=<previous-sha>
```

Rollback does not rebuild, so it is fast — seconds, not minutes. Previous images
stay on disk until `docker system prune`, which is a reason to prune
deliberately rather than on a schedule.

---

## Stage 2 — to be written when Postgres lands

These entries are placeholders so the gaps are visible rather than forgotten:

- [ ] Restore from backup — with the date of the last successful drill and how
      long it took. A backup that has never been restored is a hypothesis.
- [ ] Ingest job failed or is stuck
- [ ] Replication lag / connection pool exhausted
- [ ] Disk filling from WAL

---

## Escalation

Single-operator project, so escalation means: stop, write down what you changed,
and roll back before experimenting further. Most outages on a system this size
are caused by the previous fix.
