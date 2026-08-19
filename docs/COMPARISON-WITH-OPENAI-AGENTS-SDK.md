# coderun-agent vs OpenAI Agents SDK

> Comparison against the **official OpenAI Agents SDK** (`openai-agents`, Python — per the docs at
> `openai.github.io/openai-agents-python`). Our SDK is `coderun-agent`, a **plain-JavaScript (ESM)**
> agent runtime. The parity proof for every claim below is automated in
> [`test/test_openai_sdk_comparison.js`](../test/test_openai_sdk_comparison.js).

---

## 1. Executive summary

| Subject | coderun-agent | OpenAI Agents SDK |
| --- | --- | --- |
| Language / style | Plain JS, ESM, no `class` | Python (+ separate JS SDK) |
| Model protocol | Chat Completions only (provider-agnostic) | Responses (default) + Chat Completions |
| Runs are wide-open stateless | Yes — `run()` owns one turn | Yes — `Runner.run()` owns one turn |
| Multi-turn history | Opt-in, caller-passed `history` (any provider) | `to_input_list()` / Sessions / server-managed Conversations |
| Provider flexibility | First-class: `openai-compatible` covers Ollama, Groq, OpenRouter, Gemini, DeepSeek, etc. | OpenAI-first; non-OpenAI needs Chat Completions + custom provider / adapter |
| HIL approvals | In-process pause → user callback `resolve(true)/resolve(false)` | Pause whole run (`RunState`) → `approve()/reject()` → resume |
| Guardrails | Lists of plain functions (input / tool / output) | Guardrail functions returning tripwires (input runs parallel) |
| Structured output | `outputSchema` (JSON schema / Zod) + auto-repair loop | `output_type` (Pydantic / strict JSON schema) |
| Streaming | `onEvent` (thinking/content/tool events) + aggregated result | `run_streamed()` + `stream_events()` |
| Usage | Per-run `result.usage`, plus `agent.getUsage()` accumulator | `context_wrapper.usage` + `request_usage_entries` |
| Sub-agents | Agents as tools (`createSubagentTool`) | Handoffs + `Agent.as_tool()` |
| MCP | Built-in `connectMcp` | Built-in MCP servers |

**Verdict:** the two SDKs solve the same problem — *"give the model tools and loop until it
returns an answer"* — but with opposite center of gravity. OpenAI's SDK optimizes for OpenAI
(Responses API, server-managed conversations, durable `RunState`, tracing) and treats non-OpenAI
models as an afterthought (Chat Completions adapter + community/LiteLLM paths). `coderun-agent`
optimizes for **provider portability and full caller ownership of context** — exactly the "chat
switchability without losing the agent turn" design the user wants.

---

## 2. The agent loop

Both run the same classic loop:

1. Call the LLM with the current input.
2. If the model emitted **tool calls**, execute them, append the results, and loop again.
3. If the model produced **no tool calls** — that is the final output → end.

OpenAI (docs, *Running agents*): *"if the runner classifies the LLM's output as final output, the
loop ends... If the LLM requests a handoff, we update the current agent... If the LLM produces tool
calls, we run those tool calls, append the results, and re-run the loop."* It gates the loop with
`max_turns` and raises `MaxTurnsExceeded`.

coderun-agent: `src/agentLoop.js` loops `< maxIterations`; returns
`status: 'max_iterations_reached'` on exhaustion (OpenAI raises an exception; we return a structured
result — nicer for libraries).

**Difference that matters:** OpenAI decides "final output" by *type* (text output with the desired
type and no tool calls). We decide by *absence of tool calls* in the same way, but then also run the
output guardrails / `outputSchema` check before accepting it.

OpenAI's loop supports **handoffs** (switching `current agent` mid-loop). We support delegation via
**subagents-as-tools** (`createSubagentTool`) instead; a tool that runs another `createAgent`
instance and feeds its `usage` back (`recordUsage`). Handoffs are more native for router-style
graphs; subagent tools are closer to "the manager owns the loop".

---

## 3. Statelessness & history — the crux of the user's design

The user's requirement: **"my agents sdk should not know about the previous user message or
previous agent loop execution... one user message and the llm responses and thinking tokens with the
exact key sent by model and tool calls... that's it."**

This is *already how both SDKs work by default*, but the escape hatches differ:

### OpenAI Agents SDK
- A `Runner.run(agent, input)` is **stateless per run** — it takes `input` (string, Responses input
  items, or `RunState`) and returns a `RunResult`. There is no hidden session.
