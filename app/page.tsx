"use client";

import { useState, useEffect, useCallback } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import Link from "next/link";
import { db, isFirebaseConfigured, ROOM_ID } from "@/lib/firebase";
import { ALL_MATCHES, STAGE_LABELS, type Match } from "@/lib/matches";
import { calcPoints, calcUserScore, type Prediction, type ActualResult } from "@/lib/scoring";
import { PARTICIPANTS } from "@/lib/config";

type AllPredictions = Record<string, Record<string, Prediction>>;
type AllResults    = Record<string, ActualResult>;

interface ScheduleMatch extends Match {
  score?: { home: number; away: number } | null;
  live?: boolean;
  completed?: boolean;
}

// ── helpers ──────────────────────────────────────────────────────────────────

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

function predKey(m: Match) { return `${m.team1}|${m.team2}`; }

function buildSectionsByGroup(matches: Match[]) {
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

// ── HomePage ──────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [matches,  setMatches]  = useState<Match[]>(ALL_MATCHES);
  const [allPreds, setAllPreds] = useState<AllPredictions>({});
  const [results,  setResults]  = useState<AllResults>({});
  const [status,   setStatus]   = useState<"loading"|"ok"|"fallback">("loading");
  const [updated,  setUpdated]  = useState<Date|null>(null);
  const [filter,   setFilter]   = useState<"today"|"upcoming"|"live"|"done"|"groups">("today");

  // ── Schedule + live scores ─────────────────────────
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/schedule");
      const data: ScheduleMatch[] = await r.json();
      if (!Array.isArray(data) || data.length === 0) { setStatus("fallback"); return; }
      setStatus("ok");
      setUpdated(new Date());
      setMatches(data);
      try { localStorage.setItem("wc2026_schedule", JSON.stringify(data)); } catch {}
      const extracted: AllResults = {};
      for (const api of data) {
        if (!(api.completed || api.live) || api.score == null) continue;
        extracted[predKey(api)] = {
          t1: api.score.home,
          t2: api.score.away,
          completed: api.completed ?? false,
          live: api.live ?? false,
        };
      }
      if (Object.keys(extracted).length) setResults(p => ({ ...p, ...extracted }));
    } catch {
      setStatus("fallback");
    }
  }, []);

  useEffect(() => {
    try {
      const c = localStorage.getItem("wc2026_schedule");
      if (c) { const p = JSON.parse(c); if (Array.isArray(p) && p.length) setMatches(p); }
    } catch {}
    refresh();
    const id = setInterval(refresh, 30 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  // ── Firebase or localStorage ───────────────────────
  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      try { setAllPreds(JSON.parse(localStorage.getItem("wc2026_preds") || "{}")); } catch {}
      return;
    }
    return onSnapshot(doc(db, "rooms", ROOM_ID), snap => {
      if (!snap.exists()) {
        // Firebase فارغ — اقرأ من الجهاز مؤقتاً
        try { setAllPreds(JSON.parse(localStorage.getItem("wc2026_preds") || "{}")); } catch {}
        return;
      }
      const d = snap.data();
      if (d.predictions) setAllPreds(d.predictions);
      if (d.results)     setResults(p => ({ ...p, ...d.results }));
    });
  }, []);

  // ── Derived ────────────────────────────────────────
  // نعرض فقط المشاركين الرسميين — نتجاهل أي أسماء قديمة في Firebase
  const users  = PARTICIPANTS;
  const ranked = PARTICIPANTS
    .map(u => ({ user: u, ...calcUserScore(allPreds[u] || {}, results) }))
    .filter(r => allPreds[r.user] && Object.keys(allPreds[r.user]).length > 0)
    .sort((a, b) => b.total - a.total || b.exact - a.exact);

  const completedN = Object.values(results).filter(r => r.completed).length;
  const liveN      = Object.values(results).filter(r => r.live).length;
  const today      = new Date(saudiNow()).toISOString().split("T")[0];
  const MEDALS     = ["🥇", "🥈", "🥉"];

  const visible = matches.filter(m => {
    if (filter === "live")     return results[predKey(m)]?.live;
    if (filter === "done")     return results[predKey(m)]?.completed;
    if (filter === "today")    return m.date === today;
    if (filter === "upcoming") return !results[predKey(m)]?.completed && !results[predKey(m)]?.live;
    return true;
  });

  const sections = filter === "groups"
    ? buildSectionsByGroup(visible)
    : buildSectionsByDate(visible);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen">

      {/* ── NAV ────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-[#07111f]/95 backdrop-blur border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-yellow-500 rounded-xl flex items-center justify-center text-lg shadow-lg shadow-yellow-500/30 flex-shrink-0">
              ⚽
            </div>
            <div className="min-w-0">
              <h1 className="font-black text-white text-sm leading-none">كأس العالم 2026</h1>
              <p className="text-[10px] text-white/35 mt-0.5 truncate">
                {liveN > 0 && <span className="text-red-400 animate-pulse">{liveN} مباشر • </span>}
                {completedN} مكتملة
                {status === "loading" && " • جارٍ التحديث..."}
                {status === "fallback" && " • بيانات محلية"}
                {updated && status === "ok" &&
                  ` • ${updated.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}`}
              </p>
            </div>
          </div>
          <Link href="/predict" className="btn-primary text-sm whitespace-nowrap flex-shrink-0">
            توقعاتي ←
          </Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 pt-5 pb-24 space-y-5">

        {/* ── LEADERBOARD ─────────────────────────────────────── */}
        {ranked.length > 0 && (
          <div className="card overflow-hidden fade-up">
            <div className="px-4 pt-3 pb-2 border-b border-white/8 flex items-center justify-between">
              <h2 className="font-black text-yellow-400 text-sm">🏆 الترتيب</h2>
              <span className="text-[10px] text-white/25">⭐+3 دقيق • ✓+1 صحيح</span>
            </div>
            <div className="divide-y divide-white/5">
              {ranked.map((r, i) => {
                const maxPts = ranked[0]?.total || 1;
                return (
                  <div key={r.user}
                    className={`flex items-center gap-3 px-4 py-3 ${i === 0 ? "bg-yellow-500/5" : ""}`}>
                    <span className="w-7 text-center flex-shrink-0 text-lg leading-none">
                      {MEDALS[i] ?? <span className="text-sm text-white/30 font-bold">{i + 1}</span>}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-sm truncate">{r.user}</span>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="h-1.5 flex-1 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 rounded-full transition-all duration-700"
                            style={{ width: `${(r.total / maxPts) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-yellow-400/70 flex-shrink-0">⭐{r.exact} ✓{r.result}</span>
                      </div>
                    </div>
                    <span className="text-2xl font-black text-yellow-400 flex-shrink-0">{r.total}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── EMPTY STATE ─────────────────────────────────────── */}
        {ranked.length === 0 && (
          <div className="text-center py-12 fade-up">
            <div className="text-6xl mb-4">⚽</div>
            <h2 className="text-xl font-black text-white mb-2">ابدأ التوقعات</h2>
            <p className="text-white/40 mb-6 text-sm">كن أول من يدخل توقعاته</p>
            <Link href="/predict" className="btn-primary inline-block">
              أدخل توقعاتي ←
            </Link>
          </div>
        )}

        {/* ── FILTERS ─────────────────────────────────────────── */}
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {([
            { k: "today",    label: "📅 اليوم" },
            { k: "upcoming", label: "⏳ القادمة" },
            { k: "live",     label: `🔴 مباشر${liveN ? ` (${liveN})` : ""}` },
            { k: "done",     label: `✅ مكتملة (${completedN})` },
            { k: "groups",   label: "🗂 المجموعات" },
          ] as const).map(f => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              className={`flex-shrink-0 text-xs px-4 py-2 rounded-full border transition-all ${
                filter === f.k
                  ? "bg-yellow-500 border-yellow-500 text-black font-black"
                  : "border-white/15 text-white/45 hover:border-white/35"
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* ── MATCH SECTIONS ──────────────────────────────────── */}
        {visible.length === 0 && (
          <div className="text-center py-10 text-white/30 text-sm">
            {filter === "today"    && "لا توجد مباريات اليوم"}
            {filter === "live"     && "لا توجد مباريات مباشرة الآن"}
            {filter === "done"     && "لا توجد مباريات مكتملة بعد"}
            {filter === "upcoming" && "لا توجد مباريات قادمة"}
            {filter === "groups"   && "لا توجد مباريات"}
          </div>
        )}

        {sections.map(sec => (
          <div key={sec.key} className="fade-up">
            <div className="section-title"><span>{sec.label}</span></div>
            <div className="space-y-3">
              {sec.matches.map(m => (
                <MatchCard key={predKey(m)} match={m} actual={results[predKey(m)]} allPreds={allPreds} users={users} />
              ))}
            </div>
          </div>
        ))}

        {!isFirebaseConfigured && (
          <div className="text-center pt-4 pb-2 fade-up">
            <Link href="/setup"
              className="inline-flex items-center gap-2 text-xs text-orange-400/60 hover:text-orange-400 border border-orange-500/15 hover:border-orange-500/35 rounded-xl px-4 py-2 transition-all">
              ⚠️ وضع تجريبي — اضغط لإعداد المشاركة الفورية
            </Link>
          </div>
        )}

      </div>
    </div>
  );
}

// ── MatchCard ─────────────────────────────────────────────────────────────────

function MatchCard({ match, actual, allPreds, users }: {
  match: Match;
  actual?: ActualResult;
  allPreds: AllPredictions;
  users: string[];
}) {
  const pk = predKey(match);
  const predsForMatch = users
    .map(u => ({ user: u, pred: allPreds[u]?.[pk] }))
    .filter(x => x.pred?.t1 !== "" && x.pred?.t1 != null && x.pred?.t2 != null);

  const isLive = actual?.live;
  const isDone = actual?.completed;

  return (
    <div className={`card overflow-hidden transition-all ${
      isLive ? "border-red-500/40 live-glow" : isDone ? "border-green-500/10" : "border-white/8"
    }`}>

      <div className="p-4">
        {/* Top: group + time + status */}
        <div className="flex items-center justify-between mb-4 text-[11px]">
          <span className="text-white/30">
            {match.groupName ? `${match.groupName} • ` : ""}{match.time}
            {match.venue ? ` • ${match.venue}` : ""}
          </span>
          {isLive ? (
            <span className="badge-live animate-pulse">🔴 مباشر</span>
          ) : isDone ? (
            <span className="badge-done">✅ انتهت</span>
          ) : (
            <span className="badge-upcoming">📅 قادمة</span>
          )}
        </div>

        {/* Teams + score */}
        <div className="flex items-center gap-2">
          <div className="flex-1 text-center">
            <div className="text-4xl mb-1.5">{match.flag1}</div>
            <div className="text-xs font-bold text-white/80 leading-snug">{match.team1}</div>
          </div>

          <div className="flex-shrink-0 text-center w-24">
            {(isDone || isLive) && actual ? (
              <div className={`font-black text-3xl leading-none ${isLive ? "text-red-400" : "text-white"}`}>
                {actual.t1}<span className="text-white/25 mx-1">:</span>{actual.t2}
              </div>
            ) : (
              <div className="text-white/20 font-black text-lg tracking-widest">VS</div>
            )}
            <div className="text-[10px] text-white/20 mt-1.5">{match.time}</div>
          </div>

          <div className="flex-1 text-center">
            <div className="text-4xl mb-1.5">{match.flag2}</div>
            <div className="text-xs font-bold text-white/80 leading-snug">{match.team2}</div>
          </div>
        </div>
      </div>

      {/* Predictions strip */}
      {predsForMatch.length > 0 && (
        <div className="border-t border-white/8 bg-black/25 px-4 py-3">
          <div className="text-[10px] text-white/25 font-bold mb-2 flex items-center gap-1.5">
            <span className="w-1 h-3 bg-yellow-500/50 rounded-full inline-block" />
            توقعات المشاركين
          </div>
          <div className="flex flex-wrap gap-2">
            {predsForMatch.map(({ user, pred }) => {
              const pts = isDone ? calcPoints(pred, actual!) : null;
              return (
                <div key={user}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold ${
                    pts?.kind === "exact"  ? "chip-exact"  :
                    pts?.kind === "result" ? "chip-result" :
                    pts?.kind === "none"   ? "chip-miss"   : "chip-pending"
                  }`}>
                  <span className="text-[10px] opacity-60">{user}</span>
                  <span className="font-black">{pred.t1}:{pred.t2}</span>
                  {pts && <span>{pts.kind === "exact" ? "⭐" : pts.kind === "result" ? "✓" : "✗"}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {predsForMatch.length === 0 && users.length > 0 && (
        <div className="border-t border-white/5 px-4 py-2 text-[11px] text-white/15 text-center">
          لا توقعات لهذه المباراة —{" "}
          <Link href="/predict" className="text-yellow-500/60 hover:text-yellow-400 underline underline-offset-2">
            أدخل توقعك
          </Link>
        </div>
      )}
    </div>
  );
}
