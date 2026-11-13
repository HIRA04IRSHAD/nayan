import { NextResponse } from "next/server";
import { serverLookup } from "@/lib/drugdb-server";

export const runtime = "nodejs";

const MAX_NAMES = 50;

// POST { names: string[] } → { results: { [name]: { entry, score } | null } }
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { names?: unknown } | null;
  const names = Array.isArray(body?.names) ? body.names.filter((n): n is string => typeof n === "string" && n.length <= 200) : null;
  if (!names || names.length > MAX_NAMES) return NextResponse.json({ error: "names must be up to 50 strings" }, { status: 400 });
  const results: Record<string, unknown> = {};
  for (const name of new Set(names)) results[name] = serverLookup(name);
  return NextResponse.json({ results });
}
