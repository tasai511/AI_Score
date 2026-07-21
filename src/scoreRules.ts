import type { AdvanceReason, AppState, BaseKey, PitchType, RunnerDestination, RunnerSource, RunnerState, TeamKey } from "./types";

import type { ScoreCellMark, ScoreLogEntry } from "./types";

export const hitMarkAssets = {
  single: "assets/single.svg",
  "two-base": "assets/two-base.svg",
  "three-base": "assets/three-base.svg",
  "home-run": "assets/home-run.svg"
} as const;

export const outSymbols = ["", "I", "II", "III"];

export const fieldOutResultLabels: Record<number, string> = {
  1: "1",
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9"
};

export function formatBatterGroundOutResultLabel({
  destination,
  fieldingPosition,
  coveringPosition
}: {
  destination?: RunnerDestination;
  fieldingPosition?: string | number;
  coveringPosition?: string | number;
}) {
  const fielding = normalizeNumber(fieldingPosition);
  const covering = normalizeNumber(coveringPosition);
  if (!fielding || !fieldOutResultLabels[Number(fielding)]) return "";

  if (destination === "first") {
    if (fielding === "3" && (!covering || covering === "3")) return "3A";
    if (covering && covering !== fielding && covering !== "3") return `${fielding}-${covering}A`;
    return `${fielding}-3`;
  }

  return fieldOutResultLabels[Number(fielding)] ?? "";
}

export function getForceOutCoveringPosition(destination: RunnerDestination, fieldingPosition?: string | number) {
  const fielding = normalizeNumber(fieldingPosition);
  if (destination === "first") return "3";
  if (destination === "second") return fielding === "6" ? "4" : "6";
  if (destination === "third") return "5";
  return "2";
}

export function getRelayFieldingPosition(resultLabel?: string) {
  const normalizedResult = normalizeNumber(resultLabel);
  const relayMatch = normalizedResult.match(/^[1-9]-([1-9])$/);
  return relayMatch?.[1] ?? "";
}

export function formatFlyOutResultLabel(position?: string | number, isFoul = false) {
  const normalizedPosition = normalizeNumber(position);
  if (!fieldOutResultLabels[Number(normalizedPosition)]) return isFoul ? "F" : "";
  return `${isFoul ? "F" : ""}${normalizedPosition}`;
}

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
  "fielder-choice": "",
  hit: "安打"
};

const scoreAdvanceLabels: Record<AdvanceReason, string> = {
  error: "E",
  walk: "B",
  "dead-ball": "HP",
  "dropped-third-strike": "",
  "catcher-interference": "IF",
  steal: "S",
  "passed-ball": "P",
  balk: "BK",
  "runner-interference": "OB",
  "fielder-choice": "",
  hit: ""
};

export type ScoreCellPendingOut = {
  source: RunnerSource;
  destination?: RunnerDestination;
  runnerId?: string;
  resultLabel?: string;
  outNumber?: number;
  leftOnBase?: boolean;
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
  if (isFielderChoiceResult(result)) return "first";
  if (currentBatterBase && (result === "B" || result === "HP" || isErrorResult(result))) return currentBatterBase;
  if (currentBatterBase && !result) return currentBatterBase;
  return "result";
}

function isBatterGroundOutResult(result: string) {
  return /^[1-6]-3$/.test(result);
}

function isBatterCaughtOutResult(result: string) {
  return /^F?[1-9]$/.test(result);
}

function isBatterBaseStepOutResult(result: string) {
  return /^[1-9](?:-[1-9])?[ABC]$/.test(result);
}

function isBatterFieldOutResult(result: string) {
  return isBatterGroundOutResult(result) || isBatterCaughtOutResult(result) || isBatterBaseStepOutResult(result);
}

function isForceOutResult(result?: string) {
  return /^[1-9]-[1-9]$/.test(normalizeNumber(result));
}

function getFielderChoiceResult(result?: string) {
  const normalizedResult = normalizeNumber(result);
  const fieldingMatch = normalizedResult.match(/^([1-9])-[1-9](?: T\.O)?$/);
  return fieldingMatch ? `${fieldingMatch[1]}-` : "";
}

