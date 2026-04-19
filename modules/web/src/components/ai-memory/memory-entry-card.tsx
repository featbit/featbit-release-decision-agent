"use client";

import { useState } from "react";
import { Pencil, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface MemoryEntryCardProps {
  entryId: string;
  entryKey: string;
  content: string;
  sourceAgent: string | null;
  updatedAt: string;
  editable: boolean;
  onSave: (content: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function MemoryEntryCard({
  entryKey,
  content,
  sourceAgent,
  updatedAt,
  editable,
  onSave,
  onDelete,
}: MemoryEntryCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setIsEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm(`Delete "${entryKey}"?`)) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 space-y-2",
        deleting && "opacity-50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs font-mono text-muted-foreground">
              {entryKey}
            </code>
            {sourceAgent && (
              <span className="text-[10px] text-muted-foreground border rounded px-1 py-0.5">
                {sourceAgent}
              </span>
            )}
            {!editable && (
              <span className="text-[10px] text-amber-600 border border-amber-200 rounded px-1 py-0.5">
                read-only
              </span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">
            updated {new Date(updatedAt).toLocaleString()}
          </div>
        </div>
        {editable && !isEditing && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => {
                setDraft(content);
                setIsEditing(true);
              }}
              aria-label="Edit"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-destructive hover:text-destructive"
              onClick={del}
              disabled={deleting}
              aria-label="Delete"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(Math.max(2, draft.split("\n").length), 8)}
            className="text-sm"
            disabled={saving}
          />
          {error && <div className="text-xs text-destructive">{error}</div>}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="size-3.5 mr-1" />
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsEditing(false);
                setDraft(content);
                setError(null);
              }}
              disabled={saving}
            >
              <X className="size-3.5 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-sm whitespace-pre-wrap">{content}</div>
      )}
    </div>
  );
}
