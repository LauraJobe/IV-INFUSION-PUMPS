/* UI wiring: renders the pump, bedside panel, scenario coach, library. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const setHTML = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; } };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  let speed = 1;
  let scn = null;   // current scenario definition
  let X = null;     // scenario runtime state
  let hintsShown = 0;

  // ------------------------------------------------------------ tabs
  $$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.id.replace("tab-", ""))));
  function showTab(name) {
    $$(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.id === "tab-" + name)));
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
    store.set("ivp-tab", name);
  }
  const hashTab = location.hash.replace("#", "");
  showTab(["practice", "library", "basics"].includes(hashTab) ? hashTab : store.get("ivp-tab") || "practice");

  // ------------------------------------------------------------ pump keys
  $$(".sk").forEach((b) => b.addEventListener("click", () => { audioUnlock(); Pump.softKey(b.dataset.side, +b.dataset.i); }));
  $$(".key[data-key]").forEach((b) => b.addEventListener("click", () => { audioUnlock(); Pump.key(b.dataset.key); }));
  $("#powerKey").addEventListener("click", () => {
    audioUnlock();
    Pump.systemOn();
    if (Pump.state.screen.id === "boot" && soundBox.checked) { beep(523, 0.14, 0.3); beep(659, 0.14, 0.5); beep(784, 0.22, 0.7); }
  });
  $("#lcd").addEventListener("click", (e) => {
    const l = e.target.closest("[data-side]");
    if (l) Pump.softKey(l.dataset.side, +l.dataset.i);
  });
  document.addEventListener("keydown", (e) => {
    if ($("#view-practice").hidden || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (/^[0-9.]$/.test(e.key)) Pump.key(e.key);
    else if (e.key === "Enter" && !/BUTTON/.test(document.activeElement.tagName)) Pump.key("ENTER");
    else if (e.key === "Backspace" || e.key === "Escape") Pump.key("CLEAR");
  });

  CHANNEL_IDS.forEach((id) => {
    const m = $("#mod" + id);
    m.innerHTML = `
      <div class="mod-top"><span class="mod-letter">${id}</span><span class="mod-name">PUMP<br>MODULE</span></div>
      <div class="mod-disp dim" aria-live="polite"></div>
      <div class="mod-status"><span><i class="led red"></i>ALARM</span><span><i class="led green"></i>INFUSING</span></div>
      <button class="mbtn select" data-mk="SELECT">CHANNEL<br>SELECT</button>
      <div class="mod-btns">
        <button class="mbtn pause" data-mk="PAUSE">PAUSE</button>
        <button class="mbtn restart" data-mk="RESTART">RESTART</button>
        <button class="mbtn off" data-mk="OFF">CHANNEL OFF</button>
      </div>
      <div class="mod-door">
        <svg viewBox="0 0 100 150" aria-hidden="true">
          <rect x="44" y="0" width="12" height="150" rx="4" fill="#f2f6f5" stroke="#8d9795" class="tube"></rect>
          <rect x="30" y="52" width="40" height="46" rx="5" fill="#b4bdbb" stroke="#8d9795"></rect>
          <g class="drops"><circle class="drop" cx="50" cy="18" r="3"></circle><circle class="drop" cx="50" cy="104" r="3" style="animation-delay:.6s"></circle></g>
        </svg>
        <div class="door-state"></div>
      </div>`;
    $$("[data-mk]", m).forEach((b) => b.addEventListener("click", () => { audioUnlock(); Pump.moduleKey(id, b.dataset.mk); }));
  });

  // ------------------------------------------------------------ speed
  $$("#speedSeg button").forEach((b) => b.addEventListener("click", () => {
    speed = +b.dataset.speed;
    $$("#speedSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));

  // ------------------------------------------------------------ audio
  let actx = null;
  function audioUnlock() {
    if (actx) return;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  }
  function beep(freq, dur, when = 0) {
    if (!actx) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = "square"; o.frequency.value = freq;
    g.gain.value = 0.04;
    o.connect(g); g.connect(actx.destination);
    const t = actx.currentTime + when;
    o.start(t); o.stop(t + dur);
  }
  const soundBox = $("#soundToggle");
  soundBox.checked = store.get("ivp-sound") !== "off";
  soundBox.addEventListener("change", () => store.set("ivp-sound", soundBox.checked ? "on" : "off"));
  let lastBeep = 0;
  function alarmAudio(S) {
    if (!soundBox.checked || !S.on || Date.now() < S.silencedUntil) return;
    const alarms = CHANNEL_IDS.map((id) => S.channels[id].alarm).filter(Boolean);
    if (!alarms.length) return;
    const high = alarms.some((a) => a.level === "high");
    const gap = high ? 1500 : 5000;
    if (Date.now() - lastBeep < gap) return;
    lastBeep = Date.now();
    if (high) { beep(880, 0.12); beep(880, 0.12, 0.2); beep(660, 0.18, 0.4); } else beep(660, 0.15);
  }

  // ------------------------------------------------------------ render pump
  const BOOT_HTML = `<div class="boot">
    <div class="logo"><div class="drop"></div><div class="name">PC UNIT<small>Point-of-Care Unit · Practice</small></div></div>
    <div class="bar"><i></i></div>
    <ul>
      <li style="animation-delay:1.2s">Self test in progress<b>…</b></li>
      <li style="animation-delay:1.8s">Keypad and display<b>OK</b></li>
      <li style="animation-delay:2.4s">Audio<b>OK</b></li>
      <li style="animation-delay:3.0s">Pump module A (left)<b>OK</b></li>
      <li style="animation-delay:3.5s">Pump module B (right)<b>OK</b></li>
      <li style="animation-delay:4.2s">Data set: ${HOSPITAL}<b>v1.0</b></li>
    </ul></div>`;

  function renderLCD(S) {
    const spec = Pump.render();
    const lcd = $("#lcd");
    $("#powerKey").classList.toggle("pulse", !S.on);
    lcd.className = "lcd" + (!S.on || spec.off ? " off" : "") + (spec.alert ? " alert-" + spec.alert : "");
    if (!S.on || spec.off) { setHTML(lcd, ""); return; }
    if (spec.boot) { setHTML(lcd, BOOT_HTML); return; }

    const alarmCh = CHANNEL_IDS.map((id) => S.channels[id]).find((c) => c.alarm);
    const hdr = alarmCh
      ? `<div class="lcd-hdr alarm"><span class="badge">${alarmCh.id}</span><span class="t"><span class="t1">${alarmCh.alarm.msg}</span><span class="t2">${Date.now() < S.silencedUntil ? "Silenced" : "Press SILENCE"} · ${spec.title}</span></span></div>`
      : `<div class="lcd-hdr">${spec.badge ? `<span class="badge">${spec.badge}</span>` : ""}<span class="t"><span class="t1">${spec.title || ""}</span><span class="t2">${spec.sub || ""}</span></span>${S.patientId && !spec.badge ? `<span class="wt">ID ${S.patientId}</span>` : ""}</div>`;

    const lbl = (side, arr) => arr.map((k, i) => {
      if (!k) return "";
      const row = i + 2;
      const cls = `lcd-lbl ${side}${k.active ? " active" : ""}${k.inert ? " inert" : ""}${k.small ? " small" : ""}`;
      const inner = k.box || k.small ? `<span class="box">${k.label}</span>` : k.label;
      return `<div class="${cls}" ${k.inert ? "" : `data-side="${side}" data-i="${i}"`} style="grid-row:${row}">${inner}</div>`;
    }).join("");
    const hasL = spec.left.some(Boolean), hasR = spec.right.some(Boolean);

    let middle = "";
    if (spec.rows) {
      middle = spec.rows.map((html, i) => html ? `<div class="lcd-row" style="grid-row:${i + 2}">${html}</div>` : "").join("");
    } else if (spec.text) {
      middle = `<div class="lcd-text" style="grid-row:2 / 7;grid-column:${hasL ? 2 : 1} / ${hasR ? 3 : 4}">${spec.text}</div>`;
    }
    const prompt = S.flash
      ? `<div class="lcd-prompt${S.flash.kind === "warn" ? " warn" : ""}">${S.flash.text}</div>`
      : `<div class="lcd-prompt">${spec.prompt || ""}</div>`;
    const bar = `<div class="lcd-bar">${spec.bottom.map((k, i) => k
      ? `<div class="${k.disabled ? "disabled" : ""}" data-side="B" data-i="${i}"><span>${k.label}</span></div>`
      : `<div class="empty"></div>`).join("")}</div>`;
    setHTML(lcd, hdr + lbl("L", spec.left) + middle + lbl("R", spec.right) + prompt + bar);
  }

  function renderModules(S) {
    CHANNEL_IDS.forEach((id) => {
      const ch = S.channels[id], m = $("#mod" + id), disp = $(".mod-disp", m);
      const [r, g] = $$(".led", m);
      const running = S.on && (ch.state === "running" || ch.state === "kvo");
      g.classList.toggle("on", running && !(ch.alarm && ch.alarm.level === "high"));
      r.classList.toggle("on", S.on && !!ch.alarm && ch.alarm.level === "high");
      $(".mod-letter", m).classList.toggle("sel", !!(S.screen && ((S.screen.ch === id) || (S.screen.draft && S.screen.draft.ch === id))));
      let cls = "mod-disp", html = "";
      if (!S.on) { cls += " dim"; html = ""; }
      else if (S.screen.id === "boot") { html = "SELF TEST"; }
      else if (!ch.primary) { cls += " dim"; html = "CHANNEL<br>AVAILABLE"; }
      else {
        const p = ch.onSecondary && ch.secondary ? ch.secondary : ch.primary;
        const rate = Pump.currentRate(ch);
        const name = p.mode === "basic" ? "BASIC INFUSION" : p.drug.name.toUpperCase();
        const flag = p.overrides && p.overrides.length ? (p.overrides.some((o) => o.dir === "max") ? " \u2191\u2191\u2191" : " LLL") : "";
        const dose = Pump.hasDose(p) ? ` ${fmtNum(p.dose, 2)} ${Pump.doseUnit(p)}` : "";
        const scroll = `<span class="scroll">${ch.onSecondary ? "SECONDARY " : ""}${name}${dose}${flag}</span>`;
        if (ch.alarm && ch.alarm.level === "high") { cls += " red"; html = ch.alarm.msg; }
        else if (ch.state === "paused") { cls += " amber"; html = `${scroll}<br><span class="big">PAUSED</span>`; }
        else if (ch.state === "kvo") { cls += " amber"; html = `${scroll}<br><span class="big">KVO ${fmtNum(rate, 1)}</span>`; }
        else {
          if (ch.alarm) cls += " amber";
          html = `${scroll}<br><span class="big">${fmtNum(rate, 1)} mL/h</span>`;
        }
      }
      disp.className = cls;
      setHTML(disp, html);
      const door = $(".mod-door", m), ds = $(".door-state", m);
      const b = ch.bedside;
      door.classList.toggle("dripping", running && b.loaded);
      door.style.setProperty("--drip", `${Math.max(0.25, Math.min(3, 60 / Math.max(1, Pump.currentRate(ch))))}s`);
      $(".tube", m).setAttribute("fill", b.loaded ? (b.primed ? "#e3f1f7" : "#fbe3df") : "none");
      ds.textContent = b.loaded ? "SET LOADED" : "DOOR OPEN";
      ds.className = "door-state" + (b.loaded ? "" : " open");
    });
    const led = $("#pcuLed");
    led.className = "led" + (S.on ? (CHANNEL_IDS.some((id) => S.channels[id].alarm && S.channels[id].alarm.level === "high") ? " alarm" : " on") : "");
  }

  // ------------------------------------------------------------ bedside
  function bagsFor(secondary) {
    const list = scn && scn.bags && scn.bags.length ? scn.bags : SCENARIOS[0].bags;
    return list.map((b, i) => ({ b, i })).filter(({ b }) => !!b.secondary === secondary);
  }

  function renderBedside(S) {
    const html = CHANNEL_IDS.map((id) => {
      const ch = S.channels[id], b = ch.bedside;
      const pct = (v, cap) => Math.max(0, Math.min(100, (v / cap) * 100));
      const pCap = Math.max(b.primaryBag, bagCap(b.primaryBagName, 1000));
      const isBlood = /PRBC|blood/i.test(b.primaryBagName);
      const prim = b.primed || b.primaryBag
        ? `<div class="bag${isBlood ? " blood" : ""}"><div class="shape"><div class="fill" style="height:${pct(b.primaryBag, pCap)}%"></div></div>${fmtNum(b.primaryBag, 0)} mL</div>`
        : `<div class="bag"><div class="shape"></div>no bag</div>`;
      const sec = b.secondaryHung
        ? `<div class="bag sec"><div class="shape"><div class="fill" style="height:${pct(b.secondaryBag, bagCap(b.secondaryBagName, 100))}%"></div></div>${fmtNum(b.secondaryBag, 0)} mL</div>` : "";
      const chip = (on, okTxt, noTxt, bad) => `<span class="chip ${on ? "ok" : bad ? "bad" : ""}">${on ? okTxt : noTxt}</span>`;
      const problems = [];
      if (b.occluded) problems.push(`<span class="chip bad">Line kinked / arm bent</span>`);
      if (b.air) problems.push(`<span class="chip bad">Air in tubing</span>`);
      const primOpts = bagsFor(false).map(({ b: bg, i }) => `<option value="${i}">${bg.name}</option>`).join("");
      const secOpts = bagsFor(true).map(({ b: bg, i }) => `<option value="${i}">${bg.name}</option>`).join("");
      return `<div class="bs-ch">
        <h4>Channel ${id}</h4>
        <div class="bags">${sec}${prim}<div class="bag-meta">${b.primaryBagName ? `<b>${b.primaryBagName}</b>` : "No primary bag hung"}${b.secondaryHung ? `<br>Secondary: <b>${b.secondaryBagName}</b>` : ""}</div></div>
        <div class="chips">
          ${chip(b.primed, "Primed", "Not primed")}${chip(b.loaded, "Set loaded", "Door open")}
          ${chip(b.clampOpen, "Roller clamp open", "Roller clamp closed")}${chip(b.traced, "Line traced", "Not traced")}
          ${b.secondaryHung ? chip(b.secondaryClampOpen, "Sec clamp open", "Sec clamp closed", true) : ""}
          ${problems.join("")}
        </div>
        <div class="bag-pick">${primOpts ? `<select id="bagSel${id}" aria-label="Primary bag for channel ${id}">${primOpts}</select><button class="act" data-bs="prime" data-ch="${id}">Spike &amp; prime</button>` : ""}</div>
        <div class="acts">
          <button class="act" data-bs="${b.loaded ? "unload" : "load"}" data-ch="${id}">${b.loaded ? "Open door" : "Load set / close door"}</button>
          <button class="act" data-bs="clamp" data-ch="${id}">${b.clampOpen ? "Close" : "Open"} roller clamp</button>
          <button class="act" data-bs="trace" data-ch="${id}">Trace line</button>
          <button class="act${b.occluded ? " prob" : ""}" data-bs="fixOcclusion" data-ch="${id}">Check site / straighten line</button>
          <button class="act${b.air ? " prob" : ""}" data-bs="clearAir" data-ch="${id}">Clear air from line</button>
        </div>
        ${secOpts ? `<div class="bag-pick" style="margin-top:8px"><select id="secSel${id}" aria-label="Secondary bag for channel ${id}">${secOpts}</select><button class="act" data-bs="hangSecondary" data-ch="${id}">Hang secondary above primary</button></div>
        ${b.secondaryHung ? `<div class="acts"><button class="act" data-bs="secClamp" data-ch="${id}">${b.secondaryClampOpen ? "Close" : "Open"} secondary clamp</button></div>` : ""}` : ""}
      </div>`;
    }).join("");
    const box = $("#bedside");
    const keep = CHANNEL_IDS.map((id) => [$("#bagSel" + id, box), $("#secSel" + id, box)].map((s) => (s ? s.value : null)));
    setHTML(box, html);
    CHANNEL_IDS.forEach((id, i) => {
      const [p, s] = keep[i];
      if (p != null && $("#bagSel" + id)) $("#bagSel" + id).value = p;
      if (s != null && $("#secSel" + id)) $("#secSel" + id).value = s;
    });
  }

  function bagCap(name, dflt) {
    const all = (scn && scn.bags) || [];
    const m = all.find((b) => b.name === name);
    return m ? m.vol : dflt;
  }

  $("#bedside").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bs]");
    if (!btn) return;
    const id = btn.dataset.ch, act = btn.dataset.bs;
    const list = scn && scn.bags && scn.bags.length ? scn.bags : SCENARIOS[0].bags;
    let arg;
    if (act === "prime") { const sel = $("#bagSel" + id); arg = list[+sel.value]; arg = { name: arg.name, vol: arg.vol }; }
    if (act === "hangSecondary") { const sel = $("#secSel" + id); arg = list[+sel.value]; arg = { name: arg.name, vol: arg.vol }; }
    Pump.bedside(id, act, arg);
  });

  // ------------------------------------------------------------ scenarios
  const sel = $("#scenarioSelect");
  const levels = [...new Set(SCENARIOS.map((s) => s.level))];
  sel.innerHTML = levels.map((lv) => `<optgroup label="${lv}">${SCENARIOS.filter((s) => s.level === lv).map((s) => `<option value="${s.id}">${s.title}</option>`).join("")}</optgroup>`).join("");
  sel.addEventListener("change", () => loadScenario(sel.value));
  $("#restartBtn").addEventListener("click", () => loadScenario(sel.value));

  function loadScenario(id) {
    scn = SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
    sel.value = scn.id;
    X = { phase: 0, decisions: {}, met: {}, miss: {}, showDebrief: false };
    hintsShown = 0;
    scn.setup(Pump);
    store.set("ivp-scn", scn.id);
    $("#scenarioSummary").textContent = scn.summary || "";
    $("#decisions")._h = null;
    renderCoach(Pump.state);
  }

  function renderCoach(S) {
    const p = scn.patient;
    setHTML($("#patientBand"), p ? `<dl class="band">
        <div class="name">${p.name}</div>
        <dt>Patient ID</dt><dd class="mrn">${p.mrn || "—"}</dd>
        <dt>Age</dt><dd>${p.age}</dd><dt>Weight</dt><dd>${p.weight}</dd>
        <dt>Allergies</dt><dd>${p.allergies}</dd><dt>Dx</dt><dd>${p.dx}</dd><dt>Unit</dt><dd>${p.unit}</dd>
        <div class="src">From: ${p.source}</div></dl>` : "");
    setHTML($("#orders"), `<h3>${p ? "Provider orders" : "Instructions"}</h3>${scn.order(S, X)}`);
    const v = scn.vitals ? scn.vitals(S, X) : null;
    setHTML($("#vitals"), v ? Object.entries(v).map(([k, val]) => `<div class="vital"><div class="k">${k}</div><div class="v">${val}</div></div>`).join("") : "");

    const dec = (scn.decisions || []).filter((d) => X.decisions[d.id] || d.when(S, X)).map((d) => {
      const chosen = X.decisions[d.id];
      if (chosen) {
        const o = d.options.find((x) => x.id === chosen);
        return `<div class="decision done"><p>${d.prompt}</p><div>You chose: <b>${o.label}</b></div><div class="fb ${o.correct ? "good" : "bad"}">${o.feedback}</div>${o.correct ? "" : `<button class="btn-plain" data-retry="${d.id}" style="margin-top:6px">Try again</button>`}</div>`;
      }
      return `<div class="decision"><p>${d.prompt}</p><div class="opts">${d.options.map((o) => `<button data-dec="${d.id}" data-opt="${o.id}">${o.label}</button>`).join("")}</div></div>`;
    }).join("");
    setHTML($("#decisions"), dec);

    const goals = scn.goals || [];
    goals.forEach((g, i) => {
      if (!X.met[i] && g.check(S, X)) X.met[i] = true;
      if (!X.met[i] && g.negative && g.negative(S, X)) X.miss[i] = true;
    });
    const metCount = goals.filter((g, i) => X.met[i]).length;
    const hints = scn.hints || [];
    const goalHTML = goals.length ? `<h3>Your checklist · ${metCount}/${goals.length}</h3><div class="progress"><i style="width:${(metCount / goals.length) * 100}%"></i></div>
      <ol>${goals.map((g, i) => `<li class="${X.met[i] ? "met" : X.miss[i] ? "miss" : ""}"><span class="mark">${X.met[i] ? "✓" : X.miss[i] ? "✕" : ""}</span><span>${g.text}${X.miss[i] && !X.met[i] ? ` <em>(an error was recorded, try again)</em>` : ""}</span></li>`).join("")}</ol>` : `<h3>Free practice</h3><p style="margin:0;font-size:14px">No checklist. Watch the event history below to see what the pump recorded.</p>`;
    const hintHTML = hints.length ? `<div style="margin-top:12px"><button class="btn-plain" id="hintBtn" ${hintsShown >= hints.length ? "disabled" : ""}>${hintsShown ? "Next hint" : "Show a hint"} (${hintsShown}/${hints.length})</button>${hintsShown ? `<ol class="hintlist">${hints.slice(0, hintsShown).map((h) => `<li>${h}</li>`).join("")}</ol>` : ""}</div>` : "";
    setHTML($("#goals"), goalHTML + hintHTML);

    const done = goals.length && metCount === goals.length;
    const deb = scn.debrief ? (done || X.showDebrief
      ? `<div class="${done ? "complete" : "panel"}">${done ? `<p style="margin:0 0 6px"><strong>Scenario complete.</strong> Every checklist item met.</p>` : `<h3>Debrief</h3>`}<div class="debrief">${scn.debrief}</div></div>`
      : `<button class="btn-plain" id="debriefBtn">Show debrief</button>`) : "";
    setHTML($("#debrief"), deb);

    const hist = S.log.slice(-40).reverse().map((e) => `<li><span>${fmtClock(e.t)}</span>${describe(e)}</li>`).join("");
    setHTML($("#historyList"), hist || "<li>No events yet.</li>");
  }

  $("#coach").addEventListener("click", (e) => {
    const d = e.target.closest("[data-dec]");
    if (d) { X.decisions[d.dataset.dec] = d.dataset.opt; Pump.log("decision", { id: d.dataset.dec, opt: d.dataset.opt }); renderCoach(Pump.state); return; }
    const r = e.target.closest("[data-retry]");
    if (r) { delete X.decisions[r.dataset.retry]; renderCoach(Pump.state); return; }
    if (e.target.id === "hintBtn") { hintsShown++; renderCoach(Pump.state); }
    if (e.target.id === "debriefBtn") { X.showDebrief = true; renderCoach(Pump.state); }
  });

  function fmtClock(t) {
    const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
  }

  function describe(e) {
    const dn = (id) => (DRUGS[id] ? DRUGS[id].name : id || "");
    switch (e.type) {
      case "powerOn": return "System on";
      case "powerOff": return "System off";
      case "newPatient": return `New patient: ${e.yes ? "Yes" : "No"}`;
      case "profile": return `Profile: ${PROFILES[e.profile].name}`;
      case "weight": return `Weight entered: ${e.kg} kg`;
      case "select": return `Channel ${e.ch} selected`;
      case "drugSelected": return `Ch ${e.ch}: ${dn(e.drugId)} ${e.conc}${e.secondary ? " (secondary)" : ""}`;
      case "basicSelected": return `Ch ${e.ch}: BASIC INFUSION selected (no limits)`;
      case "softLimit": return `Ch ${e.ch}: soft ${e.dir} alert (${e.val} vs ${e.limit})`;
      case "hardLimit": return `Ch ${e.ch}: HARD ${e.dir} limit (${e.val} vs ${e.limit})`;
      case "override": return `Ch ${e.ch}: soft limit OVERRIDDEN`;
      case "start": return `Ch ${e.ch}: START ${e.mode === "basic" ? "Basic" : dn(e.drugId)} ${e.dose != null ? e.dose + " / " : ""}${e.rate} mL/h, VTBI ${e.vtbi}${e.traced ? "" : " (line not traced)"}`;
      case "startSecondary": return `Ch ${e.ch}: SECONDARY ${e.mode === "basic" ? "Basic" : dn(e.drugId)} ${e.rate} mL/h, VTBI ${e.vtbi}${e.hung && e.clamp ? "" : " — secondary bag not hung/clamp closed"}`;
      case "titrate": return `Ch ${e.ch}: change ${e.fromDose != null ? `${e.fromDose} → ${e.toDose}` : `${e.fromRate} → ${e.toRate} mL/h`}`;
      case "newVtbi": return `Ch ${e.ch}: new VTBI ${e.vtbi} mL at ${e.rate} mL/h`;
      case "pause": return `Ch ${e.ch}: paused`;
      case "patientId": return `Patient ID entered: ${e.id}`;
      case "drugPicked": return `Ch ${e.ch}: ${dn(e.drugId)} chosen from list`;
      case "resume": return `Ch ${e.ch}: RESTART${e.fromAlarm ? ` (after ${e.fromAlarm} alarm)` : ""}`;
      case "alarm": return `Ch ${e.ch}: ALARM ${ALARM_TEXT[e.alarm] || e.alarm}`;
      case "silence": return "Alarm silenced";
      case "complete": return `Ch ${e.ch}: VTBI complete → KVO`;
      case "secondaryComplete": return `Ch ${e.ch}: secondary complete${e.fromPrimary >= 1 ? ` — ${fmtNum(e.fromPrimary, 0)} mL came from the PRIMARY bag` : ""}`;
      case "channelOff": return `Ch ${e.ch}: channel off`;
      case "startFailed": return `Ch ${e.ch}: cannot start, set not loaded`;
      case "bedside": return `Bedside ch ${e.ch}: ${BEDSIDE_TEXT[e.action] ? BEDSIDE_TEXT[e.action](e) : e.action}`;
      case "decision": return `Decision recorded`;
      case "cancelProgram": return `Ch ${e.ch}: programming cancelled`;
      case "softReenter": return `Ch ${e.ch}: re-entered after soft limit`;
      case "clearVolume": return "Volumes infused cleared";
    }
    return e.type;
  }
  const ALARM_TEXT = { air: "air in line", patientOcc: "patient side occlusion", fluidOcc: "fluid side occlusion", complete: "infusion complete", secComplete: "secondary complete", paused: "paused too long" };
  const BEDSIDE_TEXT = {
    prime: () => "spiked and primed bag", load: () => "set loaded, door closed", unload: () => "door opened", trace: () => "line traced",
    clamp: (e) => `roller clamp ${e.clampOpen ? "opened" : "closed"}`, fixOcclusion: () => "site checked, line straightened", clearAir: () => "air cleared",
    hangSecondary: () => "secondary hung above primary", secClamp: () => "secondary clamp toggled", newBag: () => "new bag hung",
  };

  // ------------------------------------------------------------ library tab
  const libProfile = $("#libProfile");
  libProfile.innerHTML = Object.keys(PROFILES).map((id) => `<option value="${id}">${PROFILES[id].name}</option>`).join("");
  libProfile.value = "icu";
  function renderLibrary() {
    const q = $("#libSearch").value.trim().toLowerCase();
    const rows = profileDrugList(libProfile.value).filter((d) => !q || d.name.toLowerCase().includes(q)).map((d) => {
      const l = d.limits;
      return `<tr><td><b>${d.name}</b>${d.highAlert ? `<span class="ha">HIGH ALERT</span>` : ""}<div class="note">${d.cls}</div></td>
        <td>${d.concs.map((c) => concLabel(d, c) + (c.amt ? ` <span class="note">(${concPerMlLabel(c)})</span>` : "")).join("<br>")}</td>
        <td class="num">${doseUnitLabel(d)}</td>
        <td class="num">${l.softMin != null ? fmtNum(l.softMin, 3) : "—"}</td>
        <td class="num">${l.softMax != null ? fmtNum(l.softMax, 3) : "—"}</td>
        <td class="num hard">${l.hardMax != null ? fmtNum(l.hardMax, 3) : "—"}</td>
        <td><span class="note">${d.note || ""}</span></td></tr>`;
    }).join("");
    $("#libBody").innerHTML = rows || `<tr><td colspan="7">No drugs match.</td></tr>`;
  }
  libProfile.addEventListener("change", renderLibrary);
  $("#libSearch").addEventListener("input", renderLibrary);
  renderLibrary();

  // ------------------------------------------------------------ main loop
  function renderAll() {
    const S = Pump.state;
    renderLCD(S);
    renderModules(S);
    renderBedside(S);
    if (scn) renderCoach(S);
    $("#clock").textContent = fmtClock(S.t);
    alarmAudio(S);
  }
  setInterval(() => {
    const S = Pump.state;
    Pump.tick(0.25 * speed);
    if (scn && scn.tick) scn.tick(S, X, Pump);
    renderAll();
  }, 250);
  // Instant feedback for key presses (don't wait for the next tick)
  Pump.onChange(() => requestAnimationFrame(renderAll));

  loadScenario(store.get("ivp-scn") || "free");
})();
