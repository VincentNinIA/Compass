import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { LanguageProvider } from "@/components/language-provider";

export const metadata: Metadata = {
  title: "Compass — Understand any exercise",
  description:
    "A bilingual tutor that reads any school exercise and helps students reason through it one step at a time.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
