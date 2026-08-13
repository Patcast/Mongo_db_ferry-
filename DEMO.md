# Demo scripts

Two scripts and a Q&A sheet. Every number in here was measured from the running system with
`AS_OF=2026-08-13` and the seeded 17-verdict corpus. Do not round them, do not improve them,
do not narrate a number the screen is not showing.

**The exact sequence that produces the scripted numbers** — this matters, the numbers do not
survive a different order:

| Action | Risk | Band | Confidence | Fields |
|---|---|---|---|---|
| start, empty file | — | UNKNOWN | 4% | 1 of 23, 22 blocking |
| drop `kbo_registration_0721489336.pdf` | 0.052 | LOW | 30% | 7 of 23 |
| drop `vandamme_passport_specimen.jpg` | 0.225 | LOW | 39% | 9 of 23 |
| drop `engie_facture_2026_06.pdf` | 0.337 | LOW | 44% | 10 of 23 |
| drop `ubo_structuur.pdf` | **0.494** | **MEDIUM** | 56% | 13 of 23, 10 blocking |
| write the verdict, re-score | **0.722** | **HIGH** | 56% | 13 of 23, 10 blocking |

Do **not** drop `jaarrekening_2022.pdf` (the stale annual accounts) in either script. It is real and it works, but it
takes risk to 0.556 before the verdict and 0.760 after, and then the scripted 0.494 → 0.722
is a lie. Four documents, in the order above.

---

# A. The 60-second submission video

Total narration is about 150 words at roughly 175 wpm. Screen recording of the live UI at
1280×720 or better; the two dials and the band labels have to survive downscaling.

## Beat 1 — 0:00–0:12 · the empty file

**On screen:** the client file for Verhoeven Logistics BV with nothing in it. Confidence dial
reads **4%**. Risk dial reads **UNKNOWN** in grey — not a zero, not a green LOW. The filing
form below is a wall of red: *1 of 23 fields resolved — 22 blocking submission.*

**Narration:**

> A new client file at an accounting practice. Empty. Confidence four percent. Risk: unknown.
> An empty file isn't low-risk. It's unknown. That distinction is what gets firms fined.

**Shot notes:** hold on the two dials for the first three seconds so the grey UNKNOWN band
registers before anything moves. Do not cut to the form until "twenty-two blocking" is visible.

## Beat 2 — 0:12–0:30 · the documents land, and the agent acts

**On screen, in this order:**

1. `kbo_registration_0721489336.pdf` — six form fields flip red to green, confidence 4% → **30%**.
2. `vandamme_passport_specimen.jpg` — integrity panel opens: *"PASSPORT expired — expired
   2024-08-02 (741 days ago)"*, cited against the filename. Confidence **39%**.
3. `engie_facture_2026_06.pdf` — contradiction panel opens with **both values side by side**:
   `Wetstraat 12, 1040 Brussel` (registration) against `Rue de la Loi 120, 1040 Bruxelles`
   (utility bill), labelled *same street, different number (12 vs 120)*. Confidence **44%**.
4. `ubo_structuur.pdf` — drops at about 0:28 with no narration over it. Graph component fires,
   risk settles at **0.494 MEDIUM**, confidence **56%**.
5. **The drafted email, full width, held on screen through the end of the beat.** This is the
   single most important frame in the video: it is what proves the system acts rather than
   displays.

The draft, verbatim as generated — the opening is what needs to be readable on screen; below
this the same draft lists the four remaining outstanding fields and closes:

```
Subject: Verhoeven Logistics BV — information required to complete your onboarding

Dear Mr Vandamme,

We are completing the client due diligence file for Verhoeven Logistics BV and cannot
proceed on the PASSPORT you supplied: expired 2024-08-02 (741 days ago).

Please send a current copy. A clear photograph or scan of the full page is sufficient —
we do not need a certified copy at this stage.
```

**Narration:**

