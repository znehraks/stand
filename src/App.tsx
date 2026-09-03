import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { store } from './store';
import type { Level, TimeSig } from './core/types';
import { checkScore } from './core/check';
import { PRESETS } from './data/presets';
import { player, type CursorPos } from './audio/player';
import { toMidiBytes, toMusicXML, toPartMusicXML } from './core/exporters';
import { registry } from './lib/webmcp';
import { buildSurface } from './lib/tools';
import { runJudge, type JudgeRunner } from './lib/judge';
import { ScoreView, type Selection } from './render/ScoreView';
import { ActivityFeed, AskHumanCard, EmptyState, EnsemblePanel, ExportBar, IssueList, Transport } from './components/panels';
import { AgentConsole } from './components/AgentConsole';

function download(name: string, data: string | Uint8Array, type: string): void {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const [, force] = useState(0);
  const rerender = useCallback(() => force((x) => x + 1), []);
  const [cursor, setCursor] = useState<CursorPos | null>(null);
  const [playingOption, setPlayingOption] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const judgeRef = useRef<JudgeRunner | null>(null);
  const unlocked = useRef(false);

  useEffect(() => store.subscribe(rerender), [rerender]);
  useEffect(() => registry.subscribe(rerender), [rerender]);
  useEffect(() => player.onCursor(setCursor), []);
  useEffect(() => {
    store.now = () => Date.now();
  }, []);

  // Audio needs a gesture. Arm it on the first interaction anywhere on the page.
  useEffect(() => {
    const arm = async () => {
      if (unlocked.current) return;
      unlocked.current = true;
      await player.unlock();
      rerender();
    };
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, [rerender]);

  const score = store.score;
  const issues = useMemo(() => (score ? checkScore(score) : []), [score, store.log.length]);

  // The tool surface follows the phase and the ensemble.
  useEffect(() => {
    const { name, specs } = buildSurface({ store, player, origin: location.origin });
    void registry.setSurface(name, specs);
  }, [store.phase, score?.parts.map((p) => p.id).join(','), score?.level, score?.key, store.log.length]);

  useEffect(() => {
    document.title = score ? `${score.title} — Stand` : 'Stand — an arranging studio your agent can write in';
  }, [score?.title]);

  const startJudge = useCallback(() => {
    if (judgeRef.current) return;
    void player.unlock();
    judgeRef.current = runJudge(registry, {
      say: setCaption,
      done: () => {
        judgeRef.current = null;
        setCaption(null);
      },
    });
    rerender();
  }, [rerender]);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('judge') === '1') {
      const t = setTimeout(startJudge, 900);
      return () => clearTimeout(t);
    }
  }, [startJudge]);

  const onExport = useCallback(
    (what: 'musicxml' | 'parts' | 'midi' | 'print') => {
      if (!score) return;
      const slug = score.title.replace(/[^\w가-힣]+/g, '-').toLowerCase().slice(0, 40) || 'arrangement';
      if (what === 'musicxml') download(`${slug}.musicxml`, toMusicXML(score), 'application/vnd.recordare.musicxml+xml');
      if (what === 'midi') download(`${slug}.mid`, toMidiBytes(score), 'audio/midi');
      if (what === 'parts') {
        for (const p of score.parts) download(`${slug}-${p.id}.musicxml`, toPartMusicXML(score, p.id), 'application/vnd.recordare.musicxml+xml');
      }
      if (what === 'print') window.print();
      store.markExported('hand', what);
    },
    [score],
  );

  const onPlayOption = useCallback(
    async (label: string) => {
      const ask = store.ask;
      if (!ask || !score) return;
      const option = ask.options.find((o) => o.label === label);
      setPlayingOption(label);
      await player.unlock();
      if (option?.variant) await player.playVariant(score, option.variant);
      else await player.play(score);
      setPlayingOption(null);
    },
    [score],
  );

  if (!score) {
    return (
      <div className="app empty">
        <Header />
        <EmptyState presets={PRESETS} agentDetected={registry.native} onLoadPreset={(id) => store.loadPreset(id)} onJudge={startJudge} />
        <div className="empty-console">
          <AgentConsole registry={registry} />
        </div>
        {caption && <Caption text={caption} onStop={() => judgeRef.current?.stop()} />}
      </div>
    );
  }

  const selection: Selection | null = store.selection;

  return (
    <div className="app">
      <Header score={score} />
      <div className="stage">
        <main>
          <Transport
            score={score}
            playing={player.isPlaying()}
            position={cursor}
            view={store.view}
            onPlay={async (from) => {
              await player.unlock();
              void player.play(score, { from });
            }}
            onStop={() => player.stop()}
            onTempo={(tempo) => store.setMeta({ tempo })}
            onToggleMute={(partId, muted) => store.setMuted(partId, muted)}
            onView={(view) => store.setView(view)}
          />
          <ScoreView
            score={score}
            view={store.view}
            cursor={cursor}
            issues={issues}
            selection={selection}
            writingPart={store.writingPart}
            onSelectNote={(sel) => store.setSelection(sel)}
            onNudgeNote={(sel, semitones) => store.editNote(sel.partId, sel.measure, sel.note, { semitones })}
            onToggleLock={(partId, measure) => store.toggleLock(partId, measure)}
          />
          <ExportBar score={score} exported={store.exported} onExport={onExport} onReopen={() => store.reopen()} />
        </main>
        <aside>
          <EnsemblePanel
            score={score}
            issues={issues}
            onSetEnsemble={(specs, level) => store.setEnsemble(specs, level)}
            onSetMeta={(patch: { title?: string; tempo?: number; level?: Level }) => store.setMeta(patch)}
            onSetKey={(key) => store.setKey(key)}
            onSetTime={(time: TimeSig) => store.setTime(time)}
          />
          <IssueList score={score} issues={issues} onFocus={(partId, measure) => store.setSelection({ partId, measure, note: 0 })} />
          <AgentConsole registry={registry} compact />
          <ActivityFeed log={store.log} />
        </aside>
      </div>
      <AskHumanCard ask={store.ask} playingOption={playingOption} onPlayOption={onPlayOption} onAnswer={(label) => store.ask?.resolve(label)} />
      {caption && <Caption text={caption} onStop={() => judgeRef.current?.stop()} />}
    </div>
  );
}

function Header({ score }: { score?: { title: string; key: string; time: string; tempo: number; level: string; source?: string } }) {
  return (
    <header className="topbar">
      <a className="brand" href="/">
        <span className="logo" aria-hidden>
          <i />
          <i />
          <i />
          <b />
        </span>
        Stand
      </a>
      {score && (
        <div className="now">
          <b>{score.title}</b>
          <span className="muted" title={score.source ?? ''}>
            {score.key} · {score.time} · ♩={score.tempo} · {score.level}
            {score.source ? ` · ${score.source.split(/[.(]/)[0].trim()}` : ''}
          </span>
        </div>
      )}
      <nav>
        <a href="https://github.com/znehraks/stand" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a href="https://github.com/webmachinelearning/webmcp" target="_blank" rel="noreferrer">
          WebMCP
        </a>
      </nav>
    </header>
  );
}

function Caption({ text, onStop }: { text: string; onStop: () => void }) {
  return (
    <div id="demo-cap" role="status">
      <span>{text}</span>
      <button className="btn xs" onClick={onStop}>
        stop
      </button>
    </div>
  );
}