- **Multi-turn** requires the caller to choose a strategy (docs: *"choose a memory strategy"*):
  1. `result.to_input_list()` — caller-owned, any provider, manual.
  2. `session` (`SQLiteSession`, etc.) — SDK-persisted, but the SDK manages it.
  3. `conversation_id` + `previous_response_id` — **Responses-API/OpenAI-server-managed** only.
- Confirms the user's reading: the "server-managed history via your API" idea is OpenAI-only
  (`conversation_id`, `previous_response_id`). For any other provider you fall back to the manual
  `to_input_list()` path (caller-owned history) and **must use Chat Completions** because non-OpenAI
  providers don't speak the Responses API.

### coderun-agent
- `agent.run(prompt, { history })` is **stateless per run**. `src/agentLoop.js` starts from
  `options.history || []` (a fresh copy per run — `index.js` slices it) and returns the transcript in
  `result.history`. There is no internal store, no `getHistory`/`setHistory`, nothing leaking between
  two `run()` calls (proven in the tests: two runs on the same agent produce fully independent
  transcripts and per-run usage).
- **Multi-turn** = the caller passes `history: result.history` back on the next call. This is
  provider-agnostic (works identically against Ollama, Groq, OpenRouter, Anthropic, DeepSeek...). The
  caller owns the transcript, so switching chat sessions / chat shards is trivial.
- `agent.getUsage()` / `agent.resetContext()` keep only **aggregate observability** across runs
  (token totals, agent state machine) — never conversation content.

> Net: we match "caller owns context, agent stays per-turn fresh" and additionally make the same
> guarantee work uniformly on every provider, which the OpenAI SDK only offers for the manual
> `to_input_list()` path.

---

## 4. Tool calls & response shape

Requirement: **"the tool calls also should be in the output (tool called and tool args and tool
execution output)"** and **"thinking tokens and content tokens with the exact key sent by model."**

- OpenAI `RunResult` exposes `new_items` (model output / tool call output items) and the conversation
  list; reasoning is surfaced as `reasoning` items.
- coderun-agent `result` exposes `content`, `thinking` (aggregated), `toolCalls`
  (`[{ id, name, args, output }]` — the tool-name/args/execution-output triple the user asked for),
  `structuredOutput`, `usage`, `iterations`, and `history` (a full `user → assistant(thinking,
  tool_calls) → tool → ... → assistant` transcript).
