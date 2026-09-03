// CONTRACT — implemented by the judge-mode agent.
import type { ToolRegistry } from './webmcp';

export interface JudgeHooks {
  say: (caption: string | null) => void;
  done: () => void;
}

export interface JudgeRunner {
  stop: () => void;
}

/** Scripted demo that calls the very same registered tools an agent would, with captions. No LLM. */
export function runJudge(_registry: ToolRegistry, hooks: JudgeHooks): JudgeRunner {
  hooks.done();
  return { stop: () => {} };
}
