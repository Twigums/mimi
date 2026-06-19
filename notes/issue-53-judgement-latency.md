# Issue #53 — non-perfect judgements come considerably late

Investigation + rationale for the early "settled" commit. Implemented for cut notes.

## Problem

Hit feedback (hitsound, fireworks, toast) and the authoritative judgement both fire only
when `judgeGesture` returns `status: "judged"`, consumed in `engine.ts` `tryHit`. That
moment is gated by `canStillImprove` (`judgement.ts`):

```
latestSongMs < noteTime                      -> hold ALL notes until note time
tier3                                         -> commit
tier2 : latestSongMs < noteTime + TIER3_MS    -> hold to +40ms
tier1 : latestSongMs < noteTime + TIER2_MS    -> hold to +80ms
miss  : latestSongMs < noteTime + WINDOW_MS   -> hold to +240ms
```

The engine holds a note pending because a *better-timed* gesture is still reachable
(tier3 timing stays possible until `noteTime ± TIER3_MS`). Correct for score, but it costs
feedback latency.

### The latency is asymmetric (and that is exactly the complaint)

With `o = impactSongMs - noteTime` (the gesture's timing offset): late hits already get
near-immediate feedback (the candidate doesn't exist until the pointer reaches the note).
**Early** hits are the culprit — held open for a better-timed re-cut that rarely comes:

| Case | Fires at | Latency from gesture |
|------|----------|----------------------|
| tier3 on/late | impact | ~0 |
| tier3 early | `noteTime` | up to TIER3_MS |
| tier2 late | impact | ~0 |
| tier2 early | `noteTime + TIER3_MS` | up to ~TIER2_MS |
| tier1 early | `noteTime + TIER2_MS` | up to ~TIER1_MS |
| miss | `noteTime + WINDOW` | up to 240 ms |

Matches the issue: "if the player cut late we can judge late, but if the player cut early,
we should try not to delay feedback."

## Key safety property

`selectBestCandidate` evaluates every start/end sample pair in the window; samples are only
ever **added** over time, so `best` is **monotonically non-decreasing** in tier. Waiting
can only *upgrade*, never downgrade. So an early commit can at worst forfeit an upgrade — it
can never wrongly downgrade a hit.

## Fix — "gesture settled" early commit (cut notes)

Finalize as soon as `best` is a hit **and** the pointer has clearly left the note
(`dist(pointer, note) > CUT_CONTACT_TIER1`). A better-timed re-cut is then implausible, and
once the player hears/sees the hit they stop trying anyway. Window-close logic stays as the
fallback for a pointer still lingering near the note; misses still wait the full window.

### Density guard

`earliestCommit(N) = min(N.time - TIER3_MS, prevNote.time)` bounds how early the settled
commit may fire, so at high density a sweep toward an adjacent note can't claim N during the
previous note's territory; the `min` clamps to N's own perfect-window start when a
near-simultaneous previous note would otherwise over-delay it.

Scope: cut notes only (flow/lyric unchanged). `engine.ts` threads `notes[i-1].time` as
`prevNoteTime` through `tryHit -> judgeGesture`.
