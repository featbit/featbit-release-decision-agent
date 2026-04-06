import Link from "next/link";
import { getProjects } from "@/lib/data";
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

export default async function ProjectsPage() {
  const projects = await getProjects();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Release Decision Projects
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Each project tracks one feature flag through the full experiment
            loop.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/projects/new" />}>
          <Plus className="size-4" data-icon="inline-start" />
          New Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FlaskConical className="size-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold">No projects yet</h2>
            <p className="text-muted-foreground text-sm mt-1 mb-4">
              Create your first release decision project to get started.
            </p>
            <Button nativeButton={false} render={<Link href="/projects/new" />}>
              <Plus className="size-4" data-icon="inline-start" />
              Create Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const stage = getStage(project.stage);
            return (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="hover:border-foreground/20 transition-colors h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-tight">
                        {project.name}
                      </CardTitle>
                      <Badge
                        variant="secondary"
                        className={`shrink-0 text-xs ${stage.color}`}
                      >
                        {stage.label}
                      </Badge>
                    </div>
                    {project.description && (
                      <CardDescription className="line-clamp-2 text-xs">
                        {project.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {project._count.experiments} experiment
                        {project._count.experiments !== 1 ? "s" : ""}
                      </span>
                      <span>
                        Updated{" "}
                        {new Date(project.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                    {project.flagKey && (
                      <div className="mt-2">
                        <Badge variant="outline" className="text-xs font-mono">
                          {project.flagKey}
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
