import Link from "next/link";
import { getAllPosts, formatDate } from "@/lib/blog";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog — FeatBit Release Decision",
  description: "Thinking on experiments, statistics, and data-driven release decisions.",
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
      {/* Header */}
      <div className="mb-16">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-muted px-3 py-1 text-xs font-medium text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Blog
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Experiments, stats,{" "}
          <span className="text-brand">and decisions</span>
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
          Thinking on feature flags, A/B testing, and how engineering teams can ship
          with more confidence and less guesswork.
        </p>
      </div>

      {/* Posts */}
      {posts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 py-20 text-center">
          <p className="text-muted-foreground">No posts yet. Check back soon.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Featured post */}
          {posts[0] && (
            <Link
              href={`/blog/${posts[0].slug}`}
              className="group block rounded-xl border border-border/60 bg-background p-8 hover:border-brand/40 hover:shadow-sm transition-all"
            >
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="inline-block rounded-full border border-brand/30 bg-brand-muted px-2.5 py-0.5 text-xs font-medium text-brand">
                  {posts[0].category}
                </span>
                <span className="text-xs text-muted-foreground">{posts[0].readingTime}</span>
              </div>
              <h2 className="text-2xl font-bold text-foreground leading-snug mb-3 group-hover:text-brand transition-colors sm:text-3xl">
                {posts[0].title}
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-6 max-w-3xl">
                {posts[0].description}
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{posts[0].author}</span>
                  <span>·</span>
                  <span>{formatDate(posts[0].date)}</span>
                </div>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-brand group-hover:gap-2 transition-all">
                  Read post
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </span>
              </div>
            </Link>
          )}

          {/* Remaining posts */}
          {posts.length > 1 && (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {posts.slice(1).map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="group flex flex-col rounded-xl border border-border/60 bg-background p-6 hover:border-brand/40 hover:shadow-sm transition-all"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <span className="inline-block rounded-full border border-brand/30 bg-brand-muted px-2.5 py-0.5 text-xs font-medium text-brand">
                      {post.category}
                    </span>
                  </div>
                  <h3 className="font-semibold text-foreground leading-snug mb-2 group-hover:text-brand transition-colors line-clamp-2">
                    {post.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed flex-1 line-clamp-3">
                    {post.description}
                  </p>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      {formatDate(post.date)} · {post.readingTime}
                    </div>
                    <svg className="h-4 w-4 text-brand opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
