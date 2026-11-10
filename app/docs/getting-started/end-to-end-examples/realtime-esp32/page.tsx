import { DocsPage } from "@/components/DocsPage";

export const metadata = {
  title: "Realtime speech on ESP32 - AssemblyAI",
  description: "Build a talking ESP32-S3 device with Elato, the open-source voice AI stack, powered by AssemblyAI streaming STT, LLM Gateway, and Text to Speech.",
};

export default function Page() {
  return <DocsPage name="realtime-esp32" />;
}
