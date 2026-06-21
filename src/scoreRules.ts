import type { AdvanceReason, AppState, BaseKey, PitchType, RunnerDestination, RunnerSource, RunnerState, TeamKey } from "./types";

import type { ScoreCellMark } from "./types";

export const hitMarkAssets = {
  single: "assets/single.svg",
  "two-base": "assets/two-base.svg",
  "three-base": "assets/three-base.svg",
  "home-run": "assets/home-run.svg"
} as const;

export const outSymbols = ["", "I", "II", "III"];

export const fieldOutResultLabels: Record<number, string> = {
  1: "投ゴ",
  2: "捕ゴ",
  3: "一ゴ",
  4: "二ゴ",
  5: "三ゴ",
  6: "遊ゴ",
  7: "左飛",
  8: "中飛",
  9: "右飛"
};

export const advanceReasonLabels: Record<AdvanceReason, string> = {
  error: "失策",
  walk: "四球",
  "dead-ball": "死球",
  "dropped-third-strike": "振り逃げ",
  "catcher-interference": "捕手妨害",
  steal: "盗塁",
  "passed-ball": "捕逸",
  balk: "ボーク",
  "runner-interference": "走塁妨害",
  hit: "安打"
};

type ScoreCellPendingOut = {
  source: RunnerSource;
  destination?: RunnerDestination;
  runnerId?: string;
  resultLabel?: string;
  outNumber?: number;
};

function buildPitchMarks(pitches: string[]): ScoreCellMark[] {
  return pitches.map((text) => ({
    kind: "pitch",
    text,
    area: "pitch"
  }));
}

function getRunnerDestinationArea(destination?: RunnerDestination): ScoreCellMark["area"] | undefined {
  return destination;
}

function getPlateResultArea(
  result: string,
  currentBatterBase?: BaseKey,
  pendingBatterOut?: ScoreCellPendingOut
): ScoreCellMark["area"] {
  if (pendingBatterOut?.resultLabel === "走死") return getRunnerDestinationArea(pendingBatterOut.destination) || currentBatterBase || "result";
  if (pendingBatterOut?.resultLabel) return "result";
  if (result === "本") return "home";
  if (currentBatterBase && (result === "B" || result === "DB" || result === "E")) return currentBatterBase;
  if (currentBatterBase && !result) return currentBatterBase;
  return "result";
}

export function buildCurrentScoreCellMarks(state: AppState, pendingOuts: ScoreCellPendingOut[] = []): ScoreCellMark[] {
  const currentBatterBase = getCurrentBatterBase(state);
  const currentBatterRunner = currentBatterBase ? state.game.runners[currentBatterBase] : null;
  const marks = buildPitchMarks(state.plate.pitches.length > 0 ? state.plate.pitches : currentBatterRunner?.scoreCard.pitches ?? []);
  const pendingBatterOutEntry = pendingOuts
    .map((fieldOut, index) => ({ fieldOut, index }))
    .find(({ fieldOut }) => fieldOut.source === "batter");
  const previewOutNumber = pendingBatterOutEntry ? Math.min(3, state.game.outs + pendingBatterOutEntry.index + 1) : 0;
  const result = state.plate.result || pendingBatterOutEntry?.fieldOut.resultLabel || currentBatterRunner?.scoreCard.result || "";
  const outNumber = state.plate.outNumber || previewOutNumber || currentBatterRunner?.scoreCard.outNumber || 0;
  const resultArea = getPlateResultArea(result, currentBatterBase, pendingBatterOutEntry?.fieldOut);
  const currentBatterNote = !result && currentBatterRunner?.scoreNotes.length ? currentBatterRunner.scoreNotes[currentBatterRunner.scoreNotes.length - 1] : "";

  if (result) {
    marks.push({
      kind: "result",
      text: result,
      area: resultArea
    });
  }

  if (outNumber > 0) {
    marks.push({
      kind: "out",
      text: outSymbols[outNumber] ?? "?",
      area: "center"
    });
  }

  if (currentBatterNote && currentBatterNote !== result) {
    marks.push({
      kind: "note",
      text: currentBatterNote,
      area: currentBatterBase || "result"
    });
  }

  return marks;
}

