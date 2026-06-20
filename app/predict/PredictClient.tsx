"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import Link from "next/link";
import { db, isFirebaseConfigured, ROOM_ID } from "@/lib/firebase";
import { ALL_MATCHES, type Match } from "@/lib/matches";
import { calcPoints, type Prediction, type ActualResult } from "@/lib/scoring";
import { PARTICIPANTS } from "@/lib/config";

type MyPredictions = Record<string, Prediction>;
type AllResults    = Record<string, ActualResult>;

interface ScheduleMatch extends Match {
  score?: { home: number; away: number } | null;
  live?: boolean;
  completed?: boolean;
}

function predKey(m: Match) { return `${m.team1}|${m.team2}`; }
function saudiNow() { return Date.now() + 3 * 60 * 60 * 1000; }

function fmtDayLabel(d: string) {
  const now      = saudiNow();
  const today    = new Date(now).toISOString().split("T")[0];
  const tomorrow = new Date(now + 86400000).toISOString().split("T")[0];
  if (d === today)    return "اليوم";
  if (d === tomorrow) return "غداً";
  return new Date(d + "T12:00:00").toLocaleDateString("ar-SA", {
    weekday: "long", day: "numeric", month: "long",
  });
}

function isLocked(match: Match, results: AllResults) {
  if (results[predKey(match)]?.completed || results[predKey(match)]?.live) return true;
  const matchUtcMs = new Date(`${match.date}T${match.time}:00Z`).getTime() - 3 * 60 * 60 * 1000;
  return Date.now() > matchUtcMs;
}

function buildSectionsByDate(matches: Match[]) {
  const byDate: Record<string, Match[]> = {};
  for (const m of matches) {
    (byDate[m.date] ??= []).push(m);
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ms]) => ({
      key: `d-${date}`,
      label: fmtDayLabel(date),
      matches: ms.sort((a, b) => a.time.localeCompare(b.time)),
    }));
}

function lsGet<T>(key: string, fallback: T): T {
  try { const c = localStorage.getItem(key); return c ? JSON.parse(c) : fallback; } catch { return fallback; }
}

