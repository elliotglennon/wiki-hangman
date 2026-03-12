/* ============================================================
   Wiki Hangman — Game Logic
   Vanilla JS (ES6+), no external dependencies
   ============================================================ */

'use strict';

// ── Constants ─────────────────────────────────────────────────
const MAX_WRONG   = 6;
const BODY_PARTS  = ['bp-head', 'bp-body', 'bp-left-arm', 'bp-right-arm', 'bp-left-leg', 'bp-right-leg'];
// Any character that isn't A-Z is auto-revealed (numbers, punctuation, spaces handled separately)
const isAutoReveal = char => !/[A-Z]/.test(char);

const QWERTY_ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M'],
];

const CAT_FILTER_PREFIXES = [
  'articles', 'pages', 'cs1', 'wikipedia', 'all ', 'use ', 'harv',
  'webarchive', 'good articles', 'featured articles',
];

const DAILY_STORAGE_KEY = 'wikihangman_daily_v1';

// ── Mode ───────────────────────────────────────────────────────
let currentMode = 'daily';
let dailyCache  = { article: null, date: null };

// ── State ──────────────────────────────────────────────────────
let state = {
  article:      null,
  answer:       '',
  guessed:      new Set(),
  wrongCount:   0,
  lifelinesUsed: new Set(),
  gameOver:     false,
  won:          false,
};

// ── DOM References ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const loadingOverlay = $('loadingOverlay');
const errorBanner    = $('errorBanner');
const errorMsg       = $('errorMsg');
const retryBtn       = $('retryBtn');
const resultOverlay  = $('resultOverlay');
const resultBox      = resultOverlay.querySelector('.result-box');
const resultIcon     = $('resultIcon');
const resultTitle    = $('resultTitle');
const resultMessage  = $('resultMessage');
const resultLink     = $('resultLink');
const playAgainBtn   = $('playAgainBtn');
const tryRandomBtn   = $('tryRandomBtn');
const dailyLockMsg   = $('dailyLockMsg');
const newGameBtn     = $('newGameBtn');
const giveUpBtn      = $('giveUpBtn');
const darkModeBtn    = $('darkModeBtn');
const debugResetBtn  = $('debugResetBtn');
const dailyDateLabel = $('dailyDateLabel');
const wrongCountEl   = $('wrongCount');
const wrongLettersEl = $('wrongLetters');
const wordDisplay    = $('wordDisplay');
const hintArea       = $('hintArea');
const keyboard       = $('keyboard');
const articleThumb   = $('articleThumb');

// ── Daily Lock (localStorage) ─────────────────────────────────
function getDailyRecord() {
  try { return JSON.parse(localStorage.getItem(DAILY_STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function setDailyRecord(data) {
  try { localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(data)); } catch {}
}

function isDailyLocked() {
  const r = getDailyRecord();
  return r.date === utcDateStr() && r.completed === true;
}

function lockDaily(won) {
  setDailyRecord({
    date: utcDateStr(),
    completed: true,
    won,
    title:   state.article?.title   || '',
    pageUrl: state.article?.pageUrl || '',
  });
}

function resetDailyLock() {
  localStorage.removeItem(DAILY_STORAGE_KEY);
}

function utcDateStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── Initialisation ─────────────────────────────────────────────
function init() {
  buildKeyboard();
  attachEventListeners();
  updateDailyLabel();

  // Debug mode: ?debug in URL shows the reset button
  if (new URLSearchParams(window.location.search).has('debug')) {
    debugResetBtn.classList.remove('hidden');
  }

  startNewGame();
}

function attachEventListeners() {
  newGameBtn.addEventListener('click', startNewGame);
  playAgainBtn.addEventListener('click', startNewGame);
  retryBtn.addEventListener('click', startNewGame);
  tryRandomBtn.addEventListener('click', () => { hideResult(); switchTab('random'); });
  giveUpBtn.addEventListener('click', () => { if (!state.gameOver && state.answer) triggerLoss(); });
  debugResetBtn.addEventListener('click', () => { resetDailyLock(); startNewGame(); });

  darkModeBtn.addEventListener('click', () => {
    const isDark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = isDark ? '' : 'dark';
    darkModeBtn.textContent = isDark ? '🌙' : '☀️';
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Physical keyboard support
  document.addEventListener('keydown', e => {
    if (state.gameOver) return;
    const key = e.key.toUpperCase();
    if (/^[A-Z]$/.test(key)) guessLetter(key);
  });

  // Lifeline buttons
  document.querySelectorAll('.lifeline-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.gameOver) return;
      const ll = btn.dataset.lifeline;
      if (!state.lifelinesUsed.has(ll)) activateLifeline(ll);
    });
  });
}

// ── Keyboard ──────────────────────────────────────────────────
function buildKeyboard() {
  keyboard.innerHTML = '';
  QWERTY_ROWS.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'keyboard-row';
    row.forEach(letter => {
      const btn = document.createElement('button');
      btn.className  = 'key-btn';
      btn.id         = `key-${letter}`;
      btn.textContent = letter;
      btn.setAttribute('aria-label', `Guess letter ${letter}`);
      btn.addEventListener('click', () => guessLetter(letter));
      rowEl.appendChild(btn);
    });
    keyboard.appendChild(rowEl);
  });
}