export function buildRunnerScoreCellMarks(runner: RunnerState | null, pendingOut?: ScoreCellPendingOut | null, currentBase?: BaseKey | null): ScoreCellMark[] {
  if (!runner) return [];

  const marks = buildPitchMarks(runner.scoreCard.pitches);
  const lastNote = runner.scoreNotes.length > 0 ? runner.scoreNotes[runner.scoreNotes.length - 1] : "";
  const outNumber = pendingOut?.outNumber ?? runner.scoreCard.outNumber;
  const noteArea = getRunnerDestinationArea(pendingOut?.destination) || currentBase || "result";

  if (runner.scoreCard.result) {
    marks.push({
      kind: "result",
      text: runner.scoreCard.result,
      area: "result"
    });
  }

  if (outNumber > 0) {
    marks.push({
      kind: "out",
      text: outSymbols[outNumber] ?? "?",
      area: "center"
    });
  }

  if (lastNote) {
    marks.push({
      kind: "note",
      text: lastNote,
      area: currentBase || "result"
    });
  }

  if (pendingOut) {
    marks.push({
      kind: "note",
      text: pendingOut.resultLabel || "走死",
      area: noteArea
    });
  }

  return marks;
}

const nextBaseMap: Record<BaseKey, BaseKey | "home"> = {
  first: "second",
  second: "third",
  third: "home"
};

