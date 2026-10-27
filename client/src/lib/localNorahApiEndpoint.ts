const NORAH_PORTS = [3000, 3001] as const;
type NorahPort = (typeof NORAH_PORTS)[number];

const HEALTH_PATH = "/api/norah/health";
const HEALTH_TIMEOUT_MS = 500;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isNorahHealthPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const payload = value as { service?: unknown; apiVersion?: unknown };
  return payload.service === "norah-core" && payload.apiVersion === 1;
}

/**
 * Discovers only the two explicitly supported local NORAH Core ports.
 * A port is trusted only when its health endpoint returns NORAH's identity
 * marker; a generic HTTP response from another service is never sufficient.
 */
export class LocalNorahApiEndpoint {
  private selectedPort: NorahPort | null = null;

  constructor(
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
    private readonly timeoutMs = HEALTH_TIMEOUT_MS,
  ) {}

  private async isHealthy(port: NorahPort): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`http://127.0.0.1:${port}${HEALTH_PATH}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const payload: unknown = await response.json();
      return isNorahHealthPayload(payload);
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async discover(excludePort?: NorahPort): Promise<NorahPort> {
    // Recheck the cached endpoint unless the current request just failed there.
    if (this.selectedPort !== null && this.selectedPort !== excludePort && await this.isHealthy(this.selectedPort)) {
      return this.selectedPort;
    }

    this.selectedPort = null;
    // Startup prefers 3000. After a request failure, try the alternate port
    // first so a responsive health route cannot mask a failing API endpoint.
    const candidates = excludePort === undefined
      ? NORAH_PORTS
      : NORAH_PORTS.filter(port => port !== excludePort);
    for (const port of candidates) {
      if (await this.isHealthy(port)) {
        this.selectedPort = port;
        return port;
      }
    }

    throw new Error("NORAH Core is unavailable on localhost ports 3000 and 3001.");
  }

  private apiUrl(original: RequestInfo | URL, port: NorahPort): string {
    const originalUrl = original instanceof Request ? original.url : String(original);
    const parsed = new URL(originalUrl);
    // Keep tRPC path/query unchanged; only replace the selected local port.
    return `http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const port = await this.discover();

    try {
      return await this.fetchImpl(this.apiUrl(input, port), init);
    } catch (firstError) {
      // Invalidate the endpoint and probe both ports so the next request uses
      // the recovered endpoint. Only retry GETs: replaying a failed POST could
      // duplicate a task mutation if the server committed it before the socket
      // failed. Mutations fail visibly and can be safely retried by the user.
      this.selectedPort = null;
      let recoveredPort: NorahPort | null = null;
      try {
        recoveredPort = await this.discover(port);
      } catch {
        // Preserve the original request failure for the UI/error boundary.
      }

      if (method === "GET" && recoveredPort !== null && recoveredPort !== port) {
        try {
          return await this.fetchImpl(this.apiUrl(input, recoveredPort), init);
        } catch {
          this.selectedPort = null;
        }
      }

      throw firstError;
    }
  }
}

export const localNorahApiEndpoint = new LocalNorahApiEndpoint();