function resetKeyboard() {
  document.querySelectorAll('.key-btn').forEach(btn => {
    btn.disabled = false;
    btn.classList.remove('correct', 'wrong');
  });
}

// ── New Game Flow ─────────────────────────────────────────────
async function startNewGame() {
  hideResult();
  hideError();
  clearHints();
  resetKeyboard();
  resetLifelineButtons();
  hideThumb();

  state = {
    article:       null,
    answer:        '',
    guessed:       new Set(),
    wrongCount:    0,
    lifelinesUsed: new Set(),
    gameOver:      false,
    won:           false,
  };

  updateWrongDisplay();
  wordDisplay.innerHTML = '';

  // Check daily lock before loading
  if (currentMode === 'daily' && isDailyLocked()) {
    showDailyLockedResult();
    return;
  }

  giveUpBtn.disabled = true;
  showLoading();
  try {
    const article = currentMode === 'daily' ? await fetchDailyArticle() : await fetchValidArticle();
    hideLoading();
    state.article = article;
    state.answer  = article.title.toUpperCase();
    giveUpBtn.disabled = false;
    showThumb(article.thumbnail);
    renderWordDisplay();
    updateHangman();
  } catch (err) {
    hideLoading();
    showError(err.message || 'Could not load a Wikipedia article. Please try again.');
    console.error(err);
  }
}

// ── Tab Switching ─────────────────────────────────────────────
function switchTab(mode) {
  if (mode === currentMode) return;
  currentMode = mode;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  });
  updateDailyLabel();
  startNewGame();
}

function updateDailyLabel() {
  if (currentMode === 'daily') {
    const label = new Date().toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
    dailyDateLabel.textContent = label;
  } else {
    dailyDateLabel.textContent = '';
  }
}

// ── Article Thumbnail ─────────────────────────────────────────
function showThumb(src) {
  if (src) {
    articleThumb.src = src;
    articleThumb.classList.remove('hidden');
  }
}

function hideThumb() {
  articleThumb.classList.add('hidden');
  articleThumb.src = '';
}

// ── Wikipedia API Calls ───────────────────────────────────────

async function fetchDailyArticle() {
  const now     = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  if (dailyCache.date === dateStr && dailyCache.article) return dailyCache.article;

  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day   = String(now.getUTCDate()).padStart(2, '0');
  const url   = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${month}/${day}`;

  const resp = await fetchWithTimeout(url, {}, 8000);
  if (!resp.ok) throw new Error(`On This Day API returned ${resp.status}`);
  const data = await resp.json();

  const pool = [];
  for (const category of ['events', 'births', 'deaths']) {
    for (const entry of (data[category] || [])) {
      for (const page of (entry.pages || [])) {
        const title = page.titles?.normalized || page.title || '';
        if (!title || title.includes(':')) continue;
        if ((page.description || '').toLowerCase().includes('disambiguation')) continue;
        const words = title.trim().split(/\s+/);
        if (title.length < 3 || words.length > 5) continue;
        pool.push({
          title,
          description:  page.description || '',
          extract:      page.extract     || '',
          thumbnail:    page.thumbnail   ? page.thumbnail.source : null,
          pageUrl:      page.content_urls ? page.content_urls.desktop.page
                                          : `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        });
      }
    }
  }

  if (pool.length === 0) throw new Error("No suitable articles found for today's date.");

  const seed    = parseInt(dateStr.replace(/-/g, ''), 10);
  const article = pool[seed % pool.length];
  dailyCache    = { article, date: dateStr };
  return article;
}

