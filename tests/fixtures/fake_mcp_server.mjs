#!/usr/bin/env node

import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (process.env.FAKE_MCP_HANG === "1") {
    return;
  }
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-tapd", version: "1.0.0" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          { name: "get_user_participant_projects", inputSchema: { type: "object" } },
          { name: "create_story_or_task", inputSchema: { type: "object" } },
        ],
      },
    });
    return;
  }
  if (message.method === "tools/call") {
    if (process.env.FAKE_MCP_FAIL === "1") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: `probe failed with ${process.env.TAPD_ACCESS_TOKEN || "no-token"}`,
        },
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: process.env.FAKE_MCP_BUSINESS_ERROR === "1" ? JSON.stringify({status:0,info:"authentication failed"}) : "fixture project" }] },
    });
  }
});
