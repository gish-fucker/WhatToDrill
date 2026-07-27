import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = join(root, "public");
const destination = join(root, ".pages");
const packageMetadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const textExtensions = new Set([".html", ".js"]);

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageMetadata.version)) {
  throw new Error("package.json must contain a semantic release version.");
}

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });

async function stamp(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await stamp(path);
    else if (textExtensions.has(extname(entry.name))) {
      const content = await readFile(path, "utf8");
      if (content.includes("__APP_VERSION__")) {
        await writeFile(path, content.replaceAll("__APP_VERSION__", packageMetadata.version), "utf8");
      }
    }
  }
}

await stamp(destination);
console.log(`Built GitHub Pages release ${packageMetadata.version} in ${destination}`);
