(function () {
  'use strict';
  const L = window.WorkoutLib;
  const KEY = 'workout-app.v1';
  const view = document.getElementById('view');
  const title = document.getElementById('page-title');
  const TITLES = { workout: 'Workout', meals: 'Meals', shopping: 'Shopping list', progress: 'Progress', body: 'Body map', data: 'Import & backup' };
  const UNITS = [['g', 'g'], ['oz', 'oz'], ['lb', 'lb'], ['cup', 'cup'], ['tbsp', 'tbsp'], ['tsp', 'tsp']];

  let exercises = [];
  let index = null;
  let state = load();
  let tab = 'workout';
  let selectedDay = 0;
  let mealUnit = state.mealUnit || 'g';
  let search = '';
  let doneStretch = {}; // { 'dayTitle|kind|exercise_id': true } for the current session, cleared on save
  let bodyMode = 'sore';

  // ---- helpers -------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(blank(), JSON.parse(raw));
    } catch (e) { /* fall through */ }
    return blank();
  }
  function blank() {
    return { workoutPlan: null, mealPlan: null, logs: [], pantry: [], checked: {}, mealUnit: 'g', soreness: {} };
  }
  let planSyncTimer = null;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('Storage is full. Export a backup and remove old logs.', 'err'); }
    schedulePlanSync();
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function exName(id) {
    const e = index && index.byId.get(id);
    return e ? e.name : id;
  }
  // Shown fixed at the top of the screen, so it is visible even when the save button is far down the list.
  function toast(text, kind) {
    const box = document.createElement('div');
    box.className = 'msg toast ' + (kind || 'ok');
    box.textContent = text;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 4000);
  }

  // ---- animation (two frames alternate; one timer drives all) --------------
  function animHTML(ex) {
    const imgs = ex && ex.images ? ex.images : [];
    if (!imgs.length) return '<div class="anim"><div class="noimg">No animation for this exercise</div></div>';
    const frames = imgs.slice(0, 2).map((src, i) =>
      '<img src="' + esc(src) + '" alt="' + esc((ex.name || '') + ' position ' + (i + 1)) + '" class="' + (i === 0 ? 'show' : '') + '">').join('');
    return '<div class="anim" data-n="' + imgs.slice(0, 2).length + '" data-frame="0">' + frames + '</div>';
  }
  setInterval(() => {
    document.querySelectorAll('.anim[data-n="2"]:not([data-paused])').forEach((el) => {
      const next = el.dataset.frame === '1' ? '0' : '1';
      el.dataset.frame = next;
      el.querySelectorAll('img').forEach((img, i) => img.classList.toggle('show', String(i) === next));
    });
  }, 700);

  // ---- rendering -----------------------------------------------------------
  function setTab(t) {
    tab = t;
    title.textContent = TITLES[t];
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    if (!index) { view.innerHTML = '<p class="muted">Loading exercises…</p>'; return; }
    const map = { workout: renderWorkout, meals: renderMeals, shopping: renderShopping, progress: renderProgress, body: renderBody, data: renderData };
    map[tab]();
  }

  // Workout -----------------------------------------------------------------
  function renderWorkout() {
    const plan = state.workoutPlan;
    let html = '';
    if (!plan) {
      html += '<div class="card"><h3>No workout plan yet</h3><p class="muted">Plan with Claude, then paste or upload the JSON in the Import tab.</p></div>';
    } else {
      selectedDay = Math.min(selectedDay, plan.days.length - 1);
      html += '<h2>' + esc(plan.name) + '</h2><div class="row">';
      plan.days.forEach((d, i) => {
        html += '<button class="chip ' + (i === selectedDay ? 'on' : '') + '" data-day="' + i + '">' + esc(d.day || 'Day ' + (i + 1)) + (loggedThisWeek(d.title) ? ' ✓' : '') + '</button>';
      });
      html += '</div>';
      const day = plan.days[selectedDay];
      const dd = (state.drafts || {})[day.title] || {};
      for (const k of Object.keys(dd)) if (k.startsWith('stretch|')) doneStretch[k.slice(8)] = dd[k];
      html += '<h2>' + esc(day.title || 'Today') + '</h2>';
      html += soreCheck(day);
      html += logSession(day, plan);
    }
    html += activitySection();
    html += librarySection();
    view.innerHTML = html;
  }

  // Asks about soreness before training any muscle that is at least moderately sore.
  function soreCheck(day) {
    const sore = soreByRegion(true);
    const today = todayISO();
    const manual = (state.soreness || {})[today] || {};
    const due = dayRegions(day).filter((r) => sore[r] && sore[r].level >= 2);
    if (!due.length) return '';
    const levels = ['None', 'Mild', 'Moderate', 'Severe'];
    return '<div class="card warn"><h3>Still sore?</h3>' +
      '<p class="muted">These muscles are in today\'s workout and look sore. Confirm how they feel before you train.</p>' +
      due.map((r) => '<div class="row"><span>' + esc(REGION_NAMES[r] || r) + '</span>' +
        '<span class="muted" style="margin-left:auto">estimated ' + levels[sore[r].level] + '</span></div>' +
        soreChips(r, manual[r])).join('') +
      '</div>';
  }

  // Which lift has its replacement list open: { day, idx }, or null.
  let swapOpen = null;

  // Lists exercises for the same muscles that can take this lift's place.
  function swapPanel(i) {
    const day = state.workoutPlan.days[selectedDay];
    const ex = day.exercises[i];
    const options = L.replacementsFor(ex.exercise_id, exercises, day.exercises.map((x) => x.exercise_id), 12);
    if (!options.length) {
      return '<div class="card"><p class="muted">No other lifts work these same muscles.</p>' +
        '<button class="chip" data-cancel-swap="1">Close</button></div>';
    }
    return '<div class="card"><h3>Replace with</h3>' +
      '<p class="muted">Same muscles. Your sets, reps, rest and notes stay the same.</p>' +
      options.map((o) => '<div class="row" style="margin:6px 0"><span>' + esc(o.name) + '</span>' +
        '<span class="muted" style="margin-left:auto;font-size:12px">' + esc(o.equipment || '') + '</span>' +
        '<button class="chip" data-swap-to="' + esc(o.id) + '" data-swap-idx="' + i + '">Use</button></div>').join('') +
      '<button class="chip" data-cancel-swap="1" style="margin-top:8px">Close</button></div>';
  }

  function lastWeightFor(exId) {
    const rows = L.exerciseHistory(state.logs, exId);
    return rows.length ? rows[rows.length - 1].topWeight : '';
  }

  // Demo and instructions stay closed until opened, so the list stays short.
  function detailsHTML(e) {
    if (!e) return '';
    let html = '';
    if (e.images && e.images.length) {
      html += '<details><summary>Show demo</summary><div style="margin-top:8px">' + animHTML(e) + '</div></details>';
    }
    if (e.instructions && e.instructions.length) {
      html += '<details><summary>How to do it</summary><ol>' + e.instructions.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol></details>';
    }
    return html;
  }

  // Warmup or cooldown moves, each with a tick box and a timer. Ticks are saved with the workout log.
  function stretchBlock(kind, day, cfg) {
    const ids = day.exercises.map((e) => e.exercise_id);
    const isWarm = kind === 'warmup';
    const picks = isWarm ? L.warmupFor(ids, exercises) : L.cooldownFor(ids, exercises, { hold_sec: cfg.hold_sec });
    if (!picks.length) return '';
    const intro = isWarm
      ? 'Light cardio, then slow reps of each move before your first lift.'
      : 'One stretch for each muscle you trained. Hold each for about ' + esc(cfg.hold_sec) + ' seconds.';
    let html = '<h3 style="margin-top:14px">' + (isWarm ? 'Warmup' : 'Cooldown stretches') + '</h3>' +
      '<p class="muted" style="font-size:13px">' + intro + '</p>';
    picks.forEach((p, i) => {
      const key = day.title + '|' + kind + '|' + p.exercise.id;
      const done = !!doneStretch[key];
      const meta = isWarm
        ? (p.minutes ? p.minutes + ' min easy pace' : (p.reps || 10) + ' slow reps each side')
        : esc(p.muscle) + ' · hold ' + cfg.hold_sec + ' s';
      const secs = isWarm ? (p.minutes ? p.minutes * 60 : 30) : cfg.hold_sec;
      const timerText = isWarm ? (p.minutes ? p.minutes + ' min' : '30 s') : cfg.hold_sec + ' s';
      html += '<div class="lift' + (done ? ' done' : '') + '" data-stretch-row="' + esc(key) + '">' +
        '<label class="check" style="margin:0 0 4px"><input type="checkbox" data-stretch="' + esc(key) + '" ' + (done ? 'checked' : '') + '>' +
        '<span><strong>' + (i + 1) + '. ' + esc(p.exercise.name) + '</strong></span></label>' +
        '<div class="meta">' + meta + '</div>' +
        '<div class="row" style="margin:6px 0"><button class="chip" data-timer="' + secs + '" data-label="' + esc(p.exercise.name) + (isWarm ? '' : ' hold') + '">Timer ' + esc(timerText) + '</button></div>' +
        detailsHTML(p.exercise) +
        '</div>';
    });
    return html;
  }

  // One lift: name, sets and reps, last weight, target, the set log with weights, then the demo and replace controls.
  function liftBlock(ex, i, d) {
    const e = index.byId.get(ex.exercise_id);
    const last = lastWeightFor(ex.exercise_id);
    const hasLast = last !== '' && last != null;
    const rest = ex.rest_sec || 90;
    const meta = esc(ex.sets) + ' sets × ' + esc(ex.reps || '?') + ' reps' +
      (ex.rest_sec ? ' · rest ' + esc(ex.rest_sec) + 's' : '') +
      (hasLast ? ' · last ' + esc(last) + ' lb' : '');
    const skipped = !!d[ex.exercise_id + '|skip'];
    const dis = skipped ? ' disabled' : '';
    let rows = '';
    let ticked = 0;
    for (let s = 0; s < ex.sets; s++) {
      const key = ex.exercise_id + '|' + s;
      const repsV = d[key + '|reps'] != null ? d[key + '|reps'] : (parseInt(ex.reps, 10) || '');
      const wV = d[key + '|weight_lb'] != null ? d[key + '|weight_lb'] : (ex.target_lb != null ? ex.target_lb : (hasLast ? last : ''));
      const done = !!d[key + '|done'];
      if (done) ticked++;
      rows += '<tr class="' + (done ? 'done' : '') + '"><td><label class="check" style="margin:0"><input type="checkbox" data-done="' + esc(key) + '" ' + (done ? 'checked' : '') + dis + '> Set ' + (s + 1) + '</label></td>' +
        '<td><input class="num" inputmode="numeric" data-ex="' + esc(ex.exercise_id) + '" data-set="' + s + '" data-f="reps" value="' + esc(repsV) + '" placeholder="reps"' + dis + '></td>' +
        '<td><input class="num" inputmode="decimal" data-ex="' + esc(ex.exercise_id) + '" data-set="' + s + '" data-f="weight_lb" value="' + esc(wV) + '" placeholder="lb"' + dis + '></td>' +
        '<td><button class="chip" data-timer="' + rest + '" data-label="' + esc(exName(ex.exercise_id)) + ' rest">Rest ' + esc(rest) + 's</button></td></tr>';
    }
    const muscles = e ? [].concat(e.primaryMuscles, e.secondaryMuscles).map((m) => '<span class="pill">' + esc(m) + '</span>').join('') : '';
    return '<div class="lift' + (ex.sets && ticked === ex.sets ? ' done' : '') + (skipped ? ' skipped' : '') + '">' +
      '<div><strong>' + (i + 1) + '. ' + esc(e ? e.name : ex.exercise_id) + '</strong></div>' +
      '<div class="meta">' + meta + '</div>' +
      (ex.notes ? '<div class="meta">' + esc(ex.notes) + '</div>' : '') +
      '<div class="row" style="margin:8px 0"><span class="muted">Target</span>' +
        '<input class="num" inputmode="decimal" data-target="' + esc(ex.exercise_id) + '" value="' + esc(ex.target_lb != null ? ex.target_lb : '') + '" placeholder="lb">' +
        '<button class="chip" data-adjust="' + esc(ex.exercise_id) + '" data-step="-5">−5 lb</button>' +
        '<button class="chip" data-adjust="' + esc(ex.exercise_id) + '" data-step="5">+5 lb</button>' +
        '<button class="chip" data-sets="' + esc(ex.exercise_id) + '" data-delta="-1">− set</button>' +
        '<button class="chip" data-sets="' + esc(ex.exercise_id) + '" data-delta="1">+ set</button></div>' +
      '<table><thead><tr><th></th><th>Reps</th><th>Weight</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div style="margin-top:6px">' + muscles + '</div>' +
      detailsHTML(e) +
      '<div class="row" style="margin-top:8px"><button class="chip" data-skip="' + esc(ex.exercise_id) + '">' + (skipped ? 'Restore' : 'Skip today') + '</button>' +
      (e ? '<button class="chip" data-replace="' + i + '">Replace</button>' : '') + '</div>' +
      (swapOpen && swapOpen.day === selectedDay && swapOpen.idx === i ? swapPanel(i) : '') +
      '</div>';
  }

  // Session drafts: every set value and stretch tick is saved as it changes, so nothing is lost if the page closes.
  function draftFor(title) {
    state.drafts = state.drafts || {};
    if (!state.drafts[title]) state.drafts[title] = {};
    return state.drafts[title];
  }

  // The whole day in one list: warmup, each lift with its set log, then cooldown, so nothing needs a scroll back up.
  function logSession(day, plan) {
    const d = (state.drafts || {})[day.title] || {};
    const showCooldown = !plan.cooldown || plan.cooldown.enabled !== false;
    return '<h2>Log this workout</h2><div class="card">' +
      '<label>Date</label><input type="date" id="log-date" value="' + esc(d.__date || todayISO()) + '">' +
      '<p class="muted" style="font-size:12px">Each entry is saved as you type, so nothing is lost if the page closes.</p>' +
      stretchBlock('warmup', day, plan.cooldown || {}) +
      '<h3 style="margin-top:14px">Lifts</h3>' +
      '<div class="row" style="margin:6px 0"><button id="check-all" data-day="' + selectedDay + '">Check all sets</button></div>' +
      day.exercises.map((ex, i) => liftBlock(ex, i, d)).join('') +
      (showCooldown ? stretchBlock('cooldown', day, plan.cooldown || {}) : '') +
      (loggedThisWeek(day.title)
        ? (() => {
            const next = nextUnloggedDay();
            return '<div class="msg ok" style="margin-top:12px">' + esc(day.day || day.title) + ' is logged for this week. ' +
              (next >= 0 ? 'Next up: ' + esc(plan.days[next].day || plan.days[next].title) + '.' : 'Every workout is logged this week.') + '</div>';
          })()
        : '<div class="row" style="margin-top:12px"><button class="primary" id="save-session" data-day="' + selectedDay + '">Save workout</button></div>') +
      '</div>';
  }

  // A week runs Monday to Sunday. A day counts as logged for the week when a saved workout for it has a date in that week.
  function padDate(dt) {
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  function addDaysISO(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return padDate(dt);
  }
  function mondayOf(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
    return addDaysISO(iso, -dow);
  }
  function loggedThisWeek(title) {
    const start = mondayOf(todayISO());
    const end = addDaysISO(start, 6);
    return state.logs.some((l) => l.day === title && l.date >= start && l.date <= end);
  }
  // Index of the first plan day not yet logged this week, or -1 when every day is logged.
  function nextUnloggedDay() {
    if (!state.workoutPlan) return -1;
    return state.workoutPlan.days.findIndex((d) => !loggedThisWeek(d.title));
  }

  function saveSession(dayIdx) {
    const day = state.workoutPlan.days[dayIdx];
    if (loggedThisWeek(day.title)) { toast(day.title + ' is already logged this week.', 'err'); return; }
    const date = document.getElementById('log-date').value || todayISO();
    const dayDraft = (state.drafts || {})[day.title] || {};
    const entries = day.exercises.filter((ex) => !dayDraft[ex.exercise_id + '|skip']).map((ex) => {
      const sets = [];
      for (let s = 0; s < ex.sets; s++) {
        const reps = view.querySelector('[data-ex="' + ex.exercise_id + '"][data-set="' + s + '"][data-f="reps"]');
        const wt = view.querySelector('[data-ex="' + ex.exercise_id + '"][data-set="' + s + '"][data-f="weight_lb"]');
        if (reps && wt && Number(reps.value) > 0) sets.push({ reps: Number(reps.value), weight_lb: Number(wt.value) || 0 });
      }
      return { exercise_id: ex.exercise_id, sets };
    }).filter((e) => e.sets.length);
    const prefix = day.title + '|';
    const doneIds = (kind) => Object.keys(doneStretch).filter((k) => k.startsWith(prefix + kind + '|') && doneStretch[k])
      .map((k) => k.split('|')[2]);
    const warmup = doneIds('warmup');
    const cooldown = doneIds('cooldown');
    if (!entries.length && !warmup.length && !cooldown.length) { toast('Enter reps or tick a stretch first.', 'err'); return; }
    // Replace an earlier save for the same date and day, so re-saving does not duplicate.
    state.logs = state.logs.filter((l) => !(l.date === date && l.day === day.title));
    const log = { date, day: day.title, entries, warmup, cooldown };
    state.logs.push(log);
    if (state.drafts) delete state.drafts[day.title];
    save();
    queueUpload(log);
    Object.keys(doneStretch).forEach((k) => { if (k.startsWith(prefix)) delete doneStretch[k]; });
    const next = nextUnloggedDay();
    selectedDay = next >= 0 ? next : dayIdx;
    toast('Saved ' + date + ' workout.', 'ok');
    render();
  }

  // Other activity (squash, biking and so on). Kept apart from the lift logs. It counts toward the body map, not toward the week's days.
  const ACTIVITY_IDEAS = ['Squash', 'Biking', 'Running', 'Swimming', 'Basketball', 'Disc golf', 'Walking', 'Hiking', 'Tennis'];
  // Which body-map muscles each activity works. Primary counts in full, secondary counts half.
  const ACTIVITY_MUSCLES = {
    squash: { primary: ['quadriceps', 'calves', 'glutes'], secondary: ['forearms', 'shoulders', 'obliques'] },
    biking: { primary: ['quadriceps', 'hamstrings', 'glutes'], secondary: ['calves'] },
    running: { primary: ['quadriceps', 'hamstrings', 'calves', 'glutes'], secondary: ['abdominals'] },
    swimming: { primary: ['lats', 'shoulders'], secondary: ['triceps', 'chest', 'abdominals'] },
    basketball: { primary: ['quadriceps', 'calves'], secondary: ['glutes', 'shoulders', 'forearms'] },
    'disc golf': { primary: ['shoulders', 'obliques'], secondary: ['forearms', 'middle back'] },
    walking: { primary: ['calves', 'glutes'], secondary: ['hamstrings'] },
    hiking: { primary: ['quadriceps', 'glutes', 'calves'], secondary: ['hamstrings', 'lower back'] },
    tennis: { primary: ['shoulders', 'forearms', 'obliques'], secondary: ['quadriceps', 'calves', 'glutes'] },
  };
  // Activities count toward the body map as sets: about one set per 15 minutes.
  function activityKey(name) { return L.normalizeName(name); }
  function bodyLogs() {
    const acts = (state.activities || []).filter((a) => ACTIVITY_MUSCLES[activityKey(a.name)]);
    return state.logs.concat(acts.map((a) => ({
      date: a.date, day: 'activity',
      entries: [{ exercise_id: 'activity:' + activityKey(a.name), sets: Array.from({ length: Math.max(1, Math.round(a.minutes / 15)) }, () => ({ reps: 1, weight_lb: 0 })) }],
    })));
  }
  function bodyExercises() {
    const virtual = Object.keys(ACTIVITY_MUSCLES).map((k) => ({
      id: 'activity:' + k, name: k, primaryMuscles: ACTIVITY_MUSCLES[k].primary, secondaryMuscles: ACTIVITY_MUSCLES[k].secondary,
    }));
    return exercises.concat(virtual);
  }
  function activitySection() {
    const list = (state.activities || []).map((a, i) => ({ a, i })).sort((x, y) => (y.a.date || '').localeCompare(x.a.date || '')).slice(0, 10);
    const rows = list.map(({ a, i }) =>
      '<div class="row" style="justify-content:space-between;align-items:center;margin-top:8px">' +
      '<span>' + esc(a.date) + ' · ' + esc(a.name) + ' · ' + esc(a.minutes) + ' min' + (a.notes ? ' · ' + esc(a.notes) : '') + '</span>' +
      '<button class="bad" style="color:var(--bad)" data-del-activity="' + i + '">Delete</button></div>').join('');
    return '<h2>Other activity</h2><div class="card">' +
      '<label>Activity</label><input id="act-name" list="act-ideas" placeholder="e.g. Squash" maxlength="99">' +
      '<datalist id="act-ideas">' + ACTIVITY_IDEAS.map((n) => '<option value="' + esc(n) + '">').join('') + '</datalist>' +
      '<div class="row"><div><label>Minutes</label><input id="act-minutes" class="num" inputmode="numeric" placeholder="45"></div>' +
      '<div><label>Date</label><input id="act-date" type="date" value="' + esc(todayISO()) + '"></div></div>' +
      '<label>Notes (optional)</label><input id="act-notes" placeholder="e.g. 3 games" maxlength="499">' +
      '<div class="row" style="margin-top:8px"><button class="primary" id="save-activity">Save activity</button></div>' +
      (rows ? '<p class="muted" style="margin-top:12px">Recent</p>' + rows : '') +
      '</div>';
  }

  function librarySection() {
    const q = L.normalizeName(search);
    const hits = q ? exercises.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 30) : [];
    let html = '<h2>Exercise library</h2><div class="card">' +
      '<input id="lib-search" placeholder="Search ' + exercises.length + ' exercises" value="' + esc(search) + '">';
    hits.forEach((e) => {
      html += '<details style="margin-top:10px"><summary>' + esc(e.name) + '</summary>' +
        '<div style="margin-top:8px">' + animHTML(e) + '</div>' +
        '<div>' + [].concat(e.primaryMuscles, e.secondaryMuscles).map((m) => '<span class="pill">' + esc(m) + '</span>').join('') + '</div>' +
        (e.instructions.length ? '<ol>' + e.instructions.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' : '') +
        '</details>';
    });
    if (q && !hits.length) html += '<p class="muted">No matches.</p>';
    return html + '</div>';
  }

  // Meals -------------------------------------------------------------------
  function unitSelect(id, value) {
    return '<select id="' + id + '" style="width:auto">' +
      UNITS.map(([v, label]) => '<option value="' + v + '"' + (v === value ? ' selected' : '') + '>' + label + '</option>').join('') +
      '</select>';
  }

  function renderMeals() {
    const plan = state.mealPlan;
    let html = '<div class="row spread"><span class="muted">Show amounts in</span>' + unitSelect('meal-unit', mealUnit) + '</div>';
    if (!plan) {
      html += '<div class="card"><h3>No meal plan yet</h3><p class="muted">Plan meals with Claude, then import the JSON in the Import tab.</p></div>';
    } else {
      plan.days.forEach((d, di) => {
        html += '<h2>' + esc(d.date || 'Day ' + (di + 1)) + '</h2>';
        (d.meals || []).forEach((m) => {
          html += '<div class="card"><h3>' + esc(m.name) + '</h3>' +
            (m.servings ? '<div class="meta muted">' + esc(m.servings) + ' serving(s)</div>' : '') + '<div style="margin-top:6px">';
          (m.ingredients || []).forEach((ing) => {
            const conv = L.convertGrams(Number(ing.amount_g), ing.name, mealUnit);
            const amount = conv ? L.formatAmount(conv) : Math.round(ing.amount_g) + ' g (no ' + mealUnit + ' conversion for this item)';
            html += '<div class="check" style="padding:6px 0"><span>' + esc(ing.name) + '</span><span class="muted" style="margin-left:auto">' + esc(amount) + '</span></div>';
          });
          html += '</div></div>';
        });
      });
    }
    view.innerHTML = html;
  }

  // Shopping ----------------------------------------------------------------
  function renderShopping() {
    const plan = state.mealPlan;
    let html = '<div class="row spread"><span class="muted">Show amounts in</span>' + unitSelect('shop-unit', mealUnit) + '</div>';
    if (!plan) {
      html += '<div class="card"><h3>No meal plan yet</h3><p class="muted">Import a meal plan to build a shopping list.</p></div>';
      view.innerHTML = html;
      return;
    }
    const pantry = new Set(state.pantry);
    const list = L.buildShoppingList(plan, pantry);
    if (!list.length) html += '<p class="muted">Nothing to buy. Everything is in your pantry.</p>';
    list.forEach((group) => {
      html += '<h2>' + esc(group.section) + '</h2><div class="card">';
      group.items.forEach((it) => {
        const conv = L.convertGrams(it.grams, it.name, mealUnit);
        const amount = conv ? L.formatAmount(conv) : it.grams + ' g';
        const done = !!state.checked[it.key];
        html += '<div class="check ' + (done ? 'done' : '') + '">' +
          '<input type="checkbox" data-check="' + esc(it.key) + '" ' + (done ? 'checked' : '') + '>' +
          '<span>' + esc(it.name) + ' <span class="muted">' + esc(amount) + '</span></span>' +
          '<button class="small" style="margin-left:auto" data-have="' + esc(it.key) + '">I have it</button></div>';
      });
      html += '</div>';
    });
    if (state.pantry.length) {
      html += '<h2>Pantry (excluded)</h2><div class="card">';
      state.pantry.forEach((k) => {
        html += '<div class="check"><span>' + esc(k) + '</span><button class="small" style="margin-left:auto" data-unhave="' + esc(k) + '">Remove</button></div>';
      });
      html += '</div>';
    }
    view.innerHTML = html;
  }

  // Progress ----------------------------------------------------------------
  // ---- Cloud copy (Supabase) ---------------------------------------------------
  // Each saved workout joins a queue and is sent to the workout_logs table (see supabase/schema.sql).
  // The app can only add rows there. Off until window.SUPABASE_CONFIG is set: { url, key }.
  const SUPABASE = window.SUPABASE_CONFIG || null;
  let flushing = false;

  function queueUpload(log) {
    if (!SUPABASE) return;
    state.uploadQueue = (state.uploadQueue || []).concat([log]);
    save();
    flushUploads();
  }

  // Sends queued workouts one at a time. A network failure keeps the workout queued for the next try.
  // A rejected row (4xx) is dropped so it cannot block the queue.
  function flushUploads() {
    if (!SUPABASE || flushing || !(state.uploadQueue || []).length) return;
    flushing = true;
    const next = state.uploadQueue[0];
    const isActivity = next.kind === 'activity';
    const body = isActivity
      ? { date: next.date, name: next.name, minutes: next.minutes, notes: next.notes || '' }
      : { date: next.date, day: next.day, entries: next.entries, warmup: next.warmup, cooldown: next.cooldown };
    getSession().catch(() => null).then((s) => fetch(SUPABASE.url + (isActivity ? '/rest/v1/activity_logs' : '/rest/v1/workout_logs'), {
      method: 'POST',
      headers: {
        apikey: SUPABASE.key,
        Authorization: 'Bearer ' + (s ? s.access_token : SUPABASE.key),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    })).then((r) => {
      const rejected = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429 && r.status !== 401;
      if (!r.ok && !rejected) throw new Error('retry ' + r.status);
      if (!r.ok) toast('A workout could not be uploaded (error ' + r.status + '). It is still saved on this phone.', 'err');
      state.uploadQueue = state.uploadQueue.slice(1);
      save();
      flushing = false;
      flushUploads();
    }).catch(() => { flushing = false; });
  }

  // Exercises you have logged, in the order they were first logged.
  function loggedExerciseIds() {
    return [...new Set(state.logs.flatMap((l) => l.entries.map((e) => e.exercise_id)))];
  }

  // Options for the Progress dropdown: only exercises you have logged. Empty text lists them all;
  // typed text keeps the ones whose names start with it. The selected exercise stays in the list when the box is empty.
  function progressOptions(text, selected) {
    const logged = loggedExerciseIds();
    const q = L.normalizeName(text);
    let list = q ? logged.filter((id) => L.normalizeName(exName(id)).startsWith(q)) : logged.slice();
    if (!q && selected && !list.includes(selected)) list = [selected].concat(list);
    if (!list.length) return '<option disabled>No logged exercise starts with "' + esc(text) + '"</option>';
    return list.map((id) => '<option value="' + esc(id) + '"' + (id === selected ? ' selected' : '') + '>' + esc(exName(id)) + '</option>').join('');
  }

  function renderProgress() {
    const ids = [...new Set(state.logs.flatMap((l) => l.entries.map((e) => e.exercise_id)))];
    if (!ids.length) {
      view.innerHTML = '<div class="card"><h3>No workouts logged yet</h3><p class="muted">Save a workout on the Workout tab and it will show up here.</p></div>';
      return;
    }
    const selected = state.progressEx && index.byId.has(state.progressEx) ? state.progressEx : ids[0];
    const rows = L.exerciseHistory(state.logs, selected);
    const maxW = Math.max(1, ...rows.map((r) => r.topWeight));
    // Typing narrows the dropdown to exercises whose names start with what you type. Empty box = your logged exercises.
    let html = '<label>Type to find an exercise</label>' +
      '<input id="prog-type" placeholder="e.g. Bar" autocomplete="off">' +
      '<label>Exercise</label>' +
      '<select id="prog-ex">' + progressOptions('', selected) + '</select>';
    html += '<h2>Weight lifted over time</h2><div class="card">';
    if (!rows.length) html += '<p class="muted">No saved sets for this exercise yet.</p>';
    rows.forEach((r, i) => {
      const prev = i ? rows[i - 1].topWeight : null;
      const delta = prev == null ? '' : (r.topWeight - prev);
      html += '<div style="margin-bottom:10px"><div class="row spread"><span>' + esc(r.date) + '</span><span>' +
        esc(r.topWeight) + ' lb ' + (delta === '' ? '' : '<span class="' + (delta > 0 ? 'good' : delta < 0 ? 'bad' : 'muted') + '">' + (delta > 0 ? '+' : '') + delta + '</span>') +
        '</span></div><div class="barwrap"><div class="bar" style="width:' + Math.round((r.topWeight / maxW) * 100) + '%"></div></div></div>';
    });
    html += '</div>';

    const dates = [...new Set(rows.map((r) => r.date))];
    if (dates.length >= 2) {
      const a = state.cmpA && dates.includes(state.cmpA) ? state.cmpA : dates[0];
      const b = state.cmpB && dates.includes(state.cmpB) ? state.cmpB : dates[dates.length - 1];
      const cmp = L.compareSessions(rows, a, b);
      const opts = (sel) => dates.map((d) => '<option value="' + d + '"' + (d === sel ? ' selected' : '') + '>' + d + '</option>').join('');
      html += '<h2>Compare two dates</h2><div class="card"><div class="row">' +
        '<select id="cmp-a" style="width:auto">' + opts(a) + '</select> → ' +
        '<select id="cmp-b" style="width:auto">' + opts(b) + '</select></div>';
      if (cmp) {
        const c = cmp.change;
        html += '<p>Top weight: ' + esc(cmp.from.topWeight) + ' lb → ' + esc(cmp.to.topWeight) + ' lb ' +
          '<span class="' + (c > 0 ? 'good' : c < 0 ? 'bad' : 'muted') + '">(' + (c > 0 ? '+' : '') + c + ' lb)</span></p>' +
          '<p class="muted">Compares the heaviest set on each date. Load shows training progress, not muscle size.</p>';
      }
      html += '</div>';
    }
    html += '<h2>Muscle heatmap & soreness map</h2><div class="card"><p class="muted">Coming next.</p></div>';
    view.innerHTML = html;
  }

  // Body map ---------------------------------------------------------------
  const REGION_NAMES = {
    abs: 'Abs', chest: 'Chest (pecs)', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms',
    quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', adductors: 'Inner thigh', calves: 'Calves',
    back: 'Back', lower_back: 'Lower back', neck: 'Neck',
  };
  // What each muscle group covers, what it does, and what trains it. Shown in the muscle's panel and in the guide.
  const REGION_INFO = {
    chest: { muscles: 'Pectoralis major (upper, middle and lower fibres) and pectoralis minor', does: 'Pulls the upper arm across the body and in front, and pushes forward.', trained: 'Bench press, push-ups, cable flyes' },
    shoulders: { muscles: 'Deltoids: front, side and rear heads, over the top of the shoulder joint', does: 'Raises the arm forward, out to the side and back, and steadies the shoulder.', trained: 'Overhead press, lateral raises, rear delt flyes' },
    back: { muscles: 'Latissimus dorsi, trapezius and rhomboids: the broad muscles of the back and between the shoulder blades', does: 'Pulls the arms down and back, and moves and holds the shoulder blades.', trained: 'Lat pulldowns, rows, pull-ups, face pulls' },
    lower_back: { muscles: 'Erector spinae, the muscles running either side of the spine', does: 'Keeps the spine upright and extends the back.', trained: 'Deadlifts, back extensions, good mornings' },
    abs: { muscles: 'Rectus abdominis and the obliques along the sides of the waist', does: 'Bends the trunk forward, rotates and side-bends it, and stabilises the core.', trained: 'Cable crunches, leg raises, planks, side bends' },
    biceps: { muscles: 'Biceps brachii, the front of the upper arm', does: 'Bends the elbow and turns the palm up.', trained: 'Curls, chin-ups, hammer curls' },
    triceps: { muscles: 'Triceps brachii, the back of the upper arm (three heads)', does: 'Straightens the elbow.', trained: 'Pushdowns, dips, skull crushers' },
    forearms: { muscles: 'Flexors and extensors of the wrist and fingers', does: 'Bends and straightens the wrist, and grips.', trained: 'Wrist curls, farmer carries, dead hangs' },
    glutes: { muscles: 'Gluteus maximus, medius and minimus (the buttocks and hip sides)', does: 'Extends and rotates the hip, and steadies the pelvis.', trained: 'Squats, hip thrusts, lunges, abductions' },
    quads: { muscles: 'Quadriceps: rectus femoris and three vastus muscles, the front of the thigh', does: 'Straightens the knee and flexes the hip.', trained: 'Squats, leg press, leg extensions' },
    hamstrings: { muscles: 'Biceps femoris, semitendinosus and semimembranosus, the back of the thigh', does: 'Bends the knee and extends the hip.', trained: 'Romanian deadlifts, leg curls' },
    adductors: { muscles: 'Adductor longus, brevis and magnus, the inner thigh', does: 'Pulls the legs together.', trained: 'Adductor machine, sumo squats, copenhagen planks' },
    calves: { muscles: 'Gastrocnemius (the big calf muscle) and soleus, below the knee', does: 'Points the foot down and helps with walking and jumping.', trained: 'Standing and seated calf raises' },
    neck: { muscles: 'Sternocleidomastoid and the neck extensors and flexors', does: 'Moves and holds the head.', trained: 'Neck flexion and extension (light, controlled)' },
  };

  function regionInfoHTML(region) {
    const info = REGION_INFO[region];
    if (!info) return '';
    return '<p class="muted" style="margin-top:8px"><strong>Muscles:</strong> ' + esc(info.muscles) + '.<br>' +
      '<strong>What it does:</strong> ' + esc(info.does) + '<br>' +
      '<strong>Trained by:</strong> ' + esc(info.trained) + '.</p>';
  }

  let bodyMounted = false;

  // Soreness today: the estimate from completed workouts, replaced by anything entered by hand.
  // A manual 0 clears the estimate for that muscle.
  // excludeToday: used before training, so the workout you are about to do does not count as soreness.
  function soreByRegion(excludeToday) {
    const today = todayISO();
    const logs = excludeToday ? bodyLogs().filter((l) => l.date !== today) : bodyLogs();
    const sore = L.autoSoreness(logs, bodyExercises(), today);
    const manual = (state.soreness && state.soreness[today]) || {};
    for (const [region, level] of Object.entries(manual)) {
      if (level > 0) sore[region] = { level, source: 'manual' };
      else delete sore[region];
    }
    return sore;
  }

  function dayRegions(day) {
    const set = new Set();
    for (const ex of day.exercises || []) {
      const e = index && index.byId.get(ex.exercise_id);
      if (!e) continue;
      for (const m of e.primaryMuscles || []) { const r = L.REGION_OF[m]; if (r) set.add(r); }
    }
    return [...set];
  }

  // The muscle last tapped on the figure, with its tap point. Kept across re-renders.
  let bodySelected = null;

  // Days since the last logged workout, and how many muscle groups are fresh (not sore today).
  function recoveryStats(sore) {
    const dates = state.logs.filter((l) => (l.entries || []).length > 0).map((l) => l.date).sort();
    const last = dates[dates.length - 1];
    const days = last ? Math.max(0, Math.round((Date.parse(todayISO() + 'T00:00:00Z') - Date.parse(last + 'T00:00:00Z')) / 86400000)) : null;
    const groups = Object.keys(REGION_INFO);
    const fresh = groups.filter((r) => !(sore[r] && sore[r].level > 0)).length;
    return '<div class="card stats">' +
      '<div><div class="stat-num">' + (days == null ? '–' : days) + '</div><div class="stat-label">Days since your last workout</div></div>' +
      '<div><div class="stat-num">' + fresh + '</div><div class="stat-label">Fresh muscle groups of ' + groups.length + '</div></div>' +
      '</div>';
  }

  function renderBody() {
    const load = L.weeklyLoad(bodyLogs(), bodyExercises(), todayISO(), 7);
    const sore = soreByRegion();
    const chip = (k, label) => '<button class="chip ' + (bodyMode === k ? 'on' : '') + '" data-bodymode="' + k + '">' + label + '</button>';
    view.innerHTML =
      '<div class="row" style="margin-bottom:8px">' + chip('sore', 'Recovery') + chip('heat', 'Training') + '</div>' +
      recoveryStats(sore) +
      '<div class="card" style="padding:6px;position:relative"><div id="body-canvas" style="height:440px;touch-action:none"></div>' +
      '<div id="body-dot" class="body-dot" hidden></div><div id="body-label" class="body-label" hidden></div></div>' +
      '<div id="body-menu"></div>' +
      '<div id="body-panel"></div>' +
      '<details class="card"><summary><strong>Muscle guide</strong></summary>' +
      Object.keys(REGION_INFO).map((r) => '<div style="margin-top:10px"><strong>' + esc(REGION_NAMES[r] || r) + '</strong>' + regionInfoHTML(r) + '</div>').join('') +
      '</details>' +
      '<p class="muted">Drag to turn the figure. Tap a muscle to see its sets or log soreness. Tap it again, or tap away from the body, to clear. This is a stylised figure, not medical imaging. If pain is sharp, lasts, or gets worse, see a doctor or physiotherapist.</p>';
    window.BodyMap.render(document.getElementById('body-canvas'), {
      mode: bodyMode, load, sore,
      onTap: (region, x, y) => onBodyTap(region, x, y, load, sore),
    });
    applyBodySelection(load, sore);
  }

  // Tapping a muscle selects it; tapping the same muscle, the empty space or skin clears the choice.
  function onBodyTap(region, x, y, load, sore) {
    if (!region || (bodySelected && bodySelected.region === region)) bodySelected = null;
    else bodySelected = { region, x, y };
    applyBodySelection(load, sore);
  }

  function applyBodySelection(load, sore) {
    renderBodyMenu(load, sore);
    const label = document.getElementById('body-label');
    const dot = document.getElementById('body-dot');
    const panel = document.getElementById('body-panel');
    if (!bodySelected) {
      if (label) label.hidden = true;
      if (dot) dot.hidden = true;
      if (panel) panel.innerHTML = '';
      return;
    }
    showRegion(bodySelected.region, load, sore, bodySelected.x, bodySelected.y);
  }

  // The mode's legend. While a muscle is selected it sits in that muscle's panel, after the name.
  function bodyLegend() {
    if (bodyMode === 'heat') {
      return '<div class="ramp"></div><div class="row muted"><span>Fewer sets</span><span style="margin-left:auto">More sets</span></div>';
    }
    if (bodyMode === 'sore') {
      const levels = ['Fresh', 'Mild', 'Moderate', 'Severe'];
      const colors = ['#7d7d95', '#f0b429', '#f0893b', '#ef4444'];
      return '<div class="muted">' + [0, 1, 2, 3].map((i) => '<span class="swatch" style="background:' + colors[i] + '"></span>' + levels[i]).join('&nbsp;&nbsp;&nbsp;') + '</div>';
    }
    return '';
  }

  // Each colouring mode has its own menu: a legend and the muscles it applies to.
  // Shown only when no muscle is selected; with a selection the legend moves into the panel.
  function renderBodyMenu(load, sore) {
    const el = document.getElementById('body-menu');
    if (!el) return;
    if (bodySelected) { el.innerHTML = ''; return; }
    const name = (r) => esc(REGION_NAMES[r] || r);
    if (bodyMode === 'heat') {
      const rows = Object.entries(load).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      el.innerHTML = '<div class="card"><h3>Training, last 7 days</h3>' + bodyLegend() +
        (rows.length
          ? rows.map(([r, v]) => '<div class="row"><span>' + name(r) + '</span><span style="margin-left:auto">' + v + ' sets</span></div>').join('')
          : '<p class="muted">No sets logged in the last 7 days.</p>') +
        '</div>';
    } else if (bodyMode === 'sore') {
      // Recovery: muscles coloured by how recently and how hard they were worked. Fresh means not worked in the last few days.
      const levels = ['', 'Mild', 'Moderate', 'Severe'];
      const worked = Object.entries(sore).filter(([, s]) => s && s.level > 0);
      const hardest = worked.slice().sort((a, b) => (b[1].score || b[1].level * 5) - (a[1].score || a[1].level * 5)).slice(0, 3);
      const fresh = Object.keys(REGION_INFO).filter((r) => !(sore[r] && sore[r].level > 0));
      el.innerHTML = '<div class="card"><h3>Recovery</h3>' +
        '<p class="muted">Estimated from your saved workouts. A muscle lights up as soon as you save a workout that trains it, and fades over three days.</p>' +
        bodyLegend() +
        '<h3 style="margin-top:12px">Worked hardest recently</h3>' +
        (hardest.length
          ? hardest.map(([r, s]) => '<div class="row"><span>' + name(r) + '</span><span style="margin-left:auto">' + levels[s.level] + '</span></div>').join('')
          : '<p class="muted">Nothing worked in the last few days.</p>') +
        '<h3 style="margin-top:12px">Fresh</h3>' +
        '<p>' + (fresh.length ? fresh.map((r) => name(r)).join(', ') : 'None') + '</p>' +
        '</div>';
    } else {
      el.innerHTML = '';
    }
  }

  function showRegion(region, load, sore, x, y) {
    const levels = ['None', 'Mild', 'Moderate', 'Severe'];
    const level = sore[region] ? sore[region].level : 0;
    const canvas = document.getElementById('body-canvas');
    // Tap points come in canvas coordinates; the label and dot sit in the card around the canvas.
    const px = x + (canvas ? canvas.offsetLeft : 0);
    const py = y + (canvas ? canvas.offsetTop : 0);
    const label = document.getElementById('body-label');
    const dot = document.getElementById('body-dot');
    if (label && dot && x != null) {
      label.hidden = false;
      dot.hidden = false;
      label.textContent = (REGION_NAMES[region] || region) + ' · ' + (load[region] || 0) + ' sets · ' + levels[level];
      const W = label.parentNode.clientWidth;
      const lw = label.offsetWidth || 150;
      const left = px + 14 + lw > W - 8 ? px - 14 - lw : px + 14;
      label.style.left = Math.max(8, left) + 'px';
      label.style.top = Math.max(8, py - 12) + 'px';
      dot.style.left = px + 'px';
      dot.style.top = py + 'px';
    }
    const panel = document.getElementById('body-panel');
    if (!panel) return;
    const manual = ((state.soreness || {})[todayISO()] || {})[region];
    panel.innerHTML = '<div class="card"><h3>' + esc(REGION_NAMES[region] || region) + '</h3>' +
      bodyLegend() + regionInfoHTML(region) +
      '<p class="muted">Sets in the last 7 days: ' + (load[region] || 0) + '</p>' +
      '<p class="muted">Soreness today: ' + levels[level] + (sore[region] && sore[region].source === 'manual' ? ' (entered by you)' : ' (estimated)') + '</p>' +
      soreChips(region, manual) + '</div>';
  }

  function soreChips(region, current) {
    const levels = ['None', 'Mild', 'Moderate', 'Severe'];
    return '<label>Enter soreness for today</label><div class="row">' +
      levels.map((l, i) => '<button class="chip ' + (current === i ? 'on' : '') + '" data-region="' + region + '" data-soreness="' + i + '">' + l + '</button>').join('') +
      '</div>';
  }

  // Import & backup --------------------------------------------------------
  // Shown on the Import tab so you can tell which version of the app your phone has loaded.
  const APP_VERSION = 'v1.49';

  const PROMPT = [
    'Plan my week using this exact JSON format, and output only the JSON.',
    'For exercises, use names exactly as they appear in the attached exercise-names.txt list.',
    '',
    'Workout plan format:',
    '{"type":"workout_plan","version":1,"name":"...","days":[{"day":"Mon","title":"Upper A","exercises":[{"exercise":"Barbell Bench Press - Medium Grip","sets":4,"reps":"6-8","rest_sec":120,"target_lb":135,"notes":""}]}]}',
    '"target_lb" is the weight to lift, in pounds. Leave it out if you do not know it.',
    '',
    'Meal plan format (grams only, amount_g is required):',
    '{"type":"meal_plan","version":1,"days":[{"date":"2026-11-25","meals":[{"name":"Oatmeal","servings":1,"ingredients":[{"name":"rolled oats","amount_g":80}]}]}]}',
  ].join('\n');

  // Lists each saved workout with its own Delete button (newest first).
  function savedLogsHTML() {
    if (!state.logs.length) return '<h2>Saved workouts</h2><div class="card"><p class="muted">No saved workouts yet.</p></div>';
    const rows = state.logs
      .map((l, i) => ({ l, i }))
      .sort((a, b) => (b.l.date || '').localeCompare(a.l.date || ''))
      .map(({ l, i }) => {
        const sets = (l.entries || []).reduce((n, e) => n + (e.sets || []).filter((x) => x.reps > 0).length, 0);
        return '<div class="row" style="justify-content:space-between;align-items:center;margin-top:8px">' +
          '<span>' + esc(l.date) + ' · ' + esc(l.day) + ' · ' + sets + ' sets</span>' +
          '<button class="bad" style="color:var(--bad)" data-del-log="' + i + '">Delete</button></div>';
      }).join('');
    return '<h2>Saved workouts</h2><div class="card"><p class="muted">Delete one workout at a time.</p>' + rows + '</div>';
  }

  function renderData() {
    view.innerHTML =
      '<p class="muted" style="font-size:12px">App version ' + APP_VERSION + '</p>' +
      '<h2>Import workout plan</h2><div class="card">' +
      '<textarea id="wp-text" placeholder="Paste workout plan JSON here"></textarea>' +
      '<input type="file" accept="application/json,.json" data-file="workout" style="margin-top:8px">' +
      '<div class="row" style="margin-top:8px"><button class="primary" data-import="workout">Import workout</button></div></div>' +
      '<h2>Import meal plan</h2><div class="card">' +
      '<textarea id="mp-text" placeholder="Paste meal plan JSON here"></textarea>' +
      '<input type="file" accept="application/json,.json" data-file="meal" style="margin-top:8px">' +
      '<div class="row" style="margin-top:8px"><button class="primary" data-import="meal">Import meal plan</button></div></div>' +
      '<h2>Give Claude the format</h2><div class="card">' +
      '<p class="muted">Copy this into Claude, and attach exercise-names.txt.</p>' +
      '<textarea id="prompt-text" readonly>' + esc(PROMPT) + '</textarea>' +
      '<div class="row" style="margin-top:8px"><button data-copy="prompt-text">Copy prompt</button>' +
      '<a class="btn" href="exercise-names.txt" download>Download exercise-names.txt</a></div></div>' +
      '<h2>Get next weights from Claude</h2><div class="card">' +
      '<p class="muted">Copies your last 14 days of sets and current targets. Paste it into Claude. Claude replies with the plan and a target weight for each lift. Copy that reply and paste it into Import workout above.</p>' +
      '<div class="row"><button class="primary" data-training-log="1">Copy training log</button></div>' +
      '<div id="log-box"></div></div>' +
      savedLogsHTML() +
      '<h2>Backup</h2><div class="card">' +
      '<p class="muted">Save a backup file to iCloud Drive from the share sheet (Save to Files).</p>' +
      '<div class="row"><button class="primary" data-backup="export">Export backup</button>' +
      '<label class="btn" style="margin:0">Restore backup<input type="file" accept="application/json,.json" data-file="backup" hidden></label></div>' +
      '</div>' +
      '<div id="backup-box"></div><div id="import-msgs"></div>';
  }

  function showMsgs(errors, warnings, okText) {
    const box = document.getElementById('import-msgs');
    if (!box) return;
    let html = '';
    if (errors.length) html += '<div class="msg err">' + errors.slice(0, 12).map(esc).join('<br>') + (errors.length > 12 ? '<br>…and more' : '') + '</div>';
    (warnings || []).forEach((w) => html += '<div class="msg warn">' + esc(w) + '</div>');
    if (okText) html += '<div class="msg ok">' + esc(okText) + '</div>';
    box.innerHTML = html;
  }

  function importJSON(kind, text) {
    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { showMsgs(['That is not valid JSON. Check for a missing comma or bracket.'], [], ''); return; }
    if (kind === 'workout') {
      const r = L.validateWorkoutPlan(obj, index);
      if (!r.ok) { showMsgs(r.errors, r.warnings, ''); return; }
      state.workoutPlan = r.plan;
      selectedDay = 0;
      save();
      showMsgs([], r.warnings, 'Workout plan imported: ' + r.plan.days.length + ' days.');
    } else {
      const r = L.validateMealPlan(obj);
      if (!r.ok) { showMsgs(r.errors, r.warnings, ''); return; }
      state.mealPlan = r.plan;
      save();
      showMsgs([], r.warnings, 'Meal plan imported: ' + r.plan.days.length + ' days.');
    }
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---- events --------------------------------------------------------------
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  view.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.id === 'save-session') { saveSession(Number(t.dataset.day)); return; }
    if (t.id === 'save-activity') {
      const name = (document.getElementById('act-name').value || '').trim();
      const minutes = Math.round(Number(document.getElementById('act-minutes').value));
      const date = document.getElementById('act-date').value || todayISO();
      const notes = (document.getElementById('act-notes').value || '').trim();
      if (!name) { toast('Type the activity, for example Squash.', 'err'); return; }
      if (!(minutes > 0 && minutes < 1440)) { toast('Enter the minutes, for example 45.', 'err'); return; }
      const a = { date, name, minutes, notes };
      state.activities = (state.activities || []).concat([a]);
      save();
      queueUpload(Object.assign({ kind: 'activity' }, a));
      toast('Saved ' + name + '.', 'ok');
      render();
      return;
    }
    if (t.dataset.delActivity != null) {
      const i = Number(t.dataset.delActivity);
      const a = (state.activities || [])[i];
      if (a && confirm('Delete ' + a.name + ' on ' + a.date + '? This only removes it from this phone.')) {
        state.activities.splice(i, 1); save(); render(); toast('Activity deleted.', 'ok');
      }
      return;
    }
    if (t.dataset.skip) {
      // Greys out a lift for this session only. Restore brings it back. Nothing is saved for it.
      const day = state.workoutPlan.days[selectedDay];
      const d = draftFor(day.title);
      const key = t.dataset.skip + '|skip';
      if (d[key]) delete d[key]; else d[key] = true;
      save();
      render();
      return;
    }
    if (t.id === 'check-all') {
      // Ticks every set of every lift in this workout, or clears them all if they are already ticked.
      const day = state.workoutPlan.days[selectedDay];
      const d = draftFor(day.title);
      const boxes = [...view.querySelectorAll('[data-done]')].filter((cb) => !cb.disabled);
      const val = boxes.some((cb) => !cb.checked);
      boxes.forEach((cb) => {
        cb.checked = val;
        d[cb.dataset.done + '|done'] = val;
        const tr = cb.closest('tr');
        if (tr) tr.classList.toggle('done', val);
      });
      view.querySelectorAll('.lift').forEach((l) => {
        const b = [...l.querySelectorAll('[data-done]')];
        if (b.length) l.classList.toggle('done', b.every((x) => x.checked));
      });
      t.textContent = val ? 'Clear all checks' : 'Check all sets';
      save();
      return;
    }
    if (t.dataset.replace != null) { swapOpen = { day: selectedDay, idx: Number(t.dataset.replace) }; render(); return; }
    if (t.dataset.cancelSwap != null) { swapOpen = null; render(); return; }
    if (t.dataset.timer) { startTimer(t.dataset.label || 'Timer', Number(t.dataset.timer)); return; }
    if (t.dataset.sets) {
      // Adds or removes one set of this lift in the plan (1 to 10 sets).
      const day = state.workoutPlan.days[selectedDay];
      const ex = day.exercises.find((x) => x.exercise_id === t.dataset.sets);
      const next = ex ? Math.min(10, Math.max(1, ex.sets + Number(t.dataset.delta))) : 0;
      if (ex && next !== ex.sets) { ex.sets = next; save(); render(); }
      return;
    }
    if (t.dataset.adjust) {
      // Moves the weight of every set of this lift by the step, and saves it.
      const day = state.workoutPlan.days[selectedDay];
      const id = t.dataset.adjust;
      const ex = day.exercises.find((x) => x.exercise_id === id);
      const d = draftFor(day.title);
      for (let s = 0; ex && s < ex.sets; s++) {
        const wt = view.querySelector('[data-ex="' + id + '"][data-set="' + s + '"][data-f="weight_lb"]');
        if (!wt) continue;
        const next = Math.max(0, (Number(wt.value) || 0) + Number(t.dataset.step));
        wt.value = String(next);
        d[id + '|' + s + '|weight_lb'] = String(next);
      }
      save();
      return;
    }
    if (t.dataset.swapTo) {
      // Changes the planned exercise for this day. Earlier logs keep the exercise they were logged with.
      const day = state.workoutPlan.days[selectedDay];
      day.exercises[Number(t.dataset.swapIdx)].exercise_id = t.dataset.swapTo;
      swapOpen = null;
      save();
      toast('Exercise replaced.');
      render();
      return;
    }
    if (t.dataset.bodymode) { bodyMode = t.dataset.bodymode; renderBody(); return; }
    if (t.dataset.soreness != null && t.dataset.region) {
      const today = todayISO();
      state.soreness = state.soreness || {};
      state.soreness[today] = state.soreness[today] || {};
      state.soreness[today][t.dataset.region] = Number(t.dataset.soreness);
      save(); render(); return;
    }
    if (t.dataset.day != null && t.dataset.day !== '') { selectedDay = Number(t.dataset.day); render(); return; }
    if (t.dataset.import) {
      const kind = t.dataset.import;
      const text = document.getElementById(kind === 'workout' ? 'wp-text' : 'mp-text').value.trim();
      if (!text) { showMsgs(['Paste JSON or choose a file first.'], [], ''); return; }
      importJSON(kind, text);
      return;
    }
    if (t.dataset.have) {
      const k = t.dataset.have;
      if (!state.pantry.includes(k)) state.pantry.push(k);
      save(); render(); return;
    }
    if (t.dataset.unhave) {
      state.pantry = state.pantry.filter((k) => k !== t.dataset.unhave);
      save(); render(); return;
    }
    if (t.dataset.trainingLog) {
      if (!state.workoutPlan) { toast('Import a workout plan first.', 'err'); return; }
      const text = JSON.stringify(L.buildFeedback(state.workoutPlan, state.logs, todayISO(), 14, exName), null, 1);
      const box = document.getElementById('log-box');
      if (box) box.innerHTML = '<textarea id="log-text" readonly style="min-height:120px">' + esc(text) + '</textarea>' +
        '<div class="row" style="margin-top:8px"><button data-copy="log-text">Copy log</button></div>';
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Training log copied.', 'ok'), () => toast('Tap Copy log below.'));
      return;
    }
    if (t.dataset.copy) {
      const el = document.getElementById(t.dataset.copy);
      el.select();
      if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(() => toast('Prompt copied.', 'ok'));
      return;
    }
    if (t.dataset.backup === 'export') {
      const text = JSON.stringify(state, null, 2);
      // Some viewers block file downloads, so also show the backup as text to copy.
      const box = document.getElementById('backup-box');
      if (box) {
        box.innerHTML = '<p class="muted">Copy this text into a note in Files (iCloud Drive) and save it as a .json file.</p>' +
          '<textarea id="backup-text" readonly style="min-height:120px">' + esc(text) + '</textarea>' +
          '<div class="row" style="margin-top:8px"><button data-copy="backup-text">Copy backup</button></div>';
      }
      try { download('workout-backup-' + todayISO() + '.json', text); } catch (e) { /* downloads may be blocked */ }
      return;
    }
    if (t.dataset.delLog !== undefined) {
      const log = state.logs[Number(t.dataset.delLog)];
      if (log && confirm('Delete the ' + log.day + ' workout from ' + log.date + '? This cannot be undone.')) {
        state.logs.splice(Number(t.dataset.delLog), 1); save(); render(); toast('Workout deleted.', 'ok');
      }
      return;
    }
    const anim = t.closest ? t.closest('.anim') : null;
    if (anim && anim.dataset.n === '2') {
      if (anim.dataset.paused) delete anim.dataset.paused; else anim.dataset.paused = '1';
    }
  });

  view.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.done) {
      // Ticking a set saves with the session draft and marks the lift done once every set is ticked.
      const day = state.workoutPlan.days[selectedDay];
      draftFor(day.title)[t.dataset.done + '|done'] = t.checked;
      save();
      const row = t.closest('tr');
      if (row) row.classList.toggle('done', t.checked);
      const lift = t.closest('.lift');
      if (lift) lift.classList.toggle('done', [...lift.querySelectorAll('input[data-done]')].every((x) => x.checked));
      return;
    }
    if (t.dataset.target) {
      const day = state.workoutPlan.days[selectedDay];
      const ex = day.exercises.find((x) => x.exercise_id === t.dataset.target);
      if (ex) { if (t.value === '') delete ex.target_lb; else ex.target_lb = Number(t.value); save(); }
      return;
    }
    if (t.dataset.stretch) {
      doneStretch[t.dataset.stretch] = t.checked;
      draftFor(t.dataset.stretch.split('|')[0])['stretch|' + t.dataset.stretch] = t.checked;
      save();
      const row = t.closest('.lift');
      if (row) row.classList.toggle('done', t.checked);
      return;
    }
    if (t.id === 'meal-unit') { mealUnit = t.value; state.mealUnit = mealUnit; save(); renderMeals(); return; }
    if (t.id === 'shop-unit') { mealUnit = t.value; state.mealUnit = mealUnit; save(); renderShopping(); return; }
    if (t.dataset.check) { state.checked[t.dataset.check] = t.checked; save(); renderShopping(); return; }
    if (t.id === 'prog-ex') { state.progressEx = t.value; save(); renderProgress(); return; }
    if (t.id === 'cmp-a') { state.cmpA = t.value; save(); renderProgress(); return; }
    if (t.id === 'cmp-b') { state.cmpB = t.value; save(); renderProgress(); return; }
    if (t.dataset.file) {
      const file = t.files && t.files[0];
      if (!file) return;
      file.text().then((text) => {
        if (t.dataset.file === 'backup') {
          try {
            const restored = JSON.parse(text);
            if (!restored || !Array.isArray(restored.logs)) throw new Error('bad');
            state = Object.assign(blank(), restored); save(); toast('Backup restored.', 'ok'); render();
          } catch (e) { showMsgs(['That file is not a valid backup.'], [], ''); }
        } else {
          const ta = document.getElementById(t.dataset.file === 'workout' ? 'wp-text' : 'mp-text');
          if (ta) ta.value = text;
          importJSON(t.dataset.file, text);
        }
      });
    }
  });

  view.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.id === 'prog-type') {
      const sel = document.getElementById('prog-ex');
      if (sel) sel.innerHTML = progressOptions(el.value, state.progressEx);
      return;
    }
    if (el.dataset && el.dataset.f && el.dataset.ex && state.workoutPlan) {
      draftFor(state.workoutPlan.days[selectedDay].title)[el.dataset.ex + '|' + el.dataset.set + '|' + el.dataset.f] = el.value;
      save();
      return;
    }
    if (el.id === 'log-date' && state.workoutPlan) {
      draftFor(state.workoutPlan.days[selectedDay].title).__date = el.value;
      save();
      return;
    }
    if (ev.target.id === 'lib-search') {
      const pos = ev.target.selectionStart;
      search = ev.target.value;
      renderWorkout();
      const again = document.getElementById('lib-search');
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    }
  });

  // ---- Timers: one at a time, shown above the tabs so they keep running while you move around the app ----
  let timer = null; // { label, endAt, total }
  function fmtTime(sec) { return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function startTimer(label, sec) { timer = { label, endAt: Date.now() + sec * 1000, total: sec }; drawTimer(); }
  function drawTimer() {
    const bar = document.getElementById('timer-bar');
    if (!bar) return;
    if (!timer) { bar.hidden = true; return; }
    const left = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    if (left === 0) {
      const done = timer.label;
      timer = null;
      bar.hidden = true;
      if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
      toast('Done: ' + done, 'ok');
      return;
    }
    bar.hidden = false;
    document.getElementById('timer-label').textContent = timer.label;
    document.getElementById('timer-time').textContent = fmtTime(left);
  }
  function setupTimerBar() {
    const bar = document.createElement('div');
    bar.id = 'timer-bar';
    bar.className = 'timer-bar';
    bar.hidden = true;
    bar.innerHTML = '<span id="timer-label"></span><strong id="timer-time"></strong>' +
      '<button id="timer-add">+15 s</button><button id="timer-stop">Stop</button>';
    document.body.appendChild(bar);
    document.getElementById('timer-add').addEventListener('click', () => { if (timer) { timer.endAt += 15000; drawTimer(); } });
    document.getElementById('timer-stop').addEventListener('click', () => { timer = null; drawTimer(); });
    setInterval(drawTimer, 250);
  }

  // Plans sync to workout_plans under an anonymous account that belongs to this phone. Plans made in Claude
  // appear here on the next open; plan edits made on this phone are uploaded as a new row a moment later.
  // If anonymous sign-in is off or the phone is offline, the plan simply stays on the phone.
  function storeSession(j) {
    if (!j || !j.access_token || !j.user) return null;
    state.session = { access_token: j.access_token, refresh_token: j.refresh_token, user_id: j.user.id, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
    save();
    return state.session;
  }

  let sessionPromise = null;
  function getSession() {
    if (!sessionPromise) sessionPromise = fetchSession().finally(() => { sessionPromise = null; });
    return sessionPromise;
  }

  async function fetchSession() {
    if (!SUPABASE) return null;
    const s = state.session;
    if (s && s.expires_at > Date.now() + 60000) return s;
    if (s && s.refresh_token) {
      const r = await fetch(SUPABASE.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: { apikey: SUPABASE.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      if (r.ok) return storeSession(await r.json());
    }
    const r = await fetch(SUPABASE.url + '/auth/v1/signup', {
      method: 'POST', headers: { apikey: SUPABASE.key, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!r.ok) return null;
    return storeSession(await r.json());
  }

  function authHeaders(s) {
    return { apikey: SUPABASE.key, Authorization: 'Bearer ' + s.access_token };
  }

  // Loads the newest plan for this phone's account if it is not the one on the phone.
  async function loadLatestPlan() {
    if (!SUPABASE || !index) return;
    const s = await getSession();
    if (!s) return;
    const r = await fetch(SUPABASE.url + '/rest/v1/workout_plans?select=id,plan&user_id=eq.' + s.user_id + '&order=created_at.desc&limit=1', {
      headers: authHeaders(s),
    });
    if (!r.ok) return;
    const rows = await r.json();
    if (!rows.length || rows[0].id === state.planId) return;
    const v = L.validateWorkoutPlan(rows[0].plan, index);
    if (!v.ok) return;
    state.workoutPlan = v.plan;
    state.planId = rows[0].id;
    state.syncedPlan = JSON.stringify(v.plan);
    selectedDay = Math.max(0, nextUnloggedDay());
    save();
    render();
    toast('New workout plan loaded.', 'ok');
  }

  // Uploads the plan on this phone when it differs from the last one saved to the account.
  function schedulePlanSync() {
    if (!window.SUPABASE_CONFIG || !state.workoutPlan) return;
    clearTimeout(planSyncTimer);
    planSyncTimer = setTimeout(syncPlan, 1500);
  }

  async function syncPlan() {
    if (!SUPABASE || !index || !state.workoutPlan) return;
    const json = JSON.stringify(state.workoutPlan);
    if (json === state.syncedPlan) return;
    const s = await getSession();
    if (!s) return;
    const r = await fetch(SUPABASE.url + '/rest/v1/workout_plans', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=representation' }, authHeaders(s)),
      body: JSON.stringify({ user_id: s.user_id, name: state.workoutPlan.name || 'Workout plan', plan: Object.assign({ type: 'workout_plan', version: 1 }, state.workoutPlan) }),
    });
    if (!r.ok) return;
    const rows = await r.json();
    state.planId = rows[0].id;
    state.syncedPlan = json;
    save();
  }

  // ---- boot ----------------------------------------------------------------
  setupTimerBar();
  flushUploads();
  fetch('data/exercises.json')
    .then((r) => r.json())
    .then((data) => {
      exercises = data;
      index = L.buildLibraryIndex(exercises);
      loadLatestPlan().then(() => schedulePlanSync()).catch(() => schedulePlanSync());
      // First open with no workout plan: load the starter plan once. Plans already on the device are never replaced.
      if (!state.workoutPlan && !state.starterSeen) {
        fetch('data/starter_plan.json')
          .then((r) => r.json())
          .then((obj) => {
            state.starterSeen = true;
            const r = L.validateWorkoutPlan(obj, index);
            if (r.ok && !state.workoutPlan) { state.workoutPlan = r.plan; selectedDay = 0; toast('Starter workout loaded. Replace or import your own in Import.', 'ok'); }
            save();
            render();
          })
          .catch(() => { render(); });
        return;
      }
      selectedDay = Math.max(0, nextUnloggedDay());
      render();
    })
    .catch(() => { view.innerHTML = '<div class="msg err">Could not load the exercise library.</div>'; });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support optional */ });
  }
  const startTab = (location.hash || '').replace('#', '');
  setTab(TITLES[startTab] ? startTab : 'workout');
})();
