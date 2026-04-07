import { NextRequest, NextResponse } from "next/server";
import { addActivity, getProject } from "@/lib/data";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { type, title, detail } = body;

  if (!type || !title) {
    return NextResponse.json(
      { error: "type and title are required" },
      { status: 400 }
    );
  }

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const activity = await addActivity(id, { type, title, detail });
  return NextResponse.json(activity, { status: 201 });
}
