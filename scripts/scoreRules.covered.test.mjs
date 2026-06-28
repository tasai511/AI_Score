import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importTypeScript(path) {
  const source = await readFile(path, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX
    },
    fileName: path
  });
  const encoded = Buffer.from(`${outputText}\n//# sourceURL=${path}.js`).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

const data = await importTypeScript("src/data.ts");
const rules = await importTypeScript("src/scoreRules.ts");

function clone(value) {
  return structuredClone(value);
}

function makeRunner(id, battingOrder, scoreAdvances = [{ destination: "first", reason: "hit" }]) {
  return {
    id,
    teamKey: "own",
    battingOrder,
    jerseyNumber: String(battingOrder),
    name: `Runner ${battingOrder}`,
    scoreCard: {
      pitches: [],
      result: "B",
      outNumber: 0,
      hitType: ""
    },
    scoreAdvances,
    scoreNotes: []
  };
}

function applyPitches(state, pitches) {
  return pitches.reduce((current, pitch) => rules.applyPitch(current, pitch), state);
}

{
  const state = applyPitches(clone(data.initialState), ["ball", "ball", "ball", "ball"]);
  assert.equal(state.plate.result, "B");
  assert.equal(state.game.runners.first?.scoreCard.result, "B");
  assert.deepEqual(state.game.runners.first?.scoreAdvances.at(-1), { destination: "first", reason: "walk" });
}

{
  const state = clone(data.initialState);
  state.game.runners = {
    first: makeRunner("r1", 8),
    second: makeRunner("r2", 7, [
      { destination: "first", reason: "hit" },
      { destination: "second", reason: "hit" }
    ]),
    third: makeRunner("r3", 6, [
      { destination: "first", reason: "hit" },
      { destination: "second", reason: "hit" },
      { destination: "third", reason: "hit" }
    ])
  };

  const next = applyPitches(state, ["ball", "ball", "ball", "ball"]);
  assert.equal(next.plate.result, "B");
  assert.equal(next.game.ownScore, 1);
  assert.equal(next.game.runners.first?.scoreAdvances.at(-1).reason, "walk");
}

{
  const state = rules.applyPitch(clone(data.initialState), "dead");
  assert.equal(state.plate.result, "HP");
  assert.equal(state.game.runners.first?.scoreCard.result, "HP");
  assert.deepEqual(state.game.runners.first?.scoreAdvances.at(-1), { destination: "first", reason: "dead-ball" });
  assert.equal(rules.buildCurrentScoreCellMarks(state).some((mark) => mark.kind === "result" && mark.text === "HP"), true);
}

{
  const state = rules.advanceRunner(clone(data.initialState), "batter", "hit", "9");
  const runner = state.game.runners.first;
  assert.equal(runner?.scoreCard.result, "");
  assert.equal(runner?.scoreCard.hitLocation, "9");
  assert.deepEqual(runner?.scoreAdvances, [{ destination: "first", reason: "hit" }]);
  assert.equal(runner?.scoreNotes.includes("安打"), true);

  const currentMarks = rules.buildCurrentScoreCellMarks(state);
  assert.equal(currentMarks.filter((mark) => mark.kind === "advance" && mark.area === "first").length, 1);
  assert.equal(currentMarks.filter((mark) => mark.kind === "note" && mark.text === "安打").length, 0);
  assert.equal(currentMarks.filter((mark) => mark.kind === "hitLocation" && mark.text === "9").length, 1);
  assert.equal(currentMarks.some((mark) => mark.text === "右安" || mark.text === "中安" || mark.text === "左安"), false);

  const runnerMarks = rules.buildRunnerScoreCellMarks(runner, null, "first");
  assert.equal(runnerMarks.filter((mark) => mark.kind === "note" && mark.text === "安打").length, 0);
  assert.equal(runnerMarks.filter((mark) => mark.kind === "hitLocation" && mark.text === "9").length, 1);
  assert.equal(runnerMarks.some((mark) => mark.text === "右安" || mark.text === "中安" || mark.text === "左安"), false);
}

{
  const state = rules.advanceRunner(clone(data.initialState), "batter", "hit", "4");
  const currentMarks = rules.buildCurrentScoreCellMarks(state);
  assert.equal(currentMarks.filter((mark) => mark.kind === "hitLocation" && mark.text === "4").length, 1);
  assert.equal(currentMarks.some((mark) => mark.text === "二安"), false);
}

{
  const state = clone(data.initialState);
  state.game.strikes = 2;
  state.plate.pitches = ["\u2715", "\u2715"];
  const next = rules.applyPitch(state, "foul");
  assert.equal(next.game.strikes, 2);
  assert.equal(next.plate.pitches.at(-1), "\u25b3");
}

{
  const state = clone(data.initialState);
  state.game.strikes = 2;
  state.plate.pitches = ["\u2715", "\u25b3"];
  const next = rules.applyPitch(state, "strike");
  assert.equal(next.plate.result, "K");
  assert.equal(next.game.outs, 1);
  assert.equal(next.plate.outNumber, 1);
}

{
  const state = clone(data.initialState);
  state.game.runners.first = makeRunner("steal-runner", 1);
  const next = rules.moveRunnerToDestination(state, "first", "second", "steal");
  assert.equal(next.game.runners.first, null);
  assert.equal(next.game.runners.second?.id, "steal-runner");
  assert.deepEqual(next.game.runners.second?.scoreAdvances.at(-1), { destination: "second", reason: "steal" });
}

{
  const state = clone(data.initialState);
  state.game.runners.third = makeRunner("balk-runner", 1, [
    { destination: "first", reason: "hit" },
    { destination: "second", reason: "hit" },
    { destination: "third", reason: "hit" }
  ]);
  const next = rules.moveRunnerToDestination(state, "third", "home", "balk");
  assert.equal(next.game.ownScore, 1);
  assert.equal(next.game.runners.third, null);
}

{
  const state = clone(data.initialState);
  state.game.runners = {
    first: makeRunner("r1", 8),
    second: makeRunner("r2", 7, [
      { destination: "first", reason: "hit" },
      { destination: "second", reason: "hit" }
    ]),
    third: makeRunner("r3", 6, [
      { destination: "first", reason: "hit" },
      { destination: "second", reason: "hit" },
      { destination: "third", reason: "hit" }
    ])
  };

  const next = rules.applyHomeRun(state);
  assert.equal(next.plate.result, "本");
  assert.equal(next.game.hitType, "home-run");
  assert.equal(next.game.ownScore, 4);
  assert.deepEqual(next.game.runners, { first: null, second: null, third: null });
}

console.log("scoreRules covered tests passed");
