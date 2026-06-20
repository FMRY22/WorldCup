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

// يبحث عن النتيجة الفعلية لمباراة بغضّ النظر عن ترتيب الفريقين في المفتاح.
// لو وُجدت النتيجة بترتيب معكوس، تُقلب النتيجتان لتطابق ترتيب العرض.
export function findActual(
  team1: string,
  team2: string,
  results: Record<string, ActualResult>
): ActualResult | undefined {
  const direct = results[`${team1}|${team2}`];
  if (direct) return direct;
  const swapped = results[`${team2}|${team1}`];
  if (swapped) return { ...swapped, t1: swapped.t2, t2: swapped.t1 };
  return undefined;
}

// يجد توقع المستخدم لمباراة (team1 ضد team2) بأي ترتيب، مع محاذاة النتيجتين
// لترتيب العرض. يُستخدم في عرض البطاقات.
export function findUserPred(
  team1: string,
  team2: string,
  preds: Record<string, Prediction>
): Prediction | undefined {
  const direct = preds[`${team1}|${team2}`];
  if (direct && direct.t1 !== "" && direct.t2 !== "") return direct;
  const sw = preds[`${team2}|${team1}`];
  if (sw && sw.t1 !== "" && sw.t2 !== "") return { t1: sw.t2, t2: sw.t1 };
  return direct;
}

// يجد توقع المستخدم لنتيجة معيّنة بغضّ النظر عن ترتيب الفريقين.
function findPred(
  mid: string,
  preds: Record<string, Prediction>
): Prediction | undefined {
  const [a, b] = mid.split("|");
  return findUserPred(a, b, preds);
}

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
    const pred = findPred(mid, preds);
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
