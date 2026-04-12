import { NextResponse } from "next/server";
import { getRunningExperimentRuns } from "@/lib/data";

export async function GET() {
  const runs = await getRunningExperimentRuns();
  return NextResponse.json(runs);
}
