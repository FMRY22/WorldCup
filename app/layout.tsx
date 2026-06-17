import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "توقعات كأس العالم 2026",
  description: "شارك في مسابقة التوقعات لكأس العالم 2026",
  icons: { icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-arabic min-h-screen bg-pitch-dark text-white">
        {children}
      </body>
    </html>
  );
}
