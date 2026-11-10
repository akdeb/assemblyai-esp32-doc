import { DocsPage } from "@/components/DocsPage";

export const metadata = {
  title: "Realtime speech on ESP32 - AssemblyAI",
  description: "Run a voice agent on a $10 ESP32-S3 with AssemblyAI streaming STT, LLM Gateway, and Text to Speech.",
};

export default function Page() {
  return <DocsPage name="realtime-esp32" />;
}
