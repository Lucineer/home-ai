# Home AI — Your Home Remembers

You forget when the plumber said to wait before using the shower, or what your niece wanted from the store last month. This keeps track. Ask about anything you’ve told it before. All memory is stored only in your own Cloudflare account.

**Live example:** [home-ai.casey-digennaro.workers.dev](https://home-ai.casey-digennaro.workers.dev)

---

## Why This Exists
Commercial assistants keep your household memories on their servers. This gives you a private alternative. It is simple, self-hosted, and yours.

---

## Quick Start

1.  **Fork** this repository.
2.  **Deploy** it to Cloudflare Workers with one click from your forked repo.
3.  **Add** one LLM API key as a Cloudflare Secret. It works with OpenAI-compatible providers like DeepSeek, Moonshot, or DeepInfra.
4.  **Visit** your worker's `/setup` route for final setup steps.

Your instance is now running. All memory persists in your private Cloudflare KV store.

---

## What This Is
A single-file Cloudflare Worker with zero dependencies. It stores your full conversation history and connects to the LLM provider you choose. It follows the Cocapn Fleet protocol so it can work with other tools you run.

**You get:**
- Memory that lasts across all conversations.
- The ability to change your LLM provider anytime by editing a secret.
- A system that never sends your data or keys through any intermediary server.
- A service that fits within Cloudflare's free tier for typical household use.

**You control:**
- The code. You forked it; no one can push updates or disable it.
- The data. Everything stays in your Cloudflare KV namespace.
- The endpoint. You point it to your chosen LLM API.

---

## A Real Limitation
This uses Cloudflare KV for storage. On the free tier, KV is limited to 100,000 reads and 1,000 writes per day. For most homes, this is sufficient. If your household generates an unusually high volume of messages, you may need to monitor usage or upgrade to a paid Workers plan.

---

## Open Source
MIT licensed. Fork, modify, and use it as you like.

Superinstance and Lucineer (DiGennaro et al.).

<div style="text-align:center;padding:16px;color:#64748b;font-size:.8rem"><a href="https://the-fleet.casey-digennaro.workers.dev" style="color:#64748b">The Fleet</a> &middot; <a href="https://cocapn.ai" style="color:#64748b">Cocapn</a></div>