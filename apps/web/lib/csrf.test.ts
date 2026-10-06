import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { checkOrigin } from "./csrf";

function requestWithOrigin(origin?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/tasks/t1/claim", {
    method: "POST",
    headers: origin ? { origin } : {},
  });
}

describe("checkOrigin", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes when Origin matches APP_URL exactly", () => {
    expect(checkOrigin(requestWithOrigin("http://localhost:3000"))).toBe(true);
  });

  it("fails when Origin is a different host", () => {
    expect(checkOrigin(requestWithOrigin("http://evil.example"))).toBe(false);
  });

  it("fails when Origin is the right host over the wrong scheme", () => {
    expect(checkOrigin(requestWithOrigin("https://localhost:3000"))).toBe(false);
  });

  it("fails when Origin is missing entirely", () => {
    expect(checkOrigin(requestWithOrigin())).toBe(false);
  });

  it("fails when Origin has a trailing slash APP_URL does not", () => {
    expect(checkOrigin(requestWithOrigin("http://localhost:3000/"))).toBe(false);
  });
});