> Three documents land. Registration — fields go green. Passport — expired, second of August
> 2024, flagged by filename. Utility bill — the address contradicts the registered seat.
> Wetstraat 12 against Rue de la Loi 120: same street, different number. So the agent opens a
> case and drafts the client email itself, naming the passport and the exact expiry date.

**Shot notes:** the address contradiction needs a full second of stillness with both values in
frame — it is the beat a non-accountant understands instantly. Zoom the draft email so the
words "expired 2024-08-02" are readable at half size.

## Beat 3 — 0:30–0:52 · the beat

**On screen:** risk dial at **0.494**, band **MEDIUM**. Cut to the verdict form, pre-filled;
the only visible action is a click on **HIGH** and a line of rationale going into `verdicts`.
Cut back. Re-score. The risk dial animates **0.494 → 0.722** and the band flips to **HIGH**.
The precedent panel expands: **M. Dubois**, decision **HIGH**, dated 2026-02-11, his rationale
quoted, and a *just written — seconds ago* flag on the row. Precedent component moves
0.244 → 0.896; confidence does not move at all.

**Narration:**

> Risk sits at 0.494, medium. Now a colleague writes one verdict — high, with one line of
> rationale — into the verdicts collection. Re-score. Risk jumps to 0.722, high. And the
> breakdown names M. Dubois, quotes his rationale, and timestamps it seconds ago. No
> retraining. No restart. One insert into one collection.

**Shot notes:** do not cut during the dial animation — the movement is the argument. Keep the
confidence dial in frame while risk moves, so it is visible that confidence stayed at 56%: a
colleague's opinion is not new evidence about the file.

## Beat 4 — 0:52–1:00 · what it actually is

**On screen:** the `verdicts` document itself, with `decision_type: "kyc_risk"` highlighted,
next to the seeded `vat_treatment` row. Then the feature list.

**Narration:**

> verdicts isn't a KYC table. It's a judgment table — the same pipeline answers "is this VAT
> treatment right." Every practice loses its hardest calls when people leave. This one keeps
> them.

**If the narration runs long,** cut "It's a judgment table" and let the highlighted
`decision_type` field carry it.

## Shot list

| # | Length | Shot | Must be legible |
|---|---|---|---|
| 1 | 0:00–0:03 | Both dials, empty file | grey **UNKNOWN**, **4%** |
| 2 | 0:03–0:12 | Pan down to the filing form | *1 of 23 resolved — 22 blocking* |
| 3 | 0:12–0:17 | Registration drops, fields go green | confidence **30%** |
| 4 | 0:17–0:22 | Passport drops, integrity panel | *expired 2024-08-02*, filename |
| 5 | 0:22–0:27 | Utility bill drops, contradiction panel | both addresses, **12 vs 120** |
| 6 | 0:27–0:30 | Ownership chart drops; cut to the drafted email | risk **0.494 MEDIUM**; "expired 2024-08-02" in the draft |
| 7 | 0:30–0:36 | Risk dial at 0.494, then the verdict form, click HIGH | **0.494 MEDIUM** |
| 8 | 0:36–0:44 | Re-score, dial animates | **0.722 HIGH**, confidence still **56%** |
| 9 | 0:44–0:52 | Precedent panel expanded | **M. Dubois**, 2026-02-11, quoted rationale, *seconds ago* |
| 10 | 0:52–1:00 | `verdicts` document, `decision_type`, feature list | `kyc_risk` / `vat_treatment` |

## Before you record

- `MONGODB_URI` set and the vector index built. The in-process TF-IDF fallback retrieves the
  same case, but narrating "vector search" over the local backend would be dishonest — it is
  the one thing in this repo that would be.
- `AS_OF=2026-08-13` in the environment, or the "741 days ago" and "expired 2 August 2024"
  lines drift.
- `npm run seed` immediately before recording. The analogous verdict must **not** be in the
  corpus at the start.
- Do a silent run first and check the six numbers against the table at the top of this file.

## Narration

