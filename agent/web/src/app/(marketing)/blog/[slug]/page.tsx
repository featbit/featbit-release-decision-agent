import { notFound } from "next/navigation";
import Link from "next/link";
import { getPostBySlug, getAllPosts, formatDate } from "@/lib/blog";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};
  return {
    title: `${post.title} — FeatBit Blog`,
    description: post.description,
  };
}

// Very minimal markdown renderer — handles headings, paragraphs, bold, lists
function renderContent(markdown: string) {
  const lines = markdown.trim().split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  function flushList() {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key++} className="my-5 space-y-1.5 pl-5">
          {listItems.map((item, i) => (
            <li key={i} className="text-foreground/80 leading-relaxed list-disc">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      listItems = [];
    }
  }

  function renderInline(text: string) {
    // bold: **text**
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <h2 key={key++} className="mt-10 mb-4 text-2xl font-bold text-foreground">
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <h3 key={key++} className="mt-8 mb-3 text-xl font-semibold text-foreground">
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(
        <p key={key++} className="my-4 text-foreground/80 leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }
  }

  flushList();
  return elements;
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) notFound();

  const allPosts = getAllPosts();
  const currentIndex = allPosts.findIndex((p) => p.slug === slug);
  const prevPost = allPosts[currentIndex + 1] ?? null;
  const nextPost = allPosts[currentIndex - 1] ?? null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
      <div className="grid grid-cols-1 gap-16 lg:grid-cols-[1fr_280px]">
        {/* Article */}
        <article>
          {/* Breadcrumb */}
          <nav className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground transition-colors">
              Home
            </Link>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <Link href="/blog" className="hover:text-foreground transition-colors">
              Blog
            </Link>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="truncate text-foreground max-w-[200px]">{post.title}</span>
          </nav>

          {/* Meta */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="inline-block rounded-full border border-brand/30 bg-brand-muted px-2.5 py-0.5 text-xs font-medium text-brand">
              {post.category}
            </span>
            <span className="text-xs text-muted-foreground">{post.readingTime}</span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl leading-[1.15] mb-6">
            {post.title}
          </h1>

          <p className="text-lg text-muted-foreground leading-relaxed mb-8 border-l-2 border-brand/30 pl-4">
            {post.description}
          </p>

          <div className="mb-10 flex items-center gap-3 pb-10 border-b border-border/60">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-muted text-brand text-sm font-semibold">
              {post.author.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{post.author}</p>
              <p className="text-xs text-muted-foreground">
                {post.authorRole} · {formatDate(post.date)}
              </p>
            </div>
          </div>

          {/* Content */}
          <div className="prose-custom">{renderContent(post.content)}</div>

          {/* Prev / Next */}
          <div className="mt-16 pt-10 border-t border-border/60 grid gap-4 sm:grid-cols-2">
            {prevPost && (
              <Link
                href={`/blog/${prevPost.slug}`}
                className="group flex flex-col gap-1 rounded-xl border border-border/60 p-5 hover:border-brand/40 hover:shadow-sm transition-all"
              >
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
                  </svg>
                  Previous
                </span>
                <span className="text-sm font-medium text-foreground group-hover:text-brand transition-colors line-clamp-2">
                  {prevPost.title}
                </span>
              </Link>
            )}
            {nextPost && (
              <Link
                href={`/blog/${nextPost.slug}`}
                className="group flex flex-col gap-1 rounded-xl border border-border/60 p-5 hover:border-brand/40 hover:shadow-sm transition-all sm:text-right sm:ml-auto w-full"
              >
                <span className="text-xs text-muted-foreground flex items-center gap-1 sm:justify-end">
                  Next
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </span>
                <span className="text-sm font-medium text-foreground group-hover:text-brand transition-colors line-clamp-2">
                  {nextPost.title}
                </span>
              </Link>
            )}
          </div>
        </article>

        {/* Sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-8">
            {/* CTA */}
            <div className="rounded-xl bg-brand p-6 text-brand-foreground">
              <h3 className="font-semibold mb-2">Try Release Decision</h3>
              <p className="text-sm text-brand-foreground/80 mb-4 leading-relaxed">
                Set up your first A/B experiment and make your next release a data-driven decision.
              </p>
              <Link
                href="/experiments/new"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-foreground px-4 py-2 text-sm font-semibold text-brand hover:opacity-90 transition-opacity"
              >
                Start an experiment
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </div>

            {/* More posts */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground mb-4">
                More from the blog
              </h3>
              <div className="space-y-4">
                {allPosts
                  .filter((p) => p.slug !== slug)
                  .slice(0, 3)
                  .map((p) => (
                    <Link
                      key={p.slug}
                      href={`/blog/${p.slug}`}
                      className="group block"
                    >
                      <p className="text-sm font-medium text-foreground group-hover:text-brand transition-colors leading-snug line-clamp-2">
                        {p.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">{formatDate(p.date)}</p>
                    </Link>
                  ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
