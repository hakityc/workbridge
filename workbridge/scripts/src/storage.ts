import {
  constants,
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { BridgeError, requireValue } from "./contracts.js";

export function home(): string {
  return resolve(
    process.env.WORKBRIDGE_HOME || join(homedir(), ".config", "workbridge"),
  );
}
// Check every component, including .git files used by worktrees. Never chmod an existing unsafe file into acceptance.
export function safePath(path: string, file = false): void {
  requireValue(isAbsolute(path), "UNSAFE_PATH", "必须使用绝对路径。");
  let cursor = path;
  while (true) {
    if (existsSync(join(cursor, ".git")))
      throw new BridgeError("UNSAFE_PATH", "私有状态不得保存在 Git 仓库中。");
    try {
      const stat = lstatSync(cursor);
      requireValue(
        !stat.isSymbolicLink(),
        "UNSAFE_PATH",
        "路径不得包含符号链接。",
      );
      if (cursor === path) {
        requireValue(
          file ? stat.isFile() : stat.isDirectory(),
          "UNSAFE_PATH",
          "路径类型不符。",
        );
        requireValue(
          (stat.mode & 0o077) === 0 &&
            (process.getuid === undefined || stat.uid === process.getuid()),
          "UNSAFE_PERMISSIONS",
          "私有目录需要 0700，私有文件需要 0600，并属于当前用户。",
        );
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
export function ensurePrivate(dir = home()): void {
  safePath(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  safePath(dir);
}
export function readPrivate<T>(path: string): T {
  safePath(dirname(path));
  safePath(path, true);
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return JSON.parse(readFileSync(fd, "utf8")) as T;
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new BridgeError("NOT_FOUND", "连接或状态不存在。");
    throw new BridgeError(
      "INVALID_PRIVATE_FILE",
      "私有文件损坏，停止处理；未覆盖原文件。",
    );
  }
}
export function atomicPrivate(path: string, value: unknown): void {
  ensurePrivate(dirname(path));
  safePath(path, true);
  if (existsSync(path)) readPrivate(path);
  const temp = join(dirname(path), `.${parse(path).base}.${randomUUID()}.tmp`);
  const fd = openSync(
    temp,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
      fchmodSync(fd, 0o600);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}
export async function locked<T>(run: () => Promise<T>): Promise<T> {
  ensurePrivate();
  const path = join(home(), ".lock");
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch {
    throw new BridgeError(
      "BUSY",
      "另一个配置操作正在运行；若进程已退出，请检查并移除用户目录中的 .lock。",
    );
  }
  try {
    return await run();
  } finally {
    closeSync(fd);
    rmSync(path, { force: true });
  }
}
