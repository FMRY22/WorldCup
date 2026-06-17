import { NextRequest, NextResponse } from "next/server";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") || "";

  const urls = date
    ? [`${BASE}?dates=${date}&limit=50`]
    : [
        `${BASE}?limit=100`,
        `${BASE}?dates=20260611-20260703&limit=100`,
        `${BASE}?dates=20260704-20260719&limit=100`,
      ];

  const events: unknown[] = [];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
        next: { revalidate: 60 },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { events?: unknown[] };
      if (data.events) events.push(...data.events);
    } catch {
      // continue with other URLs
    }
  }

  // Deduplicate by id
  const seen = new Set<string>();
  const unique = events.filter((e: unknown) => {
    const ev = e as { id?: string };
    if (!ev.id || seen.has(ev.id)) return false;
    seen.add(ev.id);
    return true;
  });

  return NextResponse.json({ events: unique });
}
