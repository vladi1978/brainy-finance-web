import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import AppSidebar from "@/components/layout/AppSidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Brainy",
  description:
    "Shop smarter and save more — compare prices across stores, ask in plain language, and review text-based PDF statements.",
};

function SidebarFallback() {
  return (
    <aside
      className="h-screen w-72 shrink-0 border-r border-white/10 bg-[#050608]"
      aria-hidden
    />
  );
}

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
      <body className="min-h-screen bg-black text-white">
        <div className="flex min-h-screen w-full">
          <Suspense fallback={<SidebarFallback />}>
            <AppSidebar />
          </Suspense>
          <div className="flex min-h-screen min-w-0 flex-1 flex-col">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
