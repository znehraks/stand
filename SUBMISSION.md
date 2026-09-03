# Devpost submission checklist — Stand

Deadline: **September 3, 2026, 1:00 PM PDT**. Submit at https://webmcp.devpost.com/ → Submit project. (Multiple submissions are allowed when the projects are substantially different — Stand, Attune and Rendezvous are.)

| Field | Value |
|---|---|
| Project name | Stand |
| Tagline | An arranging studio your agent can write in — it writes the parts, the page refuses what your players cannot play, you decide by ear. |
| Live URL | https://stand.znehraks.workers.dev |
| Repository | https://github.com/znehraks/stand (public, MIT) |
| Demo video | upload `docs/video/stand-demo.mp4` to YouTube (public or unlisted), paste the link |
| Built with | webmcp, typescript, react, vite, vexflow, tone.js, musicxml, cloudflare-workers, vitest, playwright |
| Description | paste `DESCRIPTION.md` |

## Testing instructions
No login, no credentials, nothing to install. Six public-domain melodies ship with the app.

1. ChatGPT desktop app → built-in browser (model Sol or Terra) → https://stand.znehraks.workers.dev
2. Say: "Load Ode to Joy, set up a beginning band — two flutes, clarinet, alto sax, trumpet, trombone, snare — at elementary level, and arrange it." The agent calls `load_melody`, `set_ensemble`, then `write_part` per part.
3. Watch for a refused write: a note above a beginner's range comes back as an error naming the bar and the fix, and the agent rewrites it an octave lower. `check` lists what remains.
4. Say "play bars 1 to 4". The first time, the page asks for a click — browsers only start audio after a gesture — then it plays.
5. Say "give me two options for the last two bars and let me hear them": a card appears with ▶ on each option and waits for your choice. The agent cannot hear; you can.
6. Click 🔒 above a bar, then say "rewrite the trumpet part" — the locked bar is reported as skipped and comes back untouched.
7. Say "show me the trumpet part alone" — it appears in its written key. Export MusicXML, Parts or MIDI with the buttons (no tool can export).
8. No agent? Press "▶ Watch a 60-second demo" on the start screen, or open https://stand.znehraks.workers.dev/?judge=1
9. Chrome alternative: Chrome 149+ with `chrome://flags/#enable-webmcp-testing` and the Model Context Tool Inspector.
