import { startTeletonCodeServer } from "./app.js";

startTeletonCodeServer().catch((error) => {
    console.error(
        `[SERVER ERROR] ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
    );
    process.exit(1);
});
