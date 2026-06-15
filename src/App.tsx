import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppState, PitchType, Player, TabKey, TeamKey } from "./types";
import { initialState } from "./data";
import {
  applyPitch,
  formatJerseyNumber,
  formatPlayerLabel,
  getBattingTeamKey,
  getCurrentBatter,
  getCurrentBattingIndex,
  getCurrentOpponentBatter,
  getCurrentOwnBatter,
  getDuplicateValues,
  hitMarkAssets,
  isOwnBattingNow,
  normalizeNumber,
  outSymbols,
  pitchSymbolCoordinates
} from "./scoreRules";

type DialogMode = "batter" | "pitcher" | null;

function moveRow<T>(rows: T[], fromIndex: number, toIndex: number) {
  const next = [...rows];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function getBroadcastTeamName(name: string) {
  const normalizedName = name.trim();
  if (!normalizedName) return "";
  if (normalizedName.includes(" ")) return normalizedName.split(/\s+/).at(-1) ?? normalizedName;

  const suffixes = ["ドリーム", "スターズ", "クラブ", "ファイターズ", "ジャイアンツ", "イーグルス", "タイガース", "ベアーズ", "ホークス"];
  return suffixes.find((suffix) => normalizedName.endsWith(suffix)) ?? normalizedName;
}

function getOpponentName(state: AppState) {
  return state.opponentTeam.name || "相手";
}

export function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [activeTab, setActiveTab] = useState<TabKey>("score");
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [forceRegistration, setForceRegistration] = useState(false);
  const [dragging, setDragging] = useState<{ teamKey: TeamKey; rowId: string } | null>(null);
  const lastPitchPointerId = useRef<number | null>(null);

  const ownBatting = isOwnBattingNow(state);
  const battingTeamKey = getBattingTeamKey(state);
  const currentBatter = getCurrentBatter(state);
  const currentOwnBatter = getCurrentOwnBatter(state);
  const currentOpponentBatter = getCurrentOpponentBatter(state);
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

    const key = `${battingTeamKey}-${state.game.battingOrder}`;
    if (state.promptedBatterKeys.includes(key)) return;

    setState((current) => ({
      ...current,
      promptedBatterKeys: [...current.promptedBatterKeys, key]
    }));
    setForceRegistration(true);
    setDialogMode("batter");
  }, [activeTab, battingTeamKey, currentBatter?.jerseyNumber, state.game.battingOrder, state.promptedBatterKeys]);

  const ownPositionDuplicates = useMemo(() => getDuplicateValues(state.ownOrder, "positionNumber"), [state.ownOrder]);
  const opponentPositionDuplicates = useMemo(() => getDuplicateValues(state.opponentOrder, "positionNumber"), [state.opponentOrder]);

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

  function handlePitch(type: PitchType) {
    if (!normalizeNumber(currentBatter?.jerseyNumber)) {
      setForceRegistration(true);
      setDialogMode("batter");
      return;
    }

    setState((current) => applyPitch(current, type));
  }

  function handlePitchPointer(type: PitchType, pointerId: number) {
    lastPitchPointerId.current = pointerId;
    handlePitch(type);
  }

  function handlePitchClick(type: PitchType) {
    if (lastPitchPointerId.current !== null) {
      lastPitchPointerId.current = null;
      return;
    }

    handlePitch(type);
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
    ? `${state.game.battingOrder}番 ${currentOwnBatter?.name ?? "未設定"}`
    : `${state.game.battingOrder}番 ${formatPlayerLabel(currentOpponentBatter, state.game.currentOpponentBatterJerseyNumber) || "未設定"}`;
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
            <section className="player-row" aria-label="現在の選手">
              <img className="batter-icon" src={ownBatting ? "assets/batter-red.png" : "assets/batter-blue.png"} alt="" />
              <button className="player-copy batter-select" type="button" onClick={() => setDialogMode("batter")}>
                <p>バッター</p>
                <strong>{batterText}</strong>
              </button>
              <button className="pitcher-select" type="button" onClick={() => setDialogMode("pitcher")}>
                <span>ピッチャー</span>
                <b>{pitcherText}</b>
              </button>
              <ScoreCell state={state} />
            </section>

            <FieldStage state={state} />

            <section className="pitch-buttons" aria-label="投球入力">
              <button
                className="strike"
                type="button"
                disabled={Boolean(state.plate.result)}
                onPointerUp={(event) => handlePitchPointer("strike", event.pointerId)}
                onClick={() => handlePitchClick("strike")}
              >
                <span>{"\u2715"}</span>ストライク
              </button>
              <button
                className="foul"
                type="button"
                disabled={Boolean(state.plate.result)}
                onPointerUp={(event) => handlePitchPointer("foul", event.pointerId)}
                onClick={() => handlePitchClick("foul")}
              >
                <span>{"\u25b3"}</span>ファール
              </button>
              <button
                className="ball"
                type="button"
                disabled={Boolean(state.plate.result)}
                onPointerUp={(event) => handlePitchPointer("ball", event.pointerId)}
                onClick={() => handlePitchClick("ball")}
              >
                <span>{"\u25cf"}</span>ボール
              </button>
              <button
                className="dead"
                type="button"
                disabled={Boolean(state.plate.result)}
                onPointerUp={(event) => handlePitchPointer("dead", event.pointerId)}
                onClick={() => handlePitchClick("dead")}
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
  ownPositionDuplicates,
  opponentPositionDuplicates,
  setDragging,
  reorder,
  updateOrderValue,
  setState
}: {
  state: AppState;
  dragging: { teamKey: TeamKey; rowId: string } | null;
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
              disabled={state.game.firstPitchEntered}
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
            aria-label="相手チーム名"
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
  setDragging,
  reorder,
  updateOrderValue
}: {
  teamKey: TeamKey;
  rows: Player[];
  duplicates: Set<string>;
  dragging: { teamKey: TeamKey; rowId: string } | null;
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
        <span>名前</span>
        <span>背番号</span>
      </div>
      {rows.map((player, index) => {
        const positionNumber = normalizeNumber(player.positionNumber);
        const isDragging = dragging?.teamKey === teamKey && dragging.rowId === player.rowId;
        return (
          <div
            key={player.rowId}
            className={`order-row${isDragging ? " is-dragging" : ""}`}
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
              aria-label="ドラッグして並び替え"
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

function ScoreCell({ state }: { state: AppState }) {
  const hitType = state.game.hitType;
  return (
    <article className="score-cell" aria-label="現在のスコアマス">
      <div className="score-matrix score-matrix-current">
        <img src="assets/score_matrix.png" alt="" />
        {hitType && <img className="matrix-hit-mark" src={hitMarkAssets[hitType]} alt="" data-hit-mark={hitType} />}
        <svg className="matrix-overlay" viewBox="0 0 1382 1025" aria-hidden="true">
          <g>
            {state.plate.pitches.map((symbol, index) => {
              const coordinate =
                pitchSymbolCoordinates[index] ??
                ({ x: 182, y: pitchSymbolCoordinates.at(-1)!.y + 98 * (index - pitchSymbolCoordinates.length + 1) } as const);
              return (
                <text className="score-symbol" x={coordinate.x} y={coordinate.y} key={`${symbol}-${index}`}>
                  {symbol}
                </text>
              );
            })}
          </g>
          {state.plate.outNumber > 0 && (
            <text className="matrix-out" x="725" y="505">
              {outSymbols[state.plate.outNumber]}
            </text>
          )}
          {state.plate.result && (
            <text className="matrix-play" x="1105" y="760">
              {state.plate.result}
            </text>
          )}
        </svg>
      </div>
    </article>
  );
}

function FieldStage({ state }: { state: AppState }) {
  const ownBatting = isOwnBattingNow(state);
  const ownSlot = { key: "own", name: getBroadcastTeamName(state.ownTeam.name), score: state.game.ownScore };
  const opponentSlot = { key: "opponent", name: getBroadcastTeamName(getOpponentName(state)), score: state.game.opponentScore };
  const slots = state.ownTeam.battingSide === "top" ? [ownSlot, opponentSlot] : [opponentSlot, ownSlot];

  return (
    <section className="field-stage" aria-label="守備位置とランナー">
      <img className="field-art" src="assets/baseball-field.png" alt="" />
      {[
        ["pos-left", 7],
        ["pos-center", 8],
        ["pos-right", 9],
        ["pos-short", 6],
        ["pos-second", 4],
        ["pos-third", 5],
        ["pos-first", 3],
        ["pos-pitcher", 1],
        ["pos-catcher", 2]
      ].map(([className, number]) => (
        <button className={`position ${className}`} type="button" key={className}>
          {number}
        </button>
      ))}

      {state.game.runnerFirst && (
        <img className="runner runner-first" src={ownBatting ? "assets/runner-red-outline.png" : "assets/runner-blue-outline.png"} alt="一塁ランナー" />
      )}

      <aside className="broadcast-board" aria-label="試合状況">
        <div className="broadcast-inning">
          {state.game.inning}回{state.game.half}
        </div>
        <div className="broadcast-score">
          <span className={`team ${slots[0].key}`}>{slots[0].name}</span>
          <strong className={slots[0].key}>{slots[0].score}</strong>
          <span className="separator">-</span>
          <strong className={slots[1].key}>{slots[1].score}</strong>
          <span className={`team ${slots[1].key}`}>{slots[1].name}</span>
        </div>
        <div className="broadcast-counts" aria-label="カウント">
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
          <button type="button" onClick={closeDialog} aria-label="閉じる">
            ×
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
                <small>{player.positionNumber === "1" ? "現在" : "選択"}</small>
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
                  <strong>登録済み選手</strong>
                  <small>{state.game.currentOpponentPitcherJerseyNumber === jersey ? "現在" : "選択"}</small>
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
