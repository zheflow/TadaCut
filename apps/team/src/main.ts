import path from "node:path";
import { createTeamServer } from "./server";
const token = process.env.TADACUT_TEAM_ADMIN_TOKEN ?? "";
const { app } = await createTeamServer({
  dataDir: path.resolve(process.env.TADACUT_TEAM_DATA ?? "team-data"),
  adminToken: token,
});
const address = await app.listen({
  host: process.env.TADACUT_TEAM_HOST ?? "127.0.0.1",
  port: Number(process.env.TADACUT_TEAM_PORT ?? 4399),
});
console.log(`TadaCut team service: ${address}`);
for (const event of ["SIGINT", "SIGTERM"] as const)
  process.on(event, () => void app.close().then(() => process.exit(0)));
