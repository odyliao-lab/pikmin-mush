import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pikmin 蘑菇探險隊",
  description: "即時查看世界各地的 Pikmin Bloom 蘑菇與挑戰資訊。",
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
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
