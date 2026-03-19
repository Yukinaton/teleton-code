import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const sourceRoot = join(repoRoot, "client-new", "dist");
const targetRoot = join(repoRoot, "server", "public");

if (!existsSync(sourceRoot)) {
    throw new Error(`Client build output was not found: ${sourceRoot}`);
}

rmSync(targetRoot, { recursive: true, force: true });
mkdirSync(targetRoot, { recursive: true });
cpSync(sourceRoot, targetRoot, { recursive: true });

console.log(`Synced client build to ${targetRoot}`);
