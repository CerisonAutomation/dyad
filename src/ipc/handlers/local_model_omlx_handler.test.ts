import { DyadErrorKind } from "@/errors/dyad_error";
import { fetchOmlxModels } from "@/ipc/handlers/local_model_omlx_handler";
import { afterEach, describe, it, expect, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetchWith(data: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data, object: "list" }),
    }),
  );
}

describe("fetchOmlxModels", () => {
  it("maps the OpenAI-compatible model list to local models", async () => {
    stubFetchWith([
      { id: "mlx-community/Llama-3.2-3B-Instruct-4bit", object: "model" },
      { id: "qwen3.5", object: "model" },
    ]);

    const { models } = await fetchOmlxModels();

    expect(models).toEqual([
      {
        modelName: "mlx-community/Llama-3.2-3B-Instruct-4bit",
        displayName: "mlx-community/Llama-3.2-3B-Instruct-4bit",
        provider: "omlx",
      },
      {
        modelName: "qwen3.5",
        displayName: "qwen3.5",
        provider: "omlx",
      },
    ]);
  });

  it("throws a DyadError when the oMLX server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, statusText: " refused" }),
    );

    await expect(fetchOmlxModels()).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.External,
    });
  });
});
