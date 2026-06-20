import dynamic from "next/dynamic";

// ssr: false — لا SSR، الكومبوننت يتحمّل مباشرة على الكلاينت
// هذا يسمح لـ useState initializers بقراءة localStorage فوراً
// بدون انتظار hydration → لا تأخير في ظهور التوقعات
const HomeClient = dynamic(() => import("./HomeClient"), { ssr: false });

export default function Page() {
  return <HomeClient />;
}
