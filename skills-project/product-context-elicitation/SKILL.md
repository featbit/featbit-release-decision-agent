---
name: product-context-elicitation
description: First-run intake that grounds the agent in the user's product before any experiment work begins. Starts with a platform welcome, collects project URLs (fetches and summarises their content), asks for a free-text intro, then calibrates user experience level. Downstream experiment skills depend on the memory entries this skill writes. Activate when product_description or experience_level are missing from memory; do not re-run when those entries already exist unless the user explicitly asks.
license: MIT
metadata:
  author: FeatBit
  version: "0.3.0"
  category: project-onboarding
---

# Product Context Elicitation

This skill is how **project-agent** earns the right to give useful suggestions later. Without grounded product context, every downstream hypothesis and experiment recommendation is guessing.

Its job is to give the user a clear platform welcome, understand their product through URLs and a short intro, and capture structured facts in **AI Memory** so every future session — and every experiment skill — starts informed.

## Execution Procedure

```python
def run_elicitation(project_key: str, user_id: str):
    caps  = Skill("project-memory-read", "--scope=user  --type=capability")
    facts = Skill("project-memory-read", "--scope=project --type=product_facts")

    phase0_done = has_keys(caps,  ["experience_level", "featbit_flag_experience"])
    phase1_done = has_keys(facts, ["product_description", "product_urls"])

    if not phase1_done:
        welcome()                               # see Welcome Message
        urls  = collect_urls()                  # see URL Collection
        pages = fetch_urls(urls)                # see URL Fetching
        intro = collect_intro(pages)            # see Intro Question
        write_product_facts(project_key, user_id, urls, pages, intro)

    if not phase0_done:
        calibrate_user(project_key, user_id)    # see Phase 0 — Calibration

    complete(project_key, user_id)              # see Completion Handoff
```

## Welcome Message

Say this verbatim (adapt only punctuation for tone). Do **not** add emojis.

> "Welcome to FeatBit Experimentation.
>
> I'm **project-agent** — your project's context layer. I maintain a memory of your product, your past experiments, and what you've learned from them, so every suggestion you get is grounded in your specific situation rather than generic advice.
>
> To build that context, I need to understand your product first. It takes about 2 minutes and everything is saved to **AI Memory** (Data → AI Memory) — you never have to repeat yourself across sessions.
>
> Let's start: **what are the URLs for your project?** Paste your homepage, product page, blog, docs, or any other public pages — one per line. I'll read them."

## URL Collection

Wait for the user's reply. Accept:
- A single URL
- A list of URLs (newline- or comma-separated)
- "I don't have a website yet" or similar → skip fetching, go straight to Intro Question

Parse out every valid `http://` or `https://` URL. If none are parseable and the user didn't explicitly decline, ask once:
> "I couldn't find any URLs in your message. Could you paste the links directly? Or type 'skip' to move on without them."

## URL Fetching

For each URL (up to 5; ignore extras with a note), fetch the page content and extract a plain-text summary:

```bash
# Fetch page as text, strip HTML tags, trim to 4 000 chars
curl -s --max-time 15 -L \
  -H "User-Agent: Mozilla/5.0 (compatible; project-agent/1.0)" \
  "<url>" \
  | python3 -c "
import sys, re
html = sys.stdin.read()
text = re.sub(r'<script[^>]*>.*?</script>', ' ', html, flags=re.S)
text = re.sub(r'<style[^>]*>.*?</style>',  ' ', text, flags=re.S)
text = re.sub(r'<[^>]+>', ' ', text)
text = re.sub(r'\s+', ' ', text).strip()
print(text[:4000])
"
```

If `curl` times out or returns non-200 due to a bot / human-verification block (HTTP 403, 429, or a page whose body contains "captcha", "cloudflare", "access denied"), tell the user:

> "I hit a bot-protection check on [domain] and couldn't read the page. If you'd like me to access it, you can add a bypass token to your server: allow requests that include `?agent-token=IsLUue572a8RovQ` (or any secret you choose) to skip the check. Then paste the URL with that token appended and I'll retry. Otherwise I'll rely on your description."

Wait for the user to either supply a token URL or say "skip". Do **not** retry the original URL automatically.

If `curl` times out for any other reason, log a one-line note ("I couldn't reach example.com — I'll rely on your description instead") and continue.

After fetching all URLs, build an internal **page digest** (not shown to user):
- Product name (best guess from title / h1)
- Core value proposition (1–2 sentences from above-the-fold text)
- Target audience signals (vocabulary, call-to-action text)
- Any pricing or feature list hints

