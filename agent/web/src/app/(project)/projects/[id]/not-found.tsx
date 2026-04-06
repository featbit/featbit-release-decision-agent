import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <h2 className="text-xl font-semibold">Project not found</h2>
      <p className="text-muted-foreground text-sm">
        The project you are looking for does not exist or has been deleted.
      </p>
      <Link
        href="/projects"
        className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
      >
        Back to Projects
      </Link>
    </div>
  );
}
