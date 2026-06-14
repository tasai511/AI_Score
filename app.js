const { ownTeam, opponentTeam, currentGame } = window.AIScoreData;
const maxOrderRows = 21;
const hitMarkAssets = {
  single: "assets/single.svg",
  "two-base": "assets/two-base.svg",
  "three-base": "assets/three-base.svg",
  "home-run": "assets/home-run.svg"
};
const positionNames = {
  1: "ピッチャー",
  2: "キャッチャー",
  3: "ファースト",
  4: "セカンド",
  5: "サード",
  6: "ショート",
  7: "レフト",
  8: "センター",
  9: "ライト"
};
const outfieldPositions = new Set(["7", "8", "9"]);
const scoreInputState = {
  touches: [],
  playText: "",
  promptText: ""
};
const orderState = {
  own: ownTeam.players.map((player, index) => ({
    ...player,
    rowId: `own-${player.jerseyNumber || index}`
  })),
  opponent: Array.from({ length: maxOrderRows }, (_, index) => ({
    rowId: `opponent-${index + 1}`,
    battingOrder: "",
    positionNumber: "",
    jerseyNumber: "",
    name: ""
  }))
};
const orderDragState = {
  teamKey: null,
  rowId: null,
  ghost: null,
  offsetX: 0,
  offsetY: 0
};

function findOwnPlayer(jerseyNumber) {
  return orderState.own.find((player) => player.jerseyNumber === jerseyNumber);
}

function findOwnPlayerByPosition(positionNumber) {
  return orderState.own.find((player) => player.positionNumber === positionNumber);
}

function findOpponentPlayer(jerseyNumber) {
  const normalizedJersey = normalizeNumber(jerseyNumber);
  return orderState.opponent.find((player) => normalizeNumber(player.jerseyNumber) === normalizedJersey);
}

function getCurrentBattingIndex() {
  return Math.max(0, Number(currentGame.battingOrder || 1) - 1);
}

function getCurrentOwnBatter() {
  return orderState.own[getCurrentBattingIndex()];
}

function getCurrentOpponentBatter() {
  return orderState.opponent[getCurrentBattingIndex()];
}

function syncCurrentBatterWithOrder() {
  const ownBatter = getCurrentOwnBatter();
  const opponentBatter = getCurrentOpponentBatter();

  currentGame.currentBatterJerseyNumber = ownBatter?.jerseyNumber ?? "";
  currentGame.currentOpponentBatterJerseyNumber = opponentBatter?.jerseyNumber ?? currentGame.currentOpponentBatterJerseyNumber;
}

function setText(selector, value) {
  for (const element of document.querySelectorAll(selector)) {
    element.textContent = value;
  }
}

function normalizeNumber(value) {
  return String(value ?? "").trim();
}

function formatJerseyNumber(value) {
  const jerseyNumber = normalizeNumber(value);
  return jerseyNumber ? `#${jerseyNumber}` : "";
}

function formatPlayerLabel(player, fallbackJerseyNumber = "") {
  const jerseyNumber = formatJerseyNumber(player?.jerseyNumber || fallbackJerseyNumber);
  const name = normalizeNumber(player?.name);

  if (jerseyNumber && name) return `${jerseyNumber} ${name}`;
  return jerseyNumber || name;
}

function isOwnBattingNow() {
  return (
    (currentGame.half === "表" && ownTeam.battingSide === "top") ||
    (currentGame.half === "裏" && ownTeam.battingSide === "bottom")
  );
}

function getOpponentName() {
  return opponentTeam.name || currentGame.opponentName || "相手";
}

function getBroadcastTeamName(name) {
  const normalizedName = String(name ?? "").trim();
  if (!normalizedName) return "";

  if (normalizedName.includes(" ")) {
    return normalizedName.split(/\s+/).at(-1);
  }

  const suffixes = ["ドリーム", "スターズ", "クラブ", "ファイターズ", "ジャイアンツ", "イーグルス", "タイガース", "ベアーズ", "ホークス"];
  const suffix = suffixes.find((item) => normalizedName.endsWith(item));
  return suffix ?? normalizedName;
}

