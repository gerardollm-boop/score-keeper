# Firebase Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move round history, courses, and percentages from localStorage to Firebase RTDB so data syncs across devices and a global leaderboard is possible.

**Architecture:** Add four new Firebase helpers to `storage.js`. On app boot, load rounds from `scorekeeper/rounds/{userId}` instead of localStorage, migrating existing local rounds to Firebase on first run. Courses and percentages move to the Firebase user profile. A new `LeaderboardTab` component reads `scorekeeper/leaderboard` (compact aggregates per user, updated on each round close) and renders a global ranking table.

**Tech Stack:** React 18, Firebase RTDB (`firebase/database`), Vite, Tailwind CSS. No new dependencies.

## Global Constraints

- Firebase RTDB paths must stay under the existing `scorekeeper/` namespace
- All Firebase writes use `set()` or `update()` from `firebase/database` — no REST calls
- No new npm packages
- Tailwind only for styling — no inline style objects except where Tailwind can't reach
- All new functions added to `src/storage.js` follow the existing try/catch + silent-fail pattern
- Build must pass (`npm run build`) after every task

---

### Task 1: Firebase storage helpers

**Files:**
- Modify: `src/storage.js`

**Interfaces:**
- Produces:
  - `roundSave(userId: string, round: object): Promise<void>`
  - `roundsGet(userId: string): Promise<object[]>` — sorted newest-first
  - `leaderboardUpdate(userId: string, fields: object): Promise<void>`
  - `leaderboardGet(): Promise<Record<string, object>>` — keyed by userId

- [ ] **Step 1: Add the four helpers to `src/storage.js`**

Open `src/storage.js`. After the `userUpdate` function (last function in the file), add:

```js
export async function roundSave(userId, round) {
  if (!db) return;
  try { await set(ref(db, `scorekeeper/rounds/${userId}/${round.id}`), round); }
  catch (e) {}
}

export async function roundsGet(userId) {
  if (!db) return [];
  try {
    const snap = await get(ref(db, `scorekeeper/rounds/${userId}`));
    if (!snap.exists()) return [];
    return Object.values(snap.val()).sort((a, b) =>
      (b.date || "").localeCompare(a.date || "")
    );
  } catch (e) { return []; }
}

export async function leaderboardUpdate(userId, fields) {
  if (!db) return;
  try { await update(ref(db, `scorekeeper/leaderboard/${userId}`), fields); }
  catch (e) {}
}

export async function leaderboardGet() {
  if (!db) return {};
  try {
    const snap = await get(ref(db, "scorekeeper/leaderboard"));
    return snap.exists() ? snap.val() : {};
  } catch (e) { return {}; }
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```
Expected: `✓ built in ...` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/storage.js
git commit -m "feat: add roundSave, roundsGet, leaderboardUpdate, leaderboardGet to storage"
```

---

### Task 2: Boot — load rounds from Firebase + one-time localStorage migration

**Files:**
- Modify: `src/ScoreKeeper.jsx`

**Interfaces:**
- Consumes: `roundsGet(userId)` from Task 1; existing `userGet`, `loadData`
- Produces: `rounds` state populated from Firebase on boot; localStorage rounds pushed to Firebase if Firebase is empty

**Context:**
The app currently has two boot `useEffect` hooks:
1. **Auth effect** (around line 255): runs once on mount, reads `localStorage("sk_myUserId")`, calls `userGet` to set `myProfile`.
2. **Data effect** (around line 284): runs once on mount, calls `loadData()` to populate `rounds`, `courses`, `percentages`, `groupCode` from localStorage.

Add a **third effect** that fires when `myUserId` is set and loads Firebase rounds. It must not run if Firebase is disabled (`!firebaseEnabled`).

- [ ] **Step 1: Import the new helpers in `ScoreKeeper.jsx`**

Find the existing import at the top of `src/ScoreKeeper.jsx`:
```js
import { storageGet, storageSet, sharedGet, sharedSet, firebaseEnabled, userCreate, userExists, usersGetAll, userGet, userUpdate } from "./storage";
```

Replace with:
```js
import { storageGet, storageSet, sharedGet, sharedSet, firebaseEnabled, userCreate, userExists, usersGetAll, userGet, userUpdate, roundSave, roundsGet, leaderboardUpdate, leaderboardGet } from "./storage";
```

- [ ] **Step 2: Add the Firebase rounds boot effect**

Find the existing data `useEffect` (the one that calls `loadData().then(...)`). Insert this new effect **after** it:

```js
useEffect(() => {
  if (!myUserId || !firebaseEnabled) return;
  roundsGet(myUserId).then((fbRounds) => {
    if (fbRounds.length > 0) {
      setRounds(fbRounds);
    } else {
      // One-time migration: push existing localStorage rounds to Firebase
      loadData().then((d) => {
        if (d.rounds?.length > 0) {
          d.rounds.forEach((r) => roundSave(myUserId, r));
        }
      });
    }
  });
}, [myUserId]);
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

