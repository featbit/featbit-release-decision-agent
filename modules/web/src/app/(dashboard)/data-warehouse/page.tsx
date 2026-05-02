import { Badge } from "@/components/ui/badge";
import { Database, CheckCircle2, Plus, Cable } from "lucide-react";
import { RequestProviderDialog } from "@/components/data-warehouse/request-provider-dialog";
import { CustomerEndpointsSection } from "@/components/data-warehouse/customer-endpoints-section";

export default function DataWarehousePage() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Data warehouses</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Where your flag evaluations and metric events live. FeatBit Managed is
          active by default. Bring your own warehouse via a Customer Managed Data
          Endpoint, or request a new connector.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* FeatBit-managed */}
        <div className="rounded-xl border p-4 bg-card ring-1 ring-brand/40">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Database className="size-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold leading-tight">
                  FeatBit Managed Data Warehouse
                </h3>
                <Badge className="bg-brand/10 text-brand border-0 text-[10px]">
                  <CheckCircle2 className="size-3 mr-1" />
                  Connected
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                ClickHouse hosted by FeatBit. Zero setup — flag evaluations and
                metric events already land here.
              </p>
            </div>
          </div>
        </div>

        {/* Customer Managed Data Endpoints — overview card.
            The full list/CRUD lives in the section below. */}
        <a
          href="#customer-endpoints"
          className="group rounded-xl border p-4 bg-card hover:border-brand/50 transition-colors text-left"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Cable className="size-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="text-sm font-semibold leading-tight">
                Customer Managed Data Endpoints
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Plug FeatBit&apos;s analyser into your own warehouse via an HTTPS
                endpoint that returns experiment statistics on demand.
              </p>
            </div>
          </div>
        </a>

        {/* Request a new warehouse */}
        <RequestProviderDialog
          trigger={
            <button
              type="button"
              className="group rounded-xl border border-dashed p-4 bg-muted/20 hover:bg-muted/40 hover:border-brand/50 transition-colors text-left w-full cursor-pointer"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-brand/10 group-hover:text-brand transition-colors">
                  <Plus className="size-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <h3 className="text-sm font-semibold leading-tight">
                    Request a data warehouse
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    ClickHouse, Postgres, Snowflake, PostHog, BigQuery… tell us
                    which ones you need.
                  </p>
                </div>
              </div>
            </button>
          }
        />
      </div>

      <div id="customer-endpoints" className="scroll-mt-6">
        <CustomerEndpointsSection />
      </div>
    </div>
  );
}