function createInput(name, value, label, className, options = {}) {
  const input = document.createElement("input");
  input.name = name;
  input.value = value ?? "";
  input.setAttribute("aria-label", label);
  input.className = className;
  input.autocomplete = "off";
  input.inputMode = options.inputMode ?? "numeric";
  if (options.readOnly) input.readOnly = true;
  if (options.dataField) input.dataset.field = options.dataField;
  if (options.rowId) input.dataset.rowId = options.rowId;
  return input;
}

function createReadonlyCell(value, label, className) {
  const cell = document.createElement("span");
  cell.className = className;
  cell.setAttribute("aria-label", label);
  cell.textContent = value || "";
  return cell;
}

function getDuplicateValues(players, field) {
  const counts = new Map();

  for (const player of players) {
    const value = normalizeNumber(player[field]);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return new Set([...counts].filter(([, count]) => count > 1).map(([value]) => value));
}

function updateOrderErrors(teamKey, players) {
  const positionDuplicates = getDuplicateValues(players, "positionNumber");
  const messages = [];

  if (positionDuplicates.size > 0) {
    messages.push(`守備位置 ${[...positionDuplicates].join("・")} が重複しています`);
  }

  const error = document.querySelector(`[data-order-error='${teamKey}']`);
  if (error) {
    error.textContent = messages.join(" / ");
    error.hidden = messages.length === 0;
  }

  return { positionDuplicates };
}

function createDragHandle(teamKey, rowId) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "order-drag-handle";
  handle.setAttribute("aria-label", "ドラッグして並び替え");
  handle.dataset.dragHandle = "true";
  handle.dataset.teamKey = teamKey;
  handle.dataset.rowId = rowId;
  handle.draggable = true;
  return handle;
}

function clearOrderDragGhost() {
  orderDragState.ghost?.remove();
  orderDragState.ghost = null;
  orderDragState.offsetX = 0;
  orderDragState.offsetY = 0;
}

function moveOrderDragGhost(clientX, clientY) {
  if (!orderDragState.ghost) return;

  orderDragState.ghost.style.left = `${clientX - orderDragState.offsetX}px`;
  orderDragState.ghost.style.top = `${clientY - orderDragState.offsetY}px`;
}

function updateOrderDragGhostNumber() {
  if (!orderDragState.ghost || !orderDragState.teamKey || !orderDragState.rowId) return;

  const index = orderState[orderDragState.teamKey].findIndex((player) => player.rowId === orderDragState.rowId);
  const battingNumber = orderDragState.ghost.querySelector(".order-batting");
  if (battingNumber && index >= 0) {
    battingNumber.textContent = String(index + 1);
  }
}

function createOrderDragGhost(row, pointerEvent) {
  clearOrderDragGhost();

  const rect = row.getBoundingClientRect();
  const ghost = row.cloneNode(true);
  ghost.classList.add("order-drag-ghost");
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;

  orderDragState.offsetX = pointerEvent.clientX - rect.left;
  orderDragState.offsetY = pointerEvent.clientY - rect.top;
  orderDragState.ghost = ghost;
  document.body.append(ghost);
  moveOrderDragGhost(pointerEvent.clientX, pointerEvent.clientY);
  updateOrderDragGhostNumber();
}

function createOrderRow(player, index, teamKey, duplicateValues) {
  const row = document.createElement("div");
  row.className = "order-row";
  row.dataset.rowId = player.rowId;
  row.dataset.teamKey = teamKey;
  row.classList.toggle("is-dragging", orderDragState.rowId === player.rowId);

  const positionNumber = normalizeNumber(player.positionNumber);
  const battingNumber = createReadonlyCell(String(index), "打順", "order-readonly order-batting");
  const positionInput = createInput(
    `${teamKey}-position-${index}`,
    positionNumber,
    "守備位置番号",
    "order-input order-position",
    { dataField: "positionNumber", rowId: player.rowId }
  );

  positionInput.classList.toggle("is-invalid", duplicateValues.positionDuplicates.has(positionNumber));

  if (teamKey === "own") {
    row.append(
      createDragHandle(teamKey, player.rowId),
      battingNumber,
      positionInput,
      createReadonlyCell(player.name, "名前", "order-readonly order-name"),
      createReadonlyCell(formatJerseyNumber(player.jerseyNumber), "背番号", "order-readonly order-jersey")
    );
    return row;
  }

  row.append(
    createDragHandle(teamKey, player.rowId),
    battingNumber,
    positionInput,
    createInput(`${teamKey}-name-${index}`, player.name, "名前", "order-input order-name", {
      dataField: "name",
      rowId: player.rowId,
      inputMode: "text"
    }),
    createInput(`${teamKey}-jersey-${index}`, player.jerseyNumber, "背番号", "order-input order-jersey", {
      dataField: "jerseyNumber",
      rowId: player.rowId
    })
  );

  return row;
}

