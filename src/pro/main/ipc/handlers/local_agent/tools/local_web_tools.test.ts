import { beforeEach, expect, it, vi } from "vitest";
import { webFetchTool } from "./web_fetch";
import { webCrawlTool } from "./web_crawl";
import type { AgentContext } from "./types";
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/ipc/utils/public_web_fetch",()=>({readPublicWebPage:mocks.read}));
vi.mock("electron-log",()=>({default:{scope:()=>({log:vi.fn(),warn:vi.fn()})}}));
beforeEach(()=>mocks.read.mockReset().mockResolvedValue({url:"https://example.com/",text:"Useful docs",truncated:false,screenshotAvailable:false}));
const context=()=>({isDyadPro:false,onXmlStream:vi.fn(),onXmlComplete:vi.fn(),appendUserMessage:vi.fn()} as unknown as AgentContext);
it.each([webFetchTool,webCrawlTool])("%s uses a local reader without subscription gates or credential forwarding",async(tool)=>{
  const ctx=context(); expect(tool.usesEngineEndpoint).toBe(false); expect(tool.isEnabled?.(ctx)).toBe(true); expect(tool.defaultConsent).toBe("ask");
  const result=await tool.execute({url:"https://example.com/"},ctx);
  expect(result).toContain("Useful docs"); expect(mocks.read).toHaveBeenCalledExactlyOnceWith("https://example.com/",undefined);
  expect(ctx.appendUserMessage).not.toHaveBeenCalled();
});
it("never fabricates a screenshot or promotes page content into a user instruction",async()=>{
  const ctx=context(); const result=await webCrawlTool.execute({url:"https://example.com/"},ctx);
  expect(result).toContain("no screenshot"); expect(result).toContain("untrusted reference data"); expect(ctx.appendUserMessage).not.toHaveBeenCalled();
});
it.each([webFetchTool,webCrawlTool])("propagates cancellation to the reader",async(tool)=>{
  const controller=new AbortController(); const ctx={...context(),abortSignal:controller.signal}; await tool.execute({url:"https://example.com/"},ctx);
  expect(mocks.read.mock.calls[0][1]).toBe(controller.signal);
});
it("rejects empty crawl content",async()=>{mocks.read.mockResolvedValue({url:"https://example.com/",text:"   "});await expect(webCrawlTool.execute({url:"https://example.com/"},context())).rejects.toThrow("No readable");});
