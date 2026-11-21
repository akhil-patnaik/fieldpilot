# Integrations: verified facts

Every Agora ConvoAI and Murf Falcon field, endpoint and auth detail used in this repo, with its source and how it's checked.

Status legend:
- **Doc ✓**: stated in the current official docs (checked 2026-11-21).
- **Smoke ✓**: `npm run smoke` asserts our outgoing request matches it. Requests are captured, never sent.
- **Live ☐**: not documented, or docs conflict. Needs a run with real keys; see "Open items".

---

## Agora Conversational AI Engine (REST v2)

Sources:
- [authentication.md](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/authentication.md)
- [join.md](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/join.md)
- [leave.md](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/leave.md)
- [speak.md](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/speak.md)
- [custom-llm.md](https://docs.agora.io/en/ai/build/custom-model-integration/custom-llm.md)
- [models/tts/murf.md](https://docs.agora.io/en/ai/models/tts/murf.md)
- [models/asr/ares.md](https://docs.agora.io/en/ai/models/asr/ares.md)

Code: [server/agora.ts](../server/agora.ts).

### A1. Auth and tokens
| Fact | Status |
|---|---|
| Header is `Authorization: agora token="<token>"`, with the quotes. The alternative is `Basic base64(customerId:customerSecret)`. | Doc ✓ Smoke ✓ |
| The **same token** goes in the header and in `properties.token`. | Doc ✓ Smoke ✓ |
| Built with `ConvoAITokenBuilder.buildToken(appId, cert, channel, agentUid, expire, privilegeExpire)`, which gives ConvoAI + RTC + RTM privileges. | Doc ✓ (agora-token 2.0.7 ships it) |
| Token channel must equal `properties.channel`; token UID must equal `properties.agent_rtc_uid`. Max lifetime 86400 s. We use 86400. | Doc ✓ Smoke ✓ |
| The browser user joins with an RTC token from `RtcTokenBuilder.buildTokenWithUid(..., PUBLISHER)`. | Standard RTC; Live ☐ |

**Fixed in this phase:** the header was sent without quotes, and the header and body used two different tokens.

### A2. Join: `POST https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/join`
| Field we send | Value | Status |
|---|---|---|
| `name` | unique per start | Doc ✓ |
| `properties.channel`, `token` | see A1 | Doc ✓ Smoke ✓ |
| `properties.agent_rtc_uid` | `"1000"` (string) | Doc ✓ Smoke ✓ |
| `properties.remote_rtc_uids` | `["<userUid>"]`, one UID only | Doc ✓ Smoke ✓ |
| `properties.idle_timeout` | 120 | Doc ✓ |
| `properties.advanced_features.enable_rtm` | `false`; transcripts come over our own SSE, not RTM | Doc ✓ |
| `properties.asr` | `{ vendor: "ares", language: "en-US" }` | Doc ✓ (ares.md example) / see open item O3 |
| `properties.llm.url` | `${PUBLIC_URL}/llm/chat/completions` | Doc ✓ Smoke ✓ |
| `properties.llm.api_key` | `LLM_PROXY_SECRET` (or a stable derived hash) | Doc ✓ |
| `properties.llm.vendor` / `style` | `"custom"` / `"openai"` | Doc ✓ Smoke ✓ |
| `properties.llm.system_messages` | `[]`; our server owns the system prompt | Doc ✓ |
| `properties.llm.max_history` | 12 (default 32); our server keeps its own full history incl. tool calls | Doc ✓ |
| `properties.llm.greeting_message` / `failure_message` | spoken via TTS on join, and on custom-LLM failure | Doc ✓ |
| `properties.llm.params` | `{ model: "fieldpilot-agent" }`, passed through to us and ignored | Doc ✓ |
| `properties.turn_detection` | `{ mode: "default", config: { end_of_speech: { mode: "semantic", semantic_config: { silence_duration_ms: 320, max_wait_ms: 3000 } } } }` | Doc ✓ Smoke ✓ |
| `properties.parameters` | `{ data_channel: "datastream", enable_error_message: true }` | Doc ✓ |

Semantic end-of-speech works only for `en-US`, `en-IN`, `zh-CN`, `zh-HK` and `zh-TW`. Other languages fall back to VAD. (Doc ✓)

Response `200`: `{ agent_id, create_ts, status }`, where `status` is `IDLE | STARTING | RUNNING | STOPPING | STOPPED | FAILED`. Errors: `{ detail, reason }`. (Doc ✓; we surface `detail`/`reason`.)

### A3. Murf TTS inside Agora
```json
"tts": { "vendor": "murf", "params": {
  "api_key": "<MURF_API_KEY>", "base_url": "wss://global.api.murf.ai/v1/speech/stream-input",
  "voiceId": "Matthew", "locale": "en-US", "model": "FALCON", "sample_rate": 24000 } }
```
| Fact | Status |
|---|---|
| The REST params keys are exactly `api_key`, `base_url`, `voiceId`, `locale`, `rate`, `pitch`, `model`, `sample_rate`, as in the Agora REST example. Agora's SDK examples use `key`/`voice_id` instead; we follow the REST doc. | Doc ✓ Smoke ✓ |
| `"FALCON"` is the model string in Agora's example. Murf says it is a legacy alias that maps to Falcon 2.1. | Doc ✓ |
| Unlisted params are passed through to Murf without validation. | Doc ✓ |

### A4. Custom LLM endpoint (Agora → us)
| Fact | Status |
|---|---|
| Agora POSTs an OpenAI-style chat-completion request (`messages`, `model`, `stream`, `tools`, …). | Doc ✓ |
| We must stream back SSE: `data: {chat.completion.chunk}\n\n`, ending with `data: [DONE]\n\n`. | Doc ✓ Smoke ✓ |
| With `vendor: "custom"`, Agora adds `turn_id` (starting at 0) and `timestamp` (ms) "in addition to role and content". | Doc ✓; **placement Live ☐** |
| Which headers Agora sends, and whether `api_key` arrives as `Authorization: Bearer …`. | **Not documented, Live ☐** |
| Request timeout. | **Not documented, Live ☐** |

Handling: we read only the last `user` message, so `turn_id` placement doesn't matter. If an `Authorization` header is present it must contain our secret; if absent, we allow the request and the shape log shows it. The first request's shape is logged once as header names, auth scheme and body/message keys, never values (`[llm] first request shape:`).

### A5. Speak: `POST …/agents/{agentId}/speak`
| Fact | Status |
|---|---|
| Body `{ text, priority, interruptable }`. `priority` is `INTERRUPT` (default), `APPEND` or `IGNORE`. Proactive Watchtower insights and confirmations use `APPEND` so we never cut the agent off mid-sentence. **Safety-critical** insights use `INTERRUPT` with `interruptable: false`, so the warning can't be talked over. | Doc ✓ Smoke ✓ (APPEND) · selftest ✓ (both priorities, captured) |
| Speak is not a turn: what the agent says via `speak` is pushed into our own conversation history, so the LLM knows what it offered when the technician answers "yes, do it". | Design |
| Whether Agora's own turn handling delays an `APPEND` speak while the user is mid-utterance is **not documented**. We don't rely on it: Watchtower only calls `speak` when the browser reports silence (mic and agent audio levels via `/api/presence`) and no turn is running. | **Live ☐** (behaviour verified on our side only) |
| `text` max **512 bytes**. We clamp by UTF-8 bytes at a sentence boundary. | Doc ✓ Smoke ✓ (**fixed**: was 500 characters) |
| The 200 body is described as empty, but the example shows `{agent_id, channel, start_ts}`. We tolerate both. | Doc conflict, handled |

### A6. Leave: `POST …/agents/{agentId}/leave`
No request body; 200 with an empty body. (Doc ✓ Smoke ✓; **fixed**: we were sending `{}`.)

---

## Murf Falcon (direct HTTP streaming, used by Direct mode)

Sources:
- [streaming.md](https://murf.ai/api/docs/text-to-speech/streaming.md)
- [api-reference stream.md](https://murf.ai/api/docs/api-reference/text-to-speech/stream.md)
- [falcon](https://murf.ai/api/docs/text-to-speech-models/falcon)
- [voice-library.md](https://murf.ai/api/docs/voices-styles/voice-library.md)
- [errors.md](https://murf.ai/api/docs/text-to-speech/errors.md)
- [rate-limits.md](https://murf.ai/api/docs/resources/rate-limits.md)

Code: [server/murf.ts](../server/murf.ts).

### M1. Request
| Fact | Status |
|---|---|
| `POST https://global.api.murf.ai/v1/speech/stream`, header `api-key: <key>`, JSON body. | Doc ✓ Smoke ✓ |
| Body fields (camelCase): `text`, `voiceId`, `locale`, `model`, `format`, `sampleRate`. Optional: `style`, `rate`, `pitch` (-50..50), `volumeOffset`, `channelType`, `pronunciationDictionary`. | Doc ✓ Smoke ✓ |
| `model: "falcon-2.1"` (the default). `FALCON`, `falcon-2` and `falcon2` are accepted aliases. | Doc ✓ |
| `format` is one of `MP3, FLAC, WAV, ALAW, ULAW, OGG, PCM`; the **default is WAV**, so we send `MP3` explicitly. | Doc ✓ Smoke ✓ |
| `sampleRate` is one of 8000, 16000, 24000, 44100, 48000; we use 24000. | Doc ✓ |

### M2. Voices
| Fact | Status |
|---|---|
| Falcon voice IDs are plain names. `Matthew` is listed for `en-US`. A full ID like `en-US-natalie` also works. | Doc ✓ |
| en-IN Falcon voices: Aarav, Abhinav, Anisha, Anusha, Nikhil, Pooja, Priya, Samar, Chirag, Hardik, Jaya, Neeta, Nimisha, Poonam, Pranav, Prathamesh, Rachna. | Doc ✓ |
| The authoritative list is `GET /v1/speech/voices?model=falcon-2.1`. | Doc ✓ |

### M3. Response and limits
| Fact | Status |
|---|---|
| The body is "a stream of audio bytes" over chunked transfer encoding. The response Content-Type is not documented (the OpenAPI spec says application/json), so we set `audio/mpeg` ourselves. | Doc conflict, handled; **Live ☐** |
| Progressive MP3 playback in a browser `<audio>` element. | **Not documented, Live ☐** |
| Concurrency: 5 slots on US-East, 2 on global/regional endpoints. An HTTP request holds a slot until its audio finishes. Usage headers: `X-Murf-Concurrency-*`. | Doc ✓; we log when the limit is hit |
| Errors: 400 bad field (e.g. voiceId), 402 quota, **403 bad key (not 401)**, 429 concurrency with `Retry-After`. | Doc ✓ Smoke ✓ (we pass these through; was a blanket 502) |
| Max text length per request. | **Not documented, Live ☐**; we split speech into sentences, so requests stay short |

Direct mode plays at most 1 sentence and prefetches 1 more, so it uses ≤ 2 concurrent slots, which fits the global limit of 2.

---

## MCP (Model Context Protocol)

| Fact | Status |
|---|---|
| The server is `@modelcontextprotocol/sdk` 1.32.2 using `StreamableHTTPServerTransport` in stateless mode (`sessionIdGenerator: undefined`) at `POST /mcp`. GET and DELETE return 405. | Verified: `npm test` connects an external SDK client |
| The agent loop is itself an MCP client (`StreamableHTTPClientTransport`). Voice and text tool calls all execute through `/mcp`, recognized by an internal header. External clients go through the same confirmation gate. | Verified: `npm test` |
| MCP Inspector **2.16.0** CLI: `tools/list` returns 18 tools. `tools/call check_part_availability` works, `create_purchase_order` returns `CONFIRMATION_REQUIRED`, and `confirm_action` executes it (actor shown as "External MCP client" in the audit log). | Verified manually (2026-11-21) |
| The Inspector CLI sends `--tool-arg ticket_id=48213` as a **number**. ID fields use `z.coerce.string()`, so numeric IDs are accepted, as an LLM might send them too. | Fixed + verified |

## Embeddings for RAG (OpenAI-compatible `/embeddings`)

| Fact | Status |
|---|---|
| Called via the `openai` SDK `embeddings.create({ model, input })` against `EMBEDDING_BASE_URL` (default `LLM_BASE_URL`). The corpus is embedded once, lazily, in one batch; queries are embedded per search and cached. | Verified against a local OpenAI-compatible fake in `npm test`; **Live ☐** against your provider |
| Not every OpenAI-compatible provider has `/embeddings` (e.g. Groq, and Anthropic's compatibility layer). So the feature is off unless `EMBEDDING_MODEL` is set, except it auto-enables `text-embedding-3-small` when the provider is OpenAI. | Design choice |
| Failure (no endpoint, timeout, bad key) → logged once, permanent BM25 fallback for the process; a per-query failure → BM25 for that query. | Verified in `npm test` (dead endpoint) |
| Retrieval mode is visible at `GET /api/kb`, in each `search_knowledge_base` result (`retrieval`), and in the Knowledge tab. | Verified |

## Pre-flight calls (Phase 5)

| Call | Purpose | Status |
|---|---|---|
| LLM: streamed chat completion, `max_tokens: 5`, "Reply with the single word OK." | Proves key, model and streaming; reports time to first token | Standard OpenAI-compatible call |
| Murf: `GET https://global.api.murf.ai/v1/speech/voices?model=falcon-2.1` with header `api-key` | Proves the key and that `MURF_VOICE_ID` exists on Falcon, without spending characters | The endpoint is documented in Murf's voice library. Using the `api-key` header here (rather than only on `/speech/stream`) is **Live ☐**; a 401/403 is reported as a bad key |
| Agora: `HEAD https://api.agora.io` + local ConvoAI token build | Proves network reachability and that the credentials produce a token. The `join` itself is only exercised by a real call | Doesn't touch any project resources |
| Tunnel: `GET ${PUBLIC_URL}/api/health`, comparing `instanceId` | Proves the public URL reaches *this* process, not a stale tunnel | Ours |

## Backup brain
[server/backupBrain.ts](../server/backupBrain.ts) is a deterministic OpenAI-compatible endpoint (`POST /backup/v1/chat/completions`, streamed `chat.completion.chunk` with `tool_calls`). It covers the demo story when no LLM is configured, or on demand (Pre-flight toggle, `POST /api/backup`, `BACKUP_MODE=1`). Agora's custom-LLM path also works with it: Agora calls our `/llm` endpoint, which runs the same agent loop with the backup brain.

## Open items (need your keys / public URL)

| # | What to verify live | How |
|---|---|---|
| O1 | Join succeeds with our exact body (Murf `voiceId` casing, `FALCON`, ARES without `asr.params`) | Start an Agora call; a failure shows Agora's `detail`/`reason` in the UI |
| O2 | Agora → custom LLM: auth header, `turn_id` placement, timeout | Read the `[llm] first request shape:` server log line |
| O3 | join.md marks `asr.params` "required" but the ARES example omits it | If join returns 4xx about asr, add `params: {}` |
| O4 | Murf HTTP MP3 plays progressively in Chrome `<audio>` | Direct voice mode with `MURF_API_KEY`; fallback is browser TTS |
| O5 | User RTC token (`buildTokenWithUid`) is accepted by the browser SDK join | Agora voice mode |
| O6 | Agora `speak` (proactive updates) is audible mid-call | Approve a PO over the limit and wait about 14 s |
