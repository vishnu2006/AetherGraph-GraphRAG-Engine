import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AuthInterceptor from "@/components/AuthInterceptor";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "AetherGraph — GraphRAG Study Workspace",
  description:
    "A collaborative, multi-tenant GraphRAG workspace with semantic search powered by pgvector and Claude.",
  viewport: "width=device-width, initial-scale=1",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-[#0a0a0a] text-white antialiased overflow-hidden">
        <AuthInterceptor>
          {children}
        </AuthInterceptor>
      </body>
    </html>
  );
}
