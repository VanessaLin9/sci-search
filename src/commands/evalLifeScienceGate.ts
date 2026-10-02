import { fileURLToPath } from "node:url";
import { runEvalCli } from "../eval/lifeScienceGate/cli.js";

async function mainFromArgv() {
  const code = await runEvalCli(process.argv.slice(2));
  process.exitCode = code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mainFromArgv().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
