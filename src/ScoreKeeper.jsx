import React, { useState, useEffect, useMemo, useRef } from "react";
import { storageGet, storageSet, sharedGet, sharedSet, firebaseEnabled, userCreate, userExists, usersGetAll, userGet, userUpdate, roundSave, roundsGet, leaderboardUpdate, leaderboardGet } from "./storage";

// ---------- Constants ----------
const uid = () => Math.random().toString(36).slice(2, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);

const DEFAULT_PARS = [4, 4, 3, 5, 4, 3, 4, 5, 4, 4, 5, 3, 4, 4, 3, 5, 4, 4];
const DEFAULT_SI_FROM1 = [5, 11, 17, 1, 9, 15, 7, 3, 13, 6, 2, 16, 8, 12, 18, 4, 10, 14];
const DEFAULT_SI_FROM10 = [...DEFAULT_SI_FROM1.slice(9), ...DEFAULT_SI_FROM1.slice(0, 9)];

const EL_CAMPANARIO_COURSE = {
  id: "el-campanario-oficial",
  name: "El Campanario Residencial & Golf",
  pars:     [5, 4, 3, 4, 3, 4, 5, 4, 4,  4, 4, 3, 4, 4, 3, 5, 4, 5],
  siFrom1:  [5, 3, 9,11,13,15, 7,17, 1,  2, 8,18,16, 6,10, 4,12,14],
  siFrom10: [2, 8,18,16, 6,10, 4,12,14,  5, 3, 9,11,13,15, 7,17, 1],
};

const DEFAULT_PCT = {
  stablefordFront: 10,
  stablefordBack: 10,
  stablefordOverall: 20,
  medalFront: 10,
  medalBack: 10,
  medalOverall: 20,
  oyeFront: 10,
  oyeBack: 10,
};
const PCT_LABELS = {
  stablefordFront: "Stableford 1ª vuelta",
  stablefordBack: "Stableford 2ª vuelta",
  stablefordOverall: "Stableford general",
  medalFront: "Medal neto 1ª vuelta",
  medalBack: "Medal neto 2ª vuelta",
  medalOverall: "Medal neto general",
  oyeFront: "Oyes (tiro más cercano) 1ª vuelta",
  oyeBack: "Oyes (tiro más cercano) 2ª vuelta",
};

function emptyCourse() {
  return { id: uid(), name: "", pars: [...DEFAULT_PARS], siFrom1: [...DEFAULT_SI_FROM1], siFrom10: [...DEFAULT_SI_FROM10] };
}

function strokesOnHole(handicap, strokeIndex) {
  const h = Math.max(0, Math.round(handicap || 0));
  return Math.floor(h / 18) + (strokeIndex <= (h % 18) ? 1 : 0);
}

function stablefordPointsForHole(gross, par, strokes) {
  if (!gross || gross <= 0) return 0;
  const net = gross - strokes;
  const diff = net - par;
  if (diff <= -3) return 5;
  if (diff === -2) return 4;
  if (diff === -1) return 3;
  if (diff === 0) return 2;
  if (diff === 1) return 1;
  return 0;
}