Narration is generated with **ElevenLabs** (hackathon partner; one month free of the Creator
tier via their Discord, `#coupon-codes`). Record a clean take of the four blocks as separate
clips so a single flubbed line does not force a full re-generate, and cut the video to the
audio rather than the other way round — the beat-3 dial animation should land on the word
"jumps".

---

# B. The ~3-minute finals script

Different problem. The finals winner is chosen by **live audience vote**, not by a rubric, and
an audience in a loud room at seven in the evening responds to an expired passport and a
contradicting address. It does not respond to hybrid retrieval mechanics. So the order below
is not the order of technical interest — the document defects come first and carry the room,
the retrieval argument arrives only once they already care about the file.

One rule: **say every number out loud as it appears.** The audience cannot read the dials from
row six.

### 0:00–0:20 · the setup

> Onboarding one new client at a European accounting practice takes a senior accountant two
> weeks of cross-checking documents by eye. Every firm does that work. Every firm then throws
> the reasoning away. The partner who decided we should decline a company like this in February
> is the only copy of that decision — and next February someone re-derives it from nothing.

Empty file on screen throughout.

### 0:20–0:35 · unknown is not low

> This is the file. It's empty. Confidence four percent. Risk — unknown. Not low. An empty file
> is not low risk, it is unknown, and treating unknown as safe is the classic KYC failure.
> That's why there are two numbers here and not one.

Point at the grey UNKNOWN band. *1 of 23 fields resolved — 22 blocking submission.*

### 0:35–1:05 · the documents (this is the crowd beat — do not rush it)

Drop the registration.

> Registration. Six fields go green, confidence thirty percent.

Drop the passport.

> Passport. Expired — second of August 2024, seven hundred and forty-one days ago. And it's a
> SPECIMEN page, which has no evidential value at all.

Drop the utility bill. **Pause here.**

> Utility bill. The address doesn't match the registered seat. Wetstraat 12 — Rue de la Loi
> 120. Now, those are the same street; Brussels is bilingual and half the false alarms in this
> industry come from exactly that. But 12 and 120 are half a kilometre apart. Both values, both
> filenames, on screen. That is the check a junior does by eye across twelve PDFs at four in
> the afternoon.

### 1:05–1:25 · the agent acts

> While I was doing that, it opened a case and drafted this.

Read one line of the draft aloud.

> "We cannot proceed on the passport you supplied: expired 2024-08-02." Not "some documents are
> missing" — the specific document, the exact date. It drafts. It doesn't send. There is no
> network call in that file.

### 1:25–1:45 · the graph

Drop the ownership chart.

> Ownership chart. Forty percent participation in Meridiaan Freight. `$graphLookup`, depth
> three, and it walks Verhoeven to Meridiaan to Castelein Transport — a company this firm
> declined in 2025 — and finds all three sitting on the same IBAN, `BE71096123456769`. There is
> the path, on screen. Risk is now 0.494, medium.

### 1:45–2:25 · the beat

> 0.494. Medium. A human would look at this and hesitate. So let's ask a colleague.

Click HIGH with the one-line rationale. Re-score.

> One verdict. High, one line of reasoning, written into a collection called `verdicts`.
> Re-score.

Let the dial animate in silence.

> 0.722. High. And look at the breakdown — it names M. Dubois, quotes what he actually wrote,
> and timestamps it seconds ago. The precedent component went from 0.244 to 0.896. Confidence
> didn't move a millimetre, because his opinion isn't new evidence about the file.
>
> No retraining. No fine-tune. No restart. One insert into one collection, and the firm's
> answer changed.

### 2:25–2:45 · what it really is

> `verdicts` isn't a KYC table. Every row carries a `decision_type` — and the corpus already
> has a VAT one. Same auto-embedded rationale, same `$rankFusion`, same `$rerank`, different
> question. This isn't a KYC product that uses search. It's judgment memory that happens to be
> pointed at KYC today.

### 2:45–3:00 · the close

> Every regulated practice — accounting, law, audit, underwriting, clinical governance — stores
> its hardest calls in senior people's heads and loses them when those people leave. They
> already produce the decision, the reasoning, and the name. They just throw it away. Store it,
> and the next decision gets made with it. That's the whole idea: what you store changes what
> the system does next.

