import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import "./globals.css";
import {
  DemoAccessGate,
  DemoSessionControl,
} from "@/components/demo-access-gate";
import { LanguageProvider } from "@/components/language-provider";
import {
  DEMO_SESSION_COOKIE_NAME,
  readDemoProtectionConfig,
  verifyDemoSession,
} from "@/lib/demo-access/server";

export const metadata: Metadata = {
  title: "Compass — Understand any exercise",
  description:
    "A bilingual tutor that reads any school exercise and helps students reason through it one step at a time.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const protection = readDemoProtectionConfig();
  let content = children;
  if (protection.status === "unavailable") {
    content = <DemoAccessGate unavailable />;
  } else if (protection.status === "enabled") {
    const session = verifyDemoSession(
      (await cookies()).get(DEMO_SESSION_COOKIE_NAME)?.value,
      protection,
    );
    content =
      session.status === "authorized" ? (
        <>
          {children}
          <DemoSessionControl />
        </>
      ) : (
        <DemoAccessGate />
      );
  }
  return (
    <html lang="en">
      <body>
        <LanguageProvider>{content}</LanguageProvider>
      </body>
    </html>
  );
}
