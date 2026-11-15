import { describe, it, expect } from "vitest";
import { isBlockedAddress, assertSafeUrl, BlockedDestinationError } from "./urlGuard";
import { describeFetchError } from "./httpRequest";
import { runWorkflow } from "../index";
import type { WorkflowDefinition } from "../../dsl/schema";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1",
    "::ffff:127.0.0.1", "::ffff:169.254.169.254",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.255.255", "93.184.216.34", "2606:4700:4700::1111"])(
    "allows %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    }
  );

  it("fails closed on garbage", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

describe("assertSafeUrl", () => {
  it("accepts a public https URL", () => {
    expect(() => assertSafeUrl("https://example.com/hook")).not.toThrow();
  });

  it.each([
    "file:///etc/passwd",
    "ftp://example.com/",
    "http://localhost:3001/",
    "http://foo.localhost/",
    "http://127.0.0.1:5432/",
    "http://[::1]:3001/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://user:pass@example.com/",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => assertSafeUrl(url)).toThrow();
  });
});

describe("describeFetchError", () => {
  it("reports a blocked destination clearly", () => {
    const err = new TypeError("fetch failed", { cause: new BlockedDestinationError() });
    expect(describeFetchError(err)).toBe("Blocked: destination is a private or reserved address");
  });
});

describe("runWorkflow with a blocked destination", () => {
  it("fails without retrying", async () => {
    const def: WorkflowDefinition = {
      nodes: [
        { id: "trigger-1", type: "trigger", config: { kind: "webhook" } },
        {
          id: "action-1",
          type: "action",
          config: {
            kind: "http_request",
            url: "http://127.0.0.1:9/",
            method: "GET",
            retry: { maxAttempts: 3, backoffMs: 100 },
            timeoutMs: 5000,
          },
        },
      ],
      edges: [{ source: "trigger-1", target: "action-1" }],
    };

    const result = await runWorkflow(def, {});
    const step = result.steps.find((s) => s.nodeId === "action-1")!;

    expect(result.status).toBe("failure");
    expect(step.error).toMatch(/^Blocked/);
    expect((step.output as { attempts: number }).attempts).toBe(1);
  });
});