function renderOrderList(teamKey) {
  const selector = `[data-order-list='${teamKey}']`;
  const list = document.querySelector(selector);
  if (!list) return;

  list.innerHTML = "";
  const players = orderState[teamKey];
  const duplicateValues = updateOrderErrors(teamKey, players);

  const header = document.createElement("div");
  header.className = "order-row order-header";
  header.innerHTML = "<span></span><span>打順</span><span>守備</span><span>名前</span><span>背番号</span>";
  list.append(header);

  for (let index = 0; index < players.length; index += 1) {
    list.append(createOrderRow(players[index], index + 1, teamKey, duplicateValues));
  }
}

function moveOrderRow(teamKey, fromRowId, toRowId) {
  if (!fromRowId || !toRowId || fromRowId === toRowId) return;

  const rows = orderState[teamKey];
  const fromIndex = rows.findIndex((item) => item.rowId === fromRowId);
  const toIndex = rows.findIndex((item) => item.rowId === toRowId);
  if (fromIndex < 0 || toIndex < 0) return;

  const [moved] = rows.splice(fromIndex, 1);
  rows.splice(toIndex, 0, moved);
  syncCurrentBatterWithOrder();
  renderOrderList(teamKey);
  renderGameState();
  updateOrderDragGhostNumber();
}

function updateOrderValue(teamKey, rowId, field, value) {
  const player = orderState[teamKey].find((item) => item.rowId === rowId);
  if (!player) return;

  player[field] = value.trim();
  syncCurrentBatterWithOrder();
  renderOrderList(teamKey);
  renderGameState();
}

function initOrderForms() {
  for (const teamKey of ["own", "opponent"]) {
    const list = document.querySelector(`[data-order-list='${teamKey}']`);
    if (!list) continue;

    list.addEventListener("input", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.readOnly) return;
      updateOrderValue(teamKey, input.dataset.rowId, input.dataset.field, input.value);
      const nextInput = document.querySelector(
        `[data-order-list='${teamKey}'] [data-row-id='${input.dataset.rowId}'][data-field='${input.dataset.field}']`
      );
      if (nextInput instanceof HTMLInputElement) {
        nextInput.focus();
        nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
      }
    });

    list.addEventListener("dragstart", (event) => {
      const handle = event.target.closest("[data-drag-handle]");
      if (!handle) return;

      orderDragState.teamKey = teamKey;
      orderDragState.rowId = handle.dataset.rowId;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", handle.dataset.rowId);
    });

    list.addEventListener("dragover", (event) => {
      event.preventDefault();
      const row = event.target.closest(".order-row[data-row-id]");
      if (!row || orderDragState.teamKey !== teamKey) return;
      moveOrderRow(teamKey, orderDragState.rowId, row.dataset.rowId);
    });

    list.addEventListener("dragend", () => {
      orderDragState.teamKey = null;
      orderDragState.rowId = null;
      clearOrderDragGhost();
      renderOrderList(teamKey);
    });

    list.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest("[data-drag-handle]");
      if (!handle) return;
      const row = handle.closest(".order-row[data-row-id]");
      if (!row) return;

      orderDragState.teamKey = teamKey;
      orderDragState.rowId = handle.dataset.rowId;
      createOrderDragGhost(row, event);
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
      renderOrderList(teamKey);
    });
  }
}

