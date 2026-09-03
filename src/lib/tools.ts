// CONTRACT — implemented by the tools agent.
import type { ToolSpec } from './webmcp';
import type { StandStore } from '../store';
import type { Player } from '../audio/player';

export interface ToolEnv {
  store: StandStore;
  player: Player;
  /** Trigger an export the way the human button does — used only by export_plan's guidance, never to export. */
  origin: string;
}

/** Tool surface for the current phase: 'empty' | 'arranging' | 'exported'. */
export function buildSurface(env: ToolEnv): { name: string; specs: ToolSpec[] } {
  return { name: 'empty', specs: [] };
}
