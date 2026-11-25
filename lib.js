// Pure logic for the workout & meal app. No DOM access, so it can be tested in Node.
(function (root) {
  'use strict';

  // ---- Units -------------------------------------------------------------
  // Grams are the stored unit for food. Weight lifted is stored in pounds.
  const G_PER_OZ = 28.3495;
  const G_PER_LB = 453.592;
  const ML_PER_CUP = 236.588; // US customary cup
  const ML_PER_TBSP = ML_PER_CUP / 16;
  const ML_PER_TSP = ML_PER_CUP / 48;

  // Approximate grams per US cup for common ingredients. Volume conversions
  // are only as good as these values: 1 cup of flour is not 1 cup of water.
  // Keys are lowercase. A lookup matches the longest key contained in the name.
  const DENSITY_G_PER_CUP = {
    'all-purpose flour': 120,
    'flour': 120,
    'bread flour': 127,
    'whole wheat flour': 120,
    'granulated sugar': 200,
    'sugar': 200,
    'brown sugar': 213,
    'powdered sugar': 120,
    'icing sugar': 120,
    'rolled oats': 90,
    'oats': 90,
    'oat': 90,
    'rice': 185,
    'butter': 227,
    'water': 237,
    'milk': 245,
    'whole milk': 245,
    'yogurt': 245,
    'greek yogurt': 245,
    'olive oil': 216,
    'vegetable oil': 218,
    'oil': 216,
    'honey': 340,
    'maple syrup': 322,
    'peanut butter': 258,
    'salt': 288,
    'table salt': 288,
    'cocoa powder': 86,
    'cheese': 113, // grated cheddar; varies a lot
    'almonds': 143,
    'cashews': 135,
    'peas': 145,
  };

  function densityFor(name) {
    const n = normalizeName(name);
    let best = null;
    for (const key of Object.keys(DENSITY_G_PER_CUP)) {
      if (n.includes(key) && (!best || key.length > best.length)) best = key;
    }
    return best ? DENSITY_G_PER_CUP[best] : null;
  }

  function normalizeName(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Convert grams into a display unit. Returns { value, unit } or null when a
  // volume unit is requested for an ingredient with no density entry.
  function convertGrams(grams, ingredientName, unit) {
    if (!isFinite(grams)) return null;
    switch (unit) {
      case 'g': return { value: grams, unit: 'g' };
      case 'kg': return { value: grams / 1000, unit: 'kg' };
      case 'oz': return { value: grams / G_PER_OZ, unit: 'oz' };
      case 'lb': return { value: grams / G_PER_LB, unit: 'lb' };
      case 'cup':
      case 'tbsp':
      case 'tsp': {
        const gPerCup = densityFor(ingredientName);
        if (!gPerCup) return null;
        const cups = grams / gPerCup;
        const perUnit = { cup: 1, tbsp: 1 / 16, tsp: 1 / 48 }[unit];
        return { value: cups / perUnit, unit };
      }
      default: return null;
    }
  }

  // Format a converted value for display. Uses the closest sensible rounding.
  function formatAmount(conv) {
    if (!conv) return '';
    const v = conv.value;
    const rounded = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
    return rounded + ' ' + conv.unit;
  }

  // ---- Shopping sections -------------------------------------------------
  const SECTION_RULES = [
    ['Produce', ['apple', 'banana', 'berry', 'berries', 'spinach', 'lettuce', 'onion', 'garlic', 'tomato', 'pepper', 'carrot', 'broccoli', 'potato', 'lemon', 'lime', 'avocado', 'cucumber', 'kale', 'mushroom', 'zucchini', 'cabbage']],
    ['Meat & fish', ['chicken', 'beef', 'pork', 'turkey', 'salmon', 'tuna', 'fish', 'shrimp', 'bacon', 'sausage', 'mince', 'ground']],
    ['Dairy & eggs', ['milk', 'butter', 'cheese', 'yogurt', 'egg', 'cream']],
    ['Bakery', ['bread', 'tortilla', 'bagel', 'pita', 'wrap']],
    ['Frozen', ['frozen']],
    ['Pantry', ['flour', 'sugar', 'rice', 'oats', 'pasta', 'oil', 'honey', 'salt', 'beans', 'lentil', 'oat', 'syrup', 'spice', 'nuts', 'almond', 'peanut']],
  ];

  function sectionFor(name) {
    const n = normalizeName(name);
    for (const [section, words] of SECTION_RULES) {
      if (words.some((w) => n.includes(w))) return section;
    }
    return 'Other';
  }

  // ---- Validation ----------------------------------------------------------
  // libIndex: { byId: Map, byName: Map(lowercase name -> id) }
  function buildLibraryIndex(exercises) {
    const byId = new Map();
    const byName = new Map();
    for (const e of exercises) {
      byId.set(e.id, e);
      byName.set(normalizeName(e.name), e.id);
    }
    return { byId, byName };
  }

  function resolveExercise(entry, index) {
    if (entry.exercise_id && index.byId.has(entry.exercise_id)) return entry.exercise_id;
    const name = entry.exercise || entry.name;
    if (name && index.byName.has(normalizeName(name))) return index.byName.get(normalizeName(name));
    return null;
  }

  function validateWorkoutPlan(obj, index) {
    const errors = [];
    const warnings = [];
    if (!obj || obj.type !== 'workout_plan') errors.push('Not a workout plan: "type" must be "workout_plan".');
    if (!obj || !Array.isArray(obj.days)) errors.push('"days" must be a list.');
    if (errors.length) return { ok: false, errors, warnings, plan: null };

    const days = obj.days.map((d, di) => {
      const label = 'Day ' + (di + 1) + (d.day ? ' (' + d.day + ')' : '');
      const exercises = (d.exercises || []).map((ex, ei) => {
        const tag = label + ', exercise ' + (ei + 1);
        const id = resolveExercise(ex, index);
        if (!id) {
          errors.push(tag + ': no exercise matches "' + (ex.exercise || ex.exercise_id || '') + '". Use a name from exercise-names.txt.');
        }
        const sets = Number(ex.sets);
        if (!(sets > 0)) errors.push(tag + ': "sets" must be a number above 0.');
        const tgt = ex.target_lb == null || ex.target_lb === '' ? null : Number(ex.target_lb);
        if (tgt !== null && !(tgt > 0)) warnings.push(tag + ': "target_lb" should be a weight above 0, so it was ignored.');
        return {
          exercise_id: id,
          sets: sets || 0,
          reps: ex.reps == null ? '' : String(ex.reps),
          rest_sec: ex.rest_sec == null ? null : Number(ex.rest_sec),
          target_lb: tgt > 0 ? tgt : null,
          notes: ex.notes || '',
        };
      });
      return { day: d.day || '', title: d.title || '', exercises };
    });

    const cd = obj.cooldown || {};
    const cooldown = {
      enabled: cd.enabled !== false,
      hold_sec: Number(cd.hold_sec) > 0 ? Number(cd.hold_sec) : 30,
    };
    return { ok: errors.length === 0, errors, warnings, plan: { name: obj.name || 'Workout plan', days, cooldown } };
  }

  function validateMealPlan(obj) {
    const errors = [];
    const warnings = [];
    if (!obj || obj.type !== 'meal_plan') errors.push('Not a meal plan: "type" must be "meal_plan".');
    if (!obj || !Array.isArray(obj.days)) errors.push('"days" must be a list.');
    if (errors.length) return { ok: false, errors, warnings, plan: null };

    obj.days.forEach((d, di) => {
      const label = 'Day ' + (di + 1) + (d.date ? ' (' + d.date + ')' : '');
      (d.meals || []).forEach((m) => {
        if (!m.name) errors.push(label + ': a meal has no name.');
        (m.ingredients || []).forEach((ing) => {
          if (!ing.name) errors.push(label + ', ' + (m.name || 'meal') + ': an ingredient has no name.');
          const g = Number(ing.amount_g);
          if (!(g > 0)) {
            errors.push(label + ', ' + (m.name || 'meal') + ': "' + (ing.name || '?') + '" needs "amount_g" above 0.');
          }
        });
      });
    });

    return { ok: errors.length === 0, errors, warnings, plan: errors.length ? null : { days: obj.days } };
  }

  // ---- Shopping list -------------------------------------------------------
  // Combines ingredients across all meals in the plan. Names are merged by
  // normalized name. Items in `pantry` (a Set of normalized names) are skipped.
  function buildShoppingList(mealPlan, pantry) {
    const totals = new Map();
    for (const day of mealPlan.days || []) {
      for (const meal of day.meals || []) {
        for (const ing of meal.ingredients || []) {
          const key = normalizeName(ing.name);
          if (!key) continue;
          const prev = totals.get(key) || { name: ing.name.trim(), grams: 0 };
          prev.grams += Number(ing.amount_g) || 0;
          totals.set(key, prev);
        }
      }
    }
    const sections = new Map();
    for (const [key, item] of totals) {
      if (pantry && pantry.has(key)) continue;
      const section = sectionFor(item.name);
      if (!sections.has(section)) sections.set(section, []);
      sections.get(section).push({ key, name: item.name, grams: Math.round(item.grams) });
    }
    const order = SECTION_RULES.map((r) => r[0]).concat(['Other']);
    return order.filter((s) => sections.has(s)).map((s) => ({
      section: s,
      items: sections.get(s).sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  // ---- Warmup and cooldown -------------------------------------------------
  // Picks one stretch-category move per muscle worked in a day.
  // Cooldown: static stretches. Warmup: dynamic moves plus one light cardio move.
  const STRETCH_SKIP = /circle|smr|roll|hop|jump|flip/i;
  const DYNAMIC_INCLUDE = /circle|swing|kick|raise|lunge|rotat|twist|cat|arm|hip|leg/i;
  const CARDIO_PREFERENCE = ['Bicycling, Stationary', 'Rowing, Stationary', 'Elliptical Trainer', 'Walking, Treadmill', 'Jogging, Treadmill', 'Bicycling'];
  const MUSCLE_FALLBACK = { traps: ['middle back', 'neck'] };

  function workedMuscles(dayExerciseIds, byId) {
    const muscles = [];
    for (const id of dayExerciseIds) {
      const ex = byId.get(id);
      if (!ex) continue;
      for (const m of ex.primaryMuscles || []) if (!muscles.includes(m)) muscles.push(m);
    }
    return muscles;
  }

  function pickPerMuscle(muscles, stretches, max, include) {
    const picks = [];
    const used = new Set();
    for (const muscle of muscles) {
      if (picks.length >= max) break;
      const targets = [muscle].concat(MUSCLE_FALLBACK[muscle] || []);
      let choice = null;
      for (const pass of include ? [true, false] : [false]) {
        for (const t of targets) {
          const options = stretches.filter((e) => !used.has(e.id) && (e.primaryMuscles || []).includes(t) &&
            (!pass || include.test(e.name)));
          options.sort((a, b) => {
            const sa = /stretch/i.test(a.name) ? 0 : 1;
            const sb = /stretch/i.test(b.name) ? 0 : 1;
            return sa - sb || a.name.length - b.name.length || a.name.localeCompare(b.name);
          });
          if (options.length) { choice = options[0]; break; }
        }
        if (choice) break;
      }
      if (choice) { used.add(choice.id); picks.push({ muscle, exercise: choice }); }
    }
    return picks;
  }

  function cooldownFor(dayExerciseIds, exercises, opts) {
    const cfg = Object.assign({ hold_sec: 30, max: 8 }, opts || {});
    const byId = new Map(exercises.map((e) => [e.id, e]));
    const stretches = exercises.filter((e) => e.category === 'stretching' && !STRETCH_SKIP.test(e.name));
    return pickPerMuscle(workedMuscles(dayExerciseIds, byId), stretches, cfg.max, null)
      .map((p) => Object.assign(p, { hold_sec: cfg.hold_sec }));
  }

  function warmupFor(dayExerciseIds, exercises, opts) {
    const cfg = Object.assign({ max: 4 }, opts || {});
    const byId = new Map(exercises.map((e) => [e.id, e]));
    const cardio = CARDIO_PREFERENCE.map((n) => exercises.find((e) => e.name === n)).find(Boolean);
    const stretches = exercises.filter((e) => e.category === 'stretching' && !STRETCH_SKIP.test(e.name));
    const picks = pickPerMuscle(workedMuscles(dayExerciseIds, byId), stretches, cfg.max - (cardio ? 1 : 0), DYNAMIC_INCLUDE);
    const out = [];
    if (cardio) out.push({ muscle: 'cardio', exercise: cardio, minutes: 3 });
    return out.concat(picks.map((p) => Object.assign(p, { reps: 10 })));
  }

  // Exercises that can replace a planned one: lifts that work at least one of the same primary muscles.
  // Best matches first (shared primary muscles count most, then shared secondary, then the same equipment).
  function replacementsFor(exerciseId, exercises, excludeIds, limit) {
    const from = exercises.find((e) => e.id === exerciseId);
    if (!from) return [];
    const skip = new Set(excludeIds || []); skip.add(exerciseId);
    const prim = new Set(from.primaryMuscles || []);
    const sec = new Set([].concat(from.secondaryMuscles || [], from.primaryMuscles || []));
    const scored = [];
    for (const e of exercises) {
      if (skip.has(e.id) || e.category !== 'strength') continue;
      const sharedPrimary = (e.primaryMuscles || []).filter((m) => prim.has(m)).length;
      if (!sharedPrimary) continue;
      const sharedSecondary = (e.secondaryMuscles || []).filter((m) => sec.has(m)).length;
      const score = sharedPrimary * 2 + sharedSecondary + (e.equipment === from.equipment ? 0.5 : 0);
      scored.push({ e, score });
    }
    scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
    return scored.slice(0, limit || 12).map((x) => x.e);
  }

  // ---- Body map: muscle regions --------------------------------------------
  // Maps the dataset's muscle names onto the regions shown on the body map.
  const REGION_OF = {
    abdominals: 'abs', obliques: 'obliques', chest: 'chest', shoulders: 'shoulders', biceps: 'biceps', triceps: 'triceps',
    forearms: 'forearms', quadriceps: 'quads', hamstrings: 'hamstrings', glutes: 'glutes', abductors: 'glutes',
    calves: 'calves', adductors: 'adductors', lats: 'lats', 'middle back': 'upper_back', traps: 'upper_back',
    'lower back': 'lower_back', neck: 'neck',
  };

  // Sets per region in the last `days` days, counted from logged sets.
  function weeklyLoad(logs, exercises, todayISO, days) {
    const byId = new Map(exercises.map((e) => [e.id, e]));
    const since = shiftISO(todayISO, -(days - 1));
    const load = {};
    for (const log of logs) {
      if (log.date < since || log.date > todayISO) continue;
      for (const entry of log.entries || []) {
        const ex = byId.get(entry.exercise_id);
        if (!ex) continue;
        const sets = (entry.sets || []).filter((x) => Number(x.reps) > 0).length;
        for (const m of ex.primaryMuscles || []) {
          const r = REGION_OF[m];
          if (r) load[r] = (load[r] || 0) + sets;
        }
      }
    }
    return load;
  }

  // Latest soreness level (0-3) per region, from entries no older than `days` days.
  function latestSoreness(sorenessByDate, todayISO, days) {
    const since = shiftISO(todayISO, -(days - 1));
    const out = {};
    const dates = Object.keys(sorenessByDate || {}).filter((d) => d >= since && d <= todayISO).sort();
    for (const d of dates) {
      for (const [region, level] of Object.entries(sorenessByDate[d])) out[region] = { level, date: d };
    }
    return out;
  }

  // Estimated soreness from completed workouts. Sets count most 1 day after training and
  // less on the days either side. Returns { region: { level: 1-3, score } } for muscles that are sore.
  function autoSoreness(logs, exercises, todayISO) {
    const WEIGHT = [0, 1.0, 0.7, 0.3]; // age in days: 0 (today, no soreness yet), 1, 2, 3
    const score = {};
    for (let age = 0; age < WEIGHT.length; age++) {
      const day = shiftISO(todayISO, -age);
      const load = weeklyLoad(logs.filter((l) => l.date === day), exercises, day, 1);
      for (const [region, sets] of Object.entries(load)) score[region] = (score[region] || 0) + sets * WEIGHT[age];
    }
    const out = {};
    for (const [region, s] of Object.entries(score)) {
      const level = s >= 10 ? 3 : s >= 5 ? 2 : s >= 1.5 ? 1 : 0;
      if (level) out[region] = { level, score: Math.round(s * 10) / 10 };
    }
    return out;
  }

  function shiftISO(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  }

  // ---- Progress -----------------------------------------------------------
  // logs: [{ date: 'YYYY-MM-DD', entries: [{ exercise_id, sets: [{ reps, weight_lb }] }] }]
  // Returns one row per session for an exercise, oldest first.
  function exerciseHistory(logs, exerciseId) {
    const rows = [];
    for (const log of logs) {
      for (const entry of log.entries || []) {
        if (entry.exercise_id !== exerciseId) continue;
        const sets = (entry.sets || []).filter((s) => Number(s.weight_lb) > 0 && Number(s.reps) > 0);
        if (!sets.length) continue;
        const top = Math.max(...sets.map((s) => Number(s.weight_lb)));
        const volume = sets.reduce((sum, s) => sum + Number(s.weight_lb) * Number(s.reps), 0);
        rows.push({ date: log.date, topWeight: top, volume, sets: sets.length });
      }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  }

  // Compare the top weight on two dates (or the nearest session on or before each date).
  function compareSessions(rows, dateA, dateB) {
    const pick = (d) => {
      let found = null;
      for (const r of rows) if (r.date <= d) found = r;
      return found;
    };
    const a = pick(dateA);
    const b = pick(dateB);
    if (!a || !b) return null;
    return { from: a, to: b, change: b.topWeight - a.topWeight };
  }

  // ---- Training log for Claude ----------------------------------------------
  // What Claude needs to set next weights: the plan's lifts with their current targets and rep ranges,
  // and every logged session in the window. Names match exercise-names.txt so the reply imports cleanly.
  function buildFeedback(workoutPlan, logs, todayISO, days, nameOf) {
    const from = shiftISO(todayISO, -((days || 14) - 1));
    const plan = workoutPlan || { name: '', days: [] };
    const sessions = (logs || [])
      .filter((l) => l.date >= from && l.date <= todayISO)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((l) => ({
        date: l.date,
        day: l.day,
        lifts: (l.entries || []).filter((e) => (e.sets || []).length).map((e) => ({
          exercise: nameOf(e.exercise_id),
          sets: e.sets.map((s) => ({ reps: s.reps, weight_lb: s.weight_lb })),
        })),
      }))
      .filter((s) => s.lifts.length);
    return {
      type: 'training_log',
      version: 1,
      from,
      to: todayISO,
      plan_name: plan.name,
      plan: plan.days.map((d) => ({
        day: d.day,
        title: d.title,
        exercises: d.exercises.map((ex) => ({
          exercise: nameOf(ex.exercise_id),
          sets: ex.sets,
          reps: ex.reps,
          target_lb: ex.target_lb == null ? null : ex.target_lb,
        })),
      })),
      sessions,
      ask: 'Reply with only a workout_plan JSON in the same format as the plan, with target_lb set to the weight I should lift next for each lift. Base each target on my sessions: if I hit the top of the rep range on every set, go up a small step; if I fell short, hold or go down. Keep the same days, exercises and names.',
    };
  }

  const api = {
    buildFeedback, G_PER_OZ, G_PER_LB, ML_PER_CUP, ML_PER_TBSP, ML_PER_TSP,
    DENSITY_G_PER_CUP, densityFor, convertGrams, formatAmount, normalizeName,
    sectionFor, buildLibraryIndex, resolveExercise,
    validateWorkoutPlan, validateMealPlan,
    buildShoppingList, exerciseHistory, compareSessions, cooldownFor, warmupFor,
    REGION_OF, weeklyLoad, latestSoreness, autoSoreness, shiftISO, replacementsFor,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WorkoutLib = api;
})(typeof self !== 'undefined' ? self : globalThis);