function initOrderPointerDrag() {
  document.addEventListener("pointermove", (event) => {
    if (!orderDragState.rowId || !orderDragState.teamKey) return;

    moveOrderDragGhost(event.clientX, event.clientY);
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const row = element?.closest?.(".order-row[data-row-id]");
    if (!row || row.dataset.teamKey !== orderDragState.teamKey) return;

    moveOrderRow(orderDragState.teamKey, orderDragState.rowId, row.dataset.rowId);
  });

  document.addEventListener("pointerup", () => {
    if (!orderDragState.teamKey) return;
    const teamKey = orderDragState.teamKey;
    orderDragState.teamKey = null;
    orderDragState.rowId = null;
    clearOrderDragGhost();
    renderOrderList(teamKey);
  });
}

function initOpponentTeamName() {
  const input = document.querySelector("[data-opponent-team-name]");
  if (!(input instanceof HTMLInputElement)) return;

  input.value = opponentTeam.name;
  input.addEventListener("input", () => {
    opponentTeam.name = input.value.trim();
    currentGame.opponentName = opponentTeam.name || "相手";
    renderGameState();
  });
}

function updateBattingSideLock() {
  const select = document.querySelector("[data-batting-side]");
  if (select instanceof HTMLSelectElement) {
    select.disabled = Boolean(currentGame.firstPitchEntered);
  }
}

function initBattingSideSelector() {
  const select = document.querySelector("[data-batting-side]");
  if (!(select instanceof HTMLSelectElement)) return;

  select.value = ownTeam.battingSide;
  updateBattingSideLock();

  select.addEventListener("change", () => {
    if (currentGame.firstPitchEntered) {
      select.value = ownTeam.battingSide;
      updateBattingSideLock();
      return;
    }

    ownTeam.battingSide = select.value;
    renderGameState();
  });
}

function initFirstPitchLock() {
  document.querySelectorAll(".pitch-buttons button").forEach((button) => {
    button.addEventListener("click", () => {
      if (currentGame.firstPitchEntered) return;
      currentGame.firstPitchEntered = true;
      updateBattingSideLock();
    });
  });
}

function renderBroadcastCounts() {
  const groups = [
    { selector: ".broadcast-counts div:nth-child(1) i", activeClass: "green", value: currentGame.balls },
    { selector: ".broadcast-counts div:nth-child(2) i", activeClass: "yellow", value: currentGame.strikes },
    { selector: ".broadcast-counts div:nth-child(3) i", activeClass: "red", value: currentGame.outs }
  ];

  for (const group of groups) {
    document.querySelectorAll(group.selector).forEach((dot, index) => {
      dot.classList.toggle(group.activeClass, index < group.value);
    });
  }
}

function renderBatterPanel() {
  const ownBatting = isOwnBattingNow();
  const batterIcon = document.querySelector(".batter-icon");

  if (batterIcon instanceof HTMLImageElement) {
    batterIcon.src = ownBatting ? "assets/batter-red.png" : "assets/batter-blue.png";
  }

  if (ownBatting) {
    const batter = getCurrentOwnBatter();
    currentGame.currentBatterJerseyNumber = batter?.jerseyNumber ?? "";
    setText("[data-batter-name]", `${currentGame.battingOrder}番 ${batter?.name ?? "未設定"}`);
    setText(
      "[data-pitcher-number]",
      formatPlayerLabel(findOpponentPlayer(currentGame.currentOpponentPitcherJerseyNumber), currentGame.currentOpponentPitcherJerseyNumber) || "?"
    );
    return;
  }

  const pitcher = findOwnPlayer(currentGame.currentPitcherJerseyNumber) || findOwnPlayerByPosition("1");
  const opponentBatter = getCurrentOpponentBatter();
  currentGame.currentOpponentBatterJerseyNumber = opponentBatter?.jerseyNumber ?? currentGame.currentOpponentBatterJerseyNumber;
  const opponentJersey = formatPlayerLabel(opponentBatter, currentGame.currentOpponentBatterJerseyNumber);
  setText("[data-batter-name]", `${currentGame.battingOrder}番 ${opponentJersey || "未設定"}`);
  setText("[data-pitcher-number]", formatPlayerLabel(pitcher, currentGame.currentPitcherJerseyNumber) || "?");
}

