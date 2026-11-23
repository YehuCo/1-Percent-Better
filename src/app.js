/* 1% Better app: screens, sheets, the example group and startup. */

import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/figtree/index.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";
import { AREAS, AREA, actOf, labelOf, MIN_WORDS, MAX_GROUP, DAILY, ymd, parse, addDays, monday, blockStart, todayStr, daysBetween, fmtLong, fmtShort, fmtDow, fmtWhen, dayCloseTs, words, uid, money, listAnd, entriesOf, memberIds, isMember, others, key3, pickedIds, dayLocked, openDays, capInfo, passInfo, countsIn, weekStatus, blockStatus, costFor, costText, oweFor, clownInfo, weeksStreak, computeBlocks, isPaid } from "./rules.js";
import { blank, mode, S, canWrite, isOwner, myLogs, persistDay, myVotes, saveVotes, savePasses, savePaid, initStore, uploadPhoto, connectUI, enterDemo, exitDemo, saveSettings, saveMember } from "./store.js";

/* ================= helpers ================= */

const $ = id => document.getElementById(id);

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let toastT;

function toast(msg){ const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2400); }

const nameOf = id => id === S.me ? "You" : (S.names[id] || "Group member");

let renderQueued = false;

function queueRender(){ if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderAll(); }); }

function showBanner(text, actionLabel, action){
  const b = $("banner"); b.hidden = false;
  b.innerHTML = `<span>${esc(text)}</span>` + (actionLabel ? `<button type="button" id="bannerBtn">${esc(actionLabel)}</button>` : "");
  if (actionLabel) $("bannerBtn").onclick = action;
}

function hideBanner(){ $("banner").hidden = true; }

function startDemo(){ enterDemo(makeDemo()); showBanner("You're looking at an example group. Nothing here is saved.", "Exit example", stopDemo); renderAll(); toast("Example group loaded"); }

function stopDemo(){ exitDemo(); if (mode === "local") showBanner("Saved in this browser only. Groups need you signed in to Claude."); else if (canWrite) hideBanner(); renderAll(); }

// Other members' pass requests that are still open and that you haven't voted on.

function pendingVotes(){
  if (mode === "local" || mode === "loading" || !isMember(S.me) || !canWrite) return [];
  return others(S.me).flatMap(id => Object.keys(S.passes[id]?.req || {}).map(d => ({id, d, i: passInfo(id, d)})))
    .filter(r => r.i && r.i.status === "pending" && !r.i.mine).sort((a,b) => a.i.closes - b.i.closes);
}

// Your own check-offs that were capped and still need proof before the 24 hours run out.

function proofDue(){
  if (mode === "local" || mode === "loading" || !isMember(S.me)) return [];
  const out = [];
  for (let i = 0; i < 21; i++) { const d = ymd(addDays(new Date(), -i)); entriesOf(S.me, d).forEach(e => { const ci = capInfo(S.me, d, e); if (ci.status === "needproof") out.push({d, e, ci}); }); }
  return out.sort((a,b) => a.ci.deadline - b.ci.deadline);
}

/* ================= views ================= */

const VIEWS = ["today","calendar","group","pot","wrapped"];

let view = "today";

function setView(v){
  view = v;
  VIEWS.forEach(x => { $("view-"+x).hidden = x !== v; $("tab-"+x).setAttribute("aria-selected", String(x === v)); });
  if (v !== "wrapped") stopStoryAnim();
  if (v !== "pot") stopJar();
  try { localStorage.setItem("opb.trial.view", v); } catch {}
  renderAll(); window.scrollTo(0,0);
  if (v === "pot") jarBurst(16);
}

document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => setView(b.dataset.view));

$("fab").onclick = () => openSheet({});

// The Check off button floats over the screens where you'd log something, when there's a day still open.

function renderChrome(){
  $("fab").hidden = !["today","calendar","group"].includes(view) || mode === "loading" || !canWrite || !openDays().length;
  const pv = pendingVotes().length; const tg = $("tab-group");
  tg.classList.toggle("has-dot", pv > 0);
  tg.setAttribute("aria-label", pv ? `Group, ${pv} vote${pv === 1 ? "" : "s"} needed` : "Group");
}

function renderAll(){
  if (!S.me) S.me = "loading";
  renderChrome();
  $("todayLabel").textContent = fmtLong(todayStr());
  $("streakN").textContent = weeksStreak(S.me);
  if (view === "today") renderToday();
  if (view === "calendar") renderCalendar();
  if (view === "group") renderGroup();
  if (view === "pot") renderPot();
  if (view === "wrapped") renderWrapped();
  if ($("catSheet").open) renderCatSheet();
  if ($("daySheet").open) renderDaySheet();
}

/* ---------- entry card ---------- */

const REACTS = ["💪","🔥","🙏","👏"];

const photoURL = p => p ? (p.url || ("/_blob/" + p.id)) : "";

function entryHTML(e, date, who, opts = {}){
  const a = AREA[e.area]; const label = labelOf(e); const mine = who === S.me;
  const inGroup = mode !== "local" && isMember(who); const meIn = isMember(S.me);
  const hidden = e.priv && !mine;
  const counted = pickedIds(who, date).includes(e.id);
  const bits = [];
  if (opts.showWho) bits.push(`<span class="who" style="color:var(--fg)">${esc(nameOf(who))}</span>`);
  bits.push(`<b>${esc(a.name)}</b>`);
  if (date) bits.push(esc(fmtShort(date)));
  if (!hidden && e.minutes) bits.push(`<span class="num">${esc(e.minutes)} min</span>`);
  const badges = [];
  if (counted) badges.push(`<span class="badge ok">Counts</span>`); else badges.push(`<span class="badge muted">Extra</span>`);
  if (e.isNew) badges.push(`<span class="badge warn">New</span>`);
  if (e.priv) badges.push(`<span class="badge muted">Private</span>`);
  const ci = inGroup ? capInfo(who, date, e) : null;
  if (ci) badges.push(({needproof:`<span class="badge bad">Capped · proof due ${esc(fmtWhen(ci.deadline))}</span>`, expired:`<span class="badge bad">No proof · doesn't count</span>`, proven:`<span class="badge ok">Proof posted</span>`})[ci.status] || (ci.n ? `<span class="badge warn">${ci.n} of ${ci.need} cap calls</span>` : ""));
  const photos = [!hidden && e.photo && {p:e.photo, cap:"Photo"}, e.proof && e.proof.photo && {p:e.proof.photo, cap:"Proof"}].filter(Boolean);
  let vote = "";
  const dis = canWrite ? "" : "disabled";
  if (ci && !mine && meIn && ci.windowOpen) vote = `<div class="vote-row"><button class="chipbtn cap" aria-pressed="${ci.mine}" data-cap="${esc(ci.key)}" ${dis}>${ci.mine ? "You called cap" : "Call cap"}</button><span>${ci.n} of ${ci.need} needed</span></div>`;
  if (ci && !mine && meIn && !ci.cappable && !opts.compact) vote = `<div class="vote-row"><span>Prayer, silence and self-reflection can't be capped.</span></div>`;
  if (ci && mine && ci.status === "needproof") vote = `<div class="vote-row"><button class="btn" style="padding:7px 12px;font-size:13px" data-proof="${esc(e.id)}" data-date="${esc(date)}">Add proof</button><span>Due ${esc(fmtWhen(ci.deadline))}, or this won't count.</span></div>`;
  let social = "";
  if (inGroup) {
    const k = key3(who, date, e.id); const counts = {}; let myR = null;
    memberIds().forEach(v => { const r = S.votes[v]?.react?.[k]; if (r) { counts[r] = (counts[r]||0)+1; if (v === S.me) myR = r; } });
    const comments = memberIds().flatMap(v => (S.votes[v]?.cmt?.[k] || []).map(c => ({...c, by:v}))).sort((x,y) => x.at - y.at);
    const canReact = !mine && meIn && canWrite;
    const shown = REACTS.filter(r => canReact || counts[r]);
    social = `<div class="social">${shown.map(r => `<button class="react ${myR===r?"on":""}" data-react="${esc(k)}" data-r="${r}" ${canReact?"":"disabled"} aria-label="React ${r}">${r}${counts[r]?`<span class="num">${counts[r]}</span>`:""}</button>`).join("")}
      ${meIn && canWrite ? `<button class="react cmt-btn" data-cmtopen="${esc(k)}">Comment${comments.length?` <span class="num">${comments.length}</span>`:""}</button>` : ""}</div>
      ${comments.length ? `<ul class="cmts">${comments.map(c => `<li><b>${esc(nameOf(c.by))}</b> ${esc(c.text)}</li>`).join("")}</ul>` : ""}
      <form class="cmt-form" data-cmtform="${esc(k)}" hidden><input maxlength="140" placeholder="Say something" aria-label="Comment"><button class="btn" type="submit">Send</button></form>`;
  }
  const editable = mine && mode !== "loading" && !dayLocked(who, date);
  return `<article class="entry" style="--c:var(--${a.id})"><div class="bar"></div>
    <div class="body"><div class="meta">${bits.join("<span>·</span>")} ${badges.join(" ")}</div>
      ${hidden ? `<div class="what priv">Private ${esc(a.name.toLowerCase())} check-off</div>` : `<div class="what">${esc(label)}${e.detail && !AREA[e.area].num ? ` · <span style="color:var(--muted);font-weight:500">${esc(e.detail)}</span>` : ""}</div><p class="sum">${esc(e.summary)}</p>`}
      ${e.proof && e.proof.note ? `<div class="proofnote">${esc(e.proof.note)}</div>` : ""}
      ${photos.length && !opts.noThumbs ? `<div class="thumbs">${photos.map(x => `<button data-lb="${esc(photoURL(x.p))}" data-lbcap="${esc(x.cap)}"><img src="${esc(photoURL(x.p))}" alt="${esc(x.cap)}" loading="lazy"></button>`).join("")}</div>` : ""}
      ${vote}${social}</div>
    <div class="acts">${editable ? `<button class="icon-btn" data-edit="${esc(e.id)}" data-date="${esc(date)}">Edit</button><button class="icon-btn danger" data-del="${esc(e.id)}" data-date="${esc(date)}">Delete</button>` : ""}</div>
  </article>`;
}

