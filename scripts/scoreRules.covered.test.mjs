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

const baseAreas = new Set(["first", "second", "third", "home"]);

function visibleAdvanceMarks(marks) {
  return marks.filter((mark) => mark.kind === "advance" && baseAreas.has(mark.area));
}

function hasJapaneseScoreText(marks) {
  return marks.some((mark) => /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(mark.text));
}

{
  const initial = clone(data.initialState);
  initial.game.hitType = "single";
  const state = applyPitches(initial, ["ball", "ball", "ball", "ball"]);
  assert.equal(state.plate.result, "B");
  assert.equal(state.game.hitType, "");
  assert.equal(state.game.runners.first?.scoreCard.result, "B");
  assert.equal(state.game.runners.first?.scoreCard.hitType, "");
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
  const currentMarks = rules.buildCurrentScoreCellMarks(next);
  const runnerMarks = rules.buildRunnerScoreCellMarks(next.game.runners.first, null, "first");
  assert.equal(currentMarks.filter((mark) => mark.kind === "result" && mark.text === "B").length, 1);
  assert.equal(currentMarks.some((mark) => mark.kind === "advance"), false);
  assert.equal(runnerMarks.filter((mark) => mark.kind === "result" && mark.text === "B").length, 1);
  assert.equal(runnerMarks.some((mark) => mark.kind === "advance"), false);
}

{
  const initial = clone(data.initialState);
  initial.game.hitType = "single";
  const state = rules.applyPitch(initial, "dead");
  assert.equal(state.plate.result, "HP");
  assert.equal(state.game.hitType, "");
  assert.equal(state.game.runners.first?.scoreCard.result, "HP");
  assert.equal(state.game.runners.first?.scoreCard.hitType, "");
  assert.deepEqual(state.game.runners.first?.scoreAdvances.at(-1), { destination: "first", reason: "dead-ball" });
  const currentMarks = rules.buildCurrentScoreCellMarks(state);
  const runnerMarks = rules.buildRunnerScoreCellMarks(state.game.runners.first, null, "first");
  assert.equal(currentMarks.some((mark) => mark.kind === "result" && mark.text === "HP"), true);
  assert.equal(currentMarks.some((mark) => mark.kind === "advance"), false);
  assert.equal(runnerMarks.filter((mark) => mark.text === "HP").length, 1);
  assert.equal(runnerMarks.some((mark) => mark.kind === "advance"), false);
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
  const state = clone(data.initialState);
  state.game.runners.first = makeRunner("r1", 8, [{ destination: "first", reason: "hit" }]);

  const withBatterAtFirst = rules.advanceRunner(state, "batter", "hit", "4");
  const currentPreviewMarks = rules.buildCurrentScoreCellMarks(withBatterAtFirst, [
    { source: "second", destination: "second", resultLabel: "4-6" }
  ]);
  assert.equal(currentPreviewMarks.filter((mark) => mark.kind === "result" && mark.text === "4-" && mark.area === "first").length, 1);
  assert.equal(visibleAdvanceMarks(currentPreviewMarks).length, 0);
  assert.equal(currentPreviewMarks.some((mark) => mark.kind === "hitLocation"), false);

  const forcedRunnerMarks = rules.buildRunnerScoreCellMarks(withBatterAtFirst.game.runners.second, {
    source: "second",
    destination: "second",
    resultLabel: "4-6",
    outNumber: 1
  });
  assert.equal(forcedRunnerMarks.filter((mark) => mark.kind === "advance" && mark.area === "second").length, 0);
  assert.equal(forcedRunnerMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "4-6" && mark.area === "second").length, 1);

  const next = rules.applyFieldOut(withBatterAtFirst, "second", "4-6");
  const batterRunner = next.game.runners.first;
  assert.equal(next.game.runners.second, null);
  assert.equal(batterRunner?.scoreCard.result, "4-");
  assert.equal(batterRunner?.scoreCard.hitType, "");
  assert.equal(batterRunner?.scoreCard.hitLocation, undefined);
  assert.deepEqual(batterRunner?.scoreAdvances, [{ destination: "first", reason: "fielder-choice" }]);

  const batterMarks = rules.buildRunnerScoreCellMarks(batterRunner, null, "first");
  assert.equal(batterMarks.filter((mark) => mark.kind === "result" && mark.text === "4-" && mark.area === "first").length, 1);
  assert.equal(batterMarks.some((mark) => mark.kind === "advance"), false);
  assert.equal(batterMarks.some((mark) => mark.kind === "hitLocation"), false);
}

