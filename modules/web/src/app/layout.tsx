import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { AuthProvider } from "@/lib/featbit-auth/auth-context";
import { getSession } from "@/lib/server-auth/require";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FeatBit Release Decision",
  description: "AI-powered experiment management for data-driven release decisions",
};

// Root needs to be dynamic because we read the session cookie. Marketing
// visitors without a cookie short-circuit before any DB query (see
// src/lib/server-auth/require.ts) so the cost is essentially nil.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  const initialProfile = session?.profile ?? null;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${manrope.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-background text-foreground selection:bg-primary/20">
        <ThemeProvider>
          <AuthProvider initialProfile={initialProfile}>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