function wire(root){
  root.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { const e = entriesOf(S.me, b.dataset.date).find(x => x.id === b.dataset.edit); if (e) openSheet({entry:e, date:b.dataset.date}); });
  root.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Sure?"; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "Delete"; } }, 3000); return; }
    const d = b.dataset.date; const doc = myLogs()[d]; if (!doc || dayLocked(S.me, d)) return;
    doc.entries = doc.entries.filter(x => x.id !== b.dataset.del); if (doc.picks) doc.picks = doc.picks.filter(x => x !== b.dataset.del);
    if (!doc.entries.length) delete myLogs()[d];
    persistDay(d); renderAll(); toast("Deleted");
  });
  const toggleMap = (field, k, val) => { const v = myVotes(); v[field] ||= {}; if (v[field][k] === val) delete v[field][k]; else v[field][k] = val; saveVotes(); renderAll(); };
  root.querySelectorAll("[data-cap]").forEach(b => b.onclick = () => { const v = myVotes(); v.cap ||= {}; if (v.cap[b.dataset.cap]) delete v.cap[b.dataset.cap]; else v.cap[b.dataset.cap] = Date.now(); saveVotes(); renderAll(); });
  root.querySelectorAll("[data-react]").forEach(b => b.onclick = () => toggleMap("react", b.dataset.react, b.dataset.r));
  root.querySelectorAll("[data-pv]").forEach(b => b.onclick = () => toggleMap("pass", b.dataset.pv, b.dataset.val));
  root.querySelectorAll("[data-cmtopen]").forEach(b => b.onclick = () => { const f = [...root.querySelectorAll("[data-cmtform]")].find(x => x.dataset.cmtform === b.dataset.cmtopen); if (f) { f.hidden = !f.hidden; if (!f.hidden) f.querySelector("input").focus(); } });
  root.querySelectorAll("[data-cmtform]").forEach(f => f.onsubmit = ev => { ev.preventDefault(); const text = f.querySelector("input").value.trim(); if (!text) return; const v = myVotes(); v.cmt ||= {}; (v.cmt[f.dataset.cmtform] ||= []).push({text: text.slice(0,140), at: Date.now()}); saveVotes(); renderAll(); });
  root.querySelectorAll("[data-proof]").forEach(b => b.onclick = () => openProof(b.dataset.date, b.dataset.proof));
  root.querySelectorAll("[data-lb]").forEach(b => b.onclick = () => { $("lbImg").src = b.dataset.lb; $("lbCap").textContent = b.dataset.lbcap; $("lightbox").showModal(); });
}

$("lightbox").addEventListener("click", () => $("lightbox").close());

/* ---------- today ---------- */

function goalCard({title, sub, left, st, kind, gi}){
  const t = todayStr(); const todayAreas = new Set(entriesOf(S.me, t).filter(e => pickedIds(S.me, t).includes(e.id)).map(e => e.area));
  const req = [...st.req].sort((a,b) => b-a);
  const hi = Math.max(...req), lo = Math.min(...req.filter(x => x > 0).concat([hi]));
  const atHi = AREAS.filter(a => st.targets[a.id] === hi && st.c[a.id] >= hi).length, nHi = req.filter(x => x === hi).length;
  const atLo = AREAS.filter(a => st.targets[a.id] > 0 && st.c[a.id] >= Math.min(lo, st.targets[a.id])).length, nPos = req.filter(x => x > 0).length;
  const rows = [];
  if (hi !== lo) {
    rows.push({ok: atLo >= nPos, text: nPos === 5 ? `All 5 at least ${lo === 1 ? "once" : lo === 2 ? "twice" : lo + " times"}` : `${nPos} categories at least ${lo === 1 ? "once" : lo === 2 ? "twice" : lo+" times"}`, prog: `${Math.min(atLo, nPos)} of ${nPos}`});
    rows.push({ok: atHi >= nHi, text: `Any ${nHi} at least ${hi === 2 ? "twice" : hi + " times"}`, prog: `${Math.min(atHi, nHi)} of ${nHi}`});
  } else rows.push({ok: st.met, text: `${nPos === 5 ? "All 5" : nPos + " categories"} at least ${hi === 1 ? "once" : hi === 2 ? "twice" : hi+" times"}`, prog: `${Math.min(atLo,nPos)} of ${nPos}`});
  rows.push({ok: st.total >= st.goalTotal, text: kind === "week" ? `${st.goalTotal} check-offs (2 a day max, so at least ${Math.ceil(st.goalTotal/2)} days)` : `${st.goalTotal} check-offs`, prog: `${Math.min(st.total, st.goalTotal)} of ${st.goalTotal}`});
  const pct = Math.min(1, AREAS.reduce((s,a) => s + Math.min(st.c[a.id], st.targets[a.id]), 0) / Math.max(1, st.goalTotal));
  const needTxt = st.met ? "" : st.missing.map(m => `${m.a.name}${m.short > 1 ? ` ×${m.short}` : ""}`);
  const passNote = st.passes.granted ? ` · lowered by ${st.passes.granted} pass${st.passes.granted>1?"es":""}` : "";
  return `<article class="goal g2 ${st.met?"met":""}">
    <div class="g-head"><div class="g-title"><h3>${title}</h3><div class="rule">${sub}${passNote}</div></div>
      <div class="g-left ${left<=2 && !st.met ? "urgent" : ""}"><b class="num">${left}</b><span>${left===1?"day left":"days left"}</span>${st.met ? `<em class="g-state ok">Goal hit</em>` : ""}</div></div>
    <div class="g-bar"><i style="width:${pct*100}%"></i></div>
    <div class="g-tiles">${AREAS.map(a => { const v = st.c[a.id], tg = st.targets[a.id]; const k = tg ? Math.min(1, v/tg) : 1; const done = v >= tg;
      return `<button class="g-tile ${done?"done":""}" style="--c:var(--${a.id});--k:${Math.round(12+k*88)}%" data-goal="${gi}" data-cat="${a.id}" aria-label="${a.name}: ${v} of ${tg}. Tap to check off">
        ${todayAreas.has(a.id) ? `<i class="g-today"></i>` : ""}<span class="g-check">${done ? (tg > 1 ? `${tg}×` : "✓") : ""}</span>
        <span class="g-n num">${v}<small>/${tg}</small></span><span class="g-name">${a.name}</span></button>`; }).join("")}</div>
    <ul class="g-req">${rows.map(r => `<li class="${r.ok?"ok":""}"><span class="g-dot">${r.ok?"✓":""}</span><span class="g-text">${r.text}</span><span class="g-prog num">${r.prog}</span></li>`).join("")}</ul>
    ${needTxt ? `<div class="need">Still need: <b>${esc(listAnd(needTxt))}</b>${kind === "block" ? `. ${esc(blockHint())}` : ""}</div>` : ""}
    ${kind === "block" ? moneyLine(st) : ""}
  </article>`;
}

function blockHint(){
  const bs = blockStart(new Date()); const inWeek2 = monday(new Date()) > bs;
  return inWeek2 ? "It's week 2, so double up on different categories than last week." : "Tip: double up on 2 categories this week and 2 different ones next week.";
}

function moneyLine(st){
  if (!isMember(S.me) || st.met) return "";
  const c = costFor(blockStart(new Date())); if (!c.cost) return `<div class="g-money">Miss it and you get clowned.</div>`;
  return `<div class="g-money">Miss it and you pay ${money(oweFor(c, st.missedCats || 1))}${c.mode === "per" ? ` (${money(c.cost)} for each category short)` : ""}, and you get clowned.</div>`;
}

let goalDefs = [];

function renderToday(){
  const now = new Date(); const ws = monday(now), bs = blockStart(now); const t = todayStr();
  const wst = weekStatus(S.me, ws), bst = blockStatus(S.me, bs);
  goalDefs = [];
  let html = "";
  if (wst.req) { goalDefs.push({start: ws, n: 7, title:"This week"}); html += goalCard({title:"This week", sub:`Ends Sunday night · ${fmtShort(ws)} – ${fmtShort(addDays(ws,6))}`, left: 7 - daysBetween(ymd(ws), t), st: wst, kind:"week", gi: goalDefs.length-1}); }
  if (bst.req) { goalDefs.push({start: bs, n: 14, title: bst.type === "pro" ? "Your first block" : "This two-week block"}); html += goalCard({title: bst.type === "pro" ? "Your first block (prorated)" : "This two-week block", sub: bst.type === "pro" ? `One check-off per day left · ends ${fmtShort(addDays(bs,13))}` : `Ends every second Sunday · ${fmtShort(bs)} – ${fmtShort(addDays(bs,13))}`, left: 14 - daysBetween(ymd(bs), t), st: bst, kind:"block", gi: goalDefs.length-1}); }
  if (!html) html = `<div class="empty">You joined on the last day of a block, so your goals start tomorrow.</div>`;
  $("goals").innerHTML = html;
  $("goals").querySelectorAll("[data-cat]").forEach(b => b.onclick = () => openCat(+b.dataset.goal, b.dataset.cat));
  renderNudges(wst);
  renderPicks();
  const any = Object.keys(myLogs()).length;
  $("todayExtra").innerHTML = !any && mode !== "demo" ? `<div class="empty" style="margin-top:14px">New here? See how a full group looks before you start.<div><button class="btn ghost" id="demoBtn">See it with an example group</button></div></div>` : "";
  const b = $("demoBtn"); if (b) b.onclick = startDemo;
}

function renderNudges(wst){
  const n = []; const dow = (new Date().getDay()+6)%7; // Mon=0
  const clown = clownInfo(S.me);
  // Deadlines first: these cost you a check-off or a vote if they slip.
  proofDue().forEach(p => n.push(`<div class="nudge warn"><span class="ico">🧢</span><div>Your ${esc(AREA[p.e.area].name)} check-off from ${esc(fmtDow(p.d))} got capped. Add proof by ${esc(fmtWhen(p.ci.deadline))} or it won't count.<div><button class="btn go" data-proof="${esc(p.e.id)}" data-date="${esc(p.d)}">Add proof</button></div></div></div>`));
  const pv = pendingVotes();
  if (pv.length) { const r = pv[0]; n.push(`<div class="nudge"><span class="ico">🗳️</span><div>${pv.length === 1 ? `${esc(nameOf(r.id))} asked for a pass on ${esc(fmtDow(r.d))}. Voting closes ${esc(fmtWhen(r.i.closes))}.` : `${pv.length} pass requests need your vote. The first closes ${esc(fmtWhen(r.i.closes))}.`}<div><button class="btn ghost go" data-go="group">Vote</button></div></div></div>`); }
  if (clown) n.push(`<div class="nudge clown"><span class="ico">🤡</span><div>You're clowned: you ${esc(clown.reasons.map(r => r.text).join(" and "))}. Hit this week's goal and it comes off.</div></div>`);
  if (wst.req && !wst.met && dow >= 3) { const left = 7 - dow; n.push(`<div class="nudge warn"><span class="ico">⏰</span><div>Still missing ${esc(listAnd(wst.missing.map(m => m.a.name)))}. ${left} day${left===1?"":"s"} left.</div></div>`); }
  const wk = ymd(monday(new Date()));
  const from = memberIds().filter(v => v !== S.me && S.votes[v]?.nudge?.[`${S.me}|${wk}`]);
  if (from.length) n.push(`<div class="nudge"><span class="ico">👉</span><div>${esc(listAnd(from.map(nameOf)))} nudged you. Get it done.</div></div>`);
  const t = todayStr(); const mine = Object.keys(S.passes[S.me]?.req || {}).map(d => passInfo(S.me, d)).filter(p => p && p.status === "pending");
  mine.forEach(p => n.push(`<div class="nudge"><span class="ico">🗳️</span><div>Your pass request is being voted on until ${esc(fmtWhen(p.closes))}: ${p.yes} yes, ${p.no} no.</div></div>`));
  if (wst.req && wst.met) n.push(`<div class="nudge good"><span class="ico">🎉</span><div>Weekly goal hit. Keep going for the block.</div></div>`);
  $("nudges").innerHTML = n.join("");
  wire($("nudges"));
  $("nudges").querySelectorAll("[data-go]").forEach(b => b.onclick = () => setView(b.dataset.go));
}

