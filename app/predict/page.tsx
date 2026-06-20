import dynamic from "next/dynamic";

const PredictClient = dynamic(() => import("./PredictClient"), { ssr: false });

export default function Page() {
  return <PredictClient />;
}