function renderBroadcastScore() {
  const board = document.querySelector(".broadcast-score");
  if (!board) return;

  const ownSlot = {
    key: "own",
    name: getBroadcastTeamName(ownTeam.name),
    score: currentGame.ownScore
  };
  const opponentSlot = {
    key: "opponent",
    name: getBroadcastTeamName(getOpponentName()),
    score: currentGame.opponentScore
  };
  const slots = ownTeam.battingSide === "top" ? [ownSlot, opponentSlot] : [opponentSlot, ownSlot];

  board.innerHTML = `
    <span class="team ${slots[0].key}" data-broadcast-team="${slots[0].key}">${slots[0].name}</span>
    <strong class="${slots[0].key}" data-broadcast-score="${slots[0].key}">${slots[0].score}</strong>
    <span class="separator">-</span>
    <strong class="${slots[1].key}" data-broadcast-score="${slots[1].key}">${slots[1].score}</strong>
    <span class="team ${slots[1].key}" data-broadcast-team="${slots[1].key}">${slots[1].name}</span>
  `;
}

function renderScoreMatrixState() {
  const hitMark = document.querySelector("[data-hit-mark]");
  const playText = document.querySelector(".matrix-play");

  if (hitMark && hitMarkAssets[currentGame.hitType]) {
    hitMark.src = hitMarkAssets[currentGame.hitType];
    hitMark.dataset.hitMark = currentGame.hitType;
    hitMark.hidden = false;
  } else if (hitMark) {
    hitMark.hidden = true;
  }

  if (playText) {
    playText.textContent = scoreInputState.playText;
    playText.hidden = !scoreInputState.playText;
  }
}

function renderPendingReason() {
  const reasonRow = document.querySelector(".reason-row");
  const reasonLabel = reasonRow?.querySelector("b");
  const confirmButton = reasonRow?.querySelector(".confirm");
  const hasPendingInput = Boolean(scoreInputState.playText || scoreInputState.promptText);

  if (reasonRow) reasonRow.hidden = !hasPendingInput;
  if (reasonLabel && hasPendingInput) reasonLabel.textContent = scoreInputState.playText || scoreInputState.promptText;
  if (confirmButton) confirmButton.disabled = !scoreInputState.playText;
}

function renderPositionInputState() {
  const selectedPositions = new Set(scoreInputState.touches.map((touch) => touch.position));
  document.querySelectorAll("[data-position]").forEach((button) => {
    button.classList.toggle("active", selectedPositions.has(button.dataset.position));
  });

  const bubble = document.querySelector(".decision-bubble");
  const currentTouch = scoreInputState.touches.at(-1);
  if (!bubble) return;

  bubble.hidden = !currentTouch || Boolean(currentTouch.decision) || isCompletedScoreInput();
  if (!currentTouch || bubble.hidden) return;

  const selectedButton = document.querySelector(`[data-position='${currentTouch.position}']`);
  const fieldStage = document.querySelector(".field-stage");
  if (!selectedButton || !fieldStage) return;

  const buttonRect = selectedButton.getBoundingClientRect();
  const stageRect = fieldStage.getBoundingClientRect();
  bubble.style.left = `${buttonRect.left - stageRect.left + buttonRect.width / 2}px`;
  bubble.style.top = `${Math.max(8, buttonRect.top - stageRect.top - bubble.offsetHeight - 8)}px`;
}

function renderGameState() {
  setText("[data-team-name]", ownTeam.name);
  setText("[data-team-short]", ownTeam.shortName);
  setText("[data-inning]", `${currentGame.inning}回${currentGame.half}`);

  renderBatterPanel();
  renderBroadcastScore();
  renderBroadcastCounts();
  renderScoreMatrixState();
  renderPendingReason();
  renderPositionInputState();
}

function advanceBattingOrder() {
  currentGame.battingOrder = currentGame.battingOrder >= 9 ? 1 : currentGame.battingOrder + 1;
  syncCurrentBatterWithOrder();
}

