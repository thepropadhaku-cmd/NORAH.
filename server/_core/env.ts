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
  // ws:// (or wss://) address of Hermes's JSON-RPC endpoint — see server/hermesBridge.ts.
  hermesUrl: process.env.HERMES_URL ?? "",
  inworldApiKey: process.env.INWORLD_API_KEY ?? "",
  inworldVoiceId: process.env.INWORLD_VOICE_ID ?? "",
};
