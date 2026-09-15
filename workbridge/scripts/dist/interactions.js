import { confirm, input, password, select } from "@inquirer/prompts";
import { BridgeError, requireValue } from "./contracts.js";
export async function interact(request) {
    requireValue(process.stdin.isTTY && process.stdout.isTTY, "INTERACTIVE_REQUIRED", "请在你自己的交互式终端运行此命令；不要把凭据发到聊天中。");
    const context = { signal: AbortSignal.timeout(5 * 60 * 1000) };
    try {
        if (request.type === "secret")
            return await password({
                message: request.prompt,
                mask: false,
                validate: (v) => v.trim().length > 0 || "不能为空",
            }, context);
        if (request.type === "confirmation")
            return await confirm({ message: request.prompt, default: false }, context);
        if (request.options?.length)
            return await select({ message: request.prompt, choices: request.options.map(value => ({ name: value, value })) }, context);
        return await input({
            message: request.prompt,
            validate: (v) => v.trim().length > 0 || "不能为空",
        }, context);
    }
    catch {
        throw new BridgeError("INTERACTION_CANCELLED", "输入已取消或超时；未继续配置。");
    }
}
export async function authorize(prompt, connection, yes) {
    if (yes)
        return;
    requireValue(await interact({ version: 1, type: "confirmation", prompt, connection }), "CANCELLED", "已取消。");
}