// holes played in order, based on tee-off (salida)
function vueltaHoles(salida) {
  if (salida === 10) {
    return { v1: [10, 11, 12, 13, 14, 15, 16, 17, 18], v2: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
  }
  return { v1: [1, 2, 3, 4, 5, 6, 7, 8, 9], v2: [10, 11, 12, 13, 14, 15, 16, 17, 18] };
}

function computeParticipant(p, pars, siArr, v1, v2) {
  const scores = p.scores.map((s) => Number(s) || 0);
  let grossTotal = 0,
    grossVuelta1 = 0,
    grossVuelta2 = 0,
    netVuelta1 = 0,
    netVuelta2 = 0,
    ptsVuelta1 = 0,
    ptsVuelta2 = 0;
  for (let h = 0; h < 18; h++) {
    const holeNum = h + 1;
    const st = strokesOnHole(p.handicap, siArr[h]);
    const gross = scores[h];
    const netHole = gross ? gross - st : 0;
    const pts = stablefordPointsForHole(gross, pars[h], st);
    grossTotal += gross;
    if (v1.includes(holeNum)) {
      grossVuelta1 += gross;
      netVuelta1 += netHole;
      ptsVuelta1 += pts;
    } else {
      grossVuelta2 += gross;
      netVuelta2 += netHole;
      ptsVuelta2 += pts;
    }
  }
  return {
    ...p,
    scores,
    grossTotal,
    netMedal: grossTotal - (Number(p.handicap) || 0),
    grossVuelta1,
    grossVuelta2,
    netVuelta1,
    netVuelta2,
    stablefordPoints: ptsVuelta1 + ptsVuelta2,
    ptsVuelta1,
    ptsVuelta2,
  };
}

function settleCategory(participants, bet, pct, key, betterIsLower) {
  const n = participants.length;
  const pot = (bet * n * pct) / 100;
  if (n < 2 || pct <= 0) return { winners: [], net: Object.fromEntries(participants.map((p) => [p.playerId, 0])), pot };
  const values = participants.map((p) => p[key]);
  const best = betterIsLower ? Math.min(...values) : Math.max(...values);
  const winners = participants.filter((p) => p[key] === best).map((p) => p.playerId);
  const share = pot / winners.length;
  const net = {};
  participants.forEach((p) => {
    const contribution = (bet * pct) / 100;
    net[p.playerId] = +((winners.includes(p.playerId) ? share - contribution : -contribution).toFixed(2));
  });
  return { winners, net, pot };
}

function settleOyes(participants, bet, pctFront, pctBack, entries, v1, v2) {
  const n = participants.length;
  const contribFront = (bet * pctFront) / 100; // each player's ante for front oye
  const contribBack  = (bet * pctBack)  / 100; // each player's ante for back oye
  let potFront = contribFront * n;
  let potBack  = contribBack  * n;

  const frontEntries = entries.filter((e) => v1.includes(Number(e.hole)));
  const backEntries  = entries.filter((e) => v2.includes(Number(e.hole)));

  let frontWinners = [];
  let backWinners  = [];

  if (frontEntries.length > 0) {
    const minD = Math.min(...frontEntries.map((e) => Number(e.distance)));
    frontWinners = [...new Set(frontEntries.filter((e) => Number(e.distance) === minD).map((e) => e.playerId))];
  }
  if (backEntries.length > 0) {
    const minD = Math.min(...backEntries.map((e) => Number(e.distance)));
    backWinners = [...new Set(backEntries.filter((e) => Number(e.distance) === minD).map((e) => e.playerId))];
  }

  // Roll-over rules:
  // No front winner → front pot goes to back winner
  if (frontWinners.length === 0 && backWinners.length > 0) {
    potBack  += potFront;
    potFront  = 0;
  }
  // No back winner → back pot goes to front winner
  if (backWinners.length === 0 && frontWinners.length > 0) {
    potFront += potBack;
    potBack   = 0;
  }

  const hasAnyWinner = frontWinners.length > 0 || backWinners.length > 0;

  // Per-player nets (front and back separately, then combined)
  const netFront = {};
  const netBack  = {};
  const net      = {};
  participants.forEach((p) => {
    if (!hasAnyWinner) {
      // No oye entries at all → nobody charged, nobody awarded
      netFront[p.playerId] = 0;
      netBack[p.playerId]  = 0;
      net[p.playerId]      = 0;
      return;
    }
    let f = -contribFront;
    let b = -contribBack;
    if (potFront > 0 && frontWinners.includes(p.playerId)) f += potFront / frontWinners.length;
    if (potBack  > 0 && backWinners.includes(p.playerId))  b += potBack  / backWinners.length;
    // When a pot was rolled over the contribution stays but the award moves
    if (potFront === 0 && frontWinners.length === 0) f = -contribFront; // paid but not awarded here
    if (potBack  === 0 && backWinners.length  === 0) b = -contribBack;
    netFront[p.playerId] = +f.toFixed(2);
    netBack[p.playerId]  = +b.toFixed(2);
    net[p.playerId]      = +(f + b).toFixed(2);
  });
  return { frontWinners, backWinners, netFront, netBack, net };
}

function computeLeaderboardEntry(userId, userName, rounds) {
  const mine = rounds.filter((r) => r.participants?.some((p) => p.playerId === userId));
  if (!mine.length) return { name: userName, rounds: 0, avgGross: 0, avgNet: 0, bestNet: null, medalWins: 0, stablefordWins: 0, oyeWins: 0, lastPlayed: null };
  let totalGross = 0, totalNet = 0, bestNet = Infinity, medalWins = 0, stablefordWins = 0, oyeWins = 0;
  for (const r of mine) {
    const p = r.participants.find((p) => p.playerId === userId);
    if (!p) continue;
    totalGross += p.grossTotal || 0;
    totalNet += p.netMedal || 0;
    if ((p.netMedal || 0) < bestNet) bestNet = p.netMedal || 0;
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

// ---------- Storage ----------
async function loadData() {
  try {
    const r = await storageGet("scorekeeper-data");
    if (r && r.value) return JSON.parse(r.value);
  } catch (e) {}
  return { rounds: [], courses: [], percentages: DEFAULT_PCT };
}
async function saveData(data) {
  try {
    await storageSet("scorekeeper-data", JSON.stringify(data));
  } catch (e) {
    console.error("Storage error", e);
  }
}

// ---------- Shared round storage (for 2-group collaborative rounds) ----------
async function sGet(key) {
  try {
    const r = await sharedGet(key);
    return r && r.value ? JSON.parse(r.value) : null;
  } catch (e) {
    return null;
  }
}
async function sSet(key, value) {
  try {
    await sharedSet(key, JSON.stringify(value));
  } catch (e) {
    console.error("Shared storage error", e);
  }
}
const sharedMetaKey = (code) => `sk-meta-${code}`;
const sharedScoresKey = (code, playerId) => `sk-scores-${code}-${playerId}`;
const sharedOyesKey = (code) => `sk-oyes-${code}`;
const sharedClosedKey = (code) => `sk-closed-${code}`;
const sharedParticipantsKey = (code) => `sk-participants-${code}`;
function makeRoundCode() {
  return uid().slice(0, 5).toUpperCase();
}

// ---------- UI atoms ----------
const Money = ({ value }) => {
  const v = Number(value) || 0;
  const cls = v > 0 ? "text-emerald-700" : v < 0 ? "text-rose-700" : "text-stone-500";
  const sign = v > 0 ? "+" : "";
  return (
    <span className={`font-mono font-semibold ${cls}`}>
      {sign}
      {v.toLocaleString("es-MX", { style: "currency", currency: "MXN" })}
    </span>
  );
};
const Badge = ({ children, tone = "gold" }) => {
  const tones = { green: "bg-emerald-800 text-amber-50", gold: "bg-amber-600 text-emerald-950", stone: "bg-stone-200 text-stone-700" };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold tracking-wide ${tones[tone]}`}>{children}</span>;
};

// ---------- App ----------
export default function ScoreKeeper() {
  const [tab, setTab] = useState("ronda");
  const [hasActiveRound, setHasActiveRound] = useState(false);
  const [rounds, setRounds] = useState([]);
  const [courses, setCourses] = useState([]);
  const [percentages, setPercentages] = useState(DEFAULT_PCT);
  const [groupCode, setGroupCode] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [myProfile, setMyProfile] = useState(null);
  const [showProfile, setShowProfile] = useState(false);

  // Phase 2 identity: Firebase profile + PIN. Falls back to local uid if Firebase unavailable.
  const [myUserId, setMyUserId] = useState("");
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!firebaseEnabled) {
      // No Firebase — use local stable id (Phase 1 fallback)
      let id = localStorage.getItem("sk_myUserId");
      if (!id) { id = uid(); localStorage.setItem("sk_myUserId", id); }
      setMyUserId(id);
      setAuthChecked(true);
      return;
    }
    const stored = localStorage.getItem("sk_myUserId");
    if (!stored) { setAuthChecked(true); return; } // no id → show LoginScreen
    userExists(stored).then((exists) => {
      if (exists === true || exists === null) {
        setMyUserId(stored);
        userGet(stored).then((p) => { if (p) setMyProfile(p); });
      } else {
        localStorage.removeItem("sk_myUserId");
      }
      setAuthChecked(true);
    });
  }, []);

  const handleLogin = (newUserId) => {
    localStorage.setItem("sk_myUserId", newUserId);
    setMyUserId(newUserId);
    userGet(newUserId).then((p) => { if (p) setMyProfile(p); });
  };

  useEffect(() => {
    loadData().then((d) => {
      setRounds(d.rounds || []);
      setCourses(d.courses || []);
      setPercentages(d.percentages || DEFAULT_PCT);
      setGroupCode(d.groupCode || "");
      setLoaded(true);
      // Auto-sync on load if group code is set
      if (d.groupCode) syncFromGroup(d.groupCode, d.rounds || [], (synced) => {
        setRounds(synced);
        saveData({ ...d, rounds: synced });
      });
    });
  }, []);

  useEffect(() => {
    if (!myUserId || !firebaseEnabled) return;
    roundsGet(myUserId).then((fbRounds) => {
      loadData().then((d) => {
        const localRounds = d.rounds || [];
        const fbIds = new Set(fbRounds.map((r) => r.id));
        const missing = localRounds.filter((r) => !fbIds.has(r.id));
        missing.forEach((r) => roundSave(myUserId, r));
        const merged = [...fbRounds, ...missing].sort((a, b) =>
          (b.date || "").localeCompare(a.date || "")
        );
        if (merged.length > 0) setRounds(merged);
      });
    });
  }, [myUserId]);

  useEffect(() => {
    if (!myProfile) return;
    const profileCourses = myProfile.courses || [];
    const hasCampanario = profileCourses.some((c) => c.id === EL_CAMPANARIO_COURSE.id);
    const mergedCourses = hasCampanario ? profileCourses : [EL_CAMPANARIO_COURSE, ...profileCourses];
    setCourses(mergedCourses);
    if (!hasCampanario && myUserId && firebaseEnabled) userUpdate(myUserId, { courses: mergedCourses });
    if (myProfile.percentages) setPercentages(myProfile.percentages);
  }, [myProfile]);

  // Push a round to the shared group store
  const pushRoundToGroup = async (round, code) => {
    if (!code) return;
    const listKey = `grp-${code}-list`;
    const existing = await sGet(listKey) || [];
    if (!existing.includes(round.id)) {
      await sSet(listKey, [...existing, round.id]);
    }
    await sSet(`grp-${code}-rnd-${round.id}`, round);
  };

  // Pull rounds from shared group store, merge into local
  const syncFromGroup = async (code, localRounds, onDone) => {
    if (!code) return;
    setSyncing(true);
    try {
      const ids = await sGet(`grp-${code}-list`) || [];
      const localIds = new Set(localRounds.map((r) => r.id));
      const fetched = await Promise.all(
        ids.filter((id) => !localIds.has(id)).map((id) => sGet(`grp-${code}-rnd-${id}`))
      );
      const newRounds = fetched.filter(Boolean);
      if (newRounds.length > 0) {
        const merged = [...newRounds, ...localRounds].sort((a, b) => b.date?.localeCompare(a.date || "") || 0);
        onDone(merged);
      }
    } catch (e) {}
    setSyncing(false);
  };

  const persist = (next) => {
    const data = {
      rounds: next.rounds ?? rounds,
      courses: next.courses ?? courses,
      percentages: next.percentages ?? percentages,
      groupCode: next.groupCode ?? groupCode,
    };
    if (next.rounds !== undefined) setRounds(next.rounds);
    if (next.courses) {
      setCourses(next.courses);
      if (myUserId) userUpdate(myUserId, { courses: next.courses });
    }
    if (next.percentages) {
      setPercentages(next.percentages);
      if (myUserId) userUpdate(myUserId, { percentages: next.percentages });
    }
    if (next.groupCode !== undefined) setGroupCode(next.groupCode);
    saveData(data);
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
  };

  const logout = () => {
    localStorage.removeItem("sk_myUserId");
    setMyUserId("");
    setMyProfile(null);
    setShowProfile(false);
  };

  const updateMyProfile = async (fields) => {
    const updated = { ...myProfile, ...fields };
    setMyProfile(updated);
    await userUpdate(myUserId, fields);
  };

  if (!loaded || !authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F3EFE3]">
        <div className="font-mono text-emerald-900">Cargando Score Keeper…</div>
      </div>
    );
  }

  if (firebaseEnabled && !myUserId) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-[#F3EFE3] text-[#20261F]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;600&display=swap');
        .font-display { font-family: 'Oswald', sans-serif; letter-spacing: 0.02em; }
        .font-body { font-family: 'Inter', sans-serif; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        input, select, textarea { color: #111 !important; caret-color: #111 !important; }
      `}</style>

      <header className="bg-emerald-950 text-amber-50 px-5 py-4 sticky top-0 z-10 shadow-md">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-semibold uppercase">Score Keeper</h1>
            <p className="font-body text-xs text-emerald-200/80">Medal Net · Stableford · Oyes · Apuestas de grupo</p>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowProfile((v) => !v)}
              className="w-11 h-11 rounded-full bg-amber-500 text-emerald-950 flex items-center justify-center font-display font-bold text-sm border-2 border-amber-300 hover:bg-amber-400"
            >
              {myProfile?.name?.[0]?.toUpperCase() || "?"}
            </button>
            {showProfile && (
              <div className="absolute right-0 mt-2 bg-white rounded-xl shadow-xl border border-stone-200 p-4 z-20 w-64 space-y-3">
                <p className="font-display text-emerald-900 text-lg">{myProfile?.name}</p>
                <label className="text-sm font-body text-stone-600 block">
                  Hándicap
                  <input type="number" value={myProfile?.handicap ?? ""} onChange={(e) => updateMyProfile({ handicap: Number(e.target.value) || 0 })} className="w-full mt-1 px-3 py-2 rounded-lg border border-stone-300 font-mono" />
                </label>
                <label className="text-sm font-body text-stone-600 block">
                  GHIN
                  <input value={myProfile?.ghin ?? ""} onChange={(e) => updateMyProfile({ ghin: e.target.value })} className="w-full mt-1 px-3 py-2 rounded-lg border border-stone-300 font-mono" />
                </label>
                <button onClick={logout} className="w-full px-3 py-2 rounded-lg bg-rose-50 text-rose-700 font-body text-sm font-semibold hover:bg-rose-100">Cerrar sesión</button>
              </div>
            )}
          </div>
        </div>
        <nav className="flex gap-1 mt-4 font-body text-sm flex-wrap">
          {[
            ["ronda", "⛳ Ronda"],
            ["campos", "Campos"],
            ["historial", "📋 Historial"],
            ["acumulado", "Acumulado"],
            ["mystats", "Mis Stats"],
            ["ranking", "Ranking"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-md transition-colors ${tab === key ? "bg-amber-500 text-emerald-950 font-semibold" : "bg-emerald-900/60 text-emerald-100 hover:bg-emerald-800"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        {hasActiveRound && tab !== "ronda" && (
          <button
            onClick={() => setTab("ronda")}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-400 text-emerald-950 font-body font-semibold text-sm hover:bg-amber-300"
          >
            ⛳ Ronda en curso — toca aquí para regresar
          </button>
        )}
        <div className="mt-2 flex items-center gap-2">
          <span className="text-emerald-200 text-xs font-body">Código de grupo:</span>
          <input
            value={groupCode}
            onChange={(e) => persist({ groupCode: e.target.value.toUpperCase() })}
            placeholder="Ej. QUERETARO"
            className="flex-1 px-2 py-1 rounded-md text-xs font-mono bg-emerald-900/60 border border-emerald-700 text-emerald-100 placeholder-emerald-600 uppercase"
          />
          <button
            onClick={() => syncFromGroup(groupCode, rounds, (synced) => persist({ rounds: synced }))}
            disabled={!groupCode || syncing}
            className="px-2 py-1 rounded-md bg-emerald-700 text-emerald-100 text-xs font-body disabled:opacity-40"
          >
            {syncing ? "…" : "Sincronizar"}
          </button>
        </div>
      </header>

      <main className="p-4 max-w-3xl mx-auto pb-16">
        {tab === "campos" && <CoursesTab courses={courses} onChange={(c) => persist({ courses: c })} />}
        {/* RoundTab stays mounted — round state is never lost when switching tabs */}
        <div style={{ display: tab === "ronda" ? "block" : "none" }}>
          <RoundTab
            myUserId={myUserId}
            myProfile={myProfile}
            courses={courses}
            percentages={percentages}
            onSavePercentages={(p) => persist({ percentages: p })}
            onSaveRound={(r) => persist({ rounds: [r, ...rounds] })}
            onActiveRoundChange={setHasActiveRound}
            groupCode={groupCode}
          />
        </div>
        {tab === "historial" && (
          <HistoryTab
            rounds={rounds}
            onDelete={(id) => persist({ rounds: rounds.filter((r) => r.id !== id) })}
            groupCode={groupCode}
            syncing={syncing}
            onSync={() => syncFromGroup(groupCode, rounds, (synced) => persist({ rounds: synced }))}
          />
        )}
        {tab === "acumulado" && <StandingsTab rounds={rounds} />}
        {tab === "mystats" && <MyStatsTab rounds={rounds} />}
        {tab === "ranking" && <LeaderboardTab />}
      </main>
    </div>
  );
}

// ---------- Login Screen (Phase 2 PIN auth) ----------
function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState("choose"); // choose | create | join
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [users, setUsers] = useState({});
  const [selectedId, setSelectedId] = useState("");
  const [joinPin, setJoinPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode === "join") usersGetAll().then(setUsers);
  }, [mode]);

  const handleCreate = async () => {
    if (!name.trim() || pin.length !== 4) { setError("Ingresa tu nombre y un PIN de 4 dígitos."); return; }
    setLoading(true);
    const id = uid();
    const ok = await userCreate(id, { name: name.trim(), pin, createdAt: Date.now() });
    if (ok) { onLogin(id); }
    else { setError("No se pudo guardar el perfil. Verifica tu conexión."); setLoading(false); }
  };

  const handleJoin = () => {
    if (!selectedId) { setError("Selecciona tu nombre."); return; }
    const u = users[selectedId];
    if (!u || u.pin !== joinPin) { setError("PIN incorrecto."); return; }
    onLogin(selectedId);
  };

  const card = "bg-white rounded-2xl shadow-lg max-w-sm w-full p-6 space-y-4";
  const btnPrimary = "w-full px-4 py-3 rounded-xl bg-emerald-800 text-amber-50 font-body font-semibold hover:bg-emerald-700";
  const btnSecondary = "w-full px-4 py-3 rounded-xl bg-amber-500 text-emerald-950 font-body font-semibold hover:bg-amber-400";
  const inputCls = "w-full px-3 py-2 rounded-lg border border-stone-300 font-body bg-white";

  if (mode === "choose") return (
    <div className="min-h-screen bg-[#F3EFE3] flex items-center justify-center p-4">
      <div className={card}>
        <h1 className="font-display text-2xl text-emerald-900">Score Keeper</h1>
        <p className="font-body text-stone-600 text-sm">Crea un perfil para que tu historial se sincronice entre dispositivos.</p>
        <button onClick={() => setMode("create")} className={btnPrimary}>Crear perfil nuevo</button>
        <button onClick={() => setMode("join")} className={btnSecondary}>Ya tengo perfil</button>
      </div>
    </div>
  );

  if (mode === "create") return (
    <div className="min-h-screen bg-[#F3EFE3] flex items-center justify-center p-4">
      <div className={card}>
        <h2 className="font-display text-xl text-emerald-900">Crear perfil</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" className={inputCls} autoFocus />
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="PIN de 4 dígitos" type="password" inputMode="numeric" className={inputCls} />
        {error && <p className="text-rose-700 text-sm font-body">{error}</p>}
        <button onClick={handleCreate} disabled={loading} className={btnPrimary}>{loading ? "Guardando…" : "Crear perfil"}</button>
        <button onClick={() => { setMode("choose"); setError(""); }} className="w-full text-sm font-body text-stone-500 hover:underline">Volver</button>
      </div>
    </div>
  );

  // join mode
  const userList = Object.entries(users);
  return (
    <div className="min-h-screen bg-[#F3EFE3] flex items-center justify-center p-4">
      <div className={card}>
        <h2 className="font-display text-xl text-emerald-900">Iniciar sesión</h2>
        {userList.length === 0
          ? <p className="text-stone-500 font-body text-sm">Cargando perfiles…</p>
          : <select value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setError(""); }}
              className={inputCls}>
              <option value="">Selecciona tu nombre…</option>
              {userList.map(([id, u]) => <option key={id} value={id}>{u.name}</option>)}
            </select>
        }
        <input value={joinPin} onChange={(e) => setJoinPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="Tu PIN" type="password" inputMode="numeric" className={inputCls} onKeyDown={(e) => e.key === "Enter" && handleJoin()} />
        {error && <p className="text-rose-700 text-sm font-body">{error}</p>}
        <button onClick={handleJoin} className={btnSecondary}>Entrar</button>
        <button onClick={() => { setMode("choose"); setError(""); }} className="w-full text-sm font-body text-stone-500 hover:underline">Volver</button>
      </div>
    </div>
  );
}

