import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../.claude/skills/", import.meta.url));
const manifest = JSON.parse(
  await readFile(resolve(root, "replica-provenance.json"), "utf8"),
);
const expected = [
  "recon",
  "architect",
  "design",
  "build",
  "backend",
  "test",
  "diff",
  "entrepreneur",
  "brand",
  "launch",
  "deploy",
];
if (!/^[a-f0-9]{40}$/.test(manifest.commit) || manifest.license !== "MIT")
  throw new Error("Invalid skill provenance");
for (const [name, digest] of Object.entries(manifest.files)) {
  const path = resolve(root, name);
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Invalid skill manifest path");
  const actual = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (actual !== digest) throw new Error(`Skill integrity mismatch: ${name}`);
}
for (const stage of expected) {
  const name = `replica-${stage}`;
  const content = await readFile(resolve(root, name, "SKILL.md"), "utf8");
  if (!content.includes(`name: ${name}`) || !manifest.files[`${name}/SKILL.md`])
    throw new Error(`Missing skill: ${name}`);
}
const license = await readFile(resolve(root, "REPLICA-LICENSE"), "utf8");
if (!license.includes("MIT License"))
  throw new Error("Replica license missing");
console.log(
  `PASS: ${expected.length} Replica skills; ${Object.keys(manifest.files).length} files verified against ${manifest.commit}`,
);
