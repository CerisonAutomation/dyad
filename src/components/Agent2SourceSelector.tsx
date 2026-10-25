import { useSubscriptionAccount } from "@/hooks/useSubscriptionAccount";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { KeyRound } from "lucide-react";

/** Provider source control. No application credits or paid feature toggle. */
export function Agent2SourceSelector() {
  const { settings, updateSettings } = useSettings();
  const subscription = useSubscriptionAccount();
  const claudeStatus = useQuery({
    queryKey: queryKeys.system.claudeCodeStatus,
    queryFn: () => ipc.chat.claudeCodeStatus({}),
    enabled: true,
    staleTime: 10_000,
  });
  const claudeConnected =
    !!claudeStatus.data?.connected && !!claudeStatus.data?.compatible;
  const connected = subscription.data?.connected || claudeConnected;
  const source = settings?.proModelUsage;
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs hover:bg-muted"
        aria-label="Agent2 model source"
      >
        <KeyRound className="size-3.5" /> Agent2 · BYOK
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3">
        <h4 className="font-medium">Agent2 model source</h4>
        <p className="text-sm text-muted-foreground">
          Inference follows your selected model and configured connection. Local
          models run locally; remote usage and quotas are controlled by your
          provider.
        </p>
        <ToggleGroup
          aria-label="Model usage"
          variant="outline"
          value={
            source === "api-key" || source === "subscription"
              ? [source]
              : ["auto"]
          }
          onValueChange={(value) => {
            const next = value[0];
            if (
              next === "auto" ||
              next === "api-key" ||
              next === "subscription"
            )
              void updateSettings({
                proModelUsage: next === "auto" ? undefined : next,
                ...(next === "subscription"
                  ? { enableClaudeCodeSubscription: true }
                  : {}),
                enableDyadPro: false,
              });
          }}
        >
          <ToggleGroupItem value="auto">Automatic</ToggleGroupItem>
          <ToggleGroupItem value="api-key">Your API keys</ToggleGroupItem>
          <ToggleGroupItem value="subscription">
            Provider account
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          Automatic follows the selected model and its configured credentials.
          API keys support built-in and custom providers, including local
          endpoints. Claude and GPT account adapters are always available to
          connect; other provider accounts need a compatible adapter.
          Authentication and provider limits still apply. No application
          subscription is required.
        </p>
        {source === "subscription" && !connected && (
          <p className="text-xs text-muted-foreground">
            Connect your provider account in the model menu before running an
            account model.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
