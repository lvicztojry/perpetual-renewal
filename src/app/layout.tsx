import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./renewal-theme.css";
import { PwaRegister } from "@/components/pwa-register";
import { BellIntro } from "@/components/bell-intro";

export const metadata: Metadata = {
  title: "生生不息",
  description: "只要想念，就会想见。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "生生不息",
    statusBarStyle: "default"
  }
};

export const viewport: Viewport = {
  themeColor: "#191a18"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <PwaRegister />
        <BellIntro />
      </body>
    </html>
  );
}
