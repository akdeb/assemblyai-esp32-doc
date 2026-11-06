import { readContent } from "@/lib/content";
import { Behavior } from "./Behavior";

export async function DocsPage({ name }: { name: string }) {
  const html = await readContent(name);
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <Behavior />
    </>
  );
}