// ---------- Courses Tab ----------
function HoleRow({ field, label, values, onChange, checkDuplicates, inputRefs, onKeyDown }) {
  const counts = {};
  if (checkDuplicates) {
    values.forEach((v) => {
      const n = String(v).trim();
      if (n === "") return;
      counts[n] = (counts[n] || 0) + 1;
    });
  }
  return (
    <tr>
      <td className="pr-2 text-stone-500 whitespace-nowrap">{label}</td>
      {values.map((v, i) => {
        const isDup = checkDuplicates && String(v).trim() !== "" && counts[String(v).trim()] > 1;
        return (
          <td key={i}>
            <input
              ref={(el) => (inputRefs.current[`${field}_${i}`] = el)}
              value={isDup ? "E" : v}
              onChange={(e) => onChange(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(e, field, i)}
              className={`w-9 text-center border rounded font-mono text-xs py-0.5 ${isDup ? "border-rose-600 bg-rose-50 text-rose-700 font-bold" : "border-stone-300"}`}
              title={isDup ? "Ventaja repetida: cada hoyo debe tener un número distinto" : undefined}
            />
          </td>
        );
      })}
    </tr>
  );
}

const COURSE_FIELDS = ["pars", "siFrom1", "siFrom10"];

function CourseEditor({ course, onChange, onDelete }) {
  const inputRefs = useRef({});
  const setField = (field, idx, value) => {
    const arr = [...course[field]];
    arr[idx] = value;
    onChange({ ...course, [field]: arr });
  };

  const focusCell = (field, idx) => {
    const cell = inputRefs.current[`${field}_${idx}`];
    if (cell) {
      cell.focus();
      cell.select();
    }
  };

  const handleKeyDown = (e, field, idx) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (idx < 17) {
      focusCell(field, idx + 1);
    } else {
      const fieldIdx = COURSE_FIELDS.indexOf(field);
      if (fieldIdx < COURSE_FIELDS.length - 1) {
        focusCell(COURSE_FIELDS[fieldIdx + 1], 0);
      }
    }
  };

  return (
    <div className="bg-white/70 rounded-xl p-4 border border-emerald-900/10 space-y-3">
      <div className="flex justify-between items-center">
        <input value={course.name} onChange={(e) => onChange({ ...course, name: e.target.value })} placeholder="Nombre del campo" className="font-display text-lg text-emerald-900 bg-transparent border-b border-emerald-900/20 outline-none flex-1" />
        <button onClick={onDelete} className="text-rose-700 text-xs font-body underline ml-3">Eliminar campo</button>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <tbody>
            <tr>
              <td className="pr-2 text-stone-500">Hoyo</td>
              {course.pars.map((_, i) => (
                <td key={i} className="text-center w-9 text-stone-500 font-mono text-xs">{i + 1}</td>
              ))}
            </tr>
            <HoleRow field="pars" label="Par" values={course.pars} onChange={(i, v) => setField("pars", i, v)} inputRefs={inputRefs} onKeyDown={handleKeyDown} />
            <HoleRow field="siFrom1" label="Ventaja (salida 1)" values={course.siFrom1} onChange={(i, v) => setField("siFrom1", i, v)} checkDuplicates inputRefs={inputRefs} onKeyDown={handleKeyDown} />
            <HoleRow field="siFrom10" label="Ventaja (salida 10)" values={course.siFrom10} onChange={(i, v) => setField("siFrom10", i, v)} checkDuplicates inputRefs={inputRefs} onKeyDown={handleKeyDown} />
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500 font-body">"Ventaja" = índice de hándicap del hoyo (1 = más difícil, recibe golpe primero). Se usa para calcular medal neto y stableford. Si un número de ventaja se repite en la misma fila, se marca con "E" (error) — cada hoyo debe tener un número distinto del 1 al 18. Presiona Enter para avanzar al siguiente hoyo.</p>
    </div>
  );
}

function CoursesTab({ courses, onChange }) {
  const add = () => onChange([...courses, emptyCourse()]);
  const update = (id, next) => onChange(courses.map((c) => (c.id === id ? next : c)));
  const remove = (id) => onChange(courses.filter((c) => c.id !== id));
  return (
    <div className="space-y-4">
      <button onClick={add} className="px-4 py-2 rounded-lg bg-emerald-800 text-amber-50 font-body font-semibold hover:bg-emerald-700">+ Agregar campo</button>
      {courses.length === 0 && <p className="text-stone-500 font-body text-sm">Agrega el campo donde juegan: par y ventaja (índice de hándicap) por hoyo, incluyendo la versión por si la salida es por el hoyo 1 o por el hoyo 10.</p>}
      {courses.map((c) => (
        <CourseEditor key={c.id} course={c} onChange={(next) => update(c.id, next)} onDelete={() => remove(c.id)} />
      ))}
    </div>
  );
}

// ---------- Percentages editor ----------
function PercentagesEditor({ percentages, setPercentages }) {
  const [open, setOpen] = useState(false);
  const sum = Object.values(percentages).reduce((a, b) => a + (Number(b) || 0), 0);
  const set = (key, val) => setPercentages({ ...percentages, [key]: val });
  return (
    <div className="bg-white/70 rounded-xl p-4 border border-emerald-900/10">
      <button onClick={() => setOpen((o) => !o)} className="font-display text-lg text-emerald-900 flex items-center gap-2">
        Reparto de la apuesta {open ? "▲" : "▼"}
      </button>
      {!open && <p className="text-xs font-body text-stone-500 mt-1">Suma actual: {sum}% {sum !== 100 && <span className="text-rose-700">(debería ser 100%)</span>}</p>}
      {open && (
        <div className="mt-3 space-y-2">
          {Object.keys(DEFAULT_PCT).map((key) => (
            <div key={key} className="flex items-center justify-between gap-3 text-sm font-body">
              <span className="text-stone-600">{PCT_LABELS[key]}</span>
              <div className="flex items-center gap-1">
                <input type="number" value={percentages[key]} onChange={(e) => set(key, Number(e.target.value) || 0)} className="w-16 px-2 py-1 rounded-md border border-stone-300 font-mono text-right" />
                <span className="text-stone-500">%</span>
              </div>
            </div>
          ))}
          <p className={`text-xs font-mono ${sum === 100 ? "text-emerald-700" : "text-rose-700"}`}>Suma: {sum}%</p>
        </div>
      )}
    </div>
  );
}

