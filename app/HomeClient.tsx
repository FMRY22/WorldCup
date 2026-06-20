"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import Link from "next/link";
import { db, isFirebaseConfigured, ROOM_ID } from "@/lib/firebase";
import { ALL_MATCHES, STAGE_LABELS, type Match } from "@/lib/matches";
import { calcPoints, calcUserScore, findActual, findUserPred, type Prediction, type ActualResult } from "@/lib/scoring";
import { PARTICIPANTS } from "@/lib/config";
import { toArabicPlayerName } from "@/lib/playerMap";

type AllPredictions = Record<string, Record<string, Prediction>>;
type AllResults    = Record<string, ActualResult>;

interface ScheduleMatch extends Match {
  score?: { home: number; away: number } | null;
  live?: boolean;
  completed?: boolean;
  minute?: number;
  scorers?: { name: string; minute?: number; team: "home" | "away" }[];
}

function saudiNow() { return Date.now() + 3 * 60 * 60 * 1000; }

function fmtDayLabel(d: string) {
  const now      = saudiNow();
  const today    = new Date(now).toISOString().split("T")[0];
  const tomorrow = new Date(now + 86400000).toISOString().split("T")[0];
  if (d === today)    return "اليوم";
  if (d === tomorrow) return "غداً";
  return new Intl.DateTimeFormat("ar", {
    calendar: "gregory", weekday: "long", day: "numeric", month: "long",
  }).format(new Date(d + "T12:00:00"));
}

function fmtTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "م" : "ص";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function buildSectionsByDate(matches: ScheduleMatch[]) {
  const byDate: Record<string, ScheduleMatch[]> = {};
  for (const m of matches) { (byDate[m.date] ??= []).push(m); }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ms]) => ({
      key: `d-${date}`,
      label: fmtDayLabel(date),
      matches: ms.sort((a, b) => a.time.localeCompare(b.time)),
    }));
}

function predKey(m: Match) { return `${m.team1}|${m.team2}`; }