function isFielderChoiceResult(result: string) {
  return /^[1-9]-$/.test(result);
}

function isErrorResult(result: string) {
  return /^(?:[1-9](?:-[1-9])?A?)?E$/.test(result);
}

function isRedundantErrorAdvanceNote(reason: AdvanceReason, label: string, result: string) {
  return reason === "error" && label === "E" && isErrorResult(result);
}

function isDroppedThirdStrikeResult(result: string) {
  return result === advanceReasonLabels["dropped-third-strike"] || result === "K逃" || result === "K 2-3";
}

function isBatterTextOutResult(result: string) {
  return result === "K" || result === "アウト";
}

function isBatterOutResult(result: string) {
  return isBatterFieldOutResult(result) || isBatterTextOutResult(result);
}

function buildHiddenHitMarkSuppressor(): ScoreCellMark {
  // Keep hit assets hidden for an out preview without drawing a base path.
  return {
    kind: "advance",
    text: "",
    area: "pitch"
  };
}

function getScoreAdvanceLabel(advance: RunnerState["scoreAdvances"][number]) {
  return scoreAdvanceLabels[advance.reason];
}

function normalizeBatterOutResult(result: string) {
  if (result === "3-3") return "3A";
  if (result === "3-1") return "3-1A";
  return result;
}

function hasDroppedThirdStrikeAdvance(scoreAdvances: RunnerState["scoreAdvances"] = []) {
  return scoreAdvances.some((advance) => advance.reason === "dropped-third-strike");
}

function hasJapaneseScoreText(text: string) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function getScoreResultLabel(result: string) {
  if (isDroppedThirdStrikeResult(result) || result === "アウト" || result === "本") return "";
  if (result === advanceReasonLabels["catcher-interference"] || result === "CI") return scoreAdvanceLabels["catcher-interference"];
  if (hasJapaneseScoreText(result)) return "";
  return result;
}

function getPendingOutLabel(resultLabel?: string) {
  if (!resultLabel || resultLabel === "走死") return "T.O";
  if (resultLabel === "アウト") return "";
  return getScoreResultLabel(resultLabel) || (hasJapaneseScoreText(resultLabel) ? "" : resultLabel);
}

function getHitLocationText(runner: RunnerState, advance: RunnerState["scoreAdvances"][number]) {
  if (advance.reason !== "hit" || advance.destination !== "first") return "";
  const hitLocation = normalizeNumber(runner.scoreCard.hitLocation);
  const match = hitLocation.match(/^([1-9])\+?$/);
  return match ? match[1] : "";
}

function isHitLocationOverFielder(runner: RunnerState) {
  return /^[1-9]\+$/.test(normalizeNumber(runner.scoreCard.hitLocation));
}

function shouldDrawAdvancePath(advance: RunnerState["scoreAdvances"][number], blockedDestination?: RunnerDestination) {
  if (blockedDestination && advance.destination === blockedDestination) return false;
  return true;
}