export default function PredictClient() {
  // قراءة من localStorage مباشرة في الـ initializer — قبل أي render
  const [user, setUser] = useState<string>(() =>
    localStorage.getItem("wc2026_user") || ""
  );
  const [preds, setPreds] = useState<MyPredictions>(() => {
    const savedUser = localStorage.getItem("wc2026_user") || "";
    if (!savedUser) return {};
    return lsGet<Record<string, MyPredictions>>("wc2026_preds", {})[savedUser] || {};
  });
  const [matches, setMatches] = useState<Match[]>(() => {
    const p = lsGet<Match[]>("wc2026_schedule", []);
    return p.length ? p : ALL_MATCHES;
  });
  const [results,    setResults]    = useState<AllResults>({});
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [predFilter, setPredFilter] = useState<"upcoming"|"done"|"all">("upcoming");
  const fetchRef = useRef(false);

  const loadSchedule = useCallback(async () => {
    if (fetchRef.current) return;
    fetchRef.current = true;
    try {
      const r = await fetch("/api/schedule");
      const data: ScheduleMatch[] = await r.json();
      if (!Array.isArray(data) || !data.length) return;
      setMatches(data);
      try { localStorage.setItem("wc2026_schedule", JSON.stringify(data)); } catch {}
      const extracted: AllResults = {};
      for (const m of data) {
        if (!(m.completed || m.live) || m.score == null) continue;
        extracted[predKey(m)] = {
          t1: m.score.home, t2: m.score.away,
          completed: m.completed ?? false, live: m.live ?? false,
        };
      }
      if (Object.keys(extracted).length) setResults(p => ({ ...p, ...extracted }));
    } finally {
      fetchRef.current = false;
    }
  }, []);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  useEffect(() => {
    if (!isFirebaseConfigured || !db) return;
    return onSnapshot(doc(db, "rooms", ROOM_ID), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.results) setResults(p => ({ ...p, ...d.results }));
    });
  }, []);

  const selectUser = (name: string) => {
    setUser(name);
    localStorage.setItem("wc2026_user", name);
    setPreds(lsGet<Record<string, MyPredictions>>("wc2026_preds", {})[name] || {});
  };

  const handleScore = (match: Match, team: "t1" | "t2", val: string) => {
    if (isLocked(match, results)) return;
    const key = predKey(match);
    const num = val === "" ? "" : Math.max(0, Math.min(30, parseInt(val) || 0));
    setPreds(p => ({ ...p, [key]: { ...p[key], [team]: num } }));
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const all = lsGet<Record<string, MyPredictions>>("wc2026_preds", {});
    all[user] = preds;
    localStorage.setItem("wc2026_preds", JSON.stringify(all));

    if (isFirebaseConfigured && db) {
      try {
        const ref  = doc(db, "rooms", ROOM_ID);
        const snap = await getDoc(ref);
        const existing = snap.exists() ? (snap.data().predictions || {}) : {};
        await setDoc(ref, {
          predictions: { ...existing, [user]: preds },
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (e) { console.error(e); }
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const total     = matches.length;
  const predicted = Object.values(preds).filter(p => p?.t1 !== "" && p?.t1 != null).length;
  const lockedN   = matches.filter(m => isLocked(m, results)).length;
  const upcomingN = total - lockedN;

  const filteredMatches = matches.filter(m => {
    if (predFilter === "upcoming") return !isLocked(m, results);
    if (predFilter === "done")     return isLocked(m, results);
    return true;
  });

  const sections = buildSectionsByDate(filteredMatches);

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <Link href="/" className="text-white/30 hover:text-white text-sm mb-8 flex items-center gap-1 transition">
            ← الصفحة الرئيسية
          </Link>

          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🏆</div>
            <h1 className="text-2xl font-black text-yellow-400">كأس العالم 2026</h1>
            <p className="text-white/40 text-sm mt-1">اختر اسمك لبدء التوقعات</p>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-bold text-white/60 mb-4 text-center">المشاركون</h2>
            <div className="grid grid-cols-2 gap-2.5">
              {PARTICIPANTS.map(name => (
                <button
                  key={name}
                  onClick={() => selectUser(name)}
                  className="bg-white/5 hover:bg-yellow-500/15 border border-white/10
                             hover:border-yellow-500/40 rounded-xl py-3.5 px-3
                             text-sm font-bold text-white hover:text-yellow-300
                             transition-all active:scale-95"
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          {!isFirebaseConfigured && (
            <div className="mt-4 bg-orange-500/10 border border-orange-500/25 rounded-xl p-3 text-xs text-orange-300 text-center space-y-2">
              <p>⚠️ وضع تجريبي — التوقعات محفوظة محلياً فقط</p>
              <Link href="/setup" className="inline-block bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 text-orange-300 rounded-lg px-3 py-1.5 transition-all">
                📋 دليل الإعداد ←
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">

      <header className="sticky top-0 z-50 bg-[#07111f]/95 backdrop-blur border-b border-white/10">
        <div className="max-w-xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/40 hover:text-white transition text-lg flex-shrink-0">←</Link>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-black text-white text-sm">{user}</span>
                <button
                  onClick={() => { localStorage.removeItem("wc2026_user"); setUser(""); }}
                  className="text-[10px] text-white/25 hover:text-red-400 transition border border-white/10
                             hover:border-red-500/30 rounded-full px-2 py-0.5"
                >
                  تغيير
                </button>
              </div>
              <div className="text-[10px] text-white/35 mt-0.5">
                {predicted}/{total} توقع • {upcomingN} متاحة للتوقع
              </div>
            </div>

            <button
              onClick={save}
              disabled={saving}
              className={`flex-shrink-0 font-black px-4 py-2 rounded-xl text-sm transition-all active:scale-95 ${
                saved
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : "bg-yellow-500 hover:bg-yellow-400 text-black shadow-lg shadow-yellow-500/20"
              }`}
            >
              {saving ? "⏳" : saved ? "✅ تم الحفظ" : "💾 حفظ"}
            </button>
          </div>

          <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 rounded-full transition-all duration-500"
              style={{ width: `${total > 0 ? (predicted / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 pt-3 pb-1">
        <div className="flex gap-2">
          {([
            { k: "upcoming", label: `⏳ متاح (${upcomingN})` },
            { k: "done",     label: `✅ مكتملة (${lockedN})` },
            { k: "all",      label: "الكل" },
          ] as const).map(f => (
            <button key={f.k} onClick={() => setPredFilter(f.k)}
              className={`flex-shrink-0 text-xs px-4 py-2 rounded-full border transition-all ${
                predFilter === f.k
                  ? "bg-yellow-500 border-yellow-500 text-black font-black"
                  : "border-white/15 text-white/45 hover:border-white/35"
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-xl mx-auto px-4 pb-28 pt-3 space-y-6">
        {filteredMatches.length === 0 && (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">{predFilter === "upcoming" ? "✅" : "⏳"}</div>
            <p className="text-white/40 text-sm">
              {predFilter === "upcoming" ? "توقعت كل المباريات المتاحة!" : "لا توجد مباريات مكتملة بعد"}
            </p>
          </div>
        )}

        {sections.map(sec => (
          <div key={sec.key}>
            <div className="section-title"><span>{sec.label}</span></div>
            <div className="space-y-2.5">
              {sec.matches.map(m => (
                <PredictCard
                  key={predKey(m)}
                  match={m}
                  pred={preds[predKey(m)]}
                  actual={results[predKey(m)]}
                  locked={isLocked(m, results)}
                  onChange={(team, val) => handleScore(m, team, val)}
                />
              ))}
            </div>
          </div>
        ))}
      </main>

      <div className="fixed bottom-6 left-0 right-0 flex justify-center z-40 pointer-events-none">
        <button
          onClick={save}
          disabled={saving}
          className={`pointer-events-auto font-black px-8 py-3.5 rounded-2xl text-base
                      shadow-2xl transition-all active:scale-95 ${
            saved
              ? "bg-green-500 text-white shadow-green-500/30"
              : "bg-yellow-500 hover:bg-yellow-400 text-black shadow-yellow-500/40"
          }`}
          style={{ boxShadow: saved ? "0 8px 32px rgba(34,197,94,0.4)" : "0 8px 32px rgba(234,179,8,0.4)" }}
        >
          {saving ? "⏳ جارٍ الحفظ..." : saved ? "✅ تم حفظ توقعاتك!" : "💾 حفظ التوقعات"}
        </button>
      </div>
    </div>
  );
}

function PredictCard({ match, pred, actual, locked, onChange }: {
  match:   Match;
  pred?:   Prediction;
  actual?: ActualResult;
  locked:  boolean;
  onChange: (team: "t1"|"t2", val: string) => void;
}) {
  const hasPred = pred?.t1 !== "" && pred?.t1 != null && pred?.t2 != null;
  const pts     = actual?.completed && hasPred ? calcPoints(pred!, actual) : null;

  const borderColor =
    pts?.kind === "exact"  ? "border-yellow-500/50 bg-yellow-500/5"  :
    pts?.kind === "result" ? "border-green-500/30  bg-green-500/5"   :
    pts?.kind === "none"   ? "border-red-500/20    bg-red-500/5"      :
    hasPred                ? "border-blue-500/25"                     : "";

  return (
    <div className={`card p-4 transition-all ${borderColor}`}>
      <div className="flex items-center justify-between mb-3 text-[11px]">
        <span className="text-white/30">
          {match.groupName ? `${match.groupName} • ` : ""}{match.time}
          {match.venue ? ` • ${match.venue}` : ""}
        </span>
        <div className="flex items-center gap-2">
          {actual?.live      && <span className="badge-live animate-pulse">🔴 مباشر</span>}
          {actual?.completed && <span className="badge-done">✅ انتهت</span>}
          {locked && !actual?.completed && !actual?.live && (
            <span className="badge-upcoming border-orange-500/25 text-orange-400">🔒 مقفلة</span>
          )}
          {pts && (
            <span className={`text-[11px] font-black px-2 py-0.5 rounded-lg ${
              pts.kind === "exact"  ? "bg-yellow-500/25 text-yellow-300" :
              pts.kind === "result" ? "bg-green-500/20  text-green-400"  :
                                     "bg-red-500/15    text-red-400"
            }`}>
              {pts.kind === "exact" ? "⭐ +3" : pts.kind === "result" ? "✓ +1" : "✗ 0"}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 text-center">
          <div className="text-3xl mb-1">{match.flag1}</div>
          <div className="text-xs font-bold text-white/80 leading-snug">{match.team1}</div>
        </div>

        <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
          {actual && (actual.completed || actual.live) && (
            <div className={`font-black text-sm px-3 py-1 rounded-lg ${
              actual.live ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white"
            }`}>
              {actual.t1} : {actual.t2}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" max="30"
              value={pred?.t1 ?? ""}
              onChange={e => onChange("t1", e.target.value)}
              placeholder="—"
              disabled={locked}
              className={`score-input ${locked ? "opacity-30 cursor-not-allowed" : ""}`}
            />
            <span className="text-white/20 font-black text-xl">:</span>
            <input
              type="number" min="0" max="30"
              value={pred?.t2 ?? ""}
              onChange={e => onChange("t2", e.target.value)}
              placeholder="—"
              disabled={locked}
              className={`score-input ${locked ? "opacity-30 cursor-not-allowed" : ""}`}
            />
          </div>
          <span className="text-[10px] text-white/20">توقعك</span>
        </div>

        <div className="flex-1 text-center">
          <div className="text-3xl mb-1">{match.flag2}</div>
          <div className="text-xs font-bold text-white/80 leading-snug">{match.team2}</div>
        </div>
      </div>
    </div>
  );
}
