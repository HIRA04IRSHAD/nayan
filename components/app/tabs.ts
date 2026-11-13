// The four bottom-navigation tabs. Add a tab here and a case in components/NayanApp.tsx (screenFor).
import type { IconName } from "@/components/ui/Icon";

export type TabId = "check" | "today" | "meds" | "family";

export const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: "check", label: "जाँचें", icon: "scan" },
  { id: "today", label: "आज", icon: "calendar" },
  { id: "meds", label: "मेरी दवाएँ", icon: "pills" },
  { id: "family", label: "परिवार", icon: "family" },
];

export const DEFAULT_TAB: TabId = "check";
