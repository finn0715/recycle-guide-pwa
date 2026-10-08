import { build } from "esbuild";
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
await rm("dist", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
const frontend = await build({ entryPoints: ["sites/main.tsx"], bundle: true, minify: true, write: false, outdir: "dist/client/assets", entryNames: "app-[hash]", metafile: true, platform: "browser", target: "es2022", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, alias: { "@": path.join(root, "src") } });
const assets = {};
const add = (name, bytes, type) => { assets[name] = { bytes: Buffer.from(bytes).toString("base64url"), type }; };
let entry, stylesheet;
for (const file of frontend.outputFiles) {
  const name = "/assets/" + path.basename(file.path);
  const type = file.path.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
  add(name, file.contents, type);
  if (file.path.endsWith(".js")) entry = name;
  if (file.path.endsWith(".css")) stylesheet = name;
}
const html = (await readFile("sites/index.html", "utf8")).replace("__ENTRY__", entry).replace("<!--styles-->", `<link rel="stylesheet" href="${stylesheet}">`);
add("/index.html", html, "text/html; charset=utf-8");
const types = { ".png": "image/png", ".js": "text/javascript; charset=utf-8", ".html": "text/html; charset=utf-8", ".webmanifest": "application/manifest+json" };
async function collect(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + "/" + entry.name;
    if (entry.isDirectory()) await collect(path.join(directory, entry.name), name);
    else add(name, await readFile(path.join(directory, entry.name)), types[path.extname(entry.name)] ?? "application/octet-stream");
  }
}
await collect("public");
await build({ entryPoints: ["sites/worker.ts"], bundle: true, minify: true, outfile: "dist/server/index.js", platform: "browser", format: "esm", target: "es2022", alias: { "@": path.join(root, "src") }, plugins: [{ name: "embedded-assets", setup(builder) { builder.onResolve({ filter: /^virtual:assets$/ }, () => ({ path: "assets", namespace: "embedded" })); builder.onLoad({ filter: /.*/, namespace: "embedded" }, () => ({ contents: `export default ${JSON.stringify(assets)}`, loader: "js" })); } }] });
await writeFile("dist/.openai/hosting.json", await readFile(".openai/hosting.json"));
console.log(`Built Worker with ${Object.keys(assets).length} embedded public assets`);
