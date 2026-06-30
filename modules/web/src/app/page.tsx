"use client";

import Image from "next/image";
import { useEffect } from "react";

const FEATBIT_HOME_URL = "https://featbit.co";
const REDIRECT_DELAY_MS = 6000;

const gatewayMessages = [
  {
    lang: "EN",
    text: "FeatBit is powering AI-native engineering workflows.",
  },
  {
    lang: "中文",
    text: "FeatBit 正在驱动 AI Native 研发环境。",
  },
  {
    lang: "FR",
    text: "FeatBit alimente les environnements d'ingénierie AI-native.",
  },
  {
    lang: "ES",
    text: "FeatBit impulsa entornos de ingeniería AI-native.",
  },
  {
    lang: "日本語",
    text: "FeatBit は AI ネイティブな開発環境を支えています。",
  },
  {
    lang: "DE",
    text: "FeatBit stärkt AI-native Engineering-Umgebungen.",
  },
];

export default function HomePage() {
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timeout = window.setTimeout(
      () => window.location.assign(FEATBIT_HOME_URL),
      prefersReducedMotion ? 500 : REDIRECT_DELAY_MS,
    );

    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <main className="relative isolate flex min-h-screen overflow-hidden bg-[#06120f] px-6 py-12 text-white sm:py-16">
      <div className="featbit-jump-grid absolute inset-0 opacity-70" />
      <div className="featbit-jump-scan absolute inset-0" />
      <div className="featbit-jump-beam absolute inset-0" />
      <div className="featbit-jump-horizon absolute left-1/2 top-1/2 h-px w-[120vw] -translate-x-1/2 bg-[#3cc798]/25" />
      <div className="absolute left-1/2 top-1/2 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#3cc798]/20" />
      <div className="absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#6751d6]/20" />
      <div className="absolute left-1/2 top-1/2 h-[18rem] w-[18rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#3cc798]/15" />
      <div className="featbit-jump-data featbit-jump-data-left absolute left-[8%] top-0 hidden h-full w-24 sm:block" />
      <div className="featbit-jump-data featbit-jump-data-right absolute right-[8%] top-0 hidden h-full w-24 sm:block" />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center justify-center text-center">
        <div className="featbit-jump-core relative flex size-40 items-center justify-center rounded-full border border-[#3cc798]/35 bg-[#09211b]/80 shadow-[0_0_100px_rgba(60,199,152,0.38)] backdrop-blur">
          <span className="featbit-jump-orbit featbit-jump-orbit-one" />
          <span className="featbit-jump-orbit featbit-jump-orbit-two" />
          <span className="featbit-jump-orbit featbit-jump-orbit-three" />
          <span className="featbit-jump-pulse" />
          <span className="featbit-jump-node featbit-jump-node-one" />
          <span className="featbit-jump-node featbit-jump-node-two" />
          <span className="featbit-jump-node featbit-jump-node-three" />
          <Image
            src="/logo.svg"
            alt="FeatBit"
            width={72}
            height={72}
            priority
            className="relative z-10 size-[72px]"
          />
        </div>

        <div className="mt-10 max-w-2xl">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.42em] text-[#6ee7c2]">
            FeatBit Gateway
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-normal text-white sm:text-5xl">
            Entering featbit.co
          </h1>
          <p className="mt-4 text-base leading-7 text-[#9cf5d8] sm:text-lg">
            FeatBit is powering AI-native engineering workflows.
          </p>
          <p className="mt-3 text-sm leading-6 text-white/62 sm:text-base">
            Establishing a secure connection and syncing the product entry
            point. You will be redirected automatically.
          </p>
        </div>

        <div className="featbit-jump-message-wall mt-8 grid w-full max-w-3xl gap-2">
          {gatewayMessages.map((message) => (
            <div
              className="featbit-jump-message flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.045] px-3 py-2 text-left backdrop-blur"
              key={message.lang}
            >
              <span className="w-14 shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6ee7c2]">
                {message.lang}
              </span>
              <span className="text-xs leading-5 text-white/72 sm:text-sm">
                {message.text}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-9 flex w-full max-w-xl flex-col gap-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="featbit-jump-progress h-full rounded-full bg-[#3cc798] shadow-[0_0_18px_rgba(60,199,152,0.9)]" />
          </div>
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-white/45">
            <span>Route /</span>
            <span>Target featbit.co</span>
          </div>
        </div>

        <a
          href={FEATBIT_HOME_URL}
          className="mt-9 rounded-md border border-[#3cc798]/35 px-4 py-2 text-sm font-medium text-[#9cf5d8] transition-colors hover:border-[#3cc798]/70 hover:bg-[#3cc798]/10"
        >
          Continue now
        </a>
      </div>
    </main>
  );
}
