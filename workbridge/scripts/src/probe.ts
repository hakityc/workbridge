import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { BridgeError, ConnectionProfile } from "./contracts.js";
import { connector, localLaunch } from "./connectors.js";

export interface ProbeInput {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  required?: string[];
  probe?: { tool: string; args: Record<string, unknown> };
  timeout?: number;
}
export interface ProbeResult {
  ok: boolean;
  stage: string;
  code?: string;
  tools?: string[];
  missing?: string[];
  hostVerified: false;
}
function failureCode(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (e instanceof Error && e.name === "ZodError") return "SCHEMA_MISMATCH";
  if (/401|unauthorized|authentication|invalid.*token/i.test(text))
    return "AUTH_FAILED";
  if (/403|forbidden|permission/i.test(text)) return "PERMISSION_DENIED";
  if (/429|rate.limit/i.test(text)) return "RATE_LIMITED";
  if (/timeout|timed.out/i.test(text)) return "TIMEOUT";
  return "PROBE_FAILED";
}
export async function probe(input: ProbeInput): Promise<ProbeResult> {
  const client = new Client({ name: "workbridge-probe", version: "0.1.0-rc.1" });
  const transport = input.url
    ? new StreamableHTTPClientTransport(new URL(input.url), {
        requestInit: { headers: input.headers },
        reconnectionOptions: {
          maxRetries: 0,
          initialReconnectionDelay: 100,
          maxReconnectionDelay: 100,
          reconnectionDelayGrowFactor: 1,
        },
      })
    : new StdioClientTransport({
        command: input.command!,
        args: input.args || [],
        env: input.env,
        stderr: "pipe",
      });
  if (transport instanceof StdioClientTransport)
    transport.stderr?.on("data", () => {});
  const timeout = input.timeout || 15000;
  let stage = "initialize";
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      (async (): Promise<ProbeResult> => {
        await client.connect(transport, { timeout });
        stage = "tools/list";
        const tools: string[] = [];
        const seen = new Set<string>();
        let cursor: string | undefined;
        do {
          const list = await client.listTools(cursor ? { cursor } : undefined, {
            timeout,
          });
          tools.push(...list.tools.map((t) => t.name));
          cursor = list.nextCursor;
          if (cursor && seen.has(cursor))
            throw new BridgeError("INVALID_PAGINATION", "重复的分页游标。");
          if (cursor) seen.add(cursor);
        } while (cursor);
        const missing = (input.required || []).filter(
          (t) => !tools.includes(t),
        );
        if (missing.length)
          return {
            ok: false,
            stage: "capability",
            code: "MISSING_TOOLS",
            tools,
            missing,
            hostVerified: false,
          };
        if (input.probe) {
          stage = "read-only-probe";
          if (!tools.includes(input.probe.tool))
            return {
              ok: false,
              stage,
              code: "MISSING_TOOLS",
              tools,
              hostVerified: false,
            };
          const result = await client.callTool(
            { name: input.probe.tool, arguments: input.probe.args },
            undefined,
            { timeout },
          );
          // Some servers encode business errors in successful JSON-RPC text results.
          const blocks = result.content as
            | Array<{ type: string; text?: string }>
            | undefined;
          const texts = (blocks || [])
            .filter((b) => b.type === "text")
            .map((b) => b.text || "");
          const businessError = texts.some((t) => {
            try {
              const j = JSON.parse(t);
              return (
                j.success === false ||
                j.ok === false ||
                (typeof j.status === "number" &&
                  ![1, 200].includes(j.status)) ||
                Boolean(j.error)
              );
            } catch {
              return false;
            }
          });
          if (result.isError || businessError)
            return {
              ok: false,
              stage,
              code: failureCode(texts.join(" ")),
              tools,
              hostVerified: false,
            };
        }
        return {
          ok: true,
          stage: input.probe ? stage : "capability",
          tools: tools.sort(),
          hostVerified: false,
        };
      })(),
      new Promise<ProbeResult>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeout);
      }),
    ]);
  } catch (e) {
    const code = failureCode(e);
    return {
      ok: false,
      stage: code === "TIMEOUT" ? "timeout" : stage,
      code,
      hostVerified: false,
    };
  } finally {
    clearTimeout(timer!);
    await client.close().catch(() => {});
  }
}
export async function verify(
  profile: ConnectionProfile,
  credential?: Record<string, unknown>,
): Promise<ProbeResult> {
  const c = connector(profile.connector);
  if (profile.transport === "stdio")
    return probe({ ...localLaunch(profile, c, credential), probe: c.probe });
  if (profile.auth === "oauth")
    return {
      ok: false,
      stage: "authentication",
      code: "HOST_AUTH_REQUIRED",
      hostVerified: false,
    };
  const bearer = profile.bearerEnv ? process.env[profile.bearerEnv] : undefined;
  if (profile.auth === "bearer-env" && !bearer)
    return {
      ok: false,
      stage: "authentication",
      code: "AUTH_REQUIRED",
      hostVerified: false,
    };
  return probe({
    url: profile.url,
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
    probe: c.probe,
  });
}