function getPositionName(position) {
  return positionNames[position] ?? "";
}

function buildPlayText() {
  const [firstTouch, secondTouch] = scoreInputState.touches;
  if (!firstTouch) return "";

  const firstPositionName = getPositionName(firstTouch.position);
  if (scoreInputState.touches.length >= 3 && secondTouch?.decision === "out") {
    return "ゲッツー";
  }

  if (firstTouch.decision === "safe") return `${firstPositionName}ヒット`;
  if (firstTouch.decision === "out") {
    return outfieldPositions.has(firstTouch.position) ? `${firstPositionName}フライアウト` : `${firstPositionName}ゴロアウト`;
  }

  if (secondTouch) return `${firstPositionName}ゴロ`;
  return "";
}

function isCompletedScoreInput() {
  const [firstTouch, secondTouch] = scoreInputState.touches;
  return Boolean(firstTouch?.decision || (scoreInputState.touches.length >= 3 && secondTouch?.decision === "out"));
}

function updateScoreInputPlay() {
  scoreInputState.playText = buildPlayText();
  const currentTouch = scoreInputState.touches.at(-1);
  scoreInputState.promptText = currentTouch && !currentTouch.decision && !isCompletedScoreInput()
    ? `${getPositionName(currentTouch.position)}の判定を選択`
    : "";
  currentGame.hitType = scoreInputState.touches[0]?.decision === "safe" ? "single" : "";
  currentGame.balls = 0;
  currentGame.strikes = 0;
  currentGame.firstPitchEntered = true;
  updateBattingSideLock();
  renderGameState();
}

function cancelPendingScoreInput() {
  currentGame.hitType = "";
  scoreInputState.touches = [];
  scoreInputState.playText = "";
  scoreInputState.promptText = "";
  renderGameState();
}

function confirmPendingScoreInput() {
  if (!scoreInputState.playText) return;

  currentGame.hitType = "";
  scoreInputState.touches = [];
  scoreInputState.playText = "";
  scoreInputState.promptText = "";
  currentGame.balls = 0;
  currentGame.strikes = 0;
  advanceBattingOrder();
  renderGameState();
}

function selectFieldingPosition(position) {
  if (!positionNames[position]) return;

  scoreInputState.touches.push({ position, decision: "" });
  updateScoreInputPlay();
}

function selectFieldingDecision(decision) {
  const currentTouch = scoreInputState.touches.at(-1);
  if (!currentTouch || !["out", "safe", "unknown"].includes(decision)) return;

  currentTouch.decision = decision === "unknown" ? "" : decision;
  updateScoreInputPlay();
}

function initFieldingInput() {
  document.querySelectorAll("[data-position]").forEach((button) => {
    button.addEventListener("click", () => selectFieldingPosition(button.dataset.position));
  });

  document.querySelectorAll("[data-decision]").forEach((button) => {
    button.addEventListener("click", () => selectFieldingDecision(button.dataset.decision));
  });

  document.querySelector(".reason-row .ghost")?.addEventListener("click", cancelPendingScoreInput);
  document.querySelector(".reason-row .confirm")?.addEventListener("click", confirmPendingScoreInput);
}

function closeBatterDialog() {
  const dialog = document.querySelector("[data-batter-dialog]");
  if (dialog) dialog.hidden = true;
}

function getBenchPlayers() {
  return orderState.own.slice(9);
}

function getRegisteredOpponentJerseyNumbers() {
  return [...new Set(orderState.opponent.map((player) => normalizeNumber(player.jerseyNumber)).filter(Boolean))];
}

function substituteOwnBatter(playerRowId) {
  const battingIndex = currentGame.battingOrder - 1;
  const benchIndex = orderState.own.findIndex((player) => player.rowId === playerRowId);
  if (battingIndex < 0 || benchIndex < 0 || battingIndex === benchIndex) return;

  [orderState.own[battingIndex], orderState.own[benchIndex]] = [orderState.own[benchIndex], orderState.own[battingIndex]];
  currentGame.currentBatterJerseyNumber = orderState.own[battingIndex].jerseyNumber;
  renderOrderList("own");
  renderGameState();
  closeBatterDialog();
}

