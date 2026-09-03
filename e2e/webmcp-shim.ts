// Installs a faithful stand-in for document.modelContext before any page script runs,
// so tests can observe registrations and call tools exactly like an agent would.
export const WEBMCP_SHIM = `
(() => {
  const tools = new Map();
  const target = new EventTarget();
  const mc = {
    async registerTool(tool, options = {}) {
      if (!tool || typeof tool.name !== 'string' || typeof tool.execute !== 'function') throw new TypeError('bad tool');
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) throw new TypeError('bad tool name ' + tool.name);
      if (typeof tool.description !== 'string') throw new TypeError('missing description');
      tools.set(tool.name, tool);
      if (options.signal) options.signal.addEventListener('abort', () => { if (tools.get(tool.name) === tool) tools.delete(tool.name); target.dispatchEvent(new Event('toolchange')); });
      target.dispatchEvent(new Event('toolchange'));
    },
    async getTools() { return [...tools.values()].map(t => ({ name: t.name, title: t.title ?? '', description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, origin: location.origin, window })).sort((a,b)=>a.name.localeCompare(b.name)); },
    async executeTool(tool, inputJson = '{}') {
      const t = tools.get(tool.name); if (!t) throw new Error('no such tool ' + tool.name);
      const input = typeof inputJson === 'string' ? JSON.parse(inputJson || '{}') : inputJson;
      const ctrl = new AbortController();
      const out = await t.execute(input, { signal: ctrl.signal });
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
  Object.defineProperty(document, 'modelContext', { value: mc, configurable: true });
  window.__agent = {
    async names() { return (await mc.getTools()).map(t => t.name); },
    async call(name, input) { const r = await mc.executeTool({ name }, JSON.stringify(input ?? {})); try { return JSON.parse(r); } catch { return r; } },
  };
})();
`;
