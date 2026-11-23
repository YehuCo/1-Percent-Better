/* Tests for src/rules.js, following docs/SPEC.md.
   Every test runs in the two-week block of Mon Nov 16 – Sun Nov 29, 2026, with the clock faked.
   `npm test` runs them in UTC so the date math is the same on every machine. */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setRulesState, ymd, addDays, monday, blockStart, dayCloseTs, H24,
  WEEK_VEC, BLOCK_VEC, key3, pickedIds, dayLocked, openDays, capInfo, passInfo, countsIn,
  reduceVec, proratedVec, memberType, weekStatus, blockStatus, costFor, oweFor,
  clownInfo, weeksStreak, computeBlocks, isPaid,
} from "../src/rules.js";

/* ---------- helpers ---------- */

const BLOCK = new Date(2026, 10, 16);                 // Monday Nov 16, 2026 starts a two-week block
const day = n => ymd(addDays(BLOCK, n));               // block day n as "YYYY-MM-DD" (0 = Nov 16, 13 = Nov 29)
const at = (n, h = 12, m = 0) => { const d = addDays(BLOCK, n); d.setHours(h, m, 0, 0); return d; };
const now = (n, h = 12, m = 0) => vi.setSystemTime(at(n, h, m));

// An activity in each category that can be capped.
const ACT = {physical: "gym", mental: "realconvo", spiritual: "bible", social: "hangout", skill: "reading"};

let seq = 0;
function makeGroup(ids = ["me", "a", "b"], {joinDay = "2026-11-01", cost = 10, mode = "flat"} = {}){
  const S = {me: ids[0], settings: {name: "Test", history: [{cost, mode, from: "2026-01-01", at: 0}]},
    members: {}, logs: {}, votes: {}, passes: {}, paid: {}, names: {}};
  ids.forEach((id, i) => { S.members[id] = {joinedAt: i, joinDay}; S.logs[id] = {}; });
  setRulesState(S);
  return S;
}
function log(S, who, n, area, opts = {}){
  const date = day(n);
  const doc = (S.logs[who] ||= {})[date] ||= {date, entries: []};
  const e = {id: opts.id || `e${++seq}`, area, activity: opts.activity || ACT[area], summary: "did it",
    createdAt: opts.createdAt ?? at(n, 9 + doc.entries.length).getTime()};
  doc.entries.push(e);
  return e;
}
// Log a list of categories starting on block day `from`, `perDay` a day.
function logPlan(S, who, from, areas, perDay = 1){ areas.forEach((a, i) => log(S, who, from + Math.floor(i / perDay), a)); }
const callCap = (S, voter, who, n, e, when) => { ((S.votes[voter] ||= {}).cap ||= {})[key3(who, day(n), e.id)] = when.getTime(); };
const requestPass = (S, who, n, when) => { ((S.passes[who] ||= {}).req ||= {})[day(n)] = {reason: "Sick", at: when.getTime()}; };
const votePass = (S, voter, who, n, val) => { ((S.votes[voter] ||= {}).pass ||= {})[`${who}|${day(n)}`] = val; };

// The spec's weekly goal: all 5 once, 2 of them twice.
const WEEK_OK = ["physical", "physical", "mental", "mental", "spiritual", "social", "skill"];
// The spec's two-week example: double Physical and Skill/Art in week 1, Spiritual and Social in week 2.
const MIX_W1 = ["physical", "physical", "skill", "skill", "mental", "spiritual", "social"];
const MIX_W2 = ["spiritual", "spiritual", "social", "social", "physical", "skill", "mental"];

beforeEach(() => { vi.useFakeTimers({toFake: ["Date"]}); seq = 0; });
afterEach(() => vi.useRealTimers());

/* ---------- tests ---------- */

describe("weeks and blocks", () => {
  it("puts every day of Nov 16–29 in one block, and starts the next on Nov 30", () => {
    expect(ymd(blockStart(at(0)))).toBe("2026-11-16");
    expect(ymd(blockStart(at(13)))).toBe("2026-11-16");
    expect(ymd(blockStart(at(14)))).toBe("2026-11-30");
  });
  it("starts weeks on Monday", () => {
    expect(ymd(monday(at(6)))).toBe("2026-11-16");
    expect(ymd(monday(at(7)))).toBe("2026-11-23");
  });
});