export function buildCurrentScoreCellMarks(state: AppState, pendingOuts: ScoreCellPendingOut[] = []): ScoreCellMark[] {
  const currentBatterBase = getCurrentBatterBase(state);
  const currentBatterRunner = currentBatterBase ? state.game.runners[currentBatterBase] : null;
  const marks = buildPitchMarks(state.plate.pitches.length > 0 ? state.plate.pitches : currentBatterRunner?.scoreCard.pitches ?? []);
  const pendingBatterOutEntry = pendingOuts
    .map((fieldOut, index) => ({ fieldOut, index }))
    .find(({ fieldOut }) => fieldOut.source === "batter");
  const pendingRunnerOutEntry = pendingOuts.find((fieldOut) => fieldOut.source !== "batter" && getFielderChoiceResult(fieldOut.resultLabel));
  const previewOutNumber = pendingBatterOutEntry ? Math.min(3, state.game.outs + pendingBatterOutEntry.index + 1) : 0;
  const result = normalizeBatterOutResult(
    state.plate.result ||
      pendingBatterOutEntry?.fieldOut.resultLabel ||
      (currentBatterRunner ? getFielderChoiceResult(pendingRunnerOutEntry?.resultLabel) : "") ||
      currentBatterRunner?.scoreCard.result ||
      ""
  );
  const scoreAdvances = currentBatterRunner ? getRunnerScoreAdvances(currentBatterRunner) : [];
  const outNumber = state.plate.outNumber || previewOutNumber || currentBatterRunner?.scoreCard.outNumber || 0;
  const resultArea = getPlateResultArea(result, currentBatterBase, pendingBatterOutEntry?.fieldOut);
  const resultLabel = getScoreResultLabel(result);
  const currentBatterDroppedThirdStrike = isDroppedThirdStrikeResult(result) || hasDroppedThirdStrikeAdvance(scoreAdvances);
  const currentBatterIsOut = Boolean(pendingBatterOutEntry) || Boolean(outNumber > 0 && result && isBatterOutResult(result));
  const shouldSuppressCurrentBatterAdvances = currentBatterIsOut || currentBatterDroppedThirdStrike || isFielderChoiceResult(result);
  const currentBatterNote =
    !shouldSuppressCurrentBatterAdvances && !result && currentBatterRunner?.scoreNotes.length
      ? currentBatterRunner.scoreNotes[currentBatterRunner.scoreNotes.length - 1]
      : "";
  const currentBatterAdvanceNotes = new Set(
    (currentBatterRunner?.scoreAdvances ?? []).map((advance) => advanceReasonLabels[advance.reason]).filter(Boolean)
  );

  if (isBatterFieldOutResult(result)) {
    marks.push({
      kind: "fielderOut",
      text: result,
      area: "first"
    });
  } else if (currentBatterDroppedThirdStrike) {
    marks.push({
      kind: "fielderOut",
      text: "K 2-3",
      area: "first"
    });
  } else if (isBatterTextOutResult(result)) {
    if (resultLabel) {
      marks.push({
        kind: "fielderOut",
        text: resultLabel,
        area: "first"
      });
    }
  } else if (resultLabel) {
    marks.push({
      kind: "result",
      text: resultLabel,
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

  if (result === "本") {
    marks.push({
      kind: "score",
      text: "E",
      area: "center"
    });
    marks.push({
      kind: "note",
      text: getScoringBatterNumberText(state.game.battingOrder, true),
      area: "home"
    });
  } else if (state.plate.batterScored) {
    marks.push({
      kind: "score",
      text: "",
      area: "center"
    });
  }

  if (shouldSuppressCurrentBatterAdvances) {
    marks.push(buildHiddenHitMarkSuppressor());
  }

  if (currentBatterNote && currentBatterNote !== result && !currentBatterAdvanceNotes.has(currentBatterNote)) {
    marks.push({
      kind: "note",
      text: currentBatterNote,
      area: currentBatterBase || "result"
    });
  }

  if (currentBatterRunner && !shouldSuppressCurrentBatterAdvances) {
    scoreAdvances.forEach((advance) => {
      if (shouldDrawAdvancePath(advance)) {
        marks.push({
          kind: "advance",
          text: "",
          area: advance.destination,
          ...(advance.laterPlay ? { arrow: true, playGroup: advance.byBattingOrder } : {})
        });
      }

      const label = getScoreAdvanceLabel(advance);
      if (label && label !== result && label !== resultLabel && !isRedundantErrorAdvanceNote(advance.reason, label, result)) {
        marks.push({
          kind: "note",
          text: label,
          area: advance.destination
        });
      }

      const hitLocationText = getHitLocationText(currentBatterRunner, advance);
      if (hitLocationText) {
        marks.push({
          kind: "hitLocation",
          text: hitLocationText,
          over: isHitLocationOverFielder(currentBatterRunner)
        });
      }
    });
  }

  return marks;
}

export function buildRunnerScoreCellMarks(runner: RunnerState | null, pendingOut?: ScoreCellPendingOut | null, currentBase?: BaseKey | null): ScoreCellMark[] {
  if (!runner) return [];

  const marks = buildPitchMarks(runner.scoreCard.pitches);
  const outNumber = pendingOut?.outNumber ?? runner.scoreCard.outNumber;
  const noteArea = getRunnerDestinationArea(pendingOut?.destination) || currentBase || "result";
  const scoreAdvances = getRunnerScoreAdvances(runner);
  const result = normalizeBatterOutResult(runner.scoreCard.result);
  const resultLabel = getScoreResultLabel(result);
  const runnerDroppedThirdStrike = isDroppedThirdStrikeResult(result) || hasDroppedThirdStrikeAdvance(scoreAdvances);
  const blockedAdvanceDestination = pendingOut ? pendingOut.destination : undefined;

  if (isBatterFieldOutResult(result)) {
    marks.push({
      kind: "fielderOut",
      text: result,
      area: "first"
    });
  } else if (runnerDroppedThirdStrike) {
    marks.push({
      kind: "fielderOut",
      text: "K 2-3",
      area: "first"
    });
  } else if (isBatterTextOutResult(result)) {
    if (resultLabel) {
      marks.push({
        kind: "fielderOut",
        text: resultLabel,
        area: "first"
      });
    }
  } else if (resultLabel) {
    marks.push({
      kind: "result",
      text: resultLabel,
      area: isFielderChoiceResult(result) ? "first" : "result"
    });
  }

  if (outNumber > 0) {
    marks.push({
      kind: "out",
      text: outSymbols[outNumber] ?? "?",
      area: "center"
    });
  }

  if (!runnerDroppedThirdStrike) {
    scoreAdvances.forEach((advance) => {
      if (shouldDrawAdvancePath(advance, blockedAdvanceDestination)) {
        marks.push({
          kind: "advance",
          text: "",
          area: advance.destination,
          ...(advance.laterPlay ? { arrow: true, playGroup: advance.byBattingOrder } : {})
        });
      }

      const label = getScoreAdvanceLabel(advance);
      if (label && label !== result && label !== resultLabel && !isRedundantErrorAdvanceNote(advance.reason, label, result)) {
        marks.push({
          kind: "note",
          text: label,
          area: advance.destination
        });
      }

      const hitLocationText = getHitLocationText(runner, advance);
      if (hitLocationText) {
        marks.push({
          kind: "hitLocation",
          text: hitLocationText,
          over: isHitLocationOverFielder(runner)
        });
      }
    });

    appendLaterAdvanceOriginNotes(marks, scoreAdvances);
  }

  if (pendingOut && !pendingOut.leftOnBase) {
    const pendingOutLabel = getPendingOutLabel(pendingOut.resultLabel);
    if (pendingOutLabel) {
      marks.push({
        kind: "fielderOut",
        text: pendingOutLabel,
        area: noteArea
      });
    }
  }

  if (pendingOut?.leftOnBase) {
    marks.push({
      kind: "note",
      text: "l",
      area: "center"
    });
  }

  return marks;
}

export function buildScoreLogEntry(state: AppState, pendingOuts: ScoreCellPendingOut[] = []): ScoreLogEntry {
  const batter = getCurrentBatter(state);
  return {
    teamKey: getBattingTeamKey(state),
    battingOrder: state.game.battingOrder,
    inning: state.game.inning,
    marks: buildCurrentScoreCellMarks(state, pendingOuts),
    hitType: state.game.hitType,
    showInningEndSlash: shouldShowScorebookInningEndSlash(state, pendingOuts),
    jerseyNumber: normalizeNumber(batter?.jerseyNumber),
    playerName: normalizeNumber(batter?.name),
    positionNumber: normalizeNumber(batter?.positionNumber),
    batterBox: batter?.batterBox ?? "right"
  };
}

function getRunnerScoreAdvances(runner: RunnerState) {
  if (runner.scoreAdvances?.length) return runner.scoreAdvances;

  const hitDestinationsByType: Record<string, RunnerDestination[]> = {
    single: ["first"],
    "two-base": ["first", "second"],
    "three-base": ["first", "second", "third"],
    "home-run": ["first", "second", "third", "home"]
  };

  return (hitDestinationsByType[runner.scoreCard.hitType] ?? []).map(
    (destination): RunnerState["scoreAdvances"][number] => ({
      destination,
      reason: "hit"
    })
  );
}

function appendLaterAdvanceOriginNotes(marks: ScoreCellMark[], scoreAdvances: RunnerState["scoreAdvances"]) {
  const furthestByOrder = new Map<number, RunnerDestination>();
  scoreAdvances.forEach((advance) => {
    if (!advance.laterPlay || advance.byBattingOrder === undefined) return;
    const current = furthestByOrder.get(advance.byBattingOrder);
    if (!current || runnerProgressRank[advance.destination] > runnerProgressRank[current]) {
      furthestByOrder.set(advance.byBattingOrder, advance.destination);
    }
  });
  furthestByOrder.forEach((destination, battingOrder) => {
    if (destination === "home") return;
    marks.push({ kind: "note", text: `(${battingOrder})`, area: destination });
  });
}

const rbiAdvanceReasons = new Set<AdvanceReason>(["hit", "walk", "dead-ball", "catcher-interference", "fielder-choice"]);

function isCurrentBatterRunner(state: AppState, runner: RunnerState) {
  return runner.teamKey === getBattingTeamKey(state) && runner.battingOrder === state.game.battingOrder;
}

function getScoringBatterNumberText(battingOrder: number, rbi: boolean) {
  if (rbi && battingOrder >= 1 && battingOrder <= 20) return String.fromCharCode(0x2460 + battingOrder - 1);
  return String(battingOrder);
}

function updateRunnerScoreLogEntryInPlace(
  state: AppState,
  runner: RunnerState,
  pendingOut: ScoreCellPendingOut | null = null,
  currentBase: BaseKey | null = null,
  extraMarks: ScoreCellMark[] = []
) {
  // The current batter's own plate appearance is logged at confirm time, not here.
  if (isCurrentBatterRunner(state, runner)) return;

  for (let index = state.scoreLog.length - 1; index >= 0; index -= 1) {
    const entry = state.scoreLog[index];
    if (entry.teamKey !== runner.teamKey || entry.battingOrder !== runner.battingOrder) continue;
    state.scoreLog = [
      ...state.scoreLog.slice(0, index),
      {
        ...entry,
        marks: [...buildRunnerScoreCellMarks(runner, pendingOut, currentBase), ...extraMarks],
        hitType: runner.scoreCard.hitType
      },
      ...state.scoreLog.slice(index + 1)
    ];
    return;
  }
}

function refreshOnBaseRunnersScoreLogInPlace(state: AppState) {
  (["first", "second", "third"] as BaseKey[]).forEach((base) => {
    const runner = state.game.runners[base];
    if (runner) updateRunnerScoreLogEntryInPlace(state, runner, null, base);
  });
}

export function refreshScoreLogWithRunners(state: AppState): AppState {
  const next = { ...state, scoreLog: [...state.scoreLog] };
  const inningEnded = next.game.outs >= 3;
  (["first", "second", "third"] as BaseKey[]).forEach((base) => {
    const runner = next.game.runners[base];
    if (!runner) return;
    updateRunnerScoreLogEntryInPlace(next, runner, inningEnded ? { source: base, leftOnBase: true } : null, base);
  });
  return next;
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

const runnerDestinationOrder: RunnerDestination[] = ["first", "second", "third", "home"];

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
  if (reachReason === "dead-ball") return "HP";
  if (reachReason === "dropped-third-strike") return advanceReasonLabels["dropped-third-strike"];
  if (reachReason === "catcher-interference") return advanceReasonLabels["catcher-interference"];
  if (reachReason === "error") return "E";
  return "";
}

function getCurrentBatterScoreCard(state: AppState, reachReason?: AdvanceReason, hitLocation?: string) {
  const normalizedHitLocation = reachReason === "hit" ? normalizeNumber(hitLocation) : "";
  return {
    pitches: [...state.plate.pitches],
    result: getBatterScoreCardResult(state, reachReason),
    outNumber: state.plate.outNumber,
    hitType: reachReason === "hit" ? state.game.hitType : "",
    ...(normalizedHitLocation ? { hitLocation: normalizedHitLocation } : {})
  };
}

export function getCurrentBatterRunner(state: AppState, reachReason?: AdvanceReason, hitLocation?: string): RunnerState {
  const batter = getCurrentBatter(state);
  return {
    id: getRunnerId(state, batter ?? {}),
    teamKey: getBattingTeamKey(state),
    battingOrder: state.game.battingOrder,
    jerseyNumber: normalizeNumber(batter?.jerseyNumber),
    name: normalizeNumber(batter?.name),
    scoreCard: getCurrentBatterScoreCard(state, reachReason, hitLocation),
    scoreAdvances: [],
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

export function shouldShowScorebookInningEndSlash(state: AppState, pendingOuts: ScoreCellPendingOut[] = []) {
  if (state.plate.outNumber === 3) return true;

  return pendingOuts.some((fieldOut, index) => {
    const outNumber = Math.min(3, state.game.outs + index + 1);
    if (outNumber !== 3) return false;
    return fieldOut.source === "batter" || !isCurrentBatterPlateAppearanceComplete(state);
  });
}

export function shouldResetPlateAfterConfirm(state: AppState) {
  return isCurrentBatterPlateAppearanceComplete(state) || state.game.outs >= 3;
}

function withAdvanceNote(state: AppState, runner: RunnerState, reason: AdvanceReason, destination: RunnerDestination): RunnerState {
  const label = advanceReasonLabels[reason];
  const laterPlay = !isCurrentBatterRunner(state, runner);
  const scoreAdvances = runner.scoreAdvances ?? [];
  const existingDestinations = new Set(scoreAdvances.map((advance) => advance.destination));
  const nextAdvances = runnerDestinationOrder
    .filter((nextDestination) => runnerProgressRank[nextDestination] <= runnerProgressRank[destination] && !existingDestinations.has(nextDestination))
    .map((nextDestination) => ({
      destination: nextDestination,
      reason,
      ...(laterPlay ? { laterPlay: true, byBattingOrder: state.game.battingOrder } : {})
    }));
  return {
    ...runner,
    scoreAdvances: [...scoreAdvances, ...nextAdvances],
    scoreNotes: !label || runner.scoreNotes.includes(label) ? runner.scoreNotes : [...runner.scoreNotes, label]
  };
}

function scoreRunner(state: AppState, runner: RunnerState) {
  if (runner.teamKey === "own") {
    state.game.ownScore += 1;
  } else {
    state.game.opponentScore += 1;
  }

  if (isCurrentBatterRunner(state, runner)) {
    // The batter's own cell is built at confirm; flag the run so it gets a score mark there.
    state.plate.batterScored = true;
    return;
  }

  const lastAdvance = runner.scoreAdvances?.[runner.scoreAdvances.length - 1];
  const rbi = lastAdvance ? rbiAdvanceReasons.has(lastAdvance.reason) : false;
  const unearned =
    isErrorResult(normalizeNumber(runner.scoreCard.result)) ||
    (runner.scoreAdvances ?? []).some((advance) => advance.reason === "error" || advance.reason === "passed-ball");
  updateRunnerScoreLogEntryInPlace(state, runner, null, null, [
    { kind: "score", text: unearned ? "" : "E", area: "center" },
    { kind: "note", text: getScoringBatterNumberText(state.game.battingOrder, rbi), area: "home" }
  ]);
}

export function recountScoresFromLog(scoreLog: ScoreLogEntry[]) {
  // A paper-scorebook recount: one run per cell showing a run mark, latest entry per
  // (team, batting order, inning) wins — mirrors how the output grid resolves cells.
  const latest = new Map<string, ScoreLogEntry>();
  scoreLog.forEach((entry) => latest.set(`${entry.teamKey}-${entry.battingOrder}-${entry.inning}`, entry));

  let own = 0;
  let opponent = 0;
  latest.forEach((entry) => {
    if (!entry.marks.some((mark) => mark.kind === "score")) return;
    if (entry.teamKey === "own") own += 1;
    else opponent += 1;
  });
  return { own, opponent };
}

function placeRunnerOnBase(state: AppState, base: BaseKey, runner: RunnerState, reason: AdvanceReason, appendAdvanceNote = true) {
  const occupyingRunner = state.game.runners[base];
  if (occupyingRunner) advanceExistingRunnerInPlace(state, base, reason);
  state.game.runners[base] = appendAdvanceNote ? withAdvanceNote(state, runner, reason, base) : runner;
}

function advanceExistingRunnerInPlace(state: AppState, source: BaseKey, reason: AdvanceReason) {
  const runner = state.game.runners[source];
  if (!runner) return;

  state.game.runners[source] = null;
  const destination = nextBaseMap[source];
  if (destination === "home") {
    scoreRunner(state, withAdvanceNote(state, runner, reason, "home"));
  } else {
    placeRunnerOnBase(state, destination, runner, reason);
  }
}

function advanceBatterToFirstInPlace(state: AppState, reason: AdvanceReason, hitLocation?: string) {
  placeRunnerOnBase(state, "first", getCurrentBatterRunner(state, reason, hitLocation), reason);
  syncRunnerFirst(state);
}

export function advanceRunner(state: AppState, source: RunnerSource, reason: AdvanceReason, hitLocation?: string): AppState {
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
    advanceBatterToFirstInPlace(next, reason, hitLocation);
  } else {
    advanceExistingRunnerInPlace(next, source, reason);
  }

  refreshOnBaseRunnersScoreLogInPlace(next);
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

function removeRunnerFromSource(state: AppState, source: RunnerSource, batterReachReason?: AdvanceReason, hitLocation?: string): RunnerState | null {
  if (source === "batter") return removeCurrentBatterFromBases(state) ?? getCurrentBatterRunner(state, batterReachReason, hitLocation);

  const runner = state.game.runners[source];
  state.game.runners[source] = null;
  return runner;
}

function markCurrentBatterReachedOnFieldersChoice(state: AppState, resultLabel?: string) {
  const result = getFielderChoiceResult(resultLabel);
  if (!result) return;

  const currentBatterBase = getCurrentBatterBase(state);
  if (!currentBatterBase) return;

  const runner = state.game.runners[currentBatterBase];
  if (!runner) return;

  state.game.runners[currentBatterBase] = {
    ...runner,
    scoreCard: {
      ...runner.scoreCard,
      result,
      hitType: "",
      hitLocation: undefined
    },
    scoreAdvances: [{ destination: currentBatterBase, reason: "fielder-choice" }],
    scoreNotes: runner.scoreNotes.filter((note) => note !== advanceReasonLabels.hit)
  };
  state.game.hitType = "";
}

export function applyFieldOut(state: AppState, source: RunnerSource, resultLabel?: string, destination?: RunnerDestination): AppState {
  const next: AppState = structuredClone(state);
  next.game.firstPitchEntered = true;
  next.game.gameStarted = true;

  if (source === "batter") {
    removeCurrentBatterFromBases(next);
    next.plate.result = normalizeBatterOutResult(resultLabel || next.plate.result || "アウト");
    next.game.hitType = "";
    next.game.balls = 0;
    next.game.strikes = 0;
  } else {
    const runner = next.game.runners[source];
    if (runner) {
      updateRunnerScoreLogEntryInPlace(
        next,
        runner,
        { source, destination: destination ?? nextBaseMap[source], resultLabel, outNumber: Math.min(3, next.game.outs + 1) },
        source
      );
      next.game.runners[source] = null;
    }
    markCurrentBatterReachedOnFieldersChoice(next, resultLabel);
  }

  next.game.outs = Math.min(3, next.game.outs + 1);
  if (source === "batter") next.plate.outNumber = next.game.outs;
  refreshOnBaseRunnersScoreLogInPlace(next);
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
    next.plate.result = normalizeBatterOutResult(resultLabel || next.plate.result || "\u30a2\u30a6\u30c8");
    next.game.hitType = "";
    next.game.balls = 0;
    next.game.strikes = 0;
  }

  next.game.outs = Math.min(3, next.game.outs + 1);
  if (source === "batter") next.plate.outNumber = next.game.outs;
  syncRunnerFirst(next);
  return next;
}

export function applyInitialFieldError(state: AppState, fieldingPosition?: string | number): AppState {
  const next: AppState = structuredClone(state);
  next.game.firstPitchEntered = true;
  next.game.gameStarted = true;
  const normalizedFieldingPosition = normalizeNumber(fieldingPosition);
  const errorResult = /^[1-9]$/.test(normalizedFieldingPosition) ? `${normalizedFieldingPosition}E` : "E";
  next.plate.result = errorResult;
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
          result: errorResult,
          hitType: "",
          hitLocation: undefined
        },
        scoreAdvances: [{ destination: currentBatterBase, reason: "error" }],
        scoreNotes: runner.scoreNotes.filter((note) => note !== advanceReasonLabels.hit && note !== advanceReasonLabels.error)
      };
    }
  } else {
    advanceBatterToFirstInPlace(next, "error");
    if (next.game.runners.first) {
      next.game.runners.first = {
        ...next.game.runners.first,
        scoreCard: { ...next.game.runners.first.scoreCard, result: errorResult }
      };
    }
  }

  refreshOnBaseRunnersScoreLogInPlace(next);
  syncRunnerFirst(next);
  return next;
}

