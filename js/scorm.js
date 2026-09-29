/*
 * Optional SCORM 1.2 reporting. Inside an LMS (for example a Blackboard
 * SCORM package) the check-off sends its score: the percent of the orders
 * programmed correctly. No pass/fail or completion rule is applied; the
 * attempt is closed when the check-off ends so the LMS records the score.
 * Outside an LMS this does nothing.
 */
(() => {
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
  const started = Date.now();

  window.addEventListener("ivp-quiz-done", (e) => {
    api.LMSSetValue("cmi.core.score.min", "0");
    api.LMSSetValue("cmi.core.score.max", "100");
    api.LMSSetValue("cmi.core.score.raw", String(e.detail.pct));
    // Marks the attempt finished so the score is recorded; it is not a grade rule.
    api.LMSSetValue("cmi.core.lesson_status", "completed");
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
