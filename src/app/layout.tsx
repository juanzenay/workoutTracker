import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorker } from "@/components/service-worker";
import { getPreferences } from "@/server/preferences";
import { getStrings } from "@/strings";
import { StringsProvider } from "@/strings/provider";
import "./globals.css";

const strings = getStrings();

export const metadata: Metadata = {
  title: strings.app.name,
  description: strings.app.description,
  appleWebApp: { capable: true, title: strings.app.name, statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f10" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { theme, skin } = await getPreferences();
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme} data-skin={skin}>
      <body className="bg-bg text-fg font-body antialiased">
        <StringsProvider skin={skin}>{children}</StringsProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
