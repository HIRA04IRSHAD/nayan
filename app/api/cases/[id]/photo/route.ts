// GET /api/cases/[id]/photo (token in the x-case-token header): the strip photo (kept out of the JSON so the case stays small to poll).
import { getCasePhoto } from "@/lib/case-api";
import { getCaseStore } from "@/lib/case-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return getCasePhoto(req, (await params).id, getCaseStore());
}
