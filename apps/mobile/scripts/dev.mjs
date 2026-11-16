import { fileURLToPath } from "node:url";

// Expo needs the terminal for port prompts, keyboard shortcuts, and simulator selection.
const cwd = fileURLToPath(new URL("..", import.meta.url));
const expo = Bun.spawn(
  [process.execPath, "run", "--no-orphans", "dev", ...process.argv.slice(2)],
  {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
const hub = Bun.spawn([process.execPath, "run", "--no-orphans", "dev:hub"], {
  cwd,
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
});

function stop() {
  expo.kill("SIGTERM");
  hub.kill("SIGTERM");
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

const exitCode = await Promise.race([expo.exited, hub.exited]);
stop();
await Promise.all([expo.exited, hub.exited]);
process.exitCode = exitCode;