1. Log in. Open the browser console (F12).
2. Run `localStorage.getItem("sk_scorekeeper-data")` — note how many rounds are there.
3. Check Firebase RTDB console → `scorekeeper/rounds/{yourUserId}` — if you had local rounds, they should now appear here.
4. Reload the app — rounds should still be visible (loaded from Firebase).

- [ ] **Step 5: Commit**

```bash
git add src/ScoreKeeper.jsx
git commit -m "feat: load rounds from Firebase on boot, migrate localStorage rounds on first run"
```

---

### Task 3: Courses and percentages — sync to Firebase user profile

**Files:**
- Modify: `src/ScoreKeeper.jsx`

**Interfaces:**
- Consumes: `userUpdate(userId, fields)` (existing); `myProfile` state (already set in auth effect)
- Produces: courses + percentages read from `myProfile` if present; written to Firebase on change

**Context:**
`myProfile` is set by `userGet(stored)` in the auth effect. The profile already stores `name`, `pin`, `handicap`, `ghin`. We extend it with `courses` and `percentages` fields — `userUpdate` already handles partial writes atomically.

The existing `persist` function (around line 329) calls `saveData(data)` which writes everything to localStorage. We keep `saveData` for `groupCode` (device-specific) but redirect courses/percentages to Firebase.

- [ ] **Step 1: Read courses and percentages from profile on boot**

Find the `useEffect` that watches `myProfile` for `myHcpForRound`/`joinHcp` (added in a previous fix). It looks like:

```js
useEffect(() => {
  if (myProfile?.handicap != null) {
    setMyHcpForRound(myProfile.handicap);
    setJoinHcp(myProfile.handicap);
  }
}, [myProfile]);
```

Extend it to also sync courses and percentages:

```js
useEffect(() => {
  if (!myProfile) return;
  if (myProfile.handicap != null) {
    setMyHcpForRound(myProfile.handicap);
    setJoinHcp(myProfile.handicap);
  }
  if (myProfile.courses?.length) setCourses(myProfile.courses);
  if (myProfile.percentages) setPercentages(myProfile.percentages);
}, [myProfile]);
```

- [ ] **Step 2: Write courses to Firebase when they change**

Find the `persist` function (around line 329). Find this line inside it:
```js
if (next.courses) setCourses(next.courses);
```

Add a Firebase write after it:
```js
if (next.courses) {
  setCourses(next.courses);
  if (myUserId) userUpdate(myUserId, { courses: next.courses });
}
```

- [ ] **Step 3: Write percentages to Firebase when they change**

In the same `persist` function, find:
```js
if (next.percentages) setPercentages(next.percentages);
```

Add a Firebase write after it:
```js
if (next.percentages) {
  setPercentages(next.percentages);
  if (myUserId) userUpdate(myUserId, { percentages: next.percentages });
}
```

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

1. Log in. Go to the Campos tab. Add or edit a course and save.
2. Open Firebase RTDB console → `scorekeeper/users/{yourUserId}` — you should see a `courses` array.
3. Open the app in a different browser/incognito, log in with the same PIN.
4. Go to Campos — the courses should appear (loaded from Firebase profile).

- [ ] **Step 6: Commit**

```bash
git add src/ScoreKeeper.jsx
git commit -m "feat: sync courses and percentages to Firebase user profile for cross-device access"
```

---

### Task 4: Save closed rounds to Firebase + update leaderboard aggregate

**Files:**
- Modify: `src/ScoreKeeper.jsx`

**Interfaces:**
- Consumes: `roundSave`, `leaderboardUpdate` from Task 1; `roundsGet` from Task 1
- Produces: each closed round written to `scorekeeper/rounds/{userId}/{roundId}`; `scorekeeper/leaderboard/{userId}` updated after close

**Context:**
`closeAndSave` (around line 902) builds a `round` object and calls `onSaveRound(round)`, which calls `persist({ rounds: [round, ...rounds] })`. `persist` calls `saveData` (localStorage). We keep `persist`'s localStorage write as a cache but also write to Firebase.

