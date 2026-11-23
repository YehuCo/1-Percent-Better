/* 1% Better rules: categories, dates, goals, the daily 2, Cap, passes, prorating and pay-ups.
   No page or storage code here, so the app, the tests and (later) the server can all share it.
   The rules read the current group's data through setRulesState(). */

let S = null;
export function setRulesState(state){ S = state; }

/* ================= categories ================= */

const AREAS = [
  {id:"physical", name:"Physical", blurb:"Gym, sports, eating better, sleeping well", detail:"How long? (minutes)", num:true, acts:[
    {id:"gym", label:"Gym"}, {id:"sports", label:"Sports"}, {id:"eat", label:"Ate better"}, {id:"sleep", label:"Slept well"}]},
  {id:"mental", name:"Mental", blurb:"Silence and self-reflection, real conversation", detail:"How long? (minutes)", num:true, priv:true, acts:[
    {id:"silence", label:"Sat in silence", nocap:true}, {id:"mreflect", label:"Self-reflection", nocap:true}, {id:"realconvo", label:"Real conversation"}]},
  {id:"spiritual", name:"Spiritual", blurb:"Self-reflection, Bible, prayer, making space for the Creator", detail:"What passage or theme?", priv:true, acts:[
    {id:"reflect", label:"Self-reflection", nocap:true}, {id:"bible", label:"Bible"}, {id:"prayer", label:"Prayer", nocap:true}, {id:"space", label:"Made space for the Creator"}]},
  {id:"social", name:"Social", blurb:"Intentional hangout, meaningful conversation with someone new", detail:"Who with?", acts:[
    {id:"hangout", label:"Intentional hangout"}, {id:"newperson", label:"Conversation with someone new"}]},
  {id:"skill", name:"Skill/Art", blurb:"Reading, creating, building, instrument, writing, painting, photography", detail:"What are you working on?", acts:[
    {id:"reading", label:"Reading"}, {id:"creative", label:"Creative expression"}, {id:"buildskill", label:"Building a skill"}, {id:"project", label:"Building a project"},
    {id:"instrument", label:"Instrument"}, {id:"writing", label:"Writing"}, {id:"painting", label:"Painting"}, {id:"photo", label:"Photography"}]},
];

AREAS.forEach(a => a.acts.push({id:"other", label:"Write my own"}));

const AREA = Object.fromEntries(AREAS.map(a => [a.id, a]));

const actOf = (areaId, actId) => AREA[areaId].acts.find(x => x.id === actId) || AREA[areaId].acts.at(-1);

const labelOf = e => e.activity === "other" && e.other ? e.other : actOf(e.area, e.activity).label;

const MIN_WORDS = 4, MAX_GROUP = 6, DAILY = 2;

const WEEK_VEC = [2,2,1,1,1], BLOCK_VEC = [3,3,3,3,2];

/* ================= dates ================= */

const pad = n => String(n).padStart(2,"0");

const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

const parse = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };

const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay()+6)%7)); };

const ANCHOR = new Date(2024,0,1);

const blockStart = d => { const m = monday(d); const wks = Math.round((m - ANCHOR)/(7*864e5)); return addDays(m, -((wks%2+2)%2)*7); };

const todayStr = () => ymd(new Date());

const daysBetween = (a, b) => Math.round((parse(b) - parse(a))/864e5);

const fmtLong = s => parse(s).toLocaleDateString(undefined,{weekday:"long", month:"long", day:"numeric"});

const fmtShort = d => (typeof d === "string" ? parse(d) : d).toLocaleDateString(undefined,{month:"short", day:"numeric"});

const fmtDow = s => parse(s).toLocaleDateString(undefined,{weekday:"short", month:"short", day:"numeric"});

const fmtWhen = ts => { const d = new Date(ts); return d.toLocaleDateString(undefined,{weekday:"short"}) + " " + d.toLocaleTimeString(undefined,{hour:"numeric", minute:"2-digit"}); };

const H24 = 24*3600e3;

const weekCloseTs = date => addDays(monday(parse(date)), 7).getTime();

// You have 24 hours after a day ends to log it and pick its 2, but never past the week closing Sunday night.

const dayCloseTs = date => Math.min(addDays(parse(date), 2).getTime(), weekCloseTs(date));

const words = s => (s.trim().match(/\S+/g) || []).length;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

