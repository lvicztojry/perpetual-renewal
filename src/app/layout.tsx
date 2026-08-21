import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "生生不息",
  description: "全关系 AI 情感回响工作台",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "生生不息",
    statusBarStyle: "default"
  }
};

export const viewport: Viewport = {
  themeColor: "#16736b"
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
      </body>
    </html>
  );
}
