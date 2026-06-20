"use client";

import { useState } from "react";
import Link from "next/link";
import { doc, setDoc, getDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, ROOM_ID } from "@/lib/firebase";

const STEPS = [
  {
    n: "١",
    title: "أنشئ مشروع Firebase",
    body: "افتح console.firebase.google.com، اضغط «إنشاء مشروع»، أدخل اسماً (مثل: worldcup2026)، ثم أكمل الخطوات. لا تحتاج Google Analytics.",
    link: { label: "افتح Firebase Console", href: "https://console.firebase.google.com" },
  },
  {
    n: "٢",
    title: "فعّل Firestore",
    body: "في القائمة الجانبية اختر «Build ← Firestore Database»، اضغط «Create database»، اختر «Start in test mode»، ثم «Enable».",
  },
  {
    n: "٣",
    title: "أضف تطبيق ويب",
    body: "من «Project Settings ← General» مرر للأسفل حتى «Your apps»، اضغط أيقونة «</>»، أدخل اسماً واضغط «Register app». ستظهر لك إعدادات firebaseConfig.",
  },
  {
    n: "٤",
    title: "أضف المتغيرات في Vercel",
    body: "افتح مشروعك في Vercel، اذهب إلى «Settings ← Environment Variables»، ثم أضف كل متغير من إعدادات Firebase:",
    vars: [
      ["NEXT_PUBLIC_FIREBASE_API_KEY", "apiKey"],
      ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "authDomain"],
      ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", "projectId"],
      ["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "storageBucket"],
      ["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "messagingSenderId"],
      ["NEXT_PUBLIC_FIREBASE_APP_ID", "appId"],
    ],
    link: { label: "افتح Vercel", href: "https://vercel.com/dashboard" },
  },
  {
    n: "٥",
    title: "أعِد النشر",
    body: "في Vercel اضغط «Deployments» ثم «Redeploy» على آخر نشر. بعد اكتمال النشر ستختفي الرسالة التجريبية وتبدأ المشاركة الفورية!",
  },
];

// ── اختبار اتصال Firestore فعلياً (كتابة ← قراءة ← حذف) ──────────────────────────
function FirebaseTest() {
  const [state, setState] = useState<"idle"|"testing"|"ok"|"fail">("idle");
  const [msg, setMsg]     = useState("");

  const run = async () => {
    setState("testing");
    setMsg("");
    if (!isFirebaseConfigured || !db) {
      setState("fail");
      setMsg("الإعدادات غير موجودة في هذا النشر — تأكد من إضافة المتغيرات في Vercel ثم أعد النشر.");
      return;
    }
    try {
      const ref = doc(db, "rooms", "__diagnostic__");
      await setDoc(ref, { ts: serverTimestamp(), room: ROOM_ID });
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("تمت الكتابة لكن فشلت القراءة");
      await deleteDoc(ref).catch(() => {}); // تنظيف (غير حرج)
      setState("ok");
      setMsg("الاتصال يعمل — التوقعات تُحفظ وتُقرأ من Firestore بنجاح.");
    } catch (e) {
      setState("fail");
      const raw = e instanceof Error ? e.message : String(e);
      // رسالة مفهومة لأشهر سبب: قواعد الأمان
      if (/permission|insufficient|PERMISSION/i.test(raw)) {
        setMsg("الاتصال تم لكن قواعد Firestore تمنع الكتابة. حدّث Rules كما في الأسفل (انتهت صلاحية وضع الاختبار غالباً).");
      } else if (/not been used|disabled|NOT_FOUND|database/i.test(raw)) {
        setMsg("لم يتم إنشاء قاعدة Firestore بعد، أو لم تُفعّل. أنشئها من Firebase Console (الخطوة ٢).");
      } else {
        setMsg(`فشل الاختبار: ${raw}`);
      }
    }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-black text-white text-sm">🔌 اختبار الاتصال</p>
          <p className="text-[11px] text-white/40 mt-0.5">يتحقق فعلياً من القراءة والكتابة في Firestore</p>
        </div>
        <button
          onClick={run}
          disabled={state === "testing"}
          className="btn-primary text-sm whitespace-nowrap disabled:opacity-50"
        >
          {state === "testing" ? "...جارٍ الفحص" : "ابدأ الاختبار"}
        </button>
      </div>
      {state === "ok" && (
        <div className="bg-green-500/15 border border-green-500/30 rounded-xl px-3 py-2 text-xs text-green-300">
          ✅ {msg}
        </div>
      )}
      {state === "fail" && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-xs text-red-300 leading-relaxed">
          ❌ {msg}
        </div>
      )}
    </div>
  );
}

