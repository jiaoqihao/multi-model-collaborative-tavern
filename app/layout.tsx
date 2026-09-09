import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "夜航酒馆 · MyTavern",
  description: "多角色 AI 剧情创作工作台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