### Stage-specific notes

- If the cluster or the network fails: `mockup/index.html` is offline and steps through all six
  states. Say "this is the recorded run" once, then carry on. Never narrate live numbers over a
  static page.
- `npm run reset` between the rehearsal and the real run. If the analogous verdict is already in
  memory, precedent starts high and the 0.494 → 0.722 jump collapses to about 0.07 with no band
  change — that failure is silent and it kills the demo.
- Cut for time in this order: the graph beat (1:25–1:45) first, then the setup (0:00–0:20) down
  to one sentence. Never cut the utility bill or the verdict.

---

# C. Q&A prep

### "Isn't this just RAG?"

No, and the distinction is the project. RAG retrieves text and puts it into a prompt so a model
can write an answer. Nothing here is put into a prompt. Retrieval returns past verdicts, and
those verdicts change a weighted arithmetic term — precedent, 0.35 of the risk composite — which
moves a band, which changes what the firm is permitted to do next. There is no model in the
decision path at all. You can read the whole scoring function; it is four numbers and four
weights in `src/score.js`.

That is also why the output is auditable. A RAG answer is a paragraph you have to trust. This
produces a number attached to a named human, a date, a filename, and a graph path. When a
regulator asks why this client was priced high, the answer is "because M. Dubois decided this on
11 February 2026 and here is what he wrote", not "because the model said so".

The honest version of the criticism: the retrieval stage itself is ordinary — `$rankFusion` over
a vector leg and a text leg, then `$rerank`. We did not invent a retrieval technique. What is
different is what the retrieved thing is allowed to do when it comes back.

### "Did you train anything?"

No. That is the point, not an omission. The only learning in the system is an insert. A
colleague writes a verdict and the next re-score of every client uses it — no fine-tune, no
embedding job we run, no restart. MongoDB's Automated Embedding generates the vector on write,
so the write path is one `insertOne`.

What we did tune is one constant, and it is in the code with the reasoning attached: the
precedent scorer sharpens relevance weighting with an exponent of 4, chosen by sweep as the
lowest value at which a single genuinely-analogous case dominates instead of being averaged away
by four loosely-related ones. Flat weighting is wrong on the merits — an accountant asking "what
did we do last time" wants the case that actually resembles this one, not the mean of the five
nearest — but we will not pretend the constant is not tuned.

### "What happens when the corpus is small?"

It degrades, and it degrades in a way you can see rather than a way that lies to you. The demo
corpus is 17 verdicts, which is small enough that we could check the failure mode directly:
retrieval still returns five cases, but relevance scores are low across the board and the
precedent component reflects that the nearest analogue is not very near.

Three things follow. First, precedent is only 0.35 of risk; contradiction, integrity and graph
are fully deterministic and work on day one with an empty memory — a new firm gets the expired
passport and the address conflict immediately, and precedent contributes roughly nothing until
there is something to contribute. Second, every cited case is shown with its relevance, so a
weak retrieval looks weak on screen instead of quietly producing a confident number. Third, this
is a system for practices that already have a decade of decisions in email and file notes; the
cold-start problem is a backfill problem, not a modelling one.

The thing we would not claim: we have not validated this on a real firm's corpus, and the
relevance-sharpening constant would need recalibrating at a few thousand verdicts. A corpus that
size would also want `decision_type` and date filters pushed into the `$vectorSearch` stage,
which is a filter on the index, not a redesign.

### If there is time for a fourth

**"Why two scores instead of one?"** — Because an empty file scores zero risk and that is not
the same as safe. Confidence is required-field coverage and is pure arithmetic; it is the number
that decides whether you may file. Risk is content. Watch them during the verdict beat: risk
moves 0.494 to 0.722 and confidence does not move at all, because a colleague's judgment is not
evidence about this client's paperwork. One number cannot express that, and firms get fined in
the gap.
