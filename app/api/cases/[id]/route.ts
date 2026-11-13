// GET /api/cases/[id] (token in the x-case-token header): the case for the caregiver page and for the patient's phone (polling).
import { getCase } from "@/lib/case-api";
import { getCaseStore } from "@/lib/case-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return getCase(req, (await params).id, getCaseStore());
}
