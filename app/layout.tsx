import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "End-to-end examples - AssemblyAI",
  description: "Copy-paste pipelines that combine multiple AssemblyAI products in a single script.",
  icons: { icon: "/assets/favicon.png" },
};

// Runs before paint: follow the OS theme like the real docs ("system" preference).
const themeInit = `(function(){try{var p=localStorage.getItem('aai-theme')||'system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.dataset.themePreference=p;}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-banner-state="visible" data-assistant-state="closed" data-page-mode="none" data-theme-preference="system" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="/docs/_mintlify/assets/index.css" />
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