export function applyThrowError(state: AppState, resultLabel: string): AppState {
  const next: AppState = structuredClone(state);
  next.game.firstPitchEntered = true;
  next.game.gameStarted = true;
  next.plate.result = resultLabel;
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
          result: resultLabel,
          hitType: "",
          hitLocation: undefined
        },
        scoreAdvances: [{ destination: currentBatterBase, reason: "error" }],
        scoreNotes: runner.scoreNotes.filter((note) => note !== advanceReasonLabels.hit && note !== advanceReasonLabels.error)
      };
    }
  }

  refreshOnBaseRunnersScoreLogInPlace(next);
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
            scoreCard: getCurrentBatterScoreCard(next, "hit", runner.scoreCard.hitLocation)
          }
        : runner
    );

  next.game.runners = {
    first: null,
    second: null,
    third: null
  };

  runnersToScore.forEach((runner) => {
    scoreRunner(next, withAdvanceNote(next, runner, "hit", "home"));
  });

  if (!currentBatterBase) {
    scoreRunner(next, getCurrentBatterRunner(next, "hit"));
  }
  syncRunnerFirst(next);
  return next;
}

export function moveRunnerToDestination(
  state: AppState,
  source: RunnerSource,
  destination: RunnerDestination,
  reason: AdvanceReason,
  hitLocation?: string,
  resultLabel?: string
): AppState {
  if (!canMoveRunnerForward(state, source, destination)) return state;

  const next: AppState = structuredClone(state);
  const runner = removeRunnerFromSource(next, source, source === "batter" ? reason : undefined, hitLocation);
  if (!runner) return state;

  next.game.firstPitchEntered = true;
  next.game.gameStarted = true;
  if (destination === "home") {
    scoreRunner(next, withAdvanceNote(next, runner, reason, "home"));
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
    const errorResult = resultLabel || "E";
    next.plate.result = errorResult;
    next.game.balls = 0;
    next.game.strikes = 0;
    next.game.hitType = "";
    if (destination !== "home") {
      const placedRunner = next.game.runners[destination];
      if (placedRunner) {
        next.game.runners[destination] = {
          ...placedRunner,
          scoreCard: { ...placedRunner.scoreCard, result: errorResult }
        };
      }
    }
  }

  refreshOnBaseRunnersScoreLogInPlace(next);
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
    next.game.hitType = "";
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
    finish("HP");
  }

  syncRunnerFirst(next);
  return next;
}
