// A small registry on top of WebMCP (document.modelContext / navigator.modelContext).
// - Feature-detects the API, registers a *surface* (set of tools) and can swap surfaces
//   atomically using AbortSignal-based unregistration (the spec'd way to unregister).
// - Mirrors every registration into an in-page registry so the page can show the human
//   exactly what its agent can do right now, and so tools can be driven by hand or by the
//   built-in demo agent when no WebMCP agent is present.

export interface ToolSpec<I = Record<string, unknown>> {
  name: string;
  title?: string;
  description: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: I) => Promise<unknown>;
}

export interface ToolCallLog {
  id: string;
  at: number;
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
  ms?: number;
  source: 'agent' | 'console' | 'demo' | 'hand';
}

type Listener = () => void;

function getModelContext(): WebMCP.ModelContext | null {
  const d = document as unknown as { modelContext?: WebMCP.ModelContext };
  const n = navigator as unknown as { modelContext?: WebMCP.ModelContext };
  const mc = d.modelContext ?? n.modelContext ?? null;
  return mc && typeof mc.registerTool === 'function' ? mc : null;
}

export class ToolRegistry {
  private controller: AbortController | null = null;
  private tools = new Map<string, ToolSpec>();
  private listeners = new Set<Listener>();
  log: ToolCallLog[] = [];
  surfaceName = '';
  readonly native: boolean;
  readonly nativeVia: 'document' | 'navigator' | 'none';
  onAgentCall?: (name: string) => void;

  constructor() {
    const d = document as unknown as { modelContext?: unknown };
    const n = navigator as unknown as { modelContext?: unknown };
    this.native = getModelContext() !== null;
    this.nativeVia = d.modelContext ? 'document' : n.modelContext ? 'navigator' : 'none';
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  list(): ToolSpec[] {
    return [...this.tools.values()];
  }

  /** Replace the current tool surface atomically. */
  async setSurface(name: string, specs: ToolSpec[]): Promise<void> {
    const names = specs.map((s) => s.name).join(',');
    const current = this.list().map((s) => s.name).join(',');
    if (name === this.surfaceName && names === current) {
      // same names: refresh executors only (closures over fresh state)
      for (const s of specs) this.tools.set(s.name, s);
      return;
    }
    this.controller?.abort();
    this.controller = new AbortController();
    this.tools = new Map(specs.map((s) => [s.name, s]));
    this.surfaceName = name;
    const mc = getModelContext();
    if (mc) {
      for (const spec of specs) {
        try {
          await mc.registerTool(
            {
              name: spec.name,
              title: spec.title,
              description: spec.description,
              inputSchema: spec.inputSchema,
              annotations: spec.annotations,
              execute: async (input: Record<string, unknown>) => this.run(spec.name, input, 'agent'),
            },
            { signal: this.controller.signal },
          );
        } catch (e) {
          console.warn('registerTool failed', spec.name, e);
        }
      }
    }
    this.emit();
  }

  /** Record something the human did by hand, so agent and human actions share one timeline. */
  record(name: string, input: unknown, output?: unknown): void {
    const entry: ToolCallLog = { id: Math.random().toString(36).slice(2), at: Date.now(), name, input, output, ms: 0, source: 'hand' };
    this.log = [...this.log.slice(-99), entry];
    this.emit();
  }

  /** Execute a tool by name (from the agent, the console, or the demo agent). Always returns a JSON-serializable value. */
  async run(name: string, input: Record<string, unknown>, source: ToolCallLog['source']): Promise<unknown> {
    const spec = this.tools.get(name);
    const entry: ToolCallLog = { id: Math.random().toString(36).slice(2), at: Date.now(), name, input, source };
    this.log = [...this.log.slice(-99), entry];
    this.emit();
    if (source === 'agent') this.onAgentCall?.(name);
    const t0 = performance.now();
    let output: unknown;
    try {
      if (!spec) throw new Error(`Unknown tool ${name}. Available: ${this.list().map((t) => t.name).join(', ')}`);
      output = await spec.execute(input ?? {});
      entry.output = output;
    } catch (e) {
      entry.error = (e as Error).message;
      output = { ok: false, error: (e as Error).message };
    }
    entry.ms = Math.round(performance.now() - t0);
    this.log = this.log.map((l) => (l.id === entry.id ? { ...entry } : l));
    this.emit();
    return output;
  }
}

export const registry = new ToolRegistry();