async function fetchValidArticle(attempts = 0) {
  if (attempts > 15) throw new Error('Could not find a suitable article after many attempts. Please retry.');

  const url  = 'https://en.wikipedia.org/api/rest_v1/page/random/summary';
  const resp = await fetchWithTimeout(url, {}, 8000);
  if (!resp.ok) throw new Error(`Wikipedia API returned ${resp.status}`);
  const data = await resp.json();

  const title       = data.title       || '';
  const description = (data.description || '').toLowerCase();
  const words       = title.trim().split(/\s+/);

  if (title.includes(':'))                    return fetchValidArticle(attempts + 1);
  if (description.includes('disambiguation')) return fetchValidArticle(attempts + 1);
  if (title.length < 3)                       return fetchValidArticle(attempts + 1);
  if (words.length > 5)                       return fetchValidArticle(attempts + 1);

  return {
    title,
    description:  data.description || '',
    extract:      data.extract     || '',
    thumbnail:    data.thumbnail   ? data.thumbnail.source : null,
    pageUrl:      data.content_urls ? data.content_urls.desktop.page : `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}

async function fetchCategories(title) {
  const url  = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=categories&cllimit=40&format=json&origin=*`;
  const resp = await fetchWithTimeout(url, {}, 8000);
  if (!resp.ok) throw new Error('Categories API error');
  const data    = await resp.json();
  const pages   = data.query?.pages || {};
  const page    = Object.values(pages)[0];
  const cats    = (page?.categories || []).map(c => c.title.replace(/^Category:/, ''));
  return cats.filter(cat => {
    const lower = cat.toLowerCase();
    return !CAT_FILTER_PREFIXES.some(p => lower.startsWith(p));
  }).slice(0, 5);
}

function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ── Word Display ──────────────────────────────────────────────
function renderWordDisplay() {
  wordDisplay.innerHTML = '';
  const wordsRaw = state.answer.split(' ');

  wordsRaw.forEach((word, wi) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'word-group';

    for (const char of word) {
      const tile   = document.createElement('div');
      tile.className = 'letter-tile';
      const charEl = document.createElement('span');
      charEl.className    = 'letter-char';
      charEl.dataset.char = char;
      const lineEl = document.createElement('span');
      lineEl.className = 'letter-line';

      if (isAutoReveal(char)) {
        charEl.textContent = char;
        tile.classList.add('auto-reveal');
        lineEl.style.background = 'transparent';
      } else {
        charEl.textContent = state.guessed.has(char) ? char : '';
      }

      tile.appendChild(charEl);
      tile.appendChild(lineEl);
      groupEl.appendChild(tile);
    }

    wordDisplay.appendChild(groupEl);

    if (wi < wordsRaw.length - 1) {
      const spacer = document.createElement('div');
      spacer.style.width = '10px';
      wordDisplay.appendChild(spacer);
    }
  });
}

function refreshWordDisplay() {
  wordDisplay.querySelectorAll('.letter-char').forEach(el => {
    const char = el.dataset.char;
    if (!char || isAutoReveal(char)) return;
    if (state.guessed.has(char)) {
      el.textContent = char;
      el.closest('.letter-tile').classList.add('correct');
    }
  });
}

// ── Guessing ──────────────────────────────────────────────────
function guessLetter(letter) {
  if (state.gameOver)            return;
  if (state.guessed.has(letter)) return;
  if (!state.answer)             return;

  state.guessed.add(letter);
  const keyBtn = $(`key-${letter}`);

  if (state.answer.includes(letter)) {
    if (keyBtn) { keyBtn.classList.add('correct'); keyBtn.disabled = true; }
    refreshWordDisplay();
    checkWin();
  } else {
    state.wrongCount++;
    if (keyBtn) { keyBtn.classList.add('wrong'); keyBtn.disabled = true; }
    updateHangman();
    updateWrongDisplay();
    checkLoss();
  }
}

