import { useSettings } from "@/hooks/useSettings";
import { SettingField } from "@/components/settings/SettingField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChatMode } from "@/lib/schemas";
import { getEffectiveDefaultChatMode } from "@/lib/schemas";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import {
  FREE_PRO_MODEL_FALLBACK_CHAT_MODE,
  isFreeProBuildModeCombination,
  isFreeProModel,
} from "@/lib/freeProModel";

export function DefaultChatModeSelector() {
  const { settings, updateSettings, envVars } = useSettings();
  const { t } = useTranslation("settings");

  useEffect(() => {
    if (
      settings &&
      isFreeProBuildModeCombination(
        settings.selectedModel,
        settings.defaultChatMode,
      )
    ) {
      updateSettings({ defaultChatMode: FREE_PRO_MODEL_FALLBACK_CHAT_MODE });
    }
  }, [settings, updateSettings]);

  if (!settings) {
    return null;
  }

  const isDyadFreeSelected = isFreeProModel(settings.selectedModel);
  const effectiveDefault = getEffectiveDefaultChatMode(settings, envVars);

  const handleDefaultChatModeChange = (value: ChatMode) => {
    if (isFreeProBuildModeCombination(settings.selectedModel, value)) {
      return;
    }
    updateSettings({ defaultChatMode: value });
  };

  const getModeDisplayName = (mode: ChatMode) => {
    switch (mode) {
      case "build":
        return "Build";
      case "local-agent":
        return "Agent2";
      case "ask":
        return "Ask";
      case "plan":
        return "Plan";
      default:
        throw new Error(`Unknown chat mode: ${mode}`);
    }
  };

  return (
    <SettingField
      htmlFor="default-chat-mode"
      label={t("workflow.defaultChatMode")}
      description={t("workflow.defaultChatModeDescription")}
    >
      <Select
        value={effectiveDefault}
        onValueChange={(v) => v && handleDefaultChatModeChange(v)}
      >
        <SelectTrigger
          className="w-full sm:w-[240px]"
          id="default-chat-mode"
          aria-describedby="default-chat-mode-description"
        >
          <SelectValue>{getModeDisplayName(effectiveDefault)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="local-agent">
            <div className="flex flex-col items-start">
              <span className="font-medium">{"Agent2"}</span>
              <span className="text-xs text-muted-foreground">
                Uses your selected provider and model
              </span>
            </div>
          </SelectItem>
          <SelectItem value="build" disabled={isDyadFreeSelected}>
            <div className="flex flex-col items-start">
              <span className="font-medium">Build</span>
              <span className="text-xs text-muted-foreground">
                {isDyadFreeSelected
                  ? "Use Agent with Dyad Free"
                  : "Generate and edit code"}
              </span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingField>
  );
}
