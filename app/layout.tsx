import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Sportz — Live Scores & Real-Time Commentary",
    template: "%s · Sportz",
  },
  description:
    "Real-time live sports dashboard: instant score changes, status transitions and play-by-play commentary for football, cricket and basketball over Socket.IO room subscriptions.",
  applicationName: "Sportz",
  keywords: ["live scores", "sports", "football", "cricket", "basketball", "socket.io", "real-time"],
  openGraph: {
    title: "Sportz — Live Scores & Real-Time Commentary",
    description:
      "Follow football, cricket and basketball fixtures with instant score updates and play-by-play commentary.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#FDE047",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#matches"
          className="brutal-sm sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-accent focus:px-3 focus:py-1.5 focus:text-xs focus:font-black focus:uppercase"
        >
          Skip to matches
        </a>
        {children}
      </body>
    </html>
  );
}
