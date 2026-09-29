// Fake ACP agent used only by server/hermesBridge.test.ts. NOT Hermes —
// it proves the bridge's own protocol handling (framing, permission
// policy, error paths), not that real Hermes accepts these calls.
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
const send = o => process.stdout.write(JSON.stringify(o) + "\n");
const waiting = new Map();
let serverId = 100;
const chunk = text => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });

console.error("startup warning on stderr"); // should be captured but not crash the bridge
console.log("a non-JSON startup line on stdout"); // should be ignored, not crash the bridge

rl.on("line", line => {
  const msg = JSON.parse(line);

  if (msg.id !== undefined && msg.method === undefined) {
    const resolve = waiting.get(msg.id);
    if (resolve) { waiting.delete(msg.id); resolve(msg); }
    return;
  }

  if (msg.method === "initialize") {
    return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentInfo: { name: "fake-hermes" }, authMethods: [] } });
  }

  if (msg.method === "session/new") {
    return send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } });
  }

  if (msg.method === "session/prompt") {
    const text = msg.params.prompt[0].text;
    const kind = /read/.test(text) ? "read" : /edit/.test(text) ? "edit" : /fs/.test(text) ? "fs" : null;

    if (kind === "fs") {
      const id = serverId++;
      waiting.set(id, response => {
        chunk("fs answer: " + (response.error ? "refused" : "granted"));
        send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
      });
      return send({ jsonrpc: "2.0", id, method: "fs/read_text_file", params: { sessionId: "s1", path: "/x" } });
    }

    if (!kind) {
      chunk("pon");
      chunk("g");
      return send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
    }

    const id = serverId++;
    waiting.set(id, response => {
      const picked = response.result?.outcome?.optionId;
      if (picked === "allow") {
        send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read file", kind, status: "in_progress" } } });
        send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" } } });
        chunk("contents: nonce-42");
      } else {
        chunk("permission denied");
      }
      send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
    });
    send({
      jsonrpc: "2.0", id, method: "session/request_permission",
      params: {
        sessionId: "s1", toolCall: { toolCallId: "t1", title: "Read file", kind },
        options: [
          { optionId: "allow_always_id", name: "Always allow", kind: "allow_always" },
          { optionId: "allow", name: "Allow once", kind: "allow_once" },
          { optionId: "deny", name: "Reject", kind: "reject_once" },
        ],
      },
    });
  }
});