{
  const state = clone(data.initialState);
  state.game.runners.second = makeRunner("tag-out-runner", 8, [
    { destination: "first", reason: "hit" },
    { destination: "second", reason: "hit" }
  ]);

  const withBatterAtFirst = rules.advanceRunner(state, "batter", "hit", "6");
  const withRunnerAtThird = rules.moveRunnerToDestination(withBatterAtFirst, "second", "third", "hit");
  const currentPreviewMarks = rules.buildCurrentScoreCellMarks(withRunnerAtThird, [
    { source: "third", destination: "third", resultLabel: "6-5 T.O" }
  ]);
  const taggedRunnerMarks = rules.buildRunnerScoreCellMarks(withRunnerAtThird.game.runners.third, {
    source: "third",
    destination: "third",
    resultLabel: "6-5 T.O",
    outNumber: 1
  });

  assert.equal(currentPreviewMarks.filter((mark) => mark.kind === "result" && mark.text === "6-" && mark.area === "first").length, 1);
  assert.equal(taggedRunnerMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "6-5 T.O" && mark.area === "third").length, 1);
  assert.equal(taggedRunnerMarks.some((mark) => mark.kind === "advance" && mark.area === "third"), false);
}

{
  const state = rules.advanceRunner(clone(data.initialState), "batter", "hit", "4");
  const currentMarks = rules.buildCurrentScoreCellMarks(state);
  assert.equal(currentMarks.filter((mark) => mark.kind === "hitLocation" && mark.text === "4").length, 1);
  assert.equal(currentMarks.some((mark) => mark.text === "二安"), false);
}

{
  const state = clone(data.initialState);
  state.plate.result = "4-3";
  state.plate.outNumber = 1;
  state.game.outs = 1;
  const currentMarks = rules.buildCurrentScoreCellMarks(state);
  assert.equal(currentMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "4-3" && mark.area === "first").length, 1);
  assert.equal(currentMarks.filter((mark) => mark.kind === "advance" && mark.area === "first").length, 0);
  assert.equal(currentMarks.filter((mark) => mark.kind === "out" && mark.text === "I").length, 1);
}

{
  assert.equal(
    rules.formatBatterGroundOutResultLabel({ destination: "first", fieldingPosition: "3", coveringPosition: "3" }),
    "3A"
  );
  assert.equal(
    rules.formatBatterGroundOutResultLabel({ destination: "first", fieldingPosition: "3", coveringPosition: "1" }),
    "3-1A"
  );
  assert.equal(
    rules.formatBatterGroundOutResultLabel({ destination: "first", fieldingPosition: "6", coveringPosition: "6" }),
    "6-3"
  );
  assert.equal(
    rules.formatBatterGroundOutResultLabel({ destination: "first", fieldingPosition: "6", coveringPosition: "3" }),
    "6-3"
  );
  assert.equal(rules.getForceOutCoveringPosition("second", "4"), "6");
  assert.equal(rules.getForceOutCoveringPosition("second", "6"), "4");
  assert.equal(rules.getRelayFieldingPosition("4-6"), "6");
  assert.equal(rules.getRelayFieldingPosition("6-4"), "4");
  assert.equal(
    rules.formatBatterGroundOutResultLabel({
      destination: "first",
      fieldingPosition: rules.getRelayFieldingPosition("4-6")
    }),
    "6-3"
  );
  assert.equal(
    rules.formatBatterGroundOutResultLabel({
      destination: "first",
      fieldingPosition: rules.getRelayFieldingPosition("6-4")
    }),
    "4-3"
  );
}

{
  assert.equal(rules.formatFlyOutResultLabel("9", false), "9");
  assert.equal(rules.formatFlyOutResultLabel("5", true), "F5");
  assert.equal(rules.formatFlyOutResultLabel("", false), "");
}

{
  const state = clone(data.initialState);
  state.plate.result = "3-3";
  state.plate.outNumber = 2;
  state.game.outs = 2;
  const currentMarks = rules.buildCurrentScoreCellMarks(state);

  assert.equal(currentMarks.some((mark) => mark.text === "3-3"), false);
  assert.equal(currentMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "3A" && mark.area === "first").length, 1);
  assert.equal(currentMarks.filter((mark) => mark.kind === "out" && mark.text === "II").length, 1);
}

{
  const next = rules.applyFieldOut(clone(data.initialState), "batter", "3-3");
  assert.equal(next.plate.result, "3A");
  const currentMarks = rules.buildCurrentScoreCellMarks(next);

  assert.equal(currentMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "3A" && mark.area === "first").length, 1);
}

