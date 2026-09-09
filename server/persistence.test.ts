import { describe, expect, it } from "vitest";
import { getRecentConversations, getUserContext } from "./db";

describe("persistence contracts", () => {
  it("returns a safe collection for conversation history", async () => {
    const history = await getRecentConversations(-1);
    expect(Array.isArray(history)).toBe(true);
  });

  it("returns null or a preference row without leaking credentials", async () => {
    const context = await getUserContext(-1);
    expect(context === null || typeof context === "object").toBe(true);
    if (context) expect(context).not.toHaveProperty("password");
  });
});
