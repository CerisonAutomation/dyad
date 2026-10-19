import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Bot, Info } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/useSettings";
<<<<<<< HEAD
import { ipc } from "@/ipc/types";
import { hasDyadProKey } from "@/lib/schemas";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function ProModeSelector() {
  const { settings, updateSettings } = useSettings();
  const subscription = useSubscriptionAccount();
  const claudeStatus = useQuery({
    queryKey: queryKeys.system.claudeCodeStatus,
    queryFn: () => ipc.chat.claudeCodeStatus({}),
    enabled: !!settings?.enableClaudeCodeSubscription,
    staleTime: 10_000,
  });
  const claudeConnected =
    !!settings?.enableClaudeCodeSubscription &&
    !!claudeStatus.data?.connected &&
    !!claudeStatus.data?.compatible;
  const subscriptionConnected = subscription.data?.connected || claudeConnected;
=======
import type { UserSettings } from "@/lib/schemas";

export function ProModeSelector() {
  const { settings, updateSettings } = useSettings();
>>>>>>> 5680f080 (Checkpoint: Pro->Agent2 conversion, local tool de-engineering, spawn retry, model picker)

  const toggleAgent2Enabled = () => {
    void updateSettings({ enableAgent2: !settings?.enableAgent2 });
  };

  const toggleWebSearch = () => {
    void updateSettings({ enableProWebSearch: !settings?.enableProWebSearch });
  };

  const handleTurboEditsChange = (value: "off" | "v1" | "v2") => {
    if (value === "off") {
      void updateSettings({ enableProLazyEditsMode: false });
      return;
    }
    void updateSettings({
      enableProLazyEditsMode: true,
      proLazyEditsMode: value,
    });
  };

  const handleSmartContextChange = (value: "off" | "balanced" | "deep") => {
    if (value === "off") {
      void updateSettings({ enableProSmartFilesContextMode: false });
      return;
    }
    void updateSettings({
      enableProSmartFilesContextMode: true,
      proSmartContextOption: value,
    });
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger className="inline-flex items-center justify-center whitespace-nowrap rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border-none bg-transparent shadow-none text-primary/95 hover:text-primary hover:bg-primary/10 h-7 px-2 gap-1 cursor-pointer" />
          }
        >
          <Bot className="h-3.5 w-3.5" />
          <span className="font-medium">Agent2</span>
        </TooltipTrigger>
        <TooltipContent>Configure Agent2 settings</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-[26rem] max-w-[calc(100vw-2rem)] border-primary/20">
        <div className="space-y-4">
          <div className="space-y-1">
            <h4 className="font-medium flex items-center gap-1.5">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-primary font-medium">Agent2 Mode</span>
            </h4>
            <div className="h-px bg-gradient-to-r from-primary/50 via-primary/20 to-transparent" />
          </div>
          <div className="flex flex-col gap-3">
            <SelectorRow
              id="agent2-enabled"
              label="Enable Agent2"
              tooltip="Runs the local agent on the model and provider you selected. Adds web access, turbo edits, and smart context."
              isTogglable
              settingEnabled={Boolean(settings?.enableAgent2)}
              toggle={toggleAgent2Enabled}
            />
            <Accordion>
              <AccordionItem
                value="agent2-features"
                className="rounded-lg border border-border/60 bg-muted/30 px-3 border-b-0"
              >
<<<<<<< HEAD
                Unlock Pro modes
              </a>
            </div>
          )}
          {(hasProKey || settings?.proModelUsage === "api-key") && (
            <div className="space-y-2">
              <Label>Model usage</Label>
              <ToggleGroup
                aria-label="Model usage"
                variant="outline"
                size="sm"
                orientation="horizontal"
                className="w-full items-stretch [&>button]:h-auto [&>button]:min-h-8 [&>button]:flex-auto [&>button]:whitespace-normal [&>button]:py-1"
                value={[
                  settings?.proModelUsage === "api-key"
                    ? "api-key"
                    : subscriptionConnected && settings?.proModelUsage !== "pro"
                      ? "subscription"
                      : "pro",
                ]}
                onValueChange={(value) => {
                  if (
                    value[0] === "pro" ||
                    value[0] === "api-key" ||
                    (value[0] === "subscription" && subscriptionConnected)
                  )
                    void updateSettings({
                      proModelUsage: value[0] as
                        | "pro"
                        | "subscription"
                        | "api-key",
                    });
                }}
              >
                <ToggleGroupItem
                  value="subscription"
                  disabled={!subscriptionConnected}
                  className="text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary aria-pressed:hover:text-primary-foreground"
                >
                  {settings?.enableClaudeCodeSubscription
                    ? "Subscriptions"
                    : "ChatGPT Subscription"}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="pro"
                  disabled={!hasProKey}
                  className="text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary aria-pressed:hover:text-primary-foreground"
                  onClick={() => {
                    // Disconnected accounts display Pro even when the saved
                    // preference still requires subscription credentials.
                    // Clicking that selected toggle emits an empty value.
                    if (
                      !subscriptionConnected &&
                      settings?.proModelUsage !== "api-key" &&
                      settings?.proModelUsage !== "pro"
                    )
                      void updateSettings({ proModelUsage: "pro" });
                  }}
                >
                  Dyad Pro credits
                </ToggleGroupItem>
                <ToggleGroupItem value="api-key" className="text-xs">
                  Your API keys
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
          <SelectorRow
            id="pro-enabled"
            label="Enable Dyad Pro"
            tooltip="Uses your selected model usage source and Dyad Pro credits for Pro features."
            isTogglable={hasProKey}
            settingEnabled={Boolean(settings?.enableDyadPro)}
            toggle={toggleProEnabled}
          />
=======
                <AccordionTrigger className="cursor-pointer py-2 text-foreground/80 hover:text-foreground hover:no-underline">
                  Agent2 features
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  <div className="flex flex-col gap-5 pt-2">
                    <SelectorRow
                      id="web-search"
                      label="Web Access"
                      tooltip="Allows Agent2 to access the web (e.g. search for information)"
                      isTogglable
                      settingEnabled={Boolean(settings?.enableProWebSearch)}
                      toggle={toggleWebSearch}
                    />
                    <TurboEditsSelector
                      settings={settings}
                      onValueChange={handleTurboEditsChange}
                    />
                    <SmartContextSelector
                      settings={settings}
                      onValueChange={handleSmartContextChange}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
>>>>>>> 5680f080 (Checkpoint: Pro->Agent2 conversion, local tool de-engineering, spawn retry, model picker)
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SelectorRow({
  id,
  label,
  tooltip,
  isTogglable,
  settingEnabled,
  toggle,
}: {
  id: string;
  label: string;
  tooltip: string;
  isTogglable: boolean;
  settingEnabled: boolean;
  toggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <Label
          htmlFor={id}
          className={!isTogglable ? "text-muted-foreground/50" : ""}
        >
          {label}
        </Label>
        <span title={tooltip}>
          <Info
            className={`h-4 w-4 cursor-help ${!isTogglable ? "text-muted-foreground/50" : "text-muted-foreground"}`}
          />
        </span>
      </div>
      <Switch
        id={id}
        aria-label={label}
        checked={isTogglable ? settingEnabled : false}
        onCheckedChange={toggle}
        disabled={!isTogglable}
      />
    </div>
  );
}

function SegmentedControl({
  options,
  currentValue,
  onValueChange,
  testId,
}: {
  options: { value: string; label: string; hint: string }[];
  currentValue: string;
  onValueChange: (value: string) => void;
  testId: string;
}) {
  return (
    <div
      className="inline-flex rounded-md border border-input"
      data-testid={testId}
    >
      {options.map((option, index) => (
        <Tooltip key={option.value}>
          <TooltipTrigger
            render={
              <Button
                variant={currentValue === option.value ? "default" : "ghost"}
                size="sm"
                onClick={() => onValueChange(option.value)}
                className={`h-8 px-3 text-xs flex-shrink-0 ${
                  index === 0
                    ? "rounded-r-none border-r border-input"
                    : index === options.length - 1
                      ? "rounded-l-none"
                      : "rounded-none border-r border-input"
                }`}
              />
            }
          >
            {option.label}
          </TooltipTrigger>
          <TooltipContent>{option.hint}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function TurboEditsSelector({
  settings,
  onValueChange,
}: {
  settings: UserSettings | null;
  onValueChange: (value: "off" | "v1" | "v2") => void;
}) {
  const currentValue =
    !settings?.enableProLazyEditsMode || !settings?.proLazyEditsMode
      ? "off"
      : settings.proLazyEditsMode;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label>Turbo Edits</Label>
        <span title="Edits files efficiently without full rewrites. Classic: uses a smaller model to complete edits. Search & replace: finds and replaces specific text blocks.">
          <Info className="h-4 w-4 cursor-help text-muted-foreground" />
        </span>
      </div>
      <SegmentedControl
        testId="turbo-edits-selector"
        currentValue={currentValue}
        onValueChange={(v) => onValueChange(v as "off" | "v1" | "v2")}
        options={[
          { value: "off", label: "Off", hint: "Disable Turbo Edits" },
          {
            value: "v1",
            label: "Classic",
            hint: "Use a smaller model to complete edits",
          },
          {
            value: "v2",
            label: "Search & replace",
            hint: "Find and replace specific text blocks",
          },
        ]}
      />
    </div>
  );
}

function SmartContextSelector({
  settings,
  onValueChange,
}: {
  settings: UserSettings | null;
  onValueChange: (value: "off" | "balanced" | "deep") => void;
}) {
  const currentValue =
    !settings?.enableProSmartFilesContextMode || !settings?.proSmartContextOption
      ? "off"
      : settings.proSmartContextOption;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label>Smart Context</Label>
        <span title="Selects the most relevant files as context to save tokens working on large codebases.">
          <Info className="h-4 w-4 cursor-help text-muted-foreground" />
        </span>
      </div>
      <SegmentedControl
        testId="smart-context-selector"
        currentValue={currentValue}
        onValueChange={(v) => onValueChange(v as "off" | "balanced" | "deep")}
        options={[
          { value: "off", label: "Off", hint: "Disable Smart Context" },
          {
            value: "balanced",
            label: "Balanced",
            hint: "Selects most relevant files with balanced context size",
          },
          {
            value: "deep",
            label: "Deep",
            hint: "Keeps full conversation history for maximum context",
          },
        ]}
      />
    </div>
  );
}
