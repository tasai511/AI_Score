import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, KeyboardEvent, PointerEvent, SetStateAction } from "react";
import type { AdvanceReason, AppState, BaseKey, BatterBox, PitchType, Player, RunnerDestination, RunnerSource, TabKey, TeamKey } from "./types";
import { initialState } from "./data";
import {
  advanceReasonLabels,
  advanceRunner,
  applyFieldOut,
  applyHomeRunnerOut,
  applyInitialFieldError,
  applyPitch,
  canUseDroppedThirdStrike,
  confirmPlateAppearance,
  fieldOutResultLabels,
  formatJerseyNumber,
  formatPlayerLabel,
  getBattingTeamKey,
  getCurrentBatter,
  getCurrentBattingIndex,
  getCurrentOpponentBatter,
  getCurrentOwnBatter,
  getDuplicateValues,
  hitMarkAssets,
  isCurrentBatterPlateAppearanceComplete,
  isOwnBattingNow,
  moveRunnerToDestination,
  normalizeNumber,
  outSymbols,
  shouldResetPlateAfterConfirm
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
type PitchAdvanceRequest = {
  id: number;
  type: PitchAdvanceType;
};

const FIELD_IMAGE_WIDTH = 640;
const FIELD_IMAGE_HEIGHT = 576;

const FIELD_IMAGE_POINTS = {
  "base-first": { x: 462, y: 336 },
  "base-second": { x: 318, y: 192 },
  "base-third": { x: 174, y: 336 },
  "base-home": { x: 318.4, y: 480 },
  "foul-zone-left": { x: 108, y: 398 },
  "foul-zone-right": { x: 528, y: 398 },
  "position-1": { x: 320, y: 370.98 },
  "position-2": { x: 320, y: 524.26 },
  "position-3": { x: 421, y: 300 },
  "position-4": { x: 388, y: 216 },
  "position-5": { x: 219, y: 300 },
  "position-6": { x: 252, y: 216 },
  "position-7": { x: 132, y: 132 },
  "position-8": { x: 320, y: 94 },
  "position-9": { x: 508, y: 132 },
  "position-7-over": { x: 132, y: 78 },
  "position-8-over": { x: 320, y: 40 },
  "position-9-over": { x: 508, y: 78 },
  "runner-slot-first": { x: 520.6, y: 352.06 },
  "runner-slot-second": { x: 343.88, y: 169.74 },
  "runner-slot-third": { x: 119.4, y: 352.06 },
  "batter-box-left": { x: 353.43, y: 474.65 },
  "batter-box-right": { x: 286.57, y: 474.65 }
} as const;

function moveRow<T>(rows: T[], fromIndex: number, toIndex: number) {
  const next = [...rows];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
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
  const [activeTab, setActiveTab] = useState<TabKey>("score");
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [forceRegistration, setForceRegistration] = useState(false);
  const [dragging, setDragging] = useState<{ teamKey: TeamKey; rowId: string } | null>(null);
  const [fieldSelection, setFieldSelection] = useState<string | null>(null);
  const [needsPlateConfirm, setNeedsPlateConfirm] = useState(false);
  const [fieldResetToken, setFieldResetToken] = useState(0);
  const [pendingFieldOuts, setPendingFieldOuts] = useState<PendingFieldOut[]>([]);
  const [pitchAdvanceRequest, setPitchAdvanceRequest] = useState<PitchAdvanceRequest | null>(null);
  const inputSnapshotRef = useRef<AppState | null>(null);

  const ownBatting = isOwnBattingNow(state);
  const battingTeamKey = getBattingTeamKey(state);
  const currentBatter = getCurrentBatter(state);
  const currentOwnBatter = getCurrentOwnBatter(state);
  const currentOpponentBatter = getCurrentOpponentBatter(state);
  const scoreDisplayState = needsPlateConfirm && inputSnapshotRef.current ? inputSnapshotRef.current : state;
  const currentPitcher =
    state.ownOrder.find((player) => player.jerseyNumber === state.game.currentPitcherJerseyNumber) ??
    state.ownOrder.find((player) => player.positionNumber === "1");
  const opponentPitcher = state.opponentOrder.find((player) => player.jerseyNumber === state.game.currentOpponentPitcherJerseyNumber);

  useEffect(() => {
    document.documentElement.style.setProperty("--own-team-color", state.ownTeam.colorHex);
  }, [state.ownTeam.colorHex]);

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
      return {
        ...next,
        game: {
          ...next.game,
          currentBatterJerseyNumber: ownBatter?.jerseyNumber ?? "",
          currentOpponentBatterJerseyNumber: opponentBatter?.jerseyNumber ?? next.game.currentOpponentBatterJerseyNumber
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

  function requestPitchInput(type: PitchType) {
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
      setPitchAdvanceRequest({ id: Date.now(), type });
      return true;
    }

    setState((current) => {
      captureInputSnapshot(current);
      return applyPitch(current, type);
    });
    return true;
  }

  function handlePitch(type: PitchType) {
    requestPitchInput(type);
  }

  function handleFieldFoulStart() {
    return requestPitchInput("foul");
  }

  function handlePitchAdvanceAnimationComplete(type: PitchAdvanceType) {
    setPitchAdvanceRequest(null);
    setState((current) => {
      captureInputSnapshot(current);
      return applyPitch(current, type);
    });
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

  function handleAdvance(source: RunnerSource, reason: AdvanceReason) {
    setState((current) => {
      captureInputSnapshot(current);
      return advanceRunner(current, source, reason);
    });
    setNeedsPlateConfirm(true);
  }

  function handleRunnerMove(source: RunnerSource, destination: RunnerDestination, reason: AdvanceReason) {
    setState((current) => {
      captureInputSnapshot(current);
      return moveRunnerToDestination(current, source, destination, reason);
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

  function handleInitialFieldErrorDecision() {
    setState((current) => applyInitialFieldError(current));
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
    setState((current) => {
      const withFieldOuts = pendingFieldOuts.reduce((next, fieldOut) => applyPendingFieldOutDecision(next, fieldOut), current);
      const shouldClearPromptedBatterKeys =
        isCurrentBatterPlateAppearanceComplete(withFieldOuts) || shouldResetPlateAfterConfirm(withFieldOuts);
      return {
        ...confirmPlateAppearance(withFieldOuts),
        promptedBatterKeys: shouldClearPromptedBatterKeys ? [] : withFieldOuts.promptedBatterKeys
      };
    });
    inputSnapshotRef.current = null;
    setPendingFieldOuts([]);
    setPitchAdvanceRequest(null);
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
      const exists = current.opponentOrder.some((player) => normalizeNumber(player.jerseyNumber) === normalized);
      let used = false;
      return {
        ...current,
        opponentOrder: current.opponentOrder.map((player) => {
          if (!normalized || exists || used || normalizeNumber(player.jerseyNumber)) return player;
          used = true;
          return { ...player, jerseyNumber: normalized };
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

  return (
    <>
      <nav className="main-tabs" aria-label="メインメニュー">
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
              <img className="batter-icon" src={ownBatting ? "assets/batter-red.png" : "assets/batter-blue.png"} alt="" />
              <button className="pitcher-select" type="button" onClick={() => setDialogMode("pitcher")}>
                <span>ピッチャー</span>
                <b>
                  <span className="player-name-text">{pitcherText}</span>
                  <span className="edit-cue" aria-hidden="true" />
                </b>
              </button>
              <button className="player-copy batter-select" type="button" onClick={() => setDialogMode("batter")}>
                <p>バッター</p>
                <strong>
                  <span className="player-name-text">{batterText}</span>
                  <span className="edit-cue" aria-hidden="true" />
                </strong>
              </button>
              <RunnerScoreStrip state={state} />
              <ScoreCell state={state} pendingOuts={pendingFieldOuts} />
            </section>

            <FieldStage
              state={state}
              displayOwnScore={scoreDisplayState.game.ownScore}
              displayOpponentScore={scoreDisplayState.game.opponentScore}
              fieldSelection={fieldSelection}
              resetToken={fieldResetToken}
              pitchAdvanceRequest={pitchAdvanceRequest}
              setFieldSelection={setFieldSelection}
              onAdvance={handleAdvance}
              onRunnerMove={handleRunnerMove}
              onFieldOutDecision={handleFieldOutDecision}
              onInitialFieldErrorDecision={handleInitialFieldErrorDecision}
              onFieldDecisionCleared={clearFieldOutDecision}
              onBatterBoxChange={handleBatterBoxChange}
              onFieldFoulStart={handleFieldFoulStart}
              onPitchAdvanceAnimationComplete={handlePitchAdvanceAnimationComplete}
              onFieldPlayStarted={handleFieldPlayStarted}
            />

            <section className="pitch-buttons" aria-label="pitch input">
              {needsPlateConfirm && (
                <>
                  <button className="plate-cancel-button" type="button" onClick={handleCancelPlate}>
                    取り消し
                  </button>
                  <button className="plate-confirm-button" type="button" onClick={handleConfirmPlate}>
                    {"\u78ba\u5b9a"}
                  </button>
                </>
              )}
              <button
                className="strike"
                type="button"
                disabled={Boolean(state.plate.result) || needsPlateConfirm || Boolean(pitchAdvanceRequest)}
                onPointerDown={(event) => handlePitchPointer("strike", event)}
                onKeyDown={(event) => handlePitchKey("strike", event)}
              >
                <span>{"\u2715"}</span>ストライク
              </button>
              <button
                className="foul"
                type="button"
                disabled={Boolean(state.plate.result) || needsPlateConfirm || Boolean(pitchAdvanceRequest)}
                onPointerDown={(event) => handlePitchPointer("foul", event)}
                onKeyDown={(event) => handlePitchKey("foul", event)}
              >
                <span>{"\u25b3"}</span>ファール
              </button>
              <button
                className="ball"
                type="button"
                disabled={Boolean(state.plate.result) || needsPlateConfirm || Boolean(pitchAdvanceRequest)}
                onPointerDown={(event) => handlePitchPointer("ball", event)}
                onKeyDown={(event) => handlePitchKey("ball", event)}
              >
                <span>{"\u25cf"}</span>ボール
              </button>
              <button
                className="dead"
                type="button"
                disabled={Boolean(state.plate.result) || needsPlateConfirm || Boolean(pitchAdvanceRequest)}
                onPointerDown={(event) => handlePitchPointer("dead", event)}
                onKeyDown={(event) => handlePitchKey("dead", event)}
              >
                <span>DB</span>デッドボール
              </button>
            </section>

          </section>
        )}

        {activeTab === "output" && (
          <section className="view output-view">
            <div className="empty-state">スコア出力</div>
          </section>
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
  const rowCount = 9;
  const hasSecondColumn = total > rowCount;
  const column = Math.floor(index / rowCount);
  const row = index % rowCount;
  const singleColumnX = 190;
  const twoColumnRightX = 232;
  const xGap = 116;
  const yTop = 145;
  const yGap = 96;

  return {
    x: hasSecondColumn ? twoColumnRightX - column * xGap : singleColumnX,
    y: yTop + row * yGap
  };
}

function ScoreCell({ state, pendingOuts = [] }: { state: AppState; pendingOuts?: PendingFieldOut[] }) {
  const hitType = state.game.hitType;
  const pendingBatterOutIndex = pendingOuts.findIndex((fieldOut) => fieldOut.source === "batter");
  const pendingBatterOut = pendingBatterOutIndex >= 0 ? pendingOuts[pendingBatterOutIndex] : null;
  const previewOutNumber = pendingBatterOut ? Math.min(3, state.game.outs + pendingBatterOutIndex + 1) : 0;
  const outNumber = state.plate.outNumber || previewOutNumber;
  const result = state.plate.result || pendingBatterOut?.resultLabel || "";
  return (
    <article className="score-cell" aria-label="current score cell">
      <div className="score-matrix score-matrix-current">
        <img src="assets/score_matrix.png" alt="" />
        {hitType && <img className="matrix-hit-mark" src={hitMarkAssets[hitType]} alt="" data-hit-mark={hitType} />}
        <svg className="matrix-overlay" viewBox="0 0 1382 1025" aria-hidden="true">
          <g>
            {state.plate.pitches.map((symbol, index) => {
              const coordinate = getPitchSymbolCoordinate(index, state.plate.pitches.length);
              return (
                <text className="score-symbol" x={coordinate.x} y={coordinate.y} key={`${symbol}-${index}`}>
                  {symbol}
                </text>
              );
            })}
          </g>
          {outNumber > 0 && (
            <text className="matrix-out" x="725" y="505">
              {outSymbols[outNumber]}
            </text>
          )}
          {result && (
            <text className="matrix-play" x="1045" y="720">
              {result}
            </text>
          )}
        </svg>
      </div>
    </article>
  );
}

function RunnerScoreStrip({ state }: { state: AppState }) {
  const runnerCells = [
    { key: "third", label: "3塁", runner: state.game.runners.third },
    { key: "second", label: "2塁", runner: state.game.runners.second },
    { key: "first", label: "1塁", runner: state.game.runners.first }
  ];

  return (
    <section className="runner-score-strip" aria-label="runner score cells">
      {runnerCells.map((cell) => (
        <article className={`runner-score-card${cell.runner ? " occupied" : ""}`} key={cell.key}>
          <div className="runner-score-title">
            <span>{cell.label}</span>
            {cell.runner && <b>{formatPlayerLabel(cell.runner)}</b>}
          </div>
          <div className="score-matrix runner-score-matrix">
            <img src="assets/score_matrix.png" alt="" />
            {cell.runner?.scoreNotes.slice(-1).map((note) => (
              <span className="runner-score-note" key={note}>
                {note}
              </span>
            ))}
          </div>
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
  pitchAdvanceRequest,
  onAdvance,
  onRunnerMove,
  onFieldOutDecision,
  onInitialFieldErrorDecision,
  onFieldDecisionCleared,
  onBatterBoxChange,
  onFieldFoulStart,
  onPitchAdvanceAnimationComplete,
  onFieldPlayStarted,
  setFieldSelection
}: {
  state: AppState;
  displayOwnScore: number;
  displayOpponentScore: number;
  fieldSelection: string | null;
  resetToken: number;
  pitchAdvanceRequest: PitchAdvanceRequest | null;
  onAdvance: (source: RunnerSource, reason: AdvanceReason) => void;
  onRunnerMove: (source: RunnerSource, destination: RunnerDestination, reason: AdvanceReason) => void;
  onFieldOutDecision: (
    nodeId: string,
    source: RunnerSource,
    resultLabel?: string,
    runnerId?: string,
    destination?: RunnerDestination
  ) => void;
  onInitialFieldErrorDecision: () => void;
  onFieldDecisionCleared: (nodeId: string) => void;
  onBatterBoxChange: (box: BatterBox) => void;
  onFieldFoulStart: () => boolean;
  onPitchAdvanceAnimationComplete: (type: PitchAdvanceType) => void;
  onFieldPlayStarted: () => void;
  setFieldSelection: Dispatch<SetStateAction<string | null>>;
}) {
  type FieldDecision = "fly-out" | "out" | "safe" | "error";
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
  const positionMoveAnimationFrameRefs = useRef<Record<string, number>>({});
  const decisionBubbleTimerRefs = useRef<number[]>([]);
  const advanceTargetTimerRef = useRef<number | null>(null);
  const handledPitchAdvanceRequestRef = useRef<number | null>(null);
  const dragLockScrollRef = useRef<{ x: number; y: number } | null>(null);
  const ownBatting = isOwnBattingNow(state);
  const currentBatterBox = getCurrentBatter(state)?.batterBox ?? "right";
  const battingTeamKey = getBattingTeamKey(state);
  const currentBatterIsOnBase = Object.values(state.game.runners).some(
    (runner) => runner?.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder
  );
  const showBatterRunner = !currentBatterIsOnBase && !state.plate.result;
  const [fieldPlay, setFieldPlay] = useState<{
    activeNodeId: string | null;
    nodes: FieldPlayNode[];
    segments: FieldPlaySegment[];
  }>({
    activeNodeId: null,
    nodes: [],
    segments: []
  });
  const [advanceTarget, setAdvanceTarget] = useState<AdvanceTarget | null>(null);
  const [manualAdvancePlay, setManualAdvancePlay] = useState<ManualAdvancePlay | null>(null);
  const [runnerDrag, setRunnerDrag] = useState<RunnerDrag | null>(null);
  const [runnerAnimations, setRunnerAnimations] = useState<RunnerAnimation[]>([]);
  const [positionMovePoints, setPositionMovePoints] = useState<Record<string, FieldPoint>>({});
  const [scoredRunners, setScoredRunners] = useState<ScoredRunnerVisual[]>([]);
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
      (Boolean(node.decision) || Boolean(node.decisionEnabled) || (!node.decision && (node.bubbleOpen || isPendingAdvanceDisplayNode(node))))
  );
  const homePlayRunnerNodes = basePlayRunnerNodes.filter((node) => getBaseDestinationFromKey(node.key) === "home");
  const basePlayHiddenRunnerNodes = fieldPlay.nodes.filter(
    (node) => node.kind === "base" && node.runnerSource && (node.decision === "out" || node.decisionEnabled || isPendingAdvanceDisplayNode(node))
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

  function hasHitPlay() {
    return fieldPlay.segments.some((segment) => segment.kind === "hit");
  }

  function isOpenPickoffDecision() {
    return Boolean(
      !hasHitPlay() &&
        fieldPlay.nodes.find((node) => node.kind === "base" && node.decisionEnabled && node.bubbleOpen && !node.decision)
    );
  }

  useEffect(() => {
    setFieldPlay({
      activeNodeId: null,
      nodes: [],
      segments: []
    });
    setAdvanceTarget(null);
    setManualAdvancePlay(null);
    setRunnerAnimations([]);
    setPositionMovePoints({});
    setScoredRunners([]);
    if (runnerAnimationTimerRef.current) {
      window.clearTimeout(runnerAnimationTimerRef.current);
      runnerAnimationTimerRef.current = null;
    }
    if (advanceTargetTimerRef.current) {
      window.clearTimeout(advanceTargetTimerRef.current);
      advanceTargetTimerRef.current = null;
    }
    decisionBubbleTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId));
    decisionBubbleTimerRefs.current = [];
    Object.values(positionMoveAnimationFrameRefs.current).forEach((frameId) => window.cancelAnimationFrame(frameId));
    positionMoveAnimationFrameRefs.current = {};
  }, [resetToken]);

  useEffect(() => {
    return () => {
      if (runnerAnimationTimerRef.current) window.clearTimeout(runnerAnimationTimerRef.current);
      if (advanceTargetTimerRef.current) window.clearTimeout(advanceTargetTimerRef.current);
      decisionBubbleTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId));
      Object.values(positionMoveAnimationFrameRefs.current).forEach((frameId) => window.cancelAnimationFrame(frameId));
    };
  }, []);

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
        if (drop.destination === "home") {
          ensureManualAdvanceBaseNode(currentDrag.source, drop.destination, false, false, "hit");
          addScoredRunner(currentDrag.source, false);
          setAdvanceTarget(null);
          return;
        }

        const forcedAdvanceStarted = beginForcedAdvanceDecisionFlow(currentDrag.source, drop.destination, "hit");
        onRunnerMove(currentDrag.source, drop.destination, "hit");
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

  const runnerProgressRank: Record<RunnerSource | RunnerDestination, number> = {
    batter: 0,
    first: 1,
    second: 2,
    third: 3,
    home: 4
  };

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
    return [...scoredRunners].reverse().find((runner) => !getScoredRunnerDecisionNode(runner)) ?? null;
  }

  function getRunnerCurrentLocation(source: RunnerSource, runnerId?: string): RunnerSource | RunnerDestination | null {
    const baseById = getRunnerBaseById(runnerId);
    if (baseById) return baseById;
    if (runnerId && scoredRunners.some((runner) => runner.id === runnerId && runner.committed)) return "home";

    if (source === "batter") {
      return getCurrentBatterBase() ?? (showBatterRunner ? "batter" : null);
    }

    if (state.game.runners[source]) return source;

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
    return runnerProgressRank[destination] >= runnerProgressRank[currentLocation];
  }

  function canRunnerAdvanceToDestination(source: RunnerSource, destination: RunnerDestination, runnerId?: string) {
    const currentLocation = getRunnerCurrentLocation(source, runnerId);
    if (!currentLocation) return false;
    return runnerProgressRank[destination] > runnerProgressRank[currentLocation];
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
    return [...scoredRunners].reverse().find((runner) => runner.source === source && !getScoredRunnerDecisionNode(runner))?.id;
  }

  function isRunnerAlreadyOnNodeBase(node: FieldPlayNode) {
    if (node.kind !== "base" || !node.runnerSource) return false;

    const destination = getBaseDestinationFromKey(node.key);
    if (destination === "home") return false;

    const runner = state.game.runners[destination];
    const nodeRunnerId = node.runnerId ?? getRunnerIdForSource(node.runnerSource);
    return Boolean(runner?.id && nodeRunnerId && runner.id === nodeRunnerId);
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

  function isFoulCatchNode(node: FieldPlayNode) {
    if (node.kind !== "position" || !node.decisionEnabled) return false;
    const segment = fieldPlay.segments.find((current) => current.toNodeId === node.id);
    if (!segment?.fromNodeId) return false;
    const sourceNode = fieldPlay.nodes.find((current) => current.id === segment.fromNodeId);
    return sourceNode?.kind === "foul";
  }

  function isInitialHitDecisionNode(node: FieldPlayNode) {
    return isInitialHitNode(node) && node.kind === "position";
  }

  function isSingleDecisionActionNode(node: FieldPlayNode) {
    return isFoulCatchNode(node);
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

  function getNodeBubblePoint(node: FieldPlayNode) {
    if (isInitialHitNode(node)) return node.point;
    return getNodeActionPoint(node);
  }

  function getDecisionBubbleEntries() {
    const visibleNodes = fieldPlay.nodes.filter((node) => {
      const canShowDecisionBubble =
        !node.suppressDecisionBubble &&
        (isFoulCatchNode(node) || isInitialHitNode(node) || (node.kind === "base" && node.decisionEnabled));
      return canShowDecisionBubble && (node.decision || node.bubbleOpen || node.id === fieldPlay.activeNodeId);
    });
    const placementOrder = [...visibleNodes].sort((a, b) => {
      if (a.id === fieldPlay.activeNodeId) return -1;
      if (b.id === fieldPlay.activeNodeId) return 1;
      return 0;
    });
    const placedRects: { left: number; right: number; top: number; bottom: number }[] = [];
    const entries = new Map<string, { point: FieldPoint; shift: FieldPoint; zIndex: number }>();
    const bubbleSize = { width: 112, height: 48 };
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

    const makeRect = (point: FieldPoint, shift: FieldPoint) => {
      const bottom = point.y + shift.y - 22;
      return {
        left: point.x + shift.x - bubbleSize.width / 2,
        right: point.x + shift.x + bubbleSize.width / 2,
        top: bottom - bubbleSize.height,
        bottom
      };
    };
    const clampPlacement = (point: FieldPoint, shift: FieldPoint) => {
      const rect = makeRect(point, shift);
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
        rect: makeRect(point, clampedShift),
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
      const ranked = candidates
        .map((shift) => {
          const clamped = clampPlacement(point, shift);
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
        zIndex: node.id === fieldPlay.activeNodeId ? 13 : 10
      });
    }

    return visibleNodes.map((node) => ({
      node,
      ...(entries.get(node.id) ?? { point: getNodeBubblePoint(node), shift: { x: 0, y: 0 }, zIndex: 10 })
    }));
  }

  function getHitPath(from: FieldPoint, to: FieldPoint, flyOut = false) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const safeDistance = distance || 1;
    const normalA = { x: -dy / safeDistance, y: dx / safeDistance };
    const normal = normalA.x <= 0 ? normalA : { x: -normalA.x, y: -normalA.y };
    const curve = Math.min(flyOut ? 138 : 142, Math.max(62, distance * (flyOut ? 0.34 : 0.32)));

    if (flyOut) {
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
    if (destination === "home") return steps;

    let currentDestination: Exclude<RunnerDestination, "home"> = destination;
    const visitedSources = new Set<RunnerSource>([source]);

    while (true) {
      const occupiedSource = getOccupiedBaseRunnerSource(currentDestination);
      if (!occupiedSource || visitedSources.has(occupiedSource)) break;
      visitedSources.add(occupiedSource);
      const nextDestination = getNextRunnerDestination(currentDestination);
      steps.push({ source: occupiedSource, destination: nextDestination });
      if (nextDestination === "home") break;
      currentDestination = nextDestination;
    }

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
      if (step.destination === "home") addScoredRunner(step.source, false);
    });

    return true;
  }

  function beginForcedAdvanceDecisionFlow(source: RunnerSource, destination: RunnerDestination, advanceReason: AdvanceReason) {
    const steps = getForcedAdvanceSteps(source, destination, advanceReason);
    if (steps.length <= 1) return false;

    const nodeIds = steps
      .map((step) => ensureManualAdvanceBaseNode(step.source, step.destination, true, false, step.advanceReason))
      .filter((nodeId): nodeId is string => Boolean(nodeId));

    steps.forEach((step) => {
      startFieldRunnerAnimation(step.source, step.destination);
      if (step.destination === "home") addScoredRunner(step.source);
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
        targetNode?.decision === "fly-out" || isFoulFlyOutSegment(segment)
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
    if (destination === "home") return getTargetPoint("base-home");
    return getTargetPoint(`runner-slot-${destination}`);
  }

  function getFieldRunnerImageForSource(source: RunnerSource) {
    const runnerImageSrc = ownBatting ? "assets/runner-red-outline.png" : "assets/runner-blue-outline.png";
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
    const runnerImageSrc = ownBatting ? "assets/runner-red-outline.png" : "assets/runner-blue-outline.png";
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
        to: getTargetPoint("base-home"),
        imageSrc: runnerImageSrc,
        batter: false,
        mirrored: false
      });
    }

    return animations;
  }

  function getRunnerImageForSource(source: RunnerSource) {
    if (source === "batter") return ownBatting ? "assets/batter-red.png" : "assets/batter-blue.png";
    return ownBatting ? "assets/runner-red-outline.png" : "assets/runner-blue-outline.png";
  }

  function addScoredRunner(source: RunnerSource, committed = true) {
    const batterRunner = Object.values(state.game.runners).find(
      (runner) => runner?.teamKey === battingTeamKey && runner.battingOrder === state.game.battingOrder
    );
    const scoredRunner = source === "batter" ? batterRunner : state.game.runners[source];
    const visualId = scoredRunner?.id ?? `${source}-${battingTeamKey}-${state.game.battingOrder}`;
    const isBatterIcon = source === "batter" && !scoredRunner;

    setScoredRunners((current) => {
      const existingRunner = current.find((runner) => runner.id === visualId);
      if (existingRunner) {
        if (existingRunner.committed === committed) return current;
        return current.map((runner) => (runner.id === visualId ? { ...runner, committed: runner.committed || committed } : runner));
      }

      return [
        ...current,
        {
          id: visualId,
          source,
          teamKey: battingTeamKey,
          imageSrc: isBatterIcon ? getRunnerImageForSource("batter") : getRunnerImageForSource("first"),
          batter: isBatterIcon,
          committed
        }
      ];
    });
  }

  function getScoredRunnerDecisionNode(runner: ScoredRunnerVisual) {
    return homePlayRunnerNodes.find((node) => (node.runnerId && node.runnerId === runner.id) || node.runnerSource === runner.source) ?? null;
  }

  function startForcedAdvanceAnimation(onComplete: () => void) {
    if (runnerAnimationTimerRef.current) window.clearTimeout(runnerAnimationTimerRef.current);
    const thirdRunnerWillScore = Boolean(state.game.runners.first && state.game.runners.second && state.game.runners.third);
    setRunnerAnimations(buildForcedHitAdvanceAnimations());
    runnerAnimationTimerRef.current = window.setTimeout(() => {
      if (thirdRunnerWillScore) addScoredRunner("third");
      onComplete();
      setRunnerAnimations([]);
      runnerAnimationTimerRef.current = null;
    }, 360);
  }

  function startForcedHitAdvanceAnimation() {
    startForcedAdvanceAnimation(() => onAdvance("batter", "hit"));
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

  function getFieldOutResultLabel(node: FieldPlayNode) {
    if (node.runnerSource !== "batter") return "走死";

    const resultPositionNode = node.kind === "position" ? node : fieldPlay.nodes.find((current) => current.kind === "position");
    const positionNumber = Number(resultPositionNode?.label);
    return fieldOutResultLabels[positionNumber] ?? "アウト";
  }

  function getFieldFlyOutResultLabel(node: FieldPlayNode) {
    const flyOutLabels: Record<number, string> = {
      1: "投飛",
      2: "捕飛",
      3: "一飛",
      4: "二飛",
      5: "三飛",
      6: "遊飛",
      7: "左飛",
      8: "中飛",
      9: "右飛"
    };
    const positionNumber = Number(node.label);
    return flyOutLabels[positionNumber] ?? "飛";
  }

  function handleFieldTarget(target: FieldTarget, runnerSourceOverride?: RunnerSource | null) {
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
    const shouldAutoAdvanceBatterOnHit = !fieldPlay.nodes.length && target.kind === "position" && !runnerAdvanceModeActive;
    const pendingHomeRunnerSource = getPendingHomeRunner()?.source ?? null;
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
      addScoredRunner(runnerSource, false);
    }
    setFieldSelection(target.key);
    setAdvanceTarget(null);
    onFieldPlayStarted();
    if (shouldAutoAdvanceBatterOnHit) startForcedHitAdvanceAnimation();
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
        ...(target.kind === "base" ? { bubbleOpen: !shouldDelayBaseDecisionBubble } : {}),
        ...(currentFoulCatchMode ? { displayPoint: lastNode?.point, showPositionTrail: true } : {})
      };

      return {
        activeNodeId: shouldDelayBaseDecisionBubble ? null : node.id,
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
            fromNodeId: shouldUseInitialThrowFromPendingBase ? null : lastNode?.id ?? null,
            toNodeId: node.id,
            from: shouldUseInitialThrowFromPendingBase
              ? initialThrowPoint
              : lastNode
                ? getNodeActionPoint(lastNode)
                : isInitialHit
                  ? homePoint
                  : initialThrowPoint,
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

    if (target.kind === "position" && target.label === "2" && fieldHitModeActive && pendingHomeRunnerSource) {
      const homeDecisionNodeId = ensureManualAdvanceBaseNode(pendingHomeRunnerSource, "home", true, true, "hit");
      if (homeDecisionNodeId) scheduleFieldDecisionBubbles([homeDecisionNodeId], homeDecisionNodeId, 0);
    }
  }

  function chooseDecision(nodeId: string, decision: FieldDecision) {
    const decidedNode = fieldPlay.nodes.find((node) => node.id === nodeId);
    const isInitialHitErrorDecision = decision === "error" && Boolean(decidedNode && isInitialHitDecisionNode(decidedNode));
    if (decidedNode?.kind !== "base" && decision !== "fly-out" && !isInitialHitErrorDecision) return;
    if (decidedNode?.kind === "base" && !decidedNode.decisionEnabled) return;

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
        getFieldOutResultLabel({ ...decidedNode, runnerSource: resolvedRunnerSource }),
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
      onInitialFieldErrorDecision();
      return;
    }

    onFieldDecisionCleared(nodeId);

    if ((decision === "safe" || decision === "error") && resolvedRunnerSource) {
      const destination = decidedNode.kind === "base" ? getBaseDestinationFromKey(decidedNode.key) : getClosestBaseDestination(decidedNode.point);
      const currentRunnerLocation = getRunnerCurrentLocation(resolvedRunnerSource, resolvedRunnerId);
      const committedScoredRunner =
        destination === "home" && resolvedRunnerId
          ? scoredRunners.find((runner) => runner.id === resolvedRunnerId && runner.committed)
          : null;
      const runnerAlreadyThere = currentRunnerLocation === destination || Boolean(committedScoredRunner);
      if (!runnerAlreadyThere) {
        if (destination === "home") addScoredRunner(resolvedRunnerSource);
        const advanceReason =
          decision === "error"
            ? "error"
            : decidedNode.advanceReason
              ? decidedNode.advanceReason
              : manualAdvancePlay?.source === resolvedRunnerSource && manualAdvancePlay.destination === destination && manualAdvancePlay.reason
              ? manualAdvancePlay.reason
              : hasHitPlay()
                ? "hit"
                : "passed-ball";
        onRunnerMove(resolvedRunnerSource, destination, advanceReason);
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

      if (nodeIds.length > 0) {
        scheduleFieldDecisionBubbles(nodeIds, nodeIds[0], 0);
      }
    } else {
      ensureManualAdvanceBaseNode(advanceTarget.source, advanceTarget.destination, false, false, reason);
      if (advanceTarget.destination === "home") addScoredRunner(advanceTarget.source);
    }

    onRunnerMove(advanceTarget.source, advanceTarget.destination, reason);
    setAdvanceTarget(null);
  }

  function startRunnerDrag(source: RunnerSource, imageSrc: string, event: PointerEvent<HTMLButtonElement>, mirrored = false) {
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
        if (target.closest(".play-decision-bubble, .advance-bubble")) return;
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
          {"\u25b3"}
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
          aria-label={`螳亥ｙ菴咲ｽｮ${number}`}
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
              animatingRunnerSources.has(runnerSource) || isRunnerInBasePlay(runnerSource, runner.id) || runnerDrag?.source === baseKey
                ? " runner-advancing-source"
                : ""
            }`}
            type="button"
            key={`${baseKey}-${runner.id}`}
            aria-label={`${formatPlayerLabel(runner)} 繝ｩ繝ｳ繝翫・`}
            style={getFieldAnchorStyle(`runner-slot-${baseKey}` as keyof typeof FIELD_IMAGE_POINTS)}
            ref={(node) => setTargetRef(`runner-${baseKey}`, node)}
            onPointerDown={(event) => {
              setFieldSelection(`runner-${baseKey}`);
              startRunnerDrag(baseKey, ownBatting ? "assets/runner-red-outline.png" : "assets/runner-blue-outline.png", event);
            }}
          >
            <img className="runner-icon" src={ownBatting ? "assets/runner-red-outline.png" : "assets/runner-blue-outline.png"} alt="" />
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
            src={ownBatting ? "assets/runner-red-outline.png" : "assets/runner-blue-outline.png"}
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

      {scoredRunners.length > 0 && (
        <div className="scored-runner-lane" aria-label="ホームイン済みランナー">
          {scoredRunners.map((runner) => {
            const decisionNode = getScoredRunnerDecisionNode(runner);
            return (
              <img
                className={`scored-runner-icon${runner.batter ? " batter-scored" : ""}${
                  decisionNode?.decision === "out" ? " runner-out" : ""
                }${
                  decisionNode?.decisionEnabled && (decisionNode.bubbleOpen || decisionNode.decision) ? " runner-decision-target" : ""
                }`}
                src={runner.imageSrc}
                alt=""
                key={runner.id}
              />
            );
          })}
        </div>
      )}

      {getDecisionBubbleEntries().map(({ node, point, shift, zIndex }) => (
          <div
            className={`play-decision-bubble${node.decision ? ` is-${node.decision}` : ""}`}
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
