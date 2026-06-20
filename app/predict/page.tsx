"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import Link from "next/link";
import { db, isFirebaseConfigured, ROOM_ID } from "@/lib/firebase";
import { ALL_MATCHES, STAGE_LABELS, type Match } from "@/lib/matches";
import { calcPoints, type Prediction, type ActualResult } from "@/lib/scoring";
import { PARTICIPANTS } from "@/lib/config";

type MyPredictions  = Record<string, Prediction>;
type AllResults     = Record<string, ActualResult>;

interface ScheduleMatch extends Match {
  score?: { home: number; away: number } | null;
  live?: boolean;
  completed?: boolean;
}

function fmt(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("ar-SA", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function isLocked(match: Match, results: AllResults) {
  if (results[match.id]?.completed || results[match.id]?.live) return true;
  return Date.now() > new Date(`${match.date}T${match.time}:00`).getTime();
}

function buildSections(matches: Match[]) {
  const grp: Record<string, Match[]> = {};
  const ko:  Record<string, Match[]> = {};
  for (const m of matches) {
    if (m.stage === "group") (grp[m.group!] ??= []).push(m);
    else                     (ko[m.stage]   ??= []).push(m);
  }
  const out: { key: string; label: string; matches: Match[] }[] = [];
  for (const [g, ms] of Object.entries(grp))
    out.push({ key: `g-${g}`, label: ms[0].groupName ?? `المجموعة ${g}`, matches: ms });
  for (const s of ["r32","r16","qf","sf","third","final"] as const)
    if (ko[s]) out.push({ key: s, label: STAGE_LABELS[s], matches: ko[s] });
  return out;
}

// ── PredictPage ───────────────────────────────────────────────────────────────

export default function PredictPage() {
  const [user,    setUser]    = useState("");
  const [preds,   setPreds]   = useState<MyPredictions>({});
  const [results, setResults] = useState<AllResults>({});
  const [matches, setMatches] = useState<Match[]>(ALL_MATCHES);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const fetchRef = useRef(false);

  // Load schedule
  const loadSchedule = useCallback(async () => {
    if (fetchRef.current) return;
    fetchRef.current = true;
    try {
      const r = await fetch("/api/schedule");
      const data: ScheduleMatch[] = await r.json();
      if (!Array.isArray(data) || !data.length) return;
      setMatches(data);
      const extracted: AllResults = {};
      for (const m of data) {
        if ((m.completed || m.live) && m.score != null)
          extracted[m.id] = { t1: m.score.home, t2: m.score.away,
            completed: m.completed ?? false, live: m.live ?? false };
      }
      if (Object.keys(extracted).length) setResults(p => ({ ...p, ...extracted }));
    } finally {
      fetchRef.current = false;
    }
  }, []);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  // Restore user + preds from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("wc2026_user");
    if (saved) {
      setUser(saved);
      try {
        const all = JSON.parse(localStorage.getItem("wc2026_preds") || "{}");
        setPreds(all[saved] || {});
      } catch {}
    }
  }, []);

  // Firebase listener (results only)
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return;
    return onSnapshot(doc(db, "rooms", ROOM_ID), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.results) setResults(p => ({ ...p, ...d.results }));
    });
  }, []);

  // ── Actions ────────────────────────────────────────

  const selectUser = (name: string) => {
    setUser(name);
    localStorage.setItem("wc2026_user", name);
    try {
      const all = JSON.parse(localStorage.getItem("wc2026_preds") || "{}");
      setPreds(all[name] || {});
    } catch {}
  };

  const handleScore = (matchId: string, team: "t1" | "t2", val: string) => {
    const m = matches.find(x => x.id === matchId);
    if (!m || isLocked(m, results)) return;
    const num = val === "" ? "" : Math.max(0, Math.min(30, parseInt(val) || 0));
    setPreds(p => ({ ...p, [matchId]: { ...p[matchId], [team]: num } }));
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    // localStorage
    const all = (() => { try { return JSON.parse(localStorage.getItem("wc2026_preds") || "{}"); } catch { return {}; } })();
    all[user] = preds;
    localStorage.setItem("wc2026_preds", JSON.stringify(all));

    // Firebase
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

  // ── Derived ────────────────────────────────────────

  const sections  = buildSections(matches);
  const total     = matches.length;
  const predicted = Object.values(preds).filter(p => p?.t1 !== "" && p?.t1 != null).length;
  const locked    = matches.filter(m => isLocked(m, results)).length;

  // ── Name selector ──────────────────────────────────

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {/* Back */}
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
            <div className="mt-4 bg-orange-500/10 border border-orange-500/25 rounded-xl p-3 text-xs text-orange-300 text-center">
              ⚠️ وضع تجريبي — التوقعات محفوظة محلياً فقط
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Prediction form ────────────────────────────────

  return (
    <div className="min-h-screen">

      {/* ── HEADER ──────────────────────────────────── */}
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
                {predicted}/{total} توقع • {locked} مقفلة
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

          {/* Progress bar */}
          <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 rounded-full transition-all duration-500"
              style={{ width: `${(predicted / total) * 100}%` }}
            />
          </div>
        </div>
      </header>

      {/* ── GROUP TABS ──────────────────────────────── */}
      <div className="max-w-xl mx-auto px-4 pt-3">
        <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
          {sections.map(s => (
            <button
              key={s.key}
              onClick={() => document.getElementById(s.key)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full border border-white/15
                         text-white/45 hover:border-yellow-500/40 hover:text-yellow-400 transition"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── MATCH SECTIONS ──────────────────────────── */}
      <main className="max-w-xl mx-auto px-4 pb-28 pt-2 space-y-6">
        {sections.map(sec => (
          <div key={sec.key} id={sec.key}>
            <div className="section-title"><span>{sec.label}</span></div>
            <div className="space-y-2.5">
              {sec.matches.map(m => (
                <PredictCard
                  key={m.id}
                  match={m}
                  pred={preds[m.id]}
                  actual={results[m.id]}
                  locked={isLocked(m, results)}
                  onChange={(team, val) => handleScore(m.id, team, val)}
                />
              ))}
            </div>
          </div>
        ))}
      </main>

      {/* ── FLOATING SAVE ───────────────────────────── */}
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

// ── PredictCard ───────────────────────────────────────────────────────────────

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

      {/* Top: date + status */}
      <div className="flex items-center justify-between mb-3 text-[11px]">
        <span className="text-white/30">
          {fmt(match.date)} • {match.time}
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

      {/* Teams + inputs */}
      <div className="flex items-center gap-3">
        {/* Team 1 */}
        <div className="flex-1 text-center">
          <div className="text-3xl mb-1">{match.flag1}</div>
          <div className="text-xs font-bold text-white/80 leading-snug">{match.team1}</div>
        </div>

        {/* Score inputs + actual */}
        <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
          {/* Actual result (if available) */}
          {actual && (actual.completed || actual.live) && (
            <div className={`font-black text-sm px-3 py-1 rounded-lg ${
              actual.live ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white"
            }`}>
              {actual.t1} : {actual.t2}
            </div>
          )}
          {/* Inputs */}
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

        {/* Team 2 */}
        <div className="flex-1 text-center">
          <div className="text-3xl mb-1">{match.flag2}</div>
          <div className="text-xs font-bold text-white/80 leading-snug">{match.team2}</div>
        </div>
      </div>
    </div>
  );
}