export default function SetupPage() {
  const configured = isFirebaseConfigured;

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 bg-[#07111f]/95 backdrop-blur border-b border-white/10">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-white/40 hover:text-white transition text-lg">←</Link>
          <h1 className="font-black text-white text-sm">إعداد المشاركة الفورية</h1>
        </div>
      </nav>

      <div className="max-w-xl mx-auto px-4 pt-6 pb-20 space-y-6">

        {/* Status banner */}
        {configured ? (
          <div className="flex items-center gap-3 bg-green-500/15 border border-green-500/30 rounded-2xl p-4">
            <span className="text-2xl">✅</span>
            <div>
              <p className="font-black text-green-400">Firebase مفعّل</p>
              <p className="text-xs text-green-300/70 mt-0.5">التوقعات تُشارك مباشرة بين الجميع</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-black text-orange-300">وضع تجريبي — لا مشاركة</p>
              <p className="text-xs text-orange-300/60 mt-0.5">اتبع الخطوات أدناه لتفعيل المشاركة</p>
            </div>
          </div>
        )}

        {/* Connection test */}
        <FirebaseTest />

        {/* Why Firebase */}
        <div className="card p-5">
          <h2 className="font-black text-yellow-400 mb-3 flex items-center gap-2">
            <span>🔥</span> لماذا نحتاج Firebase؟
          </h2>
          <div className="space-y-3 text-sm text-white/65 leading-relaxed">
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">📱</span>
              <p>الآن: كل شخص يحفظ توقعاته على جهازه فقط — لا أحد يرى توقعات الآخرين.</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">🌐</span>
              <p>بعد الإعداد: توقعات الجميع تظهر فورياً لكل من يفتح الموقع، والترتيب يتحدث بشكل مباشر.</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">🆓</span>
              <p>Firebase مجاني تماماً للاستخدام الشخصي — لا بطاقة ائتمان.</p>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {STEPS.map((step) => (
            <div key={step.n} className="card overflow-hidden">
              <div className="flex items-center gap-3 bg-white/[0.03] px-4 py-3 border-b border-white/8">
                <span className="w-8 h-8 rounded-xl bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 font-black text-sm flex items-center justify-center flex-shrink-0">
                  {step.n}
                </span>
                <h3 className="font-black text-white text-sm">{step.title}</h3>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-sm text-white/60 leading-relaxed">{step.body}</p>

                {/* Env vars table */}
                {step.vars && (
                  <div className="bg-black/30 rounded-xl overflow-hidden border border-white/10">
                    <div className="grid text-[11px] divide-y divide-white/5">
                      <div className="grid grid-cols-2 px-3 py-1.5 text-white/30 font-bold">
                        <span>اسم المتغير في Vercel</span>
                        <span>القيمة من Firebase</span>
                      </div>
                      {step.vars.map(([key, val]) => (
                        <div key={key} className="grid grid-cols-2 gap-2 px-3 py-2">
                          <code className="text-yellow-400/90 font-mono break-all leading-tight">{key}</code>
                          <code className="text-blue-300/80 font-mono break-all leading-tight">{val}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Link button */}
                {step.link && (
                  <a
                    href={step.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-xs bg-white/5 hover:bg-white/10 border border-white/15 hover:border-white/30 text-white/70 hover:text-white rounded-lg px-3 py-2 transition-all"
                  >
                    <span>↗</span>
                    {step.link.label}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Help note */}
        <div className="text-center text-xs text-white/25 leading-relaxed">
          هل عندك مشكلة في الإعداد؟ افتح الموقع من جهاز آخر وتأكد أن التوقعات تظهر
          <br />للتأكد من النشر الصحيح اضغط Ctrl+Shift+R في المتصفح
        </div>

        <div className="flex gap-3 justify-center">
          <Link href="/predict" className="btn-primary text-sm">
            أدخل توقعاتي ←
          </Link>
          <Link href="/" className="btn-ghost text-sm">
            الصفحة الرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}
