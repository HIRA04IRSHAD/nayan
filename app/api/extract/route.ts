import { handleExtract } from "@/lib/extract-api";

export const runtime = "nodejs";

// Validation, limits and error mapping live in lib/extract-api.ts (unit-tested without calling Gemini).
export const POST = (req: Request) => handleExtract(req);
