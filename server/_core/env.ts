export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  // Legacy: the Hermes bridge talks ACP over a local child process now, not a network URL (see server/hermesBridge.ts).
  hermesUrl: process.env.HERMES_URL ?? "",
  // Command NORAH Core runs to reach Hermes over ACP (stdio). Split on whitespace, never run through a shell.
  hermesAcpCommand: process.env.HERMES_ACP_COMMAND ?? "hermes acp",
  // Comma-separated Hermes tool kinds NORAH may approve, one time only. Default: none. Only "read" and "search" are ever honored.
  hermesApproveKinds: process.env.HERMES_APPROVE_KINDS ?? "",
  inworldApiKey: process.env.INWORLD_API_KEY ?? "",
  inworldVoiceId: process.env.INWORLD_VOICE_ID ?? "",
};
