# Stand — canonical WebMCP tool surface

This file is the contract. `src/lib/tools.ts`, `src/lib/judge.ts`, `e2e/stand.spec.ts` and the README must agree with it exactly.

Conventions for every tool:
- Registered with `document.modelContext.registerTool` through `ToolRegistry.setSurface` (one `AbortController` per surface).
- Descriptions under 500 characters, written for a model, positive voice.
- `inputSchema` uses `additionalProperties: false`, enums where a value is fixed, integers for bar numbers.
- **Bar numbers in the tool API are 1-based** (`from_bar: 1` is the first bar). The store is 0-based; convert at the tool boundary.
- Pitches are **sounding (concert) pitch**, scientific notation: `"Bb4"`, `"F#5"`, `"r"` for a rest. The page transposes for each instrument's written part.
- Durations: `w h q 8 16` plus dotted `hd qd 8d`. Every bar must total exactly one bar of the time signature.
- Reads carry `annotations: { readOnlyHint: true }`.
- Every mutating result includes what changed and a `next_step` sentence. Failures return `{ ok: false, error, issues? }` with a fix suggestion — never throw a bare message.

## Surface `empty` (no score loaded yet)
| Tool | Input | Returns |
|---|---|---|
| `get_score` (read) | `{}` | `{ phase: 'empty', melodies: [{id, title, key, time, bars, source}], instruments_available: number, next_step }` |
| `list_melodies` (read) | `{}` | `{ melodies: [{id, title, key, time, bars, source}] }` |
| `list_instruments` (read) | `{ section? }` | `{ instruments: [{id, name, clef, transposition, written_key_example, range_by_level}] }` |
| `load_melody` (write) | `{ melody: string }` | `{ ok, title, bars, key, time, next_step }` — loads a public-domain melody as the `melody` part |

## Surface `arranging`
| Tool | Input | Returns |
|---|---|---|
| `get_score` (read) | `{}` | title, key, time, tempo, level, bars, `parts:[{id,label,instrument,transposition,written_key,range_at_level,bars_written,locked_bars,muted}]`, `chords`, `issues` (count by severity + first 5), `playing`, `audio_armed`, `view`, `next_step` |
| `read_part` (read) | `{ part, from_bar?, to_bar? }` | `{ part, label, instrument, written_key, bars: [{bar, notes:[{pitch,dur,written,...}], locked}] }` — both sounding and written pitch per note |
| `list_instruments` (read) | `{ section? }` | as above |
| `set_ensemble` (write) | `{ instruments: [{instrument, count?, label?}], level? }` | `{ ok, parts:[{id,label}], level, kept_music:[partIds], next_step }` |
| `set_meta` (write) | `{ title?, tempo?, level? }` | `{ ok, changed:[...], issues }` |
| `set_key` (write) | `{ key }` | `{ ok, key, written_keys:{partId: key}, next_step }` — changes the key signature only; use `transpose` to move the notes |
| `set_time` (write) | `{ time }` | `{ ok }` or `{ ok:false, error }` if existing bars would break |
| `write_part` (write) | `{ part, from_bar, bars: [{notes:[{pitch,dur,tie?,dyn?,art?,lyric?}]}] }` | `{ ok, written_bars, skipped_locked_bars, warnings, next_step }`. **Rejected** with `{ ok:false, error, issues }` when a bar's durations do not fill the bar, a pitch is unknown, or a note lies outside the instrument's sounding range at the score's level. The error names the bar, the note and the fix. |
| `write_chords` (write) | `{ chords: string[], from_bar? }` | `{ ok, chords }` |
| `harmonize` (write) | `{ source_part, target_parts: string[], style: 'block'\|'pad'\|'countermelody', from_bar?, to_bar? }` | `{ ok, wrote:{partId: bars}, notes:[...], next_step }` — a rule-based draft inside every target's range |
| `transpose` (write) | `{ to_key?, semitones? }` | `{ ok, key, moved_notes, issues }` — moves every sounding pitch and the key |
| `check` (read) | `{ part? }` | `{ errors:[...], warnings:[...], summary }` |
| `play` (write) | `{ from_bar?, to_bar?, parts?, loop? }` | `{ ok, playing_from, audio_armed }`; when audio is not armed returns `{ ok:false, needs_gesture:true, error }` and the agent should ask the person to press ▶ once |
| `stop` (write) | `{}` | `{ ok }` |
| `ask_human` (write, waits) | `{ question, options: [{label, part?, from_bar?, bars?}] }` | `{ answer, answered_in_ms }` or `{ answer: null, status:'no_answer' }` after 120 s. Options carrying `bars` are playable A/B candidates: the page shows a ▶ per option and the person listens before choosing. |
| `set_view` (write) | `{ mode: 'full'\|'part', part? }` | `{ ok, view }` |
| `undo` (write) | `{}` | `{ ok }` |
| `export_plan` (read) | `{}` | `{ formats:['musicxml','parts','midi','print'], note: 'the person exports with the buttons on the page' }` |

## Surface `exported`
`get_score` (read) · `export_plan` (read) · `reopen` (write — asks the person to confirm through `ask_human` before reopening).

## People only — never a tool
Loading a melody file of their own, **locking or unlocking a bar**, dragging a note by hand, **exporting or printing**, and answering `ask_human`. The agent proposes; the person decides what leaves the page.