describe("the daily 2", () => {
  it("counts your first 2 check-offs of the day when you don't pick", () => {
    const S = makeGroup();
    const e1 = log(S, "me", 0, "physical", {createdAt: at(0, 10).getTime()});
    const e2 = log(S, "me", 0, "mental", {createdAt: at(0, 9).getTime()});
    log(S, "me", 0, "social", {createdAt: at(0, 11).getTime()});
    expect(pickedIds("me", day(0))).toEqual([e2.id, e1.id]);
  });
  it("counts the 2 you picked, ignoring picks of deleted check-offs", () => {
    const S = makeGroup();
    const e1 = log(S, "me", 0, "physical"); log(S, "me", 0, "mental"); const e3 = log(S, "me", 0, "social");
    S.logs.me[day(0)].picks = [e3.id, e1.id];
    expect(pickedIds("me", day(0))).toEqual([e3.id, e1.id]);
    S.logs.me[day(0)].picks = ["deleted", e3.id];
    expect(pickedIds("me", day(0))).toEqual([e3.id]);
  });
  it("only counts 2 a day toward goals, even in the same category", () => {
    const S = makeGroup();
    logPlan(S, "me", 0, ["physical", "physical", "physical"], 3);
    const k = countsIn("me", BLOCK, 7);
    expect(k.c.physical).toBe(2);
    expect(k.total).toBe(2);
    expect(k.days).toBe(1);
  });
});

describe("logging window", () => {
  it("keeps a day open for 24 hours after it ends", () => {
    const S = makeGroup();
    log(S, "me", 0, "physical");
    now(1, 23, 59); expect(dayLocked("me", day(0))).toBe(false);
    now(2, 0, 0);   expect(dayLocked("me", day(0))).toBe(true);
  });
  it("locks Sunday when the week closes, not 24 hours later", () => {
    makeGroup();
    expect(dayCloseTs(day(6))).toBe(at(7, 0).getTime());
    now(6, 23, 59); expect(dayLocked("me", day(6))).toBe(false);
    now(7, 0, 0);   expect(dayLocked("me", day(6))).toBe(true);
  });
  it("respects days that were locked by hand in the old trial", () => {
    const S = makeGroup();
    log(S, "me", 0, "physical");
    S.logs.me[day(0)].locked = true;
    now(0, 13); expect(dayLocked("me", day(0))).toBe(true);
  });
  it("offers today and yesterday, but not last week's Sunday on Monday", () => {
    makeGroup();
    now(3, 12); expect(openDays()).toEqual([day(3), day(2)]);
    now(7, 12); expect(openDays()).toEqual([day(7)]);
  });
});

describe("weekly goal", () => {
  it("is met by all 5 once and 2 of them twice", () => {
    const S = makeGroup();
    logPlan(S, "me", 0, WEEK_OK);
    now(6, 20);
    const w = weekStatus("me", BLOCK);
    expect(w.met).toBe(true);
    expect(w.total).toBe(7);
    expect(w.goalTotal).toBe(7);
    expect(w.missed).toBe(false);
  });
  it("isn't met by 7 check-offs that skip a category", () => {
    const S = makeGroup();
    logPlan(S, "me", 0, ["physical", "physical", "physical", "mental", "mental", "spiritual", "social"]);
    now(6, 20);
    const w = weekStatus("me", BLOCK);
    expect(w.met).toBe(false);
    expect(w.missing.map(m => m.a.id)).toEqual(["skill"]);
  });
  it("only counts as missed once the week closes Sunday night", () => {
    makeGroup();
    now(6, 23, 59); expect(weekStatus("me", BLOCK).missed).toBe(false);
    now(7, 0, 0);   expect(weekStatus("me", BLOCK).missed).toBe(true);
  });
  it("ignores check-offs beyond the daily 2", () => {
    const S = makeGroup();
    logPlan(S, "me", 0, WEEK_OK, 3);      // 3 on Monday, 3 on Tuesday, 1 on Wednesday
    now(6, 20);
    const w = weekStatus("me", BLOCK);
    expect(w.total).toBe(5);
    expect(w.met).toBe(false);
  });
});

