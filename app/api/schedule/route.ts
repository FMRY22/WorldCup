import { NextResponse } from "next/server";
import { EN_TO_AR } from "@/lib/teamMap";
import { getFlag } from "@/lib/flags";

const FDORG_KEY = process.env.FOOTBALL_DATA_API_KEY;
const FDORG_URL =
  "https://api.football-data.org/v4/competitions/WC/matches?season=2026";
const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard";

type StageType = "group" | "r32" | "r16" | "qf" | "sf" | "third" | "final";

const FDORG_STAGE: Record<string, StageType> = {
  GROUP_STAGE: "group",
  ROUND_OF_32: "r32",
  ROUND_OF_16: "r16",
  QUARTER_FINALS: "qf",
  SEMI_FINALS: "sf",
  THIRD_PLACE: "third",
  FINAL: "final",
};

const GROUP_NAMES: Record<string, string> = {
  A: "المجموعة أ",
  B: "المجموعة ب",
  C: "المجموعة ج",
  D: "المجموعة د",
  E: "المجموعة هـ",
  F: "المجموعة و",
  G: "المجموعة ز",
  H: "المجموعة ح",
  I: "المجموعة ط",
  J: "المجموعة ي",
  K: "المجموعة ك",
  L: "المجموعة ل",
};

function toArabic(enName: string): string {
  return EN_TO_AR[enName.toLowerCase()] ?? enName;
}

let cache: { data: unknown[]; ts: number } | null = null;
const TTL = 3 * 60 * 1000; // 3 minutes

// ── football-data.org ─────────────────────────────────────────────────────────

interface FdorgTeam { name: string; shortName: string }
interface FdorgMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday: number | null;
  stage: string;
  group: string | null;
  homeTeam: FdorgTeam;
  awayTeam: FdorgTeam;
  score: { fullTime: { home: number | null; away: number | null } };
  venue?: string;
}

async function fetchFDOrg() {
  const res = await fetch(FDORG_URL, {
    headers: { "X-Auth-Token": FDORG_KEY! },
    next: { revalidate: 180 },
  });
  if (!res.ok) throw new Error(`football-data.org ${res.status}`);
  const data = (await res.json()) as { matches: FdorgMatch[] };

  return data.matches.map((m) => {
    const groupLetter = m.group?.replace("GROUP_", "") ?? "";
    const stage: StageType = FDORG_STAGE[m.stage] ?? "group";
    const date = new Date(m.utcDate);

    const homeEn = m.homeTeam.name || m.homeTeam.shortName;
    const awayEn = m.awayTeam.name || m.awayTeam.shortName;

    const homeScore = m.score?.fullTime?.home;
    const awayScore = m.score?.fullTime?.away;
    const finished = m.status === "FINISHED";
    const live = m.status === "IN_PLAY" || m.status === "PAUSED";

    return {
      id: String(m.id),
      stage,
      group: groupLetter || undefined,
      groupName: groupLetter ? GROUP_NAMES[groupLetter] : undefined,
      matchday: m.matchday ?? undefined,
      team1: toArabic(homeEn),
      team2: toArabic(awayEn),
      flag1: getFlag(homeEn),
      flag2: getFlag(awayEn),
      date: date.toISOString().split("T")[0],
      time: date.toISOString().slice(11, 16),
      venue: m.venue ?? "",
      status: m.status,
      score:
        (finished || live) && homeScore !== null && awayScore !== null
          ? { home: homeScore, away: awayScore }
          : null,
      live,
      completed: finished,
    };
  });
}

// ── ESPN ──────────────────────────────────────────────────────────────────────

interface EspnCompetitor {
  homeAway: "home" | "away";
  team: { displayName: string; shortDisplayName: string };
  score: string;
}
interface EspnEvent {
  id: string;
  date: string;
  status: { type: { completed: boolean; state: string } };
  competitions: Array<{
    competitors: EspnCompetitor[];
    notes: Array<{ headline?: string }>;
    venue?: { fullName: string };
  }>;
}

async function fetchESPN() {
  const ranges = ["20260611-20260703", "20260704-20260719"];
  const events: EspnEvent[] = [];

  for (const range of ranges) {
    try {
      const res = await fetch(`${ESPN_BASE}?dates=${range}&limit=100`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
        next: { revalidate: 180 },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { events?: EspnEvent[] };
      if (data.events) events.push(...data.events);
    } catch {
      // try next range
    }
  }

  const seen = new Set<string>();
  const unique = events.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  return unique.map((event) => {
    const comp = event.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === "home");
    const away = comp?.competitors?.find((c) => c.homeAway === "away");

    const groupNote = comp?.notes?.find((n) =>
      n.headline?.toLowerCase().includes("group")
    );
    const groupLetter =
      groupNote?.headline?.replace(/group\s*/i, "").trim() ?? "";

    const homeEn = home?.team?.displayName ?? "";
    const awayEn = away?.team?.displayName ?? "";

    const completed = event.status?.type?.completed ?? false;
    const live = event.status?.type?.state === "in";

    const homeScore = completed || live ? parseInt(home?.score ?? "") : null;
    const awayScore = completed || live ? parseInt(away?.score ?? "") : null;

    const date = new Date(event.date);

    return {
      id: event.id,
      stage: "group" as StageType,
      group: groupLetter || undefined,
      groupName: groupLetter ? GROUP_NAMES[groupLetter] : undefined,
      matchday: undefined,
      team1: toArabic(homeEn) || homeEn,
      team2: toArabic(awayEn) || awayEn,
      flag1: getFlag(homeEn),
      flag2: getFlag(awayEn),
      date: date.toISOString().split("T")[0],
      time: date.toISOString().slice(11, 16),
      venue: comp?.venue?.fullName ?? "",
      status: completed ? "FINISHED" : live ? "IN_PLAY" : "SCHEDULED",
      score:
        homeScore !== null && awayScore !== null
          ? { home: homeScore, away: awayScore }
          : null,
      live,
      completed,
    };
  });
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const matches = FDORG_KEY ? await fetchFDOrg() : await fetchESPN();
    cache = { data: matches, ts: Date.now() };
    return NextResponse.json(matches);
  } catch (err) {
    console.error("Schedule fetch failed:", err);
    // Return empty → client falls back to hardcoded data
    return NextResponse.json([], { status: 200 });
  }
}
