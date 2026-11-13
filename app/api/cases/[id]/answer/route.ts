// POST /api/cases/[id]/answer { t, answer, itemIndex?, note? }: the caregiver's one-time सही/गलत answer.
import { answerCase } from "@/lib/case-api";
import { getCaseStore } from "@/lib/case-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return answerCase(req, (await params).id, getCaseStore());
}
