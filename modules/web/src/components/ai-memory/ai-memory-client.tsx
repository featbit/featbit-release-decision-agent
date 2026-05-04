"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/featbit-auth/auth-context";
import { MemoryEntryCard } from "./memory-entry-card";
import {
  PROJECT_TYPE_LABELS,
  PROJECT_TYPE_DESCRIPTIONS,
  USER_TYPE_LABELS,
  USER_TYPE_DESCRIPTIONS,
  type ProjectMemoryEntry,
  type UserProjectMemoryEntry,
} from "./types";
import { Users, User, RefreshCw, Plus, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export function AiMemoryClient() {
  const { profile, currentProject, isReady } = useAuth();

  const projectKey = currentProject?.key ?? null;
  const userId = profile?.id ?? null;

  const [projectEntries, setProjectEntries] = useState<ProjectMemoryEntry[]>([]);
  const [userEntries, setUserEntries] = useState<UserProjectMemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectKey) return;
    setLoading(true);
    setError(null);
    try {
      const [pRes, uRes] = await Promise.all([
        fetch(`/api/memory/project/${encodeURIComponent(projectKey)}`),
        userId
          ? fetch(
              `/api/memory/user/${encodeURIComponent(projectKey)}/${encodeURIComponent(userId)}`
            )
          : Promise.resolve(null),
      ]);
      if (!pRes.ok) throw new Error(`project memory: HTTP ${pRes.status}`);
      const pJson = (await pRes.json()) as ProjectMemoryEntry[];
      setProjectEntries(pJson);

      if (uRes) {
        if (!uRes.ok) throw new Error(`user memory: HTTP ${uRes.status}`);
        const uJson = (await uRes.json()) as UserProjectMemoryEntry[];
        setUserEntries(uJson);
      } else {
        setUserEntries([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectKey, userId]);

  useEffect(() => {
    if (isReady) load();
  }, [isReady, load]);

  const saveProject = async (entry: ProjectMemoryEntry, content: string) => {
    const res = await fetch(
      `/api/memory/project/${encodeURIComponent(entry.featbitProjectKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: entry.key,
          type: entry.type,
          content,
          sourceAgent: "ui-edit",
          createdByUserId: userId,
        }),
      }
    );
    if (!res.ok) throw new Error(`save failed: HTTP ${res.status}`);
    await load();
  };

  const deleteProject = async (entry: ProjectMemoryEntry) => {
    const res = await fetch(
      `/api/memory/project/${encodeURIComponent(entry.featbitProjectKey)}/${encodeURIComponent(entry.key)}`,
      { method: "DELETE" }
    );
    if (!res.ok) throw new Error(`delete failed: HTTP ${res.status}`);
    await load();
  };

  const addProject = async (key: string, type: string, content: string) => {
    const res = await fetch(
      `/api/memory/project/${encodeURIComponent(projectKey!)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, type, content, sourceAgent: "ui-manual", createdByUserId: userId }),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load();
  };

  const saveUser = async (entry: UserProjectMemoryEntry, content: string) => {
    const res = await fetch(
      `/api/memory/user/${encodeURIComponent(entry.featbitProjectKey)}/${encodeURIComponent(entry.featbitUserId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: entry.key,
          type: entry.type,
          content,
          sourceAgent: "ui-edit",
        }),
      }
    );
    if (!res.ok) throw new Error(`save failed: HTTP ${res.status}`);
    await load();
  };

  const deleteUser = async (entry: UserProjectMemoryEntry) => {
    const res = await fetch(
      `/api/memory/user/${encodeURIComponent(entry.featbitProjectKey)}/${encodeURIComponent(entry.featbitUserId)}/${encodeURIComponent(entry.key)}`,
      { method: "DELETE" }
    );
    if (!res.ok) throw new Error(`delete failed: HTTP ${res.status}`);
    await load();
  };

  const addUser = async (key: string, type: string, content: string) => {
    if (!userId) return;
    const res = await fetch(
      `/api/memory/user/${encodeURIComponent(projectKey!)}/${encodeURIComponent(userId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, type, content, sourceAgent: "ui-manual" }),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load();
  };

  if (!isReady) {
    return <p className="text-sm text-muted-foreground">Loading session…</p>;
  }

  if (!projectKey) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a FeatBit project from the top-right switcher to view its memory.
      </p>
    );
  }

  const projectByType = groupByType(projectEntries);
  const userByType = groupByType(userEntries);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw className={`size-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Project memory (shared)</h2>
          <span className="text-xs text-muted-foreground">
            {projectEntries.length} entries
          </span>
          <AddEntryDialog
            typeLabels={PROJECT_TYPE_LABELS}
            typeDescriptions={PROJECT_TYPE_DESCRIPTIONS}
            defaultType="product_facts"
            onSave={addProject}
          />
        </div>
        {projectEntries.length === 0 ? (
          <EmptyState>
            No project memory yet. When you run onboarding with project-agent,
            answers land here.
          </EmptyState>
        ) : (
          <TypeGroups
            groups={projectByType}
            labels={PROJECT_TYPE_LABELS}
            renderEntry={(entry) => (
              <MemoryEntryCard
                key={entry.id}
                entryId={entry.id}
                entryKey={entry.key}
                content={entry.content}
                sourceAgent={entry.sourceAgent}
                updatedAt={entry.updatedAt}
                editable={entry.editable}
                onSave={(content) => saveProject(entry, content)}
                onDelete={() => deleteProject(entry)}
              />
            )}
          />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <User className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Your memory (private)</h2>
          <span className="text-xs text-muted-foreground">
            {userEntries.length} entries
          </span>
          {userId && (
            <AddEntryDialog
              typeLabels={USER_TYPE_LABELS}
              typeDescriptions={USER_TYPE_DESCRIPTIONS}
              defaultType="capability"
              onSave={addUser}
            />
          )}
        </div>
        {!userId ? (
          <EmptyState>Sign in to view your private memory.</EmptyState>
        ) : userEntries.length === 0 ? (
          <EmptyState>
            No private memory yet. project-agent will ask a couple of
            calibration questions the first time you chat with it.
          </EmptyState>
        ) : (
          <TypeGroups
            groups={userByType}
            labels={USER_TYPE_LABELS}
            renderEntry={(entry) => (
              <MemoryEntryCard
                key={entry.id}
                entryId={entry.id}
                entryKey={entry.key}
                content={entry.content}
                sourceAgent={entry.sourceAgent}
                updatedAt={entry.updatedAt}
                editable={true}
                onSave={(content) => saveUser(entry, content)}
                onDelete={() => deleteUser(entry)}
              />
            )}
          />
        )}
      </section>
    </div>
  );
}

interface AddEntryDialogProps {
  typeLabels: Record<string, string>;
  typeDescriptions: Record<string, string>;
  defaultType: string;
  onSave: (key: string, type: string, content: string) => Promise<void>;
}

function AddEntryDialog({ typeLabels, typeDescriptions, defaultType, onSave }: AddEntryDialogProps) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [type, setType] = useState(defaultType);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setKey("");
    setType(defaultType);
    setContent("");
    setError(null);
  };

  const handleSave = async () => {
    if (!key.trim() || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(key.trim(), type, content.trim());
      reset();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto h-6 text-xs gap-1"
        onClick={() => { reset(); setOpen(true); }}
      >
        <Plus className="size-3" />
        Add
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add memory entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label htmlFor="entry-key">Key</Label>
              <Input
                id="entry-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="e.g. product_description"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="entry-type">Type</Label>
              <select
                id="entry-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {typeDescriptions[type] && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground mt-1">
                  <Info className="size-3 mt-0.5 shrink-0" />
                  {typeDescriptions[type]}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="entry-content">Content</Label>
              <Textarea
                id="entry-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                placeholder="Memory content…"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={handleSave}
              disabled={!key.trim() || !content.trim() || saving}
            >
              {saving && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function groupByType<T extends { type: string }>(entries: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const e of entries) {
    const list = map.get(e.type) ?? [];
    list.push(e);
    map.set(e.type, list);
  }
  return map;
}

function TypeGroups<T extends { id: string }>({
  groups,
  labels,
  renderEntry,
}: {
  groups: Map<string, T[]>;
  labels: Record<string, string>;
  renderEntry: (entry: T) => React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([type, list]) => (
        <div key={type} className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {labels[type] ?? type}
          </div>
          <div className="space-y-2">{list.map(renderEntry)}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
