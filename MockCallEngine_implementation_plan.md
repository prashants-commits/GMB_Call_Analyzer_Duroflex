# Mock Call Engine — Architecture & Test Plan (MVP)

> **Companion to** [`AITrainer_Idea_v1.md`](AITrainer_Idea_v1.md) §M4 and [`AITrainer_TechPlan_v1.md`](AITrainer_TechPlan_v1.md) Group D. Narrows scope to the single demo objective and freezes the ladder of fallback positions in case the audio path stays blocked.
>
> **Style note.** Mirrors [`FiltersIssue_implementation_plan.md`](FiltersIssue_implementation_plan.md) and [`InsightsPrompts_implementation_plan.md`](InsightsPrompts_implementation_plan.md): each task carries **Files**, **Steps**, **Test cases**. A task is **Done** only when every listed test passes.
>
> **Goal.** A single, perfect happy-path mock-call drill demonstrable on a clean Chrome + wired-earbuds laptop: persona greets → 3–4 user turns held over Push-to-Talk → call ends → transcript persisted → drill row marked `completed`. No edge cases, no production hardening — just one drill that works every time.

---

## 0. Document control

| Field | Value |
| --- | --- |
| Document | `MockCallEngine_implementation_plan.md` |
| Owner | Product (Prashant) |
| Repo path | `D:/Conversations Analyzer/Call Analyzer + Trainer Demo` |
| Status | Draft v1 — assumptions confirmed by product on 2026-05-01 |
| Touches | `backend/trainer/drill/*`, `frontend/src/pages/trainer/Drill*.jsx`, `frontend/src/utils/useDrill*.js` |
| Does NOT touch | Existing real-call analyzer pages, SWOT module, Persona Library module, Adoption Panel — all already built and untouched by this plan |

---

## 1. TL;DR

The drill engine is ~70 % built. What's left is **verification + one targeted bug fix**:

1. **Text mode (Rung B in code) is built but never tested** — verify it works before any voice work. This is the demo safety net.
2. **Voice mode (Rung C) is built and 80 % working.** The first customer turn lands flawlessly; subsequent user-audio turns elicit no reply. Strong evidence the bug is in the **multi-turn manual VAD upstream loop**, not in connection or audio playback.
3. **Half-duplex strict PTT** (button held = mic open; AI plays out fully without interruption) is the cleanest fit for the Gemini Live API and likely sidesteps the multi-turn bug entirely if implemented as **complete-turn-on-release** rather than streamed-with-activity-bracket.

**Decision committed:** ship MVP via **two phases** (P0 verify text → P1 PTT audio), with a **three-rung fallback ladder** (F1a hybrid → F1b session-per-turn → F2 text demo) if P1 hits any blocker. Total work estimate: **3–6 engineering days** assuming P1's bug is the multi-turn VAD issue and Fix A lands.

---

## 2. Locked assumptions (from product, 2026-05-01)

These are the answers from the clarifying round. Treat as committed unless explicitly revisited.

| # | Decision | Implication |
| --- | --- | --- |
| A1 | **Text drill never verified end-to-end** | P0 is mandatory before any voice work. |
| A2 | **First Gemini Live customer turn lands flawlessly** | Connection, model access, system prompt, audio downstream playback all proven. Bug is between turn 1 and turn 2 of the user audio loop. |
| A3 | **PTT = half-duplex strict** | No barge-in. AI cannot be interrupted. Mic captures **only** while button held. AI's reply plays out fully before next press is allowed. |
| A4 | **Local laptop demo only** | No HTTPS/WSS-over-Render, no firewall traversal, no cross-origin cookie pain. Vite dev proxy (`http://localhost:5173` ↔ `http://127.0.0.1:8000`) is the only deploy. |
| A5 | **Transcript-only Score Card acceptable** | Audio recording becomes best-effort. If `Recorder` fails, drill still completes and scores. Removes a load-bearing failure surface. |
| A6 | **One happy path on clean Chrome + earbuds** | No reconnect logic, no quota refunds, no abort-recovery, no Safari, no mobile. Failure = retry from scratch. |
| A7 | **Plan lives at repo root as `MockCallEngine_implementation_plan.md`** | Beside the AI Trainer plans. |

**Out of scope for this MVP** (deferred — call out in demo Q&A if asked):
- 5-minute hard cap edge cases (just trust the existing timer)
- Quota/cost guardrails (assume `TRAINER_ENABLED=true` and a generous key)
- Persona library refresh / draft / publish — use existing `personas_v4.json`
- Score Card generation (Group E) — drill ends with "Score-card review will show up here once Group E ships." placeholder, which already exists in the text mode UI
- Adoption Panel / Coach Notes / `staff_roster.csv` cross-link
- Recording retention, deletion, DPDP consent flows