function buildSectionsByGroup(matches: ScheduleMatch[]) {
  const grp: Record<string, ScheduleMatch[]> = {};
  const ko:  Record<string, ScheduleMatch[]> = {};
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

function lsGet<T>(key: string, fallback: T): T {
  try { const c = localStorage.getItem(key); return c ? JSON.parse(c) : fallback; } catch { return fallback; }
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function fireConfetti() {
  const emojis = ["⭐","🎉","🏆","🎊","⚽","🥳","✨","🌟"];
  for (let i = 0; i < 35; i++) {
    const el = document.createElement("div");
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    Object.assign(el.style, {
      position: "fixed",
      left: `${Math.random() * 100}vw`,
      top: "-40px",
      fontSize: `${Math.random() * 18 + 14}px`,
      pointerEvents: "none",
      zIndex: "9999",
      animation: `confetti-drop ${1.5 + Math.random() * 1.5}s ease-in forwards`,
      animationDelay: `${Math.random() * 0.8}s`,
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
}

// ── LiveClock ─────────────────────────────────────────────────────────────────
function LiveClock({ minute, fetchedAt }: { minute: number; fetchedAt: Date }) {
  const elapsed = () => Math.max(0, Math.floor((Date.now() - fetchedAt.getTime()) / 1000));
  const [secs, setSecs] = useState(elapsed);

  useEffect(() => {
    setSecs(elapsed());
    const id = setInterval(() => setSecs(elapsed()), 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedAt]);

  const m = minute + Math.floor(secs / 60);
  const s = secs % 60;
  return (
    <span className="text-[11px] font-black text-red-300 bg-red-500/10 border border-red-500/20 rounded-full px-2.5 py-0.5" dir="ltr">
      ⏱ {m}:{String(s).padStart(2, "0")}′
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function HomeClient() {
  const [matches,  setMatches]  = useState<ScheduleMatch[]>(() => {
    const p = lsGet<ScheduleMatch[]>("wc2026_schedule", []);
    return p.length ? p : ALL_MATCHES;
  });
  const [allPreds, setAllPreds] = useState<AllPredictions>(() => {
    const full = lsGet<AllPredictions>("wc2026_allpreds", {});
    return Object.keys(full).length ? full : lsGet<AllPredictions>("wc2026_preds", {});
  });
  const [results, setResults] = useState<AllResults>(() => {
    try {
      const cached = lsGet<ScheduleMatch[]>("wc2026_schedule", []);
      const r: AllResults = {};
      for (const m of cached) {
        if (!((m.completed || m.live) && m.score)) continue;
        r[`${m.team1}|${m.team2}`] = {
          t1: m.score.home, t2: m.score.away,
          completed: !!m.completed, live: !!m.live,
        };
      }
      return r;
    } catch { return {}; }
  });
  const [champion, setChampion] = useState<Record<string, string>>(() =>
    lsGet("wc2026_champion", {})
  );
  const [status,  setStatus]  = useState<"loading"|"ok"|"fallback">("loading");
  const [updated, setUpdated] = useState<Date|null>(null);
  const [filter,  setFilter]  = useState<"today"|"upcoming"|"live"|"done"|"groups">("today");

  // Confetti: fire only when a match NEWLY completes with an exact hit
  const completedRef = useRef(new Set<string>());
  const mountedRef   = useRef(false);

  // ── Schedule refresh ────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const r    = await fetch("/api/schedule");
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
          t1: api.score.home, t2: api.score.away,
          completed: api.completed ?? false, live: api.live ?? false,
        };
      }
      if (Object.keys(extracted).length) setResults(p => ({ ...p, ...extracted }));
    } catch { setStatus("fallback"); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  // ── Firebase ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      setAllPreds(lsGet("wc2026_preds", {}));
      return;
    }
    return onSnapshot(doc(db, "rooms", ROOM_ID), snap => {
      if (!snap.exists()) { setAllPreds(lsGet("wc2026_preds", {})); return; }
      const d = snap.data();
      if (d.predictions) {
        setAllPreds(d.predictions);
        try { localStorage.setItem("wc2026_allpreds", JSON.stringify(d.predictions)); } catch {}
      }
      if (d.results)  setResults(p => ({ ...p, ...d.results }));
      if (d.champion) {
        setChampion(d.champion);
        try { localStorage.setItem("wc2026_champion", JSON.stringify(d.champion)); } catch {}
      }
    });
  }, []);

  // ── Confetti trigger ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountedRef.current) {
      // First load — seed completed set, don't fire confetti
      mountedRef.current = true;
      Object.keys(results).forEach(k => { if (results[k].completed) completedRef.current.add(k); });
      return;
    }
    let newExact = false;
    for (const [key, res] of Object.entries(results)) {
      if (res.completed && !completedRef.current.has(key)) {
        completedRef.current.add(key);
        const exact = PARTICIPANTS.some(u => {
          const pred = allPreds[u]?.[key];
          return pred && pred.t1 === res.t1 && pred.t2 === res.t2;
        });
        if (exact) newExact = true;
      }
    }
    if (newExact) fireConfetti();
  }, [results, allPreds]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const users  = PARTICIPANTS;

  // بطل البطولة الفعلي = الفائز بالنهائي بعد اكتماله
  const finalMatch    = matches.find(m => m.stage === "final");
  const finalResult   = finalMatch ? findActual(finalMatch.team1, finalMatch.team2, results) : undefined;
  const actualChampion = finalMatch && finalResult?.completed
    ? (finalResult.t1 > finalResult.t2 ? finalMatch.team1
      : finalResult.t2 > finalResult.t1 ? finalMatch.team2 : "")
    : "";

  const ranked = PARTICIPANTS
    .map(u => ({ user: u, ...calcUserScore(allPreds[u] || {}, results, champion[u], actualChampion) }))
    .filter(r => allPreds[r.user] && Object.keys(allPreds[r.user]).length > 0)
    .sort((a, b) => b.total - a.total || b.exact - a.exact || b.result - a.result);

  const completedN = Object.values(results).filter(r => r.completed).length;
  const liveN      = Object.values(results).filter(r => r.live).length;
  const today      = new Date(saudiNow()).toISOString().split("T")[0];
  const MEDALS     = ["🥇","🥈","🥉"];

  const liveMatches = matches.filter(m => findActual(m.team1, m.team2, results)?.live);

  const visible = matches.filter(m => {
    const a = findActual(m.team1, m.team2, results);
    if (filter === "live")     return a?.live;
    if (filter === "done")     return a?.completed;
    if (filter === "today")    return m.date === today;
    if (filter === "upcoming") return !a?.completed && !a?.live;
    return true;
  });

  const sections = filter === "groups"
    ? buildSectionsByGroup(visible)
    : buildSectionsByDate(visible);

  // ── Quick user stats ─────────────────────────────────────────────────────────
  const userStats = PARTICIPANTS.reduce<Record<string, { pct: number; predicted: number }>>((acc, u) => {
    const preds = allPreds[u] || {};
    const predicted = Object.values(preds).filter(p => p?.t1 !== "" && p?.t1 != null).length;
    const done = Object.entries(preds).filter(([k]) => results[k]?.completed).length;
    const correct = Object.entries(preds).filter(([k]) => {
      const r = results[k]; const p = preds[k];
      if (!r?.completed || !p) return false;
      return calcPoints(p, r).pts > 0;
    }).length;
    acc[u] = { pct: done > 0 ? Math.round((correct / done) * 100) : 0, predicted };
    return acc;
  }, {});

  return (
    <div className="min-h-screen">

      {/* ── LIVE TICKER ───────────────────────────────────── */}
      {liveMatches.length > 0 && (
        <div className="bg-red-950/70 border-b border-red-500/25 overflow-hidden">
          <div className="ticker-track py-2" dir="ltr">
            {[...liveMatches, ...liveMatches].map((m, i) => (
              <span key={i} className="inline-flex items-center gap-3 px-8 text-sm">
                <span className="text-red-400 animate-pulse text-[10px] font-black tracking-widest">⬤ LIVE</span>
                {m.minute != null && (
                  <span className="text-red-300 text-[10px] font-black bg-red-500/15 px-1.5 rounded">{m.minute}'</span>
                )}
                <span className="font-bold text-white/90">{m.flag1} {m.team1}</span>
                <span className="font-black text-white text-base tabular-nums">
                  {findActual(m.team1, m.team2, results)?.t1 ?? "–"}
                  <span className="text-white/30 mx-1">:</span>
                  {findActual(m.team1, m.team2, results)?.t2 ?? "–"}
                </span>
                <span className="font-bold text-white/90">{m.team2} {m.flag2}</span>
                <span className="text-white/15 mx-2">|</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── NAV ───────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-[#07111f]/95 backdrop-blur border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-yellow-500 rounded-xl flex items-center justify-center text-lg shadow-lg shadow-yellow-500/30 flex-shrink-0">⚽</div>
            <div className="min-w-0">
              <h1 className="font-black text-white text-sm leading-none">كأس العالم 2026</h1>
              <p className="text-[10px] text-white/35 mt-0.5 truncate">
                {liveN > 0 && <span className="text-red-400 animate-pulse">{liveN} مباشر • </span>}
                {completedN} مكتملة
                {status === "loading" && " • جارٍ التحديث..."}
                {status === "fallback" && " • بيانات محلية"}
                {updated && status === "ok" && ` • ${updated.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}`}
              </p>
            </div>
          </div>
          <Link href="/predict" className="btn-primary text-sm whitespace-nowrap flex-shrink-0">توقعاتي ←</Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 pt-5 pb-24 space-y-5">

        {/* ── LEADERBOARD ───────────────────────────────────── */}
        {ranked.length > 0 && (
          <div className="card overflow-hidden fade-up">
            <div className="px-4 pt-3 pb-2 border-b border-white/8 flex items-center justify-between">
              <h2 className="font-black text-yellow-400 text-sm">🏆 الترتيب</h2>
              <span className="text-[10px] text-white/25">⭐+3 دقيق • ✓+1 صحيح</span>
            </div>
            <div className="divide-y divide-white/5">
              {ranked.map((r, i) => {
                const maxPts = ranked[0]?.total || 1;
                const stat   = userStats[r.user];
                const champ  = champion[r.user];
                return (
                  <div key={r.user} className={`flex items-center gap-3 px-4 py-3 ${i === 0 ? "bg-yellow-500/5" : ""}`}>
                    <span className="w-7 text-center flex-shrink-0 text-lg leading-none">
                      {MEDALS[i] ?? <span className="text-sm text-white/30 font-bold">{i + 1}</span>}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">{r.user}</span>
                        {champ && (
                          <span className={`text-[10px] rounded-full px-2 py-0.5 border ${
                            r.championHit
                              ? "text-green-300 bg-green-500/15 border-green-500/30"
                              : "text-yellow-400/70 bg-yellow-500/10 border-yellow-500/20"
                          }`}>
                            🏆 {champ}{r.championHit ? " +5" : ""}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="h-1.5 flex-1 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 rounded-full transition-all duration-700"
                            style={{ width: `${(r.total / maxPts) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-yellow-400/70 flex-shrink-0">⭐{r.exact} ✓{r.result}</span>
                        {stat.predicted > 0 && (
                          <span className="text-[10px] text-white/25 flex-shrink-0">{stat.pct}%</span>
                        )}
                      </div>
                    </div>
                    <span className="text-2xl font-black text-yellow-400 flex-shrink-0">{r.total}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {ranked.length === 0 && (
          <div className="text-center py-12 fade-up">
            <div className="text-6xl mb-4">⚽</div>
            <h2 className="text-xl font-black text-white mb-2">ابدأ التوقعات</h2>
            <p className="text-white/40 mb-6 text-sm">كن أول من يدخل توقعاته</p>
            <Link href="/predict" className="btn-primary inline-block">أدخل توقعاتي ←</Link>
          </div>
        )}

        {/* ── FILTERS ────────────────────────────────────────── */}
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

        {/* ── MATCH SECTIONS ────────────────────────────────── */}
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
                <MatchCard key={predKey(m)} match={m} actual={findActual(m.team1, m.team2, results)} allPreds={allPreds} users={users} fetchedAt={updated} />
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
function MatchCard({ match, actual, allPreds, users, fetchedAt }: {
  match: ScheduleMatch; actual?: ActualResult; allPreds: AllPredictions; users: string[]; fetchedAt?: Date | null;
}) {
  const predsForMatch = users
    .map(u => ({ user: u, pred: findUserPred(match.team1, match.team2, allPreds[u] ?? {}) }))
    .filter((x): x is { user: string; pred: Prediction } =>
      x.pred?.t1 !== "" && x.pred?.t1 != null && x.pred?.t2 != null);

  const isLive = actual?.live ?? match.live ?? false;
  const isDone = actual?.completed ?? match.completed ?? false;

  return (
    <div className={`card overflow-hidden transition-all ${
      isLive ? "border-red-500/40 live-glow" : isDone ? "border-green-500/10" : "border-white/8"
    }`}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-black text-white">{fmtTime(match.time)}</div>
            <div className="text-[10px] text-white/30 mt-0.5">
              {match.groupName ?? ""}
              {match.venue ? ` • ${match.venue}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {isLive && match.minute != null && (
              fetchedAt
                ? <LiveClock minute={match.minute} fetchedAt={fetchedAt} />
                : <span className="text-[11px] font-black text-red-300 bg-red-500/10 border border-red-500/20 rounded-full px-2.5 py-0.5 animate-pulse">⏱ {match.minute}&apos;</span>
            )}
            {isLive ? (
              <span className="badge-live animate-pulse">🔴 مباشر</span>
            ) : isDone ? (
              <span className="badge-done">✅ انتهت</span>
            ) : (
              <span className="badge-upcoming">📅 قادمة</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 text-center">
            <div className="text-4xl mb-1.5">{match.flag1}</div>
            <div className="text-xs font-bold text-white/80 leading-snug">{match.team1}</div>
          </div>
          <div className="flex-shrink-0 text-center w-24">
            {(isDone || isLive) && actual ? (
              <div className={`font-black text-3xl leading-none ${isLive ? "text-red-400" : "text-white"}`}>
                {actual.t2}<span className="text-white/25 mx-1">:</span>{actual.t1}
              </div>
            ) : (
              <div className="text-white/20 font-black text-lg tracking-widest">VS</div>
            )}
          </div>
          <div className="flex-1 text-center">
            <div className="text-4xl mb-1.5">{match.flag2}</div>
            <div className="text-xs font-bold text-white/80 leading-snug">{match.team2}</div>
          </div>
        </div>
      </div>

      {match.scorers && match.scorers.length > 0 && (
        <div className="border-t border-white/5 px-4 py-2 flex flex-wrap gap-x-4 gap-y-1">
          {match.scorers.map((s, i) => {
            const flag = s.team === "home" ? match.flag1 : match.flag2;
            const nameAr = toArabicPlayerName(s.name);
            const isOwnGoal = s.name === "Own Goal";
            return (
              <span key={i} className="inline-flex items-center gap-1 text-[11px]" dir="rtl">
                <span className="text-base leading-none">{flag}</span>
                <span className={`font-bold ${isOwnGoal ? "text-red-400/60" : "text-white/70"}`}>{nameAr}</span>
                {s.minute != null && <span className="text-white/30">{s.minute}&apos;</span>}
                <span className={isOwnGoal ? "text-red-400/40" : "text-white/30"}>⚽</span>
              </span>
            );
          })}
        </div>
      )}

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
                  <span className="font-black">{pred.t2}:{pred.t1}</span>
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
