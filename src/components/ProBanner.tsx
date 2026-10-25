import { Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";

/** Legacy export names retained for callers; no commercial subscription surface. */
export function ProBanner() {
  return (
    <div className="mt-6 text-center text-sm text-muted-foreground">
      Use your own API keys, local models, or a connected provider account.{" "}
      <SetupDyadProButton />
    </div>
  );
}
export function SetupDyadProButton() {
  return (
    <Link to="/settings" className="inline-flex items-center gap-1 underline">
      <KeyRound className="size-3.5" />
      Configure providers
    </Link>
  );
}
export const AiAccessBanner = ProBanner;
export const SmartContextBanner = ProBanner;
