/**
 * Scope guard.
 *
 * The self-improvement agent may only improve Dyad itself. Every path it is
 * allowed to touch must resolve inside the Dyad repository; anything else is
 * refused.
 */

import path from "node:path";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { safeJoin } from "@/ipc/utils/path_utils";

/**
 * Asserts that `targetPath` is inside `dyadRoot`.
 *
 * The check is lexical (no filesystem access), so it works synchronously and
 * before the path exists. Callers that are about to WRITE should also run
 * `assertMutationPathAllowed` from `@/ipc/utils/path_utils`, which resolves
 * symlinks with `realpath` and therefore also catches a symlink inside the
 * repository that points outside of it.
 *
 * @throws DyadError (Validation) when the path is missing, is the repository
 * root itself, or escapes the repository.
 */
export function assertSelfHealScope(
  dyadRoot: string,
  targetPath: string,
): void {
  if (!dyadRoot || dyadRoot.trim().length === 0) {
    throw new DyadError(
      "Self-heal scope requires the Dyad repository root.",
      DyadErrorKind.Validation,
    );
  }
  const target = (targetPath ?? "").trim();
  if (target.length === 0) {
    throw new DyadError(
      "Self-heal scope requires a target path.",
      DyadErrorKind.Validation,
    );
  }

  const root = path.resolve(dyadRoot);
  // `safeJoin` refuses absolute segments and `..` escapes for relative paths.
  const resolved = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(safeJoin(root, target));

  assertContained(root, resolved, target);
}

function assertContained(
  root: string,
  resolved: string,
  original: string,
): void {
  const relative = path.relative(root, resolved);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new DyadError(
      relative === ""
        ? `Self-heal may not modify the Dyad repository root itself: ${original}`
        : `Self-heal is scoped to the Dyad repository only; refusing path outside it: ${original}`,
      DyadErrorKind.Validation,
    );
  }

  // macOS and Windows filesystems are case-insensitive by default, so the
  // containment check has to be too (same rule as `isProjectRootPath`).
  const lowerRelative = path.relative(
    root.toLowerCase(),
    resolved.toLowerCase(),
  );
  if (
    lowerRelative === "" ||
    lowerRelative === ".." ||
    lowerRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(lowerRelative)
  ) {
    throw new DyadError(
      `Self-heal is scoped to the Dyad repository only; refusing path outside it: ${original}`,
      DyadErrorKind.Validation,
    );
  }
}
