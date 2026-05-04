import { NextResponse } from "next/server";
import { getRunningExperimentRuns } from "@/lib/data";
import { requireAuth } from "@/lib/server-auth/guard";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const runs = await getRunningExperimentRuns();
  return NextResponse.json(runs);
}
