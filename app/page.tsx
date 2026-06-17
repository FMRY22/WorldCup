"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  doc, getDoc, setDoc, onSnapshot, serverTimestamp,
} from "firebase/firestore";
import { db, isFirebaseConfigured, ROOM_ID } from "@/lib/firebase";
import { ALL_MATCHES, STAGE_LABELS, type Match } from "@/lib/matches";
import { PARTICIPANTS } from "@/lib/config";
import { matchesArabicName } from "@/lib/teamMap";
import { calcPoints, calcUserScore, type Prediction, type ActualResult } from "@/lib/scoring";

type UserPredictions = Record<string, Prediction>;
type AllPredictions = Record<string, UserPredictions>;
type AllResults = Record<string, ActualResult>;
type View = "select" | "predictions" | "leaderboard" | "admin";

// ─── Storage helpers ────────────────────────────────────────────────────────

const LOCAL_PREDS_KEY = "wc2026_preds";
const LOCAL_USER_KEY = "wc2026_user";

const loadLocalAll = (): AllPredictions => {
  try { return JSON.parse(localStorage.getItem(LOCAL_PREDS_KEY) || "{}"); } catch { return {}; }
};
const saveLocalAll = (all: AllPredictions) =>
  localStorage.setItem(LOCAL_PREDS_KEY, JSON.stringify(all));

// ─── ESPN result parser ──────────────────────────────────────────────────────

interface EspnEvent {
  id: string;
  date: string;
  status: { type: { completed: boolean; state: string; description: string } };
  competitions: Array<{
    competitors: Array<{
      homeAway: "home" | "away";
      team: { displayName: string; shortDisplayName: string };
      score: string;
    }>;
  }>;
}

