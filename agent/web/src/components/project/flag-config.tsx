"use client";

import { updateFlagConfigAction } from "@/lib/actions";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flag } from "lucide-react";
import type { Project } from "@/generated/prisma/client";

export function FlagConfig({ project }: { project: Project }) {
  const isConfigured = Boolean(project.flagKey && project.envSecret);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flag className="size-4" />
            <CardTitle className="text-sm">Feature Flag</CardTitle>
          </div>
          <Badge variant={isConfigured ? "secondary" : "outline"} className="text-xs">
            {isConfigured ? "Configured" : "Not configured"}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Connection details passed to the sandbox when activated.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form key={project.updatedAt.toISOString()} action={updateFlagConfigAction} className="space-y-3">
          <input type="hidden" name="projectId" value={project.id} />
          <div className="space-y-1">
            <Label htmlFor="flagKey" className="text-xs">
              Flag Key
            </Label>
            <Input
              id="flagKey"
              name="flagKey"
              defaultValue={project.flagKey ?? ""}
              placeholder="e.g. onboarding-tooltip"
              className="text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="envSecret" className="text-xs">
              Env Secret
            </Label>
            <Input
              id="envSecret"
              name="envSecret"
              type="password"
              defaultValue={project.envSecret ?? ""}
              placeholder="FeatBit environment secret"
              className="text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="accessToken" className="text-xs">
              Access Token
            </Label>
            <Input
              id="accessToken"
              name="accessToken"
              type="password"
              defaultValue={project.accessToken ?? ""}
              placeholder="FeatBit API access token"
              className="text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="flagServerUrl" className="text-xs">
              Server URL
            </Label>
            <Input
              id="flagServerUrl"
              name="flagServerUrl"
              defaultValue={project.flagServerUrl ?? ""}
              placeholder="https://app.featbit.co"
              className="text-sm font-mono"
            />
          </div>
          <Button type="submit" size="sm" className="w-full">
            Save Configuration
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
