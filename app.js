'use strict';

const STORAGE_KEY = 'habit-tracker:v1';
const BACKUP_KEY = 'habit-tracker:v1:backup';
const HISTORY_DAYS = 7;

/* ---------- Dates ----------
   Days are local-time "YYYY-MM-DD" strings. toISOString() is avoided because it
   uses UTC, and days are stepped by calendar date because not every day is
   24 hours long where daylight saving applies. */

function toKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function todayKey() {
  return toKey(new Date());
}

function addDays(key, amount) {
  const date = fromKey(key);
  date.setDate(date.getDate() + amount);
  return toKey(date);
}

/** The last n days ending today, oldest first. */
function lastNDays(n, today = todayKey()) {
  const days = [];
  for (let offset = n - 1; offset >= 0; offset--) {
    days.push(addDays(today, -offset));
  }
  return days;
}

/** Consecutive completed days. An unticked today doesn't break the streak yet. */
function currentStreak(completions, today = todayKey()) {
  const done = new Set(completions);
  let day = done.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (done.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

/* ---------- Storage ---------- */

let loadMessage = '';
let saveMessage = '';
let saveBlocked = false; // Set when saving would destroy data we couldn't back up.

function emptyState() {
  return { version: 1, habits: [] };
}

function isValidState(data) {
  return (
    data !== null &&
    typeof data === 'object' &&
    Array.isArray(data.habits) &&
    data.habits.every(
      (habit) =>
        habit !== null &&
        typeof habit === 'object' &&
        typeof habit.id === 'string' &&
        typeof habit.name === 'string' &&
        Array.isArray(habit.completions)
    )
  );
}

function load() {
  loadMessage = '';
  saveBlocked = false;

  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    loadMessage = "This browser is blocking storage, so your habits won't be saved.";
    return emptyState();
  }
  if (raw === null) return emptyState();

  try {
    const data = JSON.parse(raw);
    if (isValidState(data)) return data;
  } catch {
    // Handled below, along with valid JSON of the wrong shape.
  }

  try {
    localStorage.setItem(BACKUP_KEY, raw);
    loadMessage = `Your saved habits couldn't be read, so the app started empty. A copy was kept in localStorage under "${BACKUP_KEY}".`;
  } catch {
    saveBlocked = true;
    loadMessage = "Your saved habits couldn't be read or backed up. They've been left untouched, and changes won't be saved.";
  }
  return emptyState();
}

function save() {
  if (saveBlocked) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveMessage = '';
  } catch {
    saveMessage = "Couldn't save your latest change. It will be lost when this page closes.";
  }
}

/* ---------- State changes ---------- */

let state = load();

function findHabit(id) {
  return state.habits.find((habit) => habit.id === id);
}