function renderPicks(){
  const days = [todayStr(), ymd(addDays(new Date(), -1))].filter(k => entriesOf(S.me, k).length || k === todayStr());
  let html = `<div class="sec-head"><h2>Today's 2</h2><span class="eyebrow">Only 2 a day count</span></div>`;
  days.forEach(k => {
    const list = [...entriesOf(S.me, k)].sort((a,b) => (a.createdAt||0) - (b.createdAt||0)); const ids = pickedIds(S.me, k); const locked = dayLocked(S.me, k);
    if (k !== todayStr() && (locked || !list.length)) return;
    if (k !== todayStr()) html += `<div class="cs-sub">Yesterday · open until ${esc(fmtWhen(dayCloseTs(k)))}</div>`;
    html += list.length ? `<div class="picks">${list.map(e => `<div class="pick" style="--c:var(--${e.area})"><span class="bar"></span><div style="min-width:0"><div class="t">${esc(AREA[e.area].name)} · ${esc(labelOf(e))}</div><div class="s">${esc(e.summary)}</div></div>
        <button class="chipbtn" aria-pressed="${ids.includes(e.id)}" data-pick="${esc(e.id)}" data-day="${k}" ${locked?"disabled":""}>${ids.includes(e.id) ? "Counts" : "Extra"}</button></div>`).join("")}</div>
      <div class="lockrow"><span>${locked ? "Locked. These can't change now." : `${list.length > DAILY ? `Pick which ${DAILY} count. If you don't, your first ${DAILY} do.` : "Your first 2 check-offs count automatically."} Locks on its own ${esc(fmtWhen(dayCloseTs(k)))}.`}</span></div>`
      : `<div class="empty">Nothing yet today. Tap <b>Check off</b> to log what you did.</div>`;
  });
  $("picksSec").innerHTML = html;
  $("picksSec").querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
    const k = b.dataset.day, id = b.dataset.pick; const doc = myLogs()[k]; if (!doc || dayLocked(S.me, k)) return;
    let ids = pickedIds(S.me, k);
    if (ids.includes(id)) ids = ids.filter(x => x !== id); else { if (ids.length >= DAILY) ids = ids.slice(1); ids.push(id); }
    doc.picks = ids; persistDay(k); renderAll();
  });
}

/* ---------- category sheet ---------- */

let csGoal = 0, csArea = "physical";

function openCat(gi, area){ csGoal = gi; csArea = area; renderCatSheet(); if (!$("catSheet").open) $("catSheet").showModal(); }

function renderCatSheet(){
  const g = goalDefs[csGoal] || {start: monday(new Date()), n: 7, title: "This week"}; const a = AREA[csArea]; const t = todayStr();
  const k = countsIn(S.me, g.start, g.n);
  const days = []; for (let i = g.n-1; i >= 0; i--) { const d = ymd(addDays(g.start, i)); if (d <= t) days.push(d); }
  const byDay = days.map(d => [d, entriesOf(S.me, d).filter(e => e.area === csArea)]).filter(([,l]) => l.length);
  const todayList = (byDay.find(([d]) => d === t) || [t, []])[1];
  const photos = todayList.filter(e => e.photo).map(e => ({p:e.photo, tag: labelOf(e)}));
  const canLog = openDays().length > 0;
  $("csBody").innerHTML = `<div class="ds-head"><h2 id="csTitle"><span class="who">${esc(g.title)}</span>${esc(a.name)}</h2><button class="ds-nav" id="csClose" aria-label="Close">×</button></div>
    <div class="cat-tabs" role="tablist">${AREAS.map(x => `<button role="tab" style="--c:var(--${x.id})" class="${k.c[x.id]?"has":""}" aria-selected="${x.id===csArea}" data-cs="${x.id}"><i></i><b>${k.c[x.id]}</b><span>${x.name}</span></button>`).join("")}</div>
    <p style="color:var(--muted);font-size:13px;margin:0 0 10px">${esc(a.blurb)}</p>
    ${canLog ? `<button class="btn cs-log" style="--c:var(--${a.id})" id="csLog">Check off ${esc(a.name)}</button>` : `<div class="empty" style="margin-bottom:12px">Today is locked.</div>`}
    <div class="cs-sub">Today</div>
    ${photos.length ? `<div class="hero-photos">${photos.map(x => `<button data-lb="${esc(photoURL(x.p))}" data-lbcap="${esc(x.tag)}"><img src="${esc(photoURL(x.p))}" alt="${esc(x.tag)}"><span class="tag">${esc(x.tag)}</span></button>`).join("")}</div>` : ""}
    <div class="entries">${todayList.length ? todayList.map(e => entryHTML(e, t, S.me, {noThumbs:true, compact:true})).join("") : `<div class="empty">No ${esc(a.name)} today yet.</div>`}</div>
    ${byDay.filter(([d]) => d !== t).length ? `<div class="cs-sub">Earlier</div><div class="entries">${byDay.filter(([d]) => d !== t).flatMap(([d,l]) => l.map(e => entryHTML(e, d, S.me, {compact:true}))).join("")}</div>` : ""}`;
  wire($("csBody"));
  $("csBody").querySelectorAll("[data-cs]").forEach(b => b.onclick = () => { csArea = b.dataset.cs; renderCatSheet(); });
  $("csClose").onclick = () => $("catSheet").close();
  const lg = $("csLog"); if (lg) lg.onclick = () => openSheet({area: csArea});
}

$("catSheet").addEventListener("click", e => { if (e.target === $("catSheet")) $("catSheet").close(); });

/* ---------- calendar + day sheet ---------- */

let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1), selDay = todayStr(), calWho = null, dsArea = null;

$("calPrev").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth()-1, 1); renderCalendar(); };

$("calNext").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth()+1, 1); renderCalendar(); };

$("calToday").onclick = () => { calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); renderCalendar(); };

$("calLegend").innerHTML = AREAS.map(a => `<span style="--c:var(--${a.id})"><i></i>${a.name}</span>`).join("") + `<span><b style="color:var(--ok)">✓</b> week goal hit</span><span>🤡 week missed</span>`;

function renderCalendar(){
  const people = [S.me, ...memberIds().filter(id => id !== S.me)];
  if (!calWho || !people.includes(calWho)) calWho = S.me;
  $("calMembers").innerHTML = people.length > 1 ? people.map(id => `<button class="chipbtn" aria-pressed="${id===calWho}" data-who="${esc(id)}">${esc(nameOf(id))}</button>`).join("") : "";
  $("calMembers").querySelectorAll("[data-who]").forEach(b => b.onclick = () => { calWho = b.dataset.who; renderCalendar(); });
  $("calTitle").textContent = calMonth.toLocaleDateString(undefined,{month:"long", year:"numeric"});
  const t = todayStr(); const start = monday(calMonth); const last = new Date(calMonth.getFullYear(), calMonth.getMonth()+1, 0);
  let html = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => `<div class="dow">${d.slice(0,1)}<span class="sr">${d.slice(1)}</span></div>`).join("") + `<div class="dow">W</div>`;
  for (let w = start; w <= last; w = addDays(w, 7)) {
    for (let i = 0; i < 7; i++) {
      const d = addDays(w, i); const k = ymd(d); const l = entriesOf(calWho, k); const ids = pickedIds(calWho, k);
      const on = l.filter(e => ids.includes(e.id)).map(e => e.area); const hasPhoto = l.some(e => (e.photo && (!e.priv || calWho === S.me)) || e.proof?.photo);
      const pass = passInfo(calWho, k)?.status === "granted";
      const cls = ["day"]; if (d.getMonth() !== calMonth.getMonth()) cls.push("out"); if (k > t) cls.push("future"); if (k === t) cls.push("today"); if (pass) cls.push("pass");
      html += `<button class="${cls.join(" ")}" data-day="${k}" aria-label="${esc(fmtLong(k))}, ${l.length} check-offs"><span class="d">${d.getDate()}</span>${hasPhoto?`<i class="cam"></i>`:""}
        <span class="stripes">${AREAS.map(a => `<i class="${on.includes(a.id)?"on":""}" style="--c:var(--${a.id})"></i>`).join("")}</span></button>`;
    }
    const ws = weekStatus(calWho, w);
    const mark = !ws.req || !ws.closed ? "·" : ws.met ? "✓" : ws.missed ? "🤡" : "·";
    html += `<div class="wk ${ws.met && ws.closed ? "ok" : "no"}">${mark}</div>`;
  }
  $("cal").innerHTML = html;
  $("cal").querySelectorAll("[data-day]").forEach(b => b.onclick = () => openDay(b.dataset.day));
}

function openDay(day){ selDay = day; dsArea = null; renderDaySheet(); if (!$("daySheet").open) $("daySheet").showModal(); }