- Thinking keys: the provider keeps the **exact key the model sent** — `reasoning_content` (DeepSeek
  / Qwen reasoning via OpenAI-compatible), `thinking` (Anthropic extended thinking), or `reasoning`
  — and it round-trips through history without alias duplication (guaranteed by
  `test_exact_reasoning_key.js` and again in the comparison test). No other SDK we compared (including
  OpenAI's, which normalizes to its own `reasoning` item shape) preserves the raw key this strictly.

During this comparison we **found and fixed a real bug**: reasoning text was double-counted in
streaming runs (once from `thinking` stream events, once from the accumulated `reasoningContent`),
because a streamed Anthropic/OpenAI response carries the full reasoning *and* re-emits it per delta.
Fixed in `src/agentLoop.js` so streaming reasoning is counted exactly once per iteration.

---

## 5. Human-in-the-loop (HIL) permissions

Requirement: **"agent loop should pause and call the user's function; the user handles it through
UI/console; call resolve(true) to allow, resolve(false) to deny; the loop continues."**

### OpenAI Agents SDK (interruption model)
- Tools opt in via `needs_approval=True` (or a callable per call).
- When approval is needed, the **whole run pauses and returns**, surfacing
  `RunResult.interruptions` (`ToolApprovalItem` with `tool_name`, `arguments`, `call_id`).
- The caller converts to `state = result.to_state()`, calls `state.approve(...)` / `state.reject(...)`
  (with optional `always_approve` / `always_reject`, `rejection_message`, `tool_error_formatter`),
  then **resumes**: `Runner.run(agent, state)`.
- `RunState` is serializable (`to_json()` / `to_string()`) → approvals can be durable across
  processes and even later in time (a human DevOps review flow). Streaming has the same flow via
  `RunResultStreaming`.
- Cost: the caller must orchestrate the pause/resume/serialize loop themselves; there is no
  call-you-back-while-running primitive.

### coderun-agent (callback model) — matches the user's spec exactly
- Tools declare `needsApproval: true`, or run-wide `needsApproval: ['delete_file']` / `true`.
- When the model calls such a tool, the loop **pauses in place** and calls the user's
  `permissionHandler(toolName, args, callId, permissionApi)`.
  - `permissionApi.approve()` / `permissionApi.deny()` / `permissionApi.resolve(true|false)`
    resume the loop once called (UI button, console, HTTP approval, any mechanism).
  - Returning a `Promise<boolean>` (or a bare boolean / async handler) also works; **first
    decision wins**.
- `onEvent` emits `permission_request` and `permission_response { approved }` so a UI layer can hook
  in for free.
- A denial feeds `Permission denied by user. Do NOT retry...` back to the model, and the loop
  continues so the agent can report it gracefully (asserted in the comparison test).
- Bonus determinism for embedded apps: `createAgent` *requires* a `permissionHandler` whenever any
  tool needs approval (fail fast at construction), while allowing a per-run override.

> Head-to-head: OpenAI gives you durable, resumable, cross-process approvals but makes your app
> implement the state machine. coderun-agent gives you an in-process pause where the loop will not
> advance until your callback says yes/no — the literal "UI/console resolve(true)/resolve(false)"
> flow, with events for UI wiring. For desktop/terminal/embedded UIs this is simpler; for
> distributed workflows OpenAI's `RunState` story is stronger.

---

## 6. Guardrails

Requirement: **"input guardrails, tool guardrails, output guardrails... a list of functions to check
pre or during or post llm agent call loop."** Also "for my agents, the guardrails are just being my
agent should be able to handle the llm response properly."

| | OpenAI Agents SDK | coderun-agent |
| --- | --- | --- |
| Input | async fn → `GuardrailFunctionOutput(tripwire_triggered)`; **parallel by default** (can be blocking) | list of fns `(prompt) => false | {pass:false}`; run **blocking before** any LLM call |
| Tool | per-`FunctionTool` `tool_input_guardrails` / `tool_output_guardrails` | run-wide `toolGuardrails: [(toolName, args) => pass?]` before execution; blocked → feedback to model |
| Output | async fn → tripwire on the final output; raises `OutputGuardrailTripwireTriggered` | `outputGuardrails: [(content) => pass?]` after final turn; fail → auto self-correction retry, else `status:'guardrail_blocked'` |
| Tripwires | exceptions (SDK halts); `MaxTurnsExceeded` also an exception | structured `status` codes on the result (`guardrail_blocked`, `schema_validation_failed`, ...) |

Implementation difference philosophy: OpenAI's guardrails are *typed protocol objects* with an
explicit `GuardrailFunctionOutput`; ours are **plain functions returning boolean / `{pass}`** — the
"list of functions" the user described. Behavior parity for the user-facing contract is verified in
`test_guardrails_pipeline.js` and in the comparison test (input blocks before execution, tool
guardrail sends correction back, output guardrail triggers self-correction, streaming structured
output auto-repairs invalid JSON).

---

## 7. Structured output

- OpenAI: `Agent(..., output_type=MyPydanticModel)` with strict JSON schema; the runner retries a
  `max_output_tokens` repair when the model violates the schema.
- coderun-agent: `outputSchema` (plain JSON schema or Zod object). After a final turn it validates
  the content, and on failure pushes a corrective user message and loops again (auto-repair), even
  **while streaming** (verified in the comparison test). Result carries validated data in
  `result.structuredOutput`.

---

## 8. Streaming & usage

Requirement: **"usage also should be in the output while streaming and non-streaming."**

- OpenAI: `Runner.run_streamed()` → consume `stream_events()`; `usage: context_wrapper.usage`
  (requests, input/output/total) plus per-request `request_usage_entries`; for third-party
  adapters you often must set `ModelSettings(include_usage=True)` to get usage chunks.
- coderun-agent: `stream: true` → `onEvent` receives `thinking` (with `reasoningKey`), `stream` text,
  `tool_call` / `tool_result`, `permission_*`, `state_changed` events — while `result.usage` is
  aggregated for the whole run and `result.rawResponse` for streaming carries `{ streamed, model,
  chunksCount, finishReason }`. OpenAI-compatible providers send `stream_options: { include_usage:
  true }` by default (opt-out via `streamOptions: false`). Usage is surfaced **in every return path**
  (success, guardrail-blocked, max iterations, timeout/abort, error).

---

## 9. Provider model — the OpenAI-centric tradeoff (user's critique, verified)

User's claim: *"it is openai centric... with other providers we cannot use responses api, we have to
use chatcompletions api."*

- Confirmed by the docs (*Models*): the recommended path is the **Responses API**; for any non-OpenAI
  provider you must use **Chat Completions** (`OpenAIChatCompletionsModel` + `base_url`/`api_key`),
  or a custom `ModelProvider`, or third-party adapters (LiteLLM, any-llm), or `MultiProvider` for
  routing. Server-managed history (`conversation_id`, `previous_response_id`) is Responses-only.
- `coderun-agent` is Chat-Completions-only by design — which is the *common denominator* that every
  provider (Anthropic, Ollama, Groq, OpenRouter, Gemini, DeepSeek, local LLMs...) speaks, so no
  feature is locked out by switching providers. Anthropic gets a first-class adapter that maps
  messages/thinking/tool blocks to the Anthropic SDK, keeping the *same* behavior (thinking key
  `thinking`, tool-result batching).
- Practical result: the same `agent.run()` + `history` + `permissionHandler` + guardrail code moves
  from Ollama to Groq to Anthropic by changing the config — nothing else changes. With OpenAI's SDK
  that port requires adopting a different model/provider surface and giving up Responses-only
  conveniences.

---

## 10. What OpenAI's SDK has that we don't (yet) — and our equivalents

| OpenAI feature | coderun-agent status / equivalent |
| --- | --- |
| Handoffs (native agent-switch) | Subagent delegation via `createSubagentTool` / agents passed as `tools`/`subagents`; recursive nesting, parallel coordination, in-subagent HIL, usage bubbling (see §11) |
| Sessions storage layer (SQLite/Redis/Mongo/Dapr...) | Caller-owned `history`; `resetContext()` for the observability accumulator |
| Built-in tracing (Traces/Spans) + eval/fine-tune export | `onEvent` + state machine; no tracing backend |
| Hosted tools & sandboxes (web-search, file-search, code-interpreter, shell) | Web/function tools you define; MCP via `connectMcp` |
| `RunState` durable approvals (cross-process) | In-process `permissionHandler` pause |
| Responses-only extras (WebSocket transport, prompt caching, conversation state) | Not applicable (Chat-Completions based) |
| Programmatic tool calling / tool namespaces | Out of scope |

Everything the user explicitly asked for (per-run isolation, exact thinking keys, tool
name/args/output round-trip, pause-and-resolve HIL, guardrail function lists, structured output
streaming, usage in output, any-provider portability) is implemented in `coderun-agent` and is
**asserted by the automated comparison suite**.

### Subagents vs. handoffs (the tradeoff the user flagged)

The user noted the OpenAI Agents SDK's **handoff** mechanism as a drawback. Here is the concrete
design gap this project closes:

| | OpenAI Agents SDK | coderun-agent |
| --- | --- | --- |
| Switch mechanism | `handoffs=[Agent]` — the run **surrenders** control to another agent mid-loop | `subagents: [agent]` / `tools: [agent]` — the manager **delegates a tool call**, waits for the result, and keeps running |
| Nested delegation | Handoff chains are explicit; nesting requires manual orchestration | Subagents are full agents, so a subagent can itself have `subagents`/agent-tools (recursion — verified for `orchestrator → researcher → topic expert` in `test_subagent_full_agents.js`) |
| Parallel / split-task | Handoffs are a single switch; parallel sub-agent work needs extra orchestration | `parallelTools: true` runs several delegated subagents **concurrently** (asserted: max concurrent ≥ 2), each with its own loop |
| HIL in a subagent | Handoffs use the same interruption flow, but approval handling at every hop is caller-managed | Subagents run the same permission gate; tools inside the subagent can `needsApproval`, its own `permissionHandler` (or a cascade of the parent's when none is set) gates them |
| Token accounting | Aggregated on the run; per-agent split via items | Subagent usage **bubbles** into the parent `result.usage` / `agent.getUsage()` |
| Event visibility | `RunResult.items` per hop | Subagent events forwarded as `{ type: 'subagent_event', subagent, event }` |

The "loop inside a loop" mental model the user described matches exactly how this is built: a
subagent is a full `createAgent` instance (same loop, same HIL, same tools, same guardrails) that
happens to be callable as a tool — and that tool can itself call other subagents, or be left to run
independently.

---

## 11. Verified by the automated comparison suite

`test/test_openai_sdk_comparison.js` (in `npm test`) proves, end-to-end with a faithful
Chat-Completions server (streaming + non-streaming):

- **A** — per-run stateless isolation (two runs, no content leakage), tool round-trip
  (name / args / output), exact `reasoning_content` key, per-run usage.
- **B** — HIL with `Promise<boolean>` approve → tool executes; deny → tool NOT executed + denial fed
  back to the model; `permissionApi` exposes `approve/deny/resolve`.
- **C** — HIL callback style: `resolve(true)` after an async delay pauses then resumes the loop
  (`request → resolve → execute` order asserted) with `permission_request`/`permission_response`
  events; `deny()` blocks and informs the model.
- **D** — streaming: `reasoning_content` key through `thinking` events, streamed tool-call arg
  reconstruction, tool output round-trip, usage chunk aggregation.
- **E** — structured output enforced while streaming with automatic repair.