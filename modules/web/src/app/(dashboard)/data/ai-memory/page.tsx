import { AiMemoryClient } from "@/components/ai-memory/ai-memory-client";

export default function AiMemoryPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">AI Memory</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          What the experimentation agent remembers about this project and about
          you. Edit or delete anything — the agent will read the latest version
          on the next turn.
        </p>
      </header>

      <AiMemoryClient />
    </div>
  );
}
