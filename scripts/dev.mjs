import { spawn } from "node:child_process";
await import("./build-motion.mjs");
// Only the development server trusts the Vite origin; packaged builds never do.
const env = {
  ...process.env,
  TADACUT_DEV_ORIGINS: "http://127.0.0.1:4318,http://localhost:4318",
};
const processes = ["dev:server", "dev:studio"].map((script) =>
  spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], {
    stdio: "inherit",
    shell: false,
    env,
  }),
);
const stop = () => processes.forEach((child) => child.kill("SIGTERM"));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
for (const child of processes)
  child.on("exit", (code) => {
    stop();
    process.exitCode = code ?? 0;
  });
