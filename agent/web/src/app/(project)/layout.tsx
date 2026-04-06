export const dynamic = "force-dynamic";

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="h-dvh w-full flex flex-col">{children}</div>;
}
