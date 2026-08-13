# Recording transcript — 60 second submission video

Read the **SAY** column aloud. Do the **DO** column. Numbers are measured, not aspirational —
they are what appears on screen if you follow the click order exactly.

**Before you hit record**
- `npm run dev` (never `node src/server.js` — only the npm script loads `.env`)
- Terminal visible in the corner of the capture if you can: the `[precedent]` and `[SCORED]`
  lines are evidence, and judges read them faster than narration.
- Confirm the log says `[precedent] $rankFusion → 5 cases`. If it says `local TF-IDF`, wait
  30 seconds, re-score, and check again — and if it still says that, cut the phrase
  "vector search and Atlas Search" from beat 3.
- Hit **Reset**. Confidence must read **4%**, Risk must read **— UNKNOWN**.

Total spoken: ~155 words. That is 60 seconds at a normal pace. Do not rush it; if you are
running long, cut the second sentence of beat 4, not the first.

---

## 0:00 – 0:11 · The cold start

**DO** — sit on the empty file. Don't click anything.

> **SAY:** "Onboarding a client at an accounting firm takes a senior accountant two weeks.
> This is an empty file — confidence four percent, risk *unknown*. Not low. **Unknown.** An
> empty file isn't a safe client, it's a client you know nothing about, and treating those as
> the same thing is what gets firms fined."

---

## 0:11 – 0:24 · Documents land, the agent acts

**DO** — click `kbo_uittreksel...pdf`, then `vandamme_eid_specimen.jpg`. Pause on the eID so
the drafted email is visible.

> **SAY:** "The company registration lands and the filing form fills itself in — that's the
> document model, one collection per artifact. Then the director's eID — **expired, two
> thousand twenty four**, watermarked SPECIMEN. The agent doesn't just flag it. It opens a
> case and drafts the client email, naming that document and that date."

**ON SCREEN:** confidence 26% → 39%, risk 0.060 → 0.143, the drafted email bottom-left.

---

## 0:24 – 0:36 · Contradiction and the graph

**DO** — click `engie_facture_2026_06.pdf`, then `ubo_register_uittreksel_2026.pdf`.
**Skip the annual accounts.**

> **SAY:** "The utility bill disagrees with the registered seat — same street, different
> number, one in Dutch and one in French — one aggregation pipeline across every document on
> file. That's the check a junior does by eye across twelve PDFs. Then the UBO extract, and
> **`$graphLookup`** walks the ownership two hops into a cluster sharing one bank account.
> Risk: **0.49, medium.**"

**ON SCREEN:** address field amber with both values, graph path, **0.493 MEDIUM**, 13 of 23.

---

## 0:36 – 0:52 · The beat

**DO** — the verdict form is pre-filled. Click **HIGH RISK**, then **Re-score**. Let the dial
finish animating before you speak the number.

> **SAY:** "Now a colleague writes one verdict about a past case — one line of reasoning, into
> one collection. Re-score. **0.72 — high.** Atlas embedded his reasoning itself — `autoEmbed`
> with `voyage-4` — and **`$rankFusion`** blended vector search with Atlas Search to find it.
> The breakdown names him, quotes him, dates it seconds ago. Retrieval found his judgment; his
> judgment moved the number. No retraining. No restart. One insert into one collection."

**ON SCREEN:** risk 0.493 → **0.722 HIGH**, precedent 0.24 → 0.90, "WRITTEN SECONDS AGO"
badge on M. Dubois.

---

## 0:52 – 1:00 · Close

> **SAY:** "`verdicts` isn't a KYC table. It's a judgment table — same pipeline answers 'is
> this VAT treatment right'. Every accountant does this for every client, at one to two
> thousand euros a head, and throws the reasoning away every time. This keeps it."

---

# Tech callouts

**The MongoDB feature is now named on screen as each beat happens** — the bottom-left ticker
updates itself and reads the *live* retrieval rung from the score payload. You do not have to
say any of it, and you must not save it for the close.

The phrases above are already woven into the narration. If a take runs long, these are the
first words to cut, in this order: "one collection per artifact", "one aggregation pipeline
across every document on file", then the `autoEmbed` clause. Keep `$graphLookup` and
`$rankFusion` — they are the two that matter.

**Watch the ticker on the keeper take.** If it reads *"in-process TF-IDF — Atlas unavailable"*,
Voyage has rate-limited you: stop, wait 30 seconds, Re-score, and check it again before you
speak the `$rankFusion` line.

| Beat | Swap in |
|---|---|
| 0:11 | "…the filing form fills itself in — that's the document model, one collection per artifact." |
| 0:24 | "…`$graphLookup`, maxDepth three, over the ownership edges." *(already in the script)* |
| 0:36 | "Atlas generates the embeddings itself — `autoEmbed` with `voyage-4`, no embedding API call in our code — then `$rankFusion` blends vector search with Atlas Search." |
| 0:52 | "Everything you saw is one aggregation pipeline and one collection." |

**Do not say `$rerank`.** It is implemented with correct syntax but needs MongoDB 8.3, and the
sandbox cluster is 8.0.29. It is in the repo as the production path; it did not run today.

**Do not say the documents were parsed or read.** The extracted fields are seeded —
`voyage-multimodal-3.5` is an embedding model and cannot extract fields, so that path was cut
rather than faked. "The eID lands and the system flags it" is completely true. "Watch it read
the passport" is not.

**Do not claim any partner tool.** No ElevenLabs, LangChain, OpenRouter or Fireworks
integration exists.

---

# If a take goes wrong

- **Numbers don't match** → you dropped the annual accounts. Reset and redo without it.
- **Precedent doesn't jump** → the verdict didn't insert, or retrieval fell back. Check the
  terminal for `[SCORED]` and `[precedent]`.
- **Risk shows 0.00 instead of UNKNOWN on the empty file** → you didn't Reset.
- **Everything is slow** → Voyage rate limit. Wait 30 seconds. Reads are cached, so idling
  costs nothing.

One clean 60-second take beats a stitched montage. If you get through beat 4 cleanly, keep
rolling — the close is the easiest part to re-record separately.
