import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "End-to-end examples - AssemblyAI",
  description: "Copy-paste pipelines that combine multiple AssemblyAI products in a single script.",
  icons: { icon: "/assets/favicon.png" },
};

// Runs before paint: follow the OS theme like the real docs ("system" preference).
const themeInit = `(function(){try{var p=localStorage.getItem('aai-theme')||'system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.dataset.themePreference=p;}catch(e){}})();`;

// The "Ask a question" bar is `sticky` inside the article, so it rides up and over the pagination at the end of the
// page. Pin it to the viewport instead, lined up with the content column (Behavior sets --assistant-left/width).
const assistantBarCss = `[data-assistant-bar]{position:fixed!important;bottom:0;left:var(--assistant-left,1.25rem);right:auto;width:var(--assistant-width,calc(100% - 2.5rem))}body{padding-bottom:5.5rem}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-banner-state="visible" data-assistant-state="closed" data-page-mode="none" data-theme-preference="system" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="/docs/_mintlify/assets/index.css" />
        <style dangerouslySetInnerHTML={{ __html: assistantBarCss }} />
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