---

## 3. Current state audit (one-page)

### 3.1 What is on disk

| Layer | File | LOC | State |
| --- | --- | --- | --- |
| Drill state machine | [`backend/trainer/drill/state.py`](backend/trainer/drill/state.py) | 225 | ✅ Done — append-only CSV, 6-status FSM. Reused by both modes. |
| Persona-grounded system prompt | [`backend/trainer/drill/prompt.py`](backend/trainer/drill/prompt.py) | 115 | ✅ Done — single `build_system_prompt(persona)` reused by both modes. |
| Transcript JSONL writer | [`backend/trainer/drill/transcript.py`](backend/trainer/drill/transcript.py) | 72 | ✅ Done — `transcript.write(speaker, text, partial)` thread-safe, file-locked. |
| PCM recorder | [`backend/trainer/drill/recorder.py`](backend/trainer/drill/recorder.py) | 126 | ✅ Done — used by audio mode only. Per A5 will be best-effort. |
| **Text session (Rung B)** | [`backend/trainer/drill/text_session.py`](backend/trainer/drill/text_session.py) | 226 | ⚠️ **Built, never tested.** In-memory session map, `kickoff()` + `stream_user_turn()` + `close_session()`. Uses `gemini-2.5-flash` text API. |
| **Audio bridge (Rung C)** | [`backend/trainer/drill/ws.py`](backend/trainer/drill/ws.py) | 461 | ⚠️ **80 % working.** Server-proxied Gemini Live WS, manual VAD, recorder, transcript. Bug below. |
| Router HTTP/WS endpoints | [`backend/trainer/router.py`](backend/trainer/router.py) (~1300 lines, drill section ~150) | — | ✅ Done — `POST /api/trainer/drills/start`, `POST /drills/{u}/text/turn`, `POST /drills/{u}/text/end`, `WS /ws/trainer/drill/{u}`. |
| Drill text frontend | [`frontend/src/pages/trainer/DrillTextMode.jsx`](frontend/src/pages/trainer/DrillTextMode.jsx) | 321 | ⚠️ **Built, never tested.** Chat bubbles, browser TTS via `useTTS`, end-call button. |
| Drill voice frontend | [`frontend/src/pages/trainer/DrillPage.jsx`](frontend/src/pages/trainer/DrillPage.jsx) | 577 | ⚠️ **80 % working.** Mic permission, PCM streamer, audio playback, transcript pane. |
| Drill router page | [`frontend/src/pages/trainer/DrillPage.jsx`](frontend/src/pages/trainer/DrillPage.jsx) | (above) | Routes by `mode==='text'` → `<DrillTextMode>`, else inline audio UI. |

### 3.2 What works (verified by user)

- Persona library v4 published; picker selects a persona; drill row inserted as `starting`.
- WebSocket cookie auth (HMAC-signed) lands.
- Gemini Live connection + model access on the configured key.
- **First customer audio turn arrives and plays in the browser flawlessly.**

### 3.3 What is broken (per [`backend/data/trainer/drill_debug.log`](backend/data/trainer/drill_debug.log))

After the kickoff turn, the user's mic chunks reach the server (logged as `pump.upstream chunk=N size=10240`). The browser sends `turn_end` JSON events when PTT releases. **No `server.turn_complete` line ever appears for any subsequent turn** — meaning Gemini Live never closes the user turn nor produces a reply.

**Hypothesis** (high confidence). The current code uses **streaming + manual VAD** (`session.send_realtime_input(audio=...)` in the upstream pump and `activity_start` / `activity_end` to bracket each turn). On `gemini-3.1-flash-live-preview`, manual `activity_end` after streamed real-time audio appears not to commit the turn for response generation past turn 1. The kickoff works because it sends a synthetic 200 ms silence with explicit start+end and Gemini treats it as "user said nothing, your turn." Real user audio doesn't get the same treatment.

### 3.4 Two candidate fixes for §3.3

| Fix | Change | Effort | Risk |
| --- | --- | --- | --- |
| **A — Complete-turn-on-release** | Buffer the PTT audio while button is held. On release, send the **whole turn** via `session.send_client_content(turns=Content(role='user', parts=[Part.from_bytes(data=pcm, mime_type='audio/pcm;rate=16000')]))`. No `activity_start`/`activity_end`. Auto-VAD off. | ½ – 1 day | Low — this is the documented "turn-based" mode of Gemini Live. Maps 1:1 to half-duplex strict PTT. |
| **B — Session-per-turn** | Close the Live session at end of each user turn. Start a fresh one for next turn, seeding history via system instruction. | 2 – 3 days | Medium — heavier, slower turn latency (~1 s reconnect), more state to manage, more places to fail. Reserve as fallback. |

