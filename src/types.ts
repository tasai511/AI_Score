export type BattingSide = "top" | "bottom";
export type TeamKey = "own" | "opponent";
export type TabKey = "order" | "score" | "output";
export type PitchType = "strike" | "foul" | "ball" | "dead";
export type HitType = "" | "single" | "two-base" | "three-base" | "home-run";
export type BaseKey = "first" | "second" | "third";
export type RunnerDestination = BaseKey | "home";
export type RunnerSource = "batter" | BaseKey;
export type BatterBox = "right" | "left";
export type AdvanceReason =
  | "walk"
  | "dead-ball"
  | "dropped-third-strike"
  | "catcher-interference"
  | "error"
  | "steal"
  | "passed-ball"
  | "balk"
  | "runner-interference"
  | "fielder-choice"
  | "hit";

export interface Player {
  rowId: string;
  battingOrder: string;
  positionNumber: string;
  jerseyNumber: string;
  name: string;
  batterBox: BatterBox;
}

export interface Team {
  id?: string;
  name: string;
  shortName?: string;
  color: "red" | "blue";
  colorHex: string;
  battingSide?: BattingSide;
}

export interface RunnerState {
  id: string;
  teamKey: TeamKey;
  battingOrder: number;
  jerseyNumber: string;
  name: string;
  scoreCard: {
    pitches: string[];
    result: string;
    outNumber: number;
    hitType: HitType;
    hitLocation?: string;
  };
  scoreAdvances: {
    destination: RunnerDestination;
    reason: AdvanceReason;
  }[];
  scoreNotes: string[];
}

export type ScoreCellMark = {
  kind: "pitch" | "result" | "out" | "note" | "advance" | "fielderOut" | "hitLocation";
  text: string;
  area?: "pitch" | "center" | "result" | "first" | "second" | "third" | "home";
};

export type BaseRunners = Record<BaseKey, RunnerState | null>;

export interface GameState {
  inning: number;
  half: "表" | "裏";
  balls: number;
  strikes: number;
  outs: number;
  ownScore: number;
  opponentScore: number;
  ownBattingOrder: number;
  opponentBattingOrder: number;
  battingOrder: number;
  currentBatterJerseyNumber: string;
  currentOpponentBatterJerseyNumber: string;
  currentPitcherJerseyNumber: string;
  currentOpponentPitcherJerseyNumber: string;
  hitType: HitType;
  firstPitchEntered: boolean;
  gameStarted: boolean;
  runnerFirst: boolean;
  runners: BaseRunners;
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
