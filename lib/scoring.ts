export type Prediction = { t1: number | ""; t2: number | "" };
export type ActualResult = { t1: number; t2: number; completed: boolean; live?: boolean };

function getResult(t1: number, t2: number): "home" | "draw" | "away" {
  if (t1 > t2) return "home";
  if (t2 > t1) return "away";
  return "draw";
}

export function calcPoints(
  pred: Prediction,
  actual: ActualResult
): { pts: number; kind: "exact" | "result" | "none" } {
  const p1 = pred.t1;
  const p2 = pred.t2;
  if (p1 === "" || p2 === "" || p1 == null || p2 == null) return { pts: 0, kind: "none" };

  if (Number(p1) === actual.t1 && Number(p2) === actual.t2) return { pts: 3, kind: "exact" };
  if (getResult(Number(p1), Number(p2)) === getResult(actual.t1, actual.t2)) return { pts: 1, kind: "result" };
  return { pts: 0, kind: "none" };
}

// مكافأة توقع البطل
export const CHAMPION_BONUS = 5;

export function calcUserScore(
  preds: Record<string, Prediction>,
  results: Record<string, ActualResult>,
  championPick?: string,
  actualChampion?: string
) {
  let total = 0, exact = 0, result = 0, missed = 0;
  const details: Record<string, ReturnType<typeof calcPoints>> = {};

  for (const [mid, actual] of Object.entries(results)) {
    if (!actual.completed) continue;
    const pred = preds[mid];
    if (!pred || pred.t1 === "" || pred.t2 === "") { missed++; continue; }
    const r = calcPoints(pred, actual);
    details[mid] = r;
    total += r.pts;
    if (r.kind === "exact") exact++;
    if (r.kind === "result") result++;
  }

  // +5 إذا أصاب توقع البطل (بعد اكتمال النهائي)
  const championHit = !!championPick && !!actualChampion && championPick === actualChampion;
  if (championHit) total += CHAMPION_BONUS;

  return { total, exact, result, missed, championHit, details };
}