**Decision: try Fix A first.** Half-duplex strict PTT is exactly the use case the turn-based API was built for. If Fix A also fails to elicit responses past turn 1, escalate to Fix B as a guaranteed-correct backup.

---

## 4. Target architecture (MVP)

### 4.1 Diagram (P1 happy path)

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (Chrome 120+, wired earbuds)                            │
│                                                                  │
│  DrillPage.jsx (audio mode)                                      │
│    PTT button (down=arm mic, up=commit turn)                     │
│      ↓ getUserMedia({audio: {echoCancellation, ns, agc}})        │
│    AudioWorklet (or ScriptProcessor): float32 → s16le @ 16 kHz   │
│      ↓ buffer chunks while PTT held                              │
│    On release: send single binary WS frame = whole turn PCM      │
│      ↓                                                           │
│    Receive binary WS frames = AI audio s16le @ 24 kHz            │
│      ↓ AudioContext.decodeAudioData → AudioBufferSourceNode      │
│    Lock PTT button until AI playback finishes (half-duplex)      │
└──────────────────────────────────────────────────────────────────┘
                ↕ ws:// (Vite dev proxy → FastAPI)
┌──────────────────────────────────────────────────────────────────┐
│  FastAPI server (uvicorn :8000)                                  │
│                                                                  │
│  /ws/trainer/drill/{drill_uuid}                                  │
│    drill_websocket(ws, drill_uuid):                              │
│      1. verify(cookie) → TrainerActor                            │
│      2. drill_state.latest_state → STARTING                      │
│      3. load_published() → persona                               │
│      4. drill_state.transition(IN_CALL)                          │
│      5. open Gemini Live session (audio-out modality)            │
│      6. KICKOFF: synthetic activity_start + 200ms silence +      │
│         activity_end → AI greets in audio                        │
│      7. LOOP per user turn:                                      │
│           a. await binary frame (whole turn PCM)                 │
│           b. session.send_client_content(turns=Content(...))     │
│           c. async for msg in session.receive():                 │
│                forward audio → ws.send_bytes                     │
│                forward transcripts → ws.send_text(JSON)          │
│                if msg.turn_complete: break  ← back to step (a)   │
│      8. On client {type:"end"} or 5-min timeout:                 │
│           drill_state.transition(COMPLETED|TIMED_OUT)            │
│           transcript.close(); recorder.finalize() (best-effort)  │
└──────────────────────────────────────────────────────────────────┘
                ↕ wss:// (Google)
┌──────────────────────────────────────────────────────────────────┐
│  Gemini Live API                                                 │
│  Model: gemini-3.1-flash-live-preview (or 2.5 native-audio if    │
│         3.1 multi-turn unstable — see §6.2)                      │
│  Modality: AUDIO out only; text via output_audio_transcription.  │
│  Turn-based input: send_client_content (NOT send_realtime_input).│
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Wire protocol (frozen for MVP)

| Direction | Frame | Payload | When |
| --- | --- | --- | --- |
| Browser → Server | `binary` | s16le PCM @ 16 kHz, mono, **whole turn buffered on PTT release** | Once per user turn |
| Browser → Server | `text` (JSON) | `{"type":"end"}` | User clicks End-Call or 5 min elapses |
| Server → Browser | `binary` | s16le PCM @ 24 kHz, mono, AI audio chunks | Streamed during AI's reply |
| Server → Browser | `text` (JSON) | `{"type":"transcript","speaker":"customer"\|"staff","text":"...","partial":bool}` | Streamed as Gemini surfaces turn-text |
| Server → Browser | `text` (JSON) | `{"type":"turn_complete"}` | When AI finishes its reply — browser unlocks PTT |
| Server → Browser | `text` (JSON) | `{"type":"state","status":"in_call"\|"completed"\|"failed"\|"timed_out"}` | At lifecycle boundaries |

**Removed from current protocol** (Fix A simplification): `turn_start`, `turn_end`, `force_reply`, `debug` heartbeats, `interrupted`. None are needed for half-duplex strict PTT — the binary frame itself is the turn boundary.

### 4.3 Half-duplex contract

The browser enforces half-duplex via a single `phase` state: `idle | armed | sending | ai_speaking | ended`.

