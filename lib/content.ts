import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readContent(name: string) {
  "use cache";
  return readFile(path.join(process.cwd(), "content", `${name}.html`), "utf8");
}