function renderDaySheet(){
  const l = entriesOf(calWho, selDay); const mine = calWho === S.me; const pi = passInfo(calWho, selDay);
  const by = Object.fromEntries(AREAS.map(a => [a.id, l.filter(e => e.area === a.id)]));
  if (!dsArea) dsArea = (AREAS.find(a => by[a.id].length) || AREAS[0]).id;
  const a = AREA[dsArea]; const list = by[dsArea];
  const photos = list.flatMap(e => [e.photo && (!e.priv || mine) && {p:e.photo, tag: labelOf(e)}, e.proof?.photo && {p:e.proof.photo, tag:"Proof"}].filter(Boolean));
  const nextOk = ymd(addDays(parse(selDay),1)) <= todayStr(); const open = mine && !dayLocked(S.me, selDay) && selDay <= todayStr();
  $("dsBody").innerHTML = `<div class="ds-head"><button class="ds-nav" id="dsPrev" aria-label="Previous day">‹</button>
      <h2 id="dsTitle">${!mine ? `<span class="who">${esc(nameOf(calWho))}</span>` : ""}${esc(fmtLong(selDay))}</h2>
      <button class="ds-nav" id="dsNext" aria-label="Next day" ${nextOk?"":"disabled"}>›</button><button class="ds-nav" id="dsClose" aria-label="Close">×</button></div>
    <div class="cat-tabs" role="tablist">${AREAS.map(x => `<button role="tab" style="--c:var(--${x.id})" class="${by[x.id].length?"has":""}" aria-selected="${x.id===dsArea}" data-cat="${x.id}"><i></i><b>${by[x.id].length}</b><span>${x.name}</span></button>`).join("")}</div>
    ${pi ? `<div class="card" style="margin-bottom:12px"><div class="spread"><h3>Pass ${pi.status}</h3><span class="badge ${pi.status==="granted"?"ok":pi.status==="denied"?"bad":"warn"}">${pi.yes} yes · ${pi.no} no</span></div><p>${esc(pi.req.reason)}</p></div>` : ""}
    ${photos.length ? `<div class="hero-photos">${photos.map(x => `<button data-lb="${esc(photoURL(x.p))}" data-lbcap="${esc(x.tag)}"><img src="${esc(photoURL(x.p))}" alt="${esc(x.tag)}"><span class="tag">${esc(x.tag)}</span></button>`).join("")}</div>` : ""}
    <div class="entries">${list.length ? list.map(e => entryHTML(e, selDay, calWho, {noThumbs:true})).join("") : `<div class="empty">No ${esc(a.name)} this day.${open ? `<div><button class="btn ghost" id="dsLog">Check off ${esc(a.name)}</button></div>` : ""}</div>`}</div>
    ${list.length && open ? `<div style="margin-top:12px"><button class="btn ghost" id="dsLog">Add another</button></div>` : ""}
    ${mine && selDay <= todayStr() ? `<p style="font-size:12.5px;color:var(--muted);margin-top:12px">${dayLocked(S.me, selDay) ? "This day is locked." : `Open until ${esc(fmtWhen(dayCloseTs(selDay)))}.`}</p>` : ""}`;
  wire($("dsBody"));
  $("dsBody").querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { dsArea = b.dataset.cat; renderDaySheet(); });
  $("dsClose").onclick = () => $("daySheet").close();
  $("dsPrev").onclick = () => stepDay(-1); $("dsNext").onclick = () => stepDay(1);
  const lg = $("dsLog"); if (lg) lg.onclick = () => openSheet({area: dsArea, date: selDay});
}

function stepDay(n){ const d = addDays(parse(selDay), n); if (ymd(d) > todayStr()) return; if (d.getMonth() !== calMonth.getMonth()) { calMonth = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendar(); } openDay(ymd(d)); }

$("daySheet").addEventListener("click", e => { if (e.target === $("daySheet")) $("daySheet").close(); });

/* ---------- group ---------- */