describe("two-week goal", () => {
  it("is met by the spec's example: different doubles each week", () => {
    const S = makeGroup();
    logPlan(S, "me", 0, MIX_W1); logPlan(S, "me", 7, MIX_W2);
    now(13, 20);
    const b = blockStatus("me", BLOCK);
    expect(b.c).toEqual({physical: 3, mental: 2, spiritual: 3, social: 3, skill: 3});
    expect(b.met).toBe(true);
    expect(weekStatus("me", BLOCK).met).toBe(true);
    expect(weekStatus("me", addDays(BLOCK, 7)).met).toBe(true);
  });
  it("isn't met by the same doubles both weeks (4, 4, 2, 2, 2), even though both weeks are", () => {
    const S = makeGroup();
    logPlan(S, "me", 0, MIX_W1); logPlan(S, "me", 7, MIX_W1);
    now(14, 12);
    expect(weekStatus("me", BLOCK).met).toBe(true);
    expect(weekStatus("me", addDays(BLOCK, 7)).met).toBe(true);
    const b = blockStatus("me", BLOCK);
    expect(b.met).toBe(false);
    expect(b.missed).toBe(true);
    expect(b.missedCats).toBe(2);
  });
});

describe("passes", () => {
  it("is voted on for 24 hours", () => {
    const S = makeGroup();
    requestPass(S, "me", 2, at(2, 8));
    now(3, 7, 59); expect(passInfo("me", day(2)).status).toBe("pending");
    now(3, 8, 0);  expect(passInfo("me", day(2)).status).toBe("denied");
  });
  it("is granted when more vote yes than no", () => {
    const S = makeGroup(["me", "a", "b", "c"]);
    requestPass(S, "me", 2, at(2, 8));
    votePass(S, "a", "me", 2, "yes"); votePass(S, "b", "me", 2, "yes"); votePass(S, "c", "me", 2, "no");
    now(3, 9); expect(passInfo("me", day(2)).status).toBe("granted");
  });
  it("is denied on a tie, and only votes cast count", () => {
    const S = makeGroup(["me", "a", "b", "c"]);
    requestPass(S, "me", 2, at(2, 8));
    votePass(S, "a", "me", 2, "yes"); votePass(S, "b", "me", 2, "no");
    now(3, 9); expect(passInfo("me", day(2)).status).toBe("denied");
    S.votes.b = {};   // b never voted: 1 yes, 0 no
    expect(passInfo("me", day(2)).status).toBe("granted");
  });
  it("doesn't let you vote on your own pass", () => {
    const S = makeGroup();
    requestPass(S, "me", 2, at(2, 8));
    votePass(S, "me", "me", 2, "yes");
    now(3, 9); expect(passInfo("me", day(2)).status).toBe("denied");
  });
  it("takes repeat check-offs off first, then a category", () => {
    expect(reduceVec(WEEK_VEC, 1)).toEqual([2, 1, 1, 1, 1]);
    expect(reduceVec(WEEK_VEC, 2)).toEqual([1, 1, 1, 1, 1]);
    expect(reduceVec(WEEK_VEC, 3)).toEqual([1, 1, 1, 1, 0]);
    expect(reduceVec(BLOCK_VEC, 1)).toEqual([3, 3, 3, 2, 2]);
  });
  it("lowers the weekly goal by 1 check-off once granted", () => {
    const S = makeGroup();
    requestPass(S, "me", 2, at(2, 8));
    votePass(S, "a", "me", 2, "yes");
    [0, 1, 3, 4, 5, 6].forEach((n, i) => log(S, "me", n, ["physical", "physical", "mental", "spiritual", "social", "skill"][i]));
    now(6, 20);
    const w = weekStatus("me", BLOCK);
    expect(w.goalTotal).toBe(6);
    expect(w.met).toBe(true);
  });
  it("holds off a missed week while the vote is still open", () => {
    const S = makeGroup();
    requestPass(S, "me", 6, at(6, 20));
    now(7, 1);  expect(weekStatus("me", BLOCK).missed).toBe(false);
    now(7, 21); expect(weekStatus("me", BLOCK).missed).toBe(true);
  });
});

describe("joining late", () => {
  it("prorates the block to one check-off per day left, as in the spec's table", () => {
    const table = [
      [0, null],
      [1, [1, 0, 0, 0, 0]], [4, [1, 1, 1, 1, 0]],
      [5, [1, 1, 1, 1, 1]], [6, [2, 1, 1, 1, 1]], [7, [2, 2, 1, 1, 1]], [9, [2, 2, 2, 2, 1]],
      [10, [2, 2, 2, 2, 2]], [11, [3, 2, 2, 2, 2]], [12, [3, 3, 2, 2, 2]], [13, [3, 3, 3, 2, 2]],
    ];
    for (const [left, vec] of table) expect(proratedVec(left), `${left} days left`).toEqual(vec);
  });
  it("is a full member before the block, prorated during it, and out on its last day", () => {
    const S = makeGroup();
    S.members.me.joinDay = day(-1); expect(memberType("me", BLOCK)).toBe("full");
    S.members.me.joinDay = day(6);  expect(memberType("me", BLOCK)).toBe("pro");
    S.members.me.joinDay = day(13); expect(memberType("me", BLOCK)).toBe("none");
  });
  it("starts counting the day after joining", () => {
    const S = makeGroup();
    S.members.me.joinDay = day(6);   // 7 days left: all 5 once, any 2 twice
    log(S, "me", 6, "physical");     // the join day itself doesn't count
    logPlan(S, "me", 7, WEEK_OK);
    now(13, 20);
    const b = blockStatus("me", BLOCK);
    expect(b.type).toBe("pro");
    expect(b.goalTotal).toBe(7);
    expect(b.total).toBe(7);
    expect(b.met).toBe(true);
    expect(weekStatus("me", BLOCK).req).toBe(null);   // no separate weekly goal
  });
});

