import { DataWarehouseClient } from "@/components/data-warehouse/data-warehouse-client";

export default function DataWarehousePage() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Data warehouses</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Where your flag evaluations and metric events live. FeatBit Managed is
          active by default. Bring your own warehouse via a Customer Managed Data
          Endpoint, or request a managed connector for vendors we don&apos;t
          support yet.
        </p>
      </header>

      <DataWarehouseClient />
    </div>
  );
}
