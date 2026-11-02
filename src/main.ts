import { openStore } from "./store.ts";
import { createApp } from "./server.ts";
const port = process.env.PORT ?? "4310";
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw new Error("PORT must be an integer from 1024 to 65535.");
const store = await openStore(process.env.DATA_DIR ?? "./data");
const server = createApp(store);
server.on("error", (error) => {
  console.error("Service could not listen:", error.message);
  void store.close().finally(() => {
    process.exitCode = 1;
  });
});
server.listen(Number(port), "127.0.0.1", () =>
  console.log(`Reservation demo: http://127.0.0.1:${port}`),
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      void store.close();
    });
    server.closeIdleConnections();
    setTimeout(() => {
      server.closeAllConnections();
    }, 5000).unref();
  });