describe("cap", () => {
  it("needs 2 calls, then gives 24 hours to add proof", () => {
    const S = makeGroup();
    const e = log(S, "me", 0, "physical");
    callCap(S, "a", "me", 0, e, at(0, 10));
    now(0, 12); expect(capInfo("me", day(0), e)).toMatchObject({capped: false, n: 1, need: 2});
    callCap(S, "b", "me", 0, e, at(0, 11));
    const ci = capInfo("me", day(0), e);
    expect(ci.status).toBe("needproof");
    expect(ci.deadline).toBe(at(0, 11).getTime() + H24);
  });
  it("doesn't count a capped check-off until there's proof", () => {
    const S = makeGroup();
    const e = log(S, "me", 0, "physical");
    callCap(S, "a", "me", 0, e, at(0, 10)); callCap(S, "b", "me", 0, e, at(0, 11));
    now(0, 12); expect(countsIn("me", BLOCK, 7).c.physical).toBe(0);
    now(1, 12); expect(capInfo("me", day(0), e).status).toBe("expired");
    expect(countsIn("me", BLOCK, 7).c.physical).toBe(0);
    e.proof = {photo: {id: "p"}, note: "", at: at(1, 12).getTime()};
    expect(capInfo("me", day(0), e).status).toBe("proven");
    expect(countsIn("me", BLOCK, 7).c.physical).toBe(1);
  });
  it("needs only 1 call in a group of 2", () => {
    const S = makeGroup(["me", "a"]);
    const e = log(S, "me", 0, "physical");
    callCap(S, "a", "me", 0, e, at(0, 10));
    now(0, 12); expect(capInfo("me", day(0), e)).toMatchObject({need: 1, status: "needproof"});
  });
  it("can't be called on prayer, sitting in silence or self-reflection", () => {
    const S = makeGroup();
    for (const [area, activity] of [["spiritual", "prayer"], ["mental", "silence"], ["mental", "mreflect"], ["spiritual", "reflect"]]) {
      const e = log(S, "me", 0, area, {activity});
      callCap(S, "a", "me", 0, e, at(0, 10)); callCap(S, "b", "me", 0, e, at(0, 11));
      now(0, 12);
      expect(capInfo("me", day(0), e), activity).toMatchObject({cappable: false, capped: false, status: "ok"});
    }
  });
  it("stays open until the week closes, or 24 hours after logging if that's later", () => {
    const S = makeGroup();
    const e = log(S, "me", 6, "physical", {createdAt: at(6, 23).getTime()});
    now(7, 12);     expect(capInfo("me", day(6), e).windowOpen).toBe(true);
    now(7, 23, 30); expect(capInfo("me", day(6), e).windowOpen).toBe(false);
  });
});

