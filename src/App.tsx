import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, KeyboardEvent, MouseEvent, PointerEvent, SetStateAction } from "react";
import type {
  AdvanceReason,
  AppState,
  BaseKey,
  BaseRunners,
  BatterBox,
  PitchType,
  Player,
  HitType,
  RunnerDestination,
  RunnerSource,
  RunnerState,
  ScoreCellMark,
  ScoreLogEntry,
  TabKey,
  TeamKey
} from "./types";
import { initialState } from "./data";
import type { GameSummary, StateSnapshot } from "./persistence";
import { buildGameSummary, createNewGameId, deleteGame, loadGame, loadGameIndex, saveGame, stripScoreLog } from "./persistence";
import {
  advanceReasonLabels,
  advanceRunner,
  applyFieldOut,
  applyHomeRun,
  applyHomeRunnerOut,
  applyInitialFieldError,
  applyThrowError,
  applyPitch,
  buildCurrentScoreCellMarks,
  buildRunnerScoreCellMarks,
  buildScoreLogEntry,
  canUseDroppedThirdStrike,
  confirmPlateAppearance,
  fieldOutResultLabels,
  formatBatterGroundOutResultLabel,
  formatFlyOutResultLabel,
  formatJerseyNumber,
  formatPlayerLabel,
  getBattingTeamKey,
  getCurrentBatter,
  getCurrentBattingIndex,
  getCurrentOpponentBatter,
  getCurrentOwnBatter,
  getDuplicateValues,
  getForceOutCoveringPosition,
  getRelayFieldingPosition,
  isCurrentBatterPlateAppearanceComplete,
  isOwnBattingNow,
  moveRunnerToDestination,
  normalizeNumber,
  shouldShowScorebookInningEndSlash
} from "./scoreRules";

type DialogMode = "batter" | "pitcher" | null;
type PendingFieldOut = {
  nodeId: string;
  source: RunnerSource;
  destination?: RunnerDestination;
  runnerId?: string;
  resultLabel?: string;
};
type PitchAdvanceType = Extract<PitchType, "ball" | "dead">;
type PendingPitchContext = "live-count" | "dead-ball" | null;
type PitchInputOrigin = "button" | "field-foul";
type PitchAdvanceRequest = {
  id: number;
  type: PitchAdvanceType;
};

const FIELD_IMAGE_WIDTH = 1254;
const FIELD_IMAGE_HEIGHT = 1254;

const FIELD_IMAGE_POINTS = {
  "base-first": { x: 913.03, y: 657.66 },
  "base-second": { x: 626.48, y: 370.22 },
  "base-third": { x: 340.97, y: 657.66 },
  "base-home": { x: 626.39, y: 966.2 },
  "foul-zone-left": { x: 274, y: 812 },
  "foul-zone-right": { x: 980, y: 812 },
  "position-1": { x: 627, y: 680 },
  "position-2": { x: 627, y: 1054 },
  "position-3": { x: 824.9, y: 598 },
  "position-4": { x: 760.24, y: 420 },
  "position-5": { x: 429.1, y: 598 },
  "position-6": { x: 493.76, y: 420 },
  "position-7": { x: 258.64, y: 287.38 },
  "position-8": { x: 627, y: 204.65 },
  "position-9": { x: 995.36, y: 287.38 },
  "position-7-over": { x: 258.64, y: 169.81 },
  "position-8-over": { x: 627, y: 87.08 },
  "position-9-over": { x: 995.36, y: 169.81 },
  "runner-slot-first": { x: 1004, y: 708 },
  "runner-slot-second": { x: 676, y: 314 },
  "runner-slot-third": { x: 250, y: 708 },
  "batter-box-left": { x: 682.85, y: 920 },
  "batter-box-right": { x: 571.47, y: 920 }
} as const;

const RUNNER_RED_ASSET = "assets/runner-red-outline.png?v=20260618-2";
const RUNNER_BLUE_ASSET = "assets/runner-blue-outline.png?v=20260618-2";
const RUNNER_PROGRESS_RANK: Record<RunnerSource | RunnerDestination, number> = {
  batter: 0,
  first: 1,
  second: 2,
  third: 3,
  home: 4
};

