import fs from "node:fs";
import zlib from "node:zlib";

const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const packages = {};

for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (
    !path ||
    !metadata?.version ||
    metadata.dev === true ||
    !path.includes("node_modules/")
  ) continue;
  const name = path.split("node_modules/").at(-1);
  (packages[name] ??= []).push(String(metadata.version));
}

for (const name of Object.keys(packages)) {
  packages[name] = [...new Set(packages[name])];
}

const response = await fetch(
  "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
  {
    method: "POST",
    headers: {
      accept: "application/json",
      "accept-encoding": "identity",
      "content-type": "application/json",
    },
    body: JSON.stringify(packages),
  },
);

let body = Buffer.from(await response.arrayBuffer());
// The registry may return gzip bytes without a Content-Encoding header. npm's
// built-in audit currently fails to decode that response, so handle the wire
// format explicitly while still failing closed on API or parse errors.
if (body[0] === 0x1f && body[1] === 0x8b) {
  body = zlib.gunzipSync(body);
}
if (!response.ok) {
  throw new Error(`npm advisory API returned HTTP ${response.status}`);
}

const advisories = Object.entries(JSON.parse(body.toString("utf8")))
  .flatMap(([name, rows]) => rows.map((row) => ({ name, ...row })));
const blocked = advisories.filter((row) =>
  ["moderate", "high", "critical"].includes(row.severity));

if (blocked.length) {
  for (const row of blocked) {
    console.error(`${row.severity}: ${row.name} - ${row.title} (${row.url})`);
  }
  process.exitCode = 1;
} else {
  console.log(
    "Production dependency audit passed: no moderate, high, or critical advisories.",
  );
}
