"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check, ShieldAlert } from "lucide-react";

/**
 * One-shot secret reveal. Shows the plaintext signing secret immediately
 * after create or rotate — the API never returns it again. The dialog is
 * deliberately blocking: only "I've saved it" closes it, and we don't allow
 * Escape-to-close, so an operator can't dismiss it by accident before the
 * secret is captured somewhere.
 */
export function SecretRevealDialog({
  open,
  secret,
  context,
  onClose,
}: {
  open: boolean;
  secret: string | null;
  context: "created" | "rotated";
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function copyToClipboard() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Some environments (older browsers, non-HTTPS) don't expose clipboard.
      // Fall through silently — the secret is still selectable in the textarea.
    }
  }

  function close() {
    setCopied(false);
    setConfirmed(false);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block dismissal until the operator confirms they've saved it.
        if (!next && !confirmed) return;
        if (!next) close();
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-amber-600" />
            Signing secret — visible only once
          </DialogTitle>
          <DialogDescription>
            {context === "created"
              ? "We just generated this secret for your new endpoint."
              : "We just rotated this endpoint's signing secret."}{" "}
            Copy it into your endpoint's HMAC verifier <strong>now</strong> —
            FeatBit will never show it again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="rounded-md border bg-muted/30 p-3">
            <code className="block break-all font-mono text-xs leading-relaxed select-all">
              {secret ?? ""}
            </code>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyToClipboard}
            className="w-full"
          >
            {copied ? (
              <>
                <Check className="size-3.5" /> Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" /> Copy to clipboard
              </>
            )}
          </Button>

          {context === "rotated" && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              The previous secret stays valid as a <em>secondary</em> secret
              until you explicitly clear it from the endpoint's edit menu.
              This gives your customer-side verifier time to switch over
              without dropping in-flight requests.
            </p>
          )}

          <label className="flex items-start gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs text-muted-foreground leading-relaxed">
              I&apos;ve saved this secret somewhere I can retrieve it later.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button type="button" disabled={!confirmed} onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
