/*
 * Optional SCORM 1.2 reporting. When the page runs inside an LMS (for
 * example a Blackboard SCORM package), practice-mode results are sent as a
 * score (percent of orders programmed correctly) and the activity is marked
 * complete after ORDERS_TO_COMPLETE orders. Outside an LMS this does nothing.
 */
(() => {
  const ORDERS_TO_COMPLETE = 10;

  function findAPI(win) {
    for (let i = 0; win && i < 10; i++) {
      try { if (win.API) return win.API; } catch (e) { return null; }
      if (win.parent === win) break;
      win = win.parent;
    }
    return null;
  }
  let api = findAPI(window);
  try { if (!api && window.opener) api = findAPI(window.opener); } catch (e) { /* cross-origin */ }
  if (!api) return;

  api.LMSInitialize("");
  const prior = api.LMSGetValue("cmi.core.lesson_status");
  if (!prior || prior === "not attempted") api.LMSSetValue("cmi.core.lesson_status", "incomplete");
  const started = Date.now();

  window.addEventListener("ivp-result", (e) => {
    const { correct, total } = e.detail;
    api.LMSSetValue("cmi.core.score.min", "0");
    api.LMSSetValue("cmi.core.score.max", "100");
    api.LMSSetValue("cmi.core.score.raw", String(Math.round((correct / total) * 100)));
    if (total >= ORDERS_TO_COMPLETE) api.LMSSetValue("cmi.core.lesson_status", "completed");
    api.LMSCommit("");
  });

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    const s = Math.round((Date.now() - started) / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    api.LMSSetValue("cmi.core.session_time", `${hh}:${mm}:${ss}`);
    api.LMSCommit("");
    api.LMSFinish("");
  }
  window.addEventListener("pagehide", finish);
  window.addEventListener("beforeunload", finish);
})();