| Transition | Trigger |
| --- | --- |
| `idle → armed` | Mousedown / keydown on PTT button |
| `armed → sending` | Mouseup / keyup — buffered PCM is sent as one binary frame |
| `sending → ai_speaking` | First binary AI audio frame received |
| `ai_speaking → idle` | `{"type":"turn_complete"}` received AND all queued AudioBufferSourceNodes have finished playing |
| `* → ended` | User clicks End Call OR `{"type":"state","status":"completed"\|"timed_out"\|"failed"}` |

**PTT button is disabled in every state except `idle`.** This is what enforces "AI cannot be interrupted." No barge-in. No audio is captured while AI is speaking.

### 4.4 What changes vs current code

| Component | Current | After P1 |
| --- | --- | --- |
| `ws.py` upstream pump | streams chunks via `send_realtime_input` + `activity_start`/`activity_end` | accumulates one frame's worth of PCM, sends via `send_client_content` once per turn |
| `ws.py` downstream pump | unchanged | unchanged (audio + transcript forwarding works) |
| `ws.py` config | `RealtimeInputConfig(automatic_activity_detection=disabled)` | drop the realtime-input config block — turn-based API has no VAD |
| `DrillPage.jsx` mic capture | continuous `MediaRecorder` chunks every ~250 ms | AudioWorklet float32 → s16le buffered, flushed on PTT release |
| `DrillPage.jsx` PTT UX | press/release sends `turn_start`/`turn_end` JSON | press = arm; release = single binary send; no JSON events |
| `DrillPage.jsx` playback | per-chunk AudioBuffer | unchanged |
| `DrillPage.jsx` button state | always-enabled mic toggle | strict half-duplex `phase` machine (§4.3) |

**LOC delta estimate.** `ws.py` shrinks by ~60 lines (deletes manual VAD plumbing + `turn_start`/`turn_end` handling). `DrillPage.jsx` grows by ~80 lines (adds the AudioWorklet path and phase machine; removes `MediaRecorder` continuous path). Net: ~±20 LOC. Surgical.

---

## 5. Phased delivery

### Phase 0 — Verify text drill works (1 day, mandatory baseline)

**Why first:** A1 says it's untested. Per CLAUDE.md (Goal-Driven Execution: "Write a test that reproduces it, then make it pass"), we cannot trust *any* of the shared infrastructure (state machine, system prompt, transcript writer, persona load, cookie auth) until we see one drill complete green. P0 verifies all of that **without** touching the audio path.

#### P0-T1. Smoke-test the existing text drill happy path

**Files (read-only).** [`backend/trainer/drill/text_session.py`](backend/trainer/drill/text_session.py), [`backend/trainer/router.py`](backend/trainer/router.py) drill section, [`frontend/src/pages/trainer/DrillTextMode.jsx`](frontend/src/pages/trainer/DrillTextMode.jsx), [`frontend/src/utils/useDrillTextSession.js`](frontend/src/utils/useDrillTextSession.js), [`frontend/src/utils/useTTS.js`](frontend/src/utils/useTTS.js).

**Steps.**
1. `TRAINER_ENABLED=true` + `DRILL_DEFAULT_MODE=text` + `GEMINI_API_KEY=...` in `backend/.env`.
2. Boot backend (`uvicorn main:app --port 8000 --reload`) and frontend (`npm run dev`).
3. Log into trainer (e.g. `STF-0001`). Pick the seed store + first persona from v4.
4. Click "Start drill (text)". Confirm landing on `/trainer/drill/{uuid}?mode=text`.
5. Confirm AI greeting appears as a chat bubble within 5 s and is spoken via browser TTS.
6. Type 3 turns. Confirm each AI reply streams in (delta animation visible).
7. Click End Call. Confirm "Call complete" panel renders.
8. Open `backend/data/trainer/calls.csv`. Confirm two rows for the drill: `starting` then `completed`.
9. Open the latest `backend/data/trainer/audio/2026/05/{uuid}.jsonl` (transcript). Confirm 1 customer line + 3 staff/customer pairs.

**Test cases.**
- **P0-T1.1** Drill row transitions `starting → completed` (no `failed`/`timed_out` intermediate).
- **P0-T1.2** Transcript JSONL has ≥7 lines (1 kickoff + 3 user + 3 ai).
- **P0-T1.3** AI's first turn arrives within 8 s on a warm Gemini key.
- **P0-T1.4** AI streams deltas (frontend `partial:true` bubbles seen in DOM during stream).
- **P0-T1.5** Browser TTS speaks AI lines (English voice; check `useTTS.js` lang list).
- **P0-T1.6** No console errors. No 5xx in network tab.
- **P0-T1.7** Re-running step 3–8 with the same staff_id starts a new drill (new `drill_uuid`, new transcript file).

