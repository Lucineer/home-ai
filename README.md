# Home AI — Contextual Home Agent

You don't need another disconnected smart home interface.

> A Cocapn vessel for home management and organization. It accumulates context over time.

---

## Purpose
Many home automation tools isolate sessions or lock you into proprietary clouds. This agent provides a single, persistent interface for your home that runs on infrastructure you control. It is designed to remember and build upon previous conversations.

## 🧪 Live Reference
A stateless demo is available: [home-ai.casey-digennaro.workers.dev](https://home-ai.casey-digennaro.workers.dev)

When you deploy your own instance, all context is stored permanently within your Cloudflare Workers KV namespace.

---

## How This Works
- **No Central Service**: The agent logic and state reside entirely within your Cloudflare Worker and its associated KV storage. There is no external data pipeline.
- **Fork-First**: You copy this repository. You own and operate that copy. Updates are optional and under your control.
- **Fleet Native**: Implements the standard Cocapn Fleet protocol, allowing future interoperation with other agents.
- **Zero Dependencies**: The core agent is a single, self-contained source file with no external npm dependencies.

## Capabilities
- **Bring Your Own LLM**: Configured to work with OpenAI-compatible endpoints (e.g., DeepSeek, Moonshot, OpenRouter). Swap providers without code changes.
- **Persistent Context**: Maintains a history of conversations, tasks, and home notes across sessions in Cloudflare KV.
- **Local Execution**: Your API keys and conversation history are processed within your Worker's isolated runtime.
- **Standard Endpoints**: Exposes the standard `/v1/chat/completions` and Fleet discovery routes.

**One Limitation**: Agent memory is bound by Cloudflare Workers KV limits (1MB per key, 1GB total per namespace). Very long, unstructured histories may require manual pruning.

---

## 🚀 Deploy
1.  Fork this repository.
2.  Deploy it to Cloudflare Workers.
3.  Add your LLM API key as a `LLM_API_KEY` secret in the Cloudflare dashboard.
4.  Visit your worker's URL. The `/setup` route provides guidance.

## 🔧 Configuration
Edit `src/index.ts` to adjust the system prompt and default parameters. The agent's behavior is defined there.

---

## Development
Improvements and adaptations are welcome. This is an open vessel within the Cocapn Fleet.

## 📄 License
MIT License.

Superinstance & Lucineer (DiGennaro et al.).

---

<div>
  <a href="https://the-fleet.casey-digennaro.workers.dev">The Fleet</a> • <a href="https://cocapn.ai">Cocapn</a>
</div>