// Fixture used only by server/hermesBridge.test.ts to exercise the
// "process exits before finishing" error path.
console.error("boom: not logged in");
process.exit(3);