**If any of P0-T1.* fails:** stop. Fix the failing layer before P1. Likely culprits in priority order: cookie auth, persona load (v4 file path), transcript directory permissions, `gemini-2.5-flash` model name on the key.

---

### Phase 1 — Half-duplex PTT audio drill (2–3 days, the MVP)

This is what the demo shows. Phase 1 splits into 5 tasks, each with its own test gate. **Do not start P1-T2 until P1-T1 passes.**

#### P1-T1. Switch upstream from streaming to turn-based

**Files.** [`backend/trainer/drill/ws.py`](backend/trainer/drill/ws.py).

**Steps.**
1. Delete the manual-VAD `RealtimeInputConfig` block (lines 339–345 in current code).
2. Delete the kickoff `activity_start`/silence/`activity_end` block (lines 376–389). Replace with a single `send_client_content` call seeded with a synthetic `[The store staff just picked up.]` user turn — exact mirror of `text_session.py`'s `kickoff` nudge.
3. Replace `_pump_browser_to_gemini` so it (a) accumulates `bytes` frames into a single `bytearray buffer`; (b) on each binary frame received, treats that *whole frame* as one complete user turn — i.e. the browser is now responsible for buffering during PTT-hold and sending one frame on release; (c) calls `await session.send_client_content(turns=Content(role='user', parts=[Part.from_bytes(data=bytes(buffer), mime_type=f'audio/pcm;rate={INPUT_SAMPLE_RATE}')]), turn_complete=True)`.
4. Drop handling of `turn_start` / `turn_end` / `force_reply` JSON event types. Keep only `{"type":"end"}` for client-initiated stop.
5. Keep `_pump_gemini_to_browser` exactly as is — it already handles audio + input/output transcription correctly.

**Test cases.**
- **P1-T1.1** (unit, pytest with mocked Gemini) Sending one binary frame to the bridge results in exactly one `session.send_client_content` call with `role='user'` and `mime_type='audio/pcm;rate=16000'`. Mock client returns a fake audio reply → bridge forwards it to the WS as binary.
- **P1-T1.2** (unit) Sending `{"type":"end"}` triggers a clean state transition to `COMPLETED` and closes the WS with code 1000.
- **P1-T1.3** (integration with real Gemini Live, manual) From a Python script using `websockets`, connect to `/ws/trainer/drill/{uuid}` with a valid cookie, send a 2-second 16 kHz silence frame, observe ≥1 binary frame back from server within 10 s. Compare against the same script run on `main` (current code) which receives 0 binary frames after kickoff. **This is the bug-fix proof.**
- **P1-T1.4** Drill row transitions `starting → in_call → completed` (no `failed`).
- **P1-T1.5** Transcript JSONL has ≥1 customer line (the kickoff). Sufficient for P1-T1; richer multi-turn proven in P1-T4.

**Fallback gate.** If P1-T1.3 fails — i.e. Fix A also yields no Gemini reply on subsequent turns — **STOP. Open §6.2 (Fix B: session-per-turn).**

#### P1-T2. Browser PCM capture via AudioWorklet

**Files.** New [`frontend/src/utils/pcmWorklet.js`](frontend/src/utils/pcmWorklet.js) (the worklet itself, ~40 LOC), updated [`frontend/src/pages/trainer/DrillPage.jsx`](frontend/src/pages/trainer/DrillPage.jsx).

**Steps.**
1. Create `pcmWorklet.js`: an `AudioWorkletProcessor` that takes float32 frames at the AudioContext's native rate (typically 48 kHz on macOS/Windows), downsamples to 16 kHz mono, converts to s16le, and posts the s16le `Int16Array` back to the main thread on every quantum.
2. In `DrillPage.jsx`, replace any existing `MediaRecorder`-based capture with: `audioContext.audioWorklet.addModule('/pcmWorklet.js')` → `new AudioWorkletNode(audioContext, 'pcm-worklet')` → connect mic source. Buffer the posted Int16Arrays into one `Int16Array` while `phase==='armed'`.
3. On PTT release (`phase: armed → sending`): concatenate buffered Int16Arrays into a single ArrayBuffer; `ws.send(arrayBuffer)`; clear the buffer.
4. Disable input on the worklet during `phase!=='armed'` (i.e. drop quanta) so we don't accidentally capture button-up noise.

