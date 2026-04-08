import { NextResponse } from "next/server";
import { getRunningExperiments } from "@/lib/data";

export async function GET() {
  const experiments = await getRunningExperiments();
  return NextResponse.json(experiments);
}
