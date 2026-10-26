import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FreeAgentQuotaBanner } from "./FreeAgentQuotaBanner";
const quota = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useFreeAgentQuota", () => ({ useFreeAgentQuota: quota }));
it("does not impose a hosted agent quota or offer a paid-app upgrade", () => {
  const switchMode = vi.fn();
  const { container } = render(
    <FreeAgentQuotaBanner onSwitchToBuildMode={switchMode} />,
  );
  expect(container.firstChild).toBeNull();
  expect(quota).not.toHaveBeenCalled();
  expect(switchMode).not.toHaveBeenCalled();
});
