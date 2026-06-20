export interface Match {
  id: string;
  stage: "group" | "r32" | "r16" | "qf" | "sf" | "third" | "final";
  group?: string;
  groupName?: string;
  matchday?: number;
  team1: string;
  team2: string;
  flag1: string;
  flag2: string;
  date: string;
  time: string;
  venue: string;
}

const GROUPS: {
  id: string;
  name: string;
  teams: { name: string; flag: string }[];
  dates: [string, string, string];
}[] = [
  {
    id: "A",
    name: "المجموعة أ",
    teams: [
      { name: "الولايات المتحدة", flag: "🇺🇸" },
      { name: "إسبانيا", flag: "🇪🇸" },
      { name: "المغرب", flag: "🇲🇦" },
      { name: "كوريا الجنوبية", flag: "🇰🇷" },
    ],
    dates: ["2026-06-12", "2026-06-21", "2026-06-30"],
  },
  {
    id: "B",
    name: "المجموعة ب",
    teams: [
      { name: "المكسيك", flag: "🇲🇽" },
      { name: "كولومبيا", flag: "🇨🇴" },
      { name: "الجزائر", flag: "🇩🇿" },
      { name: "صربيا", flag: "🇷🇸" },
    ],
    dates: ["2026-06-11", "2026-06-20", "2026-06-29"],
  },
  {
    id: "C",
    name: "المجموعة ج",
    teams: [
      { name: "كندا", flag: "🇨🇦" },
      { name: "بلجيكا", flag: "🇧🇪" },
      { name: "نيجيريا", flag: "🇳🇬" },
      { name: "اليابان", flag: "🇯🇵" },
    ],
    dates: ["2026-06-13", "2026-06-22", "2026-07-01"],
  },
  {
    id: "D",
    name: "المجموعة د",
    teams: [
      { name: "الأرجنتين", flag: "🇦🇷" },
      { name: "سويسرا", flag: "🇨🇭" },
      { name: "مصر", flag: "🇪🇬" },
      { name: "نيوزيلندا", flag: "🇳🇿" },
    ],
    dates: ["2026-06-14", "2026-06-23", "2026-07-02"],
  },
  {
    id: "E",
    name: "المجموعة هـ",
    teams: [
      { name: "فرنسا", flag: "🇫🇷" },
      { name: "كرواتيا", flag: "🇭🇷" },
      { name: "الإكوادور", flag: "🇪🇨" },
      { name: "تونس", flag: "🇹🇳" },
    ],
    dates: ["2026-06-15", "2026-06-24", "2026-07-03"],
  },
  {
    id: "F",
    name: "المجموعة و",
    teams: [
      { name: "إنجلترا", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
      { name: "إيطاليا", flag: "🇮🇹" },
      { name: "أوروغواي", flag: "🇺🇾" },
      { name: "السعودية", flag: "🇸🇦" },
    ],
    dates: ["2026-06-15", "2026-06-24", "2026-07-03"],
  },
  {
    id: "G",
    name: "المجموعة ز",
    teams: [
      { name: "ألمانيا", flag: "🇩🇪" },
      { name: "بنما", flag: "🇵🇦" },
      { name: "السنغال", flag: "🇸🇳" },
      { name: "أستراليا", flag: "🇦🇺" },
    ],
    dates: ["2026-06-16", "2026-06-25", "2026-07-04"],
  },
  {
    id: "H",
    name: "المجموعة ح",
    teams: [
      { name: "البرتغال", flag: "🇵🇹" },
      { name: "هولندا", flag: "🇳🇱" },
      { name: "الكاميرون", flag: "🇨🇲" },
      { name: "كوستاريكا", flag: "🇨🇷" },
    ],
    dates: ["2026-06-16", "2026-06-25", "2026-07-04"],
  },
  {
    id: "I",
    name: "المجموعة ط",
    teams: [
      { name: "البرازيل", flag: "🇧🇷" },
      { name: "الدنمارك", flag: "🇩🇰" },
      { name: "كوت ديفوار", flag: "🇨🇮" },
      { name: "إيران", flag: "🇮🇷" },
    ],
    dates: ["2026-06-17", "2026-06-26", "2026-07-05"],
  },
  {
    id: "J",
    name: "المجموعة ي",
    teams: [
      { name: "باراغواي", flag: "🇵🇾" },
      { name: "رومانيا", flag: "🇷🇴" },
      { name: "جنوب أفريقيا", flag: "🇿🇦" },
      { name: "قطر", flag: "🇶🇦" },
    ],
    dates: ["2026-06-17", "2026-06-26", "2026-07-05"],
  },
  {
    id: "K",
    name: "المجموعة ك",
    teams: [
      { name: "فنزويلا", flag: "🇻🇪" },
      { name: "اسكتلندا", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
      { name: "أوزبكستان", flag: "🇺🇿" },
      { name: "جامايكا", flag: "🇯🇲" },
    ],
    dates: ["2026-06-18", "2026-06-27", "2026-07-06"],
  },
  {
    id: "L",
    name: "المجموعة ل",
    teams: [
      { name: "بولندا", flag: "🇵🇱" },
      { name: "سلوفاكيا", flag: "🇸🇰" },
      { name: "البحرين", flag: "🇧🇭" },
      { name: "الأردن", flag: "🇯🇴" },
    ],
    dates: ["2026-06-18", "2026-06-27", "2026-07-06"],
  },
];

function generateGroupMatches(): Match[] {
  const matches: Match[] = [];

  for (const group of GROUPS) {
    const [t0, t1, t2, t3] = group.teams;
    const [d1, d2, d3] = group.dates;

    const groupMatches: Omit<Match, "id">[] = [
      // Matchday 1
      {
        stage: "group",
        group: group.id,
        groupName: group.name,
        matchday: 1,
        team1: t0.name,
        flag1: t0.flag,
        team2: t1.name,
        flag2: t1.flag,
        date: d1,
        time: "21:00",
        venue: getVenue(group.id, 1, 0),
      },
      {
        stage: "group",
        group: group.id,
        groupName: group.name,
        matchday: 1,
        team1: t2.name,
        flag1: t2.flag,
        team2: t3.name,
        flag2: t3.flag,
        date: d1,
        time: "18:00",
        venue: getVenue(group.id, 1, 1),
      },
      // Matchday 2
      {
        stage: "group",
        group: group.id,
        groupName: group.name,
        matchday: 2,
        team1: t0.name,
        flag1: t0.flag,
        team2: t2.name,
        flag2: t2.flag,
        date: d2,
        time: "21:00",
        venue: getVenue(group.id, 2, 0),
      },
      {
        stage: "group",
        group: group.id,
        groupName: group.name,
        matchday: 2,
        team1: t1.name,
        flag1: t1.flag,
        team2: t3.name,
        flag2: t3.flag,
        date: d2,
        time: "18:00",
        venue: getVenue(group.id, 2, 1),
      },
      // Matchday 3 (simultaneous)
      {
        stage: "group",
        group: group.id,
        groupName: group.name,
        matchday: 3,
        team1: t0.name,
        flag1: t0.flag,
        team2: t3.name,
        flag2: t3.flag,
        date: d3,
        time: "21:00",
        venue: getVenue(group.id, 3, 0),
      },
      {
        stage: "group",
        group: group.id,
        groupName: group.name,
        matchday: 3,
        team1: t1.name,
        flag1: t1.flag,
        team2: t2.name,
        flag2: t2.flag,
        date: d3,
        time: "21:00",
        venue: getVenue(group.id, 3, 1),
      },
    ];

    groupMatches.forEach((m, i) => {
      matches.push({ id: `${group.id}${i + 1}`, ...m });
    });
  }
  return matches;
}

const VENUES = [
  "سوفي ستاديوم - لوس أنجلوس",
  "ميتلايف ستاديوم - نيويورك",
  "AT&T ستاديوم - دالاس",
  "ملعب أزتيكا - مكسيكو سيتي",
  "سيزار سوبردوم - كانساس سيتي",
  "أليانز فيلد - سياتل",
  "BMO ستاديوم - لوس أنجلوس",
  "ستاديوم بي سي بليس - فانكوفر",
  "ستاديوم BMO - تورنتو",
  "لوب ستاديوم - أتلانتا",
  "ستاديوم هارد روك - ميامي",
  "ستاديوم خليفة الدولي - غوادالاخارا",
];

function getVenue(groupId: string, matchday: number, matchIndex: number): string {
  const idx = (groupId.charCodeAt(0) + matchday * 3 + matchIndex) % VENUES.length;
  return VENUES[idx];
}

const KNOCKOUT_STAGES: Match[] = [
  // Round of 32 (16 matches)
  ...Array.from({ length: 16 }, (_, i) => ({
    id: `R32_${i + 1}`,
    stage: "r32" as const,
    team1: "المنتخب المتأهل",
    team2: "المنتخب المتأهل",
    flag1: "🏆",
    flag2: "🏆",
    date: `2026-07-${(9 + Math.floor(i / 4)).toString().padStart(2, "0")}`,
    time: i % 2 === 0 ? "21:00" : "18:00",
    venue: VENUES[i % VENUES.length],
  })),
  // Round of 16 (8 matches)
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `R16_${i + 1}`,
    stage: "r16" as const,
    team1: "المنتخب المتأهل",
    team2: "المنتخب المتأهل",
    flag1: "🏆",
    flag2: "🏆",
    date: `2026-07-${(12 + Math.floor(i / 2)).toString().padStart(2, "0")}`,
    time: i % 2 === 0 ? "21:00" : "18:00",
    venue: VENUES[(i + 4) % VENUES.length],
  })),
  // Quarter-finals (4 matches)
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `QF_${i + 1}`,
    stage: "qf" as const,
    team1: "المنتخب المتأهل",
    team2: "المنتخب المتأهل",
    flag1: "🏆",
    flag2: "🏆",
    date: `2026-07-${(16 + Math.floor(i / 2)).toString().padStart(2, "0")}`,
    time: i % 2 === 0 ? "21:00" : "18:00",
    venue: VENUES[(i + 8) % VENUES.length],
  })),
  // Semi-finals (2 matches)
  {
    id: "SF_1",
    stage: "sf",
    team1: "المنتخب المتأهل",
    team2: "المنتخب المتأهل",
    flag1: "🏆",
    flag2: "🏆",
    date: "2026-07-18",
    time: "21:00",
    venue: "ميتلايف ستاديوم - نيويورك",
  },
  {
    id: "SF_2",
    stage: "sf",
    team1: "المنتخب المتأهل",
    team2: "المنتخب المتأهل",
    flag1: "🏆",
    flag2: "🏆",
    date: "2026-07-19",
    time: "21:00",
    venue: "سوفي ستاديوم - لوس أنجلوس",
  },
  // Third place
  {
    id: "THIRD",
    stage: "third",
    team1: "المنتخب المتأهل",
    team2: "المنتخب المتأهل",
    flag1: "🏆",
    flag2: "🏆",
    date: "2026-07-18",
    time: "18:00",
    venue: "AT&T ستاديوم - دالاس",
  },
  // Final
  {
    id: "FINAL",
    stage: "final",
    team1: "المنتخب المتأهل",
    team2: "المنتخب المتأهل",
    flag1: "🏆",
    flag2: "🏆",
    date: "2026-07-19",
    time: "21:00",
    venue: "ملعب أزتيكا - مكسيكو سيتي",
  },
];

export const ALL_MATCHES: Match[] = [
  ...generateGroupMatches(),
  ...KNOCKOUT_STAGES,
];

export const STAGE_LABELS: Record<string, string> = {
  group: "دور المجموعات",
  r32: "دور الـ 32",
  r16: "دور الـ 16",
  qf: "ربع النهائي",
  sf: "نصف النهائي",
  third: "مباراة الترتيب",
  final: "النهائي",
};

export const GROUP_NAMES: Record<string, string> = Object.fromEntries(
  GROUPS.map((g) => [g.id, g.name])
);