// ── Hangman SVG ───────────────────────────────────────────────
function updateHangman() {
  BODY_PARTS.forEach((id, i) => {
    const el = $(id);
    if (!el) return;
    el.classList.toggle('hidden',  i >= state.wrongCount);
    el.classList.toggle('visible', i <  state.wrongCount);
  });
}

function updateWrongDisplay() {
  wrongCountEl.textContent = state.wrongCount;
  const wrongLetters = [...state.guessed].filter(l => !state.answer.includes(l));
  wrongLettersEl.textContent = wrongLetters.join('  ');
}

// ── Win / Loss Checks ─────────────────────────────────────────
function checkWin() {
  const answerChars = [...state.answer].filter(c => !isAutoReveal(c));
  if (answerChars.every(c => state.guessed.has(c))) triggerWin();
}

function checkLoss() {
  if (state.wrongCount >= MAX_WRONG) triggerLoss();
}

function triggerWin() {
  state.gameOver = true;
  state.won      = true;
  disableKeyboard();
  document.querySelectorAll('.letter-char').forEach(el => {
    const char = el.dataset.char;
    if (char && !isAutoReveal(char)) el.textContent = char;
    el.closest('.letter-tile')?.classList.add('correct');
  });
  setTimeout(() => { launchConfetti(); showResult(true); }, 500);
}

function triggerLoss() {
  state.gameOver = true;
  state.won      = false;
  disableKeyboard();
  document.querySelectorAll('.letter-char').forEach(el => {
    const char = el.dataset.char;
    if (char && !isAutoReveal(char) && !state.guessed.has(char)) {
      el.textContent = char;
      el.style.color = '#d33';
    }
  });
  setTimeout(() => showResult(false), 600);
}

function disableKeyboard() {
  document.querySelectorAll('.key-btn').forEach(btn => btn.disabled = true);
  giveUpBtn.disabled = true;
}

// ── Result Overlay ────────────────────────────────────────────
function showResult(won, opts = {}) {
  const isDaily  = currentMode === 'daily';
  const isLocked = opts.locked || false;
  const title    = opts.title   || state.article?.title   || '';
  const pageUrl  = opts.pageUrl || state.article?.pageUrl || '#';

  // Lock the daily puzzle after first completion
  if (isDaily && !isLocked) lockDaily(won);

  resultBox.classList.remove('won', 'lost');
  if (won) {
    resultBox.classList.add('won');
    resultIcon.textContent  = '🎉';
    resultTitle.textContent = isLocked ? 'Already completed!' : 'You got it!';
  } else {
    resultBox.classList.add('lost');
    resultIcon.textContent  = '💀';
    resultTitle.textContent = isLocked ? 'Better luck next time!' : 'Game Over';
  }

  resultMessage.textContent = `The answer was: "${title}"`;
  resultLink.href        = pageUrl;
  resultLink.textContent = `Read "${title}" on Wikipedia →`;

  // Play Again: hide if daily is locked
  playAgainBtn.classList.toggle('hidden', isDaily && (isLocked || isDailyLocked()));

  // Try Random: show for daily results
  if (isDaily) {
    tryRandomBtn.classList.remove('hidden');
    dailyLockMsg.textContent = isLocked
      ? "You've already played today's daily. Come back tomorrow!"
      : "That's today's daily done — come back tomorrow for a new puzzle!";
    dailyLockMsg.classList.remove('hidden');
  } else {
    tryRandomBtn.classList.add('hidden');
    dailyLockMsg.classList.add('hidden');
  }

  resultOverlay.classList.remove('hidden');
}

function showDailyLockedResult() {
  const r = getDailyRecord();
  showResult(r.won, { locked: true, title: r.title, pageUrl: r.pageUrl });
}

function hideResult() { resultOverlay.classList.add('hidden'); }

