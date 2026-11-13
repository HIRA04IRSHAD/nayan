// POST /api/cases: the patient's phone sends a strip photo + prescription lines for a family member to check.
// Logic and validation live in lib/case-api.ts; storage behind lib/case-store.ts (files in data/cases/).
import { createCase } from "@/lib/case-api";
import { getCaseStore } from "@/lib/case-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return createCase(req, getCaseStore());
}