function ScoreMarkIcon({ type, className = "" }: { type: "strike" | "ball" | "foul" | "dead"; className?: string }) {
  if (type === "strike") {
    return (
      <svg className={`pitch-mark-icon stroke-mark ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6 L18 18" />
        <path d="M18 6 L6 18" />
      </svg>
    );
  }

  if (type === "ball") {
    return (
      <svg className={`pitch-mark-icon fill-mark ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="6.6" />
      </svg>
    );
  }

  if (type === "foul") {
    return (
      <svg className={`pitch-mark-icon stroke-mark ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5 L19 18 H5 Z" />
      </svg>
    );
  }

  return (
    <svg className={`pitch-mark-icon text-mark dead-mark ${className}`.trim()} viewBox="0 0 28 20" aria-hidden="true">
      <text x="14" y="10.5">
        DB
      </text>
    </svg>
  );
}

function moveRow<T>(rows: T[], fromIndex: number, toIndex: number) {
  const next = [...rows];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function hexToRgbChannels(hex: string) {
  const normalized = hex.trim().replace("#", "");
  if (normalized.length !== 6) return "0 0 0";

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);

  if ([r, g, b].some((value) => Number.isNaN(value))) return "0 0 0";
  return `${r} ${g} ${b}`;
}

function getBroadcastTeamName(name: string) {
  const normalizedName = name.trim();
  if (!normalizedName) return "";
  if (normalizedName === "\u76f8\u624b\u30c1\u30fc\u30e0" || normalizedName === "\u672a\u8a2d\u5b9a") return normalizedName;
  if (normalizedName.includes(" ")) {
    const parts = normalizedName.split(/\s+/);
    return parts[parts.length - 1] ?? normalizedName;
  }

  const suffixes = [
    "ドリーム",
    "スターズ",
    "クラブ",
    "ファイターズ",
    "ジャイアンツ",
    "イーグルス",
    "タイガース",
    "ベアーズ",
    "ホークス",
    "Dream",
    "Stars",
    "Club",
    "Fighters",
    "Giants",
    "Eagles",
    "Tigers",
    "Bears",
    "Hawks"
  ];
  const suffix = suffixes.find((teamSuffix) => normalizedName.endsWith(teamSuffix));
  if (suffix) return suffix;

  const japanesePrefix = normalizedName.match(/^[\u3400-\u9fff々〆ヶ]+(.+)$/u);
  return japanesePrefix?.[1] || normalizedName;
}

function getOpponentName(state: AppState) {
  return state.opponentTeam.name || "\u76f8\u624b\u30c1\u30fc\u30e0";
}

export function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [gameIndex, setGameIndex] = useState<GameSummary[]>(() => loadGameIndex());
  const [preAtBatSnapshots, setPreAtBatSnapshots] = useState<StateSnapshot[]>([]);
  const preAtBatSnapshotRef = useRef<StateSnapshot>(stripScoreLog(initialState));
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("score");
  const [outputTeamKey, setOutputTeamKey] = useState<TeamKey>("own");
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [forceRegistration, setForceRegistration] = useState(false);
  const [dragging, setDragging] = useState<{ teamKey: TeamKey; rowId: string } | null>(null);
  const [fieldSelection, setFieldSelection] = useState<string | null>(null);
  const [needsPlateConfirm, setNeedsPlateConfirm] = useState(false);
  const [fieldResetToken, setFieldResetToken] = useState(0);
  const [pendingFieldOuts, setPendingFieldOuts] = useState<PendingFieldOut[]>([]);
  const [pitchAdvanceRequest, setPitchAdvanceRequest] = useState<PitchAdvanceRequest | null>(null);
  const [pendingPitchContext, setPendingPitchContext] = useState<PendingPitchContext>(null);
  const [liveScorePreviewActive, setLiveScorePreviewActive] = useState(false);
  const [plateActionsLocked, setPlateActionsLocked] = useState(false);
  const inputSnapshotRef = useRef<AppState | null>(null);

  useEffect(() => {
    if (!currentGameId) return;
    saveGame(currentGameId, { state, preAtBatSnapshots, currentAtBatStartSnapshot: preAtBatSnapshotRef.current });
    setGameIndex(loadGameIndex());
  }, [state, preAtBatSnapshots, currentGameId]);

  function handleStartNewGame() {
    const id = createNewGameId();
    const freshState = structuredClone(initialState);
    setState(freshState);
    setPreAtBatSnapshots([]);
    preAtBatSnapshotRef.current = stripScoreLog(freshState);
    setActiveTab("order");
    setCurrentGameId(id);
  }

  function handleResumeGame(id: string) {
    const record = loadGame(id);
    if (!record) return;
    setState(record.state);
    setPreAtBatSnapshots(record.preAtBatSnapshots);
    preAtBatSnapshotRef.current = record.currentAtBatStartSnapshot;
    setActiveTab("score");
    setCurrentGameId(id);
  }

  function handleDeleteGame(id: string) {
    deleteGame(id);
    setGameIndex(loadGameIndex());
  }

  function handleReturnToTitle() {
    setCurrentGameId(null);
    setGameIndex(loadGameIndex());
  }

  function requestConfirm(message: string, onConfirm: () => void) {
    setConfirmDialog({ message, onConfirm });
  }

  function handleRedoAtBat(index: number) {
    const snapshot = preAtBatSnapshots[index];
    if (!snapshot) return;
    const restoredState: AppState = { ...structuredClone(snapshot), scoreLog: state.scoreLog.slice(0, index) };
    setState(restoredState);
    setPreAtBatSnapshots((current) => current.slice(0, index));
    preAtBatSnapshotRef.current = structuredClone(snapshot);
    inputSnapshotRef.current = null;
    setPendingFieldOuts([]);
    setPitchAdvanceRequest(null);
    setPendingPitchContext(null);
    setLiveScorePreviewActive(false);
    setPlateActionsLocked(false);
    setNeedsPlateConfirm(false);
    setFieldSelection(null);
    setFieldResetToken((token) => token + 1);
    setActiveTab("score");
  }

  const ownBatting = isOwnBattingNow(state);
  const battingTeamKey = getBattingTeamKey(state);
  const currentBatter = getCurrentBatter(state);
  const currentOwnBatter = getCurrentOwnBatter(state);
  const currentOpponentBatter = getCurrentOpponentBatter(state);
  const scoreDisplayState = needsPlateConfirm && inputSnapshotRef.current ? inputSnapshotRef.current : state;
  const scoreBoardState = liveScorePreviewActive ? state : scoreDisplayState;
  const runnerScoreBaseState = inputSnapshotRef.current ?? state;
  const currentPitcher =
    state.ownOrder.find((player) => player.jerseyNumber === state.game.currentPitcherJerseyNumber) ??
    state.ownOrder.find((player) => player.positionNumber === "1");
  const opponentPitcher =
    state.opponentOrder.find((player) => player.jerseyNumber === state.game.currentOpponentPitcherJerseyNumber) ??
    state.opponentOrder.find((player) => player.positionNumber === "1");

  useEffect(() => {
    document.documentElement.style.setProperty("--own-team-color", state.ownTeam.colorHex);
    document.documentElement.style.setProperty("--own-team-color-rgb", hexToRgbChannels(state.ownTeam.colorHex));
    document.documentElement.style.setProperty("--opponent-team-color", state.opponentTeam.colorHex);
    document.documentElement.style.setProperty("--opponent-team-color-rgb", hexToRgbChannels(state.opponentTeam.colorHex));
  }, [state.ownTeam.colorHex, state.opponentTeam.colorHex]);

  useEffect(() => {
    const orientation = window.screen?.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
    if (!orientation?.lock) return;

    const lockPortrait = () => {
      void orientation.lock?.("portrait")?.catch(() => undefined);
    };

    lockPortrait();
    window.addEventListener("orientationchange", lockPortrait);
    return () => {
      window.removeEventListener("orientationchange", lockPortrait);
    };
  }, []);

  useEffect(() => {
    let lastTouchEnd = 0;
    const preventDefault = (event: Event) => event.preventDefault();
    const preventMultiTouchZoom = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };
    const preventDoubleTapZoom = (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd < 320) event.preventDefault();
      lastTouchEnd = now;
    };
    const preventZoomWheel = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };

    document.addEventListener("gesturestart", preventDefault as EventListener, { passive: false });
    document.addEventListener("gesturechange", preventDefault as EventListener, { passive: false });
    document.addEventListener("gestureend", preventDefault as EventListener, { passive: false });
    document.addEventListener("touchstart", preventMultiTouchZoom, { passive: false });
    document.addEventListener("touchmove", preventMultiTouchZoom, { passive: false });
    document.addEventListener("touchend", preventDoubleTapZoom, { passive: false });
    window.addEventListener("wheel", preventZoomWheel, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", preventDefault as EventListener);
      document.removeEventListener("gesturechange", preventDefault as EventListener);
      document.removeEventListener("gestureend", preventDefault as EventListener);
      document.removeEventListener("touchstart", preventMultiTouchZoom);
      document.removeEventListener("touchmove", preventMultiTouchZoom);
      document.removeEventListener("touchend", preventDoubleTapZoom);
      window.removeEventListener("wheel", preventZoomWheel);
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "score") return;

    const scrollPosition = { x: window.scrollX, y: window.scrollY };
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousHtmlOverscrollBehavior = html.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPosition = body.style.position;
    const previousBodyInset = body.style.inset;
    const previousBodyTop = body.style.top;
    const previousBodyLeft = body.style.left;
    const previousBodyWidth = body.style.width;
    const previousBodyHeight = body.style.height;

    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.inset = "0";
    body.style.top = `-${scrollPosition.y}px`;
    body.style.left = "0";
    body.style.width = "100%";
    body.style.height = "100%";

    return () => {
      html.style.overflow = previousHtmlOverflow;
      html.style.overscrollBehavior = previousHtmlOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
      body.style.position = previousBodyPosition;
      body.style.inset = previousBodyInset;
      body.style.top = previousBodyTop;
      body.style.left = previousBodyLeft;
      body.style.width = previousBodyWidth;
      body.style.height = previousBodyHeight;
      window.scrollTo(scrollPosition.x, scrollPosition.y);
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "score") return;
    if (normalizeNumber(currentBatter?.jerseyNumber)) return;

    const key = getCurrentBatterPromptKey(state);
    if (state.promptedBatterKeys.includes(key)) return;

    setState((current) => ({
      ...current,
      promptedBatterKeys: [...current.promptedBatterKeys, key]
    }));
    setForceRegistration(true);
    setDialogMode("batter");
  }, [activeTab, battingTeamKey, currentBatter?.jerseyNumber, state.game.battingOrder, state.game.half, state.game.inning, state.promptedBatterKeys]);

  useEffect(() => {
    if (state.plate.result) setNeedsPlateConfirm(true);
  }, [state.plate.result]);

  const ownPositionDuplicates = useMemo(() => getDuplicateValues(state.ownOrder, "positionNumber"), [state.ownOrder]);
  const opponentPositionDuplicates = useMemo(() => getDuplicateValues(state.opponentOrder, "positionNumber"), [state.opponentOrder]);

  function getCurrentBatterPromptKey(current: AppState) {
    return `${getBattingTeamKey(current)}-${current.game.inning}-${current.game.half}-${current.game.battingOrder}`;
  }

  function captureInputSnapshot(current: AppState) {
    if (!inputSnapshotRef.current) inputSnapshotRef.current = structuredClone(current);
  }

  function updateTeamOrder(teamKey: TeamKey, updater: (rows: Player[]) => Player[]) {
    setState((current) => {
      const nextRows = updater(teamKey === "own" ? current.ownOrder : current.opponentOrder);
      const next = {
        ...current,
        ownOrder: teamKey === "own" ? nextRows : current.ownOrder,
        opponentOrder: teamKey === "opponent" ? nextRows : current.opponentOrder
      };

      const ownBatter = getCurrentOwnBatter(next);
      const opponentBatter = getCurrentOpponentBatter(next);
      const ownPitcherJerseyNumber = normalizeNumber(next.ownOrder.find((player) => player.positionNumber === "1")?.jerseyNumber);
      const opponentPitcherJerseyNumber = normalizeNumber(next.opponentOrder.find((player) => player.positionNumber === "1")?.jerseyNumber);
      return {
        ...next,
        game: {
          ...next.game,
          currentBatterJerseyNumber: ownBatter?.jerseyNumber ?? "",
          currentOpponentBatterJerseyNumber: opponentBatter?.jerseyNumber ?? next.game.currentOpponentBatterJerseyNumber,
          currentPitcherJerseyNumber: ownPitcherJerseyNumber || next.game.currentPitcherJerseyNumber,
          currentOpponentPitcherJerseyNumber: opponentPitcherJerseyNumber || next.game.currentOpponentPitcherJerseyNumber
        }
      };
    });
  }

  function updateOrderValue(teamKey: TeamKey, rowId: string, field: keyof Player, value: string) {
    updateTeamOrder(teamKey, (rows) => rows.map((row) => (row.rowId === rowId ? { ...row, [field]: value.trim() } : row)));
  }

  function reorder(teamKey: TeamKey, fromRowId: string, toRowId: string) {
    if (fromRowId === toRowId) return;
    updateTeamOrder(teamKey, (rows) => {
      const fromIndex = rows.findIndex((row) => row.rowId === fromRowId);
      const toIndex = rows.findIndex((row) => row.rowId === toRowId);
      if (fromIndex < 0 || toIndex < 0) return rows;
      return moveRow(rows, fromIndex, toIndex);
    });
  }

  function requestPitchInput(type: PitchType, origin: PitchInputOrigin = "button") {
    if (!normalizeNumber(currentBatter?.jerseyNumber)) {
      const key = getCurrentBatterPromptKey(state);
      const alreadyPrompted = state.promptedBatterKeys.includes(key);

      if (battingTeamKey !== "opponent" || !alreadyPrompted) {
        setState((current) =>
          current.promptedBatterKeys.includes(key)
            ? current
            : {
                ...current,
                promptedBatterKeys: [...current.promptedBatterKeys, key]
              }
        );
        setForceRegistration(true);
        setDialogMode("batter");
        return false;
      }
    }

    if (type === "dead" || (type === "ball" && state.game.balls >= 3)) {
      setPendingPitchContext("dead-ball");
      setPitchAdvanceRequest({ id: Date.now(), type });
      return true;
    }

    setState((current) => {
      captureInputSnapshot(current);
      return applyPitch(current, type);
    });
    setNeedsPlateConfirm(true);
    if (type === "strike" || type === "ball") {
      setPendingPitchContext("live-count");
    } else if (origin === "field-foul") {
      setPendingPitchContext(null);
    } else {
      setPendingPitchContext("dead-ball");
    }
    return true;
  }

  function handlePitch(type: PitchType) {
    requestPitchInput(type);
  }

  function handleFieldFoulStart() {
    return requestPitchInput("foul", "field-foul");
  }

  function handlePitchAdvanceAnimationComplete(type: PitchAdvanceType) {
    setPitchAdvanceRequest(null);
    setState((current) => {
      captureInputSnapshot(current);
      return applyPitch(current, type);
    });
    setNeedsPlateConfirm(true);
    setPendingPitchContext("dead-ball");
  }

  function handlePitchPointer(type: PitchType, event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    handlePitch(type);
  }

  function handlePitchKey(type: PitchType, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handlePitch(type);
  }

  function handleAdvance(source: RunnerSource, reason: AdvanceReason, hitLocation?: string) {
    setState((current) => {
      captureInputSnapshot(current);
      return advanceRunner(current, source, reason, hitLocation);
    });
    setNeedsPlateConfirm(true);
  }

  function handleRevertForcedAdvance(snapshot: { runners: BaseRunners; ownScore: number; opponentScore: number }) {
    setState((current) => ({
      ...current,
      game: {
        ...current.game,
        runners: snapshot.runners,
        runnerFirst: Boolean(snapshot.runners.first),
        ownScore: snapshot.ownScore,
        opponentScore: snapshot.opponentScore
      }
    }));
  }

  function handleRunnerMove(
    source: RunnerSource,
    destination: RunnerDestination,
    reason: AdvanceReason,
    hitLocation?: string,
    resultLabel?: string
  ) {
    setState((current) => {
      captureInputSnapshot(current);
      return moveRunnerToDestination(current, source, destination, reason, hitLocation, resultLabel);
    });
    setNeedsPlateConfirm(true);
  }

  function handleFieldOutDecision(
    nodeId: string,
    source: RunnerSource,
    resultLabel?: string,
    runnerId?: string,
    destination?: RunnerDestination
  ) {
    setPendingFieldOuts((current) => [
      ...current.filter((fieldOut) => fieldOut.nodeId !== nodeId),
      { nodeId, source, destination, runnerId, resultLabel }
    ]);
    setNeedsPlateConfirm(true);
  }

  function handleInitialFieldErrorDecision(fieldingPosition?: string) {
    setState((current) => applyInitialFieldError(current, fieldingPosition));
    setNeedsPlateConfirm(true);
  }

  function handleThrowErrorDecision(resultLabel: string) {
    setState((current) => applyThrowError(current, resultLabel));
    setNeedsPlateConfirm(true);
  }

  function clearFieldOutDecision(nodeId: string) {
    setPendingFieldOuts((current) => current.filter((fieldOut) => fieldOut.nodeId !== nodeId));
  }

  function handleBatterBoxChange(box: BatterBox) {
    setState((current) => {
      const teamKey = getBattingTeamKey(current);
      if (teamKey === "own") return current;

      const battingIndex = getCurrentBattingIndex(current);
      return {
        ...current,
        opponentOrder: current.opponentOrder.map((player, index) => (index === battingIndex ? { ...player, batterBox: box } : player))
      };
    });
  }

  function handleFieldPlayStarted() {
    setState((current) => {
      captureInputSnapshot(current);
      return {
        ...current,
        game: {
          ...current.game,
          gameStarted: true
        }
      };
    });
    setNeedsPlateConfirm(true);
  }

  function handleHomeRun() {
    setState((current) => {
      captureInputSnapshot(current);
      return applyHomeRun(current);
    });
    setNeedsPlateConfirm(true);
  }

  function resolvePendingFieldOutSource(current: AppState, fieldOut: PendingFieldOut): RunnerSource {
    if (fieldOut.source === "batter") return "batter";

    if (fieldOut.runnerId) {
      const currentBase = (["first", "second", "third"] as BaseKey[]).find((base) => current.game.runners[base]?.id === fieldOut.runnerId);
      if (currentBase) return currentBase;
    }

    return fieldOut.source;
  }

  function applyPendingFieldOutDecision(current: AppState, fieldOut: PendingFieldOut) {
    const runnerStillOnBase = fieldOut.runnerId
      ? (["first", "second", "third"] as BaseKey[]).some((base) => current.game.runners[base]?.id === fieldOut.runnerId)
      : false;

    if (fieldOut.destination === "home" && fieldOut.runnerId && !runnerStillOnBase) {
      return applyHomeRunnerOut(current, fieldOut.source, fieldOut.resultLabel);
    }

    return applyFieldOut(current, resolvePendingFieldOutSource(current, fieldOut), fieldOut.resultLabel);
  }

  function handleConfirmPlate() {
    const withFieldOuts = pendingFieldOuts.reduce((next, fieldOut) => applyPendingFieldOutDecision(next, fieldOut), state);
    const endsAtBat = isCurrentBatterPlateAppearanceComplete(withFieldOuts) || withFieldOuts.game.outs >= 3;
    const nextScoreLog = endsAtBat
      ? [...withFieldOuts.scoreLog, buildScoreLogEntry(withFieldOuts, pendingFieldOuts)]
      : withFieldOuts.scoreLog;
    const nextState: AppState = {
      ...confirmPlateAppearance(withFieldOuts),
      scoreLog: nextScoreLog,
      promptedBatterKeys: endsAtBat ? [] : withFieldOuts.promptedBatterKeys
    };

    if (endsAtBat) {
      const startSnapshot = preAtBatSnapshotRef.current;
      setPreAtBatSnapshots((current) => [...current, startSnapshot]);
      preAtBatSnapshotRef.current = stripScoreLog(nextState);
    }

    setState(nextState);
    inputSnapshotRef.current = null;
    setPendingFieldOuts([]);
    setPitchAdvanceRequest(null);
    setPendingPitchContext(null);
    setLiveScorePreviewActive(false);
    setPlateActionsLocked(false);
    setNeedsPlateConfirm(false);
    setFieldSelection(null);
    setFieldResetToken((token) => token + 1);
  }

  function handleCancelPlate() {
    const snapshot = inputSnapshotRef.current;
    if (snapshot) setState(structuredClone(snapshot));
    inputSnapshotRef.current = null;
    setPendingFieldOuts([]);
    setPitchAdvanceRequest(null);
    setPendingPitchContext(null);
    setLiveScorePreviewActive(false);
    setPlateActionsLocked(false);
    setNeedsPlateConfirm(false);
    setFieldSelection(null);
    setFieldResetToken((token) => token + 1);
  }

  function closeDialog() {
    setDialogMode(null);
    setForceRegistration(false);
  }

  function setOpponentBatter(jerseyNumber: string) {
    const battingIndex = getCurrentBattingIndex(state);
    const normalized = normalizeNumber(jerseyNumber);
    setState((current) => ({
      ...current,
      opponentOrder: current.opponentOrder.map((player, index) => (index === battingIndex ? { ...player, jerseyNumber: normalized } : player)),
      game: {
        ...current.game,
        currentOpponentBatterJerseyNumber: normalized
      }
    }));
    closeDialog();
  }

  function substituteOwnBatter(rowId: string) {
    const battingIndex = getCurrentBattingIndex(state);
    updateTeamOrder("own", (rows) => {
      const benchIndex = rows.findIndex((player) => player.rowId === rowId);
      if (benchIndex < 0 || benchIndex === battingIndex) return rows;
      return moveRow(moveRow(rows, benchIndex, battingIndex), battingIndex + 1, benchIndex);
    });
    closeDialog();
  }

  function setOwnPitcher(player: Player) {
    setState((current) => ({
      ...current,
      ownOrder: current.ownOrder.map((row) => ({
        ...row,
        positionNumber: row.rowId === player.rowId ? "1" : row.positionNumber === "1" ? "" : row.positionNumber
      })),
      game: {
        ...current.game,
        currentPitcherJerseyNumber: player.jerseyNumber
      }
    }));
    closeDialog();
  }

  function setOpponentPitcher(jerseyNumber: string) {
    const normalized = normalizeNumber(jerseyNumber);
    setState((current) => {
      if (!normalized) return current;

      const existingIndex = current.opponentOrder.findIndex((player) => normalizeNumber(player.jerseyNumber) === normalized);
      const assignedIndex =
        existingIndex >= 0 ? existingIndex : current.opponentOrder.findIndex((player) => !normalizeNumber(player.jerseyNumber));

      return {
        ...current,
        opponentOrder: current.opponentOrder.map((player, index) => {
          const nextPlayer =
            existingIndex < 0 && index === assignedIndex ? { ...player, jerseyNumber: normalized } : player;

          if (index === assignedIndex) {
            return { ...nextPlayer, positionNumber: "1" };
          }
          if (nextPlayer.positionNumber === "1") {
            return { ...nextPlayer, positionNumber: "" };
          }
          return nextPlayer;
        }),
        game: {
          ...current.game,
          currentOpponentPitcherJerseyNumber: normalized
        }
      };
    });
    closeDialog();
  }

  const batterText = ownBatting
    ? `${state.game.battingOrder}番 ${currentOwnBatter?.name ?? "未登録"}`
    : `${state.game.battingOrder}番 ${formatPlayerLabel(currentOpponentBatter, state.game.currentOpponentBatterJerseyNumber) || "未登録"}`;
  const pitcherText = ownBatting
    ? formatPlayerLabel(opponentPitcher, state.game.currentOpponentPitcherJerseyNumber) || "?"
    : formatPlayerLabel(currentPitcher, state.game.currentPitcherJerseyNumber) || "?";

  const confirmDialogElement = confirmDialog && (
    <div className="confirm-overlay" role="alertdialog" aria-modal="true">
      <div className="confirm-panel">
        <p>{confirmDialog.message}</p>
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={() => setConfirmDialog(null)}>
            キャンセル
          </button>
          <button
            type="button"
            className="confirm-ok"
            onClick={() => {
              confirmDialog.onConfirm();
              setConfirmDialog(null);
            }}
          >
            実行
          </button>
        </div>
      </div>
    </div>
  );

  if (!currentGameId) {
    return (
      <>
        <TitleScreen
          games={gameIndex}
          onNewGame={handleStartNewGame}
          onResumeGame={handleResumeGame}
          onDeleteGame={handleDeleteGame}
          onRequestConfirm={requestConfirm}
        />
        {confirmDialogElement}
      </>
    );
  }

  return (
    <>
      <nav className="main-tabs" aria-label="メインメニュー">
        <button type="button" className="main-tabs-home" aria-label="試合一覧に戻る" onClick={handleReturnToTitle}>
          {"‹"}
        </button>
        {[
          ["order", "オーダー"],
          ["score", "スコア入力"],
          ["output", "スコア出力"]
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={activeTab === key ? "active" : ""}
            aria-current={activeTab === key ? "page" : undefined}
            onClick={() => setActiveTab(key as TabKey)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="phone-shell" aria-label="AIスコア 試合入力画面">
        {activeTab === "order" && (
          <OrderView
            state={state}
            dragging={dragging}
            currentBattingTeam={battingTeamKey}
            currentBattingIndex={getCurrentBattingIndex(state)}
            ownPositionDuplicates={ownPositionDuplicates}
            opponentPositionDuplicates={opponentPositionDuplicates}
            setDragging={setDragging}
            reorder={reorder}
            updateOrderValue={updateOrderValue}
            setState={setState}
          />
        )}

        {activeTab === "score" && (
          <section className="view score-view" data-view="score">
            <section className="player-row" aria-label="current players">
              <div className="player-summary-card">
                <div className="player-summary-main">
                  <div className="player-battery-panel">
                    <button className="pitcher-select battery-row pitcher-row" type="button" onClick={() => setDialogMode("pitcher")}>
                      <span>ピッチャー</span>
                      <b>
                        <span className="player-name-text">{pitcherText}</span>
                        <span className="edit-cue" aria-hidden="true" />
                      </b>
                    </button>
                    <div className="batter-row">
                      <img className="batter-icon" src={ownBatting ? "assets/batter-red.png" : "assets/batter-blue.png"} alt="" />
                      <button className="player-copy batter-select battery-row" type="button" onClick={() => setDialogMode("batter")}>
                        <p>バッター</p>
                        <strong>
                          <span className="player-name-text">{batterText}</span>
                          <span className="edit-cue" aria-hidden="true" />
                        </strong>
                      </button>
                    </div>
                  </div>
                  <ScoreCell state={state} pendingOuts={pendingFieldOuts} />
                </div>
                <RunnerScoreStrip state={state} baseState={runnerScoreBaseState} pendingOuts={pendingFieldOuts} />
              </div>
            </section>

            <FieldStage
              state={state}
              displayOwnScore={scoreBoardState.game.ownScore}
              displayOpponentScore={scoreBoardState.game.opponentScore}
              fieldSelection={fieldSelection}
              resetToken={fieldResetToken}
              needsPlateConfirm={needsPlateConfirm}
              pitchAdvanceRequest={pitchAdvanceRequest}
              pendingPitchContext={pendingPitchContext}
              onLiveScorePreview={() => setLiveScorePreviewActive(true)}
              setFieldSelection={setFieldSelection}
              onAdvance={handleAdvance}
              onRunnerMove={handleRunnerMove}
              onFieldOutDecision={handleFieldOutDecision}
              onInitialFieldErrorDecision={handleInitialFieldErrorDecision}
              onThrowErrorDecision={handleThrowErrorDecision}
              onRevertForcedAdvance={handleRevertForcedAdvance}
              onFieldDecisionCleared={clearFieldOutDecision}
              onBatterBoxChange={handleBatterBoxChange}
              onFieldFoulStart={handleFieldFoulStart}
              onPitchAdvanceAnimationComplete={handlePitchAdvanceAnimationComplete}
              onFieldPlayStarted={handleFieldPlayStarted}
              onHomeRun={handleHomeRun}
              onPlateActionLockChange={setPlateActionsLocked}
              />

            <section className="pitch-buttons" aria-label="pitch input">
              <button
                className="strike"
                type="button"
                disabled={Boolean(state.plate.result) || needsPlateConfirm || Boolean(pitchAdvanceRequest)}
                onPointerDown={(event) => handlePitchPointer("strike", event)}
                onKeyDown={(event) => handlePitchKey("strike", event)}
              >
                <ScoreMarkIcon type="strike" />
                ストライク
              </button>
              <button
                className="foul"
                type="button"
                disabled={Boolean(state.plate.result) || needsPlateConfirm || Boolean(pitchAdvanceRequest)}
                onPointerDown={(event) => handlePitchPointer("foul", event)}
                onKeyDown={(event) => handlePitchKey("foul", event)}
              >
                <ScoreMarkIcon type="foul" />
                ファール
              </button>
              <button
                className="ball"
                type="button"
                disabled={Boolean(state.plate.result) || needsPlateConfirm || Boolean(pitchAdvanceRequest)}
                onPointerDown={(event) => handlePitchPointer("ball", event)}
                onKeyDown={(event) => handlePitchKey("ball", event)}
              >
                <ScoreMarkIcon type="ball" />
                ボール
              </button>
              <button
                className="dead"
                type="button"
                disabled={Boolean(state.plate.result) || needsPlateConfirm || Boolean(pitchAdvanceRequest)}
                onPointerDown={(event) => handlePitchPointer("dead", event)}
                onKeyDown={(event) => handlePitchKey("dead", event)}
              >
                <ScoreMarkIcon type="dead" />
                デッドボール
              </button>
            </section>

            {needsPlateConfirm && !plateActionsLocked && (
              <section className="plate-actions" aria-label="plate actions">
                <button className="plate-cancel-button" type="button" onClick={handleCancelPlate}>
                  取り消し
                </button>
                <button className="plate-confirm-button" type="button" onClick={handleConfirmPlate}>
                  {"\u78ba\u5b9a"}
                </button>
              </section>
            )}

          </section>
        )}

        {activeTab === "output" && (
          <ScoreOutputView
            state={state}
            teamKey={outputTeamKey}
            setTeamKey={setOutputTeamKey}
            onRedoAtBat={handleRedoAtBat}
            onRequestConfirm={requestConfirm}
          />
        )}

        {dialogMode && (
          <PlayerDialog
            state={state}
            mode={dialogMode}
            forceRegistration={forceRegistration}
            ownBatting={ownBatting}
            closeDialog={closeDialog}
            setOpponentBatter={setOpponentBatter}
            substituteOwnBatter={substituteOwnBatter}
            setOwnPitcher={setOwnPitcher}
            setOpponentPitcher={setOpponentPitcher}
          />
        )}
      </main>
      {confirmDialogElement}
    </>
  );
}

function OrderView({
  state,
  dragging,
  currentBattingTeam,
  currentBattingIndex,
  ownPositionDuplicates,
  opponentPositionDuplicates,
  setDragging,
  reorder,
  updateOrderValue,
  setState
}: {
  state: AppState;
  dragging: { teamKey: TeamKey; rowId: string } | null;
  currentBattingTeam: TeamKey;
  currentBattingIndex: number;
  ownPositionDuplicates: Set<string>;
  opponentPositionDuplicates: Set<string>;
  setDragging: (dragging: { teamKey: TeamKey; rowId: string } | null) => void;
  reorder: (teamKey: TeamKey, fromRowId: string, toRowId: string) => void;
  updateOrderValue: (teamKey: TeamKey, rowId: string, field: keyof Player, value: string) => void;
  setState: Dispatch<SetStateAction<AppState>>;
}) {
  return (
    <section className="view order-view">
      <section className="order-team own-order" aria-label="自チームオーダー">
        <header>
          <span>自チーム</span>
          <div className="own-team-header-controls">
            <strong>{state.ownTeam.name}</strong>
            <select
              className="batting-side-select"
              aria-label="先攻後攻"
              value={state.ownTeam.battingSide}
              disabled={state.game.gameStarted}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  ownTeam: { ...current.ownTeam, battingSide: event.target.value as "top" | "bottom" }
                }))
              }
            >
              <option value="top">先攻</option>
              <option value="bottom">後攻</option>
            </select>
          </div>
        </header>
        <OrderError duplicates={ownPositionDuplicates} />
        <OrderList
          teamKey="own"
          rows={state.ownOrder}
          duplicates={ownPositionDuplicates}
          currentBattingTeam={currentBattingTeam}
          currentBattingIndex={currentBattingIndex}
          dragging={dragging}
          setDragging={setDragging}
          reorder={reorder}
          updateOrderValue={updateOrderValue}
        />
      </section>

      <section className="order-team opponent-order" aria-label="相手チームオーダー">
        <header>
          <span>相手チーム</span>
          <input
            className="team-name-input"
            type="text"
            value={state.opponentTeam.name}
            placeholder="未設定"
            aria-label="opponent team name"
            onChange={(event) =>
              setState((current) => ({
                ...current,
                opponentTeam: { ...current.opponentTeam, name: event.target.value }
              }))
            }
          />
        </header>
        <OrderError duplicates={opponentPositionDuplicates} />
        <OrderList
          teamKey="opponent"
          rows={state.opponentOrder}
          duplicates={opponentPositionDuplicates}
          currentBattingTeam={currentBattingTeam}
          currentBattingIndex={currentBattingIndex}
          dragging={dragging}
          setDragging={setDragging}
          reorder={reorder}
          updateOrderValue={updateOrderValue}
        />
      </section>
    </section>
  );
}

function OrderError({ duplicates }: { duplicates: Set<string> }) {
  const values = [...duplicates];
  return (
    <p className="order-error" role="alert" hidden={values.length === 0}>
      {values.length > 0 ? `守備位置 ${values.join("・")} が重複しています` : ""}
    </p>
  );
}

function OrderList({
  teamKey,
  rows,
  duplicates,
  dragging,
  currentBattingTeam,
  currentBattingIndex,
  setDragging,
  reorder,
  updateOrderValue
}: {
  teamKey: TeamKey;
  rows: Player[];
  duplicates: Set<string>;
  dragging: { teamKey: TeamKey; rowId: string } | null;
  currentBattingTeam: TeamKey;
  currentBattingIndex: number;
  setDragging: (dragging: { teamKey: TeamKey; rowId: string } | null) => void;
  reorder: (teamKey: TeamKey, fromRowId: string, toRowId: string) => void;
  updateOrderValue: (teamKey: TeamKey, rowId: string, field: keyof Player, value: string) => void;
}) {
  return (
    <div className="order-list">
      <div className="order-row order-header">
        <span></span>
        <span>打順</span>
        <span>守備</span>
        <span>打席</span>
        <span>名前</span>
        <span>背番号</span>
      </div>
      {rows.map((player, index) => {
        const positionNumber = normalizeNumber(player.positionNumber);
        const isDragging = dragging?.teamKey === teamKey && dragging.rowId === player.rowId;
        const isCurrentBatter = teamKey === currentBattingTeam && index === currentBattingIndex;
        return (
          <div
            key={player.rowId}
            className={`order-row${isDragging ? " is-dragging" : ""}${isCurrentBatter ? " is-current-batter" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (dragging?.teamKey === teamKey) reorder(teamKey, dragging.rowId, player.rowId);
            }}
            onPointerEnter={() => {
              if (dragging?.teamKey === teamKey) reorder(teamKey, dragging.rowId, player.rowId);
            }}
          >
            <button
              type="button"
              className="order-drag-handle"
              aria-label="drag to reorder"
              draggable
              onDragStart={() => setDragging({ teamKey, rowId: player.rowId })}
              onDragEnd={() => setDragging(null)}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging({ teamKey, rowId: player.rowId });
              }}
              onPointerUp={() => setDragging(null)}
            />
            <span className="order-readonly order-batting">{index + 1}</span>
            <input
              className={`order-input order-position${duplicates.has(positionNumber) ? " is-invalid" : ""}`}
              value={player.positionNumber}
              inputMode="numeric"
              aria-label="守備位置番号"
              onChange={(event) => updateOrderValue(teamKey, player.rowId, "positionNumber", event.target.value)}
            />
            {teamKey === "own" ? (
              <span className={`order-readonly order-batter-box batter-box-text ${player.batterBox}`}>
                {player.batterBox === "right" ? "右" : "左"}
              </span>
            ) : (
              <select
                className={`order-input order-batter-box batter-box-text ${player.batterBox}`}
                value={player.batterBox}
                aria-label="打席"
                onChange={(event) => updateOrderValue(teamKey, player.rowId, "batterBox", event.target.value as BatterBox)}
              >
                <option value="right">右</option>
                <option value="left">左</option>
              </select>
            )}
            {teamKey === "own" ? (
              <>
                <span className="order-readonly order-name">{player.name}</span>
                <span className="order-readonly order-jersey">{formatJerseyNumber(player.jerseyNumber)}</span>
              </>
            ) : (
              <>
                <input
                  className="order-input order-name"
                  value={player.name}
                  aria-label="名前"
                  onChange={(event) => updateOrderValue(teamKey, player.rowId, "name", event.target.value)}
                />
                <input
                  className="order-input order-jersey"
                  value={player.jerseyNumber}
                  inputMode="numeric"
                  aria-label="背番号"
                  onChange={(event) => updateOrderValue(teamKey, player.rowId, "jerseyNumber", event.target.value)}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getPitchSymbolCoordinate(index: number, total: number) {
  const layout = getPitchSymbolLayout(total);
  const column = layout.columnCount === 1 ? 0 : Math.floor(index / layout.rowCount);
  const row = layout.columnCount === 1 ? index : index % layout.rowCount;

  return {
    x: layout.columnCount > 1 ? layout.twoColumnRightX - column * layout.xGap : layout.singleColumnX,
    y: layout.yTop + row * layout.yGap
  };
}

function getPitchSymbolLayout(total: number) {
  const columnCount = total > 6 ? 2 : 1;
  const neededRows = columnCount === 1 ? total : Math.ceil(total / columnCount);
  const rowCount = Math.max(6, neededRows);
  const singleColumnX = 190;
  const twoColumnRightX = 240;
  const xGap = 120;
  const yTop = rowCount <= 6 ? 165 : 145;
  const yBottom = rowCount <= 6 ? 845 : 913;
  const yGap = rowCount > 1 ? (yBottom - yTop) / (rowCount - 1) : 0;
  const symbolScale = rowCount <= 6 ? (columnCount === 1 ? 1.72 : 1.34) : rowCount <= 9 ? 1.12 : Math.max(0.82, 9 / rowCount);

  return {
    columnCount,
    rowCount,
    singleColumnX,
    twoColumnRightX,
    xGap,
    yTop,
    yGap,
    symbolScale
  };
}

const SCORE_MATRIX_MARK_COORDINATES = {
  out: { x: 856, y: 508 },
  areas: {
    center: { x: 856, y: 508, stack: "up" },
    result: { x: 1120, y: 870, stack: "up" },
    first: { x: 1120, y: 870, stack: "up" },
    second: { x: 1120, y: 165, stack: "down" },
    third: { x: 590, y: 165, stack: "down" },
    home: { x: 590, y: 870, stack: "up" }
  },
  playGap: 115
} as const;

const SCORE_MATRIX_BASE_PATHS: Record<RunnerDestination, { x1: number; y1: number; x2: number; y2: number }> = {
  first: { x1: 856, y1: 955, x2: 1315, y2: 510 },
  second: { x1: 1315, y1: 510, x2: 856, y2: 65 },
  third: { x1: 856, y1: 65, x2: 402, y2: 510 },
  home: { x1: 402, y1: 510, x2: 856, y2: 955 }
};

const SCORE_MATRIX_HIT_PATHS: Record<Exclude<HitType, "">, RunnerDestination[]> = {
  single: ["first"],
  "two-base": ["first", "second"],
  "three-base": ["first", "second", "third"],
  "home-run": ["first", "second", "third", "home"]
};

const SCORE_MATRIX_FIELDER_OUT_COORDINATES: Record<RunnerDestination, { x: number; y: number }> = {
  first: { x: 1050, y: 756 },
  second: { x: 1032, y: 276 },
  third: { x: 642, y: 276 },
  home: { x: 642, y: 756 }
};

const SCORE_MATRIX_HIT_LOCATION_COORDINATE = { x: 1134, y: 850 } as const;
const SCORE_MATRIX_INFIELD_HIT_ARC_PATH = "M -112 -20 A 168 168 0 0 0 128 -278";
const SCORE_MATRIX_INFIELD_HIT_TEXT_OFFSET = { x: 44, y: -86 } as const;
const SCORE_MATRIX_HIT_LOCATION_FONT_SIZE = 150;

function getScoreFielderOutTextStyle(mark: ScoreCellMark, coordinate: { x: number; y: number }) {
  if (mark.text === "K" || mark.text === "K 2-3") {
    return {
      x: 1136,
      y: 758,
      fontSize: 250,
      strokeWidth: 14
    };
  }

  if (/^[1-9]-[1-9] T\.O$/.test(mark.text)) {
    return {
      x: coordinate.x + 16,
      y: coordinate.y,
      fontSize: 132,
      strokeWidth: 11
    };
  }

  if (/^[1-9]-[1-9]$/.test(mark.text)) {
    return {
      x: coordinate.x + 32,
      y: coordinate.y,
      fontSize: 180,
      strokeWidth: 14
    };
  }

  return {
    x: coordinate.x,
    y: coordinate.y,
    fontSize: 150,
    strokeWidth: 18
  };
}

function renderScoreFielderOutMark(mark: ScoreCellMark, coordinate: { x: number; y: number }, key: string) {
  const textStyle = getScoreFielderOutTextStyle(mark, coordinate);
  const isCaughtFlyResult = /^F?[1-9]$/.test(mark.text);

  if (mark.text === "K 2-3") {
    return (
      <g transform={`translate(${textStyle.x} ${textStyle.y})`} key={key}>
        <text x="0" y="-42" fill="#111" stroke="#fff" strokeWidth={textStyle.strokeWidth} paintOrder="stroke" style={{ fontSize: `${textStyle.fontSize}px` }}>
          K
        </text>
        <text x="34" y="100" fill="#111" stroke="#fff" strokeWidth="9" paintOrder="stroke" style={{ fontSize: "104px" }}>
          2-3
        </text>
      </g>
    );
  }

  if (/^[1-9]-[1-9] T\.O$/.test(mark.text)) {
    const throwText = mark.text.replace(" T.O", "");
    return (
      <g transform={`translate(${textStyle.x} ${textStyle.y})`} key={key}>
        <text x="0" y="-48" fill="#111" stroke="#fff" strokeWidth={textStyle.strokeWidth} paintOrder="stroke" style={{ fontSize: `${textStyle.fontSize}px` }}>
          {throwText}
        </text>
        <text x="0" y="76" fill="#111" stroke="#fff" strokeWidth="9" paintOrder="stroke" style={{ fontSize: "108px" }}>
          T.O
        </text>
      </g>
    );
  }

  return (
    <g transform={`translate(${textStyle.x} ${textStyle.y})`} key={key}>
      {isCaughtFlyResult && (
        <>
          <path d="M -50 -108 Q 0 -156 50 -108" fill="none" stroke="#fff" strokeWidth="22" strokeLinecap="round" />
          <path d="M -50 -108 Q 0 -156 50 -108" fill="none" stroke="#111" strokeWidth="10" strokeLinecap="round" />
        </>
      )}
      <text x="0" y="0" fill="#111" stroke="#fff" strokeWidth={textStyle.strokeWidth} paintOrder="stroke" style={{ fontSize: `${textStyle.fontSize}px` }}>
        {mark.text}
      </text>
    </g>
  );
}

type ScoreMatrixTextArea = keyof typeof SCORE_MATRIX_MARK_COORDINATES.areas;

function getScoreTextArea(area: ScoreCellMark["area"]): ScoreMatrixTextArea {
  if (area === "center" || area === "first" || area === "second" || area === "third" || area === "home" || area === "result") return area;
  return "result";
}

function getScorePlayCoordinate(area: ScoreMatrixTextArea, index: number, total: number) {
  const coordinate = SCORE_MATRIX_MARK_COORDINATES.areas[area];
  const upwardOffset = total === 1 ? 0 : (total - 1 - index) * SCORE_MATRIX_MARK_COORDINATES.playGap;
  return {
    x: coordinate.x,
    y: coordinate.stack === "up" ? coordinate.y - upwardOffset : coordinate.y + index * SCORE_MATRIX_MARK_COORDINATES.playGap
  };
}

function getScorePlayTextStyle(mark: ScoreCellMark) {
  if (mark.text === "l") return { fill: "#111", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "190px", fontStyle: "italic" };
  if (mark.text === "B" || mark.text === "HP") return { fill: "#006fc9" };
  if (/^[1-9]-$/.test(mark.text)) return { fill: "#111" };
  return undefined;
}

function renderScorePitchSymbol(symbol: string, x: number, y: number, scale: number, key: string) {
  if (symbol === "\u2715") {
    return (
      <g className="score-symbol-shape score-symbol-stroke" transform={`translate(${x} ${y}) scale(${scale})`} key={key}>
        <path d="M -26 -26 L 26 26" />
        <path d="M 26 -26 L -26 26" />
      </g>
    );
  }

  if (symbol === "\u25cf") {
    return (
      <g className="score-symbol-shape score-symbol-fill" transform={`translate(${x} ${y}) scale(${scale})`} key={key}>
        <circle cx="0" cy="0" r="26" />
      </g>
    );
  }

  if (symbol === "\u25b3") {
    return (
      <g className="score-symbol-shape score-symbol-stroke" transform={`translate(${x} ${y}) scale(${scale})`} key={key}>
        <path d="M 0 -31.2 L 36 31.2 L -36 31.2 Z" />
      </g>
    );
  }

  return (
    <text className="score-symbol" x={x} y={y} key={key} style={{ fontSize: `${128 * scale}px` }}>
      {symbol}
    </text>
  );
}

function ScoreMatrixGraphic({
  marks,
  hitType = "",
  className = "",
  showInningEndSlash = false
}: {
  marks: ScoreCellMark[];
  hitType?: HitType;
  className?: string;
  showInningEndSlash?: boolean;
}) {
  const pitchMarks = marks.filter((mark) => mark.kind === "pitch");
  const resultMark = marks.find((mark) => mark.kind === "result");
  const outMark = marks.find((mark) => mark.kind === "out");
  const noteMarks = marks.filter((mark) => mark.kind === "note");
  const advanceMarks = marks.filter((mark) => mark.kind === "advance" && mark.area);
  const fielderOutMarks = marks.filter((mark) => mark.kind === "fielderOut" && mark.area);
  const hitLocationMarks = marks.filter((mark) => mark.kind === "hitLocation");
  const scoreMarks = marks.filter((mark) => mark.kind === "score");
  const advanceLineAreas =
    advanceMarks.length > 0
      ? advanceMarks.map((mark) => mark.area as RunnerDestination)
      : hitType
        ? SCORE_MATRIX_HIT_PATHS[hitType]
        : [];
  const pitchSymbolScale = getPitchSymbolLayout(pitchMarks.length).symbolScale;
  const playMarks = [resultMark, ...noteMarks].filter((mark): mark is ScoreCellMark => Boolean(mark));
  const playMarkEntries = playMarks.map((mark, index) => {
    const area = getScoreTextArea(mark.area);
    const areaMarks = playMarks.filter((current) => getScoreTextArea(current.area) === area);
    const areaIndex = playMarks.slice(0, index).filter((current) => getScoreTextArea(current.area) === area).length;
    return {
      area,
      areaIndex,
      areaTotal: areaMarks.length,
      mark
    };
  });

  return (
    <div className={`score-matrix ${className}`.trim()}>
      <img src="assets/score_matrix.png" alt="" />
      <svg className="matrix-overlay" viewBox="0 0 1382 1025" aria-hidden="true">
        <g className="matrix-advance-lines">
          {advanceLineAreas.map((area, index) => {
            const path = SCORE_MATRIX_BASE_PATHS[area];
            if (!path) return null;
            return <line x1={path.x1} y1={path.y1} x2={path.x2} y2={path.y2} key={`${area}-${index}`} />;
          })}
        </g>
        <g>
          {pitchMarks.map((mark, index) => {
            const coordinate = getPitchSymbolCoordinate(index, pitchMarks.length);
            return renderScorePitchSymbol(mark.text, coordinate.x, coordinate.y, pitchSymbolScale, `${mark.text}-${index}`);
          })}
        </g>
        {outMark && (
          <text className="matrix-out" x={SCORE_MATRIX_MARK_COORDINATES.out.x} y={SCORE_MATRIX_MARK_COORDINATES.out.y}>
            {outMark.text}
          </text>
        )}
        {scoreMarks.length > 0 && (
          <circle
            className="matrix-score-mark"
            cx={SCORE_MATRIX_MARK_COORDINATES.out.x}
            cy={SCORE_MATRIX_MARK_COORDINATES.out.y}
            r="72"
          />
        )}
        {showInningEndSlash && (
          <g className="matrix-inning-end-slash">
            <path d="M 1210 1112 L 1446 778" />
            <path d="M 1260 1122 L 1496 788" />
          </g>
        )}
        {fielderOutMarks.map((mark, index) => {
          const coordinate = SCORE_MATRIX_FIELDER_OUT_COORDINATES[mark.area as RunnerDestination];
          if (!coordinate) return null;
          return renderScoreFielderOutMark(mark, coordinate, `${mark.text}-${mark.area}-${index}`);
        })}
        {hitLocationMarks.map((mark, index) => {
          const isInfieldHit = /^[1-6]$/.test(mark.text);
          return (
            <g transform={`translate(${SCORE_MATRIX_HIT_LOCATION_COORDINATE.x} ${SCORE_MATRIX_HIT_LOCATION_COORDINATE.y})`} key={`${mark.text}-${index}`}>
              {isInfieldHit && (
                <>
                  <path d={SCORE_MATRIX_INFIELD_HIT_ARC_PATH} fill="none" stroke="#fff" strokeWidth="30" strokeLinecap="round" />
                  <path d={SCORE_MATRIX_INFIELD_HIT_ARC_PATH} fill="none" stroke="#e83b2e" strokeWidth="13" strokeLinecap="round" />
                </>
              )}
              {mark.over && (
                <circle
                  className="matrix-hit-over-dot"
                  cx={isInfieldHit ? SCORE_MATRIX_INFIELD_HIT_TEXT_OFFSET.x : 0}
                  cy={(isInfieldHit ? SCORE_MATRIX_INFIELD_HIT_TEXT_OFFSET.y : 0) - 118}
                  r="18"
                />
              )}
              <text
                className="matrix-hit-location"
                x={isInfieldHit ? SCORE_MATRIX_INFIELD_HIT_TEXT_OFFSET.x : 0}
                y={isInfieldHit ? SCORE_MATRIX_INFIELD_HIT_TEXT_OFFSET.y : 0}
                stroke="#fff"
                strokeWidth="16"
                paintOrder="stroke"
                style={{ fontSize: `${SCORE_MATRIX_HIT_LOCATION_FONT_SIZE}px` }}
              >
                {mark.text}
              </text>
            </g>
          );
        })}
        {playMarkEntries.map(({ area, areaIndex, areaTotal, mark }, index) => {
          const coordinate = getScorePlayCoordinate(area, areaIndex, areaTotal);
          return (
            <text className={mark.kind === "result" ? "matrix-play" : "matrix-note"} x={coordinate.x} y={coordinate.y} style={getScorePlayTextStyle(mark)} key={`${mark.text}-${index}`}>
              {mark.text}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function formatGameUpdatedAt(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function TitleScreen({
  games,
  onNewGame,
  onResumeGame,
  onDeleteGame,
  onRequestConfirm
}: {
  games: GameSummary[];
  onNewGame: () => void;
  onResumeGame: (id: string) => void;
  onDeleteGame: (id: string) => void;
  onRequestConfirm: (message: string, onConfirm: () => void) => void;
}) {
  function handleDeleteClick(event: MouseEvent, id: string) {
    event.stopPropagation();
    onRequestConfirm("この試合の記録を削除しますか？", () => onDeleteGame(id));
  }

  return (
    <main className="phone-shell title-shell" aria-label="AIスコア タイトル画面">
      <div className="title-header">
        <h1>AIスコア</h1>
        <button type="button" className="title-new-game-button" onClick={onNewGame}>
          + 新規試合
        </button>
      </div>
      <div className="title-game-list">
        {games.length === 0 && <p className="title-empty">保存された試合はまだありません。</p>}
        {games.map((game) => (
          <div key={game.id} className="title-game-row" role="button" tabIndex={0} onClick={() => onResumeGame(game.id)}>
            <div className="title-game-main">
              <div className="title-game-teams">
                <span>{game.ownTeamName}</span>
                <span className="title-game-score">
                  {game.ownScore} - {game.opponentScore}
                </span>
                <span>{game.opponentTeamName}</span>
              </div>
              <div className="title-game-meta">
                <span>{game.gameStarted ? `${game.inning}回${game.half}` : "試合開始前"}</span>
                <span>{formatGameUpdatedAt(game.updatedAt)}</span>
              </div>
            </div>
            <button type="button" className="title-game-delete" aria-label="この試合を削除" onClick={(event) => handleDeleteClick(event, game.id)}>
              {"×"}
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}

function ScoreOutputView({
  state,
  teamKey,
  setTeamKey,
  onRedoAtBat,
  onRequestConfirm
}: {
  state: AppState;
  teamKey: TeamKey;
  setTeamKey: (teamKey: TeamKey) => void;
  onRedoAtBat: (index: number) => void;
  onRequestConfirm: (message: string, onConfirm: () => void) => void;
}) {
  const order = teamKey === "own" ? state.ownOrder : state.opponentOrder;
  const entries = state.scoreLog.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.teamKey === teamKey);
  const maxLoggedInning = entries.reduce((max, { entry }) => Math.max(max, entry.inning), 0);
  const inningCount = Math.max(9, state.game.inning, maxLoggedInning);
  const innings = Array.from({ length: inningCount }, (_, index) => index + 1);
  const battingOrderSlots = Array.from({ length: 9 }, (_, index) => index + 1);

  function getEntry(battingOrder: number, inning: number) {
    return entries.find(({ entry }) => entry.battingOrder === battingOrder && entry.inning === inning);
  }

  function getSlotPlayers(battingOrder: number) {
    const seen = new Set<string>();
    const players: { jerseyNumber: string; playerName: string; positionNumber: string; batterBox: BatterBox }[] = [];
    entries
      .filter(({ entry }) => entry.battingOrder === battingOrder)
      .forEach(({ entry }) => {
        const key = entry.jerseyNumber || entry.playerName;
        if (!key || seen.has(key)) return;
        seen.add(key);
        players.push({
          jerseyNumber: entry.jerseyNumber,
          playerName: entry.playerName,
          positionNumber: entry.positionNumber,
          batterBox: entry.batterBox
        });
      });

    if (players.length === 0) {
      const fallback = order[battingOrder - 1];
      if (fallback) {
        players.push({
          jerseyNumber: fallback.jerseyNumber,
          playerName: fallback.name,
          positionNumber: fallback.positionNumber,
          batterBox: fallback.batterBox
        });
      }
    }

    return players.slice(0, 3);
  }

  function handleCellClick(index: number) {
    onRequestConfirm("この打席からやり直しますか？この打席より後の記録は削除されます。", () => onRedoAtBat(index));
  }

  return (
    <section className="view output-view" data-view="output">
      <div className="output-team-switch">
        <button type="button" className={teamKey === "own" ? "active" : ""} onClick={() => setTeamKey("own")}>
          {state.ownTeam.shortName || state.ownTeam.name}
        </button>
        <button type="button" className={teamKey === "opponent" ? "active" : ""} onClick={() => setTeamKey("opponent")}>
          {getOpponentName(state)}
        </button>
      </div>
      <div className="output-grid-scroll">
        <table className="output-grid">
          <thead>
            <tr>
              <th className="output-col-order">打順</th>
              <th className="output-col-name">名前</th>
              <th className="output-col-position">守備</th>
              <th className="output-col-box">左右</th>
              <th className="output-col-number">#</th>
              {innings.map((inning) => (
                <th key={inning} className="output-col-inning">
                  {inning}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {battingOrderSlots.map((battingOrder) => {
              const players = getSlotPlayers(battingOrder);
              return (
                <tr key={battingOrder}>
                  <td className="output-col-order">{battingOrder}</td>
                  <td className="output-col-name">
                    {players.map((player, playerIndex) => (
                      <div className="output-stack-line" key={player.jerseyNumber || playerIndex}>
                        {player.playerName}
                      </div>
                    ))}
                  </td>
                  <td className="output-col-position">
                    {players.map((player, playerIndex) => (
                      <div className="output-stack-line" key={player.jerseyNumber || playerIndex}>
                        {player.positionNumber}
                      </div>
                    ))}
                  </td>
                  <td className="output-col-box">
                    {players.map((player, playerIndex) => (
                      <div className="output-stack-line" key={player.jerseyNumber || playerIndex}>
                        {player.batterBox === "left" ? "左" : "右"}
                      </div>
                    ))}
                  </td>
                  <td className="output-col-number">
                    {players.map((player, playerIndex) => (
                      <div className="output-stack-line" key={player.jerseyNumber || playerIndex}>
                        {player.jerseyNumber}
                      </div>
                    ))}
                  </td>
                  {innings.map((inning) => {
                    const found = getEntry(battingOrder, inning);
                    return (
                      <td key={inning} className="output-cell">
                        {found && (
                          <button
                            type="button"
                            className="output-cell-button"
                            aria-label={`${battingOrder}番 ${inning}回の打席をやり直す`}
                            onClick={() => handleCellClick(found.index)}
                          >
                            <ScoreMatrixGraphic
                              marks={found.entry.marks}
                              hitType={found.entry.hitType}
                              showInningEndSlash={found.entry.showInningEndSlash}
                              className="score-matrix-output"
                            />
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ScoreCell({ state, pendingOuts = [] }: { state: AppState; pendingOuts?: PendingFieldOut[] }) {
  const hitType = state.game.hitType;
  const marks = buildCurrentScoreCellMarks(state, pendingOuts);
  const showInningEndSlash = shouldShowScorebookInningEndSlash(state, pendingOuts);
  return (
    <article className="score-cell" aria-label="current score cell">
      <ScoreMatrixGraphic marks={marks} hitType={hitType} className="score-matrix-current" showInningEndSlash={showInningEndSlash} />
    </article>
  );
}

function RunnerScoreStrip({
  state,
  baseState,
  pendingOuts = []
}: {
  state: AppState;
  baseState: AppState;
  pendingOuts?: PendingFieldOut[];
}) {
  const battingTeamKey = getBattingTeamKey(state);

  function getRunnerForScoreStrip(runner: RunnerState | null) {
    if (runner?.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder) return null;
    return runner;
  }

  function getCurrentRunnerEntryById(runner: RunnerState | null) {
    if (!runner) return { runner: null, currentBase: null };
    const currentBase = (["third", "second", "first"] as BaseKey[]).find((base) => state.game.runners[base]?.id === runner.id) ?? null;
    return {
      runner: currentBase ? state.game.runners[currentBase] : runner,
      currentBase
    };
  }

  const runnerCells: { key: BaseKey; label: string; runner: RunnerState | null; currentBase: BaseKey | null }[] = [
    { key: "third", label: "3塁", ...getCurrentRunnerEntryById(getRunnerForScoreStrip(baseState.game.runners.third)) },
    { key: "second", label: "2塁", ...getCurrentRunnerEntryById(getRunnerForScoreStrip(baseState.game.runners.second)) },
    { key: "first", label: "1塁", ...getCurrentRunnerEntryById(getRunnerForScoreStrip(baseState.game.runners.first)) }
  ];
  const inningEndingOutIndex = pendingOuts.findIndex((_, index) => Math.min(3, state.game.outs + index + 1) === 3);
  const inningEndsWithPendingOut = inningEndingOutIndex >= 0;

  function getPendingRunnerOut(runner: RunnerState, base: BaseKey) {
    const index = pendingOuts.findIndex((fieldOut) => {
      if (fieldOut.runnerId) return fieldOut.runnerId === runner.id;
      if (fieldOut.source === "batter") return runner.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder;
      return fieldOut.source === base;
    });

    if (index < 0) return null;
    return {
      ...pendingOuts[index],
      outNumber: Math.min(3, state.game.outs + index + 1)
    };
  }

  function getPendingRunnerMark(runner: RunnerState, base: BaseKey) {
    const pendingOut = getPendingRunnerOut(runner, base);
    if (pendingOut) return pendingOut;
    return inningEndsWithPendingOut ? { source: base, leftOnBase: true } : null;
  }

  return (
    <section className="runner-score-strip" aria-label="runner score cells">
      {runnerCells.map((cell) => (
        <article className={`runner-score-card${cell.runner ? " occupied" : ""}`} key={cell.key}>
          <div className="runner-score-title">
            <span>{cell.label}</span>
            {cell.runner && <b>{formatPlayerLabel(cell.runner)}</b>}
          </div>
          <ScoreMatrixGraphic
            marks={buildRunnerScoreCellMarks(
              cell.runner,
              cell.runner ? getPendingRunnerMark(cell.runner, cell.key) : null,
              cell.currentBase
            )}
            hitType={cell.runner?.scoreCard.hitType ?? ""}
            className="runner-score-matrix"
          />
        </article>
      ))}
    </section>
  );
}

function FieldStage({
  state,
  displayOwnScore,
  displayOpponentScore,
  fieldSelection,
  resetToken,
  needsPlateConfirm,
  pitchAdvanceRequest,
  pendingPitchContext,
  onLiveScorePreview,
  onAdvance,
  onRunnerMove,
  onFieldOutDecision,
  onInitialFieldErrorDecision,
  onThrowErrorDecision,
  onRevertForcedAdvance,
  onFieldDecisionCleared,
  onBatterBoxChange,
  onFieldFoulStart,
  onPitchAdvanceAnimationComplete,
  onFieldPlayStarted,
  onHomeRun,
  onPlateActionLockChange,
  setFieldSelection
}: {
  state: AppState;
  displayOwnScore: number;
  displayOpponentScore: number;
  fieldSelection: string | null;
  resetToken: number;
  needsPlateConfirm: boolean;
  pitchAdvanceRequest: PitchAdvanceRequest | null;
  pendingPitchContext: PendingPitchContext;
  onLiveScorePreview: () => void;
  onAdvance: (source: RunnerSource, reason: AdvanceReason, hitLocation?: string) => void;
  onRunnerMove: (
    source: RunnerSource,
    destination: RunnerDestination,
    reason: AdvanceReason,
    hitLocation?: string,
    resultLabel?: string
  ) => void;
  onFieldOutDecision: (
    nodeId: string,
    source: RunnerSource,
    resultLabel?: string,
    runnerId?: string,
    destination?: RunnerDestination
  ) => void;
  onInitialFieldErrorDecision: (fieldingPosition?: string) => void;
  onThrowErrorDecision: (resultLabel: string) => void;
  onRevertForcedAdvance: (snapshot: { runners: BaseRunners; ownScore: number; opponentScore: number }) => void;
  onFieldDecisionCleared: (nodeId: string) => void;
  onBatterBoxChange: (box: BatterBox) => void;
  onFieldFoulStart: () => boolean;
  onPitchAdvanceAnimationComplete: (type: PitchAdvanceType) => void;
  onFieldPlayStarted: () => void;
  onHomeRun: () => void;
  onPlateActionLockChange: (locked: boolean) => void;
  setFieldSelection: Dispatch<SetStateAction<string | null>>;
}) {
  type FieldDecision = "fly-out" | "out" | "safe" | "error" | "home-run";
  type FieldPoint = { x: number; y: number };
  type FieldTarget = {
    key: string;
    className: string;
    label: string;
    kind: "base" | "position" | "foul";
    point?: FieldPoint;
    runnerSource?: RunnerSource | null;
    runnerId?: string;
    destination?: RunnerDestination | null;
    suppressDecisionBubble?: boolean;
  };
  type FieldPlayNode = FieldTarget & {
    id: string;
    point: FieldPoint;
    displayPoint?: FieldPoint;
    showPositionTrail?: boolean;
    subject: string;
    runnerSource: RunnerSource | null;
    runnerId?: string;
    decision?: FieldDecision;
    decisionEnabled?: boolean;
    advanceReason?: AdvanceReason;
    bubbleOpen?: boolean;
  };
  type FieldPlaySegment = {
    id: string;
    fromNodeId: string | null;
    toNodeId: string;
    from: FieldPoint;
    to: FieldPoint;
    kind: "hit" | "throw" | "run";
  };
  type AdvanceChoice = {
    reason: AdvanceReason;
    label: string;
  };
  type AdvanceTarget = {
    source: RunnerSource;
    destination: RunnerDestination;
    point: FieldPoint;
    title: string;
    choices: AdvanceChoice[];
  };
  type ManualAdvancePlay = {
    source: RunnerSource;
    destination: RunnerDestination;
    reason?: AdvanceReason;
  };
  type RunnerDrag = {
    source: RunnerSource;
    imageSrc: string;
    x: number;
    y: number;
    mirrored: boolean;
  };
  type RunnerAnimation = {
    id: string;
    source: RunnerSource;
    from: FieldPoint;
    to: FieldPoint;
    imageSrc: string;
    batter: boolean;
    mirrored: boolean;
  };
  type ScoredRunnerVisual = {
    id: string;
    source: RunnerSource;
    teamKey: TeamKey;
    imageSrc: string;
    batter: boolean;
    arrived: boolean;
    committed: boolean;
  };
  type FieldArtBox = {
    left: number;
    top: number;
    width: number;
    height: number;
  };

  const stageRef = useRef<HTMLElement | null>(null);
  const fieldArtRef = useRef<HTMLImageElement | null>(null);
  const fieldLayerRef = useRef<HTMLDivElement | null>(null);
  const targetRefs = useRef<Record<string, HTMLElement | null>>({});
  const runnerAnimationTimerRef = useRef<number | null>(null);
  const preForcedAdvanceRef = useRef<{ runners: BaseRunners; ownScore: number; opponentScore: number } | null>(null);
  const positionMoveAnimationFrameRefs = useRef<Record<string, number>>({});
  const decisionBubbleTimerRefs = useRef<number[]>([]);
  const advanceTargetTimerRef = useRef<number | null>(null);
  const homeRunAnimationTimerRefs = useRef<number[]>([]);
  const handledPitchAdvanceRequestRef = useRef<number | null>(null);
  const dragLockScrollRef = useRef<{ x: number; y: number } | null>(null);
  const ownBatting = isOwnBattingNow(state);
  const currentBatterBox = getCurrentBatter(state)?.batterBox ?? "right";
  const battingTeamKey = getBattingTeamKey(state);
  const homeRunPlayLocked = state.plate.result === "本" || state.game.hitType === "home-run";
  const currentBatterIsOnBase = Object.values(state.game.runners).some(
    (runner) => runner?.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder
  );
  const [fieldPlay, setFieldPlay] = useState<{
    activeNodeId: string | null;
    ballNodeId: string | null;
    nodes: FieldPlayNode[];
    segments: FieldPlaySegment[];
  }>({
    activeNodeId: null,
    ballNodeId: null,
    nodes: [],
    segments: []
  });
  const [advanceTarget, setAdvanceTarget] = useState<AdvanceTarget | null>(null);
  const [manualAdvancePlay, setManualAdvancePlay] = useState<ManualAdvancePlay | null>(null);
  const [runnerDrag, setRunnerDrag] = useState<RunnerDrag | null>(null);
  const [runnerAnimations, setRunnerAnimations] = useState<RunnerAnimation[]>([]);
  const [homeRunAnimating, setHomeRunAnimating] = useState(false);
  const [positionMovePoints, setPositionMovePoints] = useState<Record<string, FieldPoint>>({});
  const [scoredRunners, setScoredRunners] = useState<ScoredRunnerVisual[]>([]);
  const currentBatterScored = scoredRunners.some((runner) => runner.source === "batter");
  const showBatterRunner = !currentBatterIsOnBase && !currentBatterScored && !state.plate.result;
  const [fieldArtBox, setFieldArtBox] = useState<FieldArtBox | null>(null);
  const isPendingAdvanceDisplayNode = (node: FieldPlayNode) => {
    if (node.kind !== "base" || !node.runnerSource || node.decision || node.decisionEnabled) return false;

    const destination = getBaseDestinationFromKey(node.key);
    const matchesAdvanceTarget =
      advanceTarget?.source === node.runnerSource && advanceTarget.destination === destination;
    const matchesManualAdvance =
      manualAdvancePlay?.source === node.runnerSource &&
      manualAdvancePlay.destination === destination &&
      !manualAdvancePlay.reason;

    return matchesAdvanceTarget || matchesManualAdvance;
  };
  const basePlayRunnerNodes = fieldPlay.nodes.filter(
    (node) =>
      node.kind === "base" &&
      node.runnerSource &&
      !isRunnerBeyondNodeBase(node) &&
      (Boolean(node.decision) || Boolean(node.decisionEnabled) || (!node.decision && (node.bubbleOpen || isPendingAdvanceDisplayNode(node)))) &&
      !(
        getBaseDestinationFromKey(node.key) !== "home" &&
        (node.decision === "safe" || node.decision === "error") &&
        isRunnerAlreadyOnNodeBase(node)
      )
  );
  const homePlayRunnerNodes = basePlayRunnerNodes.filter((node) => getBaseDestinationFromKey(node.key) === "home");
  const basePlayHiddenRunnerNodes = fieldPlay.nodes.filter(
    (node) =>
      node.kind === "base" &&
      node.runnerSource &&
      !isRunnerBeyondNodeBase(node) &&
      (getBaseDestinationFromKey(node.key) === "home" ||
        node.decision === "out" ||
        (node.decisionEnabled && !(isRunnerAlreadyOnNodeBase(node) && (node.decision === "safe" || node.decision === "error"))) ||
        isPendingAdvanceDisplayNode(node))
  );
  const basePlayRunnerIds = new Set(basePlayHiddenRunnerNodes.filter((node) => node.runnerId).map((node) => node.runnerId as string));
  const basePlayRunnerSources = new Set(basePlayHiddenRunnerNodes.filter((node) => !node.runnerId).map((node) => node.runnerSource));
  const decisionTargetRunnerNodes = fieldPlay.nodes.filter(
    (node) => node.kind === "base" && node.runnerSource && node.decisionEnabled && (node.bubbleOpen || node.decision)
  );
  const decisionTargetRunnerIds = new Set(
    decisionTargetRunnerNodes.filter((node) => node.runnerId).map((node) => node.runnerId as string)
  );
  const decisionTargetRunnerSources = new Set(
    decisionTargetRunnerNodes.filter((node) => !node.runnerId).map((node) => node.runnerSource)
  );
  const outRunnerIds = new Set(
    fieldPlay.nodes
      .filter((node) => (node.decision === "out" || node.decision === "fly-out") && node.runnerId)
      .map((node) => node.runnerId as string)
  );
  const outRunnerSources = new Set(
    fieldPlay.nodes
      .filter((node) => (node.decision === "out" || node.decision === "fly-out") && !node.runnerId && node.runnerSource)
      .map((node) => node.runnerSource)
  );
  const animatingRunnerSources = new Set(runnerAnimations.map((animation) => animation.source));
  const ownSlot = {
    key: "own",
    name: getBroadcastTeamName(state.ownTeam.name),
    score: displayOwnScore
  };
  const opponentSlot = {
    key: "opponent",
    name: getBroadcastTeamName(getOpponentName(state)),
    score: displayOpponentScore
  };
  const slots = state.ownTeam.battingSide === "top" ? [ownSlot, opponentSlot] : [opponentSlot, ownSlot];
  const liveCountPending = pendingPitchContext === "live-count";
  const catcherInterferencePending =
    needsPlateConfirm && state.plate.result === advanceReasonLabels["catcher-interference"];
  const deadBallPending = pendingPitchContext === "dead-ball" || Boolean(pitchAdvanceRequest) || catcherInterferencePending;
  const pendingScoredRunners = scoredRunners.filter((runner) => !runner.committed);
  const committedScoredRunners = scoredRunners.filter((runner) => runner.committed);
  const visiblePendingScoredRunners = pendingScoredRunners.filter(
    (runner) => !runnerAnimations.some((animation) => animation.source === runner.source)
  );

  function hasHitPlay() {
    return fieldPlay.segments.some((segment) => segment.kind === "hit");
  }

  function getInitialHitLocation(play = fieldPlay) {
    const node = play.nodes.find(
      (node) => node.kind === "position" && play.segments.some((segment) => segment.kind === "hit" && segment.toNodeId === node.id)
    );
    if (!node) return undefined;
    return isOutfieldOverNode(node) ? `${node.label}+` : node.label;
  }

  function isOpenPickoffDecision() {
    return Boolean(
      !hasHitPlay() &&
        fieldPlay.nodes.find((node) => node.kind === "base" && node.decisionEnabled && node.bubbleOpen && !node.decision)
    );
  }

  function clearHomeRunAnimationTimers() {
    homeRunAnimationTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId));
    homeRunAnimationTimerRefs.current = [];
  }

  useEffect(() => {
    setFieldPlay({
      activeNodeId: null,
      ballNodeId: null,
      nodes: [],
      segments: []
    });
    setAdvanceTarget(null);
    setManualAdvancePlay(null);
    setRunnerAnimations([]);
    setHomeRunAnimating(false);
    setPositionMovePoints({});
    setScoredRunners([]);
    onPlateActionLockChange(false);
    if (runnerAnimationTimerRef.current) {
      window.clearTimeout(runnerAnimationTimerRef.current);
      runnerAnimationTimerRef.current = null;
    }
    clearHomeRunAnimationTimers();
    if (advanceTargetTimerRef.current) {
      window.clearTimeout(advanceTargetTimerRef.current);
      advanceTargetTimerRef.current = null;
    }
    decisionBubbleTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId));
    decisionBubbleTimerRefs.current = [];
    Object.values(positionMoveAnimationFrameRefs.current).forEach((frameId) => window.cancelAnimationFrame(frameId));
    positionMoveAnimationFrameRefs.current = {};
    preForcedAdvanceRef.current = null;
  }, [resetToken]);

  useEffect(() => {
    return () => {
      if (runnerAnimationTimerRef.current) window.clearTimeout(runnerAnimationTimerRef.current);
      clearHomeRunAnimationTimers();
      if (advanceTargetTimerRef.current) window.clearTimeout(advanceTargetTimerRef.current);
      decisionBubbleTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId));
      Object.values(positionMoveAnimationFrameRefs.current).forEach((frameId) => window.cancelAnimationFrame(frameId));
      onPlateActionLockChange(false);
    };
  }, [onPlateActionLockChange]);

  useEffect(() => {
    const stage = stageRef.current;
    const fieldArt = fieldArtRef.current;
    if (!stage || !fieldArt) return;

    const syncFieldArtBox = () => {
      const stageRect = stage.getBoundingClientRect();
      const fieldArtRect = fieldArt.getBoundingClientRect();
      if (!fieldArtRect.width || !fieldArtRect.height) return;

      setFieldArtBox({
        left: fieldArtRect.left - stageRect.left,
        top: fieldArtRect.top - stageRect.top,
        width: fieldArtRect.width,
        height: fieldArtRect.height
      });
    };

    const frameId = window.requestAnimationFrame(syncFieldArtBox);
    const resizeObserver = new ResizeObserver(syncFieldArtBox);
    resizeObserver.observe(stage);
    resizeObserver.observe(fieldArt);
    fieldArt.addEventListener("load", syncFieldArtBox);
    window.addEventListener("resize", syncFieldArtBox);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      fieldArt.removeEventListener("load", syncFieldArtBox);
      window.removeEventListener("resize", syncFieldArtBox);
    };
  }, []);

  useEffect(() => {
    if (!runnerDrag) return;

    const scrollPosition = { x: window.scrollX, y: window.scrollY };
    dragLockScrollRef.current = scrollPosition;

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousHtmlOverscrollBehavior = html.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPosition = body.style.position;
    const previousBodyTop = body.style.top;
    const previousBodyLeft = body.style.left;
    const previousBodyWidth = body.style.width;
    const previousBodyTouchAction = body.style.touchAction;

    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollPosition.y}px`;
    body.style.left = "0";
    body.style.width = "100%";
    body.style.touchAction = "none";

    const preventDefault = (event: Event) => event.preventDefault();
    const preventZoomWheel = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };

    window.addEventListener("touchmove", preventDefault, { passive: false });
    window.addEventListener("wheel", preventZoomWheel, { passive: false });
    document.addEventListener("gesturestart", preventDefault as EventListener, { passive: false });
    document.addEventListener("gesturechange", preventDefault as EventListener, { passive: false });

    return () => {
      window.removeEventListener("touchmove", preventDefault);
      window.removeEventListener("wheel", preventZoomWheel);
      document.removeEventListener("gesturestart", preventDefault as EventListener);
      document.removeEventListener("gesturechange", preventDefault as EventListener);

      html.style.overflow = previousHtmlOverflow;
      html.style.overscrollBehavior = previousHtmlOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
      body.style.position = previousBodyPosition;
      body.style.top = previousBodyTop;
      body.style.left = previousBodyLeft;
      body.style.width = previousBodyWidth;
      body.style.touchAction = previousBodyTouchAction;

      const lockedScroll = dragLockScrollRef.current;
      if (lockedScroll) window.scrollTo(lockedScroll.x, lockedScroll.y);
      dragLockScrollRef.current = null;
    };
  }, [runnerDrag]);

  useEffect(() => {
    if (!runnerDrag) return;
    const fieldHitModeActive = Boolean(state.game.hitType) || fieldPlay.segments.some((segment) => segment.kind === "hit");

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      setRunnerDrag((current) => (current ? { ...current, x: event.clientX, y: event.clientY } : current));
    };

    const handlePointerUp = (event: globalThis.PointerEvent) => {
      const stageRect = fieldLayerRef.current?.getBoundingClientRect();
      const currentDrag = runnerDrag;
      setRunnerDrag(null);
      if (!stageRect || !currentDrag) return;

      const stagePoint = {
        x: event.clientX - stageRect.left,
        y: event.clientY - stageRect.top
      };
      const drop = getNearestDrop(stagePoint);
      if (!drop) return;

      if (drop.kind === "box" && currentDrag.source === "batter") {
        onBatterBoxChange(drop.box);
        return;
      }

      if (drop.kind !== "base") return;
      if (currentDrag.source !== "batter" && currentDrag.source === drop.destination) return;
      if (!canRunnerAdvanceToDestination(currentDrag.source, drop.destination, getRunnerIdForSource(currentDrag.source))) return;
      if (fieldHitModeActive) {
        clearHomeRunCandidateBubble();
        if (drop.destination === "home") {
          const advanceChain = getAdvanceChain(currentDrag.source, drop.destination);
          previewForcedAdvanceFlow(currentDrag.source, drop.destination);
          advanceChain
            .filter((step) => step.source !== currentDrag.source)
            .forEach((step) => {
              onRunnerMove(step.source, step.destination, "hit", getInitialHitLocation());
              if (step.destination === "home") {
                const runnerId = getPendingScoredRunnerId(step.source) ?? getRunnerIdForSource(step.source);
                markScoredRunnerArrived(step.source, runnerId);
                commitScoredRunner(step.source, runnerId);
              }
            });

          const openedDecision = openPreparedDecisionForRunner(currentDrag.source, "home", "hit");
          if (!openedDecision) {
            ensureManualAdvanceBaseNode(currentDrag.source, "home", false, false, "hit");
            addScoredRunner(currentDrag.source, false, false, currentDrag.source === "batter");
            onRunnerMove(currentDrag.source, "home", "hit", getInitialHitLocation());
          }
          setAdvanceTarget(null);
          return;
        }

        previewForcedAdvanceFlow(currentDrag.source, drop.destination);
        onRunnerMove(currentDrag.source, drop.destination, "hit", getInitialHitLocation());
        setAdvanceTarget(null);
        return;
      }

      if (isOpenPickoffDecision()) {
        const baseTarget = getBaseTargetForDestination(drop.destination);
        if (!baseTarget) return;

        setManualAdvancePlay({ source: currentDrag.source, destination: drop.destination });
        setAdvanceTarget(null);
        handleFieldTarget(baseTarget, currentDrag.source);
        return;
      }

      const destination = currentDrag.source === "batter" ? "first" : drop.destination;
      const point = currentDrag.source === "batter" ? getTargetPoint("base-first") : drop.point;
      openAdvanceTarget(currentDrag.source, destination, point, getAdvanceTitle(currentDrag.source, destination));
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [fieldPlay.segments, runnerDrag, state.game.hitType]);

  useEffect(() => {
    if (!pitchAdvanceRequest) return;
    if (handledPitchAdvanceRequestRef.current === pitchAdvanceRequest.id) return;

    handledPitchAdvanceRequestRef.current = pitchAdvanceRequest.id;
    startForcedAdvanceAnimation(() => onPitchAdvanceAnimationComplete(pitchAdvanceRequest.type));
  }, [pitchAdvanceRequest]);

  const bases = [
    { key: "base-first", className: "base-first", label: "一塁" },
    { key: "base-second", className: "base-second", label: "二塁" },
    { key: "base-third", className: "base-third", label: "三塁" },
    { key: "base-home", className: "base-home", label: "本塁" }
  ];
  const positions = [
    ["pos-left", 7],
    ["pos-center", 8],
    ["pos-right", 9],
    ["pos-short", 6],
    ["pos-second", 4],
    ["pos-third", 5],
    ["pos-first", 3],
    ["pos-pitcher", 1],
    ["pos-catcher", 2]
  ] as const;
  const outfieldOverTargets = [
    ["over-left", 7, "レフトオーバー"],
    ["over-center", 8, "センターオーバー"],
    ["over-right", 9, "ライトオーバー"]
  ] as const;

  const foulZones = [
    ["left", "foul-zone-left", "\u5de6\u30d5\u30a1\u30fc\u30eb\u30be\u30fc\u30f3"],
    ["right", "foul-zone-right", "\u53f3\u30d5\u30a1\u30fc\u30eb\u30be\u30fc\u30f3"]
  ] as const;

  function makeBaseTarget(base: { key: string; className: string; label: string }): FieldTarget {
    return { ...base, kind: "base" };
  }

  function getBaseTargetForDestination(destination: RunnerDestination) {
    const base = bases.find((current) => getBaseDestinationFromKey(current.key) === destination);
    return base ? makeBaseTarget(base) : null;
  }

  function ensureManualAdvanceBaseNode(
    source: RunnerSource,
    destination: RunnerDestination,
    decisionEnabled: boolean,
    bubbleOpen = decisionEnabled,
    advanceReason?: AdvanceReason
  ) {
    const baseTarget = getBaseTargetForDestination(destination);
    if (!baseTarget) return null;

    const targetPoint = getFieldPlayTargetPoint(baseTarget);
    const runnerId = destination === "home" ? getPendingScoredRunnerId(source) ?? getRunnerIdForSource(source) : getRunnerIdForSource(source);
    const existingNode = [...fieldPlay.nodes]
      .reverse()
      .find((node) => node.kind === "base" && node.key === baseTarget.key && node.runnerSource === source && !node.decision);
    const nodeId = existingNode?.id ?? `${baseTarget.key}-advance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setFieldSelection(baseTarget.key);
    onFieldPlayStarted();
    setFieldPlay((current) => {
      const existingNode = [...current.nodes]
        .reverse()
        .find((node) => node.kind === "base" && node.key === baseTarget.key && node.runnerSource === source && !node.decision);

      if (existingNode) {
          return {
            ...current,
            activeNodeId: bubbleOpen ? existingNode.id : current.activeNodeId,
            nodes: current.nodes.map((node) =>
              node.id === existingNode.id
                ? {
                    ...node,
                    point: targetPoint,
                    subject: getRunnerSubject(source),
                    runnerSource: source,
                    runnerId,
                    decisionEnabled,
                    bubbleOpen,
                    advanceReason
                  }
                : node
            )
          };
      }

      const node: FieldPlayNode = {
        ...baseTarget,
        id: nodeId,
        point: targetPoint,
        subject: getRunnerSubject(source),
        runnerSource: source,
        runnerId,
        decisionEnabled,
        bubbleOpen,
        advanceReason
      };

      return {
        ...current,
        activeNodeId: bubbleOpen ? node.id : current.activeNodeId,
        nodes: [...current.nodes, node]
      };
    });
    return nodeId;
  }

  function makePositionTarget(className: string, number: number): FieldTarget {
    return {
      key: `position-${number}`,
      className,
      label: String(number),
      kind: "position"
    };
  }

  function makeOutfieldOverTarget(className: string, number: number): FieldTarget {
    return {
      key: `position-${number}-over`,
      className,
      label: String(number),
      kind: "position",
      suppressDecisionBubble: true
    };
  }

  function makeFoulTarget(side: "left" | "right"): FieldTarget {
    return {
      key: `foul-${side}`,
      className: `foul-zone-${side}`,
      label: "\u25b3",
      kind: "foul",
      suppressDecisionBubble: true
    };
  }

  function setTargetRef(key: string, node: HTMLElement | null) {
    targetRefs.current[key] = node;
  }

  function getTargetPoint(key: string): FieldPoint {
    const target = targetRefs.current[key];
    const targetRect = target?.getBoundingClientRect();
    const layerRect = fieldLayerRef.current?.getBoundingClientRect();
    if (!targetRect || !layerRect) return { x: 0, y: 0 };

    return {
      x: targetRect.left - layerRect.left + targetRect.width / 2,
      y: targetRect.top - layerRect.top + targetRect.height / 2
    };
  }

  function getFieldAnchorStyle(key: keyof typeof FIELD_IMAGE_POINTS) {
    const point = FIELD_IMAGE_POINTS[key];
    return {
      left: `${(point.x / FIELD_IMAGE_WIDTH) * 100}%`,
      top: `${(point.y / FIELD_IMAGE_HEIGHT) * 100}%`
    } as CSSProperties;
  }

  function getFieldLayerStyle() {
    if (!fieldArtBox) return undefined;

    return {
      left: `${fieldArtBox.left}px`,
      top: `${fieldArtBox.top}px`,
      width: `${fieldArtBox.width}px`,
      height: `${fieldArtBox.height}px`
    } as CSSProperties;
  }

  function getRunnerSlotStyle(destination: RunnerDestination, point?: FieldPoint) {
    if (destination === "home") {
      return point ? ({ left: `${point.x}px`, top: `${point.y}px` } as CSSProperties) : undefined;
    }

    return getFieldAnchorStyle(`runner-slot-${destination}` as keyof typeof FIELD_IMAGE_POINTS);
  }

  function getFieldPlayTargetPoint(target: FieldTarget): FieldPoint {
    if (target.point) return target.point;
    return getTargetPoint(target.key);
  }

  function getBaseDestinationFromKey(key: string): RunnerDestination {
    return key.replace("base-", "") as RunnerDestination;
  }

  function getBaseKeyForDestination(destination: RunnerDestination) {
    return `base-${destination}`;
  }

  function getNextRunnerDestination(destination: Exclude<RunnerDestination, "home">): RunnerDestination {
    if (destination === "first") return "second";
    if (destination === "second") return "third";
    return "home";
  }

  function getClosestBaseDestination(point: FieldPoint): RunnerDestination {
    const baseTargets: RunnerDestination[] = ["first", "second", "third", "home"];
    return baseTargets
      .map((destination) => ({
        destination,
        distance: getDistance(point, getTargetPoint(getBaseKeyForDestination(destination)))
      }))
      .sort((a, b) => a.distance - b.distance)[0].destination;
  }

  function getRunnerSourceForDestination(destination: RunnerDestination): RunnerSource | null {
    const sourceForBase = (base: BaseKey): RunnerSource => {
      const runner = state.game.runners[base];
      return runner?.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder ? "batter" : base;
    };

    if (destination === "first") return state.game.runners.first ? sourceForBase("first") : "batter";
    if (destination === "second") return state.game.runners.second ? sourceForBase("second") : state.game.runners.first ? sourceForBase("first") : "batter";
    if (destination === "third") {
      return state.game.runners.third
        ? sourceForBase("third")
        : state.game.runners.second
          ? sourceForBase("second")
          : state.game.runners.first
            ? sourceForBase("first")
            : "batter";
    }

    return state.game.runners.third
      ? sourceForBase("third")
      : state.game.runners.second
        ? sourceForBase("second")
        : state.game.runners.first
          ? sourceForBase("first")
        : "batter";
  }

  function isCurrentBatterRunner(runner: { teamKey: TeamKey; battingOrder: number } | null | undefined) {
    return Boolean(runner && runner.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder);
  }

  function getRunnerBaseById(runnerId?: string) {
    if (!runnerId) return null;
    return (["first", "second", "third"] as BaseKey[]).find((base) => state.game.runners[base]?.id === runnerId) ?? null;
  }

  function getRunnerSourceById(runnerId?: string): RunnerSource | null {
    const base = getRunnerBaseById(runnerId);
    if (!base) return null;
    return isCurrentBatterRunner(state.game.runners[base]) ? "batter" : base;
  }

  function getPendingHomeRunner() {
    return [...scoredRunners].reverse().find((runner) => !runner.committed) ?? null;
  }

  function getPendingHomeRunnerSource(play = fieldPlay) {
    const pendingScoredRunner = [...scoredRunners].reverse().find((runner) => !runner.committed);
    if (pendingScoredRunner) return pendingScoredRunner.source;

    const pendingHomeNode = [...play.nodes]
      .reverse()
      .find((node) => node.kind === "base" && getBaseDestinationFromKey(node.key) === "home" && !node.decision);
    if (pendingHomeNode?.runnerSource) return pendingHomeNode.runnerSource;

    const homePoint = getRunnerDestinationPoint("home");
    const pendingAnimation = [...runnerAnimations]
      .reverse()
      .find((animation) => getDistance(animation.to, homePoint) < 2);
    return pendingAnimation?.source ?? null;
  }

  function getRunnerCurrentLocation(source: RunnerSource, runnerId?: string): RunnerSource | RunnerDestination | null {
    const baseById = getRunnerBaseById(runnerId);
    if (baseById) return baseById;
    if (runnerId && scoredRunners.some((runner) => runner.id === runnerId)) return "home";

    if (source === "batter") {
      return getCurrentBatterBase() ?? (showBatterRunner ? "batter" : null);
    }

    if (state.game.runners[source]) return source;
    if (scoredRunners.some((runner) => runner.source === source)) return "home";

    const fieldNode = [...fieldPlay.nodes]
      .reverse()
      .find(
        (node) =>
          node.kind === "base" &&
          node.runnerSource === source &&
          (!runnerId || node.runnerId === runnerId) &&
          Boolean(node.decision)
      );
    return fieldNode ? getBaseDestinationFromKey(fieldNode.key) : null;
  }

  function canRunnerBeJudgedAtDestination(source: RunnerSource | null, destination: RunnerDestination, runnerId?: string) {
    if (!source) return false;
    const currentLocation = getRunnerCurrentLocation(source, runnerId);
    if (!currentLocation) return false;
    return RUNNER_PROGRESS_RANK[destination] >= RUNNER_PROGRESS_RANK[currentLocation];
  }

  function canRunnerAdvanceToDestination(source: RunnerSource, destination: RunnerDestination, runnerId?: string) {
    const currentLocation = getRunnerCurrentLocation(source, runnerId);
    if (!currentLocation) return false;
    return RUNNER_PROGRESS_RANK[destination] > RUNNER_PROGRESS_RANK[currentLocation];
  }

  function getRunnerSourceAtBase(destination: RunnerDestination): RunnerSource | null {
    if (destination === "home") return getPendingHomeRunner()?.source ?? null;

    const runner = state.game.runners[destination];
    if (!runner) return null;
    return isCurrentBatterRunner(runner) ? "batter" : destination;
  }

  function getAnimatingRunnerSourceToDestination(destination: RunnerDestination): RunnerSource | null {
    const targetPoint = getRunnerDestinationPoint(destination);
    return runnerAnimations.find((animation) => getDistance(animation.to, targetPoint) < 2)?.source ?? null;
  }

  function getBaseDecisionRunnerSource(
    destination: RunnerDestination,
    explicitRunnerSource: RunnerSource | null | undefined,
    pickoffModeActive: boolean
  ): RunnerSource | null {
    if (explicitRunnerSource) {
      return canRunnerBeJudgedAtDestination(explicitRunnerSource, destination) ? explicitRunnerSource : null;
    }

    if (manualAdvancePlay) {
      return manualAdvancePlay.destination === destination && canRunnerBeJudgedAtDestination(manualAdvancePlay.source, destination)
        ? manualAdvancePlay.source
        : null;
    }

    if (pickoffModeActive) return getOccupiedBaseRunnerSource(destination);

    const sourceAtBase = getRunnerSourceAtBase(destination);
    if (sourceAtBase && canRunnerBeJudgedAtDestination(sourceAtBase, destination)) return sourceAtBase;

    const animatingSource = getAnimatingRunnerSourceToDestination(destination);
    if (animatingSource && canRunnerBeJudgedAtDestination(animatingSource, destination)) return animatingSource;

    return null;
  }

  function getOccupiedBaseRunnerSource(destination: RunnerDestination): RunnerSource | null {
    if (destination === "home") return null;

    const runner = state.game.runners[destination];
    if (!runner) return null;

    return runner.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder ? "batter" : destination;
  }

  function getRunnerIdForSource(source: RunnerSource | null) {
    if (!source) return undefined;

    if (source !== "batter") return state.game.runners[source]?.id;

    const existingBatterRunner = Object.values(state.game.runners).find(
      (runner) => runner?.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder
    );
    if (existingBatterRunner) return existingBatterRunner.id;

    const batter = getCurrentBatter(state);
    const jerseyNumber = normalizeNumber(batter?.jerseyNumber);
    return `${battingTeamKey}-${state.game.battingOrder}-${jerseyNumber || normalizeNumber(batter?.name) || "unknown"}`;
  }

  function getPendingScoredRunnerId(source: RunnerSource | null) {
    if (!source) return undefined;
    return [...scoredRunners].reverse().find((runner) => runner.source === source && !runner.committed)?.id;
  }

  function isRunnerAlreadyOnNodeBase(node: FieldPlayNode) {
    if (node.kind !== "base" || !node.runnerSource) return false;

    const destination = getBaseDestinationFromKey(node.key);
    if (destination === "home") return false;

    const runner = state.game.runners[destination];
    const nodeRunnerId = node.runnerId ?? getRunnerIdForSource(node.runnerSource);
    return Boolean(runner?.id && nodeRunnerId && runner.id === nodeRunnerId);
  }

  function isRunnerBeyondNodeBase(node: FieldPlayNode) {
    if (node.kind !== "base" || !node.runnerSource) return false;

    const destination = getBaseDestinationFromKey(node.key);
    const nodeRunnerId = node.runnerId ?? getRunnerIdForSource(node.runnerSource);
    const currentLocation = getRunnerCurrentLocation(node.runnerSource, nodeRunnerId);
    if (!currentLocation) return false;
    return RUNNER_PROGRESS_RANK[currentLocation] > RUNNER_PROGRESS_RANK[destination];
  }

  function isRunnerOut(source: RunnerSource, runnerId?: string) {
    const resolvedRunnerId = runnerId ?? getRunnerIdForSource(source);
    return Boolean(resolvedRunnerId && outRunnerIds.has(resolvedRunnerId)) || outRunnerSources.has(source);
  }

  function isRunnerInBasePlay(source: RunnerSource, runnerId?: string) {
    const resolvedRunnerId = runnerId ?? getRunnerIdForSource(source);
    return Boolean(resolvedRunnerId && basePlayRunnerIds.has(resolvedRunnerId)) || basePlayRunnerSources.has(source);
  }

  function isRunnerDecisionTarget(source: RunnerSource, runnerId?: string) {
    const resolvedRunnerId = runnerId ?? getRunnerIdForSource(source);
    return Boolean(resolvedRunnerId && decisionTargetRunnerIds.has(resolvedRunnerId)) || decisionTargetRunnerSources.has(source);
  }

  function getRunnerSubject(source: RunnerSource | null, fallback = "\u8d70\u8005") {
    if (source === "batter") return "\u6253\u8005\u8d70\u8005";
    if (source === "first") return "\u4e00\u5841\u8d70\u8005";
    if (source === "second") return "\u4e8c\u5841\u8d70\u8005";
    if (source === "third") return "\u4e09\u5841\u8d70\u8005";
    return fallback;
  }

  function isInitialHitNode(node: FieldPlayNode) {
    return fieldPlay.nodes[0]?.id === node.id && (node.kind === "position" || node.kind === "foul");
  }

  function isOutfieldOverNode(node: FieldPlayNode) {
    return node.kind === "position" && node.key.endsWith("-over");
  }

  function isHomeRunDecisionNode(node: FieldPlayNode) {
    return isInitialHitNode(node) && isOutfieldOverNode(node);
  }

  function isFoulCatchNode(node: FieldPlayNode) {
    if (node.kind !== "position" || !node.decisionEnabled) return false;
    const segment = fieldPlay.segments.find((current) => current.toNodeId === node.id);
    if (!segment?.fromNodeId) return false;
    const sourceNode = fieldPlay.nodes.find((current) => current.id === segment.fromNodeId);
    return sourceNode?.kind === "foul";
  }

  function isInitialHitDecisionNode(node: FieldPlayNode) {
    return isInitialHitNode(node) && node.kind === "position" && !isHomeRunDecisionNode(node);
  }

  function isSingleDecisionActionNode(node: FieldPlayNode) {
    return isFoulCatchNode(node) || isHomeRunDecisionNode(node);
  }

  function getResolvedRunnerSource(node: FieldPlayNode): RunnerSource | null {
    if (isInitialHitNode(node)) return "batter";
    if (node.runnerId) return getRunnerSourceById(node.runnerId) ?? node.runnerSource;
    if (node.kind === "base") return node.runnerSource ?? getRunnerSourceAtBase(getBaseDestinationFromKey(node.key));
    return node.runnerSource;
  }

  function getJudgementDestination(node: FieldPlayNode): RunnerDestination {
    if (node.kind === "base") return getBaseDestinationFromKey(node.key);
    return getClosestBaseDestination(node.point);
  }

  function getJudgementPoint(node: FieldPlayNode) {
    return getTargetPoint(getBaseKeyForDestination(getJudgementDestination(node)));
  }

  function hasOutgoingThrowSegment(nodeId: string) {
    return fieldPlay.segments.some((segment) => segment.kind === "throw" && segment.fromNodeId === nodeId);
  }

  function getPositionOriginPoint(node: FieldPlayNode) {
    if (node.kind === "position" && node.suppressDecisionBubble) return getTargetPoint(`position-${node.label}`);
    return node.point;
  }

  function isPositionDisplaced(node: FieldPlayNode, point = getNodeDisplayPoint(node)) {
    if (node.kind !== "position") return false;
    return getDistance(getPositionOriginPoint(node), point) > 1;
  }

  function getNodeActionPoint(node: FieldPlayNode) {
    return getNodeDisplayPoint(node);
  }

  function getNodeDisplayPoint(node: FieldPlayNode) {
    return node.displayPoint ?? node.point;
  }

  function getCurrentBallHolderNode(play = fieldPlay) {
    if (play.ballNodeId) {
      const explicitBallHolder = play.nodes.find((node) => node.id === play.ballNodeId) ?? null;
      if (explicitBallHolder) return explicitBallHolder;
    }

    const lastSegmentTargetNode = [...play.segments]
      .reverse()
      .map((segment) => play.nodes.find((node) => node.id === segment.toNodeId) ?? null)
      .find((node): node is FieldPlayNode => Boolean(node));
    if (lastSegmentTargetNode) return lastSegmentTargetNode;

    return [...play.nodes]
      .reverse()
      .find((node) => node.kind === "position" || node.kind === "base" || node.kind === "foul") ?? null;
  }

  function getBallHolderJudgementDestination(node: FieldPlayNode | null) {
    if (!node) return null;
    if (node.kind === "base") return getBaseDestinationFromKey(node.key);
    if (node.kind === "position") return node.label === "2" ? "home" : null;
    return null;
  }

  function getNodeBubblePoint(node: FieldPlayNode) {
    if (node.kind === "foul") {
      return {
        x: node.point.x + (node.key.endsWith("left") ? 34 : -34),
        y: node.point.y - 8
      };
    }
    if (isInitialHitNode(node)) return node.point;
    return getNodeActionPoint(node);
  }

  function getDecisionBubbleSize(node: FieldPlayNode) {
    if (isHomeRunDecisionNode(node)) {
      return { width: 102, height: 42 };
    }
    if (isSingleDecisionActionNode(node)) {
      return { width: 76, height: 42 };
    }
    return { width: 112, height: 48 };
  }

  function getDecisionBubbleEntries() {
    const visibleNodes = fieldPlay.nodes.filter((node) => {
      const canShowDecisionBubble =
        isHomeRunDecisionNode(node) ||
        (!node.suppressDecisionBubble &&
          (isFoulCatchNode(node) || isInitialHitNode(node) || (node.kind === "base" && node.decisionEnabled)));
      return canShowDecisionBubble && (node.decision || node.bubbleOpen || node.id === fieldPlay.activeNodeId);
    });
    const placementOrder = [...visibleNodes].sort((a, b) => {
      if (a.id === fieldPlay.activeNodeId) return -1;
      if (b.id === fieldPlay.activeNodeId) return 1;
      return 0;
    });
    const placedRects: { left: number; right: number; top: number; bottom: number }[] = [];
    const entries = new Map<string, { point: FieldPoint; shift: FieldPoint; zIndex: number }>();
    const bubbleInset = 6;
    const placementBounds = {
      left: bubbleInset,
      right: Math.max(bubbleInset, (fieldArtBox?.width ?? fieldLayerRef.current?.clientWidth ?? 0) - bubbleInset),
      top: bubbleInset,
      bottom: Math.max(bubbleInset, (fieldArtBox?.height ?? fieldLayerRef.current?.clientHeight ?? 0) - bubbleInset)
    };
    const candidates: FieldPoint[] = [
      { x: 0, y: 0 },
      { x: 0, y: -16 },
      { x: -24, y: -10 },
      { x: 24, y: -10 },
      { x: -34, y: 8 },
      { x: 34, y: 8 },
      { x: 0, y: -34 },
      { x: -34, y: -32 },
      { x: 34, y: -32 },
      { x: 0, y: 30 },
      { x: -34, y: 30 },
      { x: 34, y: 30 },
      { x: 0, y: -58 }
    ];
    const fieldObstacles = [
      ...positions.map(([, number]) => ({ point: getTargetPoint(`position-${number}`), size: 46, weakWhenAnchored: true })),
      ...bases.map((base) => ({ point: getTargetPoint(base.key), size: 46, weakWhenAnchored: true })),
      ...fieldPlay.nodes
        .filter((node) => node.kind === "position")
        .flatMap((node) => {
          const displayPoint = getNodeDisplayPoint(node);
          const moved = isPositionDisplaced(node, displayPoint);
          return [
            { point: displayPoint, size: 48, weakWhenAnchored: false },
            ...(moved ? [{ point: getPositionOriginPoint(node), size: 42, weakWhenAnchored: false }] : [])
          ];
        })
    ];

    const makeRect = (point: FieldPoint, shift: FieldPoint, bubbleSize: { width: number; height: number }) => {
      const bottom = point.y + shift.y - 22;
      return {
        left: point.x + shift.x - bubbleSize.width / 2,
        right: point.x + shift.x + bubbleSize.width / 2,
        top: bottom - bubbleSize.height,
        bottom
      };
    };
    const clampPlacement = (point: FieldPoint, shift: FieldPoint, bubbleSize: { width: number; height: number }) => {
      const rect = makeRect(point, shift, bubbleSize);
      let adjustX = 0;
      let adjustY = 0;

      if (rect.left < placementBounds.left) adjustX += placementBounds.left - rect.left;
      if (rect.right > placementBounds.right) adjustX -= rect.right - placementBounds.right;
      if (rect.top < placementBounds.top) adjustY += placementBounds.top - rect.top;
      if (rect.bottom > placementBounds.bottom) adjustY -= rect.bottom - placementBounds.bottom;

      const clampedShift = {
        x: shift.x + adjustX,
        y: shift.y + adjustY
      };
      return {
        shift: clampedShift,
        rect: makeRect(point, clampedShift, bubbleSize),
        penalty: (Math.abs(adjustX) + Math.abs(adjustY)) * 260
      };
    };
    const getOverlapArea = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) => {
      const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left) + 8);
      const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + 8);
      return overlapX * overlapY;
    };
    const rectFromPoint = (point: FieldPoint, size: number) => ({
      left: point.x - size / 2,
      right: point.x + size / 2,
      top: point.y - size / 2,
      bottom: point.y + size / 2
    });
    const getPointRectDistance = (point: FieldPoint, rect: { left: number; right: number; top: number; bottom: number }) => {
      const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
      const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
      return Math.hypot(dx, dy);
    };
    const getLinePenalty = (rect: { left: number; right: number; top: number; bottom: number }) => {
      return fieldPlay.segments.reduce((sum, segment) => {
        if (segment.kind === "run") return sum;
        let penalty = 0;
        for (let index = 0; index <= 16; index += 1) {
          const ratio = index / 16;
          const sourcePoint = getSegmentSourcePoint(segment);
          const targetPoint = getSegmentTargetPoint(segment);
          const point =
            getLinearPoint(sourcePoint, getVisibleLineEnd(sourcePoint, targetPoint, 24), ratio);
          const distance = getPointRectDistance(point, rect);
          if (distance < 1) penalty += segment.kind === "hit" ? 4200 : 3200;
          else if (distance < 14) penalty += (14 - distance) * 120;
        }
        return sum + penalty;
      }, 0);
    };

    for (const node of placementOrder) {
      const point = getNodeBubblePoint(node);
      const bubbleSize = getDecisionBubbleSize(node);
      const ranked = candidates
        .map((shift) => {
          const clamped = clampPlacement(point, shift, bubbleSize);
          const rect = clamped.rect;
          const bubbleOverlap = placedRects.reduce((sum, placed) => sum + getOverlapArea(rect, placed) * 2, 0);
          const obstacleOverlap = fieldObstacles.reduce((sum, obstacle) => {
            const isAnchorObstacle = obstacle.weakWhenAnchored && getDistance(obstacle.point, point) < 4;
            return sum + getOverlapArea(rect, rectFromPoint(obstacle.point, obstacle.size)) * (isAnchorObstacle ? 1.6 : 8);
          }, 0);
          const linePenalty = getLinePenalty(rect) * 0.72;
          const targetPenalty = Math.max(0, 14 - getPointRectDistance(point, rect)) * 50;
          const farPenalty = Math.max(0, Math.abs(shift.y) - 36) * 34 + Math.max(0, Math.abs(shift.x) - 34) * 28;
          const movementPenalty = Math.abs(shift.y) * 5.4 + Math.abs(shift.x) * 3.1 + farPenalty;
          return {
            shift: clamped.shift,
            rect,
            score: bubbleOverlap + obstacleOverlap + linePenalty + targetPenalty + movementPenalty + clamped.penalty
          };
        })
        .sort((a, b) => a.score - b.score || Math.abs(a.shift.y) - Math.abs(b.shift.y) || Math.abs(a.shift.x) - Math.abs(b.shift.x));
      const selected = ranked[0];
      placedRects.push(selected.rect);
      entries.set(node.id, {
        point,
        shift: selected.shift,
        zIndex: node.id === fieldPlay.activeNodeId ? 32 : 28
      });
    }

    return visibleNodes.map((node) => ({
      node,
      ...(entries.get(node.id) ?? { point: getNodeBubblePoint(node), shift: { x: 0, y: 0 }, zIndex: 28 })
    }));
  }

  function getHitPath(from: FieldPoint, to: FieldPoint, singleArc = false) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const safeDistance = distance || 1;
    const normalA = { x: -dy / safeDistance, y: dx / safeDistance };
    const normal = normalA.x <= 0 ? normalA : { x: -normalA.x, y: -normalA.y };
    const curve = Math.min(singleArc ? 138 : 142, Math.max(62, distance * (singleArc ? 0.34 : 0.32)));

    if (singleArc) {
      const control = {
        x: (from.x + to.x) / 2 + normal.x * curve,
        y: (from.y + to.y) / 2 + normal.y * curve
      };
      return `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`;
    }

    const bounce = {
      x: from.x + dx * 0.72,
      y: from.y + dy * 0.72
    };
    const firstControl = {
      x: from.x + (bounce.x - from.x) * 0.5 + normal.x * curve,
      y: from.y + (bounce.y - from.y) * 0.5 + normal.y * curve
    };
    const secondControl = {
      x: bounce.x + (to.x - bounce.x) * 0.48 + normal.x * curve * 0.48,
      y: bounce.y + (to.y - bounce.y) * 0.48 + normal.y * curve * 0.48
    };

    return `M ${from.x} ${from.y} Q ${firstControl.x} ${firstControl.y} ${bounce.x} ${bounce.y} Q ${secondControl.x} ${secondControl.y} ${to.x} ${to.y}`;
  }

  function getStraightPath(from: FieldPoint, to: FieldPoint) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }

  function getLinearPoint(from: FieldPoint, to: FieldPoint, ratio: number) {
    return {
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio
    };
  }

  function getCubicPoint(from: FieldPoint, control1: FieldPoint, control2: FieldPoint, to: FieldPoint, ratio: number) {
    const inverse = 1 - ratio;
    return {
      x:
        inverse ** 3 * from.x +
        3 * inverse ** 2 * ratio * control1.x +
        3 * inverse * ratio ** 2 * control2.x +
        ratio ** 3 * to.x,
      y:
        inverse ** 3 * from.y +
        3 * inverse ** 2 * ratio * control1.y +
        3 * inverse * ratio ** 2 * control2.y +
        ratio ** 3 * to.y
    };
  }

  function getDiamondCenter() {
    return ["base-first", "base-second", "base-third", "base-home"]
      .map((key) => getTargetPoint(key))
      .reduce(
        (sum, point, _, points) => ({
          x: sum.x + point.x / points.length,
          y: sum.y + point.y / points.length
        }),
        { x: 0, y: 0 }
      );
  }

  function getCoverRunEndpoints(from: FieldPoint, targetCenter: FieldPoint) {
    return {
      start: from,
      end: targetCenter
    };
  }

  function getPointToSegmentDistance(point: FieldPoint, from: FieldPoint, to: FieldPoint) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx ** 2 + dy ** 2;
    if (!lengthSquared) return getDistance(point, from);

    const ratio = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
    const projected = {
      x: from.x + dx * ratio,
      y: from.y + dy * ratio
    };
    return getDistance(point, projected);
  }

  function getPointSegmentRatio(point: FieldPoint, from: FieldPoint, to: FieldPoint) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx ** 2 + dy ** 2;
    if (!lengthSquared) return 0;
    return ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
  }

  function shouldCurveCoverRun(from: FieldPoint, targetCenter: FieldPoint, sourceNodeId?: string | null) {
    const { start, end } = getCoverRunEndpoints(from, targetCenter);
    const sourceNode = sourceNodeId ? fieldPlay.nodes.find((node) => node.id === sourceNodeId) : null;
    const sourcePositionLabel = sourceNode?.kind === "position" ? sourceNode.label : null;

    return positions.some(([, number]) => {
      if (sourcePositionLabel === String(number)) return false;

      const obstaclePoint = getTargetPoint(`position-${number}`);
      if (getDistance(obstaclePoint, start) < 30) return false;

      const ratio = getPointSegmentRatio(obstaclePoint, start, end);
      if (ratio < 0.08 || ratio > 0.98) return false;

      return getPointToSegmentDistance(obstaclePoint, start, end) < 30;
    });
  }

  function getCoverRunGeometry(from: FieldPoint, targetCenter: FieldPoint) {
    const { start, end } = getCoverRunEndpoints(from, targetCenter);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy) || 1;
    const forward = { x: dx / distance, y: dy / distance };
    const normal = { x: -forward.y, y: forward.x };
    const radius = distance / 2;
    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2
    };
    const diamondCenter = getDiamondCenter();
    const arcPeakA = {
      x: midpoint.x + normal.x * radius,
      y: midpoint.y + normal.y * radius
    };
    const arcPeakB = {
      x: midpoint.x - normal.x * radius,
      y: midpoint.y - normal.y * radius
    };
    const outward = getDistance(arcPeakA, diamondCenter) >= getDistance(arcPeakB, diamondCenter) ? normal : { x: -normal.x, y: -normal.y };
    const peak = {
      x: midpoint.x + outward.x * radius,
      y: midpoint.y + outward.y * radius
    };
    const handle = radius * 0.5522847498;
    const firstControl1 = {
      x: start.x + outward.x * handle,
      y: start.y + outward.y * handle
    };
    const firstControl2 = {
      x: peak.x - forward.x * handle,
      y: peak.y - forward.y * handle
    };
    const secondControl1 = {
      x: peak.x + forward.x * handle,
      y: peak.y + forward.y * handle
    };
    const secondControl2 = {
      x: end.x + outward.x * handle,
      y: end.y + outward.y * handle
    };

    return { start, firstControl1, firstControl2, peak, secondControl1, secondControl2, end };
  }

  function splitCubicAt(from: FieldPoint, control1: FieldPoint, control2: FieldPoint, to: FieldPoint, ratio: number) {
    const point01 = getLinearPoint(from, control1, ratio);
    const point12 = getLinearPoint(control1, control2, ratio);
    const point23 = getLinearPoint(control2, to, ratio);
    const point012 = getLinearPoint(point01, point12, ratio);
    const point123 = getLinearPoint(point12, point23, ratio);
    const point0123 = getLinearPoint(point012, point123, ratio);

    return {
      start: from,
      control1: point01,
      control2: point012,
      end: point0123
    };
  }

  function getCoverRunGeometryPoint(geometry: ReturnType<typeof getCoverRunGeometry>, ratio: number) {
    if (ratio <= 0.5) return getCubicPoint(geometry.start, geometry.firstControl1, geometry.firstControl2, geometry.peak, ratio * 2);
    return getCubicPoint(geometry.peak, geometry.secondControl1, geometry.secondControl2, geometry.end, (ratio - 0.5) * 2);
  }

  function getCoverRunVisibleRatio(geometry: ReturnType<typeof getCoverRunGeometry>, targetCenter: FieldPoint, inset: number) {
    let low = 0;
    let high = 1;

    for (let index = 0; index < 12; index += 1) {
      const midpoint = (low + high) / 2;
      const distance = getDistance(getCoverRunGeometryPoint(geometry, midpoint), targetCenter);
      if (distance > inset) low = midpoint;
      else high = midpoint;
    }

    return low;
  }

  function getCoverRunPath(from: FieldPoint, targetCenter: FieldPoint, sourceNodeId?: string | null) {
    if (!shouldCurveCoverRun(from, targetCenter, sourceNodeId)) {
      const { start } = getCoverRunEndpoints(from, targetCenter);
      const end = getVisibleLineEnd(start, targetCenter, 16);
      return getStraightPath(start, end);
    }

    const geometry = getCoverRunGeometry(from, targetCenter);
    const visibleRatio = getCoverRunVisibleRatio(geometry, targetCenter, 16);

    if (visibleRatio <= 0.5) {
      const firstCurve = splitCubicAt(geometry.start, geometry.firstControl1, geometry.firstControl2, geometry.peak, visibleRatio * 2);
      return `M ${firstCurve.start.x} ${firstCurve.start.y} C ${firstCurve.control1.x} ${firstCurve.control1.y} ${firstCurve.control2.x} ${firstCurve.control2.y} ${firstCurve.end.x} ${firstCurve.end.y}`;
    }

    const secondCurve = splitCubicAt(geometry.peak, geometry.secondControl1, geometry.secondControl2, geometry.end, (visibleRatio - 0.5) * 2);
    return `M ${geometry.start.x} ${geometry.start.y} C ${geometry.firstControl1.x} ${geometry.firstControl1.y} ${geometry.firstControl2.x} ${geometry.firstControl2.y} ${geometry.peak.x} ${geometry.peak.y} C ${secondCurve.control1.x} ${secondCurve.control1.y} ${secondCurve.control2.x} ${secondCurve.control2.y} ${secondCurve.end.x} ${secondCurve.end.y}`;
  }

  function getCoverRunPoint(from: FieldPoint, targetCenter: FieldPoint, ratio: number, sourceNodeId?: string | null) {
    if (!shouldCurveCoverRun(from, targetCenter, sourceNodeId)) {
      const { start, end } = getCoverRunEndpoints(from, targetCenter);
      return getLinearPoint(start, end, ratio);
    }

    const { start, firstControl1, firstControl2, peak, secondControl1, secondControl2, end } = getCoverRunGeometry(from, targetCenter);
    return getCoverRunGeometryPoint({ start, firstControl1, firstControl2, peak, secondControl1, secondControl2, end }, ratio);
  }

  function startPositionCoverAnimation(nodeId: string, from: FieldPoint, to: FieldPoint, onComplete?: () => void) {
    const existingFrame = positionMoveAnimationFrameRefs.current[nodeId];
    if (existingFrame) window.cancelAnimationFrame(existingFrame);

    const duration = 360;
    const startTime = performance.now();

    setPositionMovePoints((current) => ({
      ...current,
      [nodeId]: getLinearPoint(from, to, 0)
    }));

    const tick = (time: number) => {
      const progress = Math.min(1, (time - startTime) / duration);
      const easedProgress = 1 - (1 - progress) ** 3;
      const point = getLinearPoint(from, to, easedProgress);

      setPositionMovePoints((current) => ({
        ...current,
        [nodeId]: point
      }));

      if (progress < 1) {
        positionMoveAnimationFrameRefs.current[nodeId] = window.requestAnimationFrame(tick);
        return;
      }

      delete positionMoveAnimationFrameRefs.current[nodeId];
      setPositionMovePoints((current) => {
        const { [nodeId]: _finishedPoint, ...next } = current;
        return next;
      });
      onComplete?.();
    };

    positionMoveAnimationFrameRefs.current[nodeId] = window.requestAnimationFrame(tick);
  }

  function activateFieldDecisionNode(nodeId: string) {
    setFieldPlay((current) =>
      current.nodes.some((node) => node.id === nodeId)
        ? {
            ...current,
            activeNodeId: nodeId,
            nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, bubbleOpen: true } : node))
          }
        : current
    );
  }

  function openFieldDecisionBubbles(nodeIds: string[], activeNodeId?: string | null) {
    if (!nodeIds.length) return;
    const targetIds = new Set(nodeIds);
    setFieldPlay((current) => ({
      ...current,
      activeNodeId: activeNodeId ?? current.activeNodeId,
      nodes: current.nodes.map((node) => (targetIds.has(node.id) && !node.decision ? { ...node, bubbleOpen: true } : node))
    }));
  }

  function scheduleFieldDecisionBubbles(nodeIds: string[], activeNodeId?: string | null, delay = 360) {
    if (!nodeIds.length) return;
    decisionBubbleTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId));
    decisionBubbleTimerRefs.current = [];
    const timerId = window.setTimeout(() => {
      decisionBubbleTimerRefs.current = decisionBubbleTimerRefs.current.filter((currentId) => currentId !== timerId);
      openFieldDecisionBubbles(nodeIds, activeNodeId);
    }, delay);
    decisionBubbleTimerRefs.current.push(timerId);
  }

  function getAdvanceChain(source: RunnerSource, destination: RunnerDestination) {
    const steps: { source: RunnerSource; destination: RunnerDestination }[] = [{ source, destination }];
    const sourceLocation = getRunnerCurrentLocation(source, getRunnerIdForSource(source));
    if (!sourceLocation) return steps;

    const visitedSources = new Set<RunnerSource>([source]);
    const basesToCheck = (["first", "second", "third"] as const)
      .filter(
        (base) =>
          RUNNER_PROGRESS_RANK[base] > RUNNER_PROGRESS_RANK[sourceLocation] &&
          RUNNER_PROGRESS_RANK[base] <= RUNNER_PROGRESS_RANK[destination]
      )
      .sort((left, right) => RUNNER_PROGRESS_RANK[right] - RUNNER_PROGRESS_RANK[left]);

    basesToCheck.forEach((base) => {
      const occupiedSource = getOccupiedBaseRunnerSource(base);
      if (!occupiedSource || visitedSources.has(occupiedSource)) return;
      visitedSources.add(occupiedSource);
      steps.push({ source: occupiedSource, destination: getNextRunnerDestination(base) });
    });

    return steps;
  }

  function getForcedAdvanceSteps(source: RunnerSource, destination: RunnerDestination, advanceReason: AdvanceReason) {
    return getAdvanceChain(source, destination).map((step) => ({ ...step, advanceReason }));
  }

  function previewForcedAdvanceFlow(source: RunnerSource, destination: RunnerDestination) {
    const steps = getAdvanceChain(source, destination);
    if (steps.length <= 1) return false;

    steps.forEach((step, index) => {
      ensureManualAdvanceBaseNode(step.source, step.destination, false, false);
      if (index > 0) startFieldRunnerAnimation(step.source, step.destination);
      if (step.destination === "home") addScoredRunner(step.source, false, false, step.source === "batter");
    });

    return true;
  }

  function clearHomeRunCandidateBubble() {
    setFieldPlay((current) => ({
      ...current,
      activeNodeId:
        current.activeNodeId && current.nodes.some((node) => node.id === current.activeNodeId && isHomeRunDecisionNode(node))
          ? null
          : current.activeNodeId,
      nodes: current.nodes.map((node) => (isHomeRunDecisionNode(node) && !node.decision ? { ...node, bubbleOpen: false } : node))
    }));
  }

  function beginForcedAdvanceDecisionFlow(source: RunnerSource, destination: RunnerDestination, advanceReason: AdvanceReason) {
    const steps = getForcedAdvanceSteps(source, destination, advanceReason);
    if (steps.length <= 1) return false;

    const nodeIds = steps
      .map((step) => ensureManualAdvanceBaseNode(step.source, step.destination, true, false, step.advanceReason))
      .filter((nodeId): nodeId is string => Boolean(nodeId));

    steps.forEach((step) => {
      startFieldRunnerAnimation(step.source, step.destination);
      if (step.destination === "home") addScoredRunner(step.source, false, true, step.source === "batter");
    });

    if (nodeIds.length > 0) {
      scheduleFieldDecisionBubbles(nodeIds, nodeIds[0]);
    }

    return true;
  }

  function getVisibleLineStart(from: FieldPoint, to: FieldPoint, inset = 18) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= inset + 8) return from;
    const ratio = inset / distance;
    return {
      x: from.x + dx * ratio,
      y: from.y + dy * ratio
    };
  }

  function getVisibleLineEnd(from: FieldPoint, to: FieldPoint, inset = 18) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= inset + 8) return to;
    const ratio = (distance - inset) / distance;
    return {
      x: from.x + dx * ratio,
      y: from.y + dy * ratio
    };
  }

  function isPointOnPositionCircle(point: FieldPoint) {
    return positions.some(([, number]) => getDistance(point, getTargetPoint(`position-${number}`)) < 2);
  }

  function getThrowTargetInset(targetNode: FieldPlayNode | undefined, targetPoint: FieldPoint) {
    if (targetNode?.kind === "position" || isPointOnPositionCircle(targetPoint)) return 18;
    if (targetNode?.kind === "base") return 13;
    return 0;
  }

  function getThrowSourceInset(sourceNode: FieldPlayNode | null, sourcePoint: FieldPoint) {
    if (sourceNode?.kind === "position" || isPointOnPositionCircle(sourcePoint)) return 18;
    return 0;
  }

  function getVisibleThrowSegment(from: FieldPoint, to: FieldPoint, sourceInset: number, targetInset: number) {
    const distance = getDistance(from, to);
    if (!distance) return { from, to };

    const startRatio = Math.min(0.48, sourceInset / distance);
    const endRatio = Math.max(0, Math.min(1, (distance - targetInset) / distance));
    if (endRatio <= startRatio) {
      const midpoint = getLinearPoint(from, to, 0.5);
      return { from: midpoint, to: midpoint };
    }

    return {
      from: getLinearPoint(from, to, startRatio),
      to: getLinearPoint(from, to, endRatio)
    };
  }

  function isPositionTrailMoving(node: FieldPlayNode) {
    const moving = positionMovePoints[node.id];
    const displaced = isPositionDisplaced(node, moving ?? getNodeDisplayPoint(node));
    return node.showPositionTrail !== false && displaced;
  }

  function getPositionLineSourcePoint(node: FieldPlayNode, segmentKind: FieldPlaySegment["kind"]) {
    const originPoint = getPositionOriginPoint(node);
    if (segmentKind === "run") {
      if (isPositionDisplaced(node)) return originPoint;
      return getNodeActionPoint(node);
    }

    if (segmentKind === "throw" && hasOutgoingThrowSegment(node.id) && isPositionDisplaced(node, positionMovePoints[node.id] ?? getNodeDisplayPoint(node))) {
      return positionMovePoints[node.id] ?? getNodeActionPoint(node);
    }

    if (isPositionTrailMoving(node)) {
      return originPoint;
    }
    if (positionMovePoints[node.id]) {
      return positionMovePoints[node.id];
    }

    return getNodeActionPoint(node);
  }

  function getSegmentTargetPoint(segment: FieldPlaySegment) {
    const targetNode = fieldPlay.nodes.find((node) => node.id === segment.toNodeId);
    if (targetNode?.kind !== "position") return segment.to;
    if (segment.kind === "run") return targetNode.displayPoint ?? segment.to;
    if (segment.kind === "throw") return positionMovePoints[targetNode.id] ?? targetNode.displayPoint ?? segment.to;

    if (isPositionTrailMoving(targetNode)) return targetNode.point;
    return targetNode.displayPoint ?? segment.to;
  }

  function isFoulFlyOutSegment(segment: FieldPlaySegment) {
    const targetNode = fieldPlay.nodes.find((node) => node.id === segment.toNodeId);
    if (targetNode?.kind !== "foul") return false;

    const followSegment = fieldPlay.segments.find((current) => current.fromNodeId === targetNode.id);
    if (!followSegment) return false;

    const followNode = fieldPlay.nodes.find((node) => node.id === followSegment.toNodeId);
    return followNode?.kind === "position" && followNode.decision === "fly-out";
  }

  function getSegmentSourcePoint(segment: FieldPlaySegment) {
    const sourceNode = segment.fromNodeId ? fieldPlay.nodes.find((node) => node.id === segment.fromNodeId) : null;
    if (sourceNode?.kind !== "position") return segment.from;
    return getPositionLineSourcePoint(sourceNode, segment.kind);
  }

  function getSegmentPath(segment: FieldPlaySegment) {
    const targetNode = fieldPlay.nodes.find((node) => node.id === segment.toNodeId);
    const sourceNode = segment.fromNodeId ? fieldPlay.nodes.find((node) => node.id === segment.fromNodeId) ?? null : null;
    const sourcePoint = getSegmentSourcePoint(segment);
    const targetPoint = getSegmentTargetPoint(segment);
    if (segment.kind === "hit") {
      return getHitPath(
        sourcePoint,
        getVisibleLineEnd(sourcePoint, targetPoint, 24),
        targetNode?.decision === "fly-out" || targetNode?.decision === "home-run" || isFoulFlyOutSegment(segment)
      );
    }
    if (segment.kind === "run") return getCoverRunPath(sourcePoint, targetPoint, segment.fromNodeId);
    if (segment.kind === "throw") {
      const visibleThrow = getVisibleThrowSegment(
        sourcePoint,
        targetPoint,
        getThrowSourceInset(sourceNode, sourcePoint),
        getThrowTargetInset(targetNode, targetPoint)
      );
      return getStraightPath(visibleThrow.from, visibleThrow.to);
    }

    const visibleTo = getVisibleLineEnd(sourcePoint, targetPoint, 24);
    return getStraightPath(sourcePoint, visibleTo);
  }

  function getCurrentBatterBase() {
    return (["first", "second", "third"] as BaseKey[]).find((base) => {
      const runner = state.game.runners[base];
      return runner?.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder;
    });
  }

  function getRunnerPointForSource(source: RunnerSource) {
    if (source === "batter") {
      const batterBase = getCurrentBatterBase();
      return getTargetPoint(batterBase ? `runner-${batterBase}` : "runner-batter");
    }

    return getTargetPoint(`runner-${source}`);
  }

  function getRunnerDestinationPoint(destination: RunnerDestination) {
    if (destination === "home") return getHomePendingPoint();
    return getTargetPoint(`runner-slot-${destination}`);
  }

  function getHomePendingPoint(index = 0, total = 1): FieldPoint {
    const homePoint = getTargetPoint("base-home");
    const verticalSpread = (index - (total - 1) / 2) * 24;
    return {
      x: homePoint.x + 48,
      y: homePoint.y - 6 + verticalSpread
    };
  }

  function getFieldRunnerImageForSource(source: RunnerSource) {
    const runnerImageSrc = ownBatting ? RUNNER_RED_ASSET : RUNNER_BLUE_ASSET;
    if (source !== "batter") return runnerImageSrc;
    return currentBatterIsOnBase ? runnerImageSrc : ownBatting ? "assets/batter-red.png" : "assets/batter-blue.png";
  }

  function startFieldRunnerAnimation(source: RunnerSource, destination: RunnerDestination) {
    if (destination !== "home" && source === destination) return;

    const id = `field-runner-${source}-${destination}-${Date.now()}`;
    const batterFromBox = source === "batter" && !currentBatterIsOnBase;
    const animation: RunnerAnimation = {
      id,
      source,
      from: getRunnerPointForSource(source),
      to: getRunnerDestinationPoint(destination),
      imageSrc: getFieldRunnerImageForSource(source),
      batter: batterFromBox,
      mirrored: batterFromBox && currentBatterBox === "left"
    };

    setRunnerAnimations((current) => [...current.filter((runnerAnimation) => runnerAnimation.source !== source), animation]);
    window.setTimeout(() => {
      setRunnerAnimations((current) => current.filter((runnerAnimation) => runnerAnimation.id !== id));
    }, 360);
  }

  function buildForcedHitAdvanceAnimations(): RunnerAnimation[] {
    const runnerImageSrc = ownBatting ? RUNNER_RED_ASSET : RUNNER_BLUE_ASSET;
    const batterImageSrc = ownBatting ? "assets/batter-red.png" : "assets/batter-blue.png";
    const animations: RunnerAnimation[] = [
      {
        id: `advance-batter-${Date.now()}`,
        source: "batter",
        from: getTargetPoint("runner-batter"),
        to: getTargetPoint("runner-slot-first"),
        imageSrc: batterImageSrc,
        batter: true,
        mirrored: currentBatterBox === "left"
      }
    ];

    if (state.game.runners.first) {
      animations.push({
        id: `advance-first-${Date.now()}`,
        source: "first",
        from: getTargetPoint("runner-first"),
        to: getTargetPoint("runner-slot-second"),
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
    }

    if (state.game.runners.first && state.game.runners.second) {
      animations.push({
        id: `advance-second-${Date.now()}`,
        source: "second",
        from: getTargetPoint("runner-second"),
        to: getTargetPoint("runner-slot-third"),
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
    }

    if (state.game.runners.first && state.game.runners.second && state.game.runners.third) {
      animations.push({
        id: `advance-third-${Date.now()}`,
        source: "third",
        from: getTargetPoint("runner-third"),
        to: getHomePendingPoint(),
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
    }

    return animations;
  }

  function getRunnerImageForSource(source: RunnerSource) {
    if (source === "batter") return ownBatting ? "assets/batter-red.png" : "assets/batter-blue.png";
    return ownBatting ? RUNNER_RED_ASSET : RUNNER_BLUE_ASSET;
  }

  function addScoredRunner(source: RunnerSource, committed = true, arrived = committed, forceRunnerVisual = false) {
    const batterRunner = Object.values(state.game.runners).find(
      (runner) => runner?.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder
    );
    const scoredRunner = source === "batter" ? batterRunner : state.game.runners[source];
    const visualId = scoredRunner?.id ?? `${source}-${battingTeamKey}-${state.game.battingOrder}`;
    const isBatterIcon = source === "batter" && !scoredRunner && !forceRunnerVisual;
    const nextImageSrc = isBatterIcon ? getRunnerImageForSource("batter") : getRunnerImageForSource("first");

    setScoredRunners((current) => {
      const existingRunner = current.find((runner) => runner.id === visualId);
      if (existingRunner) {
        const nextCommitted = existingRunner.committed || committed;
        const nextArrived = existingRunner.arrived || arrived;
        if (
          existingRunner.committed === nextCommitted &&
          existingRunner.arrived === nextArrived &&
          existingRunner.batter === isBatterIcon &&
          existingRunner.imageSrc === nextImageSrc
        ) {
          return current;
        }
        return current.map((runner) =>
          runner.id === visualId
            ? {
                ...runner,
                imageSrc: nextImageSrc,
                batter: isBatterIcon,
                committed: nextCommitted,
                arrived: nextArrived
              }
            : runner
        );
      }

      return [
        ...current,
        {
          id: visualId,
          source,
          teamKey: battingTeamKey,
          imageSrc: nextImageSrc,
          batter: isBatterIcon,
          arrived,
          committed
        }
      ];
    });
  }

  function commitScoredRunner(source: RunnerSource | null, runnerId?: string) {
    if (!source && !runnerId) return;

    setScoredRunners((current) =>
      current.map((runner) =>
        (runnerId && runner.id === runnerId) || (!runnerId && source && runner.source === source)
          ? { ...runner, arrived: true, committed: true }
          : runner
      )
    );
  }

  function markScoredRunnerArrived(source: RunnerSource | null, runnerId?: string) {
    if (!source && !runnerId) return;

    setScoredRunners((current) =>
      current.map((runner) =>
        (runnerId && runner.id === runnerId) || (!runnerId && source && runner.source === source) ? { ...runner, arrived: true } : runner
      )
    );
  }

  function commitArrivedScoredRunners() {
    setScoredRunners((current) =>
      current.map((runner) => (runner.arrived && !runner.committed ? { ...runner, committed: true } : runner))
    );
  }

  function getScoredRunnerDecisionNode(runner: ScoredRunnerVisual) {
    const reversedNodes = [...homePlayRunnerNodes].reverse();
    return (
      reversedNodes.find((node) => node.runnerId && node.runnerId === runner.id) ??
      reversedNodes.find((node) => node.runnerSource === runner.source) ??
      null
    );
  }

  function startForcedAdvanceAnimation(onComplete: () => void) {
    if (runnerAnimationTimerRef.current) window.clearTimeout(runnerAnimationTimerRef.current);
    const thirdRunnerWillScore = Boolean(state.game.runners.first && state.game.runners.second && state.game.runners.third);
    setRunnerAnimations(buildForcedHitAdvanceAnimations());
    runnerAnimationTimerRef.current = window.setTimeout(() => {
      if (thirdRunnerWillScore) addScoredRunner("third", false, true);
      onComplete();
      setRunnerAnimations([]);
      runnerAnimationTimerRef.current = null;
    }, 360);
  }

  function startForcedHitAdvanceAnimation(hitLocation?: string, onComplete?: () => void) {
    startForcedAdvanceAnimation(() => {
      onAdvance("batter", "hit", hitLocation);
      onComplete?.();
    });
  }

  function startHomeRunAnimation() {
    clearHomeRunAnimationTimers();
    if (runnerAnimationTimerRef.current) {
      window.clearTimeout(runnerAnimationTimerRef.current);
      runnerAnimationTimerRef.current = null;
    }
    setRunnerAnimations([]);
    commitArrivedScoredRunners();
    setHomeRunAnimating(true);
    onPlateActionLockChange(true);

    const phases: RunnerAnimation[][] = [];
    const phaseScores: RunnerSource[][] = [];
    const pushPhaseAnimation = (phaseIndex: number, animation: RunnerAnimation) => {
      if (!phases[phaseIndex]) phases[phaseIndex] = [];
      phases[phaseIndex].push(animation);
    };
    const pushPhaseScore = (phaseIndex: number, source: RunnerSource) => {
      if (!phaseScores[phaseIndex]) phaseScores[phaseIndex] = [];
      phaseScores[phaseIndex].push(source);
    };

    const runnerImageSrc = ownBatting ? RUNNER_RED_ASSET : RUNNER_BLUE_ASSET;
    const batterImageSrc = ownBatting ? "assets/batter-red.png" : "assets/batter-blue.png";
    const homePoint = getHomePendingPoint();
    const phaseDuration = 360;
    const now = Date.now();
    const batterBase = getCurrentBatterBase();
    const isBatterRunnerAt = (base: BaseKey) => batterBase === base;

    if (state.game.runners.third && !isBatterRunnerAt("third")) {
      pushPhaseAnimation(0, {
        id: `hr-third-0-${now}`,
        source: "third",
        from: getTargetPoint("runner-third"),
        to: homePoint,
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseScore(0, "third");
    }

    if (state.game.runners.second && !isBatterRunnerAt("second")) {
      pushPhaseAnimation(0, {
        id: `hr-second-0-${now}`,
        source: "second",
        from: getTargetPoint("runner-second"),
        to: getTargetPoint("runner-slot-third"),
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseAnimation(1, {
        id: `hr-second-1-${now}`,
        source: "second",
        from: getTargetPoint("runner-slot-third"),
        to: homePoint,
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseScore(1, "second");
    }

    if (state.game.runners.first && !isBatterRunnerAt("first")) {
      pushPhaseAnimation(0, {
        id: `hr-first-0-${now}`,
        source: "first",
        from: getTargetPoint("runner-first"),
        to: getTargetPoint("runner-slot-second"),
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseAnimation(1, {
        id: `hr-first-1-${now}`,
        source: "first",
        from: getTargetPoint("runner-slot-second"),
        to: getTargetPoint("runner-slot-third"),
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseAnimation(2, {
        id: `hr-first-2-${now}`,
        source: "first",
        from: getTargetPoint("runner-slot-third"),
        to: homePoint,
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseScore(2, "first");
    }

    if (!batterBase) {
      pushPhaseAnimation(0, {
        id: `hr-batter-0-${now}`,
        source: "batter",
        from: getTargetPoint("runner-batter"),
        to: getTargetPoint("runner-slot-first"),
        imageSrc: batterImageSrc,
        batter: true,
        mirrored: currentBatterBox === "left"
      });
      pushPhaseAnimation(1, {
        id: `hr-batter-1-${now}`,
        source: "batter",
        from: getTargetPoint("runner-slot-first"),
        to: getTargetPoint("runner-slot-second"),
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseAnimation(2, {
        id: `hr-batter-2-${now}`,
        source: "batter",
        from: getTargetPoint("runner-slot-second"),
        to: getTargetPoint("runner-slot-third"),
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseAnimation(3, {
        id: `hr-batter-3-${now}`,
        source: "batter",
        from: getTargetPoint("runner-slot-third"),
        to: homePoint,
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseScore(3, "batter");
    } else if (batterBase === "first") {
      pushPhaseAnimation(0, {
        id: `hr-batter-1-${now}`,
        source: "batter",
        from: getTargetPoint("runner-first"),
        to: getTargetPoint("runner-slot-second"),
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseAnimation(1, {
        id: `hr-batter-2-${now}`,
        source: "batter",
        from: getTargetPoint("runner-slot-second"),
        to: getTargetPoint("runner-slot-third"),
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseAnimation(2, {
        id: `hr-batter-3-${now}`,
        source: "batter",
        from: getTargetPoint("runner-slot-third"),
        to: homePoint,
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseScore(2, "batter");
    } else if (batterBase === "second") {
      pushPhaseAnimation(0, {
        id: `hr-batter-2-${now}`,
        source: "batter",
        from: getTargetPoint("runner-second"),
        to: getTargetPoint("runner-slot-third"),
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseAnimation(1, {
        id: `hr-batter-3-${now}`,
        source: "batter",
        from: getTargetPoint("runner-slot-third"),
        to: homePoint,
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseScore(1, "batter");
    } else {
      pushPhaseAnimation(0, {
        id: `hr-batter-3-${now}`,
        source: "batter",
        from: getTargetPoint("runner-third"),
        to: homePoint,
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
      pushPhaseScore(0, "batter");
    }

    const effectivePhases = phases
      .map((phase, index) => ({ phase, scores: phaseScores[index] ?? [] }))
      .filter((entry) => entry.phase?.length);
    if (!effectivePhases.length) {
      setHomeRunAnimating(false);
      onPlateActionLockChange(false);
      onLiveScorePreview();
      return;
    }

    effectivePhases.forEach(({ phase, scores }, phaseIndex) => {
      const startTimer = window.setTimeout(() => {
        setRunnerAnimations(phase);
      }, phaseIndex * phaseDuration);
      homeRunAnimationTimerRefs.current.push(startTimer);

      const endTimer = window.setTimeout(() => {
        setRunnerAnimations((current) => current.filter((animation) => !phase.some((step) => step.id === animation.id)));
        scores.forEach((source) => addScoredRunner(source, true, true, source === "batter"));
        if (phaseIndex === effectivePhases.length - 1) {
          setHomeRunAnimating(false);
          onLiveScorePreview();
          onPlateActionLockChange(false);
        }
      }, (phaseIndex + 1) * phaseDuration);
      homeRunAnimationTimerRefs.current.push(endTimer);
    });
  }

  function handleHomeRunLikePlay() {
    setAdvanceTarget(null);
    setManualAdvancePlay(null);
    onHomeRun();
    startHomeRunAnimation();
  }

  function getDistance(a: FieldPoint, b: FieldPoint) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function getNearestDrop(point: FieldPoint) {
    const baseTargets: { key: string; destination: RunnerDestination }[] = [
      { key: "base-first", destination: "first" },
      { key: "base-second", destination: "second" },
      { key: "base-third", destination: "third" },
      { key: "base-home", destination: "home" }
    ];
    const boxTargets: { key: string; box: BatterBox }[] = [
      { key: "batter-box-right", box: "right" },
      { key: "batter-box-left", box: "left" }
    ];
    const nearestBase = baseTargets
      .map((target) => ({ ...target, distance: getDistance(point, getTargetPoint(target.key)) }))
      .sort((a, b) => a.distance - b.distance)[0];
    const nearestBox = boxTargets
      .map((target) => ({ ...target, distance: getDistance(point, getTargetPoint(target.key)) }))
      .sort((a, b) => a.distance - b.distance)[0];

    if (nearestBox && nearestBox.distance < 72 && (!nearestBase || nearestBox.distance < nearestBase.distance)) {
      return { kind: "box" as const, box: nearestBox.box };
    }

    if (nearestBase && nearestBase.distance < 92) {
      return { kind: "base" as const, destination: nearestBase.destination, point: getTargetPoint(nearestBase.key) };
    }

    return null;
  }

  function getDecisionSubject(target: FieldTarget) {
    if (target.kind === "position") return "野手";
    const source = getDecisionRunnerSource(target);
    if (source === "batter") return "打者走者";
    if (source === "first") return "一塁走者";
    if (source === "second") return "二塁走者";
    if (source === "third") return "三塁走者";
    return "走者";
  }

  function getDecisionRunnerSource(target: FieldTarget): RunnerSource | null {
    if (target.kind === "position") return "batter";
    const destination = target.key.replace("base-", "") as RunnerDestination;
    const sourceForBase = (base: BaseKey): RunnerSource => {
      const runner = state.game.runners[base];
      return runner?.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder ? "batter" : base;
    };

    if (destination === "first") return state.game.runners.first ? sourceForBase("first") : "batter";
    if (destination === "second") return state.game.runners.second ? sourceForBase("second") : state.game.runners.first ? sourceForBase("first") : "batter";
    if (destination === "third") {
      return state.game.runners.third
        ? sourceForBase("third")
        : state.game.runners.second
          ? sourceForBase("second")
          : state.game.runners.first
            ? sourceForBase("first")
            : "batter";
    }
    if (destination === "home") {
      return state.game.runners.third
        ? sourceForBase("third")
        : state.game.runners.second
          ? sourceForBase("second")
          : state.game.runners.first
            ? sourceForBase("first")
            : "batter";
    }

    return null;
  }

  function getDecisionRunnerSourceForTarget(target: FieldTarget, point: FieldPoint, isInitialHit: boolean): RunnerSource | null {
    if (isInitialHit) return "batter";
    if (target.kind === "base" && manualAdvancePlay) return manualAdvancePlay.source;
    if (target.kind === "position" || target.kind === "foul") return null;
    return getRunnerSourceForDestination(getBaseDestinationFromKey(target.key));
  }

  function getDecisionSubjectForTarget(target: FieldTarget, point: FieldPoint, isInitialHit: boolean) {
    if (isInitialHit) return "\u6253\u7403";
    return getRunnerSubject(getDecisionRunnerSourceForTarget(target, point, isInitialHit));
  }

  function getInitialFieldingPositionNode() {
    return (
      fieldPlay.nodes.find(
        (current) => current.kind === "position" && fieldPlay.segments.some((segment) => segment.kind === "hit" && segment.toNodeId === current.id)
      ) ?? fieldPlay.nodes.find((current) => current.kind === "position")
    );
  }

  function getPreviousPositionNode(node: FieldPlayNode) {
    const incomingSegment = fieldPlay.segments.find((segment) => segment.toNodeId === node.id);
    return fieldPlay.nodes.find((current) => current.kind === "position" && current.id === incomingSegment?.fromNodeId);
  }

  function getPreviousRunnerSource(destination: RunnerDestination): BaseKey | null {
    if (destination === "second") return "first";
    if (destination === "third") return "second";
    if (destination === "home") return "third";
    return null;
  }

  function hasPreexistingRunner(base: BaseKey) {
    const runner = state.game.runners[base];
    if (!runner) return false;
    return !(runner.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder);
  }

  function isRunnerForcedToDestination(source: BaseKey, destination: RunnerDestination) {
    if (getNextRunnerDestination(source) !== destination) return false;
    if (source === "first") return true;
    if (source === "second") return hasPreexistingRunner("first");
    if (source === "third") return hasPreexistingRunner("first") && hasPreexistingRunner("second");
    return false;
  }

  function getForceOutRunnerSource(node: FieldPlayNode, destination: RunnerDestination): BaseKey | null {
    if (node.runnerSource === "first" || node.runnerSource === "second" || node.runnerSource === "third") {
      if (isRunnerForcedToDestination(node.runnerSource, destination)) return node.runnerSource;
    }

    if (node.runnerSource !== destination || destination === "first") return null;

    const runner = state.game.runners[destination];
    const latestAdvance = runner?.scoreAdvances[runner.scoreAdvances.length - 1];
    if (latestAdvance?.destination !== destination || latestAdvance.reason !== "hit") return null;
    const previousRunnerSource = getPreviousRunnerSource(destination);
    return previousRunnerSource && isRunnerForcedToDestination(previousRunnerSource, destination) ? previousRunnerSource : null;
  }

  function getRunnerForceOutResultLabel(node: FieldPlayNode) {
    if (node.runnerSource === "batter" || node.kind !== "base" || !hasHitPlay()) return "";
    if (node.runnerSource !== "first" && node.runnerSource !== "second" && node.runnerSource !== "third") return "";

    const destination = getBaseDestinationFromKey(node.key);
    if (!getForceOutRunnerSource(node, destination)) return "";

    const fieldingPosition = getInitialFieldingPositionNode()?.label ?? getPreviousPositionNode(node)?.label;
    const coveringPosition = getForceOutCoveringPosition(destination, fieldingPosition);
    return fieldingPosition ? `${fieldingPosition}-${coveringPosition}` : "";
  }

  function getRunnerThrowOutResultLabel(node: FieldPlayNode) {
    if (node.runnerSource === "batter" || node.kind !== "base" || hasHitPlay()) return "";
    if (node.runnerSource !== "first" && node.runnerSource !== "second" && node.runnerSource !== "third") return "";

    const destination = getBaseDestinationFromKey(node.key);
    const previousPosition = getPreviousPositionNode(node);
    const catcherThrowAfterPitch = state.plate.pitches.some((pitch) => pitch === "\u2715" || pitch === "\u25cf");
    const fieldingPosition = catcherThrowAfterPitch ? "2" : previousPosition?.label;
    const coveringPosition =
      previousPosition?.label && previousPosition.label !== fieldingPosition
        ? previousPosition.label
        : getForceOutCoveringPosition(destination, fieldingPosition);

    return fieldingPosition && coveringPosition ? `${fieldingPosition}-${coveringPosition}` : "";
  }

  function getRunnerTagOutResultLabel(node: FieldPlayNode) {
    if (node.runnerSource === "batter" || node.kind !== "base" || !hasHitPlay()) return "";
    if (node.runnerSource !== "first" && node.runnerSource !== "second" && node.runnerSource !== "third") return "";

    const destination = getBaseDestinationFromKey(node.key);
    if (getForceOutRunnerSource(node, destination)) return "";

    const fieldingPosition = getInitialFieldingPositionNode()?.label ?? getPreviousPositionNode(node)?.label;
    const tagPosition = getPreviousPositionNode(node)?.label ?? getForceOutCoveringPosition(destination, fieldingPosition);
    return fieldingPosition && tagPosition ? `${fieldingPosition}-${tagPosition} T.O` : "走死";
  }

  function isFoulFlyOutNode(node: FieldPlayNode) {
    const incomingSegment = fieldPlay.segments.find((segment) => segment.toNodeId === node.id);
    const incomingNode = fieldPlay.nodes.find((current) => current.id === incomingSegment?.fromNodeId);
    const lastNode = fieldPlay.nodes[fieldPlay.nodes.length - 1];
    return incomingNode?.kind === "foul" || (node.kind === "position" && !fieldPlay.nodes.some((current) => current.id === node.id) && lastNode?.kind === "foul");
  }

  function getPreviousForceOutLabel(node: FieldPlayNode) {
    const nodeIndex = fieldPlay.nodes.findIndex((current) => current.id === node.id);
    if (nodeIndex <= 0) return "";

    const previousForceOutNode = fieldPlay.nodes
      .slice(0, nodeIndex)
      .reverse()
      .find((current) => current.kind === "base" && current.decision === "out" && current.runnerSource !== "batter" && getRunnerForceOutResultLabel(current));
    return previousForceOutNode ? getRunnerForceOutResultLabel(previousForceOutNode) : "";
  }

  function getBatterGroundOutFieldingPosition(node: FieldPlayNode, destination: RunnerDestination, initialFieldingPosition?: string | number) {
    if (destination !== "first") return initialFieldingPosition;
    return getRelayFieldingPosition(getPreviousForceOutLabel(node)) || initialFieldingPosition;
  }

  function getFieldOutResultLabel(node: FieldPlayNode) {
    if (node.runnerSource !== "batter") return getRunnerForceOutResultLabel(node) || getRunnerTagOutResultLabel(node) || getRunnerThrowOutResultLabel(node) || "走死";

    const resultPositionNode = node.kind === "position" ? node : getInitialFieldingPositionNode();
    const positionNumber = Number(resultPositionNode?.label);
    if (node.kind === "base") {
      const destination = getBaseDestinationFromKey(node.key);
      const fieldingPosition = getBatterGroundOutFieldingPosition(node, destination, resultPositionNode?.label);
      return (
        formatBatterGroundOutResultLabel({
          destination,
          fieldingPosition,
          coveringPosition: getPreviousPositionNode(node)?.label
        }) || "アウト"
      );
    }
    return fieldOutResultLabels[positionNumber] ?? "アウト";
  }

  function getFieldFlyOutResultLabel(node: FieldPlayNode) {
    return formatFlyOutResultLabel(node.label, isFoulFlyOutNode(node)) || "アウト";
  }

  function resolveAdvanceReasonForNode(node: FieldPlayNode, resolvedRunnerSource: RunnerSource, decision: "safe" | "error") {
    if (decision === "error") return "error";
    if (node.advanceReason) return node.advanceReason;
    if (manualAdvancePlay?.source === resolvedRunnerSource && manualAdvancePlay.destination === getJudgementDestination(node) && manualAdvancePlay.reason) {
      return manualAdvancePlay.reason;
    }
    return hasHitPlay() ? "hit" : "passed-ball";
  }

  function finalizeHomeRunnerIfSafe(node: FieldPlayNode) {
    const resolvedRunnerSource = getResolvedRunnerSource(node);
    if (!resolvedRunnerSource) return;

    const resolvedRunnerId = node.runnerId ?? getRunnerIdForSource(resolvedRunnerSource);
    const homeRunnerVisual = resolvedRunnerId ? scoredRunners.find((runner) => runner.id === resolvedRunnerId) : null;

    if (!homeRunnerVisual?.arrived && canRunnerBeJudgedAtDestination(resolvedRunnerSource, "home", resolvedRunnerId)) {
      onRunnerMove(resolvedRunnerSource, "home", resolveAdvanceReasonForNode(node, resolvedRunnerSource, "safe"), getInitialHitLocation());
      markScoredRunnerArrived(resolvedRunnerSource, resolvedRunnerId);
    }
    commitScoredRunner(resolvedRunnerSource, resolvedRunnerId);
    onLiveScorePreview();
  }

  function openPreparedDecisionForRunner(source: RunnerSource, destination: RunnerDestination, advanceReason: AdvanceReason) {
    const ballHolderNode = getCurrentBallHolderNode();
    if (!ballHolderNode) return false;
    if (getBallHolderJudgementDestination(ballHolderNode) !== destination) return false;

    const nodeId = ensureManualAdvanceBaseNode(source, destination, true, true, advanceReason);
    if (!nodeId) return false;
    if (destination === "home") addScoredRunner(source, false, false, source === "batter");
    return true;
  }

  function handleFieldTarget(target: FieldTarget, runnerSourceOverride?: RunnerSource | null) {
    if (homeRunAnimating) return;
    if (homeRunPlayLocked) return;
    const lastNode = fieldPlay.nodes[fieldPlay.nodes.length - 1];
    const isPendingFoulCatch = lastNode?.kind === "foul" && target.kind === "position";
    if (target.kind === "position" && lastNode?.kind === "position" && target.label === lastNode.label) {
      return;
    }
    if (lastNode?.kind === "foul" && target.kind !== "position") {
      return;
    }

    const fieldHitModeActive = hasHitPlay();
    const runnerAdvanceModeActive = Boolean(runnerDrag || advanceTarget || manualAdvancePlay || runnerSourceOverride);
    const baseDestination = target.kind === "base" ? getBaseDestinationFromKey(target.key) : null;
    const occupiedBaseRunnerSource = baseDestination ? getOccupiedBaseRunnerSource(baseDestination) : null;
    const pickoffModeActive = target.kind === "base" && !fieldHitModeActive && !runnerAdvanceModeActive && Boolean(occupiedBaseRunnerSource);
    const runnerFieldSequenceActive = !fieldHitModeActive && (runnerAdvanceModeActive || pickoffModeActive || lastNode?.kind === "base");

    if (deadBallPending) {
      return;
    }
    if (liveCountPending) {
      if (target.kind === "foul") {
        return;
      }
      if (target.key.endsWith("-over")) {
        return;
      }
      if (target.kind === "position" && !runnerFieldSequenceActive) {
        return;
      }
    }

    const baseDecisionRunnerSource = baseDestination
      ? getBaseDecisionRunnerSource(baseDestination, runnerSourceOverride, pickoffModeActive)
      : null;
    const baseDecisionEnabled = target.kind === "base" && Boolean(baseDecisionRunnerSource) && (fieldHitModeActive || runnerAdvanceModeActive || pickoffModeActive);
    if (target.kind === "base" && !baseDecisionEnabled) {
      return;
    }
    if (target.kind === "foul") {
      const canStartFoulPlay =
        !lastNode && !runnerDrag && !advanceTarget && !manualAdvancePlay && !pitchAdvanceRequest && !Boolean(state.plate.result);
      if (!canStartFoulPlay || !onFieldFoulStart()) {
        return;
      }
    }

    const targetPoint = getFieldPlayTargetPoint(target);
    const homePoint = getTargetPoint("base-home");
    const catcherThrowAfterPitch = state.plate.pitches.some((pitch) => pitch === "\u2715" || pitch === "\u25cf");
    const initialThrowPoint = getTargetPoint(catcherThrowAfterPitch ? "position-2" : "position-1");
    const currentBallHolderNode = getCurrentBallHolderNode();
    const shouldAutoAdvanceBatterOnHit = !fieldPlay.nodes.length && target.kind === "position" && !runnerAdvanceModeActive;
    const shouldDelayHomeRunDecisionBubble = shouldAutoAdvanceBatterOnHit && target.kind === "position" && target.key.endsWith("-over");
    const pendingHomeRunnerSource = getPendingHomeRunnerSource();
    const runnerSource =
      isPendingFoulCatch
        ? "batter"
        : target.kind === "base"
        ? baseDecisionRunnerSource
        : runnerSourceOverride ?? (pickoffModeActive ? occupiedBaseRunnerSource : getDecisionRunnerSourceForTarget(target, targetPoint, shouldAutoAdvanceBatterOnHit));
    const createdNodeId = `${target.key}-${Date.now()}-${fieldPlay.nodes.length}`;
    const delayedBaseDecisionSourceNode = target.kind === "base" && baseDecisionEnabled && lastNode?.kind === "position" ? lastNode : null;
    const shouldDelayBaseDecisionBubble = Boolean(delayedBaseDecisionSourceNode);
    const foulCatchAnimationFrom =
      isPendingFoulCatch && target.kind === "position"
        ? getTargetPoint(`position-${target.label}` as keyof typeof FIELD_IMAGE_POINTS)
        : null;
    const foulCatchAnimationTo = isPendingFoulCatch ? lastNode?.point ?? null : null;
    const delayedBaseDecisionAnimationFrom = delayedBaseDecisionSourceNode ? getNodeDisplayPoint(delayedBaseDecisionSourceNode) : null;
    const nodeRunnerId =
      target.kind === "base" && baseDestination === "home"
        ? getPendingScoredRunnerId(runnerSource) ?? target.runnerId ?? getRunnerIdForSource(runnerSource)
        : target.runnerId ?? getRunnerIdForSource(runnerSource);
    const shouldSkipPendingHomeAnimation =
      target.kind === "base" && baseDestination === "home" && Boolean(runnerSource && pendingHomeRunnerSource === runnerSource);
    if (target.kind === "base" && runnerSource && !shouldSkipPendingHomeAnimation) {
      startFieldRunnerAnimation(runnerSource, getBaseDestinationFromKey(target.key));
    }
    if (target.kind === "base" && runnerSource && getBaseDestinationFromKey(target.key) === "home" && !shouldSkipPendingHomeAnimation) {
      addScoredRunner(runnerSource, false, false, runnerSource === "batter");
    }
    setFieldSelection(target.key);
    setAdvanceTarget(null);
    onFieldPlayStarted();
    if (shouldAutoAdvanceBatterOnHit) {
      preForcedAdvanceRef.current = {
        runners: structuredClone(state.game.runners),
        ownScore: state.game.ownScore,
        opponentScore: state.game.opponentScore
      };
      const initialHitLocation = target.kind === "position" && target.key.endsWith("-over") ? `${target.label}+` : target.label;
      startForcedHitAdvanceAnimation(initialHitLocation, shouldDelayHomeRunDecisionBubble ? () => activateFieldDecisionNode(createdNodeId) : undefined);
    }
    if (shouldDelayBaseDecisionBubble && delayedBaseDecisionSourceNode && delayedBaseDecisionAnimationFrom) {
      startPositionCoverAnimation(delayedBaseDecisionSourceNode.id, delayedBaseDecisionAnimationFrom, targetPoint, () => {
        activateFieldDecisionNode(createdNodeId);
      });
    }

    setFieldPlay((current) => {
      const lastNode = current.nodes[current.nodes.length - 1];
      const isFirstTarget = !lastNode;
      const isInitialHit = isFirstTarget && (target.kind === "position" || target.kind === "foul");
      const currentFoulCatchMode = lastNode?.kind === "foul" && target.kind === "position";
      const lastNodeHasIncomingSegment = lastNode ? current.segments.some((segment) => segment.toNodeId === lastNode.id) : false;
      const shouldUseInitialThrowFromPendingBase = target.kind === "position" && lastNode?.kind === "base" && !lastNodeHasIncomingSegment;
      const ballHolderNodeForSegment =
        shouldUseInitialThrowFromPendingBase && currentBallHolderNode && currentBallHolderNode.id !== lastNode?.id ? currentBallHolderNode : null;
      const shouldUseBallHolderFromPendingBase = Boolean(ballHolderNodeForSegment);
      const segmentSourceNodeId = shouldUseBallHolderFromPendingBase
        ? ballHolderNodeForSegment?.id ?? null
        : shouldUseInitialThrowFromPendingBase
          ? null
          : lastNode?.id ?? null;
      const segmentSourcePoint = shouldUseBallHolderFromPendingBase
        ? getNodeActionPoint(ballHolderNodeForSegment!)
        : shouldUseInitialThrowFromPendingBase
          ? initialThrowPoint
          : lastNode
            ? getNodeActionPoint(lastNode)
            : isInitialHit
              ? homePoint
              : initialThrowPoint;
      const segmentKind =
        isInitialHit ? "hit" : currentFoulCatchMode ? "run" : target.kind === "base" && isFirstTarget ? "throw" : target.kind === "base" ? "run" : "throw";
      const node: FieldPlayNode = {
        ...target,
        id: createdNodeId,
        point: targetPoint,
        subject: isInitialHit ? (target.kind === "foul" ? "\u30d5\u30a1\u30fc\u30eb" : "\u6253\u7403") : currentFoulCatchMode ? "\u30d5\u30e9\u30a4" : getRunnerSubject(runnerSource),
        runnerSource,
        runnerId: nodeRunnerId,
        ...(currentFoulCatchMode ? { decision: "fly-out" as FieldDecision } : {}),
        decisionEnabled:
          (isInitialHit && target.kind === "position") ||
          currentFoulCatchMode ||
          (target.kind === "base" && baseDecisionEnabled),
        ...((target.kind === "base" || shouldDelayHomeRunDecisionBubble)
          ? { bubbleOpen: !shouldDelayBaseDecisionBubble && !shouldDelayHomeRunDecisionBubble }
          : {}),
        ...(currentFoulCatchMode ? { displayPoint: lastNode?.point, showPositionTrail: true } : {})
      };

      return {
        activeNodeId: shouldDelayBaseDecisionBubble || shouldDelayHomeRunDecisionBubble ? null : node.id,
        ballNodeId: target.kind === "position" || target.kind === "base" || target.kind === "foul" ? node.id : current.ballNodeId,
        nodes: [
          ...current.nodes.map((currentNode) =>
            delayedBaseDecisionSourceNode && currentNode.id === delayedBaseDecisionSourceNode.id && currentNode.kind === "position"
              ? { ...currentNode, displayPoint: targetPoint, showPositionTrail: true }
              : currentNode
          ),
          node
        ],
        segments: [
          ...current.segments,
          {
            id: `segment-${Date.now()}-${current.segments.length}`,
            fromNodeId: segmentSourceNodeId,
            toNodeId: node.id,
            from: segmentSourcePoint,
            to: targetPoint,
            kind: segmentKind
          }
        ]
      };
    });

    if (isPendingFoulCatch && foulCatchAnimationFrom && foulCatchAnimationTo) {
      startPositionCoverAnimation(createdNodeId, foulCatchAnimationFrom, foulCatchAnimationTo);
      if (runnerAnimationTimerRef.current) {
        window.clearTimeout(runnerAnimationTimerRef.current);
        runnerAnimationTimerRef.current = null;
      }
      setRunnerAnimations([]);
      onFieldOutDecision(
        createdNodeId,
        "batter",
        getFieldFlyOutResultLabel({
          ...target,
          id: createdNodeId,
          point: targetPoint,
          subject: "\u30d5\u30e9\u30a4",
          runnerSource: "batter",
          decision: "fly-out",
          decisionEnabled: true
        } as FieldPlayNode),
        getRunnerIdForSource("batter")
      );
    }

    if (target.kind === "position" && target.label === "2" && fieldHitModeActive) {
      const homeDecisionSource = pendingHomeRunnerSource ?? getPendingHomeRunnerSource();
      if (homeDecisionSource) {
        const homeNodeId = ensureManualAdvanceBaseNode(homeDecisionSource, "home", true, true, "hit");
        if (homeNodeId) {
          window.requestAnimationFrame(() => activateFieldDecisionNode(homeNodeId));
        }
      }
    }
  }

  function chooseDecision(nodeId: string, decision: FieldDecision) {
    const decidedNode = fieldPlay.nodes.find((node) => node.id === nodeId);
    const isInitialHitErrorDecision = decision === "error" && Boolean(decidedNode && isInitialHitDecisionNode(decidedNode));
    const isHomeRunDecision = decision === "home-run" && Boolean(decidedNode && isHomeRunDecisionNode(decidedNode));
    if (decidedNode?.kind !== "base" && decision !== "fly-out" && !isInitialHitErrorDecision && !isHomeRunDecision) return;
    if (decidedNode?.kind === "base" && !decidedNode.decisionEnabled) return;

    if (isHomeRunDecision && decidedNode) {
      setFieldPlay((current) => ({
        ...current,
        activeNodeId: nodeId,
        nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, decision: "home-run" as FieldDecision } : node))
      }));
      handleHomeRunLikePlay();
      return;
    }

    const resolvedRunnerSource = decidedNode ? getResolvedRunnerSource(decidedNode) : null;
    const resolvedRunnerId = decidedNode?.runnerId ?? getRunnerIdForSource(resolvedRunnerSource);
    if (decidedNode?.kind === "base" && !canRunnerBeJudgedAtDestination(resolvedRunnerSource, getJudgementDestination(decidedNode), resolvedRunnerId)) {
      return;
    }
    const segmentToDecision = fieldPlay.segments.find((segment) => segment.toNodeId === nodeId);
    const shouldSnapDecisionPosition =
      Boolean(decidedNode) && decidedNode?.kind === "position" && !isInitialHitNode(decidedNode) && (decision === "out" || decision === "safe" || decision === "error");
    const snappedDecisionPoint = shouldSnapDecisionPosition && decidedNode ? getJudgementPoint(decidedNode) : null;
    const coverPositionNode =
      decidedNode?.kind === "base" && (decision === "out" || decision === "safe" || decision === "error")
        ? fieldPlay.nodes.find((node) => node.id === segmentToDecision?.fromNodeId && node.kind === "position")
        : undefined;

    if (coverPositionNode && decidedNode) {
      startPositionCoverAnimation(coverPositionNode.id, getNodeDisplayPoint(coverPositionNode), decidedNode.point);
    }
    if (decidedNode && snappedDecisionPoint) {
      startPositionCoverAnimation(decidedNode.id, getNodeDisplayPoint(decidedNode), snappedDecisionPoint);
    }

    setFieldPlay((current) => {
      const currentDecidedNode = current.nodes.find((node) => node.id === nodeId);
      const segmentToDecision = current.segments.find((segment) => segment.toNodeId === nodeId);
      const coverPositionNodeId =
        currentDecidedNode?.kind === "base" && (decision === "out" || decision === "safe" || decision === "error")
          ? segmentToDecision?.fromNodeId
          : undefined;
      const shouldSnapCurrentDecisionPosition =
        Boolean(currentDecidedNode) &&
        currentDecidedNode?.kind === "position" &&
        current.nodes[0]?.id !== currentDecidedNode.id &&
        (decision === "out" || decision === "safe" || decision === "error");
      const currentSnappedDecisionPoint = shouldSnapCurrentDecisionPosition && currentDecidedNode ? getJudgementPoint(currentDecidedNode) : null;
      const updatedSegments = current.segments.map((segment) =>
        currentSnappedDecisionPoint && segment.toNodeId === nodeId ? { ...segment, to: currentSnappedDecisionPoint } : segment
      );

      return {
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id === nodeId) {
            return {
              ...node,
              decision,
              runnerSource: resolvedRunnerSource,
              runnerId: resolvedRunnerId,
              ...(currentSnappedDecisionPoint ? { displayPoint: currentSnappedDecisionPoint, showPositionTrail: true } : {})
            };
          }
          if (coverPositionNodeId === node.id && node.kind === "position") {
            return { ...node, displayPoint: currentDecidedNode?.point, showPositionTrail: true };
          }
          return node;
        }),
        segments: updatedSegments
      };
    });

    if (!decidedNode) return;

    if (decision === "fly-out" && resolvedRunnerSource) {
      if (resolvedRunnerSource === "batter" && runnerAnimationTimerRef.current) {
        window.clearTimeout(runnerAnimationTimerRef.current);
        runnerAnimationTimerRef.current = null;
        setRunnerAnimations([]);
      }
      if (isInitialHitDecisionNode(decidedNode) && preForcedAdvanceRef.current) {
        onRevertForcedAdvance(preForcedAdvanceRef.current);
        setScoredRunners([]);
        preForcedAdvanceRef.current = null;
      }
      onFieldOutDecision(
        decidedNode.id,
        resolvedRunnerSource,
        getFieldFlyOutResultLabel({ ...decidedNode, runnerSource: resolvedRunnerSource }),
        resolvedRunnerId
      );
      return;
    }

    if (decision === "out" && resolvedRunnerSource) {
      if (resolvedRunnerSource === "batter" && runnerAnimationTimerRef.current) {
        window.clearTimeout(runnerAnimationTimerRef.current);
        runnerAnimationTimerRef.current = null;
        setRunnerAnimations([]);
      }
      setManualAdvancePlay(null);
      onFieldOutDecision(
        decidedNode.id,
        resolvedRunnerSource,
        getFieldOutResultLabel(decidedNode),
        resolvedRunnerId,
        decidedNode.kind === "base" ? getBaseDestinationFromKey(decidedNode.key) : undefined
      );
      return;
    }

    if (decision === "error" && isInitialHitErrorDecision) {
      if (runnerAnimationTimerRef.current) {
        window.clearTimeout(runnerAnimationTimerRef.current);
        runnerAnimationTimerRef.current = null;
      }
      setRunnerAnimations([]);
      onFieldDecisionCleared(nodeId);
      onInitialFieldErrorDecision(getInitialFieldingPositionNode()?.label);
      return;
    }

    onFieldDecisionCleared(nodeId);

    if ((decision === "safe" || decision === "error") && resolvedRunnerSource) {
      const destination = decidedNode.kind === "base" ? getBaseDestinationFromKey(decidedNode.key) : getClosestBaseDestination(decidedNode.point);
      const currentRunnerLocation = getRunnerCurrentLocation(resolvedRunnerSource, resolvedRunnerId);
      const homeRunnerVisual =
        destination === "home" && resolvedRunnerId
          ? scoredRunners.find((runner) => runner.id === resolvedRunnerId)
          : null;
      const runnerAlreadyThere =
        destination === "home" ? Boolean(homeRunnerVisual?.arrived) : currentRunnerLocation === destination;
      const throwErrorFieldingLabel =
        decision === "error" && resolvedRunnerSource === "batter" && decidedNode.kind === "base" ? getFieldOutResultLabel(decidedNode) : "";
      const throwErrorResultLabel = /^[1-9](?:-[1-9])?A?$/.test(throwErrorFieldingLabel) ? `${throwErrorFieldingLabel}E` : undefined;
      if (runnerAlreadyThere && throwErrorResultLabel) {
        onThrowErrorDecision(throwErrorResultLabel);
      } else if (!runnerAlreadyThere) {
        if (destination === "home") addScoredRunner(resolvedRunnerSource, false, false, resolvedRunnerSource === "batter");
        onRunnerMove(
          resolvedRunnerSource,
          destination,
          resolveAdvanceReasonForNode(decidedNode, resolvedRunnerSource, decision),
          getInitialHitLocation(),
          throwErrorResultLabel
        );
        if (destination === "home") markScoredRunnerArrived(resolvedRunnerSource, resolvedRunnerId);
      }
      if (destination === "home") {
        commitScoredRunner(resolvedRunnerSource, resolvedRunnerId);
        onLiveScorePreview();
      }
      setManualAdvancePlay(null);
    }
  }

  function getAdvanceTitle(source: RunnerSource, destination: RunnerDestination) {
    if (source === "batter") return destination === "first" ? "打者走者" : "打者";
    if (source === "first") return "一塁走者";
    if (source === "second") return "二塁走者";
    return "三塁走者";
  }

  function openAdvanceTarget(source: RunnerSource, destination: RunnerDestination, point: FieldPoint, title: string) {
    const choices: AdvanceChoice[] =
      source === "batter"
        ? [
            ...(canUseDroppedThirdStrike(state)
              ? [{ reason: "dropped-third-strike" as const, label: advanceReasonLabels["dropped-third-strike"] }]
              : []),
            { reason: "catcher-interference", label: advanceReasonLabels["catcher-interference"] }
          ]
        : [
            { reason: "steal", label: advanceReasonLabels.steal },
            { reason: "passed-ball", label: advanceReasonLabels["passed-ball"] },
            { reason: "balk", label: advanceReasonLabels.balk },
            { reason: "runner-interference", label: advanceReasonLabels["runner-interference"] }
          ];

    if (advanceTargetTimerRef.current) {
      window.clearTimeout(advanceTargetTimerRef.current);
      advanceTargetTimerRef.current = null;
    }

    setManualAdvancePlay({ source, destination });
    const previewStarted = previewForcedAdvanceFlow(source, destination);
    if (!previewStarted) {
      ensureManualAdvanceBaseNode(source, destination, false);
      setAdvanceTarget({ source, destination, point, title, choices });
      return;
    }

    advanceTargetTimerRef.current = window.setTimeout(() => {
      advanceTargetTimerRef.current = null;
      setAdvanceTarget({ source, destination, point, title, choices });
    }, 360);
  }

  function chooseAdvance(reason: AdvanceReason) {
    if (!advanceTarget) return;
    if (advanceTargetTimerRef.current) {
      window.clearTimeout(advanceTargetTimerRef.current);
      advanceTargetTimerRef.current = null;
    }

    const shouldOpenDecisionBubbles = reason === "steal";
    setManualAdvancePlay(shouldOpenDecisionBubbles ? { source: advanceTarget.source, destination: advanceTarget.destination, reason } : null);

    if (shouldOpenDecisionBubbles) {
      const steps = getForcedAdvanceSteps(advanceTarget.source, advanceTarget.destination, reason);
      const nodeIds = steps
        .map((step) => ensureManualAdvanceBaseNode(step.source, step.destination, true, false, step.advanceReason))
        .filter((nodeId): nodeId is string => Boolean(nodeId));

      steps.forEach((step) => {
        if (step.destination === "home") addScoredRunner(step.source, false, true, step.source === "batter");
      });

      if (nodeIds.length > 0) {
        scheduleFieldDecisionBubbles(nodeIds, nodeIds[0], 0);
      }
    } else {
      ensureManualAdvanceBaseNode(advanceTarget.source, advanceTarget.destination, false, false, reason);
      if (advanceTarget.destination === "home") addScoredRunner(advanceTarget.source, true, true, advanceTarget.source === "batter");
    }

    onRunnerMove(advanceTarget.source, advanceTarget.destination, reason);
    setAdvanceTarget(null);
  }

  function startRunnerDrag(source: RunnerSource, imageSrc: string, event: PointerEvent<HTMLButtonElement>, mirrored = false) {
    if (homeRunAnimating) return;
    if (homeRunPlayLocked) return;
    if (deadBallPending) return;
    if (liveCountPending && source === "batter") return;

    event.preventDefault();
    event.stopPropagation();
    if (advanceTargetTimerRef.current) {
      window.clearTimeout(advanceTargetTimerRef.current);
      advanceTargetTimerRef.current = null;
    }
    setAdvanceTarget(null);
    setManualAdvancePlay(null);
    setRunnerDrag({
      source,
      imageSrc,
      x: event.clientX,
      y: event.clientY,
      mirrored
    });
  }

  function dismissOpenBubbles() {
    const pendingHomeSafeNodes = fieldPlay.nodes.filter(
      (node) => node.kind === "base" && getBaseDestinationFromKey(node.key) === "home" && node.decisionEnabled && node.bubbleOpen && !node.decision
    );

    pendingHomeSafeNodes.forEach((node) => finalizeHomeRunnerIfSafe(node));
    if (advanceTargetTimerRef.current) {
      window.clearTimeout(advanceTargetTimerRef.current);
      advanceTargetTimerRef.current = null;
    }
    decisionBubbleTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId));
    decisionBubbleTimerRefs.current = [];
    setAdvanceTarget(null);
    setManualAdvancePlay(null);
    setFieldPlay((current) => ({
      ...current,
      activeNodeId: null,
      nodes: current.nodes.map((node) => (!node.decision ? { ...node, bubbleOpen: false } : node))
    }));
  }

  function renderDecisionButtons(node: FieldPlayNode) {
    if (isHomeRunDecisionNode(node)) {
      return (
        <button className={node.decision === "home-run" ? "selected" : ""} type="button" onClick={() => chooseDecision(node.id, "home-run")}>
          ホームラン
        </button>
      );
    }

    if (isInitialHitDecisionNode(node)) {
      return (
        <>
          <button className={node.decision === "fly-out" ? "selected danger-text" : "danger-text"} type="button" onClick={() => chooseDecision(node.id, "fly-out")}>
            {"\u30a2\u30a6\u30c8"}
          </button>
          <button className={node.decision === "error" ? "selected error-text" : "error-text"} type="button" onClick={() => chooseDecision(node.id, "error")}>
            {"\u30a8\u30e9\u30fc"}
          </button>
        </>
      );
    }

    if (isSingleDecisionActionNode(node)) {
      return (
        <button className={node.decision === "fly-out" ? "selected danger-text" : "danger-text"} type="button" onClick={() => chooseDecision(node.id, "fly-out")}>
          {"\u30a2\u30a6\u30c8"}
        </button>
      );
    }

    return (
      <>
        <button className={node.decision === "out" ? "selected danger-text" : "danger-text"} type="button" onClick={() => chooseDecision(node.id, "out")}>
          {"\u30a2\u30a6\u30c8"}
        </button>
        <button className={node.decision === "error" ? "selected error-text" : "error-text"} type="button" onClick={() => chooseDecision(node.id, "error")}>
          {"\u30a8\u30e9\u30fc"}
        </button>
      </>
    );
  }

  return (
    <section
      ref={stageRef}
      className={`field-stage ${ownBatting ? "own-batting" : "opponent-batting"}`}
      aria-label="守備位置とランナー"
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest(
            ".play-decision-bubble, .advance-bubble, .base-marker, .foul-zone-marker, .position, .outfield-over-marker, .field-play-position-node, .runner-button, .batter-runner-button"
          )
        ) {
          return;
        }
        dismissOpenBubbles();
      }}
    >
      <img ref={fieldArtRef} className="field-art" src="assets/baseball-field.png" alt="" />

      {fieldArtBox && (
        <div ref={fieldLayerRef} className="field-anchor-layer" style={getFieldLayerStyle()}>
      <svg className="field-play-lines" aria-hidden="true">
        <defs>
          <marker id="field-hit-arrow" viewBox="0 0 10 10" refX="8.1" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
          <marker id="field-throw-arrow" viewBox="0 0 10 10" refX="8.1" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {fieldPlay.segments.filter((segment) => segment.kind !== "run").map((segment) => {
          const sourceNode = segment.fromNodeId ? fieldPlay.nodes.find((node) => node.id === segment.fromNodeId) : null;
          const shouldMaskSourceCircle = segment.kind === "throw" && sourceNode?.kind === "position";
          const sourcePoint = shouldMaskSourceCircle ? getSegmentSourcePoint(segment) : null;
          const maskId = `line-source-mask-${segment.id}`;

          return (
            <Fragment key={segment.id}>
              {sourcePoint && (
                <mask id={maskId} maskUnits="userSpaceOnUse">
                  <rect x="-1000" y="-1000" width="3000" height="3000" fill="white" />
                  <circle cx={sourcePoint.x} cy={sourcePoint.y} r="18" fill="black" />
                </mask>
              )}
              <path
                className={`field-play-line ${segment.kind}`}
                d={getSegmentPath(segment)}
                markerEnd={`url(#field-${segment.kind}-arrow)`}
                mask={sourcePoint ? `url(#${maskId})` : undefined}
              />
            </Fragment>
          );
        })}
      </svg>

      {bases.map((base) => (
        <button
          className={`base-marker ${base.className}${fieldSelection === base.key ? " selected" : ""}`}
          type="button"
          key={base.key}
          aria-label={`${base.label}ベース`}
          style={getFieldAnchorStyle(base.key as keyof typeof FIELD_IMAGE_POINTS)}
          ref={(node) => setTargetRef(base.key, node)}
          onClick={() => handleFieldTarget(makeBaseTarget(base))}
        />
      ))}

      {foulZones.map(([side, pointKey, label]) => (
        <button
          className={`foul-zone-marker foul-zone-${side}${fieldSelection === `foul-${side}` ? " selected" : ""}`}
          type="button"
          key={pointKey}
          aria-label={label}
          style={getFieldAnchorStyle(pointKey as keyof typeof FIELD_IMAGE_POINTS)}
          ref={(node) => setTargetRef(`foul-${side}`, node)}
          onClick={() => handleFieldTarget(makeFoulTarget(side))}
        >
          <ScoreMarkIcon type="foul" className="foul-zone-icon" />
        </button>
      ))}

      {positions.map(([className, number]) => (
        <button
          className={`position ${className}${fieldSelection === `position-${number}` ? " selected" : ""}${
            fieldPlay.nodes.some(
              (node) =>
                node.kind === "position" &&
                node.label === String(number) &&
                node.showPositionTrail !== false &&
                node.displayPoint &&
                getDistance(node.point, node.displayPoint) > 1
            )
              ? " position-origin-muted"
              : ""
          }${
            fieldPlay.nodes.some(
              (node) =>
                node.kind === "position" &&
                node.label === String(number) &&
                node.showPositionTrail === false &&
                node.displayPoint &&
                getDistance(node.point, node.displayPoint) > 1
            )
              ? " position-origin-hidden"
              : ""
          }${
            fieldPlay.nodes.some(
              (node) =>
                node.kind === "position" &&
                node.suppressDecisionBubble &&
                node.label === String(number) &&
                fieldPlay.segments.some((segment) => segment.fromNodeId === node.id)
            )
              ? " position-origin-hidden"
              : ""
          }`}
          type="button"
          key={className}
          aria-label={`\u5b88\u5099\u4f4d\u7f6e${number}`}
          style={getFieldAnchorStyle(`position-${number}` as keyof typeof FIELD_IMAGE_POINTS)}
          ref={(node) => setTargetRef(`position-${number}`, node)}
          onClick={() => handleFieldTarget(makePositionTarget(className, number))}
        >
          {number}
        </button>
      ))}

      {outfieldOverTargets.map(([className, number, overLabel]) => (
        <button
          className={`outfield-over-marker ${className}${fieldSelection === `position-${number}-over` ? " selected" : ""}`}
          type="button"
          key={className}
          aria-label={overLabel}
          style={getFieldAnchorStyle(`position-${number}-over` as keyof typeof FIELD_IMAGE_POINTS)}
          ref={(node) => setTargetRef(`position-${number}-over`, node)}
          onClick={() => handleFieldTarget(makeOutfieldOverTarget(className, number))}
        />
      ))}

      {fieldPlay.nodes
        .filter((node) => node.kind === "position")
        .map((node) => {
          const movingPoint = positionMovePoints[node.id];
          const originPoint = getPositionOriginPoint(node);
          const finalDisplayPoint = getNodeDisplayPoint(node);
          const displayPoint = movingPoint ?? finalDisplayPoint;
          const moved = isPositionDisplaced(node, displayPoint);
          const showTrail = moved && (node.showPositionTrail !== false || hasOutgoingThrowSegment(node.id));
          const hasOutgoingSegment = fieldPlay.segments.some((segment) => segment.fromNodeId === node.id);
          const shouldShowOverNode = node.suppressDecisionBubble && hasOutgoingSegment;
          const hideUnmovedHitClone = isInitialHitNode(node) && !movingPoint && !node.displayPoint && !shouldShowOverNode;
          if (hideUnmovedHitClone) return null;

          return (
            <Fragment key={`field-node-${node.id}`}>
              {showTrail && (
                <button
                  className="field-play-position-node position-ghost"
                  type="button"
                  style={{ left: `${originPoint.x}px`, top: `${originPoint.y}px` }}
                  aria-label={`field original position ${node.label}`}
                >
                  {node.label}
                </button>
              )}
              <button
                className={`field-play-position-node${isInitialHitNode(node) ? " hit-node" : ""}${moved ? " moved-node" : ""}${
                  movingPoint ? " position-cover-moving" : ""
                }`}
                type="button"
                style={{ left: `${displayPoint.x}px`, top: `${displayPoint.y}px` }}
                aria-label={`field position ${node.label}`}
              >
                {node.label}
              </button>
            </Fragment>
          );
        })}

      <span
        className="batter-box-snap batter-box-left"
        style={getFieldAnchorStyle("batter-box-left")}
        ref={(node) => setTargetRef("batter-box-left", node)}
        aria-hidden="true"
      />
      <span
        className="batter-box-snap batter-box-right"
        style={getFieldAnchorStyle("batter-box-right")}
        ref={(node) => setTargetRef("batter-box-right", node)}
        aria-hidden="true"
      />
      <span
        className="runner-slot runner-first"
        style={getFieldAnchorStyle("runner-slot-first")}
        ref={(node) => setTargetRef("runner-slot-first", node)}
        aria-hidden="true"
      />
      <span
        className="runner-slot runner-second"
        style={getFieldAnchorStyle("runner-slot-second")}
        ref={(node) => setTargetRef("runner-slot-second", node)}
        aria-hidden="true"
      />
      <span
        className="runner-slot runner-third"
        style={getFieldAnchorStyle("runner-slot-third")}
        ref={(node) => setTargetRef("runner-slot-third", node)}
        aria-hidden="true"
      />
      {showBatterRunner && (
      <button
        className={`batter-runner-button batter-${currentBatterBox}${isRunnerOut("batter") ? " runner-out" : ""}${
          isRunnerDecisionTarget("batter") ? " runner-decision-target" : ""
        }${
          animatingRunnerSources.has("batter") || isRunnerInBasePlay("batter") || runnerDrag?.source === "batter" ? " runner-advancing-source" : ""
        }`}
        type="button"
          aria-label="batter runner"
        style={getFieldAnchorStyle(`batter-box-${currentBatterBox}` as keyof typeof FIELD_IMAGE_POINTS)}
        ref={(node) => setTargetRef("runner-batter", node)}
        onPointerDown={(event) => startRunnerDrag("batter", ownBatting ? "assets/batter-red.png" : "assets/batter-blue.png", event, currentBatterBox === "left")}
      >
        <img src={ownBatting ? "assets/batter-red.png" : "assets/batter-blue.png"} alt="" />
      </button>
      )}

      {(["third", "second", "first"] as BaseKey[]).map((baseKey) => {
        const runner = state.game.runners[baseKey];
        if (!runner) return null;
        const runnerSource = runner.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder ? "batter" : baseKey;

        return (
          <button
            className={`runner-button runner-${baseKey}${fieldSelection === `runner-${baseKey}` ? " selected" : ""}${
              isRunnerOut(runnerSource, runner.id) ? " runner-out" : ""
            }${isRunnerDecisionTarget(runnerSource, runner.id) ? " runner-decision-target" : ""}${
              animatingRunnerSources.has(runnerSource) || isRunnerInBasePlay(runnerSource, runner.id) || runnerDrag?.source === runnerSource
                ? " runner-advancing-source"
                : ""
            }`}
            type="button"
            key={`${baseKey}-${runner.id}`}
            aria-label={`${formatPlayerLabel(runner)} \u30e9\u30f3\u30ca\u30fc`}
            style={getFieldAnchorStyle(`runner-slot-${baseKey}` as keyof typeof FIELD_IMAGE_POINTS)}
            ref={(node) => setTargetRef(`runner-${baseKey}`, node)}
            onPointerDown={(event) => {
              setFieldSelection(`runner-${baseKey}`);
              startRunnerDrag(runnerSource, ownBatting ? RUNNER_RED_ASSET : RUNNER_BLUE_ASSET, event);
            }}
          >
            <img className="runner-icon" src={ownBatting ? RUNNER_RED_ASSET : RUNNER_BLUE_ASSET} alt="" />
          </button>
        );
      })}

      {basePlayRunnerNodes.map((node) => {
        if (!node.decision && node.runnerSource && animatingRunnerSources.has(node.runnerSource)) return null;
        const destination = getBaseDestinationFromKey(node.key);
        const isHomePlay = destination === "home";
        if (isHomePlay) return null;

        return (
          <img
            className={`field-decision-runner${isHomePlay ? " runner-home-play" : ` runner-${destination}`}${
              node.decision === "out" ? " runner-out" : ""
            }${
              node.decisionEnabled && (node.bubbleOpen || node.decision) ? " runner-decision-target" : ""
            }`}
            key={`runner-at-${node.id}`}
            style={isHomePlay ? ({ left: `${node.point.x}px`, top: `${node.point.y}px` } as CSSProperties) : getRunnerSlotStyle(destination, node.point)}
            src={ownBatting ? RUNNER_RED_ASSET : RUNNER_BLUE_ASSET}
            alt=""
          />
        );
      })}

      {runnerAnimations.map((animation) => {
        const style = {
          left: `${animation.from.x}px`,
          top: `${animation.from.y}px`,
          "--advance-x": `${animation.to.x - animation.from.x}px`,
          "--advance-y": `${animation.to.y - animation.from.y}px`,
          "--runner-scale-x": animation.mirrored ? "-1" : "1"
        } as CSSProperties & Record<"--advance-x" | "--advance-y" | "--runner-scale-x", string>;

        return (
          <img
            className={`runner-auto-advance${animation.batter ? " batter-advance" : ""}${animation.mirrored ? " mirrored" : ""}`}
            src={animation.imageSrc}
            alt=""
            key={animation.id}
            style={style}
          />
        );
      })}

      {(visiblePendingScoredRunners.length > 0 || committedScoredRunners.length > 0) && (
        <div className="scored-runner-lane" aria-label="ホームイン済みランナー">
          {visiblePendingScoredRunners.map((runner) => {
            const decisionNode = getScoredRunnerDecisionNode(runner);
            return (
              <img
                className={`pending-home-runner${runner.batter ? " batter-scored" : ""}${decisionNode?.decision === "out" ? " runner-out" : ""}${
                  isRunnerDecisionTarget(runner.source, runner.id) ? " runner-decision-target" : ""
                }`}
                src={runner.imageSrc}
                alt=""
                key={`pending-home-${runner.id}`}
              />
            );
          })}
          {committedScoredRunners.map((runner) => {
            const decisionNode = getScoredRunnerDecisionNode(runner);
            return (
              <img
                className={`scored-runner-icon${runner.batter ? " batter-scored" : ""}${
                  decisionNode?.decision === "out" ? " runner-out" : ""
                }${isRunnerDecisionTarget(runner.source, runner.id) ? " runner-decision-target" : ""}`}
                src={runner.imageSrc}
                alt=""
                key={runner.id}
              />
            );
          })}
        </div>
      )}

      <div className="field-bubble-layer">
        {getDecisionBubbleEntries().map(({ node, point, shift, zIndex }) => (
            <div
              className={`play-decision-bubble${isSingleDecisionActionNode(node) ? " compact-bubble" : ""}${isHomeRunDecisionNode(node) ? " home-run-bubble" : ""}${node.decision ? ` is-${node.decision}` : ""}`}
              key={node.id}
              style={
                {
                  left: `${point.x}px`,
                  top: `${point.y}px`,
                  zIndex,
                  "--bubble-shift-x": `${shift.x}px`,
                  "--bubble-shift-y": `${shift.y}px`
                } as CSSProperties & Record<"--bubble-shift-x" | "--bubble-shift-y", string>
              }
            >
              <div className="play-decision-subject">{node.subject}</div>
              <div className={`play-decision-actions${isSingleDecisionActionNode(node) ? " single-action" : ""}`}>
                {renderDecisionButtons(node)}
              </div>
            </div>
          ))}

        {advanceTarget && (
          <div className="advance-bubble" style={{ left: `${advanceTarget.point.x}px`, top: `${advanceTarget.point.y}px` }}>
            <div className="advance-bubble-title">{advanceTarget.title}</div>
            <div className="advance-actions">
              {advanceTarget.choices.map((choice) => (
                <button type="button" key={choice.reason} onClick={() => chooseAdvance(choice.reason)}>
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
        </div>
      )}

      {runnerDrag && (
        <img
          className={`runner-drag-preview${runnerDrag.mirrored ? " mirrored" : ""}`}
          src={runnerDrag.imageSrc}
          alt=""
          style={{ left: `${runnerDrag.x}px`, top: `${runnerDrag.y}px` }}
        />
      )}

      <aside className="broadcast-board" aria-label="broadcast board">
        <div className="broadcast-inning">
          {`${state.game.inning}${state.game.half}`}
        </div>
        <div className="broadcast-score">
          <span className={`team side-left ${slots[0].key}${slots[0].key === battingTeamKey ? " batting" : ""}`}>{slots[0].name}</span>
          <strong className={slots[0].key}>{slots[0].score}</strong>
          <span className="separator">-</span>
          <strong className={slots[1].key}>{slots[1].score}</strong>
          <span className={`team side-right ${slots[1].key}${slots[1].key === battingTeamKey ? " batting" : ""}`}>{slots[1].name}</span>
        </div>
        <div className="broadcast-counts" aria-label="count">
          <CountDots label="B" value={state.game.balls} max={3} activeClass="green" />
          <CountDots label="S" value={state.game.strikes} max={2} activeClass="yellow" />
          <CountDots label="O" value={state.game.outs} max={2} activeClass="red" />
        </div>
      </aside>
    </section>
  );
}

function CountDots({ label, value, max, activeClass }: { label: string; value: number; max: number; activeClass: string }) {
  return (
    <div>
      <span>{label}</span>
      {Array.from({ length: max }).map((_, index) => (
        <i key={index} className={index < value ? activeClass : ""} />
      ))}
    </div>
  );
}

function PlayerDialog({
  state,
  mode,
  forceRegistration,
  ownBatting,
  closeDialog,
  setOpponentBatter,
  substituteOwnBatter,
  setOwnPitcher,
  setOpponentPitcher
}: {
  state: AppState;
  mode: DialogMode;
  forceRegistration: boolean;
  ownBatting: boolean;
  closeDialog: () => void;
  setOpponentBatter: (jerseyNumber: string) => void;
  substituteOwnBatter: (rowId: string) => void;
  setOwnPitcher: (player: Player) => void;
  setOpponentPitcher: (jerseyNumber: string) => void;
}) {
  const [jerseyNumber, setJerseyNumber] = useState("");
  const ownBench = state.ownOrder.slice(9);
  const opponentJerseys = [...new Set(state.opponentOrder.map((player) => normalizeNumber(player.jerseyNumber)).filter(Boolean))];

  const showOpponentBatterForm = mode === "batter" && (!ownBatting || forceRegistration);
  const showOwnBench = mode === "batter" && ownBatting && !forceRegistration;
  const showOwnPitchers = mode === "pitcher" && !ownBatting;
  const showOpponentPitchers = mode === "pitcher" && ownBatting;

  return (
    <section className="batter-dialog">
      <div className="batter-dialog-backdrop" onClick={closeDialog} />
      <section className="batter-dialog-panel" aria-label="選手変更">
        <header>
          <strong>{mode === "pitcher" ? "ピッチャー交代" : forceRegistration ? "背番号登録" : "バッター変更"}</strong>
          <button type="button" onClick={closeDialog} aria-label="close dialog">
            {"\u00d7"}
          </button>
        </header>

        {showOwnBench && (
          <div className="bench-player-list">
            {ownBench.map((player) => (
              <button className="bench-player-button" type="button" key={player.rowId} onClick={() => substituteOwnBatter(player.rowId)}>
                <span>{formatJerseyNumber(player.jerseyNumber)}</span>
                <strong>{player.name}</strong>
                <small>控え</small>
              </button>
            ))}
          </div>
        )}

        {showOpponentBatterForm && (
          <form
            className="opponent-batter-form"
            onSubmit={(event) => {
              event.preventDefault();
              setOpponentBatter(jerseyNumber);
            }}
          >
            <label>
              背番号
              <input type="number" inputMode="numeric" min="0" value={jerseyNumber} autoFocus onChange={(event) => setJerseyNumber(event.target.value)} />
            </label>
            <button type="submit">登録</button>
          </form>
        )}

        {showOwnPitchers && (
          <div className="bench-player-list">
            {state.ownOrder.map((player) => (
              <button className="bench-player-button" type="button" key={player.rowId} onClick={() => setOwnPitcher(player)}>
                <span>{formatJerseyNumber(player.jerseyNumber)}</span>
                <strong>{player.name}</strong>
                <small>{player.positionNumber === "1" ? "現在" : "投手"}</small>
              </button>
            ))}
          </div>
        )}

        {showOpponentPitchers && (
          <>
            <div className="bench-player-list">
              {opponentJerseys.length === 0 && <div className="empty-bench-message">登録済み背番号がありません</div>}
              {opponentJerseys.map((jersey) => (
                <button className="bench-player-button" type="button" key={jersey} onClick={() => setOpponentPitcher(jersey)}>
                  <span>{formatJerseyNumber(jersey)}</span>
                  <strong>登録済み投手</strong>
                  <small>{state.game.currentOpponentPitcherJerseyNumber === jersey ? "現在" : "投手"}</small>
                </button>
              ))}
            </div>
            <form
              className="opponent-batter-form"
              onSubmit={(event) => {
                event.preventDefault();
                setOpponentPitcher(jerseyNumber);
              }}
            >
              <label>
                背番号
                <input type="number" inputMode="numeric" min="0" value={jerseyNumber} onChange={(event) => setJerseyNumber(event.target.value)} />
              </label>
              <button type="submit">登録</button>
            </form>
          </>
        )}
      </section>
    </section>
  );
}
