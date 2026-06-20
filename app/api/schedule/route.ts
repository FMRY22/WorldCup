import { NextResponse } from "next/server";
import { EN_TO_AR } from "@/lib/teamMap";
import { getFlag } from "@/lib/flags";

export const dynamic = "force-dynamic";

const APISPORTS_KEY = process.env.APISPORTS_KEY;
const APISPORTS_URL = "https://v3.football.api-sports.io/fixtures?league=1&season=2026";

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
const TTL_LIVE = 60 * 1000;       // 60s عند وجود مباراة مباشرة
const TTL_IDLE = 10 * 60 * 1000;  // 10 دقائق بدون مباريات مباشرة

// تحويل UTC → توقيت السعودية (UTC+3)
function toSaudiTime(utcDate: Date): { date: string; time: string } {
  const local = new Date(utcDate.getTime() + 3 * 60 * 60 * 1000);
  return {
    date: local.toISOString().split("T")[0],
    time: local.toISOString().slice(11, 16),
  };
}

// ── api-sports.io (API-Football) ──────────────────────────────────────────────

interface ApiSportsFixture {
  fixture: {
    id: number;
    date: string;
    status: { long: string; short: string; elapsed: number | null };
    venue: { name: string; city: string } | null;
  };
  league: { id: number; round: string; group: string | null };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
  events?: Array<{
    time: { elapsed: number; extra: number | null };
    team: { id: number; name: string };
    player: { id: number; name: string };
    type: string;
    detail: string;
  }>;
}

const LIVE_STATUSES = new Set(["1H", "2H", "HT", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);
const DONE_STATUSES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);

function parseApiSportsStage(round: string): StageType {
  const r = round.toLowerCase();
  if (r.includes("group")) return "group";
  if (r.includes("round of 32")) return "r32";
  if (r.includes("round of 16")) return "r16";
  if (r.includes("quarter")) return "qf";
  if (r.includes("semi")) return "sf";
  if (r.includes("3rd") || r.includes("third")) return "third";
  if (r.includes("final")) return "final";
  return "group";
}

async function fetchApiSportsEvents(fixtureId: number): Promise<ApiSportsFixture["events"]> {
  try {
    const res = await fetch(
      `https://v3.football.api-sports.io/fixtures/events?fixture=${fixtureId}`,
      { headers: { "x-apisports-key": APISPORTS_KEY! }, cache: "no-store" }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      response: Array<{
        time: { elapsed: number; extra: number | null };
        team: { id: number; name: string };
        player: { id: number; name: string };
        type: string;
        detail: string;
      }>;
    };
    return data.response;
  } catch {
    return [];
  }
}

