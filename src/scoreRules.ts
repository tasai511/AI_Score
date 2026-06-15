import type { AdvanceReason, AppState, BaseKey, PitchType, RunnerSource, RunnerState, TeamKey } from "./types";

export const hitMarkAssets = {
  single: "assets/single.svg",
  "two-base": "assets/two-base.svg",
  "three-base": "assets/three-base.svg",
  "home-run": "assets/home-run.svg"
} as const;

export const pitchSymbolCoordinates = [
  { x: 190, y: 250 },
  { x: 190, y: 375 },
  { x: 190, y: 500 },
  { x: 190, y: 625 }
];

export const outSymbols = ["", "I", "II", "III"];

export const advanceReasonLabels: Record<AdvanceReason, string> = {
  walk: "四球",
  "dead-ball": "死球",
  "dropped-third-strike": "振り逃げ",
  "catcher-interference": "打撃妨害",
  steal: "盗塁",
  "passed-ball": "後逸",
  balk: "ボーク",
  "runner-interference": "走塁妨害",
  hit: "安打"
};

const nextBaseMap: Record<BaseKey, BaseKey | "home"> = {
  first: "second",
  second: "third",
  third: "home"
};

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

function syncRunnerFirst(state: AppState) {
  state.game.runnerFirst = Boolean(state.game.runners.first);
}

function getRunnerId(state: AppState, runner: { jerseyNumber?: string; name?: string }) {
  const teamKey = getBattingTeamKey(state);
  const jerseyNumber = normalizeNumber(runner.jerseyNumber);
  return `${teamKey}-${state.game.battingOrder}-${jerseyNumber || normalizeNumber(runner.name) || "unknown"}`;
}

export function getCurrentBatterRunner(state: AppState): RunnerState {
  const batter = getCurrentBatter(state);
  return {
    id: getRunnerId(state, batter ?? {}),
    teamKey: getBattingTeamKey(state),
    battingOrder: state.game.battingOrder,
    jerseyNumber: normalizeNumber(batter?.jerseyNumber),
    name: normalizeNumber(batter?.name),
    scoreNotes: []
  };
}

function withAdvanceNote(runner: RunnerState, reason: AdvanceReason): RunnerState {
  const label = advanceReasonLabels[reason];
  return {
    ...runner,
    scoreNotes: runner.scoreNotes.includes(label) ? runner.scoreNotes : [...runner.scoreNotes, label]
  };
}

function scoreRunner(state: AppState, runner: RunnerState) {
  if (runner.teamKey === "own") {
    state.game.ownScore += 1;
  } else {
    state.game.opponentScore += 1;
  }
}

function placeRunnerOnBase(state: AppState, base: BaseKey, runner: RunnerState, reason: AdvanceReason) {
  const occupyingRunner = state.game.runners[base];
  if (occupyingRunner) advanceExistingRunnerInPlace(state, base, reason);
  state.game.runners[base] = withAdvanceNote(runner, reason);
}

function advanceExistingRunnerInPlace(state: AppState, source: BaseKey, reason: AdvanceReason) {
  const runner = state.game.runners[source];
  if (!runner) return;

  state.game.runners[source] = null;
  const destination = nextBaseMap[source];
  if (destination === "home") {
    scoreRunner(state, withAdvanceNote(runner, reason));
  } else {
    placeRunnerOnBase(state, destination, runner, reason);
  }
}

function advanceBatterToFirstInPlace(state: AppState, reason: AdvanceReason) {
  placeRunnerOnBase(state, "first", getCurrentBatterRunner(state), reason);
  syncRunnerFirst(state);
}

export function advanceRunner(state: AppState, source: RunnerSource, reason: AdvanceReason): AppState {
  const next: AppState = structuredClone(state);
  next.game.firstPitchEntered = true;

  if (reason === "dropped-third-strike") {
    const strikeCount = next.plate.pitches.filter((pitch) => pitch === "\u2715").length;
    if (strikeCount < 3) next.plate.pitches.push("\u2715");
    if (next.plate.result === "K" && next.game.outs > 0) next.game.outs -= 1;
    next.plate.outNumber = 0;
    next.plate.result = advanceReasonLabels[reason];
    next.game.balls = 0;
    next.game.strikes = 0;
  }

  if (reason === "catcher-interference") {
    next.plate.result = advanceReasonLabels[reason];
    next.game.balls = 0;
    next.game.strikes = 0;
  }

  if (source === "batter") {
    advanceBatterToFirstInPlace(next, reason);
  } else {
    advanceExistingRunnerInPlace(next, source, reason);
  }

  syncRunnerFirst(next);
  return next;
}

export function canUseDroppedThirdStrike(state: AppState) {
  const strikeCount = state.plate.pitches.filter((pitch) => pitch === "\u2715").length;
  const hasTwoStrikes = state.game.strikes >= 2 || strikeCount >= 2 || state.plate.result === "K";
  return hasTwoStrikes && (!state.game.runners.first || state.game.outs >= 2);
}

export function confirmPlateAppearance(state: AppState): AppState {
  const next: AppState = structuredClone(state);
  const nextBattingOrder = next.game.battingOrder >= 9 ? 1 : next.game.battingOrder + 1;
  next.game.battingOrder = nextBattingOrder;
  next.game.balls = 0;
  next.game.strikes = 0;
  next.game.hitType = "";
  next.game.firstPitchEntered = false;

  if (next.game.outs >= 3) {
    next.game.outs = 0;
    next.game.battingOrder = 1;
    next.game.runners = { first: null, second: null, third: null };
    next.game.half = next.game.half === "表" ? "裏" : "表";
    if (next.game.half === "表") next.game.inning += 1;
  }

  const ownBatter = getCurrentOwnBatter(next);
  const opponentBatter = getCurrentOpponentBatter(next);
  next.game.currentBatterJerseyNumber = ownBatter?.jerseyNumber ?? "";
  next.game.currentOpponentBatterJerseyNumber = opponentBatter?.jerseyNumber ?? next.game.currentOpponentBatterJerseyNumber;
  next.plate = {
    pitches: [],
    result: "",
    outNumber: 0
  };
  syncRunnerFirst(next);
  return next;
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
      advanceBatterToFirstInPlace(next, "walk");
      finish("B");
    }
  }

  if (type === "dead") {
    advanceBatterToFirstInPlace(next, "dead-ball");
    finish("DB");
  }

  syncRunnerFirst(next);
  return next;
}
