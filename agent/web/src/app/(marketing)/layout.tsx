import Link from "next/link";
import Image from "next/image";

function NavBar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-brand-foreground font-bold text-sm shadow-sm group-hover:opacity-90 transition-opacity">
            F
          </div>
          <span className="font-semibold text-foreground">FeatBit</span>
          <span className="hidden sm:block text-muted-foreground text-sm font-normal">
            Release Decision
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
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-brand-foreground font-bold text-xs">
                F
              </div>
              <span className="font-semibold text-sm">FeatBit</span>
            </Link>
            <p className="text-xs text-muted-foreground leading-relaxed">
              AI-powered experiment management for data-driven release decisions.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground mb-3">Product</p>
            <ul className="space-y-2">
              <li>
                <Link href="/experiments" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Dashboard
                </Link>
              </li>
              <li>
                <Link href="/experiments/new" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  New experiment
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground mb-3">Content</p>
            <ul className="space-y-2">
              <li>
                <Link href="/blog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Blog
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground mb-3">Open source</p>
            <ul className="space-y-2">
              <li>
                <a
                  href="https://github.com/featbit/featbit"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://docs.featbit.co"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Documentation
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} FeatBit. Open source under MIT license.
          </p>
          <p className="text-xs text-muted-foreground">
            Built with{" "}
            <span className="text-brand font-medium">♥</span>
            {" "}for engineering teams.
          </p>
        </div>
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