function newId() {
  // randomUUID only exists in secure contexts, so plain http needs the fallback.
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function addHabit(name) {
  state.habits.push({ id: newId(), name, createdAt: todayKey(), completions: [] });
  save();
}

function toggleToday(id) {
  const habit = findHabit(id);
  if (!habit) return;
  const today = todayKey();
  if (habit.completions.includes(today)) {
    habit.completions = habit.completions.filter((day) => day !== today);
  } else {
    habit.completions.push(today);
  }
  save();
}

function renameHabit(id, name) {
  const habit = findHabit(id);
  if (!habit) return;
  habit.name = name;
  save();
}

function deleteHabit(id) {
  state.habits = state.habits.filter((habit) => habit.id !== id);
  save();
}

/* ---------- Rendering ---------- */

const listEl = document.getElementById('habit-list');
const emptyEl = document.getElementById('empty-state');
const todayEl = document.getElementById('today');
const storageMessageEl = document.getElementById('storage-message');
const formEl = document.getElementById('add-form');
const nameInputEl = document.getElementById('habit-name');
const formErrorEl = document.getElementById('form-error');
const rowTemplate = document.getElementById('habit-template');

let editing = null; // { id, input } while a habit is being renamed.

function streakText(streak) {
  return streak === 0 ? 'No streak yet' : `${streak}-day streak`;
}

function buildDots(habit, today) {
  const done = new Set(habit.completions);
  return lastNDays(HISTORY_DAYS, today).map((key) => {
    const date = fromKey(key);
    const isDone = done.has(key);
    const label = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

    const item = document.createElement('li');
    item.classList.toggle('is-today', key === today);

    const day = document.createElement('span');
    day.className = 'dot-day';
    day.setAttribute('aria-hidden', 'true');
    day.textContent = date.toLocaleDateString(undefined, { weekday: 'narrow' });

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.classList.toggle('is-done', isDone);
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', `${label}: ${isDone ? 'done' : 'not done'}`);
    dot.title = dot.getAttribute('aria-label');

    item.append(day, dot);
    return item;
  });
}

/** Sets everything in a row that shows the habit's name. */
function applyName(row, name) {
  row.querySelector('.habit-name').textContent = name;
  row.querySelector('[data-action="toggle"]').setAttribute('aria-label', `Done today: ${name}`);
  row.querySelector('[data-action="rename"]').setAttribute('aria-label', `Rename ${name}`);
  row.querySelector('[data-action="delete"]').setAttribute('aria-label', `Delete ${name}`);
}

function buildRow(habit, today) {
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = habit.id;
  applyName(row, habit.name);
  row.querySelector('[data-action="toggle"]').checked = habit.completions.includes(today);
  row.querySelector('.habit-streak').textContent = streakText(currentStreak(habit.completions, today));
  row.querySelector('.dots').append(...buildDots(habit, today));
  return row;
}

function renderStorageMessage() {
  const message = [loadMessage, saveMessage].filter(Boolean).join(' ');
  storageMessageEl.textContent = message;
  storageMessageEl.hidden = !message;
}

/** Rebuilds the page from state. Pass { id, action } to put focus back on a button. */
function render(focusTarget) {
  editing = null;
  const today = todayKey();
  todayEl.textContent = fromKey(today).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  listEl.replaceChildren(...state.habits.map((habit) => buildRow(habit, today)));
  emptyEl.hidden = state.habits.length > 0;
  renderStorageMessage();

  if (focusTarget) {
    const row = listEl.querySelector(`[data-id="${CSS.escape(focusTarget.id)}"]`);
    row?.querySelector(`[data-action="${focusTarget.action}"]`)?.focus();
  }
}

/* ---------- Rename ----------
   Renaming swaps the name for an input in place instead of re-rendering. Saving
   on blur happens during the mouse press, so rebuilding the list then would
   remove the button being clicked and swallow the click. */

function startRename(id, row) {
  const habit = findHabit(id);
  if (!habit) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 80;
  input.value = habit.name;
  input.setAttribute('aria-label', `New name for ${habit.name}`);
  row.querySelector('.habit-name').replaceWith(input);
  editing = { id, input };
  input.focus();
  input.select();
}

function finishRename(shouldSave) {
  if (!editing) return;
  const { id, input } = editing;
  editing = null; // Removing the input fires focusout, which must do nothing.

  const habit = findHabit(id);
  const name = input.value.trim();
  // A blank name is treated as a cancel, so a habit can't end up nameless.
  if (shouldSave && habit && name && name !== habit.name) {
    renameHabit(id, name);
    renderStorageMessage();
  }

  const row = input.closest('.habit');
  const nameEl = document.createElement('span');
  nameEl.className = 'habit-name';
  input.replaceWith(nameEl);
  applyName(row, habit ? habit.name : name);
}

/* ---------- Events ---------- */

formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = nameInputEl.value.trim();
  if (!name) {
    formErrorEl.textContent = 'Enter a habit name first.';
    nameInputEl.focus();
    return;
  }
  addHabit(name);
  formEl.reset();
  formErrorEl.textContent = '';
  render();
  nameInputEl.focus();
});

nameInputEl.addEventListener('input', () => {
  formErrorEl.textContent = '';
});

listEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const row = button.closest('.habit');
  const id = row.dataset.id;
  const action = button.dataset.action;

  if (action === 'toggle') {
    finishRename(true);
    toggleToday(id);
    render({ id, action });
  } else if (action === 'rename') {
    finishRename(true);
    startRename(id, row);
  } else if (action === 'delete') {
    finishRename(true);
    const habit = findHabit(id);
    if (habit && confirm(`Delete "${habit.name}" and all its history?`)) {
      deleteHabit(id);
      render();
      nameInputEl.focus();
    }
  }
});

listEl.addEventListener('keydown', (event) => {
  if (!editing || event.target !== editing.input) return;
  if (event.key !== 'Enter' && event.key !== 'Escape') return;
  event.preventDefault();
  const row = editing.input.closest('.habit');
  finishRename(event.key === 'Enter');
  row.querySelector('[data-action="rename"]').focus();
});

listEl.addEventListener('focusout', (event) => {
  if (editing && event.target === editing.input) finishRename(true);
});

// Catches the date changing while the tab was in the background.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});

// Keeps a second open tab from overwriting newer data with its stale copy.
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) {
    state = load();
    render();
  }
});

render();
