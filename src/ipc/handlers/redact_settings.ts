import type { UserSettings } from "@/lib/schemas";

/**
 * Secrets are encrypted at rest and only ever needed by the main process,
 * which builds the provider clients. Returning them to the renderer meant any
 * renderer-side code execution — an XSS, or a compromised transitive
 * dependency in the ~150-package renderer bundle — could read every API key,
 * OAuth token, and the Coolify admin password straight out of the settings
 * object.
 *
 * This strips the value and leaves `isSet`, which is the only thing the UI
 * actually needs: to show "key configured", to decide whether to prompt, and
 * to render a masked field.
 */
export function redactSecretsForRenderer<T>(settings: T): T {
  return walk(settings) as T;
}

const SECRET_LEAF_KEYS = new Set(["value"]);

function isSecretObject(node: Record<string, unknown>): node is {
  value: string;
  encryptionType?: unknown;
  isSet?: boolean;
} {
  return (
    typeof node.value === "string" &&
    (node.isSet !== undefined ||
      node.encryptionType !== undefined ||
      // A bare { value } is the minimal secret shape.
      Object.keys(node).every((k) => SECRET_LEAF_KEYS.has(k) || k === "encryptionType" || k === "isSet"))
  );
}

// Settings are parsed from JSON so cycles cannot occur in practice, but a
// self-referential object would otherwise recurse until the stack blew.
const seen = new WeakSet<object>();

function walk(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walk);
  if (node === null || typeof node !== "object") return node;
  if (seen.has(node)) return node;
  seen.add(node);

  const record = node as Record<string, unknown>;
  if (isSecretObject(record)) {
    return {
      ...record,
      value: "",
      isSet: record.value.length > 0 || record.isSet === true,
    };
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = walk(value);
  }
  seen.delete(node);
  return out;
}