const runnerProgressRank: Record<RunnerSource | RunnerDestination, number> = {
  batter: 0,
  first: 1,
  second: 2,
  third: 3,
  home: 4
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

function getTeamBattingOrder(state: AppState, teamKey: TeamKey) {
  return teamKey === "own" ? state.game.ownBattingOrder : state.game.opponentBattingOrder;
}

function setTeamBattingOrder(state: AppState, teamKey: TeamKey, order: number) {
  if (teamKey === "own") {
    state.game.ownBattingOrder = order;
    return;
  }

  state.game.opponentBattingOrder = order;
}

function syncActiveBattingOrder(state: AppState) {
  state.game.battingOrder = getTeamBattingOrder(state, getBattingTeamKey(state));
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

function getBatterScoreCardResult(state: AppState, reachReason?: AdvanceReason) {
  if (state.plate.result) return state.plate.result;
  if (reachReason === "walk") return "B";
  if (reachReason === "dead-ball") return "DB";
  if (reachReason === "dropped-third-strike") return advanceReasonLabels["dropped-third-strike"];
  if (reachReason === "catcher-interference") return advanceReasonLabels["catcher-interference"];
  if (reachReason === "error") return "E";
  return "";
}

function getCurrentBatterScoreCard(state: AppState, reachReason?: AdvanceReason) {
  return {
    pitches: [...state.plate.pitches],
    result: getBatterScoreCardResult(state, reachReason),
    outNumber: state.plate.outNumber,
    hitType: reachReason === "error" ? "" : state.game.hitType
  };
}

export function getCurrentBatterRunner(state: AppState, reachReason?: AdvanceReason): RunnerState {
  const batter = getCurrentBatter(state);
  return {
    id: getRunnerId(state, batter ?? {}),
    teamKey: getBattingTeamKey(state),
    battingOrder: state.game.battingOrder,
    jerseyNumber: normalizeNumber(batter?.jerseyNumber),
    name: normalizeNumber(batter?.name),
    scoreCard: getCurrentBatterScoreCard(state, reachReason),
    scoreNotes: []
  };
}

function getCurrentBatterBase(state: AppState) {
  const teamKey = getBattingTeamKey(state);
  return (["first", "second", "third"] as BaseKey[]).find((base) => {
    const runner = state.game.runners[base];
    return runner?.teamKey === teamKey && runner.battingOrder === state.game.battingOrder;
  });
}

function getRunnerCurrentRank(state: AppState, source: RunnerSource) {
  if (source === "batter") {
    const currentBatterBase = getCurrentBatterBase(state);
    return currentBatterBase ? runnerProgressRank[currentBatterBase] : runnerProgressRank.batter;
  }

  if (!state.game.runners[source]) return null;
  return runnerProgressRank[source];
}

function canMoveRunnerForward(state: AppState, source: RunnerSource, destination: RunnerDestination) {
  const currentRank = getRunnerCurrentRank(state, source);
  if (currentRank === null) return false;
  return runnerProgressRank[destination] > currentRank;
}

export function isCurrentBatterPlateAppearanceComplete(state: AppState) {
  return Boolean(state.plate.result) || Boolean(getCurrentBatterBase(state));
}

export function shouldResetPlateAfterConfirm(state: AppState) {
  return isCurrentBatterPlateAppearanceComplete(state) || state.game.outs >= 3;
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

function placeRunnerOnBase(state: AppState, base: BaseKey, runner: RunnerState, reason: AdvanceReason, appendAdvanceNote = true) {
  const occupyingRunner = state.game.runners[base];
  if (occupyingRunner) advanceExistingRunnerInPlace(state, base, reason);
  state.game.runners[base] = appendAdvanceNote ? withAdvanceNote(runner, reason) : runner;
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
  placeRunnerOnBase(state, "first", getCurrentBatterRunner(state, reason), reason, reason !== "error");
  syncRunnerFirst(state);
}

export function advanceRunner(state: AppState, source: RunnerSource, reason: AdvanceReason): AppState {
  const next: AppState = structuredClone(state);
  next.game.firstPitchEntered = true;
  next.game.gameStarted = true;

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

function removeCurrentBatterFromBases(state: AppState) {
  const teamKey = getBattingTeamKey(state);
  for (const base of ["first", "second", "third"] as BaseKey[]) {
    const runner = state.game.runners[base];
    if (runner?.teamKey === teamKey && runner.battingOrder === state.game.battingOrder) {
      state.game.runners[base] = null;
      return runner;
    }
  }

  return null;
}

function removeRunnerFromSource(state: AppState, source: RunnerSource, batterReachReason?: AdvanceReason): RunnerState | null {
  if (source === "batter") return removeCurrentBatterFromBases(state) ?? getCurrentBatterRunner(state, batterReachReason);

  const runner = state.game.runners[source];
  state.game.runners[source] = null;
  return runner;
}

export function applyFieldOut(state: AppState, source: RunnerSource, resultLabel?: string): AppState {
  const next: AppState = structuredClone(state);
  next.game.firstPitchEntered = true;
  next.game.gameStarted = true;

  if (source === "batter") {
    removeCurrentBatterFromBases(next);
    next.plate.result = resultLabel || next.plate.result || "アウト";
    next.game.balls = 0;
    next.game.strikes = 0;
  } else {
    const runner = next.game.runners[source];
    if (runner) {
      next.game.runners[source] = null;
    }
  }

  next.game.outs = Math.min(3, next.game.outs + 1);
  if (source === "batter") next.plate.outNumber = next.game.outs;
  syncRunnerFirst(next);
  return next;
}

export function applyHomeRunnerOut(state: AppState, source: RunnerSource, resultLabel?: string): AppState {
  const next: AppState = structuredClone(state);
  next.game.firstPitchEntered = true;
  next.game.gameStarted = true;

  const battingTeamKey = getBattingTeamKey(next);
  if (battingTeamKey === "own") {
    next.game.ownScore = Math.max(0, next.game.ownScore - 1);
  } else {
    next.game.opponentScore = Math.max(0, next.game.opponentScore - 1);
  }

  if (source === "batter") {
    removeCurrentBatterFromBases(next);
    next.plate.result = resultLabel || next.plate.result || "\u30a2\u30a6\u30c8";
    next.game.balls = 0;
    next.game.strikes = 0;
  }

  next.game.outs = Math.min(3, next.game.outs + 1);
  if (source === "batter") next.plate.outNumber = next.game.outs;
  syncRunnerFirst(next);
  return next;
}

export function applyInitialFieldError(state: AppState): AppState {
  const next: AppState = structuredClone(state);
  next.game.firstPitchEntered = true;
  next.game.gameStarted = true;
  next.plate.result = "E";
  next.game.balls = 0;
  next.game.strikes = 0;
  next.game.hitType = "";

  const currentBatterBase = getCurrentBatterBase(next);
  if (currentBatterBase) {
    const runner = next.game.runners[currentBatterBase];
    if (runner) {
      next.game.runners[currentBatterBase] = {
        ...runner,
        scoreCard: {
          ...runner.scoreCard,
          result: "E",
          hitType: ""
        },
        scoreNotes: runner.scoreNotes.filter((note) => note !== advanceReasonLabels.hit && note !== advanceReasonLabels.error)
      };
    }
  } else {
    advanceBatterToFirstInPlace(next, "error");
  }

  syncRunnerFirst(next);
  return next;
}

export function applyHomeRun(state: AppState): AppState {
  const next: AppState = structuredClone(state);
  next.game.firstPitchEntered = true;
  next.game.gameStarted = true;
  next.game.hitType = "home-run";
  next.plate.result = "本";
  next.game.balls = 0;
  next.game.strikes = 0;
  const currentBatterBase = getCurrentBatterBase(next);

  const runnersToScore = (["third", "second", "first"] as BaseKey[])
    .map((base) => next.game.runners[base])
    .filter((runner): runner is RunnerState => Boolean(runner))
    .map((runner) =>
      runner.teamKey === getBattingTeamKey(next) && runner.battingOrder === next.game.battingOrder
        ? {
            ...runner,
            scoreCard: getCurrentBatterScoreCard(next, "hit")
          }
        : runner
    );

  next.game.runners = {
    first: null,
    second: null,
    third: null
  };

  runnersToScore.forEach((runner) => {
    scoreRunner(next, withAdvanceNote(runner, "hit"));
  });

  if (!currentBatterBase) {
    scoreRunner(next, getCurrentBatterRunner(next, "hit"));
  }
  syncRunnerFirst(next);
  return next;
}

export function moveRunnerToDestination(state: AppState, source: RunnerSource, destination: RunnerDestination, reason: AdvanceReason): AppState {
  if (!canMoveRunnerForward(state, source, destination)) return state;

  const next: AppState = structuredClone(state);
  const runner = removeRunnerFromSource(next, source, source === "batter" ? reason : undefined);
  if (!runner) return state;

  next.game.firstPitchEntered = true;
  next.game.gameStarted = true;
  if (destination === "home") {
    scoreRunner(next, withAdvanceNote(runner, reason));
  } else {
    placeRunnerOnBase(next, destination, runner, reason);
  }

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

  if (reason === "error" && source === "batter") {
    next.plate.result = "E";
    next.game.balls = 0;
    next.game.strikes = 0;
    next.game.hitType = "";
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
  const battingTeamKey = getBattingTeamKey(next);
  const plateCompleted = isCurrentBatterPlateAppearanceComplete(next);
  const inningEnded = next.game.outs >= 3;

  if (plateCompleted) {
    const currentTeamBattingOrder = getTeamBattingOrder(next, battingTeamKey);
    const nextBattingOrder = currentTeamBattingOrder >= 9 ? 1 : currentTeamBattingOrder + 1;
    setTeamBattingOrder(next, battingTeamKey, nextBattingOrder);
  }

  if (inningEnded) {
    next.game.outs = 0;
    next.game.runners = { first: null, second: null, third: null };
    next.game.half = next.game.half === "表" ? "裏" : "表";
    if (next.game.half === "表") next.game.inning += 1;
  }

  if (plateCompleted || inningEnded) {
    next.game.balls = 0;
    next.game.strikes = 0;
    next.game.hitType = "";
    next.game.firstPitchEntered = false;
    next.plate = {
      pitches: [],
      result: "",
      outNumber: 0
    };
  }

  syncActiveBattingOrder(next);
  const ownBatter = getCurrentOwnBatter(next);
  const opponentBatter = getCurrentOpponentBatter(next);
  next.game.currentBatterJerseyNumber = ownBatter?.jerseyNumber ?? "";
  next.game.currentOpponentBatterJerseyNumber = opponentBatter?.jerseyNumber ?? next.game.currentOpponentBatterJerseyNumber;
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
  next.game.gameStarted = true;

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