function renderGroup(){
  const host = $("groupBody");
  if (mode === "local" || mode === "loading") {
    host.innerHTML = `<div class="card"><h3>${mode === "loading" ? "Connecting…" : "Groups need you signed in"}</h3><p>${mode === "loading" ? "One moment." : "Open this page signed in to Claude to create or join a group."}</p>${mode === "local" ? `<div style="margin-top:10px"><button class="btn ghost" id="demoBtn2">See an example group</button></div>` : ""}</div>`;
    const b = $("demoBtn2"); if (b) b.onclick = startDemo; return;
  }
  const ids = memberIds(); const me = S.me; const owner = isOwner || mode === "demo";
  const curC = costFor(blockStart(new Date())); const t = todayStr(); const dow = (new Date().getDay()+6)%7;
  let html = "";
  // setup / header
  if (!S.settings) {
    html += owner ? `<div class="card" style="margin-bottom:18px"><h3>Create your group</h3><p>Up to ${MAX_GROUP} friends. Everyone sees these stakes before they join.</p>${settingsForm({name:"", cost:10, mode:"flat"}, "Create group")}</div>`
                  : `<div class="card"><h3>No group yet</h3><p>The person who shared this with you needs to create the group first.</p></div>`;
    host.innerHTML = html; wireSettings(true); return;
  }
  const full = ids.length >= MAX_GROUP;
  html += `<section><div class="card"><div class="spread"><h3 style="font-family:var(--f-display);font-size:20px">${esc(S.settings.name || "Our group")}</h3><span class="badge muted">${ids.length} of ${MAX_GROUP}</span></div>
    <div class="stakes"><span>Miss a week: get clowned</span><span>Miss a block: ${esc(costText(curC))}</span></div>
    ${isMember(me) ? `<div style="margin-top:12px"><button class="btn ghost" id="passBtn" style="padding:8px 14px;font-size:13.5px" ${canWrite?"":"disabled"}>Request a pass</button></div>` : ""}
    ${!isMember(me) ? (full ? `<p>This group is full.</p>` : `<p>Joining now gives you a prorated goal for the rest of this block: one check-off per day left, starting tomorrow. You start collecting from others in your first full block.</p><div style="margin-top:10px"><button class="btn" id="joinBtn" ${canWrite?"":"disabled"}>Join the group</button></div>`) : ""}
    ${owner ? `<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700;font-size:14px">Change stakes</summary><p>Changes show in the feed and start with the next two-week block.</p>${settingsForm({name:S.settings.name, cost: curC.cost, mode: curC.mode}, "Save for next block")}</details>` : ""}
  </div></section>`;
  // pass requests and the card each one is shown as
  const reqs = ids.flatMap(id => Object.keys(S.passes[id]?.req || {}).map(d => ({id, d, i: passInfo(id, d)}))).filter(r => r.d >= ymd(addDays(new Date(), -14))).sort((a,b) => (a.i.status === "pending" ? 0 : 1) - (b.i.status === "pending" ? 0 : 1) || b.d.localeCompare(a.d));
  const passCard = r => { const i = r.i; const own = r.id === me;
    return `<div class="card"><div class="spread"><div><span class="who">${esc(nameOf(r.id))}</span> <span style="color:var(--muted)">· ${esc(fmtDow(r.d))}</span></div>
      <span class="badge ${i.status==="granted"?"ok":i.status==="denied"?"bad":"warn"}">${i.status==="pending" ? `Voting until ${esc(fmtWhen(i.closes))}` : i.status === "granted" ? "Granted" : "Denied"}</span></div>
      <p style="color:var(--fg)">${esc(i.req.reason)}</p>
      <div class="vote-row">${!own && isMember(me) && i.status === "pending" ? `<button class="chipbtn" aria-pressed="${i.mine==="yes"}" data-pv="${esc(i.key)}" data-val="yes" ${canWrite?"":"disabled"}>Yes</button><button class="chipbtn cap" aria-pressed="${i.mine==="no"}" data-pv="${esc(i.key)}" data-val="no" ${canWrite?"":"disabled"}>No</button>` : ""}<span>${i.yes} yes · ${i.no} no${i.status === "pending" ? " · only votes cast count, a tie is a no" : ""}</span></div></div>`; };
  // votes waiting on you go first, since they close in 24 hours
  const waiting = pendingVotes().map(p => `${p.id}|${p.d}`);
  const needVote = reqs.filter(r => waiting.includes(`${r.id}|${r.d}`));
  if (needVote.length) html += `<section><div class="sec-head"><h2>Needs your vote</h2><span class="eyebrow">${needVote.length} open</span></div><div class="entries">${needVote.map(passCard).join("")}</div></section>`;
  // board
  if (ids.length) {
    html += `<section><div class="sec-head"><h2>Board</h2><span class="eyebrow">Week of ${fmtShort(monday(new Date()))}</span></div><div class="card">`;
    html += ids.map(id => {
      const w = weekStatus(id, monday(new Date())); const b = blockStatus(id, blockStart(new Date())); const cl = clownInfo(id);
      const atRisk = w.req && !w.met && dow >= 5;
      let st = !w.req ? (b.req ? `<span class="badge muted">Prorated block · ${b.total}/${b.goalTotal}</span>` : `<span class="badge muted">Starts tomorrow</span>`)
        : w.met ? `<span class="badge ok">Week hit</span>` : atRisk ? `<span class="badge bad">At risk</span>` : `<span class="badge warn">${w.total} of ${w.goalTotal}</span>`;
      const nk = `${id}|${ymd(monday(new Date()))}`; const nudged = !!S.votes[me]?.nudge?.[nk];
      const roasts = cl ? memberIds().flatMap(v => (S.votes[v]?.roast?.[`${id}|${cl.key}`] || []).map(r => ({...r, by:v}))) : [];
      return `<div class="board-row"><div><div class="nm">${cl ? "🤡 " : ""}${esc(nameOf(id))}</div><div class="sub">${weeksStreak(id)} weeks hit in a row · block ${b.req ? `${b.total}/${b.goalTotal}` : "–"}${cl ? ` · ${esc(cl.reasons[0].text)}` : ""}</div></div>
        <div class="row" style="justify-content:flex-end">${st}${atRisk && id !== me && isMember(me) ? `<button class="chipbtn" data-nudge="${esc(nk)}" aria-pressed="${nudged}" ${canWrite?"":"disabled"}>${nudged ? "Nudged" : "Nudge"}</button>` : ""}</div>
        ${cl ? `<div class="roasts">${roasts.length ? `<ul>${roasts.map(r => `<li><b>${esc(nameOf(r.by))}:</b> ${esc(r.text)}</li>`).join("")}</ul>` : ""}${id !== me && isMember(me) && canWrite ? `<form class="cmt-form" data-roast="${esc(`${id}|${cl.key}`)}"><input maxlength="100" placeholder="Leave a roast caption" aria-label="Roast caption"><button class="btn" type="submit">Roast</button></form>` : ""}</div>` : ""}</div>`;
    }).join("");
    html += `</div><p style="font-size:12.5px;color:var(--muted);margin:8px 2px 0">You get a private nudge Thursday. From Saturday the group can see who's at risk. Weeks close Sunday night, and a clown comes off when you hit the next week's goal.</p></section>`;
  }
  // feed: the main social surface, so it comes before the pass history
  html += `<section><div class="sec-head"><h2>Feed</h2><span class="eyebrow">Last 14 days</span></div><div class="entries">${feedHTML()}</div></section>`;
  // pass history (open requests you still need to vote on are already shown above)
  const rest = reqs.filter(r => !needVote.includes(r));
  html += `<section><div class="sec-head"><h2>Passes</h2><span class="eyebrow">Last 14 days</span></div>`;
  html += rest.length ? `<div class="entries">${rest.map(passCard).join("")}</div>` : `<div class="empty">${needVote.length ? "No other pass requests" : "No pass requests"} in the last two weeks.</div>`;
  html += `</section>`;
  host.innerHTML = html;
  wire(host); wireSettings(false);
  const jb = $("joinBtn"); if (jb) jb.onclick = joinGroup;
  const pb = $("passBtn"); if (pb) pb.onclick = openPass;
  host.querySelectorAll("[data-nudge]").forEach(b => b.onclick = () => { const v = myVotes(); v.nudge ||= {}; if (v.nudge[b.dataset.nudge]) return; v.nudge[b.dataset.nudge] = Date.now(); saveVotes(); renderAll(); toast("Nudge sent"); });
  host.querySelectorAll("[data-roast]").forEach(f => f.onsubmit = ev => { ev.preventDefault(); const text = f.querySelector("input").value.trim(); if (!text) return; const v = myVotes(); v.roast ||= {}; (v.roast[f.dataset.roast] ||= []).push({text: text.slice(0,100), at: Date.now()}); saveVotes(); renderAll(); });
}

let feedLimit = 30;

function feedHTML(){
  const ids = memberIds(); const since = ymd(addDays(new Date(), -13)); const t = todayStr(); const items = [];
  ids.forEach(id => Object.entries(S.logs[id] || {}).forEach(([d, doc]) => { if (d >= since && d <= t) doc.entries.forEach(e => items.push({at: e.createdAt || parse(d).getTime(), html: entryHTML(e, d, id, {showWho:true})})); }));
  // perfect weeks + clowns from the last closed week
  const lw = addDays(monday(new Date()), -7); const closeTs = addDays(lw, 7).getTime();
  const perfect = ids.filter(id => { const w = weekStatus(id, lw); return w.req && w.met; });
  if (perfect.length) items.push({at: closeTs, html: `<div class="feed-note party"><div class="when">Week of ${fmtShort(lw)} closed</div>🎉 Perfect week for <b>${esc(listAnd(perfect.map(nameOf)))}</b>.</div>`});
  const clowns = ids.filter(id => { const w = weekStatus(id, lw); return w.req && w.missed; });
  if (clowns.length) items.push({at: closeTs + 1, html: `<div class="feed-note"><div class="when">Week of ${fmtShort(lw)} closed</div>🤡 <b>${esc(listAnd(clowns.map(nameOf)))}</b> missed the weekly goal. Roasts are open on the board.</div>`});
  ids.forEach(id => Object.entries(S.passes[id]?.req || {}).forEach(([d, r]) => { if ((r.at||0) >= parse(since).getTime()) items.push({at: r.at, html: `<div class="feed-note"><div class="when">${esc(fmtWhen(r.at))}</div>🗳️ <b>${esc(nameOf(id))}</b> asked for a pass on ${esc(fmtDow(d))}: “${esc(r.reason)}”</div>`}); }));
  (S.settings?.history || []).slice(1).forEach(h => { if ((h.at||0) >= parse(since).getTime()) items.push({at: h.at, html: `<div class="feed-note"><div class="when">${esc(fmtWhen(h.at))}</div>⚙️ Stakes change to <b>${esc(costText(h))}</b> starting the block of ${esc(fmtShort(h.from))}.</div>`}); });
  ids.forEach(id => { if (S.members[id].joinedAt >= parse(since).getTime()) items.push({at: S.members[id].joinedAt, html: `<div class="feed-note"><div class="when">${esc(fmtWhen(S.members[id].joinedAt))}</div>👋 <b>${esc(nameOf(id))}</b> joined the group.</div>`}); });
  items.sort((a,b) => b.at - a.at);
  if (!items.length) return `<div class="empty">Nothing yet. Check-offs from everyone in the group show up here.</div>`;
  return items.slice(0, feedLimit).map(x => x.html).join("") + (items.length > feedLimit ? `<button class="btn ghost" id="moreFeed">Show more</button>` : "");
}

document.addEventListener("click", e => { if (e.target.closest("#moreFeed")) { feedLimit += 30; renderGroup(); } });

function settingsForm(v, label){
  return `<div class="settings-grid" style="margin-top:12px">
    <div class="field" style="grid-column:1/-1"><label for="sName">Group name</label><input id="sName" value="${esc(v.name)}" placeholder="e.g. Sunday Boys"></div>
    <div class="field"><label for="sCost">Cost of a miss ($)</label><input id="sCost" type="number" min="0" step="1" value="${esc(v.cost)}"><span class="help">$0 means clowning only</span></div>
    <div class="field"><label for="sMode">Charged</label><select id="sMode"><option value="flat" ${v.mode==="flat"?"selected":""}>Flat per missed block</option><option value="per" ${v.mode==="per"?"selected":""}>Per category missed</option></select></div>
  </div><div style="margin-top:10px"><button class="btn" id="saveSettings">${label}</button></div>`;
}

function wireSettings(isNew){
  const b = $("saveSettings"); if (!b) return;
  b.onclick = async () => {
    const entry = {cost: Math.max(0, +$("sCost").value || 0), mode: $("sMode").value, at: Date.now(), from: isNew ? ymd(blockStart(new Date())) : ymd(addDays(blockStart(new Date()), 14))};
    const next = {name: $("sName").value.trim() || "Our group", history: [...(S.settings?.history || []), entry]};
    if (!isNew) { const last = S.settings.history.at(-1); if (last.from === entry.from) next.history = [...S.settings.history.slice(0,-1), entry]; }
    S.settings = next;
    await saveSettings(next);
    if (isNew) await joinGroup(true);
    renderAll(); toast(isNew ? "Group created" : "Saved. Starts next block.");
  };
}

async function joinGroup(silent){
  if (memberIds().length >= MAX_GROUP) { toast("This group is full."); return; }
  const rec = {joinedAt: Date.now(), joinDay: todayStr()};
  // the creator who sets up on a block's first day gets the full block
  if (silent === true && todayStr() === ymd(blockStart(new Date()))) rec.joinDay = ymd(addDays(blockStart(new Date()), -1));
  S.members[S.me] = rec;
  await saveMember(rec);
  renderAll(); if (silent !== true) toast("You're in.");
}

/* ---------- pass sheet ---------- */

function openPass(){
  const ws = monday(new Date()); const opts = [];
  for (let i = 0; i < 7; i++) { const d = ymd(addDays(ws, i)); if (d >= todayStr() || !dayLocked(S.me, d)) if (!S.passes[S.me]?.req?.[d]) opts.push(d); }
  $("passDate").innerHTML = opts.map(d => `<option value="${d}">${esc(fmtDow(d))}${d === todayStr() ? " (today)" : ""}</option>`).join("");
  $("passReason").value = ""; validatePass(); $("passSheet").showModal();
}

function validatePass(){ const ok = $("passDate").value && $("passReason").value.trim().length >= 6; $("passSave").disabled = !ok; return ok; }

["passReason","passDate"].forEach(id => $(id).addEventListener("input", validatePass));

$("passCancel").onclick = () => $("passSheet").close();

$("passForm").addEventListener("submit", e => {
  e.preventDefault(); if (!validatePass()) return;
  const p = (S.passes[S.me] ||= {}); p.req ||= {}; p.req[$("passDate").value] = {reason: $("passReason").value.trim(), at: Date.now()};
  savePasses(); $("passSheet").close(); renderAll(); toast("Pass request sent. Voting closes in 24 hours.");
});

/* ---------- photos ---------- */

function previewFile(input, img){ const f = input.files && input.files[0]; if (f) { img.src = URL.createObjectURL(f); img.hidden = false; } else { img.hidden = true; img.removeAttribute("src"); } }

/* ---------- check-off sheet ---------- */

const sheet = $("sheet"); let editing = null, curArea = "physical", keepPhoto = null, curDay = todayStr();

$("areaSeg").innerHTML = AREAS.map(a => `<button type="button" style="--c:var(--${a.id})" data-a="${a.id}" aria-pressed="false">${a.name}</button>`).join("");

$("areaSeg").querySelectorAll("button").forEach(b => b.onclick = () => setArea(b.dataset.a));

function setArea(id, actId){
  curArea = id; const a = AREA[id];
  $("areaSeg").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.a === id)));
  $("fActivity").innerHTML = a.acts.map(x => `<option value="${x.id}">${esc(x.label)}</option>`).join("");
  $("fActivity").value = actId || a.acts[0].id;
  $("fDetailLabel").innerHTML = `${esc(a.detail)} <span style="font-weight:400;color:var(--muted)">(optional)</span>`;
  $("fDetail").type = a.num ? "number" : "text"; $("fDetail").inputMode = a.num ? "numeric" : "text";
  $("privField").hidden = !a.priv; if (!a.priv) $("fPriv").checked = false;
  setActivity();
}

function setActivity(){ $("otherField").hidden = $("fActivity").value !== "other"; validate(); }

$("fActivity").onchange = setActivity;

function validate(){
  const w = words($("fSummary").value); const sc = $("sumCount");
  sc.className = "count " + (w >= MIN_WORDS ? "ok" : "no"); sc.textContent = w >= MIN_WORDS ? "✓ Good" : `${MIN_WORDS - w} more word${MIN_WORDS-w===1?"":"s"}`;
  const ok = w >= MIN_WORDS && !($("fActivity").value === "other" && !$("fOther").value.trim()) && !dayLocked(S.me, curDay);
  $("saveBtn").disabled = !ok; return ok;
}

["fSummary","fOther"].forEach(id => $(id).addEventListener("input", validate));

$("fPhoto").addEventListener("change", () => { keepPhoto = null; previewFile($("fPhoto"), $("fPhotoPrev")); $("fPhotoClear").hidden = !$("fPhoto").files.length; });

$("fPhotoClear").onclick = () => { $("fPhoto").value = ""; keepPhoto = null; previewFile($("fPhoto"), $("fPhotoPrev")); $("fPhotoClear").hidden = true; };

function renderDayPick(){
  const days = editing ? [editing.date] : openDays();
  if (!days.includes(curDay)) curDay = days[0] || todayStr();
  $("dayPick").innerHTML = days.map(d => `<button type="button" class="chipbtn" aria-pressed="${d===curDay}" data-d="${d}">${d === todayStr() ? "Today" : "Yesterday"}</button>`).join("");
  $("dayPick").querySelectorAll("[data-d]").forEach(b => b.onclick = () => { curDay = b.dataset.d; renderDayPick(); validate(); });
  $("dayHelp").textContent = curDay === todayStr() ? "You have until the end of tomorrow to log today, unless the week closes first." : `Yesterday is open until ${fmtWhen(dayCloseTs(curDay))}.`;
}

function openSheet({area, date, entry} = {}){
  const days = openDays();
  if (!entry && !days.length) { toast("Today is locked."); return; }
  editing = entry ? {id: entry.id, date} : null;
  curDay = entry ? date : (date && days.includes(date) ? date : days[0]);
  $("sheetTitle").textContent = entry ? "Edit check-off" : "Check off";
  setArea(entry ? entry.area : (area || curArea), entry?.activity);
  $("fOther").value = entry?.other || ""; $("fSummary").value = entry?.summary || ""; $("fDetail").value = entry ? (entry.minutes || entry.detail || "") : "";
  $("fNew").checked = !!entry?.isNew; $("fPriv").checked = !!entry?.priv;
  $("fPhoto").value = ""; keepPhoto = entry?.photo || null; $("photoField").hidden = mode === "local";
  if (keepPhoto) { $("fPhotoPrev").src = photoURL(keepPhoto); $("fPhotoPrev").hidden = false; $("fPhotoClear").hidden = false; } else { $("fPhotoPrev").hidden = true; $("fPhotoClear").hidden = true; }
  renderDayPick(); validate(); $("saveBtn").textContent = entry ? "Save" : "Check off";
  sheet.showModal();
  // On a phone, focusing the text box pops the keyboard over the category picker, so only do it with a mouse.
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) setTimeout(() => $("fSummary").focus(), 50);
}

const closeSheet = () => { if (sheet.open) sheet.close(); };

$("cancelBtn").onclick = closeSheet;

sheet.addEventListener("click", e => { if (e.target === sheet) closeSheet(); });

$("logForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!validate()) return;
  const a = AREA[curArea]; const date = curDay; const L = myLogs();
  const doc = (L[date] ||= {date, entries:[]});
  const prev = editing ? doc.entries.find(x => x.id === editing.id) : null;
  const entry = {id: editing ? editing.id : uid(), area: curArea, activity: $("fActivity").value, summary: $("fSummary").value.trim(), createdAt: prev?.createdAt || Date.now()};
  if (entry.activity === "other") entry.other = $("fOther").value.trim();
  const det = $("fDetail").value.trim(); if (det) { if (a.num) { const m = parseInt(det, 10); if (m > 0) entry.minutes = Math.min(m, 1440); } else entry.detail = det.slice(0, 80); }
  if ($("fNew").checked) entry.isNew = true;
  if (a.priv && $("fPriv").checked) entry.priv = true;
  if (prev?.proof) entry.proof = prev.proof;
  const file = $("fPhoto").files && $("fPhoto").files[0];
  if (file) { $("saveBtn").disabled = true; $("saveBtn").textContent = "Uploading…"; const p = await uploadPhoto(file); if (p) entry.photo = p; } else if (keepPhoto) entry.photo = keepPhoto;
  doc.entries = editing ? doc.entries.map(x => x.id === entry.id ? entry : x) : [...doc.entries, entry];
  persistDay(date); const was = editing; closeSheet(); renderAll();
  const n = doc.entries.length;
  toast(was ? "Updated" : n > DAILY && !Array.isArray(doc.picks) ? `Checked off. That's ${n} today, only your first 2 count unless you pick.` : "Checked off. 1% better.");
});

