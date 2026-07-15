import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { LanguageProvider } from "@/components/language-provider";

export const metadata: Metadata = {
  title: "Compass — Make geometry click",
  description:
    "A bilingual geometry tutor that helps students build, test and understand one exercise at a time.",
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