{
  const next = rules.applyFieldOut(clone(data.initialState), "batter", "3-1");
  assert.equal(next.plate.result, "3-1A");
  const currentMarks = rules.buildCurrentScoreCellMarks(next);

  assert.equal(currentMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "3-1A" && mark.area === "first").length, 1);
}

{
  const state = rules.advanceRunner(clone(data.initialState), "batter", "hit", "9");
  state.game.hitType = "single";
  const currentMarks = rules.buildCurrentScoreCellMarks(state, [{ source: "batter", resultLabel: "F1" }]);

  assert.equal(visibleAdvanceMarks(currentMarks).length, 0);
  assert.equal(currentMarks.filter((mark) => mark.kind === "hitLocation").length, 0);
  assert.equal(currentMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "F1").length, 1);
  assert.equal(currentMarks.filter((mark) => mark.kind === "out" && mark.text === "I").length, 1);
  assert.equal(currentMarks.some((mark) => mark.kind === "result" && mark.text === "F1"), false);
}

{
  const state = rules.advanceRunner(clone(data.initialState), "batter", "hit", "9");
  state.game.hitType = "single";
  const next = rules.applyFieldOut(state, "batter", "F1");
  const currentMarks = rules.buildCurrentScoreCellMarks(next);

  assert.equal(next.game.hitType, "");
  assert.equal(next.game.runners.first, null);
  assert.equal(next.plate.result, "F1");
  assert.equal(visibleAdvanceMarks(currentMarks).length, 0);
  assert.equal(currentMarks.filter((mark) => mark.kind === "hitLocation").length, 0);
  assert.equal(currentMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "F1").length, 1);
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
  const currentMarks = rules.buildCurrentScoreCellMarks(next);
  assert.equal(currentMarks.some((mark) => mark.kind === "result" && mark.text === "K"), false);
  assert.equal(currentMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "K" && mark.area === "first").length, 1);
  assert.equal(currentMarks.filter((mark) => mark.kind === "out" && mark.text === "I").length, 1);
}

{
  const state = clone(data.initialState);
  state.game.outs = 2;
  state.game.strikes = 2;
  state.plate.pitches = ["\u2715", "\u25b3"];
  const next = rules.applyPitch(state, "strike");

  assert.equal(next.plate.result, "K");
  assert.equal(next.plate.outNumber, 3);
  assert.equal(rules.shouldShowScorebookInningEndSlash(next), true);
}

{
  const state = clone(data.initialState);
  state.game.outs = 2;

  assert.equal(rules.shouldShowScorebookInningEndSlash(state, [{ source: "batter", resultLabel: "F9" }]), true);
  assert.equal(rules.shouldShowScorebookInningEndSlash(state, [{ source: "first", resultLabel: "2-6", destination: "second" }]), true);
}

{
  const runner = makeRunner("strikeout-runner", 1, []);
  runner.scoreCard.result = "K";
  runner.scoreCard.outNumber = 2;
  const runnerMarks = rules.buildRunnerScoreCellMarks(runner, null, "first");

  assert.equal(runnerMarks.some((mark) => mark.kind === "result" && mark.text === "K"), false);
  assert.equal(runnerMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "K" && mark.area === "first").length, 1);
  assert.equal(runnerMarks.filter((mark) => mark.kind === "out" && mark.text === "II").length, 1);
}

for (const outResult of ["K", "\u30a2\u30a6\u30c8", "1", "F9", "4-3"]) {
  const state = clone(data.initialState);
  state.plate.result = outResult;
  state.plate.outNumber = 1;
  const currentMarks = rules.buildCurrentScoreCellMarks(state);

  assert.equal(currentMarks.some((mark) => mark.kind === "result" && mark.text === outResult), false);
}

{
  const state = clone(data.initialState);
  state.plate.result = "\u5b89\u6253";
  const currentMarks = rules.buildCurrentScoreCellMarks(state);

  assert.equal(hasJapaneseScoreText(currentMarks), false);
}

{
  const state = clone(data.initialState);
  state.game.strikes = 2;
  state.plate.pitches = ["\u2715", "\u2715"];
  const next = rules.moveRunnerToDestination(state, "batter", "first", "dropped-third-strike");
  const runner = next.game.runners.first;
  const currentMarks = rules.buildCurrentScoreCellMarks(next);
  const runnerMarks = rules.buildRunnerScoreCellMarks(runner, null, "first");

  assert.equal(next.plate.result, "\u632f\u308a\u9003\u3052");
  assert.equal(visibleAdvanceMarks(currentMarks).length, 0);
  assert.equal(currentMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "K 2-3").length, 1);
  assert.equal(runnerMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "K 2-3").length, 1);
  assert.equal(currentMarks.some((mark) => mark.text === "\u632f\u308a\u9003\u3052" || mark.text === "K\u9003"), false);
  assert.equal(hasJapaneseScoreText(currentMarks), false);
  assert.equal(hasJapaneseScoreText(runnerMarks), false);
}

