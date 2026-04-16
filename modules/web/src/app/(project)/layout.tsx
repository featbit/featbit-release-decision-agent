export const dynamic = "force-dynamic";

export default function ExperimentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="h-dvh w-full flex flex-col">{children}</div>;
}
