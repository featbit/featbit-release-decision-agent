import { createProjectAction } from "@/lib/actions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NewProjectPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <Button nativeButton={false} variant="ghost" size="sm" render={<Link href="/projects" />}>
          <ArrowLeft className="size-4" data-icon="inline-start" />
          Back to Projects
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>New Release Decision Project</CardTitle>
          <CardDescription>
            Create a project to track a feature flag through the full experiment
            loop — from intent to decision.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createProjectAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Project Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g. Onboarding tooltip experiment"
                required
              />
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
              <Button type="submit">Create Project</Button>
              <Button nativeButton={false} variant="outline" render={<Link href="/projects" />}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