function renderOwnBenchDialog() {
  const title = document.querySelector("[data-batter-dialog-title]");
  const list = document.querySelector("[data-bench-player-list]");
  const opponentForm = document.querySelector("[data-opponent-batter-form]");
  const opponentPitcherForm = document.querySelector("[data-opponent-pitcher-form]");
  if (title) title.textContent = "控え選手と入れ替え";
  if (opponentForm) opponentForm.hidden = true;
  if (opponentPitcherForm) opponentPitcherForm.hidden = true;
  if (!list) return;

  list.hidden = false;
  list.innerHTML = "";
  const benchPlayers = getBenchPlayers();

  if (benchPlayers.length === 0) {
    const message = document.createElement("div");
    message.className = "empty-bench-message";
    message.textContent = "控え選手がいません";
    list.append(message);
    return;
  }

  for (const player of benchPlayers) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bench-player-button";
    button.innerHTML = `
      <span>${formatJerseyNumber(player.jerseyNumber)}</span>
      <strong>${player.name}</strong>
      <small>控え</small>
    `;
    button.addEventListener("click", () => substituteOwnBatter(player.rowId));
    list.append(button);
  }
}

function renderOpponentBatterDialog() {
  const title = document.querySelector("[data-batter-dialog-title]");
  const list = document.querySelector("[data-bench-player-list]");
  const opponentForm = document.querySelector("[data-opponent-batter-form]");
  const opponentPitcherForm = document.querySelector("[data-opponent-pitcher-form]");
  const input = document.querySelector("[data-opponent-batter-jersey]");

  if (title) title.textContent = "相手打者の背番号";
  if (list) {
    list.innerHTML = "";
    list.hidden = true;
  }
  if (opponentForm) opponentForm.hidden = false;
  if (opponentPitcherForm) opponentPitcherForm.hidden = true;
  if (input instanceof HTMLInputElement) {
    input.value = currentGame.currentOpponentBatterJerseyNumber;
    setTimeout(() => input.focus(), 0);
  }
}

function setOwnPitcher(player) {
  currentGame.currentPitcherJerseyNumber = player.jerseyNumber;
  for (const ownPlayer of orderState.own) {
    if (ownPlayer.positionNumber === "1") ownPlayer.positionNumber = "";
  }
  player.positionNumber = "1";
  renderOrderList("own");
  renderGameState();
  closeBatterDialog();
}

function setOpponentPitcher(jerseyNumber) {
  const normalizedJersey = normalizeNumber(jerseyNumber);
  currentGame.currentOpponentPitcherJerseyNumber = normalizedJersey;
  const emptyRow = orderState.opponent.find((player) => !normalizeNumber(player.jerseyNumber));
  if (normalizedJersey && emptyRow && !getRegisteredOpponentJerseyNumbers().includes(normalizedJersey)) {
    emptyRow.jerseyNumber = normalizedJersey;
  }
  renderOrderList("opponent");
  renderGameState();
  closeBatterDialog();
}

function renderOwnPitcherDialog() {
  const title = document.querySelector("[data-batter-dialog-title]");
  const list = document.querySelector("[data-bench-player-list]");
  const opponentForm = document.querySelector("[data-opponent-batter-form]");
  const opponentPitcherForm = document.querySelector("[data-opponent-pitcher-form]");
  if (title) title.textContent = "ピッチャー交代";
  if (opponentForm) opponentForm.hidden = true;
  if (opponentPitcherForm) opponentPitcherForm.hidden = true;
  if (!list) return;

  list.hidden = false;
  list.innerHTML = "";

  for (const player of orderState.own) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bench-player-button";
    button.innerHTML = `
      <span>${formatJerseyNumber(player.jerseyNumber)}</span>
      <strong>${player.name}</strong>
      <small>${player.positionNumber === "1" ? "現在" : "選択"}</small>
    `;
    button.addEventListener("click", () => setOwnPitcher(player));
    list.append(button);
  }
}

