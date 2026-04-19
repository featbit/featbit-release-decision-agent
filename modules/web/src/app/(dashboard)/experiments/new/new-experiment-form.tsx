"use client";

import { createExperimentAction } from "@/lib/actions";
import { useAuth } from "@/lib/featbit-auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";

export function NewExperimentForm() {
  const { currentProject, currentEnvironment } = useAuth();
  const projectKey = currentProject?.key ?? "";
  const projectName = currentProject?.name ?? "(no project selected)";
  const envName = currentEnvironment?.name ?? "";

  return (
    <form action={createExperimentAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Experiment Name</Label>
        <Input
          id="name"
          name="name"
          placeholder="e.g. Onboarding tooltip experiment"
          required
        />
      </div>
      <div className="space-y-2">
        <Label>FeatBit Project</Label>
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{projectName}</span>
          {projectKey && (
            <span className="font-mono text-xs text-muted-foreground">({projectKey})</span>
          )}
          {envName && (
            <span className="ml-auto text-xs text-muted-foreground">env: {envName}</span>
          )}
        </div>
        <input type="hidden" name="featbitProjectKey" value={projectKey} />
        <p className="text-xs text-muted-foreground">
          Determined by the workspace you're currently in. Switch workspace from the top bar to change.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          name="description"
          placeholder="What are you trying to learn or improve?"
          rows={3}
        />
      </div>
      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={!projectKey}>Create Experiment</Button>
        <Button nativeButton={false} variant="outline" render={<Link href="/experiments" />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
