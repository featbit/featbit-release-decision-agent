"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Cable, Mail, ChevronRight } from "lucide-react";

/**
 * Two-option chooser surfaced when the user clicks "Request a data warehouse".
 *
 *   - Customer Managed Endpoint  → opens the add-provider form (sync, self-serve)
 *   - External Data Warehouse    → opens the email request dialog (async)
 *
 * The two flows are distinct enough that we keep the chooser thin — no fields,
 * no shared state, just two big buttons that close this dialog and signal the
 * parent which sub-dialog to open next.
 */
export function AddDataSourceChooserDialog({
  open,
  onClose,
  onPickCustomerEndpoint,
  onPickExternalWarehouse,
}: {
  open: boolean;
  onClose: () => void;
  onPickCustomerEndpoint: () => void;
  onPickExternalWarehouse: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a data source</DialogTitle>
          <DialogDescription>
            Pick how this project should get experiment data into FeatBit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={onPickCustomerEndpoint}
            className="group w-full rounded-xl border p-4 bg-card hover:border-brand/50 transition-colors text-left"
          >
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Cable className="size-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-sm font-semibold leading-tight">
                  Customer Managed Data Endpoint
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Self-host an HTTPS endpoint that returns experiment statistics
                  on demand. Self-service — works straight away.
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-brand transition-colors" />
            </div>
          </button>

          <button
            type="button"
            onClick={onPickExternalWarehouse}
            className="group w-full rounded-xl border p-4 bg-card hover:border-brand/50 transition-colors text-left"
          >
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-brand/10 group-hover:text-brand transition-colors">
                <Mail className="size-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-sm font-semibold leading-tight">
                  External Data Warehouse (request a connector)
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  ClickHouse, Snowflake, BigQuery, Databricks, etc. — tell us
                  which you need; we&apos;ll prioritise by demand.
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-brand transition-colors" />
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
