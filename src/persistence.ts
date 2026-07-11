import type { AppState } from "./types";

export type StateSnapshot = Omit<AppState, "scoreLog">;

export interface GameRecord {
  state: AppState;
  preAtBatSnapshots: StateSnapshot[];
  currentAtBatStartSnapshot: StateSnapshot;
}

export interface GameSummary {
  id: string;
  updatedAt: number;
  ownTeamName: string;
  opponentTeamName: string;
  ownScore: number;
  opponentScore: number;
  inning: number;
  half: "表" | "裏";
  gameStarted: boolean;
}

const INDEX_KEY = "aiscore.gameIndex";
const GAME_KEY_PREFIX = "aiscore.game.";

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function stripScoreLog(state: AppState): StateSnapshot {
  const { scoreLog, ...rest } = state;
  return rest;
}

export function createNewGameId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `game-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadGameIndex(): GameSummary[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveGameIndex(index: GameSummary[]) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Storage full or unavailable: ignore, autosave will retry on next change.
  }
}

export function buildGameSummary(id: string, state: AppState): GameSummary {
  return {
    id,
    updatedAt: Date.now(),
    ownTeamName: state.ownTeam.shortName || state.ownTeam.name || "自チーム",
    opponentTeamName: state.opponentTeam.name || "相手チーム",
    ownScore: state.game.ownScore,
    opponentScore: state.game.opponentScore,
    inning: state.game.inning,
    half: state.game.half,
    gameStarted: state.game.gameStarted
  };
}

export function loadGame(id: string): GameRecord | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(GAME_KEY_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.state) return null;
    return {
      state: parsed.state as AppState,
      preAtBatSnapshots: Array.isArray(parsed.preAtBatSnapshots) ? parsed.preAtBatSnapshots : [],
      currentAtBatStartSnapshot: parsed.currentAtBatStartSnapshot ?? stripScoreLog(parsed.state as AppState)
    };
  } catch {
    return null;
  }
}

export function saveGame(id: string, record: GameRecord) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(GAME_KEY_PREFIX + id, JSON.stringify(record));
    const index = loadGameIndex();
    const summary = buildGameSummary(id, record.state);
    const nextIndex = [summary, ...index.filter((entry) => entry.id !== id)];
    saveGameIndex(nextIndex);
  } catch {
    // Storage full or unavailable: the in-memory game continues; the next successful
    // autosave will persist the latest state.
  }
}

export function deleteGame(id: string) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(GAME_KEY_PREFIX + id);
    saveGameIndex(loadGameIndex().filter((entry) => entry.id !== id));
  } catch {
    // ignore
  }
}
