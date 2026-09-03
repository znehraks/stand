# Devpost submission — Stand

**Tagline:** An arranging studio your agent can write in. You bring the ensemble and the level; the agent writes the parts; the page refuses what your players cannot play; you decide by ear.

**Live URL:** https://stand.znehraks.workers.dev
**Repo:** https://github.com/znehraks/stand (MIT)

## The first 15 seconds
A melody, an ensemble, a level. "Arrange Ode to Joy for my fifth-grade band — two flutes, clarinet, alto sax, trumpet, trombone, snare." The staves fill in one part at a time. A trumpet D6 appears and the page **refuses the write**: *"Trumpet bar 12: written D6 sounds C6, above the elementary range (F#3–C5) — drop it an octave."* The agent rewrites it an octave down. Then it plays four bars, and asks which of two endings you prefer — with a ▶ on each, because it cannot hear and you can.

## Inspiration
Published arrangements never match a real school ensemble: six clarinets and no trombone, a first-year trumpet that tops out at G5, a key the class can actually read. So directors rewrite by hand, part by part, checking every range and transposition. It is hours of *fitting* — exactly what a model is good at proposing and bad at verifying, and exactly what a web page can verify instantly.

## What it does
Stand is a browser arranging studio with a WebMCP tool surface. The agent loads a public-domain melody, sets up your ensemble at a teaching level, writes each part into the score, drafts a voicing, transposes, plays passages, and asks you to choose by ear. The page renders real notation (conductor score and transposed part views), plays it, and checks every note: bar lengths, unknown pitches, sounding ranges per instrument per level, rhythms too fine for the level, key signatures with too many accidentals, wide leaps, voice crossing, parallel fifths. Errors reject the write with the bar, the note and the fix; warnings are reported. You drag notes, lock bars the agent must not touch, mute parts, and export MusicXML, individual parts or MIDI. Nothing leaves the browser unless you export it.

## Why WebMCP fits
Three reasons, and each one is load-bearing. **The page holds knowledge the agent cannot fake** — notation, sound, ranges, transposition — so the tool boundary becomes a music guardrail that *rejects* bad writes with a precise reason and lets the agent self-correct. **The agent cannot hear**; `ask_human` hands that one judgement back to the person with playable options and waits. **One score, two hands** — locks, hand edits and tool calls share the same live document and the same timeline. A screenshot-driven agent gets none of this, and a backend MCP server cannot show a person the score it is changing.

## How it improves the experience
An agent that can only talk would hand you MusicXML to paste. Here it writes into the score you are looking at, in your key, in your ensemble, and the page stops it from writing something unplayable. `read_part` returns both sounding and written pitch, so transposition arithmetic — the classic human error in this work — never happens in the model's head.

## What it makes newly possible
An arrangement that fits the players in the room, made by the ear in the room. No existing tool does this: notation editors have no agent, audio generators cannot hand thirty children a part to read, and transcribers only go from sound to score.

## How we built it
- **WebMCP**: `document.modelContext.registerTool` with one `AbortController` per surface; three phase surfaces (empty / arranging / exported); `readOnlyHint` on reads; descriptions under 500 characters; 1-based bars at the API boundary; every failure a self-correcting message; `play` reporting `needs_gesture` when the browser has not started audio; `ask_human` with playable A/B options; no tool that can export, print, lock or answer for the person.
- **Music core** (pure TypeScript, unit-tested): pitch and key arithmetic, a 20-instrument table with clef, transposition and a sounding range per level, the checker, a rule-based harmonizer, MusicXML with correct per-part `<transpose>`, MIDI, part extraction.
- **Page**: React 19 + Vite; VexFlow for the conductor score and transposed part views with click-to-edit, lock badges and a playback cursor; Tone.js for per-section timbres and A/B variant preview; a store that funnels every mutation — agent, hand or demo — through the same validation, locks, undo and log.
- **Tests**: Vitest across the music core; Playwright end-to-end driving every tool through a faithful `document.modelContext` stand-in, including the rejected write, the locked bar, and the human choosing an option.
- **Judge mode**: `?judge=1` runs the whole loop with captions and no agent.

## Challenges
Making rejection *useful* rather than annoying: the error has to name the bar, both spellings of the note, the allowed range and a fix the model can act on. Transposition correctness (written = sounding + transposition, and MusicXML's `<transpose>` is the negative of that) got its own verification pass. And keeping the score readable while an agent rewrites it live.

## What we learned
The most valuable thing a page can give an agent is not more actions — it is the ability to say no, precisely. And the most valuable thing an agent can give a musician is a first draft it knows it cannot verify alone.

## What's next
MIDI keyboard input, real instrument samples, per-player practice tracks, and a shared link so a section leader's agent can suggest changes to one part.
