import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import next from "next";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const hostname = process.env.GEOTUTOR_HTTPS_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.GEOTUTOR_HTTPS_PORT ?? "3443", 10);
const certificatePath = process.env.GEOTUTOR_TLS_CERT;
const privateKeyPath = process.env.GEOTUTOR_TLS_KEY;

if (!certificatePath || !privateKeyPath) {
  throw new Error(
    "GEOTUTOR_TLS_CERT and GEOTUTOR_TLS_KEY must reference certificate files outside the client bundle.",
  );
}
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("GEOTUTOR_HTTPS_PORT must be a valid TCP port.");
}

const app = next({ dev: false, dir: root, hostname, port });
await app.prepare();

const server = createServer(
  {
    cert: readFileSync(certificatePath),
    key: readFileSync(privateKeyPath),
    minVersion: "TLSv1.2",
  },
  app.getRequestHandler(),
);

server.listen(port, hostname, () => {
  process.stdout.write(`GeoTutor HTTPS candidate listening on https://${hostname}:${port}\n`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