// ── Confetti / Fireworks ──────────────────────────────────────
function launchConfetti() {
  const colors = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#3498db','#9b59b6','#1abc9c','#ff69b4'];

  function burst(delay) {
    setTimeout(() => {
      for (let i = 0; i < 60; i++) {
        const el    = document.createElement('div');
        el.className = 'confetti-piece';
        const angle = Math.random() * 360;
        const dist  = 120 + Math.random() * 220;
        const tx    = Math.cos(angle * Math.PI / 180) * dist;
        const ty    = Math.sin(angle * Math.PI / 180) * dist - 80;
        el.style.cssText = [
          `--tx: ${tx}px`,
          `--ty: ${ty}px`,
          `--rot: ${Math.random() * 720 - 360}deg`,
          `background: ${colors[Math.floor(Math.random() * colors.length)]}`,
          `width: ${Math.random() > 0.5 ? Math.random() * 8 + 4 : Math.random() * 3 + 2}px`,
          `height: ${Math.random() > 0.5 ? Math.random() * 8 + 4 : Math.random() * 16 + 6}px`,
          `border-radius: ${Math.random() > 0.4 ? '50%' : '2px'}`,
          `left: ${30 + Math.random() * 40}%`,
          `top: ${30 + Math.random() * 30}%`,
        ].join(';');
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2200);
      }
    }, delay);
  }

  burst(0);
  burst(400);
  burst(800);
}

// ── Lifelines ─────────────────────────────────────────────────
async function activateLifeline(name) {
  state.lifelinesUsed.add(name);
  const btn = document.querySelector(`[data-lifeline="${name}"]`);
  if (btn) { btn.classList.add('used'); btn.disabled = true; }

  switch (name) {
    case 'categories':   await showCategoriesHint();  break;
    case 'freeletter':   showFreeLetterHint();         break;
    case 'firstsentence': showFirstSentenceHint();     break;
  }
}

function showFreeLetterHint() {
  const answerLetters = [...new Set([...state.answer].filter(c => !isAutoReveal(c)))];
  const unguessed     = answerLetters.filter(c => !state.guessed.has(c));

  if (unguessed.length === 0) {
    addHintCard('Free Letter', '<em>All letters are already revealed!</em>');
    return;
  }

  const letter = unguessed[Math.floor(Math.random() * unguessed.length)];
  guessLetter(letter);
  addHintCard('Free Letter', `The letter <strong>${escapeHtml(letter)}</strong> was revealed for you!`);
}

async function showCategoriesHint() {
  addHintCard('Categories', '<em>Loading categories…</em>', 'hint-categories');
  try {
    const cats = await fetchCategories(state.article.title);
    const card = document.querySelector('.hint-categories');
    if (!card) return;
    card.querySelector('.hint-body').innerHTML = cats.length === 0
      ? '<em>No categories found.</em>'
      : `<ul>${cats.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`;
  } catch {
    const card = document.querySelector('.hint-categories');
    if (card) card.querySelector('.hint-body').innerHTML = '<em>Could not load categories.</em>';
  }
}

function showFirstSentenceHint() {
  const extract = state.article.extract || '';
  if (!extract) { addHintCard('First Sentence', '<em>No extract available.</em>'); return; }

  const match    = extract.match(/^.+?[.!?](?:\s|$)/);
  let sentence   = match ? match[0].trim() : extract.slice(0, 200).trim();

  state.article.title.split(/\s+/).filter(w => w.length > 0).forEach(word => {
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    sentence = sentence.replace(re, '___');
  });

  addHintCard('First Sentence', escapeHtml(sentence));
}

function addHintCard(title, bodyHtml, extraClass = '') {
  const card = document.createElement('div');
  card.className = `hint-card${extraClass ? ' ' + extraClass : ''}`;
  card.innerHTML = `<div class="hint-title">${escapeHtml(title)}</div><div class="hint-body">${bodyHtml}</div>`;
  hintArea.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearHints() { hintArea.innerHTML = ''; }

function resetLifelineButtons() {
  document.querySelectorAll('.lifeline-btn').forEach(btn => {
    btn.classList.remove('used');
    btn.disabled = false;
  });
}

// ── Loading / Error ───────────────────────────────────────────
function showLoading() { loadingOverlay.classList.remove('hidden'); }
function hideLoading() { loadingOverlay.classList.add('hidden'); }
function showError(msg) { errorMsg.textContent = msg; errorBanner.classList.remove('hidden'); }
function hideError()    { errorBanner.classList.add('hidden'); }

// ── Utilities ─────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