async function fetchApiSports() {
  console.log(`[api-sports] key set: ${!!APISPORTS_KEY}, length: ${APISPORTS_KEY?.length ?? 0}`);
  const res = await fetch(APISPORTS_URL, {
    headers: { "x-apisports-key": APISPORTS_KEY! },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`api-sports ${res.status}`);
  const data = (await res.json()) as { response: ApiSportsFixture[]; errors?: unknown };

  if (data.errors && Object.keys(data.errors as object).length > 0) {
    console.error("api-sports error:", JSON.stringify(data.errors));
    throw new Error("api-sports returned errors");
  }
  console.log(`[api-sports] fixtures: ${data.response?.length ?? 0}`);
  if (data.response?.length > 0) {
    const f0 = data.response[0];
    console.log(`[api-sports] sample: ${f0.teams.home.name} vs ${f0.teams.away.name} | round: ${f0.league.round} | group: ${f0.league.group}`);
  }
  if (!data.response?.length) throw new Error("api-sports returned 0 fixtures");

  const todaySaudi = toSaudiTime(new Date()).date;

  // جلب events فقط لمباريات اليوم المنتهية أو المباشرة (توفيراً للطلبات)
  const todayActive = data.response.filter(f => {
    const short = f.fixture.status.short;
    const { date } = toSaudiTime(new Date(f.fixture.date));
    return date === todaySaudi && (LIVE_STATUSES.has(short) || DONE_STATUSES.has(short));
  });

  const eventsMap = new Map<number, NonNullable<ApiSportsFixture["events"]>>();
  await Promise.all(
    todayActive.map(async f => {
      const events = await fetchApiSportsEvents(f.fixture.id);
      eventsMap.set(f.fixture.id, events ?? []);
    })
  );

  return data.response.map((f) => {
    const short = f.fixture.status.short;
    const live = LIVE_STATUSES.has(short);
    const finished = DONE_STATUSES.has(short);

    const { date: matchDate, time: matchTime } = toSaudiTime(new Date(f.fixture.date));
    const stage = parseApiSportsStage(f.league.round);
    const groupRaw = f.league.group ?? "";
    const groupLetter = groupRaw.replace(/group\s*/i, "").trim();

    const homeEn = f.teams.home.name;
    const awayEn = f.teams.away.name;

    const homeScore = (live || finished) ? (f.goals.home ?? null) : null;
    const awayScore = (live || finished) ? (f.goals.away ?? null) : null;

    const events = eventsMap.get(f.fixture.id) ?? [];
    const scorers = events
      .filter(e => e.type === "Goal")
      .map(e => ({
        name: e.detail === "Own Goal" ? "Own Goal" : e.player.name,
        minute: e.time.elapsed ?? undefined,
        team: e.team.id === f.teams.home.id ? "home" as const : "away" as const,
      }));

    return {
      id: String(f.fixture.id),
      stage,
      group: groupLetter || undefined,
      groupName: groupLetter ? GROUP_NAMES[groupLetter] : undefined,
      matchday: undefined,
      team1: toArabic(homeEn),
      team2: toArabic(awayEn),
      flag1: getFlag(homeEn),
      flag2: getFlag(awayEn),
      date: matchDate,
      time: matchTime,
      venue: f.fixture.venue?.name ?? "",
      status: finished ? "FINISHED" : live ? "IN_PLAY" : "SCHEDULED",
      score: homeScore !== null && awayScore !== null ? { home: homeScore, away: awayScore } : null,
      live,
      completed: finished,
      minute: live ? (f.fixture.status.elapsed ?? undefined) : undefined,
      scorers: (finished || live) ? scorers : [],
    };
  });
}

// ── football-data.org ─────────────────────────────────────────────────────────

interface FdorgTeam { id: number; name: string; shortName: string }
interface FdorgGoal {
  minute: number | null;
  type: string;
  team: { id: number; name: string };
  scorer: { name: string | null };
}
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
  goals?: FdorgGoal[];
  minute?: number | null;
  venue?: string;
}

