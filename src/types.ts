export type BattingSide = "top" | "bottom";
export type TeamKey = "own" | "opponent";
export type TabKey = "order" | "score" | "output";
export type PitchType = "strike" | "foul" | "ball" | "dead";
export type HitType = "" | "single" | "two-base" | "three-base" | "home-run";

export interface Player {
  rowId: string;
  battingOrder: string;
  positionNumber: string;
  jerseyNumber: string;
  name: string;
}

export interface Team {
  id?: string;
  name: string;
  shortName?: string;
  color: "red" | "blue";
  colorHex: string;
  battingSide?: BattingSide;
}

export interface GameState {
  inning: number;
  half: "表" | "裏";
  balls: number;
  strikes: number;
  outs: number;
  ownScore: number;
  opponentScore: number;
  battingOrder: number;
  currentBatterJerseyNumber: string;
  currentOpponentBatterJerseyNumber: string;
  currentPitcherJerseyNumber: string;
  currentOpponentPitcherJerseyNumber: string;
  hitType: HitType;
  firstPitchEntered: boolean;
  runnerFirst: boolean;
}

export interface PlateAppearance {
  pitches: string[];
  result: string;
  outNumber: number;
}

export interface AppState {
  ownTeam: Team & { battingSide: BattingSide };
  opponentTeam: Team;
  ownOrder: Player[];
  opponentOrder: Player[];
  game: GameState;
  plate: PlateAppearance;
  promptedBatterKeys: string[];
}
