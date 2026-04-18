"use client";

import { useMemo, useState } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mail, MessageSquare, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const POPULAR = [
  "ClickHouse",
  "PostgreSQL",
  "Snowflake",
  "PostHog",
  "BigQuery",
  "Redshift",
  "Databricks",
  "DuckDB",
];

function StyledCheckbox({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
        checked
          ? "border-brand bg-brand/5 text-foreground"
          : "border-border hover:bg-muted",
      )}
    >
      <Checkbox.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
          checked
            ? "border-brand bg-brand text-white"
            : "border-input bg-background",
        )}
      >
        <Checkbox.Indicator>
          <Check className="size-3" />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <span>{label}</span>
    </label>
  );
}

export function RequestProviderDialog({
  trigger,
}: {
  trigger: React.ReactElement;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [other, setOther] = useState("");
  const [notes, setNotes] = useState("");

  const picked = useMemo(
    () => [
      ...Object.entries(selected)
        .filter(([, v]) => v)
        .map(([k]) => k),
      ...other
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ],
    [selected, other],
  );

  const subject = "Data warehouse connector request";
  const body = [
    "Hi FeatBit team,",
    "",
    "I'd like to use the following data warehouse(s) with FeatBit Experimentation:",
    ...picked.map((p) => `  • ${p}`),
    "",
    notes ? `Notes:\n${notes}` : "",
    "",
    "Thanks!",
  ]
    .filter(Boolean)
    .join("\n");

  const mailto = `mailto:contact@featbit.co?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request a data warehouse</DialogTitle>
          <DialogDescription>
            Tell us which connectors you need. We prioritize by demand and
            accelerate for active teams.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Popular
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {POPULAR.map((name) => (
                <StyledCheckbox
                  key={name}
                  label={name}
                  checked={!!selected[name]}
                  onCheckedChange={(next) =>
                    setSelected((s) => ({ ...s, [name]: next }))
                  }
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="other-warehouse"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              Other (comma-separated)
            </label>
            <Input
              id="other-warehouse"
              placeholder="e.g. Materialize, StarRocks, Firebolt"
              value={other}
              onChange={(e) => setOther(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="notes"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              Context (optional)
            </label>
            <Textarea
              id="notes"
              placeholder="Rough event volume, deployment model, timeline..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Reach us via email or hop into our Discord — we respond faster
              when conversations stay visible to the whole team.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href="mailto:contact@featbit.co"
                className="inline-flex items-center gap-1.5 rounded-md border border-brand/30 bg-brand/5 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/10 transition-colors"
              >
                <Mail className="size-3.5" />
                contact@featbit.co
              </a>
              <a
                href="https://discord.gg/DhMZZAktc3"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-[#5865F2]/30 bg-[#5865F2]/5 px-2.5 py-1 text-xs font-medium text-[#5865F2] hover:bg-[#5865F2]/10 transition-colors"
              >
                <MessageSquare className="size-3.5" />
                Join Discord
              </a>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-1">
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button
            type="button"
            disabled={picked.length === 0}
            onClick={() => {
              window.location.href = mailto;
            }}
          >
            <Mail className="size-3.5" data-icon="inline-start" />
            {picked.length === 0
              ? "Pick at least one"
              : `Email request (${picked.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
