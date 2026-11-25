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
  let bodyMode = 'figure';

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
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('Storage is full. Export a backup and remove old logs.', 'err'); }
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function exName(id) {
    const e = index && index.byId.get(id);
    return e ? e.name : id;
  }
  function toast(text, kind) {
    const box = document.createElement('div');
    box.className = 'msg ' + (kind || 'ok');
    box.textContent = text;
    view.prepend(box);
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
        html += '<button class="chip ' + (i === selectedDay ? 'on' : '') + '" data-day="' + i + '">' + esc(d.day || 'Day ' + (i + 1)) + '</button>';
      });
      html += '</div>';
      const day = plan.days[selectedDay];
      html += '<h2>' + esc(day.title || 'Today') + '</h2>';
      html += stretchSection('warmup', day, plan.cooldown || {});
      html += '<h2>Lifts</h2>';
      day.exercises.forEach((ex, i) => html += exerciseCard(ex, i));
      if (!plan.cooldown || plan.cooldown.enabled !== false) html += stretchSection('cooldown', day, plan.cooldown || {});
      html += logSession(day);
    }
    html += librarySection();
    view.innerHTML = html;
  }

  function exerciseCard(ex, i) {
    const e = index.byId.get(ex.exercise_id);
    const muscles = e ? [].concat(e.primaryMuscles, e.secondaryMuscles).map((m) => '<span class="pill">' + esc(m) + '</span>').join('') : '';
    const broken = !e;
    return '<div class="card exercise">' +
      '<h3>' + (i + 1) + '. ' + esc(broken ? ex.exercise_id : e.name) + '</h3>' +
      '<div class="meta">' + esc(ex.sets) + ' sets × ' + esc(ex.reps || '?') + ' reps' +
      (ex.rest_sec ? ' · rest ' + esc(ex.rest_sec) + 's' : '') + '</div>' +
      (ex.notes ? '<div class="meta">' + esc(ex.notes) + '</div>' : '') +
      '<div style="margin:8px 0">' + (e ? animHTML(e) : '') + '</div>' +
      '<div>' + muscles + '</div>' +
      (e && e.instructions && e.instructions.length
        ? '<details><summary>How to do it</summary><ol>' + e.instructions.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol></details>'
        : '') +
      '</div>';
  }

  function stretchSection(kind, day, cfg) {
    const ids = day.exercises.map((e) => e.exercise_id);
    const isWarm = kind === 'warmup';
    const picks = isWarm ? L.warmupFor(ids, exercises) : L.cooldownFor(ids, exercises, { hold_sec: cfg.hold_sec });
    if (!picks.length) return '';
    const heading = isWarm ? 'Warmup' : 'Cooldown stretches';
    const intro = isWarm
      ? 'Do these before your first lift: a few minutes of light cardio, then slow reps of each move.'
      : 'One stretch for each muscle you trained. Hold each for about ' + esc(cfg.hold_sec) + ' seconds.';
    let html = '<h2>' + heading + '</h2><p class="muted">' + intro + '</p>';
    picks.forEach((p, i) => {
      const key = day.title + '|' + kind + '|' + p.exercise.id;
      const done = !!doneStretch[key];
      const meta = isWarm
        ? (p.minutes ? p.minutes + ' min easy pace' : (p.reps || 10) + ' slow reps each side')
        : 'For ' + p.muscle + ' · hold ' + cfg.hold_sec + ' s';
      html += '<div class="card exercise' + (done ? ' done' : '') + '">' +
        '<label class="check" style="margin:0 0 8px"><input type="checkbox" data-stretch="' + esc(key) + '" ' + (done ? 'checked' : '') + '>' +
        '<h3 style="margin:0">' + (i + 1) + '. ' + esc(p.exercise.name) + '</h3></label>' +
        '<div class="meta">' + (isWarm ? '' : esc(p.muscle) + ' · ') + esc(meta) + '</div>' +
        '<div style="margin:8px 0">' + animHTML(p.exercise) + '</div>' +
        (p.exercise.instructions && p.exercise.instructions.length
          ? '<details><summary>How to do it</summary><ol>' + p.exercise.instructions.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol></details>'
          : '') +
        '</div>';
    });
    return html;
  }

  function lastWeightFor(exId) {
    const rows = L.exerciseHistory(state.logs, exId);
    return rows.length ? rows[rows.length - 1].topWeight : '';
  }

  function logSession(day) {
    const rows = day.exercises.map((ex) => {
      const sets = [];
      const w = lastWeightFor(ex.exercise_id);
      for (let s = 0; s < ex.sets; s++) {
        sets.push('<tr><td>Set ' + (s + 1) + '</td>' +
          '<td><input class="num" inputmode="numeric" data-ex="' + esc(ex.exercise_id) + '" data-set="' + s + '" data-f="reps" value="' + esc(parseInt(ex.reps, 10) || '') + '" placeholder="reps"></td>' +
          '<td><input class="num" inputmode="decimal" data-ex="' + esc(ex.exercise_id) + '" data-set="' + s + '" data-f="weight_lb" value="' + esc(w) + '" placeholder="lb"></td></tr>');
      }
      return '<h3 style="margin-top:12px">' + esc(exName(ex.exercise_id)) + '</h3><table><tbody>' + sets.join('') + '</tbody></table>';
    }).join('');
    return '<h2>Log this workout</h2><div class="card">' +
      '<label>Date</label><input type="date" id="log-date" value="' + todayISO() + '">' +
      rows +
      '<div class="row" style="margin-top:12px"><button class="primary" id="save-session" data-day="' + selectedDay + '">Save workout</button></div>' +
      '</div>';
  }

  function saveSession(dayIdx) {
    const day = state.workoutPlan.days[dayIdx];
    const date = document.getElementById('log-date').value || todayISO();
    const entries = day.exercises.map((ex) => {
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
    state.logs.push({ date, day: day.title, entries, warmup, cooldown });
    save();
    Object.keys(doneStretch).forEach((k) => { if (k.startsWith(prefix)) delete doneStretch[k]; });
    toast('Saved ' + date + ' workout.', 'ok');
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
  function renderProgress() {
    const ids = [...new Set(state.logs.flatMap((l) => l.entries.map((e) => e.exercise_id)))];
    if (!ids.length) {
      view.innerHTML = '<div class="card"><h3>No workouts logged yet</h3><p class="muted">Save a workout on the Workout tab and it will show up here.</p></div>';
      return;
    }
    const selected = ids.includes(state.progressEx) ? state.progressEx : ids[0];
    const rows = L.exerciseHistory(state.logs, selected);
    const maxW = Math.max(1, ...rows.map((r) => r.topWeight));
    let html = '<label>Exercise</label><select id="prog-ex">' +
      ids.map((id) => '<option value="' + esc(id) + '"' + (id === selected ? ' selected' : '') + '>' + esc(exName(id)) + '</option>').join('') +
      '</select>';
    html += '<h2>Weight lifted over time</h2><div class="card">';
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
    abs: 'Abs', chest: 'Chest', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms',
    quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', adductors: 'Inner thigh', calves: 'Calves',
    lats: 'Lats', upper_back: 'Upper back', lower_back: 'Lower back', neck: 'Neck',
  };
  let bodyMounted = false;

  function renderBody() {
    const load = L.weeklyLoad(state.logs, exercises, todayISO(), 7);
    const sore = L.autoSoreness(state.logs, exercises, todayISO());
    const chip = (k, label) => '<button class="chip ' + (bodyMode === k ? 'on' : '') + '" data-bodymode="' + k + '">' + label + '</button>';
    view.innerHTML =
      '<div class="row" style="margin-bottom:8px">' + chip('figure', 'Figure') + chip('heat', 'Training') + chip('sore', 'Soreness') + '</div>' +
      '<div class="card" style="padding:6px"><div id="body-canvas" style="height:440px;touch-action:none"></div></div>' +
      '<div id="body-menu"></div>' +
      '<div id="body-panel"></div>' +
      '<p class="muted">Drag to turn the figure. Tap a muscle to see its sets or log soreness. This is a stylised figure, not medical imaging. If pain is sharp, lasts, or gets worse, see a doctor or physiotherapist.</p>';
    window.BodyMap.render(document.getElementById('body-canvas'), {
      mode: bodyMode === 'figure' ? 'plain' : bodyMode, load, sore,
      onTap: (region) => showRegion(region, load, sore),
    });
    renderBodyMenu(load, sore);
  }

  // Each colouring mode has its own menu: a legend and the muscles it applies to.
  function renderBodyMenu(load, sore) {
    const el = document.getElementById('body-menu');
    if (!el) return;
    const name = (r) => esc(REGION_NAMES[r] || r);
    if (bodyMode === 'heat') {
      const rows = Object.entries(load).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      el.innerHTML = '<div class="card"><h3>Training, last 7 days</h3>' +
        '<div class="ramp"></div><div class="row muted"><span>Fewer sets</span><span style="margin-left:auto">More sets</span></div>' +
        (rows.length
          ? rows.map(([r, v]) => '<div class="row"><span>' + name(r) + '</span><span style="margin-left:auto">' + v + ' sets</span></div>').join('')
          : '<p class="muted">No sets logged in the last 7 days.</p>') +
        '</div>';
    } else if (bodyMode === 'sore') {
      const levels = ['', 'Mild', 'Moderate', 'Severe'];
      const colors = ['', '#f0b429', '#f0893b', '#ef4444'];
      const rows = Object.entries(sore).filter(([, s]) => s && s.level > 0).sort((a, b) => b[1].level - a[1].level);
      el.innerHTML = '<div class="card"><h3>Soreness (estimated)</h3>' +
        '<p class="muted">Worked out automatically from your completed workouts. Muscles trained one day ago are the most sore, and the effect fades after three days.</p>' +
        [1, 2, 3].map((i) => '<span class="swatch" style="background:' + colors[i] + '"></span>' + levels[i]).join('&nbsp;&nbsp;&nbsp;') +
        (rows.length
          ? rows.map(([r, s]) => '<div class="row"><span>' + name(r) + '</span><span style="margin-left:auto">' + levels[s.level] + '</span></div>').join('')
          : '<p class="muted">No soreness estimated right now.</p>') +
        '</div>';
    } else {
      el.innerHTML = '';
    }
  }

  function showRegion(region, load, sore) {
    const panel = document.getElementById('body-panel');
    if (!panel) return;
    const levels = ['None', 'Mild', 'Moderate', 'Severe'];
    const level = sore[region] ? sore[region].level : 0;
    panel.innerHTML = '<div class="card"><h3>' + esc(REGION_NAMES[region] || region) + '</h3>' +
      '<p class="muted">Sets in the last 7 days: ' + (load[region] || 0) + '</p>' +
      '<p class="muted">Estimated soreness: ' + levels[level] + '</p></div>';
  }

  // Import & backup --------------------------------------------------------
  const PROMPT = [
    'Plan my week using this exact JSON format, and output only the JSON.',
    'For exercises, use names exactly as they appear in the attached exercise-names.txt list.',
    '',
    'Workout plan format:',
    '{"type":"workout_plan","version":1,"name":"...","days":[{"day":"Mon","title":"Upper A","exercises":[{"exercise":"Barbell Bench Press - Medium Grip","sets":4,"reps":"6-8","rest_sec":120,"notes":""}]}]}',
    '',
    'Meal plan format (grams only, amount_g is required):',
    '{"type":"meal_plan","version":1,"days":[{"date":"2026-11-25","meals":[{"name":"Oatmeal","servings":1,"ingredients":[{"name":"rolled oats","amount_g":80}]}]}]}',
  ].join('\n');

  function renderData() {
    view.innerHTML =
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
      '<h2>Backup</h2><div class="card">' +
      '<p class="muted">Save a backup file to iCloud Drive from the share sheet (Save to Files).</p>' +
      '<div class="row"><button class="primary" data-backup="export">Export backup</button>' +
      '<label class="btn" style="margin:0">Restore backup<input type="file" accept="application/json,.json" data-file="backup" hidden></label></div>' +
      '<div class="row" style="margin-top:12px"><button class="bad" style="color:var(--bad)" data-backup="clear">Erase all data on this phone</button></div></div>' +
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
    if (t.dataset.bodymode) { bodyMode = t.dataset.bodymode; renderBody(); return; }
    if (t.dataset.soreness != null && t.dataset.region) {
      const today = todayISO();
      state.soreness[today] = state.soreness[today] || {};
      const level = Number(t.dataset.soreness);
      if (level === 0) delete state.soreness[today][t.dataset.region];
      else state.soreness[today][t.dataset.region] = level;
      save(); renderBody(); return;
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
    if (t.dataset.backup === 'clear') {
      if (confirm('Erase all plans, logs and pantry on this phone? Export a backup first.')) {
        state = blank(); save(); render(); toast('All data erased.', 'ok');
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
    if (t.dataset.stretch) {
      doneStretch[t.dataset.stretch] = t.checked;
      const card = t.closest('.card');
      if (card) card.classList.toggle('done', t.checked);
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
    if (ev.target.id === 'lib-search') {
      const pos = ev.target.selectionStart;
      search = ev.target.value;
      renderWorkout();
      const again = document.getElementById('lib-search');
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    }
  });

  // ---- boot ----------------------------------------------------------------
  fetch('data/exercises.json')
    .then((r) => r.json())
    .then((data) => {
      exercises = data;
      index = L.buildLibraryIndex(exercises);
      render();
    })
    .catch(() => { view.innerHTML = '<div class="msg err">Could not load the exercise library.</div>'; });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support optional */ });
  }
  const startTab = (location.hash || '').replace('#', '');
  setTab(TITLES[startTab] ? startTab : 'workout');
})();