// ---------- Round Tab (unified create / join / live round) ----------
function RoundTab({ myUserId, myProfile, courses, percentages, onSavePercentages, onSaveRound, onActiveRoundChange = () => {}, groupCode = "" }) {
  const [stage, setStage] = useState("home"); // home | create | waiting | active | viewOnly | join | joinConfirm
  const [code, setCode] = useState("");
  const [meta, setMeta] = useState(null);
  const [participants, setParticipants] = useState({});
  const [scores, setScores] = useState({});
  const [oyeEntries, setOyeEntries] = useState([]);
  const [matches, setMatches] = useState([]);
  const [playerStats, setPlayerStats] = useState({});
  const [statsConfig, setStatsConfig] = useState({});
  const [closedRound, setClosedRound] = useState(null);
  const [savedFromClosed, setSavedFromClosed] = useState(false);
  const [result, setResult] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // create form
  const [date, setDate] = useState(todayISO());
  const [courseId, setCourseId] = useState(courses[0]?.id || "");
  const [salida, setSalida] = useState(1);
  const [bet, setBet] = useState(200);
  const [pct, setPct] = useState(percentages);
  const [roundHcpPct, setRoundHcpPct] = useState(100);
  const [myHcpForRound, setMyHcpForRound] = useState(myProfile?.handicap || 0);

  // guest (host only)
  const [guestName, setGuestName] = useState("");
  const [guestHcp, setGuestHcp] = useState("");

  // join form
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joinHcp, setJoinHcp] = useState(myProfile?.handicap || 0);

  const autoRefreshRef = useRef(null);
  const saveTimers = useRef({});

  useEffect(() => {
    onActiveRoundChange(stage === "active" || stage === "waiting");
  }, [stage]);

  useEffect(() => {
    if ((stage === "waiting" || stage === "active" || stage === "viewOnly") && meta && code) {
      const interval = stage === "waiting" ? 5000 : 12000;
      autoRefreshRef.current = setInterval(() => refreshAll(meta, code), interval);
      return () => clearInterval(autoRefreshRef.current);
    }
  }, [stage, meta, code]);

  useEffect(() => {
    if (!courseId && courses[0]) setCourseId(courses[0].id);
  }, [courses]);

  useEffect(() => { setPct(percentages); }, [percentages]);
  useEffect(() => {
    if (myProfile?.handicap != null) {
      setMyHcpForRound(myProfile.handicap);
      setJoinHcp(myProfile.handicap);
    }
  }, [myProfile]);

  const course = courses.find((c) => c.id === courseId);
  const isHost = meta?.createdBy === myUserId;
  const guestIds = (meta?.guests || []).map((g) => g.id);
  const allPlayers = [
    ...Object.entries(participants).map(([id, p]) => ({ id, name: p.name, handicap: p.handicap })),
    ...(meta?.guests || []),
  ];
  const editableIds = [myUserId, ...(isHost ? guestIds : [])];
  const par3Holes = meta ? meta.pars.map((p, i) => (Number(p) === 3 ? i + 1 : null)).filter(Boolean) : [];
  const handicaps = Object.fromEntries(allPlayers.map((p) => [p.id, p.handicap]));
  const pars = meta ? meta.pars.map((p) => Number(p) || 4) : [];
  const siArr = meta ? meta.si.map((s) => Number(s) || 1) : [];

  const refreshAll = async (m, c) => {
    setRefreshing(true);
    const freshMeta = (await sGet(sharedMetaKey(c))) || m;
    setMeta(freshMeta);
    const pd = (await sGet(sharedParticipantsKey(c))) || {};
    setParticipants(pd);
    const allIds = [...Object.keys(pd), ...(freshMeta.guests || []).map((g) => g.id)];
    const [entries, oyes, closed] = await Promise.all([
      Promise.all(allIds.map(async (id) => [id, (await sGet(sharedScoresKey(c, id))) || Array(18).fill("")])),
      sGet(sharedOyesKey(c)),
      sGet(sharedClosedKey(c)),
    ]);
    setScores(Object.fromEntries(entries));
    setOyeEntries(oyes || []);
    setClosedRound(closed);
    setRefreshing(false);
  };

  const createRound = async () => {
    if (!course) return;
    const p = course.pars.map((x) => Number(x) || 4);
    const si = (salida === 10 ? course.siFrom10 : course.siFrom1).map((s) => Number(s) || 1);
    const { v1, v2 } = vueltaHoles(salida);
    const newCode = makeRoundCode();
    const newMeta = { code: newCode, date, courseName: course.name, pars: p, si, salida, v1, v2, bet: Number(bet) || 0, percentages: pct, roundHcpPct: Number(roundHcpPct) || 100, createdBy: myUserId, createdAt: Date.now(), guests: [] };
    const myEntry = { name: myProfile?.name || "Host", handicap: Number(myHcpForRound) || 0, joinedAt: Date.now() };
    await sSet(sharedMetaKey(newCode), newMeta);
    await sSet(sharedParticipantsKey(newCode), { [myUserId]: myEntry });
    await sSet(sharedScoresKey(newCode, myUserId), Array(18).fill(""));
    await sSet(sharedOyesKey(newCode), []);
    setMeta(newMeta);
    setCode(newCode);
    setParticipants({ [myUserId]: myEntry });
    setScores({ [myUserId]: Array(18).fill("") });
    setOyeEntries([]);
    onSavePercentages(pct);
    setStage("waiting");
  };

  const addGuest = async () => {
    if (!guestName.trim()) return;
    const guestId = "guest-" + uid();
    const guest = { id: guestId, name: guestName.trim(), handicap: Number(guestHcp) || 0 };
    const updatedMeta = { ...meta, guests: [...(meta.guests || []), guest] };
    await sSet(sharedMetaKey(code), updatedMeta);
    await sSet(sharedScoresKey(code, guestId), Array(18).fill(""));
    setMeta(updatedMeta);
    setScores((sc) => ({ ...sc, [guestId]: Array(18).fill("") }));
    setGuestName("");
    setGuestHcp("");
  };

  const lookupCode = async () => {
    setJoinError("");
    const c = joinCodeInput.trim().toUpperCase();
    if (!c) return;
    const m = await sGet(sharedMetaKey(c));
    if (!m) { setJoinError("No se encontró ese código. Verifica con quien creó la ronda."); return; }
    setMeta(m);
    setCode(c);
    setJoinHcp(myProfile?.handicap || 0);
    setStage("joinConfirm");
  };

  const confirmJoin = async () => {
    const myEntry = { name: myProfile?.name || "?", handicap: Number(joinHcp) || 0, joinedAt: Date.now() };
    const existing = (await sGet(sharedParticipantsKey(code))) || {};
    await sSet(sharedParticipantsKey(code), { ...existing, [myUserId]: myEntry });
    await sSet(sharedScoresKey(code, myUserId), Array(18).fill(""));
    await refreshAll(meta, code);
    setStage("active");
  };

  const joinViewOnly = async () => {
    await refreshAll(meta, code);
    setStage("viewOnly");
  };

  const setScore = (id, h, value) => {
    if (!editableIds.includes(id)) return;
    setScores((sc) => {
      const arr = [...(sc[id] || Array(18).fill(""))];
      arr[h] = value;
      const next = { ...sc, [id]: arr };
      clearTimeout(saveTimers.current[id]);
      saveTimers.current[id] = setTimeout(() => sSet(sharedScoresKey(code, id), next[id]), 600);
      return next;
    });
  };

  const setStatForPlayer = (playerId, h, field, value) =>
    setPlayerStats((prev) => ({ ...prev, [playerId]: { ...(prev[playerId] || {}), [h]: { ...((prev[playerId] || {})[h] || {}), [field]: value } } }));
  const toggleStatConfig = (playerId, field) =>
    setStatsConfig((prev) => ({ ...prev, [playerId]: { ...(prev[playerId] || {}), [field]: !((prev[playerId] || {})[field]) } }));

  const addOye = () => {
    const next = [...oyeEntries, { id: uid(), playerId: myUserId, hole: par3Holes[0] || "", distance: "" }];
    setOyeEntries(next);
    sSet(sharedOyesKey(code), next);
  };
  const updateOye = (id, field, value) => {
    const next = oyeEntries.map((o) => (o.id === id ? { ...o, [field]: value } : o));
    setOyeEntries(next);
    sSet(sharedOyesKey(code), next);
  };
  const removeOye = (id) => {
    const next = oyeEntries.filter((o) => o.id !== id);
    setOyeEntries(next);
    sSet(sharedOyesKey(code), next);
  };

  const calc = () => {
    const parts = allPlayers.map((p) =>
      computeParticipant({ playerId: p.id, name: p.name, handicap: Math.round((p.handicap * (Number(meta.roundHcpPct) || 100)) / 100), rawHandicap: p.handicap, pctHcp: meta.roundHcpPct, scores: scores[p.id] || Array(18).fill(0) }, meta.pars, meta.si, meta.v1, meta.v2)
    );
    const sf = settleCategory(parts, meta.bet, meta.percentages.stablefordFront, "ptsVuelta1", false);
    const sb = settleCategory(parts, meta.bet, meta.percentages.stablefordBack, "ptsVuelta2", false);
    const so = settleCategory(parts, meta.bet, meta.percentages.stablefordOverall, "stablefordPoints", false);
    const mf = settleCategory(parts, meta.bet, meta.percentages.medalFront, "netVuelta1", true);
    const mb = settleCategory(parts, meta.bet, meta.percentages.medalBack, "netVuelta2", true);
    const mo = settleCategory(parts, meta.bet, meta.percentages.medalOverall, "netMedal", true);
    const oy = settleOyes(parts, meta.bet, meta.percentages.oyeFront, meta.percentages.oyeBack, oyeEntries.filter((o) => o.playerId && o.hole && o.distance), meta.v1, meta.v2);
    const settlement = {};
    parts.forEach((p) => {
      const total = sf.net[p.playerId] + sb.net[p.playerId] + so.net[p.playerId] + mf.net[p.playerId] + mb.net[p.playerId] + mo.net[p.playerId] + oy.net[p.playerId];
      settlement[p.playerId] = { stablefordFront: sf.net[p.playerId], stablefordBack: sb.net[p.playerId], stablefordOverall: so.net[p.playerId], medalFront: mf.net[p.playerId], medalBack: mb.net[p.playerId], medalOverall: mo.net[p.playerId], oyeFront: oy.netFront[p.playerId], oyeBack: oy.netBack[p.playerId], total: +total.toFixed(2) };
    });
    const winners = { stablefordFront: sf.winners, stablefordBack: sb.winners, stablefordOverall: so.winners, medalFront: mf.winners, medalBack: mb.winners, medalOverall: mo.winners, oyeFront: oy.frontWinners, oyeBack: oy.backWinners };
    setResult({ participants: parts, pars: meta.pars, siArr: meta.si, settlement, winners, v1: meta.v1, v2: meta.v2 });
  };

  const closeAndSave = async () => {
    if (!result) return;
    const round = {
      id: uid(), date: meta.date, courseId: null, courseName: meta.courseName, salida: meta.salida,
      bet: meta.bet, percentages: meta.percentages, pars: result.pars, si: result.siArr,
      v1: result.v1, v2: result.v2, participants: result.participants,
      oyeEntries: oyeEntries.filter((o) => o.playerId && o.hole && o.distance),
      playerStats, statsConfig, winners: result.winners, settlement: result.settlement, sharedCode: code,
    };
    onSaveRound(round);
    await sSet(sharedClosedKey(code), round);
    setClosedRound(round);
    setSavedFromClosed(true);
  };

  const addClosedToHistory = () => {
    onSaveRound({ ...closedRound, id: uid() });
    setSavedFromClosed(true);
  };

  const exit = () => {
    setStage("home");
    setMeta(null);
    setCode("");
    setParticipants({});
    setScores({});
    setOyeEntries([]);
    setMatches([]);
    setPlayerStats({});
    setStatsConfig({});
    setClosedRound(null);
    setResult(null);
    setSavedFromClosed(false);
  };

  // ── HOME ──
  if (stage === "home") return (
    <div className="space-y-4">
      <section className="bg-white/70 rounded-xl p-4 border border-emerald-900/10">
        <h2 className="font-display text-lg text-emerald-900 mb-2">Ronda</h2>
        <p className="text-sm text-stone-600 font-body mb-3">Crea una ronda y comparte el código con el grupo, o únete a una ronda activa con el código que te compartieron.</p>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setStage("create")} className="px-4 py-2 rounded-lg bg-emerald-800 text-amber-50 font-body font-semibold hover:bg-emerald-700">Crear ronda</button>
          <button onClick={() => setStage("join")} className="px-4 py-2 rounded-lg bg-amber-500 text-emerald-950 font-body font-semibold hover:bg-amber-400">Unirme con código</button>
        </div>
      </section>
    </div>
  );

  // ── CREATE ──
  if (stage === "create") return (
    <div className="space-y-4">
      <section className="bg-white/70 rounded-xl p-4 border border-emerald-900/10 space-y-3">
        <h2 className="font-display text-lg text-emerald-900">Nueva ronda</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-body text-stone-600">
            Fecha
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg border border-stone-300 font-mono" />
          </label>
          <label className="text-sm font-body text-stone-600">
            Campo
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg border border-stone-300 font-body bg-white">
              <option value="">Selecciona…</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name || "Sin nombre"}</option>)}
            </select>
          </label>
          <label className="text-sm font-body text-stone-600">
            Salida
            <select value={salida} onChange={(e) => setSalida(Number(e.target.value))} className="w-full mt-1 px-3 py-2 rounded-lg border border-stone-300 font-body bg-white">
              <option value={1}>Hoyo 1</option>
              <option value={10}>Hoyo 10</option>
            </select>
          </label>
          <label className="text-sm font-body text-stone-600">
            Apuesta por jugador ($)
            <input type="number" value={bet} onChange={(e) => setBet(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg border border-stone-300 font-mono" />
          </label>
          <label className="text-sm font-body text-stone-600">
            % de hándicap
            <input type="number" value={roundHcpPct} onChange={(e) => setRoundHcpPct(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg border border-stone-300 font-mono" />
          </label>
          <label className="text-sm font-body text-stone-600">
            Tu hándicap esta ronda
            <input type="number" value={myHcpForRound} onChange={(e) => setMyHcpForRound(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg border border-stone-300 font-mono" />
          </label>
        </div>
        {!course && <p className="text-xs text-rose-700 font-body">Crea un campo en la pestaña Campos primero.</p>}
      </section>
      <PercentagesEditor percentages={pct} setPercentages={setPct} />
      <div className="flex gap-2">
        <button onClick={createRound} disabled={!course} className="px-4 py-2 rounded-lg bg-amber-500 text-emerald-950 font-body font-semibold hover:bg-amber-400 disabled:opacity-40">Crear y obtener código</button>
        <button onClick={() => setStage("home")} className="px-4 py-2 rounded-lg bg-stone-200 text-stone-700 font-body">Cancelar</button>
      </div>
    </div>
  );

  // ── JOIN ──
  if (stage === "join") return (
    <section className="bg-white/70 rounded-xl p-4 border border-emerald-900/10 space-y-3">
      <h2 className="font-display text-lg text-emerald-900">Unirme a una ronda</h2>
      <input value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())} placeholder="Código (ej. AB12C)" className="w-full px-3 py-2 rounded-lg border border-stone-300 font-mono uppercase" autoFocus onKeyDown={(e) => e.key === "Enter" && lookupCode()} />
      {joinError && <p className="text-rose-700 text-xs font-body">{joinError}</p>}
      <div className="flex gap-2">
        <button onClick={lookupCode} className="px-4 py-2 rounded-lg bg-emerald-800 text-amber-50 font-body font-semibold hover:bg-emerald-700">Buscar</button>
        <button onClick={() => setStage("home")} className="px-4 py-2 rounded-lg bg-stone-200 text-stone-700 font-body">Cancelar</button>
      </div>
    </section>
  );

  // ── JOIN CONFIRM ──
  if (stage === "joinConfirm" && meta) return (
    <section className="bg-white/70 rounded-xl p-4 border border-emerald-900/10 space-y-3">
      <h2 className="font-display text-lg text-emerald-900">{meta.courseName} · {meta.date}</h2>
      <p className="text-sm text-stone-600 font-body">Apuesta: ${meta.bet} · HC%: {meta.roundHcpPct}%</p>
      <label className="text-sm font-body text-stone-600 block">
        Tu hándicap esta ronda
        <input type="number" value={joinHcp} onChange={(e) => setJoinHcp(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg border border-stone-300 font-mono" autoFocus />
      </label>
      <div className="flex gap-2 flex-wrap">
        <button onClick={confirmJoin} className="px-4 py-2 rounded-lg bg-amber-500 text-emerald-950 font-body font-semibold hover:bg-amber-400">Unirme y capturar</button>
        <button onClick={joinViewOnly} className="px-4 py-2 rounded-lg bg-stone-200 text-stone-700 font-body font-semibold">Solo ver 👁</button>
        <button onClick={() => { setMeta(null); setCode(""); setStage("join"); }} className="px-4 py-2 rounded-lg bg-stone-100 text-stone-500 font-body text-sm">Atrás</button>
      </div>
    </section>
  );

  // ── WAITING (host lobby) ──
  if (stage === "waiting" && meta) return (
    <div className="space-y-4">
      <section className="bg-emerald-950 text-amber-50 rounded-xl p-4">
        <p className="font-display text-2xl tracking-[0.25em] mb-1">{code}</p>
        <p className="font-body text-xs text-emerald-200 mb-3">{meta.courseName} · {meta.date} · Comparte este código con los demás jugadores</p>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setStage("active")} className="px-4 py-2 rounded-lg bg-amber-500 text-emerald-950 font-body font-semibold hover:bg-amber-400">Comenzar ronda</button>
          <button onClick={() => refreshAll(meta, code)} className="px-3 py-2 rounded-lg bg-emerald-900/60 text-emerald-100 font-body text-sm">{refreshing ? "…" : "Actualizar lista"}</button>
          <button onClick={exit} className="px-3 py-2 rounded-lg bg-emerald-900/60 text-emerald-100 font-body text-sm">Cancelar</button>
        </div>
      </section>
      <section className="bg-white/70 rounded-xl p-4 border border-emerald-900/10 space-y-2">
        <h3 className="font-display text-emerald-900">En la sala ({allPlayers.length})</h3>
        {allPlayers.length === 0 && <p className="text-sm text-stone-500 font-body">Esperando jugadores…</p>}
        {allPlayers.map((p) => (
          <div key={p.id} className="flex items-center gap-2 font-body text-sm py-0.5">
            <span className="flex-1">{p.name}</span>
            <span className="text-stone-400 text-xs">HC {p.handicap}</span>
            {p.id === myUserId && <span className="text-xs text-amber-700 font-semibold">tú</span>}
            {guestIds.includes(p.id) && <span className="text-xs text-stone-400">invitado</span>}
          </div>
        ))}
        <div className="border-t border-stone-200 pt-3 mt-1">
          <p className="text-xs font-body text-stone-500 mb-2">Agregar jugador sin cuenta:</p>
          <div className="flex gap-2">
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Nombre" className="flex-1 px-2 py-1.5 rounded-lg border border-stone-300 font-body text-sm bg-white" onKeyDown={(e) => e.key === "Enter" && addGuest()} />
            <input type="number" value={guestHcp} onChange={(e) => setGuestHcp(e.target.value)} placeholder="HC" className="w-16 px-2 py-1.5 rounded-lg border border-stone-300 font-mono text-sm" />
            <button onClick={addGuest} className="px-3 py-1.5 rounded-lg bg-stone-200 text-stone-700 font-body text-sm font-semibold">+ Agregar</button>
          </div>
        </div>
      </section>
    </div>
  );

  // ── VIEW ONLY ──
  if (stage === "viewOnly" && meta) return (
    <div className="space-y-4">
      <section className="bg-emerald-950 text-amber-50 rounded-xl p-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="font-display text-lg">Ronda en vivo · Código: <span className="tracking-widest">{code}</span></p>
          <p className="font-body text-xs text-emerald-200">{meta.courseName} · {meta.date} · Se actualiza cada 12 s</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => refreshAll(meta, code)} className="px-3 py-1.5 rounded-md bg-amber-500 text-emerald-950 font-body text-sm font-semibold">{refreshing ? "…" : "Actualizar"}</button>
          <button onClick={exit} className="px-3 py-1.5 rounded-md bg-emerald-900/60 text-emerald-100 font-body text-sm">Salir</button>
        </div>
      </section>
      {closedRound && (
        <section className="bg-amber-50 border border-amber-400 rounded-xl p-3 font-body text-sm">
          Esta ronda ya cerró.{" "}
          {!savedFromClosed && <button onClick={addClosedToHistory} className="text-emerald-800 underline ml-1">Agregar a mi historial</button>}
          {savedFromClosed && <span className="text-emerald-700 ml-1">Agregada ✓</span>}
        </section>
      )}
      <section className="bg-white/70 rounded-xl p-4 border border-emerald-900/10 overflow-x-auto space-y-5">
        <HalfScorecard title="Hoyos 1 a 9" holeNumbers={[1,2,3,4,5,6,7,8,9]} selectedIds={allPlayers.map((p)=>p.id)} players={allPlayers} scores={scores} setScore={() => {}} handicaps={handicaps} roundHcpPct={meta.roundHcpPct} pars={pars} siArr={siArr} readOnlyIds={allPlayers.map((p)=>p.id)} />
        <HalfScorecard title="Hoyos 10 a 18" holeNumbers={[10,11,12,13,14,15,16,17,18]} selectedIds={allPlayers.map((p)=>p.id)} players={allPlayers} scores={scores} setScore={() => {}} handicaps={handicaps} roundHcpPct={meta.roundHcpPct} pars={pars} siArr={siArr} readOnlyIds={allPlayers.map((p)=>p.id)} />
        <AccumulatedScorecard selectedIds={allPlayers.map((p)=>p.id)} players={allPlayers} scores={scores} handicaps={handicaps} roundHcpPct={meta.roundHcpPct} pars={pars} siArr={siArr} />
      </section>
    </div>
  );

  // ── ACTIVE ──
  if (!meta) return null;
  const readOnlyIds = allPlayers.map((p) => p.id).filter((id) => !editableIds.includes(id));
  return (
    <div className="space-y-4">
      <section className="bg-emerald-950 text-amber-50 rounded-xl p-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="font-display text-lg">Código: <span className="tracking-widest">{code}</span></p>
          <p className="font-body text-xs text-emerald-200">{meta.courseName} · {meta.date} · {allPlayers.length} jugadores</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => refreshAll(meta, code)} className="px-3 py-1.5 rounded-md bg-amber-500 text-emerald-950 font-body text-sm font-semibold">{refreshing ? "…" : "Actualizar"}</button>
          <button onClick={exit} className="px-3 py-1.5 rounded-md bg-emerald-900/60 text-emerald-100 font-body text-sm">Salir</button>
        </div>
      </section>

      {closedRound && (
        <section className="bg-amber-50 border border-amber-400 rounded-xl p-3 text-sm font-body">
          Esta ronda ya se cerró.{" "}
          {!savedFromClosed && <button onClick={addClosedToHistory} className="text-emerald-800 underline ml-1">Agregar a mi historial</button>}
          {savedFromClosed && <span className="text-emerald-700 ml-1">Agregada ✓</span>}
        </section>
      )}

      <section className="bg-white/70 rounded-xl p-4 border border-emerald-900/10 overflow-x-auto space-y-5">
        <p className="text-xs text-stone-500 font-body">Vuelta 1: hoyos {meta.v1.join(", ")} · Vuelta 2: hoyos {meta.v2.join(", ")}</p>
        <HalfScorecard title="Hoyos 1 a 9" holeNumbers={[1,2,3,4,5,6,7,8,9]} selectedIds={allPlayers.map((p)=>p.id)} players={allPlayers} scores={scores} setScore={setScore} handicaps={handicaps} roundHcpPct={meta.roundHcpPct} pars={pars} siArr={siArr} readOnlyIds={readOnlyIds} playerStats={playerStats} setStatForPlayer={setStatForPlayer} statsConfig={statsConfig} toggleStatConfig={toggleStatConfig} />
        <HalfScorecard title="Hoyos 10 a 18" holeNumbers={[10,11,12,13,14,15,16,17,18]} selectedIds={allPlayers.map((p)=>p.id)} players={allPlayers} scores={scores} setScore={setScore} handicaps={handicaps} roundHcpPct={meta.roundHcpPct} pars={pars} siArr={siArr} readOnlyIds={readOnlyIds} playerStats={playerStats} setStatForPlayer={setStatForPlayer} statsConfig={statsConfig} toggleStatConfig={toggleStatConfig} />
        <AccumulatedScorecard selectedIds={allPlayers.map((p)=>p.id)} players={allPlayers} scores={scores} handicaps={handicaps} roundHcpPct={meta.roundHcpPct} pars={pars} siArr={siArr} />

        <div>
          <div className="flex items-center justify-between">
            <h3 className="font-display text-emerald-900">Oyes (tiro más cercano, par 3)</h3>
            <button onClick={addOye} className="text-xs font-body text-emerald-800 underline">+ agregar</button>
          </div>
          {oyeEntries.length === 0 && <p className="text-xs text-stone-500 font-body mt-1">Sin registros aún.</p>}
          {oyeEntries.map((o) => (
            <div key={o.id} className="flex items-center gap-2 mt-2 font-body text-sm flex-wrap">
              <select value={o.playerId} onChange={(e) => updateOye(o.id, "playerId", e.target.value)} className="px-2 py-1 rounded-md border border-stone-300 bg-white flex-1">
                {allPlayers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={o.hole} onChange={(e) => updateOye(o.id, "hole", e.target.value)} className="px-2 py-1 rounded-md border border-stone-300 bg-white font-mono">
                {par3Holes.map((h) => <option key={h} value={h}>Hoyo {h}</option>)}
              </select>
              <input type="number" value={o.distance} onChange={(e) => updateOye(o.id, "distance", e.target.value)} placeholder="Dist. (m)" className="w-24 px-2 py-1 rounded-md border border-stone-300 font-mono" />
              <button onClick={() => removeOye(o.id)} className="text-rose-700 text-xs">✕</button>
            </div>
          ))}
        </div>

        <MatchPlayPanel matches={matches} setMatches={setMatches} selected={allPlayers.map((p)=>p.id)} players={allPlayers} scores={scores} handicaps={handicaps} roundHcpPct={meta.roundHcpPct} pars={pars} siArr={siArr} />

        {isHost && (
          <button onClick={calc} className="px-4 py-2 rounded-lg bg-amber-500 text-emerald-950 font-body font-semibold hover:bg-amber-400">Cerrar ronda y calcular apuesta</button>
        )}
      </section>

      {result && isHost && <ResultPanel result={result} players={allPlayers} onSave={closeAndSave} />}
    </div>
  );
}
// ---------- Match Play ----------
function calcMatch(p1Id, p2Id, hcpPct, scores, handicaps, pars, siArr) {
  const rawHcp1 = Number(handicaps[p1Id]) || 0;
  const rawHcp2 = Number(handicaps[p2Id]) || 0;
  const ph1 = Math.round((rawHcp1 * (Number(hcpPct) || 100)) / 100);
  const ph2 = Math.round((rawHcp2 * (Number(hcpPct) || 100)) / 100);
  // In match play, only the difference matters
  const diff = ph1 - ph2; // positive = p1 gets strokes vs p2
  const sc1 = scores[p1Id] || Array(18).fill("");
  const sc2 = scores[p2Id] || Array(18).fill("");
  const holes = [];
  let running = 0;
  for (let h = 0; h < 18; h++) {
    const g1 = Number(sc1[h]) || 0;
    const g2 = Number(sc2[h]) || 0;
    if (!g1 || !g2) { holes.push(null); continue; }
    const absDiff = Math.abs(diff);
    const si = Number(siArr[h]) || (h + 1);
    const strokes = Math.floor(absDiff / 18) + (si <= (absDiff % 18) ? 1 : 0);
    const net1 = g1 - (diff > 0 ? strokes : 0);
    const net2 = g2 - (diff < 0 ? strokes : 0);
    const won = net1 < net2 ? 1 : net1 > net2 ? -1 : 0; // from p1 perspective
    running += won;
    holes.push({ h: h + 1, g1, g2, net1, net2, won, running });
  }
  return { holes, ph1, ph2, diff };
}

function MatchPlayPanel({ matches, setMatches, selected, players, scores, handicaps, roundHcpPct, pars, siArr }) {
  if (selected.length < 2) return null;

  const addMatch = () => setMatches((m) => [...m, { id: uid(), p1: selected[0], p2: selected[1], hcpPct: roundHcpPct }]);
  const removeMatch = (id) => setMatches((m) => m.filter((x) => x.id !== id));
  const updateMatch = (id, field, val) => setMatches((m) => m.map((x) => x.id === id ? { ...x, [field]: val } : x));

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-emerald-900">Match Play</h3>
        <button onClick={addMatch} className="text-xs font-body text-emerald-800 underline">+ Agregar match</button>
      </div>

      {matches.length === 0 && (
        <p className="text-xs text-stone-500 font-body">Presiona "+ Agregar match" para enfrentar a dos jugadores. Puedes tener varios matches simultáneos.</p>
      )}

      {matches.map((m) => {
        const { holes, ph1, ph2, diff } = calcMatch(m.p1, m.p2, m.hcpPct, scores, handicaps, pars, siArr);
        const p1Name = players.find((p) => p.id === m.p1)?.name || "?";
        const p2Name = players.find((p) => p.id === m.p2)?.name || "?";
        const lastPlayed = [...holes].reverse().find((h) => h !== null);
        const score = lastPlayed ? lastPlayed.running : 0;
        const holesPlayed = holes.filter((h) => h !== null).length;
        const holesLeft = 18 - holesPlayed;
        // Match closed when |score| > holesLeft
        const closed = Math.abs(score) > holesLeft;
        const scoreLabel = score === 0 ? "AS" : score > 0 ? `${p1Name} +${score}` : `${p2Name} +${Math.abs(score)}`;
        const closedLabel = closed ? (score > 0 ? `${p1Name} gana ${Math.abs(score)}&${holesLeft}` : `${p2Name} gana ${Math.abs(score)}&${holesLeft}`) : null;

        return (
          <div key={m.id} className="bg-white/70 rounded-xl border border-emerald-900/10 p-3 space-y-2">
            {/* Header row */}
            <div className="flex items-center gap-2 flex-wrap">
              <select value={m.p1} onChange={(e) => updateMatch(m.id, "p1", e.target.value)} className="px-2 py-1 rounded-md border border-stone-300 bg-white font-body text-sm flex-1 min-w-[80px]">
                {selected.map((id) => <option key={id} value={id}>{players.find((p) => p.id === id)?.name}</option>)}
              </select>
              <span className="font-display text-stone-500 text-sm">vs</span>
              <select value={m.p2} onChange={(e) => updateMatch(m.id, "p2", e.target.value)} className="px-2 py-1 rounded-md border border-stone-300 bg-white font-body text-sm flex-1 min-w-[80px]">
                {selected.map((id) => <option key={id} value={id}>{players.find((p) => p.id === id)?.name}</option>)}
              </select>
              <div className="flex items-center gap-1 text-xs font-body text-stone-500">
                <input type="number" value={m.hcpPct} onChange={(e) => updateMatch(m.id, "hcpPct", e.target.value)} className="w-12 px-1 py-1 rounded border border-stone-300 font-mono text-right" />
                <span>%HC</span>
              </div>
              <button onClick={() => removeMatch(m.id)} className="text-rose-600 text-xs font-body">✕</button>
            </div>

            {/* HC info */}
            <p className="text-[10px] font-body text-stone-500">
              HC de juego: {p1Name} <b>{ph1}</b> · {p2Name} <b>{ph2}</b>
              {diff !== 0 && <> · {diff > 0 ? p1Name : p2Name} recibe <b>{Math.abs(diff)}</b> golpe{Math.abs(diff) > 1 ? "s" : ""}</>}
            </p>

            {/* Live score badge */}
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-semibold ${score === 0 ? "bg-stone-200 text-stone-700" : score > 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              <span>{holesPlayed > 0 ? scoreLabel : "Esperando scores…"}</span>
              {holesPlayed > 0 && !closed && <span className="font-mono font-normal text-xs opacity-70">({holesLeft} por jugar)</span>}
              {closed && <span className="font-mono font-normal text-xs opacity-70">CERRADO</span>}
            </div>
            {closedLabel && <p className="text-xs font-body text-stone-500 italic">{closedLabel}</p>}

            {/* Hole-by-hole table */}
            {holesPlayed > 0 && (
              <div className="overflow-x-auto">
                <table className="font-mono text-[10px] border-collapse min-w-full">
                  <thead>
                    <tr className="text-stone-400 font-body">
                      <th className="text-left pr-1">Hoyo</th>
                      {holes.filter(Boolean).map((h) => <th key={h.h} className="px-1 text-center">{h.h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="pr-1 whitespace-nowrap text-stone-500">{p1Name}</td>
                      {holes.filter(Boolean).map((h) => <td key={h.h} className="px-1 text-center">{h.net1}</td>)}
                    </tr>
                    <tr>
                      <td className="pr-1 whitespace-nowrap text-stone-500">{p2Name}</td>
                      {holes.filter(Boolean).map((h) => <td key={h.h} className="px-1 text-center">{h.net2}</td>)}
                    </tr>
                    <tr className="border-t border-stone-200">
                      <td className="pr-1 text-stone-400">Hoyo</td>
                      {holes.filter(Boolean).map((h) => (
                        <td key={h.h} className={`px-1 text-center font-bold ${h.won > 0 ? "text-emerald-600" : h.won < 0 ? "text-rose-600" : "text-stone-400"}`}>
                          {h.won > 0 ? "▲" : h.won < 0 ? "▼" : "–"}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="pr-1 text-stone-400">Dif</td>
                      {holes.filter(Boolean).map((h) => (
                        <td key={h.h} className={`px-1 text-center font-bold ${h.running > 0 ? "text-emerald-700" : h.running < 0 ? "text-rose-700" : "text-stone-500"}`}>
                          {h.running > 0 ? `+${h.running}` : h.running}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                <p className="text-[10px] text-stone-400 font-body mt-1">▲ = hoyo para {p1Name} · ▼ = hoyo para {p2Name} · Dif = diferencia acumulada</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ResultRow({ label, playerId, players, value, winners }) {
  const name = players.find((p) => p.id === playerId)?.name || playerId;
  const won = winners?.includes(playerId);
  return (
    <div className="flex justify-between font-mono text-sm py-0.5">
      <span>{name} {won && <Badge>GANA</Badge>}</span>
      <Money value={value} />
    </div>
  );
}

function ResultPanel({ result, players, onSave }) {
  const ids = result.participants.map((p) => p.playerId);
  const totalsByPlayer = ids.map((id) => ({ id, total: result.settlement[id].total }));

  return (
    <section className="space-y-4">
      <ScorecardSummary participants={result.participants} pars={result.pars} siArr={result.siArr} v1={result.v1} v2={result.v2} />
      <div className="bg-emerald-950 text-amber-50 rounded-xl p-4 space-y-4">
      <h2 className="font-display text-lg uppercase">Resultado de la ronda</h2>

      <div>
        <h3 className="font-body text-sm text-emerald-300 mb-1">Total neto por jugador</h3>
        {totalsByPlayer.sort((a, b) => b.total - a.total).map(({ id, total }) => (
          <ResultRow key={id} playerId={id} players={players} value={total} />
        ))}
      </div>

      <details className="text-xs">
        <summary className="font-body text-emerald-300 cursor-pointer">Ver desglose por categoría</summary>
        <div className="mt-2 space-y-3">
          {[
            ["Stableford 1ª vuelta", "stablefordFront"],
            ["Stableford 2ª vuelta", "stablefordBack"],
            ["Stableford general", "stablefordOverall"],
            ["Medal neto 1ª vuelta", "medalFront"],
            ["Medal neto 2ª vuelta", "medalBack"],
            ["Medal neto general", "medalOverall"],
          ].map(([label, key]) => (
            <div key={key}>
              <p className="font-body text-emerald-300">{label}</p>
              {ids.map((id) => (
                <ResultRow key={id} playerId={id} players={players} value={result.settlement[id][key]} winners={result.winners[key]} />
              ))}
            </div>
          ))}
          <div>
            <p className="font-body text-emerald-300">Oyes 1ª vuelta</p>
            {ids.map((id) => (
              <ResultRow key={id} playerId={id} players={players} value={result.settlement[id].oyeFront} winners={result.winners.oyeFront || []} />
            ))}
          </div>
          <div>
            <p className="font-body text-emerald-300">Oyes 2ª vuelta</p>
            {ids.map((id) => (
              <ResultRow key={id} playerId={id} players={players} value={result.settlement[id].oyeBack} winners={result.winners.oyeBack || []} />
            ))}
          </div>
        </div>
      </details>

      <button onClick={onSave} className="w-full py-2 rounded-lg bg-amber-500 text-emerald-950 font-body font-semibold hover:bg-amber-400">Guardar ronda</button>
      </div>
    </section>
  );
}

// ---------- Half Scorecard: editable score inputs for 9 holes + live totals row ----------
function holeMarkClass(gross, par) {
  if (!gross || gross <= 0) return "border border-stone-300 rounded";
  const diff = gross - par;
  if (diff <= -1) return "rounded-full border-2 border-emerald-600 font-bold text-emerald-700"; // birdie o mejor: círculo
  if (diff === 1) return "border-2 border-amber-600 font-bold text-amber-700"; // bogey: cuadro
  if (diff >= 2) return "border-4 border-double border-rose-700 font-bold text-rose-700"; // doble bogey o peor: doble cuadro
  return "border border-stone-300 rounded"; // par
}

function computeHalfStats(holeNumbers, holeScores, playingHcp, pars, siArr) {
  let gross = 0,
    hc = 0,
    net = 0,
    pts = 0,
    holesPlayed = 0;
  holeNumbers.forEach((holeNum) => {
    const h = holeNum - 1;
    const g = Number(holeScores[h]) || 0;
    if (g <= 0) return;
    holesPlayed += 1;
    const st = strokesOnHole(playingHcp, siArr[h]);
    gross += g;
    hc += st;
    net += g - st;
    pts += stablefordPointsForHole(g, pars[h], st);
  });
  return { gross, hc, net, pts, holesPlayed };
}

function getLeaders(rows) {
  const active = rows.filter((r) => r.holesPlayed > 0);
  if (active.length === 0) return { medalLeaders: [], stfLeaders: [] };
  const bestNet = Math.min(...active.map((r) => r.net));
  const bestPts = Math.max(...active.map((r) => r.pts));
  return {
    medalLeaders: active.filter((r) => r.net === bestNet).map((r) => r.id),
    stfLeaders: active.filter((r) => r.pts === bestPts).map((r) => r.id),
  };
}

function LeaderDots({ id, medalLeaders, stfLeaders }) {
  const isMedal = medalLeaders.includes(id);
  const isStf = stfLeaders.includes(id);
  if (!isMedal && !isStf) return null;
  return (
    <span className="inline-flex items-center gap-0.5 ml-1 align-middle">
      {isMedal && <span title="Líder Medal (neto)" className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600" />}
      {isStf && <span title="Líder Stableford (puntos)" className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500" />}
    </span>
  );
}

function ScoreModal({ hole, par, playerName, value, onDone }) {
  const [val, setVal] = React.useState(String(value || ""));

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key >= "1" && e.key <= "9") press(e.key);
      else if (e.key === "0") press("0");
      else if (e.key === "Backspace") setVal((v) => v.slice(0, -1));
      else if (e.key === "Enter") onDone(val);
      else if (e.key === "Escape") onDone(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [val]);

  const press = (digit) => setVal((v) => (v.length >= 2 ? v : v + digit));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={() => onDone(null)}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-xs p-5 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-4">
          <p className="text-stone-500 font-body text-xs mb-0.5">{playerName}</p>
          <p className="font-display text-emerald-900 text-base">Hoyo {hole} · Par {par}</p>
          <div className="mt-3 h-16 flex items-center justify-center">
            <span className="font-mono font-bold text-emerald-900 leading-none" style={{ fontSize: "4rem" }}>
              {val !== "" ? val : <span style={{ color: "#d1d5db" }}>–</span>}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button
              key={n}
              onClick={() => press(String(n))}
              style={{ touchAction: "manipulation" }}
              className="h-14 rounded-xl bg-stone-100 text-stone-800 font-body font-semibold text-2xl hover:bg-stone-200 active:scale-95 transition-transform"
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => setVal((v) => v.slice(0, -1))}
            style={{ touchAction: "manipulation" }}
            className="h-14 rounded-xl bg-stone-200 text-stone-700 font-body font-semibold text-lg hover:bg-stone-300 active:scale-95 transition-transform"
          >
            ⌫
          </button>
          <button
            onClick={() => press("0")}
            style={{ touchAction: "manipulation" }}
            className="h-14 rounded-xl bg-stone-100 text-stone-800 font-body font-semibold text-2xl hover:bg-stone-200 active:scale-95 transition-transform"
          >
            0
          </button>
          <button
            onClick={() => onDone(val)}
            style={{ touchAction: "manipulation" }}
            className="h-14 rounded-xl bg-emerald-800 text-amber-50 font-body font-semibold text-lg hover:bg-emerald-700 active:scale-95 transition-transform"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function HalfScorecard({ title, holeNumbers, selectedIds, players, scores, setScore, handicaps, roundHcpPct, pars, siArr, readOnlyIds = [], playerStats = {}, setStatForPlayer = () => {}, statsConfig = {}, toggleStatConfig = () => {} }) {
  const inputRefs = useRef({});
  const [editing, setEditing] = React.useState(null);
  const STAT_FIELDS = ["fw", "ob", "lago", "putts"];
  const STAT_LABELS = { fw: "FW/Green", ob: "OB", lago: "Lago", putts: "Putts" };

  const rows = selectedIds.map((id) => {
    const player = players.find((p) => p.id === id);
    const rawHcp = Number(handicaps[id]) || 0;
    const playingHcp = Math.round((rawHcp * (Number(roundHcpPct) || 100)) / 100);
    const holeScores = scores[id] || Array(18).fill("");
    const stats = computeHalfStats(holeNumbers, holeScores, playingHcp, pars, siArr);
    return { id, name: player?.name || "", playingHcp, holeScores, ...stats };
  });
  const { medalLeaders, stfLeaders } = getLeaders(rows);

  const focusRef = (key) => {
    const el = inputRefs.current[key];
    if (el) { el.focus(); el.select && el.select(); return true; }
    return false;
  };

  const getFirstEnabledStat = (id) => STAT_FIELDS.find((f) => statsConfig[id]?.[f]);
  const getNextEnabledStat = (id, field) => {
    const idx = STAT_FIELDS.indexOf(field);
    return STAT_FIELDS.slice(idx + 1).find((f) => statsConfig[id]?.[f]) || null;
  };

  const handleKeyDown = (e, h, rowIdx) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const id = rows[rowIdx]?.id;
    const firstStat = getFirstEnabledStat(id);
    if (firstStat) { focusRef(`${firstStat}_${h}_${id}`); return; }
    if (rowIdx < rows.length - 1) { focusRef(`score_${h}_${rowIdx + 1}`); }
    else {
      const hIdx = holeNumbers.indexOf(h);
      if (hIdx < holeNumbers.length - 1) focusRef(`score_${holeNumbers[hIdx + 1]}_0`);
    }
  };

  const handleStatKey = (e, h, field, id, rowIdx) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = getNextEnabledStat(id, field);
    if (next) { focusRef(`${next}_${h}_${id}`); return; }
    if (rowIdx < rows.length - 1) { focusRef(`score_${h}_${rowIdx + 1}`); }
    else {
      const hIdx = holeNumbers.indexOf(h);
      if (hIdx < holeNumbers.length - 1) focusRef(`score_${holeNumbers[hIdx + 1]}_0`);
    }
  };

  return (
    <div>
      <h3 className="font-display text-emerald-900 text-sm mb-2 uppercase tracking-wide">{title}</h3>
      <table className="font-mono text-xs border-collapse min-w-full">
        <thead>
          <tr>
            <th className="text-left pr-2 pb-1 font-body text-stone-500">Jugador</th>
            <th className="px-1 pb-1 text-stone-500">HC</th>
            {holeNumbers.map((h) => (
              <th key={h} className="px-1 pb-1 text-stone-500">{h}</th>
            ))}
            <th className="px-1 pb-1 border-l border-stone-200 text-emerald-700">Gr</th>
            <th className="px-1 pb-1 text-emerald-700">HC</th>
            <th className="px-1 pb-1 text-emerald-700">Net</th>
            <th className="px-1 pb-1 text-emerald-700">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, rowIdx) => {
            const readOnly = readOnlyIds.includes(r.id);
            const cfg = statsConfig[r.id] || {};
            const pStats = playerStats[r.id] || {};
            const enabledStats = STAT_FIELDS.filter((f) => cfg[f]);
            return (
              <React.Fragment key={r.id}>
                {/* Score row */}
                <tr className="border-t border-stone-200">
                  <td className="pr-2 py-1 font-body whitespace-nowrap">
                    {r.name}
                    <LeaderDots id={r.id} medalLeaders={medalLeaders} stfLeaders={stfLeaders} />
                  </td>
                  <td className="px-1 py-1 text-center font-semibold">{r.playingHcp}</td>
                  {holeNumbers.map((h) => {
                    const sc = r.holeScores[h - 1];
                    return (
                      <td key={h} className="px-0.5 py-0.5">
                        {readOnly ? (
                          <div className="w-9 h-10 flex items-center justify-center font-mono text-sm border border-stone-200 rounded bg-stone-50 text-stone-400">
                            {sc || ""}
                          </div>
                        ) : (
                          <button
                            ref={(el) => (inputRefs.current[`score_${h}_${rowIdx}`] = el)}
                            onClick={() => setEditing({ id: r.id, h, name: r.name, par: pars[h - 1], value: sc ?? "" })}
                            style={{ touchAction: "manipulation" }}
                            className={`w-9 h-10 flex items-center justify-center font-mono text-sm cursor-pointer ${holeMarkClass(Number(sc) || 0, pars[h - 1])}`}
                          >
                            {sc || ""}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 py-1 text-center border-l border-stone-200 font-semibold">{r.holesPlayed ? r.gross : "–"}</td>
                  <td className="px-1 py-1 text-center">{r.holesPlayed ? r.hc : "–"}</td>
                  <td className="px-1 py-1 text-center font-semibold">{r.holesPlayed ? r.net : "–"}</td>
                  <td className="px-1 py-1 text-center">{r.holesPlayed ? r.pts : "–"}</td>
                </tr>
                {/* Stats toggle row */}
                {!readOnly && (
                  <tr className="bg-stone-50/60">
                    <td colSpan={2} className="pl-2 py-0.5 text-[10px] text-stone-400 font-body whitespace-nowrap">Stats:</td>
                    <td colSpan={holeNumbers.length + 4} className="py-0.5">
                      <div className="flex gap-1 flex-wrap">
                        {STAT_FIELDS.map((f) => (
                          <button
                            key={f}
                            onClick={() => toggleStatConfig(r.id, f)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${cfg[f] ? "bg-emerald-700 border-emerald-700 text-white" : "bg-white border-stone-300 text-stone-400"}`}
                          >
                            {STAT_LABELS[f]}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
                {/* Enabled stat rows */}
                {enabledStats.map((field) => (
                  <tr key={field} className="bg-stone-50/80">
                    <td className="pr-1 py-0.5 text-stone-400 text-right text-[10px] whitespace-nowrap font-body">{STAT_LABELS[field]}</td>
                    <td />
                    {holeNumbers.map((h) => {
                      const val = pStats[h]?.[field];
                      if (field === "fw") {
                        const isPar3 = Number(pars[h - 1]) === 3;
                        return (
                          <td key={h} className="px-0.5 py-0.5 text-center">
                            <select
                              ref={(el) => (inputRefs.current[`fw_${h}_${r.id}`] = el)}
                              value={val === true ? "fw" : val === false ? "no" : ""}
                              onChange={(e) => {
                                setStatForPlayer(r.id, h, "fw", e.target.value === "fw" ? true : e.target.value === "no" ? false : null);
                                const nextStat = getNextEnabledStat(r.id, "fw");
                                setTimeout(() => {
                                  if (nextStat) focusRef(`${nextStat}_${h}_${r.id}`);
                                  else if (rowIdx < rows.length - 1) focusRef(`score_${h}_${rowIdx + 1}`);
                                }, 50);
                              }}
                              onKeyDown={(e) => handleStatKey(e, h, "fw", r.id, rowIdx)}
                              title={isPar3 ? "Par 3: GR = llegué al green en 1 golpe" : "Fairway hit"}
                              className={`w-10 h-6 rounded text-[10px] font-bold border text-center ${val === true ? "bg-emerald-100 border-emerald-500 text-emerald-700" : val === false ? "bg-rose-100 border-rose-500 text-rose-700" : "bg-white border-stone-300 text-stone-400"}`}
                            >
                              <option value="">–</option>
                              <option value="fw">{isPar3 ? "GR" : "FW"}</option>
                              <option value="no">NO</option>
                            </select>
                          </td>
                        );
                      }
                      const colorCls = field === "ob" ? "border-rose-300 bg-rose-50 text-rose-700" : field === "lago" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-stone-300 bg-white";
                      return (
                        <td key={h} className="px-0.5 py-0.5">
                          <input
                            ref={(el) => (inputRefs.current[`${field}_${h}_${r.id}`] = el)}
                            value={val ?? ""}
                            onChange={(e) => setStatForPlayer(r.id, h, field, e.target.value)}
                            onKeyDown={(e) => handleStatKey(e, h, field, r.id, rowIdx)}
                            type="number" placeholder="0"
                            className={`w-8 h-6 text-center border rounded text-[10px] ${colorCls}`}
                          />
                        </td>
                      );
                    })}
                    <td colSpan={4} />
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-stone-500 font-body mt-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600 align-middle mr-1" />líder Medal ·{" "}
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 align-middle mr-1 ml-2" />líder Stableford
      </p>
      <p className="text-xs text-stone-400 font-body mt-0.5">Stats: activa los campos que quieras registrar para cada jugador (desactivados por defecto).</p>
      {editing && (
        <ScoreModal
          hole={editing.h}
          par={editing.par}
          playerName={editing.name}
          value={editing.value}
          onDone={(val) => {
            if (val !== null) {
              setScore(editing.id, editing.h - 1, val);
              const nextH = editing.h + 1;
              if (holeNumbers.includes(nextH)) {
                setEditing({ ...editing, h: nextH, par: pars[nextH - 1], value: scores[editing.id]?.[nextH - 1] ?? "" });
                return;
              }
            }
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AccumulatedScorecard({ selectedIds, players, scores, handicaps, roundHcpPct, pars, siArr }) {
  const all18 = Array.from({ length: 18 }, (_, i) => i + 1);
  const rows = selectedIds.map((id) => {
    const player = players.find((p) => p.id === id);
    const rawHcp = Number(handicaps[id]) || 0;
    const playingHcp = Math.round((rawHcp * (Number(roundHcpPct) || 100)) / 100);
    const holeScores = scores[id] || Array(18).fill("");
    const stats = computeHalfStats(all18, holeScores, playingHcp, pars, siArr);
    return { id, name: player?.name || "", ...stats };
  });
  const sorted = [...rows].sort((a, b) => (b.holesPlayed === 0) - (a.holesPlayed === 0) || a.net - b.net);
  const playedAny = rows.some((r) => r.holesPlayed > 0);
  const { medalLeaders, stfLeaders } = getLeaders(rows);

  return (
    <div className="bg-emerald-50 rounded-xl border border-emerald-900/15 p-3">
      <h3 className="font-display text-emerald-900 text-sm mb-2 uppercase tracking-wide">Acumulado de las 2 vueltas (18 hoyos)</h3>
      {!playedAny ? (
        <p className="text-xs text-stone-500 font-body">Aún no hay scores capturados.</p>
      ) : (
        <>
          <table className="w-full font-mono text-xs border-collapse">
            <thead>
              <tr className="text-stone-500 font-body">
                <th className="text-left pb-1">#</th>
                <th className="text-left pb-1">Jugador</th>
                <th className="pb-1">Hoyos</th>
                <th className="pb-1">Gr</th>
                <th className="pb-1">HC</th>
                <th className="pb-1">Net</th>
                <th className="pb-1">Pts</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.id} className="border-t border-emerald-900/10">
                  <td className="py-1">{r.holesPlayed > 0 ? i + 1 : "–"}</td>
                  <td className="py-1 font-body">
                    {r.name}
                    <LeaderDots id={r.id} medalLeaders={medalLeaders} stfLeaders={stfLeaders} />
                  </td>
                  <td className="py-1 text-center">{r.holesPlayed}/18</td>
                  <td className="py-1 text-center">{r.holesPlayed ? r.gross : "–"}</td>
                  <td className="py-1 text-center">{r.holesPlayed ? r.hc : "–"}</td>
                  <td className="py-1 text-center font-semibold">{r.holesPlayed ? r.net : "–"}</td>
                  <td className="py-1 text-center">{r.holesPlayed ? r.pts : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-stone-500 font-body mt-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600 align-middle mr-1" />líder Medal ·{" "}
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 align-middle mr-1 ml-2" />líder Stableford (puede haber empate)
          </p>
        </>
      )}
      <p className="text-xs text-stone-500 font-body mt-1">Se actualiza automáticamente conforme capturas scores en ambas vueltas.</p>
    </div>
  );
}

// ---------- Scorecard Summary (per round: gross/net/pts per 9 + total, name + ventajas) ----------
function ScorecardSummary({ participants, pars, siArr, v1, v2 }) {
  const [showVentajas, setShowVentajas] = useState(false);
  if (!participants?.length || !pars?.length || !siArr?.length) return null;
  const sorted = [...participants].sort((a, b) => a.netMedal - b.netMedal);

  return (
    <div className="bg-white/70 rounded-xl border border-emerald-900/10 p-3 overflow-x-auto">
      <h3 className="font-display text-emerald-900 text-sm mb-2 uppercase tracking-wide">Tarjeta resumen de la ronda</h3>
      <table className="font-mono text-xs border-collapse min-w-full">
        <thead>
          <tr className="text-stone-500 font-body">
            <th rowSpan={2} className="text-left pb-1 pr-2 align-bottom">Jugador</th>
            <th rowSpan={2} className="px-1 pb-1 align-bottom">HCP</th>
            <th colSpan={3} className="px-1 pb-0.5 text-emerald-700 border-l border-stone-200">1ª vuelta (hoyos {v1[0]}-{v1[v1.length - 1]})</th>
            <th colSpan={3} className="px-1 pb-0.5 text-amber-700 border-l border-stone-200">2ª vuelta (hoyos {v2[0]}-{v2[v2.length - 1]})</th>
            <th colSpan={3} className="px-1 pb-0.5 border-l border-stone-200">Total 18</th>
          </tr>
          <tr className="text-stone-400 font-body">
            <th className="px-1 border-l border-stone-200">Gr</th>
            <th className="px-1">Net</th>
            <th className="px-1">Pts</th>
            <th className="px-1 border-l border-stone-200">Gr</th>
            <th className="px-1">Net</th>
            <th className="px-1">Pts</th>
            <th className="px-1 border-l border-stone-200">Gr</th>
            <th className="px-1">Net</th>
            <th className="px-1">Pts</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.playerId} className="border-t border-stone-200">
              <td className="pr-2 py-1 font-body whitespace-nowrap">{p.name}</td>
              <td className="px-1 py-1 text-center">{p.handicap}</td>
              <td className="px-1 py-1 text-center border-l border-stone-200">{p.grossVuelta1}</td>
              <td className="px-1 py-1 text-center">{p.netVuelta1}</td>
              <td className="px-1 py-1 text-center">{p.ptsVuelta1}</td>
              <td className="px-1 py-1 text-center border-l border-stone-200">{p.grossVuelta2}</td>
              <td className="px-1 py-1 text-center">{p.netVuelta2}</td>
              <td className="px-1 py-1 text-center">{p.ptsVuelta2}</td>
              <td className="px-1 py-1 text-center border-l border-stone-200 font-semibold">{p.grossTotal}</td>
              <td className="px-1 py-1 text-center font-semibold">{p.netMedal}</td>
              <td className="px-1 py-1 text-center font-semibold">{p.stablefordPoints}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <button onClick={() => setShowVentajas((s) => !s)} className="mt-3 text-xs font-body text-emerald-800 underline">
        {showVentajas ? "Ocultar" : "Ver"} ventajas por hoyo de cada jugador
      </button>
      {showVentajas && (
        <table className="font-mono text-xs border-collapse mt-2 min-w-full">
          <thead>
            <tr className="text-stone-500 font-body">
              <th className="text-left pr-2 pb-1">Jugador</th>
              {Array.from({ length: 18 }).map((_, i) => (
                <th key={i} className={`px-1 pb-1 ${v1.includes(i + 1) ? "text-emerald-700" : "text-amber-700"}`}>{i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.playerId} className="border-t border-stone-200">
                <td className="pr-2 py-1 font-body whitespace-nowrap">{p.name}</td>
                {siArr.map((si, i) => (
                  <td key={i} className="px-1 py-1 text-center">{strokesOnHole(p.handicap, si) || ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function HistoryTab({ rounds, onDelete, groupCode, syncing, onSync }) {
  const [openId, setOpenId] = useState(null);
  return (
    <div className="space-y-3">
      {groupCode && (
        <div className="flex items-center justify-between bg-white/70 rounded-xl border border-emerald-900/10 px-4 py-2">
          <p className="font-body text-sm text-stone-600">Grupo: <b className="font-mono">{groupCode}</b></p>
          <button onClick={onSync} disabled={syncing} className="px-3 py-1 rounded-lg bg-emerald-800 text-amber-50 text-xs font-body disabled:opacity-50">
            {syncing ? "Sincronizando…" : "⟳ Sincronizar con el grupo"}
          </button>
        </div>
      )}
      {rounds.length === 0 && (
        <div className="bg-white/70 rounded-xl p-6 border border-emerald-900/10 text-center">
          <p className="text-stone-500 font-body text-sm mb-1">Aún no hay rondas guardadas.</p>
          <p className="text-stone-400 font-body text-xs">Cuando calcules y guardes una ronda en "Nueva ronda", aparecerá aquí.</p>
        </div>
      )}
      {rounds.map((r) => {
        const participants = r.participants || [];
        const settlement = r.settlement || {};
        const isOpen = openId === r.id;
        return (
          <div key={r.id} className="bg-white/70 rounded-xl border border-emerald-900/10 overflow-hidden">
            <button onClick={() => setOpenId(isOpen ? null : r.id)} className="w-full flex justify-between items-center px-4 py-3 text-left">
              <div>
                <p className="font-display text-emerald-900">{r.date} · {r.courseName || "Sin campo"}</p>
                <p className="font-body text-xs text-stone-500">
                  {participants.length} jugadores · ${r.bet || 0}/persona · Salida hoyo {r.salida || 1}
                  {r.sharedCode && <span className="ml-2 text-emerald-600">· Ronda compartida</span>}
                </p>
              </div>
              <span className="font-body text-sm text-emerald-700">{isOpen ? "Cerrar ▲" : "Ver ▼"}</span>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 space-y-3">
                {r.pars && r.si && r.v1 && r.v2 && (
                  <ScorecardSummary participants={participants} pars={r.pars} siArr={r.si} v1={r.v1} v2={r.v2} />
                )}
                <div className="font-mono text-sm space-y-1">
                  {[...participants]
                    .sort((a, b) => (a.netMedal || 0) - (b.netMedal || 0))
                    .map((p) => (
                      <div key={p.playerId} className="flex justify-between border-t border-stone-200 pt-1 flex-wrap gap-1">
                        <span className="font-body font-semibold">{p.name}</span>
                        <span className="text-stone-500 text-xs">HCP {p.rawHandicap ?? p.handicap}</span>
                        <span>Net {p.netMedal} · {p.stablefordPoints} pts</span>
                        <Money value={settlement[p.playerId]?.total} />
                      </div>
                    ))}
                </div>
                <button onClick={() => onDelete(r.id)} className="text-rose-700 font-body text-xs underline">Eliminar ronda</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Standings Tab ----------
function StandingsTab({ rounds }) {
  const standings = useMemo(() => {
    const map = {};
    rounds.forEach((r) => {
      r.participants.forEach((p) => {
        if (!map[p.playerId]) {
          map[p.playerId] = { name: p.name, rounds: 0, medalWins: 0, stablefordWins: 0, money: 0, netSum: 0, ptsSum: 0, grossSum: 0 };
        }
        const m = map[p.playerId];
        m.rounds += 1;
        m.netSum += p.netMedal;
        m.ptsSum += p.stablefordPoints;
        m.grossSum += p.grossTotal;
        m.money += r.settlement[p.playerId]?.total || 0;
        if (r.winners?.medalOverall?.includes(p.playerId)) m.medalWins += 1;
        if (r.winners?.stablefordOverall?.includes(p.playerId)) m.stablefordWins += 1;
      });
    });
    return Object.values(map).sort((a, b) => b.money - a.money);
  }, [rounds]);

  if (standings.length === 0) return <p className="text-stone-500 font-body text-sm">Guarda al menos una ronda para ver el acumulado.</p>;

  return (
    <div className="space-y-3">
      {standings.map((s) => (
        <div key={s.name} className="bg-white/70 rounded-xl border border-emerald-900/10 p-4">
          <div className="flex justify-between items-baseline">
            <h3 className="font-display text-emerald-900 text-lg">{s.name}</h3>
            <Money value={s.money} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-body text-xs text-stone-600 mt-2">
            <span>Rondas jugadas: <b className="font-mono">{s.rounds}</b></span>
            <span>Gross acumulado: <b className="font-mono">{s.grossSum}</b></span>
            <span>Net acumulado: <b className="font-mono">{s.netSum}</b></span>
            <span>Pts Stableford acumulados: <b className="font-mono">{s.ptsSum}</b></span>
            <span>Net promedio: <b className="font-mono">{(s.netSum / s.rounds).toFixed(1)}</b></span>
            <span>Pts promedio: <b className="font-mono">{(s.ptsSum / s.rounds).toFixed(1)}</b></span>
            <span>Victorias Medal general: <b className="font-mono">{s.medalWins}</b></span>
            <span>Victorias Stableford general: <b className="font-mono">{s.stablefordWins}</b></span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- My Stats Tab ----------
function MyStatsTab({ rounds }) {
  const [openId, setOpenId] = useState(null);
  const [filterPlayer, setFilterPlayer] = useState("all");

  // Collect all rounds that have per-player stats
  const statsRounds = rounds.filter((r) => r.playerStats && Object.keys(r.playerStats).length > 0);

  // Build player list from all rounds
  const playerMap = {};
  statsRounds.forEach((r) => {
    Object.keys(r.playerStats).forEach((pid) => {
      const p = r.participants?.find((x) => x.playerId === pid);
      if (p) playerMap[pid] = p.name;
    });
  });

  const filtered = filterPlayer === "all"
    ? statsRounds
    : statsRounds.filter((r) => r.playerStats[filterPlayer]);

  if (statsRounds.length === 0) {
    return <p className="text-stone-500 font-body text-sm">Aún no hay datos estadísticos. Activa los campos de stats en la tarjeta de algún jugador durante una ronda.</p>;
  }

  // Aggregate totals per player across rounds
  const playerTotals = {};
  statsRounds.forEach((r) => {
    Object.entries(r.playerStats).forEach(([pid, hs]) => {
      if (!playerTotals[pid]) playerTotals[pid] = { name: playerMap[pid] || pid, rounds: 0, fwHit: 0, fwTotal: 0, ob: 0, lago: 0, putts: 0, puttsHoles: 0 };
      const t = playerTotals[pid];
      t.rounds += 1;
      for (let h = 1; h <= 18; h++) {
        const s = hs[h] || {};
        if (s.fw === true) { t.fwHit += 1; t.fwTotal += 1; }
        else if (s.fw === false) t.fwTotal += 1;
        t.ob += Number(s.ob) || 0;
        t.lago += Number(s.lago) || 0;
        if (s.putts !== "" && s.putts !== undefined) { t.putts += Number(s.putts) || 0; t.puttsHoles += 1; }
      }
    });
  });

  return (
    <div className="space-y-4">
      <section className="bg-emerald-950 text-amber-50 rounded-xl p-4 space-y-3">
        <h2 className="font-display text-lg uppercase">Resumen histórico por jugador</h2>
        {Object.values(playerTotals).map((t) => (
          <div key={t.name} className="border-t border-emerald-800 pt-2">
            <p className="font-display text-amber-400">{t.name} <span className="font-body text-xs text-emerald-300">({t.rounds} rondas)</span></p>
            <div className="grid grid-cols-2 gap-x-4 font-body text-sm mt-1">
              {t.fwTotal > 0 && <span>FW/Green: <b className="font-mono">{t.fwHit}/{t.fwTotal} ({Math.round(t.fwHit/t.fwTotal*100)}%)</b></span>}
              {t.ob > 0 && <span>OB: <b className="font-mono text-rose-400">{t.ob}</b></span>}
              {t.lago > 0 && <span>Lago: <b className="font-mono text-sky-400">{t.lago}</b></span>}
              {t.puttsHoles > 0 && <span>Putts prom: <b className="font-mono">{(t.putts/t.puttsHoles).toFixed(1)}</b></span>}
            </div>
          </div>
        ))}
      </section>

      <div className="flex gap-2 flex-wrap items-center">
        <span className="font-body text-sm text-stone-600">Ver rondas de:</span>
        <select value={filterPlayer} onChange={(e) => setFilterPlayer(e.target.value)} className="px-2 py-1 rounded-md border border-stone-300 bg-white font-body text-sm">
          <option value="all">Todos</option>
          {Object.entries(playerMap).map(([pid, name]) => (
            <option key={pid} value={pid}>{name}</option>
          ))}
        </select>
      </div>

      {filtered.map((r) => {
        const isOpen = openId === r.id;
        const activePids = Object.keys(r.playerStats);
        return (
          <div key={r.id} className="bg-white/70 rounded-xl border border-emerald-900/10 overflow-hidden">
            <button onClick={() => setOpenId(isOpen ? null : r.id)} className="w-full flex justify-between items-center px-4 py-3 text-left">
              <div>
                <p className="font-display text-emerald-900">{r.date} · {r.courseName}</p>
                <p className="font-body text-xs text-stone-500">{activePids.map((pid) => playerMap[pid] || pid).join(", ")}</p>
              </div>
              <span className="font-body text-sm text-emerald-700">{isOpen ? "Ocultar" : "Ver"}</span>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 space-y-4">
                {activePids.map((pid) => {
                  const hs = r.playerStats[pid] || {};
                  const player = r.participants?.find((p) => p.playerId === pid);
                  const fwHit = Object.values(hs).filter((s) => s.fw === true).length;
                  const fwTotal = Object.values(hs).filter((s) => s.fw !== null && s.fw !== undefined).length;
                  const ob = Object.values(hs).reduce((a, s) => a + (Number(s.ob) || 0), 0);
                  const lago = Object.values(hs).reduce((a, s) => a + (Number(s.lago) || 0), 0);
                  const putts = Object.values(hs).reduce((a, s) => a + (Number(s.putts) || 0), 0);
                  const hasFw = Object.values(hs).some((s) => s.fw !== undefined);
                  const hasOb = Object.values(hs).some((s) => s.ob);
                  const hasLago = Object.values(hs).some((s) => s.lago);
                  const hasPutts = Object.values(hs).some((s) => s.putts !== undefined && s.putts !== "");
                  return (
                    <div key={pid}>
                      <p className="font-display text-emerald-900 text-sm mb-1">{player?.name || playerMap[pid]}</p>
                      <div className="overflow-x-auto">
                        <table className="font-mono text-[10px] border-collapse min-w-full">
                          <thead>
                            <tr className="text-stone-400 font-body">
                              <th className="text-left pr-2 pb-1">Campo</th>
                              {Array.from({length:18},(_,i)=><th key={i} className="px-1">{i+1}</th>)}
                              <th className="px-1 border-l border-stone-200">Tot</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t border-stone-200">
                              <td className="pr-2 py-1 font-body text-stone-600">Score</td>
                              {Array.from({length:18},(_,i)=>{
                                const g = player?.scores?.[i];
                                const par = r.pars?.[i];
                                return <td key={i} className={`px-1 py-1 text-center ${holeMarkClass(Number(g)||0,par)}`}>{g||"–"}</td>;
                              })}
                              <td className="px-1 py-1 text-center border-l border-stone-200 font-semibold">{player?.grossTotal||"–"}</td>
                            </tr>
                            {hasFw && <tr className="border-t border-stone-100 bg-emerald-50/50">
                              <td className="pr-2 py-1 font-body text-stone-600">FW/Gr</td>
                              {Array.from({length:18},(_,i)=>{
                                const fw = hs[i+1]?.fw;
                                const par = r.pars?.[i];
                                return <td key={i} className="px-1 py-1 text-center text-[10px]">
                                  {fw===true?<span className="text-emerald-600 font-bold">{Number(par)===3?"GR":"FW"}</span>:fw===false?<span className="text-rose-600 font-bold">NO</span>:<span className="text-stone-300">–</span>}
                                </td>;
                              })}
                              <td className="px-1 py-1 text-center border-l font-bold text-emerald-700">{fwHit}/{fwTotal}</td>
                            </tr>}
                            {hasOb && <tr className="border-t border-stone-100 bg-rose-50/40">
                              <td className="pr-2 py-1 font-body text-stone-600">OB</td>
                              {Array.from({length:18},(_,i)=><td key={i} className="px-1 py-1 text-center text-rose-600">{hs[i+1]?.ob||<span className="text-stone-200">–</span>}</td>)}
                              <td className="px-1 py-1 text-center border-l font-bold text-rose-700">{ob||"–"}</td>
                            </tr>}
                            {hasLago && <tr className="border-t border-stone-100 bg-sky-50/40">
                              <td className="pr-2 py-1 font-body text-stone-600">Lago</td>
                              {Array.from({length:18},(_,i)=><td key={i} className="px-1 py-1 text-center text-sky-600">{hs[i+1]?.lago||<span className="text-stone-200">–</span>}</td>)}
                              <td className="px-1 py-1 text-center border-l font-bold text-sky-700">{lago||"–"}</td>
                            </tr>}
                            {hasPutts && <tr className="border-t border-stone-100 bg-stone-50/80">
                              <td className="pr-2 py-1 font-body text-stone-600">Putts</td>
                              {Array.from({length:18},(_,i)=><td key={i} className="px-1 py-1 text-center">{hs[i+1]?.putts!==""&&hs[i+1]?.putts!==undefined?hs[i+1].putts:<span className="text-stone-200">–</span>}</td>)}
                              <td className="px-1 py-1 text-center border-l font-bold">{putts||"–"}</td>
                            </tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
