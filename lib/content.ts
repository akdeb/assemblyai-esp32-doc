import { readFile } from "node:fs/promises";
import path from "node:path";

const read = (name: string) => readFile(path.join(process.cwd(), "content", `${name}.html`), "utf8");

async function readCached(name: string) {
  "use cache";
  return read(name);
}

// In dev, read the file every time so regenerating content/*.html shows up without restarting the server.
export async function readContent(name: string) {
  return process.env.NODE_ENV === "development" ? read(name) : readCached(name);
}
