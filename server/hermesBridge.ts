import { ENV } from "./_core/env";
import type { ToolExecutor } from "./assistantCore";

const HERMES_TEST_ACTION = "connectivity_test";

export const hermesToolExecutor: ToolExecutor = {
  async execute(toolId, input) {
    if (toolId !== "hermes-connectivity") {
      return { ok: false, message: `Hermes does not support the ${toolId} action.` };
    }
    if (!ENV.hermesUrl.trim()) {
      return { ok: false, message: "Hermes is not configured. Set HERMES_URL on the NORAH server." };
    }

    try {
      const response = await fetch(ENV.hermesUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: HERMES_TEST_ACTION, input }),
      });
      if (!response.ok) {
        return { ok: false, message: `Hermes returned HTTP ${response.status}.` };
      }
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (result.ok !== true || typeof result.message !== "string" || !result.message.trim()) {
        return { ok: false, message: "Hermes returned an invalid connectivity result." };
      }
      return { ok: true, message: result.message };
    } catch (error) {
      return { ok: false, message: `Hermes could not be reached: ${error instanceof Error ? error.message : "network error"}` };
    }
  },
};