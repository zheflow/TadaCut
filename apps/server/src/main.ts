import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createStudioServer } from "./server";
const here = path.dirname(fileURLToPath(import.meta.url));
// Development source and bundled production entry have different depths.
const projectRoot =
  process.env.TADACUT_ROOT ??
  (here.endsWith(path.join("apps", "server", "src"))
    ? path.resolve(here, "../../..")
    : path.resolve(here, "../.."));
const dataDir =
  process.env.TADACUT_DATA_DIR ?? path.join(os.homedir(), ".tadacut");
const server = await createStudioServer({
  root: projectRoot,
  dataDir,
  port: Number(process.env.TADACUT_PORT ?? 4317),
  devOrigins: (process.env.TADACUT_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
});
const address = await server.listen();
console.log(`TadaCut ready: ${address}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
