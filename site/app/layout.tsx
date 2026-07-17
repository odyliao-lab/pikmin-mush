import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mush.odyliao.cc"),
  title: "Pikmin 蘑菇探險隊",
  description: "即時查看世界各地的 Pikmin Bloom 蘑菇與挑戰資訊。",
  openGraph: {
    title: "Pikmin 蘑菇探險隊",
    description: "即時查看世界各地的 Pikmin Bloom 蘑菇與挑戰資訊。",
    images: [{ url: "/og.png", width: 1536, height: 1024 }],
    locale: "zh_TW",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pikmin 蘑菇探險隊",
    description: "即時查看世界各地的 Pikmin Bloom 蘑菇與挑戰資訊。",
    images: ["/og.png"],
  },
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