**Test cases.**
- **P1-T2.1** (manual, mic preflight) Hold PTT for 3 s of `"one two three four five"`. Inspect the binary frame size in DevTools Network: expect ≈ 3 s × 16000 samples × 2 bytes ≈ 96 000 bytes (±10 %).
- **P1-T2.2** (manual) Save the binary frame to a `.raw` file via `chrome://inspect` and play it back with `ffplay -f s16le -ar 16000 -ac 1 turn.raw`. Speech must be intelligible.
- **P1-T2.3** Releasing PTT with no audio (button tap < 100 ms) sends nothing — no zero-length WS frame is dispatched.
- **P1-T2.4** Pressing PTT during `phase==='ai_speaking'` is a no-op (button is disabled, but verify the keydown handler also early-returns).

#### P1-T3. Browser playback + half-duplex phase machine

**Files.** [`frontend/src/pages/trainer/DrillPage.jsx`](frontend/src/pages/trainer/DrillPage.jsx) only.

**Steps.**
1. Introduce `phase` state (`useReducer` to keep transitions explicit). Allowed transitions per §4.3.
2. Replace any existing per-chunk decode flow with: maintain one `playbackQueue` of AudioBufferSourceNodes; on each binary AI frame received, decode (`audioContext.decodeAudioData` for raw PCM via a 24 kHz `AudioBuffer.fromInterleaved` helper) and append to the queue; play sequentially with `onended` callbacks; when the queue empties **and** `{"type":"turn_complete"}` has been received, transition `ai_speaking → idle`.
3. PTT button: `disabled={phase !== 'idle'}`. Spacebar keydown also arms the mic (accessibility nicety; same disabled rule).
4. Visual indicator: green dot pulsing during `ai_speaking`, red dot pulsing during `armed`/`sending`. No waveform required for MVP.

**Test cases.**
- **P1-T3.1** AI 5 s reply plays continuously without gaps. (Subjective; measure: no `audio.onended` fires until the full 5 s elapse.)
- **P1-T3.2** PTT button is `disabled` from `mousedown` on send through `turn_complete + queue empty`.
- **P1-T3.3** Pressing PTT 100 ms after AI's last word starts a new turn (no race condition where the queue is empty but `turn_complete` hasn't arrived).
- **P1-T3.4** End Call button works in any phase and forces `ended`.

#### P1-T4. Multi-turn smoke

**Files.** None new — exercises P1-T1+T2+T3 together.