{
  const next = rules.advanceRunner(clone(data.initialState), "batter", "catcher-interference");
  const currentMarks = rules.buildCurrentScoreCellMarks(next);
  const runnerMarks = rules.buildRunnerScoreCellMarks(next.game.runners.first, null, "first");

  assert.equal(currentMarks.filter((mark) => mark.kind === "result" && mark.text === "IF").length, 1);
  assert.equal(runnerMarks.filter((mark) => mark.kind === "result" && mark.text === "IF").length, 1);
  assert.equal(hasJapaneseScoreText(currentMarks), false);
  assert.equal(hasJapaneseScoreText(runnerMarks), false);
}

{
  const state = clone(data.initialState);
  state.game.runners.first = makeRunner("obstruction-runner", 1, []);
  const next = rules.moveRunnerToDestination(state, "first", "second", "runner-interference");
  const runnerMarks = rules.buildRunnerScoreCellMarks(next.game.runners.second, null, "second");

  assert.equal(runnerMarks.filter((mark) => mark.kind === "note" && mark.text === "OB").length > 0, true);
  assert.equal(hasJapaneseScoreText(runnerMarks), false);
}

{
  const runner = makeRunner("pending-out-runner", 1, []);
  const runnerMarks = rules.buildRunnerScoreCellMarks(runner, { source: "first", resultLabel: "\u8d70\u6b7b", outNumber: 1 }, "first");

  assert.equal(runnerMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "T.O").length, 1);
  assert.equal(hasJapaneseScoreText(runnerMarks), false);
}

{
  const runner = makeRunner("left-on-base-runner", 1, []);
  const runnerMarks = rules.buildRunnerScoreCellMarks(runner, { source: "first", leftOnBase: true }, "first");

  assert.equal(runnerMarks.filter((mark) => mark.kind === "note" && mark.text === "l" && mark.area === "first").length, 1);
}

{
  const state = clone(data.initialState);
  state.game.runners.first = makeRunner("steal-runner", 1);
  const next = rules.moveRunnerToDestination(state, "first", "second", "steal");
  assert.equal(next.game.runners.first, null);
  assert.equal(next.game.runners.second?.id, "steal-runner");
  assert.deepEqual(next.game.runners.second?.scoreAdvances.at(-1), { destination: "second", reason: "steal" });
  const runnerMarks = rules.buildRunnerScoreCellMarks(next.game.runners.second, null, "second");
  assert.equal(runnerMarks.filter((mark) => mark.kind === "note" && mark.text === "S").length, 1);
  assert.equal(runnerMarks.some((mark) => mark.kind === "advance" && mark.area === "second"), false);
}

{
  const state = clone(data.initialState);
  state.game.outs = 2;
  state.game.runners.first = makeRunner("caught-steal-runner", 1);
  const next = rules.moveRunnerToDestination(state, "first", "second", "steal");
  const runnerMarks = rules.buildRunnerScoreCellMarks(
    next.game.runners.second,
    { source: "second", destination: "second", resultLabel: "2-6", outNumber: 3 },
    "second"
  );

  assert.equal(runnerMarks.filter((mark) => mark.kind === "fielderOut" && mark.text === "2-6" && mark.area === "second").length, 1);
  assert.equal(runnerMarks.filter((mark) => mark.kind === "out" && mark.text === "III").length, 1);
}

{
  const state = clone(data.initialState);
  state.game.runners.first = makeRunner("passed-ball-runner", 1);
  const next = rules.moveRunnerToDestination(state, "first", "second", "passed-ball");
  const runnerMarks = rules.buildRunnerScoreCellMarks(next.game.runners.second, null, "second");

  assert.equal(runnerMarks.some((mark) => mark.text === "PB"), false);
  assert.equal(runnerMarks.filter((mark) => mark.kind === "note" && mark.text === "P").length > 0, true);
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
  assert.equal(hasJapaneseScoreText(rules.buildCurrentScoreCellMarks(next)), false);
  assert.deepEqual(next.game.runners, { first: null, second: null, third: null });
}

console.log("scoreRules covered tests passed");
