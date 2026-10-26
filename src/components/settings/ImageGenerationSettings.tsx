import { ipc } from "@/ipc/types";
import { SETTING_IDS } from "@/lib/settingsSearchIndex";
import { useState, type FormEvent } from "react";
import { useSettings } from "@/hooks/useSettings";
import type { UserSettings } from "@/lib/schemas";
import {
  ImageGenerationSettingsSchema,
  type ImageGenerationSettings,
} from "@/shared/image_generation_config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ImageGenerationSettingsControl() {
  const { settings, updateSettings } = useSettings();
  if (!settings) return <p>Loading image settings…</p>;
  return (
    <ImageSettingsForm
      key={JSON.stringify(settings.imageGeneration)}
      settings={settings}
      save={updateSettings}
    />
  );
}
function ImageSettingsForm({
  settings,
  save,
}: {
  settings: UserSettings;
  save: (settings: Partial<UserSettings>) => Promise<unknown>;
}) {
  const [config, setConfig] = useState<ImageGenerationSettings>(
    settings.imageGeneration ?? {
      backend: "disabled",
      model: "",
      providerId: "",
      allowPaidRemote: false,
    },
  );
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const change = (patch: Partial<ImageGenerationSettings>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setMessage("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailed(false);
    setMessage("");
    const parsed = ImageGenerationSettingsSchema.safeParse(config);
    if (!parsed.success) {
      setFailed(true);
      setMessage(parsed.error.issues[0].message);
      return;
    }
    const existingToken =
      settings.providerSettings?.[config.providerId]?.apiKey?.value;
    const remote =
      config.backend === "cloudflare" ||
      (config.backend === "openai-compatible" &&
        !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/.test(
          config.baseUrl ?? "",
        ));
    if (remote && !token.trim() && !existingToken) {
      setFailed(true);
      setMessage("Enter an API token for this image provider.");
      return;
    }
    if (
      config.backend === "openai-compatible" &&
      config.baseUrl !== settings.imageGeneration?.baseUrl &&
      existingToken &&
      !token.trim()
    ) {
      setFailed(true);
      setMessage(
        "Re-enter the API token when changing its destination endpoint.",
      );
      return;
    }
    setPending(true);
    try {
      await save({
        imageGeneration: parsed.data,
        ...(config.backend === "chatgpt-subscription"
          ? { proModelUsage: "subscription" as const }
          : {}),
        ...(token.trim()
          ? {
              providerSettings: {
                ...settings.providerSettings,
                [config.providerId]: {
                  ...settings.providerSettings?.[config.providerId],
                  apiKey: { value: token.trim() },
                },
              },
            }
          : {}),
      });
      setToken("");
      setMessage("Image settings saved. No generation request was sent.");
    } catch {
      setFailed(true);
      setMessage("Could not save image settings. Please retry.");
    } finally {
      setPending(false);
    }
  };
  return (
    <form
      onSubmit={submit}
      id={SETTING_IDS.imageGeneration}
      aria-label="Image generation settings"
      className="space-y-4 border-t pt-5 mt-5"
    >
      <h3 className="font-medium">Image generation</h3>
      <p className="text-sm text-muted-foreground">
        Choose images separately from your chat model. No application
        subscription, automatic provider switching or paid fallback.
      </p>
      <div className="space-y-1">
        <Label htmlFor="image-backend">Image backend</Label>
        <select
          id="image-backend"
          className="w-full rounded-md border bg-background p-2"
          value={config.backend}
          disabled={pending}
          onChange={(e) => {
            const backend = e.target
              .value as ImageGenerationSettings["backend"];
            setConfig({
              backend,
              providerId: backend === "disabled" ? "" : `image-${backend}`,
              model: "",
              allowPaidRemote: false,
            });
            setToken("");
            setMessage("");
          }}
        >
          <option value="disabled">Not configured</option>
          <option value="cloudflare">
            Cloudflare Workers AI — free allocation
          </option>
          <option value="chatgpt-subscription">
            ChatGPT / Codex subscription — OAuth, no API key
          </option>
          <option value="openai-compatible">
            Other image providers or local OpenAI-compatible server
          </option>
        </select>
      </div>
      {config.backend !== "disabled" && (
        <fieldset disabled={pending} className="space-y-3">
          <div>
            <Label htmlFor="image-model">Image model ID</Label>
            <Input
              id="image-model"
              autoComplete="off"
              value={config.model}
              onChange={(e) => change({ model: e.target.value })}
              placeholder={
                config.backend === "cloudflare"
                  ? "@cf/black-forest-labs/flux-1-schnell"
                  : "Your provider's current image model ID"
              }
            />
          </div>
          {config.backend === "cloudflare" ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="image-request-format">
                  Cloudflare input format
                </Label>
                <select
                  id="image-request-format"
                  className="w-full rounded-md border bg-background p-2"
                  value={config.requestFormat ?? "json"}
                  onChange={(e) =>
                    change({
                      requestFormat: e.target.value as "json" | "multipart",
                    })
                  }
                >
                  <option value="json">
                    JSON prompt (e.g. FLUX.1 Schnell)
                  </option>
                  <option value="multipart">
                    Multipart (e.g. FLUX.2 Klein)
                  </option>
                </select>
              </div>
              {config.requestFormat === "multipart" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="image-width">Image width</Label>
                    <Input
                      id="image-width"
                      type="number"
                      min={256}
                      max={1920}
                      value={config.width ?? 1024}
                      onChange={(e) =>
                        change({ width: e.target.valueAsNumber })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="image-height">Image height</Label>
                    <Input
                      id="image-height"
                      type="number"
                      min={256}
                      max={1920}
                      value={config.height ?? 1024}
                      onChange={(e) =>
                        change({ height: e.target.valueAsNumber })
                      }
                    />
                  </div>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                FLUX.1 Schnell is a low-usage option. For a newer
                configurable-size option, choose
                @cf/black-forest-labs/flux-2-klein-4b with Multipart.
                Availability and quota depend on your Cloudflare plan.
              </p>
              <div>
                <Label htmlFor="image-account">Cloudflare account ID</Label>
                <Input
                  id="image-account"
                  value={config.accountId ?? ""}
                  onChange={(e) => change({ accountId: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Cloudflare documents a daily free allocation, not unlimited
                images. Use a Workers Free account for quota errors rather than
                paid overage; paid account plans can charge. Your token needs
                Workers AI permission.{" "}
                <a
                  className="underline"
                  href="https://developers.cloudflare.com/workers-ai/platform/pricing/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Check current pricing
                </a>
                .
              </p>
            </>
          ) : config.backend === "chatgpt-subscription" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                GPT images use the connected ChatGPT/Codex subscription via
                OAuth, never an OpenAI API key. Generation consumes plan limits;
                availability depends on the account/model. This native
                image-tool integration is experimental. No API or provider
                fallback is attempted. Saving also selects subscription mode for
                chat.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  setPending(true);
                  setFailed(false);
                  setMessage("");
                  try {
                    await ipc.settings.connectCodexSubscription({
                      acceptCharges: true,
                      selectModel: true,
                    });
                    setMessage(
                      "Complete ChatGPT OAuth sign-in in your browser. No image request has been sent.",
                    );
                  } catch {
                    setFailed(true);
                    setMessage(
                      "Could not start ChatGPT OAuth. Use the ChatGPT subscription option in the model picker.",
                    );
                  } finally {
                    setPending(false);
                  }
                }}
              >
                Connect/reconnect ChatGPT (OAuth)
              </Button>
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="image-endpoint">Image API base URL</Label>
                <Input
                  id="image-endpoint"
                  value={config.baseUrl ?? ""}
                  onChange={(e) => change({ baseUrl: e.target.value })}
                  autoComplete="off"
                  placeholder="Your image provider or local server's /v1 URL"
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config.allowPaidRemote}
                  onChange={(e) =>
                    change({ allowPaidRemote: e.target.checked })
                  }
                />
                I authorize this remote image API and its account charges.
                ChatGPT subscriptions do not automatically include API credits.
                Not needed for a loopback server.
              </label>
              <p className="text-sm text-muted-foreground">
                Use an image-capable OpenAI-compatible endpoint, not an ordinary
                chat-only model/server. For GPT images choose the ChatGPT
                subscription OAuth option instead. Models stay editable; no
                model is silently selected.
              </p>
            </>
          )}
          {config.backend !== "chatgpt-subscription" && (
            <>
              <div>
                <Label htmlFor="image-slot">Credential slot</Label>
                <Input
                  id="image-slot"
                  value={config.providerId}
                  onChange={(e) => {
                    change({ providerId: e.target.value });
                    setToken("");
                  }}
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="image-token">Image API token</Label>
                <Input
                  id="image-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="new-password"
                  placeholder={
                    settings.providerSettings?.[config.providerId]?.apiKey
                      ?.value
                      ? "Saved token — leave blank to retain"
                      : "Optional only for a local server"
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Tokens use the existing provider-secret storage. Saving does not
                test quota or generate an image.
              </p>
            </>
          )}
        </fieldset>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save image settings"}
      </Button>
      {message && (
        <p role={failed ? "alert" : "status"} className="text-sm">
          {message}
        </p>
      )}
    </form>
  );
}
