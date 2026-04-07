"use client";

import { useState } from "react";
import { updateFlagConfigAction } from "@/lib/actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flag, Pencil, Eye, EyeOff } from "lucide-react";
import type { Project } from "@/generated/prisma/client";

/* ── Password input with visibility toggle ── */
function SecretInput({
  id,
  name,
  defaultValue,
  placeholder,
}: {
  id: string;
  name: string;
  defaultValue: string;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="text-sm font-mono pr-9"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
      >
        {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

/* ── Mask helper for read-only display ── */
function mask(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 6) return "••••••";
  return value.slice(0, 3) + "••••" + value.slice(-3);
}

export function FlagConfig({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const isConfigured = Boolean(project.flagKey && project.envSecret);

  return (
    <>
      {/* Compact read-only display */}
      {isConfigured ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs rounded-md border px-3 py-2 bg-muted/20">
          <span>
            <span className="text-muted-foreground">Flag:</span>{" "}
            <span className="font-mono font-medium">{project.flagKey}</span>
          </span>
          {project.flagServerUrl && (
            <span className="min-w-0">
              <span className="text-muted-foreground">Server:</span>{" "}
              <span className="font-mono truncate">{project.flagServerUrl}</span>
            </span>
          )}
          <Badge variant="secondary" className="text-[10px]">Configured</Badge>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-3" />
          </button>
        </div>
      ) : (
        <div className="flex items-center rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground/50 italic">
          <span className="flex-1">Not configured yet.</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-muted-foreground hover:text-foreground ml-2"
          >
            <Pencil className="size-3" />
          </button>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Flag className="size-4" />
              Feature Flag Configuration
            </DialogTitle>
            <DialogDescription className="text-xs">
              Connection details passed to the sandbox when activated.
            </DialogDescription>
          </DialogHeader>

          <form
            key={project.updatedAt.toISOString()}
            action={async (formData) => {
              await updateFlagConfigAction(formData);
              setOpen(false);
            }}
            className="space-y-3"
          >
            <input type="hidden" name="projectId" value={project.id} />

            <div className="space-y-1">
              <Label htmlFor="flagKey" className="text-xs">Flag Key</Label>
              <Input
                id="flagKey"
                name="flagKey"
                defaultValue={project.flagKey ?? ""}
                placeholder="e.g. onboarding-tooltip"
                className="text-sm font-mono"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="envSecret" className="text-xs">Env Secret</Label>
              <SecretInput
                id="envSecret"
                name="envSecret"
                defaultValue={project.envSecret ?? ""}
                placeholder="FeatBit environment secret"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="accessToken" className="text-xs">Access Token</Label>
              <SecretInput
                id="accessToken"
                name="accessToken"
                defaultValue={project.accessToken ?? ""}
                placeholder="FeatBit API access token"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="flagServerUrl" className="text-xs">Server URL</Label>
              <Input
                id="flagServerUrl"
                name="flagServerUrl"
                defaultValue={project.flagServerUrl ?? ""}
                placeholder="https://app.featbit.co"
                className="text-sm font-mono"
              />
            </div>

            <DialogFooter>
              <Button type="submit" size="sm">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
