import { notFound } from "next/navigation";
import { getExperiment } from "@/lib/data";
import { ExperimentDetailLayout } from "@/components/experiment/experiment-detail-layout";

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const experiment = await getExperiment(id);

  if (!experiment) {
    notFound();
  }

  return <ExperimentDetailLayout experiment={experiment} />;
}
