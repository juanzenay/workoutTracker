import net from "node:net";
import { E2E_APP_PORT } from "./owner";

/**
 * A TCP pass-through in front of the app that can be switched off. Playwright's offline mode does not
 * reliably reach service workers (a restarted worker's first requests slip through to the server), so
 * offline tests that need the worker to see a dead network browse through this instead.
 */
export async function networkSwitch() {
  let online = true;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    if (!online) return client.destroy();
    const upstream = net.connect(E2E_APP_PORT, "127.0.0.1");
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
      s.on("error", () => {});
    }
    client.pipe(upstream).pipe(client);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    setOnline(value: boolean) {
      online = value;
      if (!value) for (const s of sockets) s.destroy();
    },
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
