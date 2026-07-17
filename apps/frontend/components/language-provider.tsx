"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppLanguage = "en" | "fr";

type LanguageContextValue = {
  language: AppLanguage;
  toggleLanguage(): void;
  text(english: string, french: string): string;
};

const DEFAULT_LANGUAGE_CONTEXT: LanguageContextValue = {
  language: "en",
  toggleLanguage: () => undefined,
  text: (english) => english,
};

const LanguageContext = createContext<LanguageContextValue>(
  DEFAULT_LANGUAGE_CONTEXT,
);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>("en");

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const toggleLanguage = useCallback(() => {
    setLanguage((current) => (current === "en" ? "fr" : "en"));
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      toggleLanguage,
      text: (english, french) => (language === "fr" ? french : english),
    }),
    [language, toggleLanguage],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

