import { notFound } from "next/navigation";
import { getProject } from "@/lib/data";
import { ProjectDetailLayout } from "@/components/project/project-detail-layout";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);

  if (!project) {
    notFound();
  }

  return <ProjectDetailLayout project={project} />;
}
