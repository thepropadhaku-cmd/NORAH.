import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

describe("assistant.context", () => {
  it("returns null rather than undefined when the authenticated user has no preferences", async () => {
    const ctx: TrpcContext = {
      user: {
        id: -1,
        openId: "context-regression-user",
        name: "Regression User",
        email: "regression@example.com",
        loginMethod: "test",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };

    const result = await appRouter.createCaller(ctx).assistant.context();
    expect(result).not.toBeUndefined();
    expect(result).toBeNull();
  });
});
