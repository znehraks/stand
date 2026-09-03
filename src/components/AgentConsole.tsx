import { useEffect, useMemo, useState } from 'react';
import type { ToolCallLog, ToolRegistry } from '../lib/webmcp';

interface Props {
  registry: ToolRegistry;
  demo?: { canRun: boolean; run: () => void; stop: () => void; running: boolean; narration: string[] };
  compact?: boolean;
}

function fmt(v: unknown): string {
  try {
    const s = JSON.stringify(v, null, 1);
    return s.length > 1200 ? s.slice(0, 1200) + '\n…' : s;
  } catch {
    return String(v);
  }
}

export function AgentConsole({ registry, demo, compact }: Props) {
  const [, force] = useState(0);
  useEffect(() => registry.subscribe(() => force((x) => x + 1)), [registry]);
  const tools = registry.list();
  const [sel, setSel] = useState('');
  const [args, setArgs] = useState('{}');
  const [err, setErr] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const selected = tools.find((t) => t.name === sel) ?? tools[0];

  const sample = useMemo(() => {
    const schema = (selected?.inputSchema ?? {}) as { properties?: Record<string, { type?: string; enum?: unknown[]; items?: { properties?: Record<string, { type?: string }> } }>; required?: string[] };
    const out: Record<string, unknown> = {};
    for (const [k, p] of Object.entries(schema.properties ?? {})) {
      if (!schema.required?.includes(k) && !p.enum) continue;
      if (p.enum) out[k] = p.enum[0];
      else if (p.type === 'integer' || p.type === 'number') out[k] = 30;
      else if (p.type === 'array') out[k] = [Object.fromEntries(Object.keys(p.items?.properties ?? {}).map((kk) => [kk, kk === 'date' ? '2026-01-01' : kk === 'from' ? '09:00' : kk === 'to' ? '12:00' : '']))];
      else out[k] = k === 'date' ? '2026-01-01' : k === 'time' ? '14:00' : '';
    }
    return JSON.stringify(out, null, 1);
  }, [selected]);

  useEffect(() => {
    setArgs(sample);
  }, [sample]);

  const run = async () => {
    if (!selected) return;
    setErr(null);
    let input: Record<string, unknown> = {};
    try {
      input = args.trim() ? (JSON.parse(args) as Record<string, unknown>) : {};
    } catch (e) {
      setErr(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    const props = ((selected.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>;
    const unknown = Object.keys(input).filter((k) => !(k in props));
    if (unknown.length) {
      setErr(`Unknown key${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. This tool accepts: ${Object.keys(props).join(', ') || '(no parameters)'}.`);
      return;
    }
    await registry.run(selected.name, input, 'console');
  };
  const schemaText = useMemo(() => JSON.stringify(selected?.inputSchema ?? {}, null, 1), [selected]);

  const log = [...registry.log].reverse();
  return (
    <div className="console" aria-label="Agent console">
      <div className="c-h">
        <span>Agent console</span>
        <span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>
          surface: {registry.surfaceName || '—'}
        </span>
      </div>
      <div className="c-b">
        <div className="status">
          <span className={`dot${registry.native ? ' on' : ''}`} />
          {registry.native ? (
            <span>
              WebMCP detected via <code className="mono">{registry.nativeVia}.modelContext</code> — your agent can see <b>{tools.length}</b> tool{tools.length === 1 ? '' : 's'} right now.
            </span>
          ) : (
            <span>
              No WebMCP agent in this browser. Open this page in <b>ChatGPT’s desktop browser</b> or <b>Chrome 149+</b> with <code className="mono">chrome://flags/#enable-webmcp-testing</code> — or run tools by hand below.
            </span>
          )}
        </div>
        <div className="tools">
          {tools.map((t) => (
            <div className="tool" key={t.name} title={t.description}>
              <span className="n">{t.name}</span>
              {t.annotations?.readOnlyHint && <span className="b">read</span>}
              {t.annotations?.untrustedContentHint && <span className="b">untrusted</span>}
              {!compact && <span className="d">{t.description}</span>}
            </div>
          ))}
        </div>
        {demo?.canRun && (
          <div className="row">
            {!demo.running ? (
              <button className="btn sm accent" onClick={demo.run}>
                ▶ Watch a demo agent use these tools
              </button>
            ) : (
              <button className="btn sm" onClick={demo.stop}>
                <span className="spin" /> Stop demo agent
              </button>
            )}
            <span className="muted small" style={{ color: '#a9a7a0' }}>Scripted, no LLM — it calls the same tools an agent would.</span>
          </div>
        )}
        {demo && demo.narration.length > 0 && (
          <div className="log">
            {demo.narration.slice(-4).map((t, i) => (
              <div className="l demo" key={i}>
                <span className="h">
                  <b>demo agent</b> {t}
                </span>
              </div>
            ))}
          </div>
        )}
        <details open={runOpen} onToggle={(e) => setRunOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Run a tool by hand</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            <select value={selected?.name ?? ''} onChange={(e) => setSel(e.target.value)} aria-label="Tool">
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
            <div className="muted small" style={{ color: '#a9a7a0' }}>{selected?.description}</div>
            <textarea rows={4} value={args} onChange={(e) => setArgs(e.target.value)} aria-label="Arguments (JSON)" />
            <details>
              <summary>Parameter schema</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#cfcdc5', maxHeight: 220, overflow: 'auto' }}>{schemaText}</pre>
            </details>
            {err && <div className="err mono">{err}</div>}
            <div className="row">
              <button className="btn sm" onClick={run} disabled={!selected}>
                Run {selected?.name}
              </button>
            </div>
          </div>
        </details>
        <div className="log" aria-live="polite">
          {log.length === 0 && <div className="l"><span className="h">No tool calls yet.</span></div>}
          {log.slice(0, 30).map((l: ToolCallLog) => (
            <div className={`l ${l.source}`} key={l.id}>
              <div className="h">
                <b>{l.name}</b> · {l.source === 'hand' ? '✋ by hand' : l.source} · {new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                {l.source === 'hand' ? '' : l.ms !== undefined ? ` · ${l.ms}ms` : ' · running…'}
              </div>
              {!!l.input && Object.keys(l.input as object).length > 0 && <pre>{'← ' + fmt(l.input)}</pre>}
              {l.error ? <pre className="err">{'✕ ' + l.error}</pre> : l.output !== undefined ? <pre>{'→ ' + fmt(l.output)}</pre> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