/* ---------- proof ---------- */

let proofFor = null;

function openProof(date, id){ proofFor = {date, id}; $("pPhoto").value = ""; $("pNote").value = ""; previewFile($("pPhoto"), $("pPhotoPrev")); $("proofSave").disabled = true; $("proofSave").textContent = "Submit proof"; $("proofSheet").showModal(); }

$("pPhoto").addEventListener("change", () => { previewFile($("pPhoto"), $("pPhotoPrev")); $("proofSave").disabled = !$("pPhoto").files.length; });

$("proofCancel").onclick = () => $("proofSheet").close();

$("proofForm").addEventListener("submit", async e => {
  e.preventDefault(); const f = $("pPhoto").files[0]; if (!f || !proofFor) return;
  $("proofSave").disabled = true; $("proofSave").textContent = "Uploading…";
  const p = await uploadPhoto(f); if (!p) { $("proofSave").disabled = false; $("proofSave").textContent = "Submit proof"; return; }
  const ent = entriesOf(S.me, proofFor.date).find(x => x.id === proofFor.id);
  if (ent) { ent.proof = {photo: p, note: $("pNote").value.trim(), at: Date.now()}; persistDay(proofFor.date); }
  $("proofSheet").close(); renderAll(); toast("Proof posted. It counts again.");
});

/* ---------- pay-ups ---------- */

let shownTotal = 0, lastTotal = null;

function renderPot(){
  const host = $("potBody");
  if (mode === "local" || mode === "loading" || !S.settings) {
    $("jarAmt").textContent = "$0"; $("jarSub").textContent = mode === "local" ? "Groups need you signed in." : "Create a group on the Group tab first."; $("jarStats").innerHTML = "";
    host.innerHTML = mode === "local" ? `<section><div class="card"><h3>No group</h3><p>Open this page signed in to Claude.</p><div style="margin-top:10px"><button class="btn ghost" id="demoBtn3">See an example group</button></div></div></section>` : "";
    const b = $("demoBtn3"); if (b) b.onclick = startDemo; startJar(0); return;
  }
  const M = computeBlocks(); const cur = M.current; const c = cur ? costFor(cur.bs) : costFor(blockStart(new Date()));
  const rows = cur ? cur.parts.map(id => ({id, st: blockStatus(id, cur.bs)})) : [];
  const onLine = rows.filter(r => !r.st.met).reduce((s, r) => s + oweFor(c, r.st.missedCats), 0);
  const settled = M.transfers.reduce((s,t) => s + t.amount, 0);
  $("jarSub").textContent = cur ? `If the block ended now · ${costText(c)}` : "";
  $("jarStats").innerHTML = `<span><b>${money(settled)}</b>paid out so far</span><span><b>${rows.length}</b>in this block</span><span><b>${cur ? 14 - daysBetween(ymd(cur.bs), todayStr()) : 0}</b>days left</span>`;
  countTo(onLine); if (lastTotal !== null && onLine > lastTotal) jarBurst(10); lastTotal = onLine; startJar(onLine);
  let html = "";
  if (cur) {
    html += `<section><div class="sec-head"><h2>This block</h2><span class="eyebrow">${fmtShort(cur.bs)}–${fmtShort(cur.be)}</span></div><div class="card">`;
    html += rows.length ? rows.map(r => `<div class="mrow"><div><span class="who">${esc(nameOf(r.id))}</span> <span style="color:var(--muted);font-size:12.5px">· ${r.st.total} of ${r.st.goalTotal}${r.st.type === "pro" ? " · prorated" : ""}</span></div>
        <span class="badge ${r.st.met?"ok":"warn"}">${r.st.met ? "Goal hit" : c.cost ? `Owes ${money(oweFor(c, r.st.missedCats))} if it ends now` : "Clown if it ends now"}</span>
        <div class="mbars">${AREAS.map(a => `<i style="--c:var(--${a.id})" title="${a.name}: ${r.st.c[a.id]} of ${r.st.targets[a.id]}"><b style="width:${r.st.targets[a.id] ? Math.min(1, r.st.c[a.id]/r.st.targets[a.id])*100 : 100}%"></b></i>`).join("")}</div></div>`).join("")
      : `<p style="margin:0">Nobody is in this block yet.</p>`;
    html += `</div><p style="font-size:12.5px;color:var(--muted);margin:8px 2px 0">Goal: any 4 categories at least 3 times and the 5th at least twice, 14 check-offs. Missers split their payment among everyone who hit. If everyone misses, no money moves.</p></section>`;
  }
  const done = M.blocks.slice().reverse();
  html += `<section><div class="sec-head"><h2>Pay-ups</h2><span class="eyebrow">Every 2 weeks</span></div>`;
  html += done.length ? done.map(b => `<div class="card" style="margin-bottom:8px"><div class="spread"><h3>${fmtShort(b.bs)} – ${fmtShort(b.be)}</h3><span class="badge ${b.ready?"muted":"warn"}">${b.ready ? "Settled" : "Waiting"}</span></div>
      ${!b.ready ? `<p>${b.openCaps ? `${b.openCaps} capped check-off${b.openCaps===1?"":"s"} waiting on proof. ` : ""}${b.pendingPasses ? `${b.pendingPasses} pass vote${b.pendingPasses===1?"":"s"} still open. ` : ""}${!b.openCaps && !b.pendingPasses ? "Settles 24 hours after the block closes, once cap calls are done." : "Pay-ups wait for the results."}</p>`
        : !b.missers.length ? `<p>Everyone hit their goal. Nobody pays.</p>` : b.everyoneMissed || !b.hitters.length ? `<p>Everyone missed, so no money moves and everyone gets clowned.</p>` : !b.cost.cost ? `<p>${esc(listAnd(b.missers.map(m => nameOf(m.id))))} missed. Clowning only, no money.</p>`
        : `<div class="ledger" style="margin-top:6px">${b.transfers.map(t => { const paid = isPaid(t); return `<div class="lrow"><span><span class="who">${esc(nameOf(t.from))}</span> ${t.from===S.me?"pay":"pays"} <span class="who">${esc(nameOf(t.to))}</span></span>
            <span class="row"><span class="money">${money(t.amount)}</span>${t.to === S.me ? `<button class="chipbtn" aria-pressed="${paid}" data-got="${esc(t.key)}" ${canWrite||mode==="demo"?"":"disabled"}>${paid ? "Received ✓" : "Mark received"}</button>` : `<span class="badge ${paid?"ok":"muted"}">${paid?"Paid":"Not paid yet"}</span>`}</span></div>`; }).join("")}</div>`}
    </div>`).join("") : `<div class="empty">No finished blocks yet.</div>`;
  html += `<p style="font-size:12.5px;color:var(--muted);margin:8px 2px 0">The app keeps score. Pay over Venmo, and the person receiving marks it.</p></section>`;
  host.innerHTML = html;
  host.querySelectorAll("[data-got]").forEach(b => b.onclick = () => { const p = (S.paid[S.me] ||= {}); p.got ||= {}; if (p.got[b.dataset.got]) delete p.got[b.dataset.got]; else p.got[b.dataset.got] = true; savePaid(); renderAll(); });
}