**Steps.**
1. Boot backend + frontend with `DRILL_DEFAULT_MODE=voice` (or pass `?mode=voice` on the start URL — confirm router supports both, add the toggle if needed).
2. Run a 4-turn drill: AI greeting → user turn 1 → AI reply → user turn 2 → AI reply → user turn 3 → AI reply → End Call.
3. Capture the resulting transcript JSONL and the audio file (if recorder didn't fail).

**Test cases.**
- **P1-T4.1** Transcript has ≥7 lines (1 kickoff + 3 user + 3 ai).
- **P1-T4.2** Each user line in the transcript matches what was actually said (Gemini's input transcription accuracy on Indian English is acceptable — judge subjectively, target ≥80 % word accuracy).
- **P1-T4.3** Each AI reply audio is intelligible end-to-end (no truncation, no overlapping audio from the next turn).
- **P1-T4.4** `calls.csv` has rows `starting → in_call → completed`. `duration_seconds` ≈ wall clock.
- **P1-T4.5** Total drill cost (estimated from Gemini billing dashboard 24 h later) ≤ ₹15 — non-blocking validation, just record.
- **P1-T4.6** No `pump.upstream` lines after `{"type":"end"}` in `drill_debug.log` (i.e. mic actually stops capturing).

**This is the demo gate.** When P1-T4 passes 3 times in a row on a fresh page-load each time, MVP is shippable.

#### P1-T5. Visual polish for demo

**Files.** [`frontend/src/pages/trainer/DrillPage.jsx`](frontend/src/pages/trainer/DrillPage.jsx).

**Steps.** *(Tiny — only do if P1-T4 passes with time to spare.)*
1. Persona card at top — name, summary, difficulty pill (steal layout from `DrillTextMode.jsx`).
2. CallTimer component reuse (already exists at [`frontend/src/components/trainer/CallTimer.jsx`](frontend/src/components/trainer/CallTimer.jsx)).
3. Live transcript pane on the right — re-render on each `{"type":"transcript"}` event.
4. PTT button: large, centered, pulse-on-hold, "Hold to talk" / "AI is speaking…" labels per phase.
5. End Call button bottom-right, mild red.

**Test cases.**
- **P1-T5.1** Demo screen renders cleanly at 1440×900 (laptop) and 1920×1080 (external monitor).
- **P1-T5.2** No layout shift during AI speech.

---

## 6. Fallback ladder

The MVP commits to P1. If P1 hits a wall, walk down this ladder. Each rung is a successively-cheaper retreat.

### 6.1 Ladder summary

| Rung | What ships | Trigger to descend | Engineering cost |
| --- | --- | --- | --- |
| **P1** | PTT audio in / audio out (the goal) | — | 2–3 days |
| **F1a** | Type-and-Speak: user types text; AI replies in audio | P1-T2 (browser PCM capture) blocks for >1 day OR P1-T1.3 passes but P1-T4.2 (input transcription) is unusable | +0.5 day |
| **F1b** | Session-per-turn audio: full audio loop, but tear down + re-create the Gemini Live session each user turn | P1-T1.3 fails — i.e. Fix A *also* doesn't elicit multi-turn replies | +1.5–2 days |
| **F2** | Text drill (P0) with browser SpeechSynthesis as AI voice | All audio rungs blocked by demo deadline | 0 — already built; just needs P0 verification |

The ladder is **strictly ordered**. If F1a is on the table, F1b is too.

### 6.2 F1a — Type-and-Speak (recommended first fallback)

**Premise.** The user has already confirmed Gemini Live's first-turn audio downstream is flawless. The bug is purely on **upstream** user audio. F1a sidesteps it by replacing user audio with text — Gemini reliably handles `text input → audio output` per Live API docs.

**Architecture delta from P1.**
- `ws.py` upstream pump: instead of binary frames, accept text frames `{"type":"user_turn","text":"..."}`. Forward via `session.send_client_content(turns=Content(role='user', parts=[Part.from_text(text=...)]))`.
- `DrillPage.jsx`: replace PTT button with a text input + Send button. Phase machine simplifies — no `armed`/`sending` audio capture. `idle ↔ ai_speaking` only.

**LOC delta.** Smaller than P1 — drops the AudioWorklet entirely, keeps audio playback. Net: ~−40 LOC vs P1.

**Demo story.** "Audio AI customer; agent types — half the goal but proves the audio engine end-to-end. Voice-side agent input is the next sprint." Honest, demo-able.

**Test cases.** Same as P1-T4 but with text input instead of audio input.

### 6.3 F1b — Session-per-turn audio

**Premise.** If even Fix A doesn't elicit multi-turn replies, Gemini Live's preview multi-turn behavior on this key/model is broken. Workaround: each user turn is a brand-new Live session.

**Architecture delta from P1.**
- `ws.py` enters a new `_pump_one_turn(audio_pcm, history)` per turn that opens a fresh Gemini Live session, sends history (as a text replay of the transcript), sends the user audio, awaits `turn_complete`, closes the session.
- Cost goes up (~2× per drill — full system prompt re-sent each turn).
- Latency goes up (~1 s per turn for session setup).

**LOC delta.** ~+150 in `ws.py`. Heaviest of the fallbacks.

**When to skip straight to F2.** If F1a is itself sufficient for the demo and F1b would push the deadline. F1b is only worth it if voice-in is a hard demo requirement.

### 6.4 F2 — Text drill with browser TTS

**Premise.** P0 already gives a working drill. AI voice via browser SpeechSynthesis (`en-IN` voice) is decent on Chrome on Windows. No Gemini Live involvement.

**Architecture delta from P0.** None. Already shipped.

**Demo story.** "We're showcasing the analysis + scoring loop today; live voice integration is gated on Gemini Live preview stability and ships next sprint." Weakest version of the story — but viable if the audio path is wholly blocked.

### 6.5 Decision tree

```
Start P0 (verify text drill)
  │
  ├─ P0-T1 fails ──► Fix the failing layer (auth / persona / transcript / model name).
  │                  Do not start P1 until P0 is green.
  │
  └─ P0-T1 passes ──► Start P1-T1 (Fix A — turn-based upstream)
                         │
                         ├─ P1-T1.3 fails ──► Try Fix B (F1b — session-per-turn)
                         │                       │
                         │                       ├─ Fix B works ──► proceed to P1-T2..T5
                         │                       └─ Fix B fails ──► descend to F1a
                         │
                         └─ P1-T1.3 passes ──► P1-T2 (browser PCM capture)
                                                  │
                                                  ├─ P1-T2 blocks (>1 day) ──► descend to F1a
                                                  └─ P1-T2 passes ──► P1-T3, T4, T5 — ship MVP

Demo deadline approaching with no rung green ──► ship F2 (text + browser TTS)
```

---

## 7. Test plan summary (single-page reference)

| Phase | Gate | Auto / manual | Pass criterion |
| --- | --- | --- | --- |
| P0-T1 | Text drill happy path | Manual smoke | calls.csv `starting → completed`; transcript ≥7 lines; AI streams; TTS plays |
| P1-T1 | Turn-based upstream | Pytest unit + manual integration | Fake binary frame → 1 `send_client_content` call; real key replies within 10 s |
| P1-T2 | PCM capture | Manual + ffplay | 3 s held → ~96 KB binary; `ffplay` decodes intelligibly |
| P1-T3 | Half-duplex phase machine | Manual | PTT disabled during `ai_speaking`; transitions per §4.3 |
| P1-T4 | Multi-turn smoke (THE GATE) | Manual, 3 trials | 4-turn drill completes; transcript correct; audio clean; `completed` row |
| P1-T5 | Demo polish | Manual visual | Renders cleanly at 1440 / 1920 widths |

**Recording artefacts.** For the demo, record the screen of one P1-T4 run (OBS, 720 p) as a backup in case live demo conditions degrade.

---

## 8. Risk register (compact)

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Fix A also fails on multi-turn | Medium | High — blocks P1 | Fix B (F1b) ready as design; F1a as further fallback |
| R2 | AudioWorklet quirk on Windows Chrome (sample rate forcing) | Low | Medium | Write the worklet to handle any incoming `sampleRate`; resample to 16 kHz inside the worklet |
| R3 | Gemini Live preview model gets deprecated mid-week | Low | High | Keep `GEMINI_LIVE_MODEL` as env var; have `gemini-2.5-flash-preview-native-audio-dialog` (older, more stable per docs) configured as the swap target |
| R4 | Transcript file race condition under PTT spam | Low | Low | Existing `Transcript` class is file-locked; no change needed |
| R5 | TTS voice on Chrome/Windows is robotic | Medium | Low | F2 only; if that's the demo, manually pick `Microsoft Aria Online` voice in Chrome's voice list (en-IN preferred) |
| R6 | Wired-earbuds availability on demo machine | Low | Medium | Ship one cable from a known store kit; verify on demo machine T-1 day |
| R7 | Gemini billing surprise during multi-day testing | Low | Medium | Keep iteration count low — verify each task-T1 in unit tests before exercising real API |
| R8 | Demo machine has stale Chrome | Low | Medium | Pin to Chrome 120+; T-1 day check |

---

## 9. Out of scope but flagged for follow-up sprints

These were called out in the PRD or PRD-Tech-Plan but explicitly **deferred for this MVP**:

- 5-min wrap-up cue at 4:30 (PRD §4.6). Hard cap at 5:00 still enforced via `asyncio.wait_for` — no graceful trim.
- Anti-leak / anti-cooperation prompt rules (PRD §4.6). Current `prompt.py` may already cover these — out of scope to audit for this MVP.
- Recorder retention / nightly cleanup (PRD §4.9). Recordings just accumulate locally; demo machine has plenty of disk.
- Quota refunds on abort (PRD §M4 failure modes). One demo drill ≪ daily cap.
- Concurrent drills on one worker → 429. Demo is single-user, single-drill at a time.
- Reconnect logic on WS drop. Demo machine on stable wired Ethernet.
- DPDP consent screen. No real customer data; staff is internal demo user.
- Adoption Panel cross-link. Not part of the drill engine itself.

---

## 10. Definition of Done (the "ship it" checklist)

The MVP is shippable for the stakeholder demo when **all** of the following are true on a fresh page-load on the demo laptop:

- [ ] P0-T1 passes (text mode baseline still works).
- [ ] P1-T4 passes 3 times in a row, each starting from a fresh `/trainer` landing.
- [ ] One screen recording of a clean P1-T4 run is saved to `D:/Conversations Analyzer/Call Analyzer + Trainer Demo/demo_assets/`.
- [ ] `backend/data/trainer/calls.csv` shows the demo drill row with `status=completed`, populated `transcript_path`, `duration_seconds` matching wall clock.
- [ ] No errors in browser console during the demo run.
- [ ] No 5xx in the FastAPI log during the demo run.
- [ ] Wired earbuds verified on the demo machine; speakerphone mode tested as a negative (echo cancellation off → distorted audio is observed-and-rejected behavior, not a regression).

If any item fails on demo day morning, descend the §6.5 ladder by one rung and re-verify.

---

*End of `MockCallEngine_implementation_plan.md`.*
