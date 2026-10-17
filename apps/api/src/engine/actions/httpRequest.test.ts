import { describe, it, expect } from "vitest";
import { describeFetchError } from "./httpRequest";

describe("describeFetchError", () => {
  it("appends the cause code when present", () => {
    const err = new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    expect(describeFetchError(err)).toBe("fetch failed (ECONNREFUSED)");
  });

  it("falls back to the cause message", () => {
    const err = new TypeError("fetch failed", { cause: { message: "socket hang up" } });
    expect(describeFetchError(err)).toBe("fetch failed (socket hang up)");
  });

  it("returns the plain message when there is no cause", () => {
    expect(describeFetchError(new Error("boom"))).toBe("boom");
  });
});