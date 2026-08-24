import { mkdir, readFile, writeFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
const css = await readFile("styles.css", "utf8");
const js = await readFile("app.js", "utf8");
const limits = await readFile("a2b_psd_limits.csv", "utf8");

const worker = `const files = {
  "/": { type: "text/html; charset=utf-8", body: ${JSON.stringify(html)} },
  "/index.html": { type: "text/html; charset=utf-8", body: ${JSON.stringify(html)} },
  "/styles.css": { type: "text/css; charset=utf-8", body: ${JSON.stringify(css)} },
  "/app.js": { type: "text/javascript; charset=utf-8", body: ${JSON.stringify(js)} },
  "/a2b_psd_limits.csv": { type: "text/csv; charset=utf-8", body: ${JSON.stringify(limits)} }
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const file = files[url.pathname] || files["/"];
    return new Response(file.body, {
      headers: {
        "content-type": file.type,
        "cache-control": "no-store"
      }
    });
  }
};
`;

await mkdir("dist/server", { recursive: true });
await writeFile("dist/server/index.js", worker);