const money = n => "$" + (Math.round(n*100)/100).toLocaleString(undefined,{minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits:2});

const listAnd = a => a.length <= 1 ? (a[0]||"") : a.slice(0,-1).join(", ") + " and " + a.at(-1);

const dayDoc = (who, date) => (S.logs[who] && S.logs[who][date]) || null;

const entriesOf = (who, date) => dayDoc(who, date)?.entries || [];

const memberIds = () => Object.keys(S.members).sort((a,b) => (S.members[a].joinedAt||0) - (S.members[b].joinedAt||0));

const isMember = id => !!S.members[id];

const others = who => memberIds().filter(v => v !== who);

/* ================= rules ================= */

const key3 = (who, date, id) => `${who}|${date}|${id}`;

// The 2 that count for a day: the ones you picked, or your first 2.

function pickedIds(who, date){
  const d = dayDoc(who, date); if (!d) return [];
  if (Array.isArray(d.picks)) return d.picks.filter(id => d.entries.some(e => e.id === id)).slice(0, DAILY);
  return [...d.entries].sort((a,b) => (a.createdAt||0) - (b.createdAt||0)).slice(0, DAILY).map(e => e.id);
}

const dayLocked = (who, date) => !!dayDoc(who, date)?.locked || Date.now() >= dayCloseTs(date);

const openDays = () => { const t = todayStr(), y = ymd(addDays(new Date(), -1)); return [t, y].filter(k => !dayLocked(S.me, k)); };

/* Cap: two calls (one in a group of 2) and you have 24h to post proof, or it doesn't count.
   Prayer, sitting in silence and self-reflection can't be capped. Caps can be called until the
   entry's week closes, or 24h after it was logged if that's later. */

function capInfo(who, date, e){
  const k = key3(who, date, e.id); const el = others(who); const now = Date.now();
  const cappable = !actOf(e.area, e.activity).nocap;
  const need = Math.min(2, el.length);
  const times = el.map(v => S.votes[v]?.cap?.[k]).filter(Boolean).sort((a,b) => a-b);
  const capped = cappable && need > 0 && times.length >= need;
  const cappedAt = capped ? times[need-1] : null;
  const capCloses = Math.max(weekCloseTs(date), (e.createdAt||0) + H24);
  let status = "ok", deadline = null;
  if (capped) { if (e.proof) status = "proven"; else { deadline = cappedAt + H24; status = now < deadline ? "needproof" : "expired"; } }
  return {key:k, n: times.length, need, cappable, capped, status, deadline, windowOpen: cappable && now < capCloses && !capped,
    disputed: status === "needproof" || status === "expired", open: status === "needproof", mine: !!S.votes[S.me]?.cap?.[k]};
}

/* Passes: request before the week closes; everyone else has 24h; only votes cast count; tie = no. */

function passInfo(who, date){
  const req = S.passes[who]?.req?.[date]; if (!req) return null;
  const k = `${who}|${date}`; let yes = 0, no = 0;
  others(who).forEach(v => { const x = S.votes[v]?.pass?.[k]; if (x === "yes") yes++; if (x === "no") no++; });
  const closes = (req.at||0) + H24; const pending = Date.now() < closes;
  return {req, key:k, yes, no, closes, status: pending ? "pending" : yes > no ? "granted" : "denied", mine: S.votes[S.me]?.pass?.[k]};
}

function passesIn(who, start, n){
  let granted = 0, pending = 0;
  for (let i = 0; i < n; i++) { const p = passInfo(who, ymd(addDays(start, i))); if (p?.status === "granted") granted++; if (p?.status === "pending") pending++; }
  return {granted, pending};
}

// Counted check-offs per category: only each day's 2, minus capped entries without proof.

function countsIn(who, start, n){
  const c = Object.fromEntries(AREAS.map(a => [a.id, 0])); let total = 0, days = 0;
  for (let i = 0; i < n; i++) {
    const k = ymd(addDays(start, i)); const ids = pickedIds(who, k); let any = false;
    entriesOf(who, k).forEach(e => { if (!ids.includes(e.id)) return; if (isMember(who) && capInfo(who, k, e).disputed) return; c[e.area]++; total++; any = true; });
    if (any) days++;
  }
  return {c, total, days};
}

// A goal is "any" counts, so it's a sorted list of targets: weekly [2,2,1,1,1], block [3,3,3,3,2].

