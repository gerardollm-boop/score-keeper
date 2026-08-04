# Data Persistence Design — Score Keeper
Date: 2026-08-04

## Problem

All personal data (round history, courses, bet percentages) lives in `localStorage` only. Clearing the browser or switching devices loses everything. There is no cross-user standings view beyond the current live round.

## Goal

- Round history survives browser clears and is accessible from any device
- Global leaderboard shows aggregated stats across all ~100 users
- Pull-to-refresh is sufficient (no real-time leaderboard required)

## Decision

**Extend Firebase RTDB** — already configured, free tier covers this scale comfortably (~100 users × 50 rounds × 4KB ≈ 20MB). No new services.

Rejected: Firestore (two Firebase products, unnecessary complexity at this scale) and Supabase (second backend alongside RTDB, higher ops overhead).

---

## Firebase RTDB Schema

```
scorekeeper/
  users/{userId}               # existing: { name, pin, handicap, ghin, createdAt }
                               # extended: { ...existing, courses: [...], percentages: {...} }
  rounds/{userId}/{roundId}    # full closed round object
  leaderboard/{userId}         # compact aggregate, updated on each round save
```

### Leaderboard node shape

```json
{
  "name": "string",
  "rounds": 12,
  "avgGross": 89,
  "avgNet": 78,
  "bestNet": 65,
  "oyeWins": 4,
  "lastPlayed": "2026-08-03"
}
```

Reading the global leaderboard is one `get(ref(db, "scorekeeper/leaderboard"))` call (~10KB for 100 users).

---

## Data Flow Changes

### Round archival (closeAndSave / addClosedToHistory)
- Write full round object to `scorekeeper/rounds/{myUserId}/{round.id}`
- Atomically update `scorekeeper/leaderboard/{myUserId}` via `update()` with recalculated aggregates
- Remove the `persist({ rounds: [...] })` localStorage call — Firebase is now source of truth

### App boot (currently reads localStorage)
- Read `scorekeeper/rounds/{myUserId}` from Firebase on load
- **One-time migration:** if Firebase rounds node is empty but localStorage has rounds, push them to Firebase then remove from localStorage

### Courses + percentages
- Add `courses` and `percentages` fields to the existing user profile node
- Read on boot alongside the profile (one call)
- Write via existing `userUpdate()` atomic helper on change

### Global leaderboard tab (new)
- On mount: `get(ref(db, "scorekeeper/leaderboard"))` → sort client-side by `avgNet` → render table
- Pull-to-refresh button re-runs the same read
- Tap a row → drill into that user's round list (`scorekeeper/rounds/{userId}`)

### Live round sync
No changes — `sk-meta-{code}`, `sk-scores-{code}-{playerId}`, etc. remain untouched.

---

## Storage Layer Changes (storage.js)

New exports needed:
- `roundSave(userId, round)` — set `scorekeeper/rounds/{userId}/{round.id}`
- `roundsGet(userId)` — get all rounds for a user, returns array
- `leaderboardUpdate(userId, fields)` — atomic update of leaderboard node
- `leaderboardGet()` — get full leaderboard object

`userUpdate()` already handles courses/percentages (pass as fields).

---

## Migration Strategy

On first boot after deploy:
1. Load `scorekeeper/rounds/{myUserId}` from Firebase
2. If empty AND localStorage has rounds → call `roundSave` for each, then clear localStorage rounds
3. If Firebase already has rounds → use them, ignore localStorage

Migration is a one-shot client-side operation, no server-side script needed.

---

## Out of Scope

- Real-time leaderboard updates (pull-to-refresh is sufficient)
- Public profile pages per user
- Round deletion from Firebase (can add later)
- Pagination of round history (trivial at this scale)