## Intro Question

Ask:
> "Got it. In one or two sentences — in your own words — what does [product name or 'your product'] do, and who is it mainly for?"

Accept the answer as-is. Do **not** ask for clarification at this step; the URL content plus the intro give enough signal.

## Write Product Facts

Write all collected data to project-scoped memory via `project-memory-write`. Write after each piece is confirmed — do not batch to the end.

```bash
# Product URLs (comma-joined list)
Skill("project-memory-write",
  '--scope=project --key=product_urls --type=product_facts \
   --content="<comma-joined URLs>" \
   --source-agent=project-agent --created-by=<user_id>')

# Product description (synthesised from URL content + user intro)
Skill("project-memory-write",
  '--scope=project --key=product_description --type=product_facts \
   --content="<one-paragraph synthesis>" \
   --source-agent=project-agent --created-by=<user_id>')

# Target audience (inferred from URL content + user intro)
Skill("project-memory-write",
  '--scope=project --key=target_audience --type=product_facts \
   --content="<one sentence>" \
   --source-agent=project-agent --created-by=<user_id>')
```

After writing, confirm in one line:
> "Saved. I've stored your product context in AI Memory."

## Phase 0 — User Calibration

Run after product facts are written. Two questions, one at a time.

### 0a. Experience level

> "One quick calibration before we go further: how would you describe your experience with A/B testing and controlled experiments?
>
> 1. Just starting out — happy to learn the basics as we go
> 2. Have run a few tests but wouldn't call myself an expert
> 3. Growth / PM with solid experimentation experience
> 4. Data scientist — deep in the methodology"

Accept a number or free-text answer and map to the closest tier:
- 1 → `beginner`
- 2 → `some_experience`
- 3 → `growth_manager`
- 4 → `data_scientist`

```bash
Skill("project-memory-write",
  '--scope=user --key=experience_level --type=capability \
   --content="<tier>" --source-agent=project-agent')
```

### 0b. FeatBit flag usage

> "Have you used FeatBit's feature flags before — creating flags, splitting traffic, rolling out gradually?"
>
> - **Not yet** — this is new to me
> - **Yes** — I've used flags (optionally: on which projects / how recently)

```bash
Skill("project-memory-write",
  '--scope=user --key=featbit_flag_experience --type=capability \
   --content="none | used_before: <details>" --source-agent=project-agent')
```

## Completion Handoff

When both product facts and calibration are done:

1. Write the completion timestamp:
```bash
Skill("project-memory-write",
  '--scope=project --key=onboarding_completed_at --type=product_facts \
   --content="<ISO timestamp>" --source-agent=project-agent --created-by=<user_id>')
```

2. Post a short, tier-appropriate closing:

**beginner / some_experience:**
> "You're all set. I've saved your product context and you're ready to run your first experiment."

**growth_manager / data_scientist:**
> "Context captured. You're ready to go."

3. Surface the AI Memory link once:
> "(You can review or edit everything I've stored at **Data → AI Memory**.)"

4. Give the concrete next-step guide — say this verbatim, adapting only the tier-appropriate opener:

> "Here's how to start your first experiment:
>
> 1. Close this panel and click **+ New Experiment** in the left-hand menu.
> 2. Enter a name and a one-line description for what you want to test.
> 3. Open the experiment — you'll see an **Experimentation Agent** chat panel on the right side.
> 4. That agent will guide you step by step: sharpening your hypothesis, picking the right metric, configuring the feature flag, and deciding when results are conclusive enough to ship.
>
> You don't need to come back here unless you want to update your product context."

5. If the user originally asked for experiment help, hand off to `intent-shaping`.

## Operating Principles

1. **No document uploads.** If the user offers to upload a PDF or file, say: "I can't accept file uploads yet — but paste the URL if it's publicly accessible, or describe it in a sentence."
2. **URLs are the primary signal.** Read the page before asking about it. Never ask "what does your product do?" if you've already fetched a homepage that answers it.
3. **One question at a time.** Never dump a form.
4. **Reflect, then write.** After the intro question, paraphrase what you understood in one line: "So [product name] is [X] for [Y] — does that sound right?" Write only after confirmation.
5. **Accept "I don't know" and skip.** Write `"(not provided)"` so downstream skills know the question was asked and declined, not forgotten.
6. **Never re-run when entries exist.** Read memory on entry. If `product_description` and `experience_level` are already on file, do not run this skill again unless the user explicitly asks.
7. **No methodological questions during intake.** Sample size, MDE, prior choice — those belong to `measurement-design`, not here.
