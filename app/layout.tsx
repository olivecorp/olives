import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Splash } from "@/components/Splash";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Viewport lives in its own export (putting it under metadata.viewport
// triggers a build warning). maximumScale/userScalable lock out pinch zoom;
// the gesturestart preventDefault below covers iOS Safari, which ignores
// user-scalable=no.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Android/Chrome: shrink the page when the on-screen keyboard opens, so
  // dvh-sized overlays (the todo edit sheet) sit above it instead of behind
  // it. Ignored by iOS Safari, which overlays regardless.
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  title: "Olives",
  description: "Your todos, calendar, and notes.",
  // apple-icons adds <link rel="apple-touch-icon" sizes="180x180"> (from
  // app/apple-icon.tsx); the web-app metas make it install full-screen when
  // added to the iOS home screen instead of opening in a Safari tab.
  appleWebApp: {
    capable: true,
    title: "Olives",
    statusBarStyle: "default",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* Paints with the initial HTML; React dismisses it after hydration
            (components/Splash.tsx). */}
        <Splash />
      </body>
      {/* Block iOS Safari pinch zoom (it ignores user-scalable=no). */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.addEventListener('gesturestart', function (e) { e.preventDefault(); });",
        }}
      />
    </html>
  );
}
