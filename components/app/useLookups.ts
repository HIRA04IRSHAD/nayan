"use client";
// The medicine lookup cache (lib/client.ts) starts empty after a reload. Screens that show salts for saved
// lines call this so brand-only lines are looked up again; the component re-renders when answers arrive.

import { useEffect, useState } from "react";
import { fetchLookups } from "@/lib/client";

export function useLookups(names: string[]): number {
  const [version, setVersion] = useState(0);
  const key = names.join("\u0000");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void fetchLookups(key.split("\u0000")).then(() => alive && setVersion((v) => v + 1));
    return () => {
      alive = false;
    };
  }, [key]);
  return version;
}
