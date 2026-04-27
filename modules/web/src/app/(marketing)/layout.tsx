import Link from "next/link";
import Image from "next/image";

function NavBar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5 group">
          <Image
            src="/logo.svg"
            alt="FeatBit"
            width={32}
            height={32}
            className="size-8 shrink-0 group-hover:opacity-90 transition-opacity"
          />
          <span className="font-semibold text-foreground">FeatBit</span>
          <span className="hidden sm:block text-muted-foreground text-sm font-normal">
            Experimentation
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          <Link
            href="/blog"
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
          >
            Blog
          </Link>
          <Link
            href="/experiments"
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
          >
            Dashboard
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/experiments"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90 transition-opacity shadow-sm"
          >
            Get started
          </Link>
          {/* mobile menu placeholder */}
          <button className="md:hidden p-2 rounded-md hover:bg-muted transition-colors" aria-label="Menu">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-6 text-center">
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} FeatBit Inc. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <NavBar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