async function fetchFDOrg() {
  const res = await fetch(FDORG_URL, {
    headers: { "X-Auth-Token": FDORG_KEY! },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`football-data.org ${res.status}`);
  const data = (await res.json()) as { matches: FdorgMatch[] };

  return data.matches.map((m) => {
    const groupLetter = m.group?.replace("GROUP_", "") ?? "";
    const stage: StageType = FDORG_STAGE[m.stage] ?? "group";
    const { date: matchDate, time: matchTime } = toSaudiTime(new Date(m.utcDate));

    const homeEn = m.homeTeam.name || m.homeTeam.shortName;
    const awayEn = m.awayTeam.name || m.awayTeam.shortName;

    const homeScore = m.score?.fullTime?.home;
    const awayScore = m.score?.fullTime?.away;
    const finished = m.status === "FINISHED";
    const live = m.status === "IN_PLAY" || m.status === "PAUSED";

    const goals = m.goals?.map(g => ({
      name: g.scorer?.name ?? "?",
      minute: g.minute ?? undefined,
      team: g.team.id === m.homeTeam.id ? "home" as const : "away" as const,
    })) ?? [];

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
      date: matchDate,
      time: matchTime,
      venue: m.venue ?? "",
      status: m.status,
      score:
        (finished || live) && homeScore !== null && awayScore !== null
          ? { home: homeScore, away: awayScore }
          : null,
      live,
      completed: finished,
      minute: live ? (m.minute ?? undefined) : undefined,
      scorers: (finished || live) ? goals : [],
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
  status: {
    type: {
      completed: boolean;
      state: string;
      displayClock?: string;
    };
  };
  competitions: Array<{
    competitors: EspnCompetitor[];
    notes: Array<{ headline?: string }>;
    venue?: { fullName: string };
    details?: Array<{
      scoringPlay?: boolean;
      homeAway?: string;
      athletesInvolved?: Array<{ displayName: string }>;
      clock?: { displayValue?: string };
    }>;
  }>;
}

function detectEspnStage(homeEn: string, awayEn: string): StageType {
  const s = (homeEn + " " + awayEn).toLowerCase();
  if (s.includes("semifinal") && s.includes("loser")) return "third";
  if (s.includes("semifinal"))   return "final";
  if (s.includes("quarterfinal")) return "sf";
  if (s.includes("round of 16")) return "qf";
  if (s.includes("round of 32")) return "r16";
  if (s.includes("group") || s.includes("third place")) return "r32";
  return "group";
}

async function fetchESPN() {
  const ranges = ["20260611-20260703", "20260704-20260719"];
  const events: EspnEvent[] = [];

  for (const range of ranges) {
    try {
      const res = await fetch(`${ESPN_BASE}?dates=${range}&limit=100`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
        cache: "no-store",
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

    const { date: matchDate, time: matchTime } = toSaudiTime(new Date(event.date));
    const stage = detectEspnStage(homeEn, awayEn);
    // للمجموعات فقط نأخذ الحرف من الملاحظات
    const resolvedGroup = stage === "group" ? (groupLetter || undefined) : undefined;

    const displayClock = event.status?.type?.displayClock;
    const minute = live && displayClock
      ? (parseInt(displayClock.replace("+", "").split(":")[0]) || undefined)
      : undefined;

    const details = comp?.details ?? [];
    const scorers = details
      .filter(d => d.scoringPlay)
      .map(d => ({
        name: d.athletesInvolved?.[0]?.displayName ?? "?",
        minute: d.clock?.displayValue ? (parseInt(d.clock.displayValue) || undefined) : undefined,
        team: (d.homeAway === "home" ? "home" : "away") as "home" | "away",
      }));

    return {
      id: event.id,
      stage,
      group: resolvedGroup,
      groupName: resolvedGroup ? GROUP_NAMES[resolvedGroup] : undefined,
      matchday: undefined,
      team1: toArabic(homeEn) || homeEn,
      team2: toArabic(awayEn) || awayEn,
      flag1: getFlag(homeEn),
      flag2: getFlag(awayEn),
      date: matchDate,
      time: matchTime,
      venue: comp?.venue?.fullName ?? "",
      status: completed ? "FINISHED" : live ? "IN_PLAY" : "SCHEDULED",
      score:
        homeScore !== null && awayScore !== null
          ? { home: homeScore, away: awayScore }
          : null,
      live,
      completed,
      minute,
      scorers: (completed || live) ? scorers : [],
    };
  });
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function GET() {
  const hasLive = (cache?.data as Array<{ live?: boolean }>)?.some(m => m.live);
  const ttl = hasLive ? TTL_LIVE : TTL_IDLE;
  if (cache && Date.now() - cache.ts < ttl) {
    return NextResponse.json(cache.data);
  }

  try {
    const matches = APISPORTS_KEY
      ? await fetchApiSports()
      : FDORG_KEY
      ? await fetchFDOrg()
      : await fetchESPN();
    cache = { data: matches, ts: Date.now() };
    return NextResponse.json(matches);
  } catch (err) {
    console.error("Schedule fetch failed:", err);
    if (cache) return NextResponse.json(cache.data);
    return NextResponse.json([], { status: 200 });
  }
}