The `round` object has: `id`, `date`, `courseName`, `participants` (array of `{ playerId, grossTotal, netMedal, stablefordPoints, ... }`), `winners` (`{ medalOverall: [...], stablefordOverall: [...], oyeFront: [...], oyeBack: [...], ... }`).

The leaderboard aggregate is computed by a new pure function `computeLeaderboardEntry`. It re-reads all rounds for the user after saving, so it's always accurate (not incremental).

- [ ] **Step 1: Add the pure `computeLeaderboardEntry` function**

In `src/ScoreKeeper.jsx`, find the `// ---------- Storage ----------` comment block (around line 181). Add this new pure function just before it:

```js
function computeLeaderboardEntry(userId, userName, rounds) {
  const mine = rounds.filter((r) => r.participants?.some((p) => p.playerId === userId));
  if (!mine.length) return { name: userName, rounds: 0, avgGross: 0, avgNet: 0, bestNet: null, medalWins: 0, stablefordWins: 0, oyeWins: 0, lastPlayed: null };
  let totalGross = 0, totalNet = 0, bestNet = Infinity, medalWins = 0, stablefordWins = 0, oyeWins = 0;
  for (const r of mine) {
    const p = r.participants.find((p) => p.playerId === userId);
    if (!p) continue;
    totalGross += p.grossTotal || 0;
    totalNet += p.netMedal || 0;
    if ((p.netMedal || 0) < bestNet) bestNet = p.netMedal;
    if (r.winners?.medalOverall?.includes(userId)) medalWins++;
    if (r.winners?.stablefordOverall?.includes(userId)) stablefordWins++;
    if (r.winners?.oyeFront?.includes(userId) || r.winners?.oyeBack?.includes(userId)) oyeWins++;
  }
  return {
    name: userName,
    rounds: mine.length,
    avgGross: Math.round(totalGross / mine.length),
    avgNet: Math.round(totalNet / mine.length),
    bestNet: bestNet === Infinity ? null : bestNet,
    medalWins,
    stablefordWins,
    oyeWins,
    lastPlayed: mine[0]?.date?.slice(0, 10) || null,
  };
}
```

- [ ] **Step 2: Write round to Firebase inside `persist` when a new round is added**

In the `persist` function (around line 329), find:
```js
if (next.rounds && next.rounds.length > rounds.length) {
  pushRoundToGroup(next.rounds[0], next.groupCode ?? groupCode);
}
```