describe("pay-ups", () => {
  const blockOf = M => M.blocks.find(b => ymd(b.bs) === day(0));
  const sum = (ts, from) => ts.filter(t => t.from === from).reduce((s, t) => s + t.amount, 0);

  it("splits a flat miss evenly among those who hit their goals", () => {
    const S = makeGroup(["me", "a", "b"], {cost: 10});
    for (const id of ["me", "a"]) { logPlan(S, id, 0, MIX_W1); logPlan(S, id, 7, MIX_W2); }
    now(16, 12);
    const blk = blockOf(computeBlocks());
    expect(blk.ready).toBe(true);
    expect(blk.transfers.map(t => [t.from, t.to, t.amount])).toEqual([["b", "me", 5], ["b", "a", 5]]);
  });
  it("charges per category missed when the group chose that", () => {
    const S = makeGroup(["me", "a", "b"], {cost: 20, mode: "per"});
    for (const id of ["me", "a"]) { logPlan(S, id, 0, MIX_W1); logPlan(S, id, 7, MIX_W2); }
    logPlan(S, "b", 0, MIX_W1); logPlan(S, "b", 7, MIX_W2.slice(0, 6));   // 1 short in Mental
    now(16, 12);
    const blk = blockOf(computeBlocks());
    expect(blockStatus("b", BLOCK).missedCats).toBe(1);
    expect(oweFor(costFor(BLOCK), 1)).toBe(20);
    expect(sum(blk.transfers, "b")).toBe(20);
  });
  it("moves no money when everyone hit, or when everyone missed", () => {
    let S = makeGroup(["me", "a"]);
    for (const id of ["me", "a"]) { logPlan(S, id, 0, MIX_W1); logPlan(S, id, 7, MIX_W2); }
    now(16, 12);
    expect(blockOf(computeBlocks()).transfers).toEqual([]);
    S = makeGroup(["me", "a"]);
    const blk = blockOf(computeBlocks());
    expect(blk.everyoneMissed).toBe(true);
    expect(blk.transfers).toEqual([]);
  });
  it("waits until the last day's 24-hour window has passed", () => {
    makeGroup(["me", "a", "b"]);
    now(14, 23, 59); expect(blockOf(computeBlocks()).ready).toBe(false);
    now(15, 0, 0);   expect(blockOf(computeBlocks()).ready).toBe(true);
  });
  it("waits for open Cap proof windows and pass votes", () => {
    const S = makeGroup(["me", "a", "b"]);
    for (const id of ["me", "a"]) { logPlan(S, id, 0, MIX_W1); logPlan(S, id, 7, MIX_W2); }
    const e = S.logs.a[day(13)].entries[0];
    callCap(S, "me", "a", 13, e, at(15, 22)); callCap(S, "b", "a", 13, e, at(15, 23));
    now(16, 12);
    const blk = blockOf(computeBlocks());
    expect(blk.openCaps).toBe(1);
    expect(blk.ready).toBe(false);
    expect(blk.transfers).toEqual([]);
  });
  it("lets late joiners pay in their first block, but not collect", () => {
    const S = makeGroup(["me", "a", "b", "c"]);
    S.members.c.joinDay = day(6);
    for (const id of ["me", "a"]) { logPlan(S, id, 0, MIX_W1); logPlan(S, id, 7, MIX_W2); }
    logPlan(S, "c", 7, WEEK_OK);   // c hits the prorated goal
    now(16, 12);
    let blk = blockOf(computeBlocks());
    expect(blk.transfers.some(t => t.to === "c")).toBe(false);
    expect(blk.transfers.filter(t => t.from === "b").map(t => t.to)).toEqual(["me", "a"]);
    S.logs.c = {};                 // now c misses too
    blk = blockOf(computeBlocks());
    expect(blk.transfers.filter(t => t.from === "c").map(t => t.to)).toEqual(["me", "a"]);
  });
  it("applies a stakes change from the next block", () => {
    const S = makeGroup();
    S.settings.history.push({cost: 30, mode: "per", from: day(14), at: at(3).getTime()});
    expect(costFor(BLOCK)).toMatchObject({cost: 10, mode: "flat"});
    expect(costFor(addDays(BLOCK, 14))).toMatchObject({cost: 30, mode: "per"});
  });
  it("is marked paid by the person receiving it", () => {
    const S = makeGroup(["me", "a", "b"]);
    for (const id of ["me", "a"]) { logPlan(S, id, 0, MIX_W1); logPlan(S, id, 7, MIX_W2); }
    now(16, 12);
    const t = blockOf(computeBlocks()).transfers[0];
    expect(isPaid(t)).toBe(false);
    S.paid[t.to] = {got: {[t.key]: true}};
    expect(isPaid(t)).toBe(true);
  });
});

describe("clowning and streaks", () => {
  it("clowns you after a missed week, until you hit the next week's goal", () => {
    const S = makeGroup();
    now(8, 12);
    expect(clownInfo("me").reasons.map(r => r.kind)).toContain("week");
    logPlan(S, "me", 7, WEEK_OK);
    now(13, 20);
    expect(clownInfo("me")).toBe(null);
  });
  it("counts weeks hit in a row", () => {
    const S = makeGroup();
    logPlan(S, "me", 0, WEEK_OK);
    now(8, 12);  expect(weeksStreak("me")).toBe(1);
    logPlan(S, "me", 7, WEEK_OK);
    now(15, 12); expect(weeksStreak("me")).toBe(2);
  });
});