function renderOpponentPitcherDialog() {
  const title = document.querySelector("[data-batter-dialog-title]");
  const list = document.querySelector("[data-bench-player-list]");
  const opponentForm = document.querySelector("[data-opponent-batter-form]");
  const opponentPitcherForm = document.querySelector("[data-opponent-pitcher-form]");
  const input = document.querySelector("[data-opponent-pitcher-jersey]");
  if (title) title.textContent = "相手ピッチャー";
  if (opponentForm) opponentForm.hidden = true;
  if (opponentPitcherForm) opponentPitcherForm.hidden = false;
  if (!list) return;

  list.hidden = false;
  list.innerHTML = "";

  const jerseys = getRegisteredOpponentJerseyNumbers();
  for (const jersey of jerseys) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bench-player-button";
    button.innerHTML = `
      <span>${formatJerseyNumber(jersey)}</span>
      <strong>登録済み選手</strong>
      <small>${currentGame.currentOpponentPitcherJerseyNumber === jersey ? "現在" : "選択"}</small>
    `;
    button.addEventListener("click", () => setOpponentPitcher(jersey));
    list.append(button);
  }

  if (jerseys.length === 0) {
    const message = document.createElement("div");
    message.className = "empty-bench-message";
    message.textContent = "登録済み背番号がありません";
    list.append(message);
  }

  if (input instanceof HTMLInputElement) {
    input.value = currentGame.currentOpponentPitcherJerseyNumber;
  }
}

function openBatterDialog() {
  const dialog = document.querySelector("[data-batter-dialog]");
  if (!dialog) return;

  if (isOwnBattingNow()) {
    renderOwnBenchDialog();
  } else {
    renderOpponentBatterDialog();
  }

  dialog.hidden = false;
}

function openPitcherDialog() {
  const dialog = document.querySelector("[data-batter-dialog]");
  if (!dialog) return;

  if (isOwnBattingNow()) {
    renderOpponentPitcherDialog();
  } else {
    renderOwnPitcherDialog();
  }

  dialog.hidden = false;
}

function initBatterDialog() {
  document.querySelector("[data-batter-select]")?.addEventListener("click", openBatterDialog);
  document.querySelector("[data-pitcher-select]")?.addEventListener("click", openPitcherDialog);

  document.querySelectorAll("[data-close-batter-dialog]").forEach((element) => {
    element.addEventListener("click", closeBatterDialog);
  });

  const opponentForm = document.querySelector("[data-opponent-batter-form]");
  opponentForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("[data-opponent-batter-jersey]");
    if (!(input instanceof HTMLInputElement)) return;

    const jerseyNumber = normalizeNumber(input.value);
    currentGame.currentOpponentBatterJerseyNumber = jerseyNumber;
    const batterRow = orderState.opponent[currentGame.battingOrder - 1];
    if (batterRow) batterRow.jerseyNumber = jerseyNumber;
    renderOrderList("opponent");
    renderGameState();
    closeBatterDialog();
  });

  const opponentPitcherForm = document.querySelector("[data-opponent-pitcher-form]");
  opponentPitcherForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("[data-opponent-pitcher-jersey]");
    if (!(input instanceof HTMLInputElement)) return;

    setOpponentPitcher(input.value);
  });
}

function initTabs() {
  const tabs = document.querySelectorAll("[data-tab]");
  const views = document.querySelectorAll("[data-view]");

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const activeView = tab.dataset.tab;

      for (const item of tabs) {
        const isActive = item === tab;
        item.classList.toggle("active", isActive);
        if (isActive) {
          item.setAttribute("aria-current", "page");
        } else {
          item.removeAttribute("aria-current");
        }
      }

      for (const view of views) {
        view.hidden = view.dataset.view !== activeView;
      }

      renderGameState();
    });
  }
}

function initAppShell() {
  document.documentElement.style.setProperty("--own-team-color", ownTeam.colorHex);
  syncCurrentBatterWithOrder();
  renderGameState();

  renderOrderList("own");
  renderOrderList("opponent");
  initOrderForms();
  initOrderPointerDrag();
  initOpponentTeamName();
  initBattingSideSelector();
  initFirstPitchLock();
  initBatterDialog();
  initFieldingInput();
  initTabs();
}

initAppShell();
