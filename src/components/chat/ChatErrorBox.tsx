import { parseSubscriptionBillingError } from "@/shared/subscription_billing_error";
import { ipc } from "@/ipc/types";
import { X, MessageSquarePlus, ArrowRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";

export function ChatErrorBox({
  onDismiss,
  error,
  onStartNewChat,
  onSwitchToBuildMode,
}: {
  onDismiss: () => void;
  error: string;
  /** Compatibility only: provider recovery must never depend on an app entitlement. */
  isDyadProEnabled: boolean;
  onStartNewChat?: () => void;
  onSwitchToBuildMode?: () => void;
}) {
  const normalized = error.includes("Fallbacks=[{")
    ? error.split("Fallbacks=[{")[0]
    : error;
  const legacyBilling =
    parseSubscriptionBillingError(normalized) ||
    error.includes("LiteLLM Virtual Key expected");
  const legacyQuota =
    /FREE_AGENT_QUOTA_EXCEEDED|FREE_MODEL_QUOTA_EXCEEDED|dyad_free_model_quota_exceeded|Dyad Free (?:has reached|limit)|doesn't have a free quota tier|ExceededBudget:/.test(
      normalized,
    );
  const message = legacyBilling
    ? "This legacy connection is unavailable. Select a configured API-key provider or reconnect your provider account in Settings. Your draft has not been retried."
    : legacyQuota
      ? "The selected endpoint reported a usage limit. Check your provider account or select another configured model. No application subscription or credits are required. Changing chat mode does not reset provider limits."
      : normalized;
  return (
    <div
      data-testid="chat-error-box"
      role="alert"
      className="relative mt-2 bg-red-50 border border-red-200 rounded-md shadow-sm p-2 mx-4"
    >
      <button
        type="button"
        aria-label="Dismiss error"
        onClick={onDismiss}
        className="absolute top-2.5 left-2 p-1 hover:bg-red-100 rounded"
      >
        <X size={14} className="text-red-500" />
      </button>
      <div className="pl-8 py-1 text-sm text-red-700">
        <div className="max-h-64 overflow-y-auto scrollbar-on-hover">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children, ...props }) => (
                <a
                  {...props}
                  onClick={(event) => {
                    event.preventDefault();
                    if (props.href) void ipc.system.openExternalUrl(props.href);
                  }}
                  className="text-blue-500 hover:text-blue-700"
                >
                  {children}
                </a>
              ),
            }}
          >
            {message}
          </ReactMarkdown>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {onStartNewChat && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onStartNewChat}
            >
              <MessageSquarePlus size={16} />
              Start new chat
            </Button>
          )}
          {onSwitchToBuildMode && !legacyQuota && !legacyBilling && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSwitchToBuildMode}
            >
              Switch to Build
              <ArrowRight size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