// A pass drops 1 check-off: repeats come off first, then any one category.

function reduceVec(v, k){
  v = [...v].sort((a,b) => b-a);
  for (let i = 0; i < k; i++) {
    const pos = v.filter(x => x > 0); if (!pos.length) break;
    const m = Math.min(...pos); let j = -1;
    for (let x = v.length-1; x >= 0; x--) if (v[x] > m) { j = x; break; }
    if (j < 0) for (let x = v.length-1; x >= 0; x--) if (v[x] > 0) { j = x; break; }
    v[j]--; v.sort((a,b) => b-a);
  }
  return v;
}

// Late joiners: one check-off per day left in the block, starting the day after they join.

function proratedVec(d){
  if (d <= 0) return null;
  if (d < 5) return [1,1,1,1,1].map((x,i) => i < d ? 1 : 0);
  if (d <= 10) return [1,1,1,1,1].map((x,i) => i < d-5 ? 2 : 1);
  return [2,2,2,2,2].map((x,i) => i < d-10 ? 3 : 2);
}

// Pair targets with categories, biggest count first, so the app can say what's left.

function assign(c, vec){
  const order = [...AREAS].sort((a,b) => c[b.id] - c[a.id] || AREAS.indexOf(a) - AREAS.indexOf(b));
  const v = [...vec].sort((a,b) => b-a); const t = {};
  order.forEach((a,i) => t[a.id] = v[i] || 0);
  const missing = order.filter(a => c[a.id] < t[a.id]).map(a => ({a, short: t[a.id] - c[a.id]}));
  return {targets: t, missing, met: missing.length === 0};
}

function memberType(who, bs){
  const m = S.members[who]; if (!m || !m.joinDay) return "full";
  const be = ymd(addDays(bs, 13)); const b0 = ymd(bs);
  if (m.joinDay < b0) return "full";
  if (m.joinDay >= be) return "none";
  return "pro";
}

function weekStatus(who, ws){
  const bs = blockStart(ws); const type = memberType(who, bs);
  if (type !== "full") return {type, req:null};
  const p = passesIn(who, ws, 7); const req = reduceVec(WEEK_VEC, p.granted);
  const k = countsIn(who, ws, 7); const a = assign(k.c, req);
  const closed = Date.now() >= addDays(ws, 7).getTime();
  return {type, req, ...k, ...a, passes:p, closed, goalTotal: req.reduce((s,x) => s+x, 0), missed: closed && !a.met && !p.pending};
}

function blockStatus(who, bs){
  const type = memberType(who, bs); if (type === "none") return {type, req:null};
  const p = passesIn(who, bs, 14);
  let req, from = bs, n = 14;
  if (type === "pro") { const jd = S.members[who].joinDay; const left = daysBetween(jd, ymd(addDays(bs, 13))); req = proratedVec(left); from = addDays(parse(jd), 1); n = left; }
  else req = BLOCK_VEC;
  if (!req) return {type:"none", req:null};
  req = reduceVec(req, p.granted);
  const k = countsIn(who, from, n); const a = assign(k.c, req);
  const closed = Date.now() >= addDays(bs, 14).getTime();
  const missedCats = AREAS.filter(x => k.c[x.id] < a.targets[x.id]).length;
  return {type, req, ...k, ...a, passes:p, closed, missedCats, goalTotal: req.reduce((s,x) => s+x, 0), missed: closed && !a.met};
}

function costFor(bs){
  const h = (S.settings?.history || []).filter(x => x.from <= ymd(bs)).sort((a,b) => a.from.localeCompare(b.from) || a.at - b.at).at(-1);
  return h || {cost:0, mode:"flat"};
}

const costText = c => c.cost ? (c.mode === "per" ? `${money(c.cost)} per category missed` : `${money(c.cost)} flat`) : "Clowning only, no money";

const oweFor = (c, missedCats) => c.mode === "per" ? c.cost * missedCats : c.cost;

// Clowned: missed the last closed week (or last block) and haven't hit this week's goal yet.

