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
    <div className="mx-auto max-w-6xl space-y-6 py-2">
      <div className="glass-panel flex flex-col gap-4 rounded-xl p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
            <FlaskConical className="size-3" /> Live experiments
          </div>
          <h1 className="text-3xl font-black tracking-tight">
            Release Decision Experiments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
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
        <Card className="surface-panel">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex size-14 items-center justify-center rounded-lg bg-accent text-primary ring-1 ring-primary/15">
              <FlaskConical className="size-7" />
            </div>
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
                <Card className="surface-panel h-full transition-all hover:-translate-y-0.5 hover:bg-card hover:shadow-xl hover:shadow-slate-950/10 dark:hover:shadow-black/20">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-tight">
                        {experiment.name}
                      </CardTitle>
                      <Badge
                        variant="secondary"
                        className={`shrink-0 text-xs font-bold ${stage.color}`}
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
                    <div className="flex items-center justify-end text-xs font-medium text-muted-foreground">
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