Add the Firebase write directly after `pushRoundToGroup`:
```js
if (next.rounds && next.rounds.length > rounds.length) {
  pushRoundToGroup(next.rounds[0], next.groupCode ?? groupCode);
  if (myUserId && firebaseEnabled) {
    const newRound = next.rounds[0];
    roundSave(myUserId, newRound).then(() =>
      roundsGet(myUserId).then((all) => {
        const entry = computeLeaderboardEntry(myUserId, myProfile?.name || "", all);
        leaderboardUpdate(myUserId, entry);
      })
    );
  }
}
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

1. Start a round with at least one other player, fill in scores, and close it.
2. Open Firebase RTDB console:
   - `scorekeeper/rounds/{yourUserId}` — should contain the closed round object.
   - `scorekeeper/leaderboard/{yourUserId}` — should show `{ name, rounds: 1, avgGross, avgNet, bestNet, ... }`.
3. Close a second round and confirm `rounds` increments to 2 and averages update.

- [ ] **Step 5: Commit**

```bash
git add src/ScoreKeeper.jsx
git commit -m "feat: persist closed rounds and update leaderboard aggregate in Firebase"
```

---

### Task 5: Global Leaderboard tab

**Files:**
- Modify: `src/ScoreKeeper.jsx`

**Interfaces:**
- Consumes: `leaderboardGet()` from Task 1
- Produces: `LeaderboardTab` component; "ranking" tab in the nav

**Context:**
All tab components are functions defined inside `src/ScoreKeeper.jsx`. The nav tab list is an array around line 412:
```js
const tabs = [
  ["rondas", "Rondas"],
  ["historial", "Historial"],
  ...
];
```

The tab body uses `{tab === "rondas" && <RoundTab ... />}` pattern.

The leaderboard is sorted client-side by `avgNet` (ascending — lower is better in golf). A pull-to-refresh button re-runs `leaderboardGet`. A loading spinner uses the existing pattern of a `refreshing`/`loading` state.

- [ ] **Step 1: Add the `LeaderboardTab` component**

Find the closing `}` of the last tab component before the `export default` (or `function App`). Add the new component there:

```jsx
function LeaderboardTab() {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const load = () => {
    setLoading(true);
    leaderboardGet().then((raw) => {
      const rows = Object.entries(raw).map(([id, v]) => ({ id, ...v }))
        .filter((r) => r.rounds > 0)
        .sort((a, b) => (a.avgNet || 0) - (b.avgNet || 0));
      setData(rows);
      setLoading(false);
    });
  };

  React.useEffect(() => { load(); }, []);

  return (
    <div className="p-3 font-body">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-emerald-900 text-lg">Ranking Global</h2>
        <button
          onClick={load}
          disabled={loading}
          style={{ touchAction: "manipulation" }}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-800 text-amber-50 disabled:opacity-50"
        >
          {loading ? "Cargando…" : "Actualizar"}
        </button>
      </div>
      {loading && <p className="text-stone-400 text-sm text-center py-8">Cargando ranking…</p>}
      {!loading && (!data || data.length === 0) && (
        <p className="text-stone-400 text-sm text-center py-8">Aún no hay rondas registradas.</p>
      )}
      {!loading && data && data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs text-stone-500 border-b border-stone-200">
                <th className="text-left py-1 pr-2">#</th>
                <th className="text-left py-1 pr-3">Jugador</th>
                <th className="text-center py-1 pr-2">Rondas</th>
                <th className="text-center py-1 pr-2">Gross</th>
                <th className="text-center py-1 pr-2">Net</th>
                <th className="text-center py-1 pr-2">Mejor</th>
                <th className="text-center py-1 pr-2">🏅</th>
                <th className="text-center py-1">Última</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={row.id} className={`border-b border-stone-100 ${i === 0 ? "bg-amber-50" : ""}`}>
                  <td className="py-2 pr-2 text-stone-400">{i + 1}</td>
                  <td className="py-2 pr-3 font-semibold text-emerald-900 truncate max-w-[100px]">{row.name || "—"}</td>
                  <td className="py-2 pr-2 text-center text-stone-600">{row.rounds}</td>
                  <td className="py-2 pr-2 text-center text-stone-600">{row.avgGross ?? "—"}</td>
                  <td className="py-2 pr-2 text-center font-semibold text-emerald-800">{row.avgNet ?? "—"}</td>
                  <td className="py-2 pr-2 text-center text-stone-600">{row.bestNet ?? "—"}</td>
                  <td className="py-2 pr-2 text-center text-stone-600">{(row.medalWins || 0) + (row.stablefordWins || 0) + (row.oyeWins || 0)}</td>
                  <td className="py-2 text-center text-stone-400 text-xs">{row.lastPlayed || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the "ranking" tab to the nav**

Find the tabs array (around line 412):
```js
["mystats", "Mis Stats"],
```

Add after it:
```js
["ranking", "Ranking"],
```

- [ ] **Step 3: Add the tab body**

Find the block of tab renders (the `{tab === "acumulado" && ...}` section). Add after the last tab:
```jsx
{tab === "ranking" && <LeaderboardTab />}
```

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

1. Click the "Ranking" tab — should show a table (or empty state if no rounds yet).
2. Close a round (Task 4 must be done first). Return to Ranking and hit "Actualizar" — your entry should appear.
3. Log in from a different browser/device — Ranking should show the same data.

- [ ] **Step 6: Commit**

```bash
git add src/ScoreKeeper.jsx
git commit -m "feat: global leaderboard tab reading from Firebase RTDB"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task that covers it |
|---|---|
| Round history survives browser clears | Task 2 (boot from Firebase) + Task 4 (write on close) |
| Cross-device sync | Task 2 + Task 3 (profile sync) |
| Global leaderboard (pull-to-refresh) | Task 5 |
| One-time localStorage migration | Task 2 |
| Courses + percentages cross-device | Task 3 |
| `roundSave`, `roundsGet`, `leaderboardUpdate`, `leaderboardGet` helpers | Task 1 |
| `scorekeeper/rounds/{userId}/{roundId}` schema | Task 1 + Task 4 |
| `scorekeeper/leaderboard/{userId}` schema | Task 1 + Task 4 |

**Placeholder scan:** None found. All steps include exact code.

**Type consistency:**
- `roundSave(userId, round)` defined Task 1, consumed Task 4 ✓
- `roundsGet(userId)` defined Task 1, consumed Task 2 and Task 4 ✓
- `leaderboardUpdate(userId, fields)` defined Task 1, consumed Task 4 ✓
- `leaderboardGet()` defined Task 1, consumed Task 5 ✓
- `computeLeaderboardEntry(userId, userName, rounds)` defined Task 4, used in Task 4 ✓
- `leaderboardGet` imported in Task 2 import line, used in Task 5 ✓