function clownInfo(who){
  if (!isMember(who)) return null;
  const lastW = addDays(monday(new Date()), -7);
  const jd = S.members[who].joinDay || "0";
  const reasons = [];
  if (jd < ymd(lastW)) { const w = weekStatus(who, lastW); if (w.req && w.missed) reasons.push({kind:"week", key: ymd(lastW), text:`missed the week of ${fmtShort(lastW)}`}); }
  const lastB = addDays(blockStart(new Date()), -14);
  if (jd < ymd(addDays(lastB, 13))) { const b = blockStatus(who, lastB); if (b.req && b.missed && (b.type === "pro" || allMissed(lastB))) reasons.push({kind:"block", key: ymd(lastB), text:`missed the block ending ${fmtShort(addDays(lastB,13))}`}); }
  if (!reasons.length) return null;
  const cur = weekStatus(who, monday(new Date())); const curB = blockStatus(who, blockStart(new Date()));
  const redeemed = cur.req ? cur.met : curB.req ? curB.met : false;
  return redeemed ? null : {reasons, key: reasons[0].key};
}

function allMissed(bs){ const ps = memberIds().filter(id => memberType(id, bs) !== "none"); return ps.length > 0 && ps.every(id => blockStatus(id, bs).missed); }

function weeksStreak(who){
  let n = 0; let w = addDays(monday(new Date()), -7);
  for (let i = 0; i < 60; i++) { const st = weekStatus(who, w); if (!st.req) { w = addDays(w, -7); continue; } if (!st.met) break; n++; w = addDays(w, -7); }
  return n;
}

/* ================= pay-ups =================
   Every 2 weeks, only if someone missed. Missers split their payment evenly among those who hit.
   Everyone missed: no money moves. Late joiners can't collect until their first full block.
   A block settles once its last cap/proof and pass votes are done.                           */

function firstBlock(){ const js = memberIds().map(id => S.members[id].joinDay).filter(Boolean).sort(); return js[0] ? blockStart(parse(js[0])) : null; }

function computeBlocks(){
  const out = {blocks:[], transfers:[], current:null};
  const fb = firstBlock(); if (!fb) return out;
  const now = Date.now(); const today = parse(todayStr());
  for (let bs = new Date(fb); ; bs = addDays(bs, 14)) {
    const be = addDays(bs, 13);
    const parts = memberIds().filter(id => memberType(id, bs) !== "none");
    if (be >= today) { out.current = {bs, be, parts}; break; }
    if (!parts.length) continue;
    const res = parts.map(id => ({id, st: blockStatus(id, bs)}));
    const openCaps = parts.reduce((n, id) => n + Array.from({length:14}, (_, i) => ymd(addDays(bs, i))).reduce((m, k) => m + entriesOf(id, k).filter(e => capInfo(id, k, e).open).length, 0), 0);
    const pendingPasses = parts.reduce((n, id) => n + passesIn(id, bs, 14).pending, 0);
    const ready = now >= addDays(be, 1).getTime() + H24 && !openCaps && !pendingPasses;
    const c = costFor(bs);
    const missers = res.filter(r => r.st.missed), hitters = res.filter(r => !r.st.missed && r.st.type === "full");
    const blk = {bs, be, res, cost:c, missers, hitters, ready, openCaps, pendingPasses, everyoneMissed: missers.length === res.length, transfers:[]};
    if (ready && missers.length && hitters.length && c.cost) {
      missers.forEach(m => { const amt = oweFor(c, m.st.missedCats); hitters.forEach(h => blk.transfers.push({bk: ymd(bs), from:m.id, to:h.id, amount: amt/hitters.length, key:`${ymd(bs)}|${m.id}|${h.id}`})); });
      out.transfers.push(...blk.transfers);
    }
    out.blocks.push(blk);
  }
  return out;
}

const isPaid = t => !!S.paid[t.to]?.got?.[t.key];

export { AREAS, AREA, actOf, labelOf, MIN_WORDS, MAX_GROUP, DAILY, WEEK_VEC, BLOCK_VEC, pad, ymd, parse, addDays, monday, ANCHOR, blockStart, todayStr, daysBetween, fmtLong, fmtShort, fmtDow, fmtWhen, H24, weekCloseTs, dayCloseTs, words, uid, money, listAnd, dayDoc, entriesOf, memberIds, isMember, others, key3, pickedIds, dayLocked, openDays, capInfo, passInfo, passesIn, countsIn, reduceVec, proratedVec, assign, memberType, weekStatus, blockStatus, costFor, costText, oweFor, clownInfo, allMissed, weeksStreak, firstBlock, computeBlocks, isPaid };