function countTo(target){ const from = shownTotal; const t0 = performance.now(); const step = now => { const k = Math.min(1, (now-t0)/900); const e = 1 - Math.pow(1-k, 3); shownTotal = from + (target-from)*e; $("jarAmt").textContent = money(Math.round(shownTotal)); if (k < 1) requestAnimationFrame(step); else { shownTotal = target; $("jarAmt").textContent = money(target); } }; requestAnimationFrame(step); }

let jarRaf = 0, coins = [], pile = 0, jarTarget = 0;

function jarBurst(n){ for (let i = 0; i < n; i++) coins.push({x: Math.random(), y: -Math.random()*0.9, v: 0, r: .028 + Math.random()*.012, spin: Math.random()*6, settled:false}); }

function roundRect(ctx, x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x+r, y); ctx.arcTo(x+w, y, x+w, y+h, r); ctx.arcTo(x+w, y+h, x, y+h, r); ctx.arcTo(x, y+h, x, y, r); ctx.arcTo(x, y, x+w, y, r); ctx.closePath(); }

function startJar(total){
  const c = costFor(blockStart(new Date())); jarTarget = Math.min(1, total / Math.max(1, (c.cost || 10) * 6));
  if (jarRaf) return;
  const cv = $("jarCanvas"); const ctx = cv.getContext("2d"); const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frame = () => {
    const r = cv.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio||1);
    if (cv.width !== Math.round(r.width*dpr) || cv.height !== Math.round(r.height*dpr)) { cv.width = Math.round(r.width*dpr); cv.height = Math.round(r.height*dpr); }
    const w = cv.width, h = cv.height; ctx.clearRect(0,0,w,h);
    const gold = getComputedStyle(document.documentElement).getPropertyValue("--spiritual").trim() || "#E2B23C";
    const g = ctx.createRadialGradient(w*.78, h*.75, 0, w*.78, h*.75, h*.9); g.addColorStop(0, "rgba(226,178,60,.28)"); g.addColorStop(1, "transparent"); ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
    const jw = Math.min(w*.36, h*.5), jh = h*.56, jx = w - jw - w*.07, jy = h - jh - h*.12;
    pile += (jarTarget - pile) * (reduce ? 1 : .04); const fillH = jh * (.06 + .8*pile);
    ctx.save(); roundRect(ctx, jx, jy, jw, jh, jw*.18); ctx.clip();
    ctx.fillStyle = gold; ctx.globalAlpha = .9; ctx.fillRect(jx, jy + jh - fillH, jw, fillH);
    ctx.globalAlpha = .35; ctx.fillStyle = "#fff"; for (let yy = jy + jh - fillH + 6*dpr; yy < jy + jh; yy += 9*dpr) ctx.fillRect(jx, yy, jw, 1.2*dpr);
    ctx.restore(); ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 2.5*dpr; roundRect(ctx, jx, jy, jw, jh, jw*.18); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.25)"; roundRect(ctx, jx + jw*.12, jy - 10*dpr, jw*.76, 12*dpr, 5*dpr); ctx.fill();
    const surface = jy + jh - fillH;
    coins.forEach(c2 => { const tx = jx + jw*(.2 + .6*c2.x);
      if (!c2.settled) { c2.v += .0009 * h / 60 * (reduce ? 50 : 1); c2.y += c2.v / h * 60; c2.spin += .2; c2.px = c2.px ?? (w*.15 + c2.x*w*.4); c2.px += (tx - c2.px) * .05; if (c2.y*h >= surface - c2.r*h) c2.settled = true; }
      const cy = c2.y*h, cx = c2.px ?? tx, rr = c2.r*Math.min(w,h)*1.4;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(Math.max(.15, Math.abs(Math.cos(c2.spin))), 1); ctx.beginPath(); ctx.arc(0,0,rr,0,Math.PI*2); ctx.fillStyle = gold; ctx.fill(); ctx.lineWidth = 1.5*dpr; ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.stroke();
      ctx.fillStyle = "rgba(20,26,46,.6)"; ctx.font = `700 ${rr*1.1}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("$", 0, rr*.05); ctx.restore(); });
    coins = coins.filter(c2 => !c2.settled);
    if (!reduce && Math.random() < .012) jarBurst(1);
    jarRaf = requestAnimationFrame(frame);
  };
  jarRaf = requestAnimationFrame(frame);
}

function stopJar(){ cancelAnimationFrame(jarRaf); jarRaf = 0; }

/* ---------- wrapped ---------- */

let slides = [], slideIx = 0, storyYear = new Date().getFullYear();

$("yearSel").onchange = () => { storyYear = +$("yearSel").value; slideIx = 0; renderWrapped(); };

$("tapNext").onclick = () => go(1); $("tapPrev").onclick = () => go(-1);

document.addEventListener("keydown", e => { if ($("daySheet").open && !sheet.open) { if (e.key === "ArrowLeft") stepDay(-1); if (e.key === "ArrowRight") stepDay(1); return; } if (view !== "wrapped" || sheet.open) return; if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); });

function go(d){ slideIx = Math.max(0, Math.min(slides.length-1, slideIx + d)); drawSlide(); }

function yearStats(who, y){
  const es = Object.entries(S.logs[who] || {}).flatMap(([d, doc]) => doc.entries.map(e => ({...e, date:d}))).filter(e => e.date.startsWith(y+"-"));
  const cnt = (area, act) => es.filter(e => e.area === area && (!act || e.activity === act)).length;
  let weeks = 0, perfect = 0, run = 0, bestRun = 0, clowned = 0;
  const limit = new Date(Math.min(new Date(y,11,31), addDays(monday(new Date()), -1)));
  for (let w = monday(new Date(y,0,1)); w <= limit; w = addDays(w,7)) { const st = weekStatus(who, w); if (!st.req) continue; weeks++; if (st.met) { perfect++; run++; bestRun = Math.max(bestRun, run); } else { run = 0; if (st.missed) clowned++; } }
  const months = Array(12).fill(0); es.forEach(e => months[+e.date.slice(5,7)-1]++);
  const capsOnYou = es.filter(e => isMember(who) && capInfo(who, e.date, e).capped).length;
  const passesDenied = Object.keys(S.passes[who]?.req || {}).filter(d => d.startsWith(y+"-") && passInfo(who, d)?.status === "denied").length;
  let paid = 0, won = 0; computeBlocks().transfers.filter(t => t.bk.startsWith(y+"-")).forEach(t => { if (t.from === who) paid += t.amount; if (t.to === who) won += t.amount; });
  const buddies = {}; es.filter(e => e.area === "social" && e.detail).forEach(e => { const k = e.detail.trim(); buddies[k] = (buddies[k]||0)+1; });
  const topBuddy = Object.entries(buddies).sort((a,b) => b[1]-a[1])[0];
  const newPeople = es.filter(e => e.area === "social" && (e.isNew || e.activity === "newperson")).length;
  const yeses = es.filter(e => e.isNew); const bestYes = yeses.sort((a,b) => b.summary.length - a.summary.length)[0];
  return {es, cnt, weeks, perfect, bestRun, clowned, months, capsOnYou, passesDenied, paid, won, topBuddy, newPeople, yeses, bestYes,
    minutesMoved: es.filter(e => e.area === "physical").reduce((s,e) => s + (e.minutes||0), 0), silence: es.filter(e => e.area === "mental" && e.activity === "silence").reduce((s,e) => s + (e.minutes||0), 0),
    prayerDays: new Set(es.filter(e => e.activity === "prayer").map(e => e.date)).size};
}

function renderWrapped(){
  const years = new Set([new Date().getFullYear(), ...Object.keys(myLogs()).map(k => +k.slice(0,4))]); const ys = [...years].sort((a,b) => b-a);
  if (!years.has(storyYear)) storyYear = ys[0];
  $("yearSel").innerHTML = ys.map(y => `<option value="${y}" ${y===storyYear?"selected":""}>${y}</option>`).join("");
  const Y = yearStats(S.me, storyYear); const now = new Date(); const sofar = storyYear === now.getFullYear();
  $("storyNote").textContent = sofar ? `${storyYear} so far. The full story lands at year end.` : `Your full ${storyYear}.`;
  slides = [];
  if (!Y.es.length) slides.push({accent:"#9fb4ff", html:`<div class="kick">${storyYear} Wrapped</div><div class="h">Your year is still unwritten.</div><p>Check off your first thing and this is where it adds up.</p>`});
  else {
    const mIx = Y.months.indexOf(Math.max(...Y.months));
    slides.push({accent:"#ffd36b", html:`<div class="kick">Your year</div><div class="huge num">${Y.es.length}</div><div class="h">check-offs.</div><p>${Y.perfect} perfect week${Y.perfect===1?"":"s"}, a best run of ${Y.bestRun} goal${Y.bestRun===1?"":"s"} in a row, and ${new Date(2000,mIx,1).toLocaleDateString(undefined,{month:"long"})} was your best month.</p>`});
    const sorted = [...AREAS].sort((a,b) => Y.cnt(b.id) - Y.cnt(a.id)); const maxA = Y.cnt(sorted[0].id) || 1; const low = sorted.at(-1);
    slides.push({accent:`var(--${sorted[0].id})`, html:`<div class="kick">Your categories</div><div class="h">Strongest: ${esc(sorted[0].name)}. ${Y.cnt(low.id) < Y.cnt(sorted[0].id) ? `You and ${esc(low.name)} need to talk.` : ""}</div>
      <div class="abars">${AREAS.map(a => `<div class="abar" style="--c:var(--${a.id})"><span>${a.name}</span><span class="track"><i style="width:${Y.cnt(a.id)/maxA*100}%"></i></span><span class="v">${Y.cnt(a.id)}</span></div>`).join("")}</div>
      <p style="margin-top:10px">${Math.round(Y.minutesMoved/60)} hours moved · ${Y.silence} minutes in silence · ${Y.prayerDays} days in prayer</p>`});
    slides.push({accent:"var(--social)", html:`<div class="kick">Your people</div><div class="huge num">${Y.newPeople}</div><div class="h">new ${Y.newPeople===1?"person":"people"} met.</div><p>${Y.topBuddy ? `You spent the most time with ${esc(Y.topBuddy[0])} (${Y.topBuddy[1]} hangouts).` : "Add who you were with to see your top buddy."}</p>`});
    slides.push({accent:"#7ef0b8", html:`<div class="kick">Your yeses</div><div class="huge num">${Y.yeses.length}</div><div class="h">new thing${Y.yeses.length===1?"":"s"} tried.</div>${Y.bestYes ? `<div class="quote">“${esc(Y.bestYes.summary)}”</div>` : ""}`});
    if (isMember(S.me)) slides.push({accent:"#ff8a8a", html:`<div class="kick">Your shame</div><div class="h">🤡 ×${Y.clowned}</div><p>${Y.capsOnYou} cap${Y.capsOnYou===1?"":"s"} called on you, ${Y.passesDenied} pass${Y.passesDenied===1?"":"es"} denied, ${money(Y.paid)} paid${Y.won ? `, and ${money(Y.won)} collected` : ""}.</p>`});
    const used = Y.months.map((v,i) => [v,i]).filter(([v]) => v > 0);
    if (used.length > 1) { const [f, fi] = used[0], [l, li] = used.at(-1); slides.push({accent:"#ffb38a", html:`<div class="kick">Your growth</div><div class="h">${new Date(2000,fi,1).toLocaleDateString(undefined,{month:"long"})}: ${f} → ${new Date(2000,li,1).toLocaleDateString(undefined,{month:"long"})}: ${l}</div><p>${l >= f ? "You finished stronger than you started." : "The start was strong. Bring that energy back."}</p>`}); }
    if (memberIds().length > 1) {
      const st = memberIds().map(id => ({id, y: yearStats(id, storyYear)}));
      const most = st.slice().sort((a,b) => b.y.perfect - a.y.perfect)[0], clown = st.slice().sort((a,b) => b.y.clowned - a.y.clowned)[0], earner = st.slice().sort((a,b) => b.y.won - a.y.won)[0];
      slides.push({accent:"#ffd36b", html:`<div class="kick">Group awards</div><div class="chips" style="flex-direction:column;align-items:flex-start;gap:8px"><span>🏆 Most Consistent: ${esc(nameOf(most.id))} (${most.y.perfect} perfect weeks)</span><span>🤡 Head Clown: ${esc(nameOf(clown.id))} (${clown.y.clowned})</span><span>💰 Biggest Earner: ${esc(nameOf(earner.id))} (${money(earner.y.won)})</span></div>`});
    }
    const q = Y.es.filter(e => !e.priv && words(e.summary) >= 6).sort((a,b) => b.summary.length - a.summary.length)[0];
    if (q) slides.push({accent:`var(--${q.area})`, html:`<div class="kick">Your best note</div><div class="quote">“${esc(q.summary)}”</div><p>${esc(fmtLong(q.date))}</p>`});
  }
  slideIx = Math.min(slideIx, slides.length-1); drawSlide(); startStoryAnim();
}

function drawSlide(){ const s = slides[slideIx]; $("storyBars").innerHTML = slides.map((_,i) => `<i class="${i<=slideIx?"on":""}"></i>`).join(""); $("slideHost").innerHTML = `<div class="slide" style="--wrap-accent:${s.accent}">${s.html}</div>`; $("storyPos").textContent = `${slideIx+1} / ${slides.length}`; storyAccent = s.accent; }

let raf = 0, storyAccent = "#9fb4ff";

function resolveColor(c){ if (!c.startsWith("var(")) return c; return getComputedStyle(document.documentElement).getPropertyValue(c.slice(4,-1)).trim() || "#9fb4ff"; }

function startStoryAnim(){
  cancelAnimationFrame(raf); const cv = $("storyBg"); const ctx = cv.getContext("2d"); const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frame = t => { const r = cv.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio||1); if (cv.width !== Math.round(r.width*dpr)) { cv.width = Math.round(r.width*dpr); cv.height = Math.round(r.height*dpr); }
    const w = cv.width, h = cv.height; ctx.clearRect(0,0,w,h); const col = resolveColor(storyAccent);
    [[.2,.25,.55],[.85,.7,.6],[.55,1.05,.5]].forEach(([x,y,s],i) => { const k = reduce ? 0 : t/1000; const cx = (x + Math.sin(k*.25+i*2)*.08)*w, cy = (y + Math.cos(k*.2+i)*.06)*h, rad = s*Math.max(w,h); const g = ctx.createRadialGradient(cx,cy,0,cx,cy,rad); g.addColorStop(0, col); g.addColorStop(1, "transparent"); ctx.globalAlpha = i===0 ? .38 : .22; ctx.fillStyle = g; ctx.fillRect(0,0,w,h); });
    ctx.globalAlpha = 1; if (!reduce) raf = requestAnimationFrame(frame); };
  raf = requestAnimationFrame(frame);
}

function stopStoryAnim(){ cancelAnimationFrame(raf); }

/* ---------- example group (never saved) ---------- */

function makeDemo(){
  let seed = 11; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647; const pick = a => a[Math.floor(rnd()*a.length)];
  const T = {gym:"Push day, bench and dips, felt strong today.", sports:"Pickup basketball for an hour with the guys.", eat:"Cooked chicken and rice instead of takeout.", sleep:"In bed by 10:45, phone stayed in the kitchen.",
    silence:"Fifteen minutes with no phone, noticed how restless I was.", mreflect:"Journaled about why work stress follows me home.", realconvo:"Talked about fear of failure and what success means.",
    reflect:"Thought about where I'm impatient with family.", bible:"Read slowly and the part about rest stuck with me.", prayer:"Prayed for my parents and for patience.", space:"Walked with no music and just listened.",
    hangout:"Got tacos and talked about his new job.", newperson:"Met someone at church, talked photography and coffee.", reading:"Thirty pages and underlined the part on identity.", creative:"Sketched for twenty minutes.",
    buildskill:"Practiced Spanish on the train for half an hour.", project:"Built the login screen for my side project.", instrument:"Guitar chord changes G to C.", writing:"Wrote 500 words about my grandfather.", painting:"Started a small watercolor.", photo:"Shot golden hour downtown."};
  const people = ["Maya","Jordan","Priya","Luis","Hannah","Daniel","Grace","Noah"];
  const D = blank(); D.me = "me"; D.names = {d1:"Jordan (example)", d2:"Priya (example)", d3:"Sam (example)", d4:"Luis (example)"};
  const now = new Date(); const bs = blockStart(now); const startDay = addDays(bs, -14*5);
  D.settings = {name:"Example group", history:[{cost:20, mode:"flat", from: ymd(startDay), at: startDay.getTime()}, {cost:10, mode:"per", from: ymd(bs), at: Date.now() - 20*864e5}]};
  const crew = [["me",.95,2],["d1",.97,2],["d2",.7,1],["d3",.88,2]];
  crew.forEach(([id, rate, perDay], ci) => {
    D.members[id] = {joinedAt: startDay.getTime() - (5-ci)*3600e3, joinDay: ymd(addDays(startDay, -1))};
    const L = D.logs[id] = {};
    for (let d = new Date(startDay); d <= now; d = addDays(d, 1)) {
      if (rnd() > rate) continue; const k = ymd(d); const n = perDay + (rnd() < .25 ? 1 : 0); const entries = [];
      for (let i = 0; i < n; i++) { const a = pick(AREAS); const act = pick(a.acts.filter(x => x.id !== "other"));
        const e = {id:`${id}${k}${i}`, area:a.id, activity:act.id, summary:T[act.id], createdAt: d.getTime() + (9+i*3)*3600e3};
        if (a.num) e.minutes = 15 + Math.floor(rnd()*60); else if (a.id === "social") e.detail = pick(people); else if (a.id === "spiritual" && act.id === "bible") e.detail = pick(["Psalm 23","Romans 8","John 15"]);
        if (rnd() < .12) e.isNew = true; if (a.priv && rnd() < .3) e.priv = true;
        entries.push(e); }
      L[k] = {date:k, entries, locked: k < ymd(addDays(now,-1))};
    }
  });
  // late joiner this block
  const jd = ymd(addDays(bs, 3)); if (jd < todayStr()) { D.members.d4 = {joinedAt: parse(jd).getTime() + 15*3600e3, joinDay: jd}; D.logs.d4 = {}; for (let d = addDays(parse(jd),1); d <= now; d = addDays(d,1)) { const k = ymd(d); const a = pick(AREAS); D.logs.d4[k] = {date:k, entries:[{id:`d4${k}`, area:a.id, activity:a.acts[0].id, summary:T[a.acts[0].id], createdAt: d.getTime()+10*3600e3}]}; } }
  const t = todayStr(); const hr = 3600e3;
  // a cap in progress and a pass up for a vote
  const recent = id => Object.keys(D.logs[id]).filter(k => k <= t).sort().at(-1);
  const pd = recent("d2"); const pe = pd && D.logs.d2[pd].entries.find(e => !actOf(e.area, e.activity).nocap);
  if (pe) { pe.createdAt = Date.now() - 6*hr; D.votes.d1 = {cap:{[key3("d2", pd, pe.id)]: Date.now() - 2*hr}}; D.votes.d3 = {cap:{[key3("d2", pd, pe.id)]: Date.now() - hr}}; }
  D.passes.d3 = {req:{[t]:{reason:"Flying to Denver for my cousin's wedding, traveling all day.", at: Date.now() - 3*hr}}};
  D.votes.d1 = {...(D.votes.d1||{}), pass:{[`d3|${t}`]:"yes"}};
  const md = recent("me"); if (md) { const e0 = D.logs.me[md].entries[0]; const k = key3("me", md, e0.id); D.votes.d1 = {...D.votes.d1, react:{[k]:"💪"}, cmt:{[k]:[{text:"Let's go!", at: Date.now()-hr}]}}; D.votes.d2 = {react:{[k]:"🔥"}}; }
  const lw = ymd(addDays(monday(now), -7)); D.votes.d1.roast = {[`d2|${lw}`]:[{text:"Priya said she'd start Monday. Which Monday?", at: Date.now()-30*hr}]};
  (D.votes.d3 ||= {}).nudge = {[`d2|${ymd(monday(now))}`]: Date.now() - 2*hr};
  return D;
}

/* ---------- boot ---------- */

try { const v = localStorage.getItem("opb.trial.view"); if (v && VIEWS.includes(v)) view = v; } catch {}

connectUI({toast, showBanner, hideBanner, changed: queueRender});
S.me = "loading"; S.logs.loading = {};

setView(view);

initStore();