function parseEspnEvents(events: EspnEvent[]): AllResults {
  const results: AllResults = {};

  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors.find(c => c.homeAway === "home");
    const away = comp.competitors.find(c => c.homeAway === "away");
    if (!home || !away) continue;

    const homeScore = parseInt(home.score ?? "");
    const awayScore = parseInt(away.score ?? "");
    const completed = event.status.type.completed;
    const live = event.status.type.state === "in";

    // Try to match our local match
    const match = ALL_MATCHES.find(m => {
      const t1matchHome = matchesArabicName(m.team1, home.team.displayName) ||
                          matchesArabicName(m.team1, home.team.shortDisplayName);
      const t2matchAway = matchesArabicName(m.team2, away.team.displayName) ||
                          matchesArabicName(m.team2, away.team.shortDisplayName);
      const t1matchAway = matchesArabicName(m.team1, away.team.displayName) ||
                          matchesArabicName(m.team1, away.team.shortDisplayName);
      const t2matchHome = matchesArabicName(m.team2, home.team.displayName) ||
                          matchesArabicName(m.team2, home.team.shortDisplayName);
      return (t1matchHome && t2matchAway) || (t1matchAway && t2matchHome);
    });

    if (match) {
      const isHomeTeam1 = matchesArabicName(match.team1, home.team.displayName) ||
                          matchesArabicName(match.team1, home.team.shortDisplayName);
      results[match.id] = {
        t1: isHomeTeam1 ? homeScore : awayScore,
        t2: isHomeTeam1 ? awayScore : homeScore,
        completed,
        live,
      };
    }
  }
  return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("ar-SA", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function isMatchLocked(match: Match, results: AllResults): boolean {
  if (results[match.id]?.completed || results[match.id]?.live) return true;
  const matchTime = new Date(`${match.date}T${match.time}:00`);
  return Date.now() > matchTime.getTime();
}

function getSections(matches: Match[]) {
  const groups: Record<string, Match[]> = {};
  const knockouts: Record<string, Match[]> = {};
  for (const m of matches) {
    if (m.stage === "group") {
      if (!groups[m.group!]) groups[m.group!] = [];
      groups[m.group!].push(m);
    } else {
      if (!knockouts[m.stage]) knockouts[m.stage] = [];
      knockouts[m.stage].push(m);
    }
  }
  const sections: { key: string; label: string; matches: Match[] }[] = [];
  for (const [g, ms] of Object.entries(groups))
    sections.push({ key: `g-${g}`, label: ms[0].groupName || g, matches: ms });
  for (const s of ["r32", "r16", "qf", "sf", "third", "final"])
    if (knockouts[s]) sections.push({ key: s, label: STAGE_LABELS[s], matches: knockouts[s] });
  return sections;
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<View>("select");
  const [user, setUser] = useState("");
  const [myPreds, setMyPreds] = useState<UserPredictions>({});
  const [allPreds, setAllPreds] = useState<AllPredictions>({});
  const [results, setResults] = useState<AllResults>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [espnStatus, setEspnStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [adminKey] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("admin") || ""
      : ""
  );
  const fetchRef = useRef(false);

  // Init from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_USER_KEY);
    if (saved) {
      setUser(saved);
      const all = loadLocalAll();
      setMyPreds(all[saved] || {});
      setAllPreds(all);
      setView("predictions");
    }
  }, []);

  // Firebase listener
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return;
    const ref = doc(db, "rooms", ROOM_ID);
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.predictions) setAllPreds(data.predictions);
      if (data.results) setResults(data.results);
    });
  }, []);

  // ESPN fetch (every 3 min)
  const fetchEspn = useCallback(async () => {
    if (fetchRef.current) return;
    fetchRef.current = true;
    setEspnStatus("loading");
    try {
      const r = await fetch("/api/espn");
      if (!r.ok) throw new Error();
      const data = await r.json();
      const parsed = parseEspnEvents(data.events || []);
      if (Object.keys(parsed).length > 0) {
        setResults(prev => ({ ...prev, ...parsed }));
        // Save to Firebase
        if (isFirebaseConfigured && db) {
          const ref = doc(db, "rooms", ROOM_ID);
          await setDoc(ref, { results: parsed, updatedAt: serverTimestamp() }, { merge: true });
        }
        setEspnStatus("ok");
      } else {
        setEspnStatus("err");
      }
    } catch {
      setEspnStatus("err");
    } finally {
      fetchRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchEspn();
    const id = setInterval(fetchEspn, 3 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchEspn]);

  const handleSelectName = (name: string) => {
    setUser(name);
    localStorage.setItem(LOCAL_USER_KEY, name);
    const all = loadLocalAll();
    setMyPreds(all[name] || {});
    setView("predictions");
  };

  const handleScore = (matchId: string, team: "t1" | "t2", val: string) => {
    if (isMatchLocked(ALL_MATCHES.find(m => m.id === matchId)!, results)) return;
    const num = val === "" ? "" : Math.max(0, Math.min(30, parseInt(val) || 0));
    setMyPreds(prev => ({ ...prev, [matchId]: { ...prev[matchId], [team]: num } }));
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const all = loadLocalAll();
    all[user] = myPreds;
    saveLocalAll(all);
    setAllPreds({ ...all });

    if (isFirebaseConfigured && db) {
      try {
        const ref = doc(db, "rooms", ROOM_ID);
        const snap = await getDoc(ref);
        const existing = snap.exists() ? (snap.data().predictions || {}) : {};
        await setDoc(ref, {
          predictions: { ...existing, [user]: myPreds },
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (e) { console.error(e); }
    }

    setSaving(false);
    setSaveMsg("✅ تم الحفظ!");
    setTimeout(() => setSaveMsg(""), 3000);
  };

  const handleAdminSaveResults = async (newResults: AllResults) => {
    setResults(prev => ({ ...prev, ...newResults }));
    if (isFirebaseConfigured && db) {
      await setDoc(doc(db, "rooms", ROOM_ID), { results: newResults }, { merge: true });
    }
  };

  const sections = getSections(ALL_MATCHES);
  const completedCount = Object.values(results).filter(r => r.completed).length;

  if (view === "select") return <NameSelector onSelect={handleSelectName} />;

  if (view === "leaderboard")
    return (
      <LeaderboardView
        allPreds={allPreds}
        results={results}
        currentUser={user}
        onBack={() => setView("predictions")}
      />
    );

  if (view === "admin" && adminKey === (process.env.NEXT_PUBLIC_ADMIN_KEY || "admin2026"))
    return (
      <AdminView
        results={results}
        onSave={handleAdminSaveResults}
        onBack={() => setView("predictions")}
      />
    );

  return (
    <div className="min-h-screen pitch-lines">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-pitch-dark/95 backdrop-blur border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xl">⚽</span>
            <div className="min-w-0">
              <h1 className="font-black text-base text-yellow-400 leading-none">كأس العالم 2026</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-white/40">{completedCount} مباراة مكتملة</span>
                {espnStatus === "loading" && <span className="text-xs text-blue-400 animate-pulse">🔄 تحديث...</span>}
                {espnStatus === "ok" && <span className="text-xs text-green-400">🟢 محدّث</span>}
                {espnStatus === "err" && (
                  <button onClick={fetchEspn} className="text-xs text-orange-400 underline">⚠️ إعادة</button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setView("leaderboard")} className="btn-outline text-xs px-3 py-2">
              🏆 النقاط
            </button>
            <button
              onClick={() => { localStorage.removeItem(LOCAL_USER_KEY); setView("select"); }}
              className="text-xs text-white/40 hover:text-white/70 px-2 py-2 transition"
            >
              👤 {user}
            </button>
          </div>
        </div>
        {saveMsg && (
          <div className="bg-green-600/80 text-center text-xs py-1 font-bold">{saveMsg}</div>
        )}
      </header>

      {/* Save button */}
      <div className="sticky top-[61px] z-40 max-w-2xl mx-auto px-4 pt-3">
        <button onClick={handleSave} disabled={saving} className="btn-gold w-full text-base pulse-gold">
          {saving ? "⏳ جارٍ الحفظ..." : "💾 حفظ التوقعات"}
        </button>
      </div>

      {/* Section tabs */}
      <div className="max-w-2xl mx-auto px-4 pt-3">
        <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
          {sections.map(s => (
            <button
              key={s.key}
              onClick={() => document.getElementById(s.key)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full border border-white/20 text-white/60 hover:border-yellow-500/50 hover:text-yellow-400 transition"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Matches */}
      <main className="max-w-2xl mx-auto px-4 pb-24 pt-3 space-y-6">
        {sections.map(section => (
          <div key={section.key} id={section.key}>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-yellow-400 font-bold text-sm">{section.label}</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>
            <div className="space-y-2">
              {section.matches.map(match => (
                <MatchCard
                  key={match.id}
                  match={match}
                  pred={myPreds[match.id]}
                  actual={results[match.id]}
                  locked={isMatchLocked(match, results)}
                  onChange={(team, val) => handleScore(match.id, team, val)}
                />
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}

// ─── NameSelector ─────────────────────────────────────────────────────────────

function NameSelector({ onSelect }: { onSelect: (n: string) => void }) {
  return (
    <div className="min-h-screen pitch-lines flex flex-col items-center justify-center p-6">
      <div className="text-7xl mb-4 animate-bounce">🏆</div>
      <h1 className="text-3xl font-black text-yellow-400 mb-1 text-center">كأس العالم 2026</h1>
      <p className="text-white/50 mb-8 text-center text-sm">توقع النتائج وتنافس مع أصدقائك</p>
      <div className="w-full max-w-sm card-glass p-5">
        <h2 className="text-lg font-bold text-center mb-4 text-white/90">اختر اسمك</h2>
        <div className="grid grid-cols-2 gap-2">
          {PARTICIPANTS.map(name => (
            <button
              key={name}
              onClick={() => onSelect(name)}
              className="bg-white/5 hover:bg-yellow-500/20 border border-white/10 hover:border-yellow-400/50
                         rounded-xl py-3 px-3 text-sm font-bold transition-all active:scale-95
                         text-white hover:text-yellow-300"
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      {!isFirebaseConfigured && (
        <div className="mt-5 max-w-sm w-full bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 text-xs text-orange-300">
          ⚠️ وضع تجريبي — التوقعات محفوظة على جهازك فقط. أضف إعدادات Firebase لمشاركة الجميع.
        </div>
      )}
    </div>
  );
}

// ─── MatchCard ────────────────────────────────────────────────────────────────

function MatchCard({
  match, pred, actual, locked, onChange,
}: {
  match: Match;
  pred?: Prediction;
  actual?: ActualResult;
  locked: boolean;
  onChange: (team: "t1" | "t2", val: string) => void;
}) {
  const hasPred = pred?.t1 !== "" && pred?.t1 != null;
  let scoreResult: ReturnType<typeof calcPoints> | null = null;
  if (actual?.completed && hasPred) {
    scoreResult = calcPoints(pred!, actual);
  }

  const borderClass = scoreResult
    ? scoreResult.kind === "exact" ? "border-yellow-400/60"
      : scoreResult.kind === "result" ? "border-green-500/50"
      : "border-red-500/30"
    : hasPred ? "border-blue-500/30"
    : "";

  return (
    <div className={`card-glass p-3.5 transition-all ${borderClass}`}>
      {/* Top row */}
      <div className="flex items-center justify-between mb-2.5 text-xs text-white/35">
        <span>{fmt(match.date)} {match.time}</span>
        <div className="flex items-center gap-2">
          {actual?.live && <span className="text-red-400 font-bold animate-pulse">🔴 مباشر</span>}
          {actual?.completed && !actual?.live && <span className="text-green-400">✅ انتهت</span>}
          {locked && !actual?.completed && !actual?.live && <span className="text-orange-400">🔒 مقفل</span>}
          {scoreResult && (
            <span className={`font-bold px-2 py-0.5 rounded text-xs ${
              scoreResult.kind === "exact" ? "bg-yellow-500/30 text-yellow-300" :
              scoreResult.kind === "result" ? "bg-green-500/20 text-green-400" :
              "bg-red-500/20 text-red-400"
            }`}>
              {scoreResult.kind === "exact" ? "⭐ +3" : scoreResult.kind === "result" ? "✓ +1" : "✗ 0"}
            </span>
          )}
        </div>
      </div>

      {/* Match row */}
      <div className="flex items-center gap-2">
        {/* Team 1 */}
        <div className="flex-1 text-center">
          <div className="text-2xl mb-0.5">{match.flag1}</div>
          <div className="text-xs font-bold leading-tight">{match.team1}</div>
        </div>

        {/* Scores: prediction + actual */}
        <div className="flex flex-col items-center gap-1">
          {/* Actual score (if available) */}
          {actual && (actual.completed || actual.live) && (
            <div className={`flex items-center gap-1 px-3 py-1 rounded-lg font-black text-base ${
              actual.live ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white"
            }`}>
              <span>{isNaN(actual.t1) ? "?" : actual.t1}</span>
              <span className="text-white/30 text-sm">:</span>
              <span>{isNaN(actual.t2) ? "?" : actual.t2}</span>
            </div>
          )}
          {/* Prediction inputs */}
          <div className="flex items-center gap-1.5">
            <input
              type="number" min="0" max="30"
              value={pred?.t1 ?? ""}
              onChange={e => onChange("t1", e.target.value)}
              placeholder="-"
              disabled={locked}
              className={`score-input ${locked ? "opacity-40 cursor-not-allowed" : ""}`}
            />
            <span className="text-white/20 font-bold">:</span>
            <input
              type="number" min="0" max="30"
              value={pred?.t2 ?? ""}
              onChange={e => onChange("t2", e.target.value)}
              placeholder="-"
              disabled={locked}
              className={`score-input ${locked ? "opacity-40 cursor-not-allowed" : ""}`}
            />
          </div>
          {!actual?.completed && !actual?.live && (
            <div className="text-[10px] text-white/25">توقعك</div>
          )}
        </div>

        {/* Team 2 */}
        <div className="flex-1 text-center">
          <div className="text-2xl mb-0.5">{match.flag2}</div>
          <div className="text-xs font-bold leading-tight">{match.team2}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function LeaderboardView({
  allPreds, results, currentUser, onBack,
}: {
  allPreds: AllPredictions;
  results: AllResults;
  currentUser: string;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState(currentUser);

  const users = Object.keys(allPreds).sort();
  const scored = users
    .map(u => ({ user: u, ...calcUserScore(allPreds[u] || {}, results) }))
    .sort((a, b) => b.total - a.total || b.exact - a.exact);

  const sections = getSections(ALL_MATCHES);
  const selectedPreds = allPreds[selected] || {};

  return (
    <div className="min-h-screen pitch-lines">
      <header className="sticky top-0 z-50 bg-pitch-dark/95 backdrop-blur border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="text-white/60 hover:text-white text-xl transition">←</button>
          <div>
            <h1 className="font-black text-base text-yellow-400">🏆 جدول النقاط</h1>
            <p className="text-xs text-white/40">{Object.values(results).filter(r => r.completed).length} مباراة مكتملة</p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-24 space-y-5">
        {/* Ranking table */}
        <div className="card-glass overflow-hidden">
          <div className="p-3 border-b border-white/10 flex items-center justify-between">
            <h2 className="font-bold text-yellow-400 text-sm">📊 الترتيب</h2>
            <span className="text-xs text-white/40">3 نقاط = نتيجة دقيقة • 1 نقطة = نتيجة صحيحة</span>
          </div>
          {scored.length === 0 ? (
            <p className="p-6 text-center text-white/40 text-sm">لا يوجد توقعات بعد</p>
          ) : (
            <div className="divide-y divide-white/5">
              {scored.map((s, i) => {
                const isMe = s.user === currentUser;
                const medals = ["🥇", "🥈", "🥉"];
                return (
                  <div
                    key={s.user}
                    onClick={() => setSelected(s.user)}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all hover:bg-white/5 ${
                      selected === s.user ? "bg-yellow-500/10 border-r-2 border-yellow-400" : ""
                    }`}
                  >
                    <span className="text-xl w-8 text-center">{medals[i] || `${i + 1}`}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${isMe ? "text-yellow-300" : "text-white"}`}>
                          {s.user} {isMe && "⭐"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-yellow-400/70">⭐ {s.exact} دقيق</span>
                        <span className="text-xs text-green-400/70">✓ {s.result} صحيح</span>
                        <span className="text-xs text-white/30">✗ {s.missed} فائت</span>
                      </div>
                      {/* Points bar */}
                      <div className="mt-1.5 bg-white/10 rounded-full h-1.5 w-full">
                        <div
                          className="bg-gradient-to-r from-yellow-500 to-yellow-400 h-1.5 rounded-full transition-all"
                          style={{ width: `${Math.min(100, (s.total / Math.max(1, scored[0].total)) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-2xl font-black text-yellow-400">{s.total}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* User picker */}
        <div className="card-glass p-4">
          <h3 className="text-sm text-white/50 mb-3">عرض توقعات:</h3>
          <div className="flex flex-wrap gap-2">
            {users.map(u => (
              <button
                key={u}
                onClick={() => setSelected(u)}
                className={`px-3 py-1.5 rounded-full text-sm font-bold border transition-all ${
                  selected === u
                    ? "bg-yellow-500 border-yellow-500 text-black"
                    : "border-white/20 text-white/70 hover:border-white/40"
                }`}
              >
                {u === currentUser && "⭐ "}{u}
              </button>
            ))}
          </div>
        </div>

        {/* Selected user's predictions */}
        {selected && (
          <div className="space-y-5">
            {sections.map(section => {
              const relevant = section.matches.filter(m => {
                const p = selectedPreds[m.id];
                return p?.t1 !== "" && p?.t1 != null;
              });
              if (relevant.length === 0) return null;
              return (
                <div key={section.key}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-xs text-yellow-400 font-bold">{section.label}</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                  <div className="space-y-1.5">
                    {relevant.map(m => {
                      const p = selectedPreds[m.id];
                      const actual = results[m.id];
                      const pts = actual?.completed ? calcPoints(p, actual) : null;
                      return (
                        <div key={m.id} className="card-glass px-3 py-2 flex items-center gap-2">
                          <div className="text-center w-16">
                            <div className="text-lg">{m.flag1}</div>
                            <div className="text-[10px] text-white/60 leading-tight">{m.team1}</div>
                          </div>
                          <div className="flex-1 text-center">
                            <div className={`font-black text-lg ${
                              pts?.kind === "exact" ? "text-yellow-400" :
                              pts?.kind === "result" ? "text-green-400" :
                              pts?.kind === "none" && actual?.completed ? "text-red-400" : "text-white"
                            }`}>
                              {p.t1} : {p.t2}
                            </div>
                            {actual?.completed && (
                              <div className="text-xs text-white/40">نتيجة: {actual.t1}:{actual.t2}</div>
                            )}
                            {pts && (
                              <div className="text-xs font-bold mt-0.5">
                                {pts.kind === "exact" ? "⭐ +3" : pts.kind === "result" ? "✓ +1" : "✗ 0"}
                              </div>
                            )}
                          </div>
                          <div className="text-center w-16">
                            <div className="text-lg">{m.flag2}</div>
                            <div className="text-[10px] text-white/60 leading-tight">{m.team2}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AdminView ────────────────────────────────────────────────────────────────

function AdminView({
  results, onSave, onBack,
}: {
  results: AllResults;
  onSave: (r: AllResults) => Promise<void>;
  onBack: () => void;
}) {
  const [localResults, setLocalResults] = useState<AllResults>({ ...results });
  const [saving, setSaving] = useState(false);

  const handleSet = (matchId: string, team: "t1" | "t2", val: string) => {
    const num = parseInt(val);
    setLocalResults(prev => ({
      ...prev,
      [matchId]: { ...prev[matchId], [team]: isNaN(num) ? 0 : num, completed: true },
    }));
  };

  const handleComplete = (matchId: string, val: boolean) => {
    setLocalResults(prev => ({
      ...prev,
      [matchId]: { ...(prev[matchId] || { t1: 0, t2: 0 }), completed: val },
    }));
  };

  const save = async () => {
    setSaving(true);
    await onSave(localResults);
    setSaving(false);
  };

  const groupMatches = ALL_MATCHES.filter(m => m.stage === "group");

  return (
    <div className="min-h-screen pitch-lines">
      <header className="sticky top-0 z-50 bg-red-900/90 backdrop-blur border-b border-red-500/30">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="text-white/60 hover:text-white text-xl">←</button>
          <h1 className="font-black text-red-300">🔧 لوحة الإدارة - إدخال النتائج</h1>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-4 pb-24 space-y-3">
        <button onClick={save} disabled={saving} className="btn-gold w-full mb-4">
          {saving ? "⏳ جارٍ الحفظ..." : "💾 حفظ النتائج"}
        </button>
        {groupMatches.map(m => {
          const r = localResults[m.id];
          return (
            <div key={m.id} className="card-glass p-3 flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-white/50 w-16 flex-shrink-0">
                <input
                  type="checkbox"
                  checked={r?.completed || false}
                  onChange={e => handleComplete(m.id, e.target.checked)}
                  className="w-4 h-4"
                />
                مكتمل
              </label>
              <div className="flex-1 text-center text-sm">
                {m.flag1} {m.team1}
              </div>
              <input
                type="number" min="0" max="20"
                value={r?.t1 ?? ""}
                onChange={e => handleSet(m.id, "t1", e.target.value)}
                placeholder="0"
                className="w-12 h-9 text-center text-lg font-bold bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-yellow-400"
              />
              <span className="text-white/30">:</span>
              <input
                type="number" min="0" max="20"
                value={r?.t2 ?? ""}
                onChange={e => handleSet(m.id, "t2", e.target.value)}
                placeholder="0"
                className="w-12 h-9 text-center text-lg font-bold bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-yellow-400"
              />
              <div className="flex-1 text-center text-sm">
                {m.flag2} {m.team2}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
