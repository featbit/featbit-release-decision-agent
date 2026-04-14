import Link from "next/link";
import { getExperiments } from "@/lib/data";
import { getStage } from "@/lib/stages";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, FlaskConical } from "lucide-react";

export default async function ExperimentsPage() {
  const experiments = await getExperiments();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Release Decision Experiments
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Each experiment tracks one feature flag through the full experiment
            loop.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/experiments/new" />}>
          <Plus className="size-4" data-icon="inline-start" />
          New Experiment
        </Button>
      </div>

      {experiments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FlaskConical className="size-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold">No experiments yet</h2>
            <p className="text-muted-foreground text-sm mt-1 mb-4">
              Create your first release decision experiment to get started.
            </p>
            <Button nativeButton={false} render={<Link href="/experiments/new" />}>
              <Plus className="size-4" data-icon="inline-start" />
              Create Experiment
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {experiments.map((experiment) => {
            const stage = getStage(experiment.stage);
            return (
              <Link key={experiment.id} href={`/experiments/${experiment.id}`}>
                <Card className="hover:border-foreground/20 transition-colors h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-tight">
                        {experiment.name}
                      </CardTitle>
                      <Badge
                        variant="secondary"
                        className={`shrink-0 text-xs ${stage.color}`}
                      >
                        {stage.label}
                      </Badge>
                    </div>
                    {experiment.description && (
                      <CardDescription className="line-clamp-2 text-xs">
                        {experiment.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-end text-xs text-muted-foreground">
                      <span>
                        Updated{" "}
                        {new Date(experiment.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                    {experiment.flagKey && (
                      <div className="mt-2">
                        <Badge variant="outline" className="text-xs font-mono">
                          {experiment.flagKey}
                        </Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
