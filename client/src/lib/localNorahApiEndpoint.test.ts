import { describe, expect, it, vi } from "vitest";
import { LocalNorahApiEndpoint } from "./localNorahApiEndpoint";

function healthyResponse(service = "norah-core", apiVersion = 1) {
  return new Response(JSON.stringify({ service, apiVersion }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("LocalNorahApiEndpoint", () => {
  it("prefers port 3000 when both ports identify as NORAH Core", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => healthyResponse());
    const resolver = new LocalNorahApiEndpoint(fetchMock as typeof fetch);
    await expect(resolver.discover()).resolves.toBe(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3000/api/norah/health");
  });

  it("falls back to port 3001 when port 3000 is unavailable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes(":3000/")) throw new TypeError("connection refused");
      return healthyResponse();
    });
    const resolver = new LocalNorahApiEndpoint(fetchMock as typeof fetch);
    await expect(resolver.discover()).resolves.toBe(3001);
  });

  it("rejects a responding but unrelated service", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes(":3000/")) return healthyResponse("other-service", 1);
      throw new TypeError("connection refused");
    });
    const resolver = new LocalNorahApiEndpoint(fetchMock as typeof fetch);
    await expect(resolver.discover()).rejects.toThrow("NORAH Core is unavailable");
  });

  it("retries a failed GET on the verified fallback port", async () => {
    let api3000Calls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/norah/health")) {
        if (url.includes(":3000/")) return healthyResponse();
        return healthyResponse();
      }
      if (url.includes(":3000/")) {
        api3000Calls += 1;
        throw new TypeError("connection reset");
      }
      return new Response("verified response", { status: 200 });
    });
    const resolver = new LocalNorahApiEndpoint(fetchMock as typeof fetch);
    const response = await resolver.fetch("http://127.0.0.1:3000/api/trpc/assistant.capabilities");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("verified response");
    expect(api3000Calls).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/api/trpc/assistant.capabilities",
      undefined,
    );
  });

  it("does not replay a failed POST, but probes for recovery", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/norah/health")) return healthyResponse();
      if ((init?.method || "GET").toUpperCase() === "POST") throw new TypeError("connection reset");
      return new Response("ok", { status: 200 });
    });
    const resolver = new LocalNorahApiEndpoint(fetchMock as typeof fetch);
    await expect(resolver.fetch("http://127.0.0.1:3000/api/trpc", { method: "POST", body: "{}" }))
      .rejects.toThrow("connection reset");
    expect(fetchMock.mock.calls.filter(([input]) => !String(input).endsWith("/api/norah/health"))).toHaveLength(1);
  });

  it("fails clearly when both ports are unavailable", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("connection refused"); });
    const resolver = new LocalNorahApiEndpoint(fetchMock as typeof fetch);
    await expect(resolver.fetch("http://127.0.0.1:3000/api/trpc")).rejects.toThrow("NORAH Core is unavailable");
  });
});
