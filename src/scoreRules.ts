import type { AppState, PitchType, TeamKey } from "./types";

export const hitMarkAssets = {
  single: "assets/single.svg",
  "two-base": "assets/two-base.svg",
  "three-base": "assets/three-base.svg",
  "home-run": "assets/home-run.svg"
} as const;

export const pitchSymbolCoordinates = [
  { x: 182, y: 250 },
  { x: 182, y: 365 },
  { x: 182, y: 480 },
  { x: 182, y: 595 }
];

export const outSymbols = ["", "I", "II", "III"];

export function normalizeNumber(value: unknown) {
  return String(value ?? "").trim();
}

export function formatJerseyNumber(value: unknown) {
  const jerseyNumber = normalizeNumber(value);
  return jerseyNumber ? `#${jerseyNumber}` : "";
}

export function isOwnBattingNow(state: AppState) {
  return (
    (state.game.half === "表" && state.ownTeam.battingSide === "top") ||
    (state.game.half === "裏" && state.ownTeam.battingSide === "bottom")
  );
}

export function getBattingTeamKey(state: AppState): TeamKey {
  return isOwnBattingNow(state) ? "own" : "opponent";
}

export function getCurrentBattingIndex(state: AppState) {
  return Math.max(0, Number(state.game.battingOrder || 1) - 1);
}

export function getCurrentOwnBatter(state: AppState) {
  return state.ownOrder[getCurrentBattingIndex(state)];
}

export function getCurrentOpponentBatter(state: AppState) {
  return state.opponentOrder[getCurrentBattingIndex(state)];
}

export function getCurrentBatter(state: AppState) {
  return isOwnBattingNow(state) ? getCurrentOwnBatter(state) : getCurrentOpponentBatter(state);
}

export function formatPlayerLabel(player?: { jerseyNumber?: string; name?: string }, fallbackJerseyNumber = "") {
  const jerseyNumber = formatJerseyNumber(player?.jerseyNumber || fallbackJerseyNumber);
  const name = normalizeNumber(player?.name);

  if (jerseyNumber && name) return `${jerseyNumber} ${name}`;
  return jerseyNumber || name;
}

export function getDuplicateValues<T>(rows: T[], field: keyof T) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const value = normalizeNumber(row[field]);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return new Set([...counts].filter(([, count]) => count > 1).map(([value]) => value));
}

export function applyPitch(state: AppState, type: PitchType): AppState {
  if (state.plate.result) return state;

  const pitchSymbolMap: Record<PitchType, string> = {
    strike: "\u2715",
    ball: "\u25cf",
    foul: "\u25b3",
    dead: ""
  };

  const next: AppState = structuredClone(state);
  next.game.firstPitchEntered = true;

  const addSymbol = (pitchType: PitchType) => {
    const symbol = pitchSymbolMap[pitchType];
    if (symbol) next.plate.pitches.push(symbol);
  };

  const finish = (result: string, outNumber = 0) => {
    next.plate.result = result;
    next.plate.outNumber = outNumber;
    next.game.balls = 0;
    next.game.strikes = 0;
  };

  if (type === "strike") {
    addSymbol("strike");
    if (next.game.strikes >= 2) {
      next.game.outs = Math.min(3, next.game.outs + 1);
      finish("K", next.game.outs);
    } else {
      next.game.strikes += 1;
    }
  }

  if (type === "foul") {
    addSymbol("foul");
    if (next.game.strikes < 2) next.game.strikes += 1;
  }

  if (type === "ball") {
    addSymbol("ball");
    next.game.balls = Math.min(4, next.game.balls + 1);
    if (next.game.balls >= 4) {
      next.game.runnerFirst = true;
      finish("B");
    }
  }

  if (type === "dead") {
    next.game.runnerFirst = true;
    finish("DB");
  }

  return next;
}
