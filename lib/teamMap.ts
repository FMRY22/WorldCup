// Maps Arabic team names → ESPN/API display names
export const AR_TO_EN: Record<string, string[]> = {
  "الولايات المتحدة": ["USA", "United States", "United States of America"],
  "إسبانيا": ["Spain"],
  "المغرب": ["Morocco"],
  "كوريا الجنوبية": ["South Korea", "Korea Republic", "Korea, Republic of", "Republic of Korea"],
  "المكسيك": ["Mexico"],
  "كولومبيا": ["Colombia"],
  "الجزائر": ["Algeria"],
  "صربيا": ["Serbia"],
  "كندا": ["Canada"],
  "بلجيكا": ["Belgium"],
  "نيجيريا": ["Nigeria"],
  "اليابان": ["Japan"],
  "الأرجنتين": ["Argentina"],
  "سويسرا": ["Switzerland"],
  "مصر": ["Egypt"],
  "نيوزيلندا": ["New Zealand"],
  "فرنسا": ["France"],
  "كرواتيا": ["Croatia"],
  "الإكوادور": ["Ecuador"],
  "تونس": ["Tunisia"],
  "إنجلترا": ["England"],
  "إيطاليا": ["Italy"],
  "أوروغواي": ["Uruguay"],
  "السعودية": ["Saudi Arabia"],
  "ألمانيا": ["Germany"],
  "بنما": ["Panama"],
  "السنغال": ["Senegal"],
  "أستراليا": ["Australia"],
  "البرتغال": ["Portugal"],
  "هولندا": ["Netherlands", "Holland"],
  "الكاميرون": ["Cameroon"],
  "كوستاريكا": ["Costa Rica"],
  "البرازيل": ["Brazil"],
  "الدنمارك": ["Denmark"],
  "كوت ديفوار": ["Ivory Coast", "Côte d'Ivoire", "Cote d'Ivoire"],
  "إيران": ["Iran", "IR Iran", "Islamic Republic of Iran"],
  "باراغواي": ["Paraguay"],
  "رومانيا": ["Romania"],
  "جنوب أفريقيا": ["South Africa"],
  "قطر": ["Qatar"],
  "فنزويلا": ["Venezuela"],
  "اسكتلندا": ["Scotland"],
  "أوزبكستان": ["Uzbekistan"],
  "جامايكا": ["Jamaica"],
  "بولندا": ["Poland"],
  "سلوفاكيا": ["Slovakia"],
  "البحرين": ["Bahrain"],
  "الأردن": ["Jordan"],
  // فرق ظهرت في ESPN لكن كانت ناقصة من القائمة
  "التشيك": ["Czechia", "Czech Republic"],
  "البوسنة والهرسك": ["Bosnia-Herzegovina", "Bosnia and Herzegovina", "Bosnia & Herzegovina"],
  "تركيا": ["Türkiye", "Turkey"],
  "الرأس الأخضر": ["Cape Verde"],
  "الكونغو الديمقراطية": ["Congo DR", "DR Congo", "Democratic Republic of Congo"],
  "النمسا": ["Austria"],
  "النرويج": ["Norway"],
  "العراق": ["Iraq"],
  "غانا": ["Ghana"],
  "السويد": ["Sweden"],
  "هايتي": ["Haiti"],
  "كوراساو": ["Curaçao", "Curacao"],
};

// Build reverse map: English → Arabic
export const EN_TO_AR: Record<string, string> = {};
for (const [ar, ens] of Object.entries(AR_TO_EN)) {
  for (const en of ens) {
    EN_TO_AR[en.toLowerCase()] = ar;
  }
}

export function toArabic(name: string): string {
  return EN_TO_AR[name.toLowerCase()] || name;
}

export function matchesArabicName(arabicName: string, espnName: string): boolean {
  const variants = AR_TO_EN[arabicName] || [];
  return variants.some(v => v.toLowerCase() === espnName.toLowerCase());
}
