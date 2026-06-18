import type { AppState, BatterBox, Player } from "./types";

const ownPlayers: Omit<Player, "rowId" | "batterBox">[] = [
  { battingOrder: "1", positionNumber: "3", jerseyNumber: "3", name: "川崎 白輝" },
  { battingOrder: "2", positionNumber: "8", jerseyNumber: "5", name: "小山 翔平" },
  { battingOrder: "3", positionNumber: "1", jerseyNumber: "10", name: "高市 瑛翔" },
  { battingOrder: "4", positionNumber: "2", jerseyNumber: "2", name: "牛山 朝陽" },
  { battingOrder: "5", positionNumber: "5", jerseyNumber: "6", name: "塚本 慶" },
  { battingOrder: "6", positionNumber: "4", jerseyNumber: "1", name: "湊谷 夏向" },
  { battingOrder: "7", positionNumber: "7", jerseyNumber: "9", name: "入澤 優馬" },
  { battingOrder: "8", positionNumber: "6", jerseyNumber: "4", name: "松長 尚吾" },
  { battingOrder: "9", positionNumber: "9", jerseyNumber: "7", name: "望月 蒼太" },
  { battingOrder: "", positionNumber: "", jerseyNumber: "11", name: "平木 湊也" },
  { battingOrder: "", positionNumber: "", jerseyNumber: "8", name: "橋本 剣心" },
  { battingOrder: "", positionNumber: "", jerseyNumber: "12", name: "浅井 遥太" },
  { battingOrder: "", positionNumber: "", jerseyNumber: "13", name: "伊藤 大智" }
];

export const maxOrderRows = 21;

function getDefaultBatterBox(jerseyNumber: string): BatterBox {
  return jerseyNumber === "10" || jerseyNumber === "11" || jerseyNumber === "13" ? "left" : "right";
}

export const initialState: AppState = {
  ownTeam: {
    id: "higashimurayama-dream",
    name: "東村山ドリーム",
    shortName: "東村山",
    color: "red",
    colorHex: "#ff4048",
    battingSide: "top"
  },
  opponentTeam: {
    name: "",
    color: "blue",
    colorHex: "#2a8dff"
  },
  ownOrder: ownPlayers.map((player, index) => ({
    ...player,
    batterBox: getDefaultBatterBox(player.jerseyNumber),
    rowId: `own-${player.jerseyNumber || index}`
  })),
  opponentOrder: Array.from({ length: maxOrderRows }, (_, index) => ({
    rowId: `opponent-${index + 1}`,
    battingOrder: "",
    positionNumber: "",
    jerseyNumber: "",
    name: "",
    batterBox: "right"
  })),
  game: {
    inning: 1,
    half: "表",
    balls: 0,
    strikes: 0,
    outs: 0,
    ownScore: 0,
    opponentScore: 0,
    ownBattingOrder: 1,
    opponentBattingOrder: 1,
    battingOrder: 1,
    currentBatterJerseyNumber: "3",
    currentOpponentBatterJerseyNumber: "",
    currentPitcherJerseyNumber: "",
    currentOpponentPitcherJerseyNumber: "",
    hitType: "",
    firstPitchEntered: false,
    gameStarted: false,
    runnerFirst: false,
    runners: {
      first: null,
      second: null,
      third: null
    }
  },
  plate: {
    pitches: [],
    result: "",
    outNumber: 0
  },
  promptedBatterKeys: []
};
