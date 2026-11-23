/* 1% Better storage: loading and saving the group's data.
   Today this uses Claude's storage when signed in, or this browser's localStorage otherwise.
   It's the only file that changes when the app moves to Firebase. */

import { setRulesState } from "./rules.js";

/* ================= state =================
   logs/<id>/days/<date>  {date, entries:[...], picks:[id,id]|absent, locked:bool}
   members/<id>           {joinedAt, joinDay}
   votes/<id>             {cap, pass, react, cmt, nudge, roast}
   passes/<id>            {req:{date:{reason, at}}}
   paid/<id>              {got:{"block|from|to":true}}   (the receiver marks it)
   group/settings         {name, history:[{cost, mode:"flat"|"per", from, at}]}  (creator only)  */

const LS_KEY = "opb.trial.days.v1";

const blank = () => ({me:null, settings:null, members:{}, logs:{}, votes:{}, passes:{}, paid:{}, names:{}});

let mode = "loading", S = blank(), real = S;

let db = null, userCap = null, assets = null, canWrite = true, isOwner = false;

const logSubs = {};

const myLogs = () => (S.logs[S.me] ||= {});

function lsLoad(){ try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {}; } catch { return {}; } }

function lsSave(){ try { localStorage.setItem(LS_KEY, JSON.stringify(myLogs())); } catch {} }

async function guard(p, what){
  try { await p; return true; }
  catch (e) { toast(`Couldn't save ${what}. ${e && e.code === "invalid_argument" ? "You need edit access to this app." : "Check your connection."}`); return false; }
}

async function persistDay(date){
  if (mode === "demo") return;
  if (mode !== "cloud") { lsSave(); return; }
  const d = myLogs()[date];
  const ref = db.doc(`logs/${S.me}/days/${date}`);
  if (!(await guard(d && d.entries.length ? ref.set(d) : ref.delete(), "your check-off"))) lsSave();
}

const writeOwn = (coll, data, what) => mode === "cloud" ? guard(db.doc(`${coll}/${S.me}`).set(data), what) : Promise.resolve(true);

const myVotes = () => (S.votes[S.me] ||= {});

const saveVotes = () => writeOwn("votes", myVotes(), "that");

const savePasses = () => writeOwn("passes", S.passes[S.me] || {}, "your pass request");

const savePaid = () => writeOwn("paid", S.paid[S.me] || {}, "that payment");

async function initStore(){
  let settled = false;
  const fallback = why => { if (settled) return; settled = true; real.me = "local"; real.logs.local = lsLoad(); if (mode !== "demo") mode = "local"; showBanner(why); queueRender(); };
  if (!window.claude || !window.claude.use) { fallback("Saved in this browser only. Groups need you signed in to Claude."); return; }
  const timer = setTimeout(() => fallback("Saved in this browser only. Sign in to Claude to use groups."), 10000);
  try {
    [db, userCap, assets] = await Promise.all([claude.use("db"), claude.use("user"), claude.use("assets")]);
    const id = userCap ? await userCap.id() : null;
    if (!db || !id) { clearTimeout(timer); fallback("Saved in this browser only. Sign in to Claude to use groups."); return; }
    clearTimeout(timer); settled = true;
    real.me = id; if (mode !== "demo") mode = "cloud";
    isOwner = await userCap.isOwner().catch(() => false);
    canWrite = (await userCap.can("data.write").catch(() => null)) !== false;
    if (!canWrite) showBanner("You can look around, but to check off and vote, ask the group creator to invite you as an Editor."); else hideBanner();
    subscribeLogs(id);
    db.collection("members").onSnapshot(snap => { real.members = {}; snap.docs.forEach(d => real.members[d.id] = {...d.data()}); Object.keys(real.members).forEach(subscribeLogs); loadNames(); queueRender(); }, onErr);
    const own = (coll, key) => db.collection(coll).onSnapshot(snap => { real[key] = {}; snap.docs.forEach(d => real[key][d.id] = JSON.parse(JSON.stringify(d.data()))); queueRender(); }, onErr);
    own("votes","votes"); own("passes","passes"); own("paid","paid");
    db.doc("group/settings").onSnapshot(d => { real.settings = d.exists ? JSON.parse(JSON.stringify(d.data())) : null; queueRender(); }, onErr);
  } catch { clearTimeout(timer); fallback("Saved in this browser only."); }
}

function onErr(){ toast("Lost connection to the group. Reload to reconnect."); }

function subscribeLogs(id){
  if (logSubs[id] || !db) return;
  logSubs[id] = db.collection(`logs/${id}/days`).onSnapshot(snap => {
    const out = {}; snap.docs.forEach(d => { const v = d.data(); if (v && v.date && Array.isArray(v.entries)) out[v.date] = JSON.parse(JSON.stringify(v)); });
    real.logs[id] = out; queueRender();
  }, onErr);
}

async function loadNames(){
  if (!userCap || !userCap.profiles) return;
  try { const ps = await userCap.profiles(Object.keys(real.members)); for (const [k,p] of Object.entries(ps||{})) real.names[k] = (p && p.name) || ""; queueRender(); } catch {}
}

async function shrink(file, max = 1600){
  try { const bmp = await createImageBitmap(file); const s = Math.min(1, max / Math.max(bmp.width, bmp.height)); const c = document.createElement("canvas"); c.width = Math.round(bmp.width*s); c.height = Math.round(bmp.height*s); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); return await new Promise(r => c.toBlob(b => r(b || file), "image/jpeg", .82)); } catch { return file; }
}

async function uploadPhoto(file){
  if (!file) return null;
  if (mode === "demo") return {id:"demo", url: URL.createObjectURL(file)};
  if (!assets) { toast("Photos aren't available here."); return null; }
  try { const r = await assets.upload(await shrink(file)); return {id:r.id, url:r.url}; } catch { toast("The photo didn't upload."); return null; }
}

/* ================= hooks into the page =================
   app.js passes these in, so this file never touches the page itself. */
let ui = {toast(){}, showBanner(){}, hideBanner(){}, changed(){}};
function connectUI(hooks){ ui = hooks; }
const toast = msg => ui.toast(msg);
const showBanner = (...args) => ui.showBanner(...args);
const hideBanner = () => ui.hideBanner();
const queueRender = () => ui.changed();
setRulesState(S);

/* ================= example group ================= */
function enterDemo(D){ S = D; mode = "demo"; setRulesState(S); }
function exitDemo(){ S = real; mode = S.me === "local" ? "local" : S.me === "loading" ? "loading" : "cloud"; setRulesState(S); }

/* ================= group writes ================= */
const saveSettings = next => mode === "cloud" ? guard(db.doc("group/settings").set(next), "the group settings") : Promise.resolve(true);
async function saveMember(rec){
  if (mode === "cloud") { subscribeLogs(S.me); if (!(await guard(db.doc(`members/${S.me}`).set(rec), "your membership"))) delete S.members[S.me]; }
}

export { LS_KEY, blank, mode, S, real, db, userCap, assets, canWrite, isOwner, logSubs, myLogs, lsLoad, lsSave, guard, persistDay, writeOwn, myVotes, saveVotes, savePasses, savePaid, initStore, onErr, subscribeLogs, loadNames, shrink, uploadPhoto, connectUI, enterDemo, exitDemo, saveSettings, saveMember };
