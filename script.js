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

const LOSS_TAUNTS = [
  "The image was RIGHT THERE. 👀",
  "Don't worry, Wikipedia is completely free. You could've just looked it up. 🤭",
  "Our algorithm specifically picked this one because we thought you'd get it. We were wrong.",
  "Even the hangman feels embarrassed for you. Actually no, he doesn't.",
  "Have you considered easier games? Like… tic-tac-toe?",
  "We're not angry. Just deeply, deeply disappointed.",
  "Bold strategy. Didn't pay off.",
  "The letters were right there. All 26 of them.",
  "Statistically speaking, random guessing would have done better.",
  "We've seen better. We've also seen worse. Actually, no we haven't.",
  "This is awkward for everyone involved.",
  "In another timeline, you got this one. Not this timeline though.",
  "You'll get the next one! (We don't actually believe that.)",
  "The Wikipedia article is linked below. For next time. Just saying.",
  "A moment of silence for all the letters you didn't guess.",
];

// ── Lifeline definitions per mode ─────────────────────────────
const MODE_LIFELINES = {
  wiki: [
    { id: 'categories',    icon: '🏷️', label: 'Categories',    title: 'Show article categories' },
    { id: 'freeletter',    icon: '🎁', label: 'Free Letter',    title: 'Reveal a random letter from the answer' },
    { id: 'firstsentence', icon: '📖', label: 'First Sentence', title: 'Show first sentence (title redacted)' },
  ],
  football: [
    { id: 'clubs',       icon: '🏟️', label: 'Clubs',       title: 'Show clubs this player appeared for' },
    { id: 'position',    icon: '⚽', label: 'Position',    title: "Reveal this player's playing position" },
    { id: 'nationality', icon: '🌍', label: 'Nationality', title: "Reveal this player's nationality" },
  ],
  capitals: [
    { id: 'continent', icon: '🌍', label: 'Continent', title: 'Show which continent this capital is on' },
    { id: 'region',    icon: '🗺️', label: 'Region',    title: 'Show the geographic region' },
    { id: 'country',   icon: '🏳️', label: 'Country',   title: 'Show which country this is the capital of' },
  ],
};

// Common words excluded from redaction (won't give the answer away)
const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','of','for','with',
  'by','from','as','is','was','are','were','be','been','has','had','have',
  'do','did','does','that','this','it','its','up','out','about','than',
  'then','if','so','not','no','he','she','they','we','you','i','me',
  'him','her','them','us','who','which','what','into','over','after',
  'before','between','during','under','through','while','would','could',
  'should','one','two','three','new','old','first','last','great',
]);

// ── Mode ───────────────────────────────────────────────────────
let currentMode   = 'daily';
let dailyCache    = { article: null, date: null };
let sessionWins   = 0;
let sessionTotal  = 0;

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
const sessionScore   = $('sessionScore');
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
  buildLifelineButtons();
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

  // Physical keyboard support + Enter on result popup
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !resultOverlay.classList.contains('hidden')) {
      // Press the most relevant visible action button
      if (!playAgainBtn.classList.contains('hidden')) playAgainBtn.click();
      else if (!tryRandomBtn.classList.contains('hidden')) tryRandomBtn.click();
      return;
    }
    if (state.gameOver) return;
    const key = e.key.toUpperCase();
    if (/^[A-Z]$/.test(key)) guessLetter(key);
  });

}

// ── Lifeline Buttons (dynamic per mode) ───────────────────────
function buildLifelineButtons() {
  const grid = document.getElementById('lifelinesGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const set = currentMode === 'football' ? MODE_LIFELINES.football
            : currentMode === 'capitals'  ? MODE_LIFELINES.capitals
            :                               MODE_LIFELINES.wiki;
  set.forEach(({ id, icon, label, title }) => {
    const btn = document.createElement('button');
    btn.className = 'lifeline-btn';
    btn.id = `ll-${id}`;
    btn.dataset.lifeline = id;
    btn.title = title;
    btn.innerHTML = `<span class="ll-icon">${icon}</span><span class="ll-label">${label}</span>`;
    btn.addEventListener('click', () => {
      if (state.gameOver) return;
      if (!state.lifelinesUsed.has(id)) activateLifeline(id);
    });
    grid.appendChild(btn);
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
  showLoading(
    currentMode === 'football' ? 'Finding a Premier League player…' :
    currentMode === 'capitals' ? 'Loading a capital city…' :
    'Fetching a Wikipedia article…'
  );
  try {
    const article = currentMode === 'daily'    ? await fetchDailyArticle()
                  : currentMode === 'football' ? await fetchFootballPlayer()
                  : currentMode === 'capitals' ? await fetchCapital()
                  :                              await fetchValidArticle();
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
  if (mode === 'random' || mode === 'football' || mode === 'capitals') { sessionWins = 0; sessionTotal = 0; }
  buildLifelineButtons();
  updateDailyLabel();
  updateSessionScore();
  startNewGame();
}

function updateSessionScore() {
  if ((currentMode === 'random' || currentMode === 'football' || currentMode === 'capitals') && sessionTotal > 0) {
    sessionScore.textContent = `🎯 ${sessionWins}/${sessionTotal}`;
    sessionScore.classList.remove('hidden');
  } else {
    sessionScore.classList.add('hidden');
  }
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
  const meaningful = getMeaningfulTitleWords();
  return cats.filter(cat => {
    const lower = cat.toLowerCase();
    // Remove maintenance categories
    if (CAT_FILTER_PREFIXES.some(p => lower.startsWith(p))) return false;
    // Remove any category that contains a meaningful title word
    if (meaningful.some(w => lower.includes(w.toLowerCase()))) return false;
    return true;
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
  if (currentMode === 'random' || currentMode === 'football' || currentMode === 'capitals') { sessionWins++; sessionTotal++; updateSessionScore(); }
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
  if (currentMode === 'random' || currentMode === 'football' || currentMode === 'capitals') { sessionTotal++; updateSessionScore(); }
  disableKeyboard();
  document.querySelectorAll('.letter-char').forEach(el => {
    const char = el.dataset.char;
    if (char && !isAutoReveal(char) && !state.guessed.has(char)) {
      el.textContent = char;
      el.style.color = '#d33';
    }
  });
  setTimeout(() => { launchSadRain(); showResult(false); }, 600);
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
    resultBox.querySelector('.result-taunt')?.remove();
  } else {
    resultBox.classList.add('lost');
    resultIcon.textContent  = '😂';
    resultIcon.classList.add('laughing');
    resultTitle.textContent = isLocked ? 'Better luck next time!' : 'Game Over';
    // Remove any previous taunt then insert a fresh one
    resultBox.querySelector('.result-taunt')?.remove();
    const taunt = document.createElement('p');
    taunt.className = 'result-taunt';
    taunt.textContent = LOSS_TAUNTS[Math.floor(Math.random() * LOSS_TAUNTS.length)];
    resultMessage.insertAdjacentElement('afterend', taunt);
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

function hideResult() {
  resultOverlay.classList.add('hidden');
  resultIcon.classList.remove('laughing');
}

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
        setTimeout(() => el.remove(), 4200);
      }
    }, delay);
  }

  burst(0);
  burst(600);
  burst(1200);
  burst(1800);
}

function launchSadRain() {
  const emojis = ['😭','😢','💧','😿','🥺','💦','😩','😖','🙃'];
  for (let i = 0; i < 35; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'sad-piece';
      el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      el.style.cssText = [
        `left: ${Math.random() * 100}%`,
        `--duration: ${3.5 + Math.random() * 2.5}s`,
        `--delay: 0s`,
        `--drift: ${Math.random() * 60 - 30}px`,
        `--rot: ${Math.random() * 40 - 20}deg`,
        `font-size: ${3.6 + Math.random() * 4.2}rem`,
      ].join(';');
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 9000);
    }, Math.random() * 2500);
  }
}

// ── Redaction Helpers ─────────────────────────────────────────
function getMeaningfulTitleWords() {
  return state.article.title
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))  // strip surrounding punctuation
    .filter(w => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()));
}

function redactTitleWords(text) {
  // First redact the full title as a phrase
  const fullTitle = state.article.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  text = text.replace(new RegExp(fullTitle, 'gi'), '___');

  // Then redact each meaningful word individually using word boundaries
  getMeaningfulTitleWords().forEach(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '___');
  });

  return text;
}

// ── Lifelines ─────────────────────────────────────────────────
async function activateLifeline(name) {
  state.lifelinesUsed.add(name);
  const btn = document.querySelector(`[data-lifeline="${name}"]`);
  if (btn) { btn.classList.add('used'); btn.disabled = true; }

  switch (name) {
    case 'categories':    await showCategoriesHint();   break;
    case 'freeletter':    showFreeLetterHint();          break;
    case 'firstsentence': showFirstSentenceHint();       break;
    case 'clubs':         await showClubsHint();         break;
    case 'position':      showPositionHint();            break;
    case 'nationality':   showNationalityHint();         break;
    case 'continent':     showContinentHint();           break;
    case 'region':        showRegionHint();              break;
    case 'country':       showCountryHint();             break;
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

  const match  = extract.match(/^.+?[.!?](?:\s|$)/);
  let sentence = match ? match[0].trim() : extract.slice(0, 200).trim();

  sentence = redactTitleWords(sentence);
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
function showLoading(msg = 'Fetching a Wikipedia article…') {
  loadingOverlay.querySelector('p').textContent = msg;
  loadingOverlay.classList.remove('hidden');
}
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

// ── Football Mode ─────────────────────────────────────────────

async function fetchFootballPlayer(attempts = 0) {
  if (attempts > 12) throw new Error('Could not find a suitable player after many attempts. Please retry.');

  // Randomise starting letter for variety across the large category
  const letters = 'ABCDEFGHIJKLMNOPRSTW';
  const letter  = letters[Math.floor(Math.random() * letters.length)];
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:Premier_League_players&cmlimit=50&cmstartsortkeyprefix=${letter}&cmsort=sortkey&format=json&origin=*`;

  const resp = await fetchWithTimeout(url, {}, 8000);
  if (!resp.ok) throw new Error(`Wikipedia API returned ${resp.status}`);
  const data = await resp.json();

  const members = (data.query?.categorymembers || []).filter(m => {
    const t = m.title || '';
    if (t.includes(':')) return false;
    const words = t.trim().split(/\s+/);
    return words.length >= 2 && words.length <= 5;
  });

  if (members.length === 0) return fetchFootballPlayer(attempts + 1);

  const member = members[Math.floor(Math.random() * members.length)];
  const title  = member.title;

  // Fetch full summary for extract, thumbnail etc.
  const summaryUrl  = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const summaryResp = await fetchWithTimeout(summaryUrl, {}, 8000);
  if (!summaryResp.ok) return fetchFootballPlayer(attempts + 1);
  const sData = await summaryResp.json();

  const desc    = (sData.description || '').toLowerCase();
  const extract = (sData.extract || '');
  if (desc.includes('disambiguation')) return fetchFootballPlayer(attempts + 1);
  if (!extract.toLowerCase().includes('football') && !extract.toLowerCase().includes('soccer')) return fetchFootballPlayer(attempts + 1);
  if (extract.length < 80) return fetchFootballPlayer(attempts + 1);

  return {
    title:       sData.title || title,
    description: sData.description || '',
    extract,
    thumbnail:   sData.thumbnail ? sData.thumbnail.source : null,
    pageUrl:     sData.content_urls ? sData.content_urls.desktop.page : `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}

async function fetchPlayerClubs(title) {
  const url  = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=categories&cllimit=100&format=json&origin=*`;
  const resp = await fetchWithTimeout(url, {}, 8000);
  if (!resp.ok) throw new Error('Categories API error');
  const data  = await resp.json();
  const pages = data.query?.pages || {};
  const page  = Object.values(pages)[0];
  const cats  = (page?.categories || []).map(c => c.title.replace(/^Category:/, ''));

  // Keywords that indicate competitions/tournaments rather than clubs
  const NOT_CLUBS = [
    'national', 'world cup', 'olympic', 'premier league', 'championship',
    'league cup', 'fa cup', 'europa league', 'champions league', 'conference league',
    'football league', 'serie a', 'la liga', 'bundesliga', 'ligue 1',
    'international', 'under-', 'euro 20', 'euro 19', 'euros', 'community shield',
    'carabao cup', 'league one', 'league two', 'scottish', 'welsh', 'irish',
  ];
  const meaningful = getMeaningfulTitleWords();

  return cats
    .filter(cat => {
      const lower = cat.toLowerCase();
      if (!lower.endsWith(' players')) return false;
      if (NOT_CLUBS.some(kw => lower.includes(kw))) return false;
      if (meaningful.some(w => lower.includes(w.toLowerCase()))) return false;
      return true;
    })
    .map(cat => cat.replace(/\s+players$/i, ''))
    .slice(0, 8);
}

async function showClubsHint() {
  addHintCard('Clubs', '<em>Loading clubs…</em>', 'hint-clubs');
  try {
    const clubs = await fetchPlayerClubs(state.article.title);
    const card  = document.querySelector('.hint-clubs');
    if (!card) return;
    card.querySelector('.hint-body').innerHTML = clubs.length === 0
      ? '<em>No clubs found.</em>'
      : `<ul>${clubs.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`;
  } catch {
    const card = document.querySelector('.hint-clubs');
    if (card) card.querySelector('.hint-body').innerHTML = '<em>Could not load clubs.</em>';
  }
}

function showPositionHint() {
  const extract = state.article.extract || '';
  if (!extract) { addHintCard('Position', '<em>No position information available.</em>'); return; }

  // "plays as a/an [position]"
  const playMatch = extract.match(/plays?\s+as\s+(?:a|an)\s+([^,\.;\n]+)/i);
  if (playMatch) {
    addHintCard('Position', `Plays as: <strong>${escapeHtml(playMatch[1].trim())}</strong>`);
    return;
  }

  // Fallback: scan for known position words
  const positions = [
    'central midfielder', 'defensive midfielder', 'attacking midfielder', 'midfielder',
    'centre-back', 'center-back', 'right-back', 'left-back', 'defender',
    'right winger', 'left winger', 'winger',
    'centre-forward', 'center-forward', 'striker', 'forward',
    'goalkeeper',
  ];
  const lower = extract.toLowerCase();
  for (const pos of positions) {
    if (lower.includes(pos)) {
      addHintCard('Position', `Position: <strong>${escapeHtml(pos)}</strong>`);
      return;
    }
  }

  addHintCard('Position', '<em>Position not found in article.</em>');
}

function showNationalityHint() {
  const extract = state.article.extract || '';
  if (!extract) { addHintCard('Nationality', '<em>No nationality information available.</em>'); return; }

  // "is an/a [Nationality] [professional] footballer / soccer player"
  const match = extract.match(/is\s+(?:a|an)\s+([\w][\w\s\-]*?)\s+(?:professional\s+|association\s+)?(?:foot(?:baller|ball\s+player)|soccer\s+player)/i);
  if (match) {
    const nat = match[1].trim();
    if (nat.length <= 40) {
      const redacted = redactTitleWords(nat);
      addHintCard('Nationality', `Nationality: <strong>${escapeHtml(redacted)}</strong>`);
      return;
    }
  }

  addHintCard('Nationality', '<em>Nationality not found in article.</em>');
}

// ── Capitals Mode ─────────────────────────────────────────────

const WORLD_CAPITALS = [
  // Europe
  { city: 'Amsterdam',          wikiTitle: 'Amsterdam',              country: 'Netherlands',             continent: 'Europe',   region: 'Western Europe' },
  { city: 'Andorra la Vella',   wikiTitle: 'Andorra la Vella',       country: 'Andorra',                 continent: 'Europe',   region: 'Southern Europe' },
  { city: 'Athens',             wikiTitle: 'Athens',                 country: 'Greece',                  continent: 'Europe',   region: 'Southern Europe' },
  { city: 'Belgrade',           wikiTitle: 'Belgrade',               country: 'Serbia',                  continent: 'Europe',   region: 'Southeastern Europe' },
  { city: 'Berlin',             wikiTitle: 'Berlin',                 country: 'Germany',                 continent: 'Europe',   region: 'Western Europe' },
  { city: 'Bern',               wikiTitle: 'Bern',                   country: 'Switzerland',             continent: 'Europe',   region: 'Western Europe' },
  { city: 'Bratislava',         wikiTitle: 'Bratislava',             country: 'Slovakia',                continent: 'Europe',   region: 'Central Europe' },
  { city: 'Brussels',           wikiTitle: 'Brussels',               country: 'Belgium',                 continent: 'Europe',   region: 'Western Europe' },
  { city: 'Bucharest',          wikiTitle: 'Bucharest',              country: 'Romania',                 continent: 'Europe',   region: 'Eastern Europe' },
  { city: 'Budapest',           wikiTitle: 'Budapest',               country: 'Hungary',                 continent: 'Europe',   region: 'Central Europe' },
  { city: 'Chisinau',           wikiTitle: 'Chișinău',               country: 'Moldova',                 continent: 'Europe',   region: 'Eastern Europe' },
  { city: 'Copenhagen',         wikiTitle: 'Copenhagen',             country: 'Denmark',                 continent: 'Europe',   region: 'Northern Europe' },
  { city: 'Dublin',             wikiTitle: 'Dublin',                 country: 'Ireland',                 continent: 'Europe',   region: 'Northern Europe' },
  { city: 'Helsinki',           wikiTitle: 'Helsinki',               country: 'Finland',                 continent: 'Europe',   region: 'Northern Europe' },
  { city: 'Kyiv',               wikiTitle: 'Kyiv',                   country: 'Ukraine',                 continent: 'Europe',   region: 'Eastern Europe' },
  { city: 'Lisbon',             wikiTitle: 'Lisbon',                 country: 'Portugal',                continent: 'Europe',   region: 'Southern Europe' },
  { city: 'Ljubljana',          wikiTitle: 'Ljubljana',              country: 'Slovenia',                continent: 'Europe',   region: 'Central Europe' },
  { city: 'London',             wikiTitle: 'London',                 country: 'United Kingdom',          continent: 'Europe',   region: 'Northern Europe' },
  { city: 'Luxembourg City',    wikiTitle: 'Luxembourg City',        country: 'Luxembourg',              continent: 'Europe',   region: 'Western Europe' },
  { city: 'Madrid',             wikiTitle: 'Madrid',                 country: 'Spain',                   continent: 'Europe',   region: 'Southern Europe' },
  { city: 'Minsk',              wikiTitle: 'Minsk',                  country: 'Belarus',                 continent: 'Europe',   region: 'Eastern Europe' },
  { city: 'Monaco',             wikiTitle: 'Monaco',                 country: 'Monaco',                  continent: 'Europe',   region: 'Southern Europe' },
  { city: 'Moscow',             wikiTitle: 'Moscow',                 country: 'Russia',                  continent: 'Europe',   region: 'Eastern Europe' },
  { city: 'Nicosia',            wikiTitle: 'Nicosia',                country: 'Cyprus',                  continent: 'Europe',   region: 'Southern Europe' },
  { city: 'Oslo',               wikiTitle: 'Oslo',                   country: 'Norway',                  continent: 'Europe',   region: 'Northern Europe' },
  { city: 'Paris',              wikiTitle: 'Paris',                  country: 'France',                  continent: 'Europe',   region: 'Western Europe' },
  { city: 'Podgorica',          wikiTitle: 'Podgorica',              country: 'Montenegro',              continent: 'Europe',   region: 'Southeastern Europe' },
  { city: 'Prague',             wikiTitle: 'Prague',                 country: 'Czech Republic',          continent: 'Europe',   region: 'Central Europe' },
  { city: 'Pristina',           wikiTitle: 'Pristina',               country: 'Kosovo',                  continent: 'Europe',   region: 'Southeastern Europe' },
  { city: 'Reykjavik',          wikiTitle: 'Reykjavík',              country: 'Iceland',                 continent: 'Europe',   region: 'Northern Europe' },
  { city: 'Riga',               wikiTitle: 'Riga',                   country: 'Latvia',                  continent: 'Europe',   region: 'Northern Europe' },
  { city: 'Rome',               wikiTitle: 'Rome',                   country: 'Italy',                   continent: 'Europe',   region: 'Southern Europe' },
  { city: 'Sarajevo',           wikiTitle: 'Sarajevo',               country: 'Bosnia and Herzegovina',  continent: 'Europe',   region: 'Southeastern Europe' },
  { city: 'Skopje',             wikiTitle: 'Skopje',                 country: 'North Macedonia',         continent: 'Europe',   region: 'Southeastern Europe' },
  { city: 'Sofia',              wikiTitle: 'Sofia',                  country: 'Bulgaria',                continent: 'Europe',   region: 'Eastern Europe' },
  { city: 'Stockholm',          wikiTitle: 'Stockholm',              country: 'Sweden',                  continent: 'Europe',   region: 'Northern Europe' },
  { city: 'Tallinn',            wikiTitle: 'Tallinn',                country: 'Estonia',                 continent: 'Europe',   region: 'Northern Europe' },
  { city: 'Tirana',             wikiTitle: 'Tirana',                 country: 'Albania',                 continent: 'Europe',   region: 'Southeastern Europe' },
  { city: 'Valletta',           wikiTitle: 'Valletta',               country: 'Malta',                   continent: 'Europe',   region: 'Southern Europe' },
  { city: 'Vatican City',       wikiTitle: 'Vatican City',           country: 'Vatican City',            continent: 'Europe',   region: 'Southern Europe' },
  { city: 'Vienna',             wikiTitle: 'Vienna',                 country: 'Austria',                 continent: 'Europe',   region: 'Central Europe' },
  { city: 'Vilnius',            wikiTitle: 'Vilnius',                country: 'Lithuania',               continent: 'Europe',   region: 'Northern Europe' },
  { city: 'Warsaw',             wikiTitle: 'Warsaw',                 country: 'Poland',                  continent: 'Europe',   region: 'Central Europe' },
  { city: 'Zagreb',             wikiTitle: 'Zagreb',                 country: 'Croatia',                 continent: 'Europe',   region: 'Southeastern Europe' },
  // Americas
  { city: 'Asuncion',           wikiTitle: 'Asunción',               country: 'Paraguay',                continent: 'Americas', region: 'South America' },
  { city: 'Bogota',             wikiTitle: 'Bogotá',                 country: 'Colombia',                continent: 'Americas', region: 'South America' },
  { city: 'Brasilia',           wikiTitle: 'Brasília',               country: 'Brazil',                  continent: 'Americas', region: 'South America' },
  { city: 'Buenos Aires',       wikiTitle: 'Buenos Aires',           country: 'Argentina',               continent: 'Americas', region: 'South America' },
  { city: 'Caracas',            wikiTitle: 'Caracas',                country: 'Venezuela',               continent: 'Americas', region: 'South America' },
  { city: 'Georgetown',         wikiTitle: 'Georgetown, Guyana',     country: 'Guyana',                  continent: 'Americas', region: 'South America' },
  { city: 'Guatemala City',     wikiTitle: 'Guatemala City',         country: 'Guatemala',               continent: 'Americas', region: 'Central America' },
  { city: 'Havana',             wikiTitle: 'Havana',                 country: 'Cuba',                    continent: 'Americas', region: 'Caribbean' },
  { city: 'Kingston',           wikiTitle: 'Kingston, Jamaica',      country: 'Jamaica',                 continent: 'Americas', region: 'Caribbean' },
  { city: 'La Paz',             wikiTitle: 'La Paz',                 country: 'Bolivia',                 continent: 'Americas', region: 'South America' },
  { city: 'Lima',               wikiTitle: 'Lima',                   country: 'Peru',                    continent: 'Americas', region: 'South America' },
  { city: 'Managua',            wikiTitle: 'Managua',                country: 'Nicaragua',               continent: 'Americas', region: 'Central America' },
  { city: 'Mexico City',        wikiTitle: 'Mexico City',            country: 'Mexico',                  continent: 'Americas', region: 'North America' },
  { city: 'Montevideo',         wikiTitle: 'Montevideo',             country: 'Uruguay',                 continent: 'Americas', region: 'South America' },
  { city: 'Nassau',             wikiTitle: 'Nassau, Bahamas',        country: 'Bahamas',                 continent: 'Americas', region: 'Caribbean' },
  { city: 'Ottawa',             wikiTitle: 'Ottawa',                 country: 'Canada',                  continent: 'Americas', region: 'North America' },
  { city: 'Panama City',        wikiTitle: 'Panama City',            country: 'Panama',                  continent: 'Americas', region: 'Central America' },
  { city: 'Paramaribo',         wikiTitle: 'Paramaribo',             country: 'Suriname',                continent: 'Americas', region: 'South America' },
  { city: 'Port-au-Prince',     wikiTitle: 'Port-au-Prince',         country: 'Haiti',                   continent: 'Americas', region: 'Caribbean' },
  { city: 'Port of Spain',      wikiTitle: 'Port of Spain',          country: 'Trinidad and Tobago',     continent: 'Americas', region: 'Caribbean' },
  { city: 'Quito',              wikiTitle: 'Quito',                  country: 'Ecuador',                 continent: 'Americas', region: 'South America' },
  { city: 'San Jose',           wikiTitle: 'San José, Costa Rica',   country: 'Costa Rica',              continent: 'Americas', region: 'Central America' },
  { city: 'San Salvador',       wikiTitle: 'San Salvador',           country: 'El Salvador',             continent: 'Americas', region: 'Central America' },
  { city: 'Santiago',           wikiTitle: 'Santiago',               country: 'Chile',                   continent: 'Americas', region: 'South America' },
  { city: 'Santo Domingo',      wikiTitle: 'Santo Domingo',          country: 'Dominican Republic',      continent: 'Americas', region: 'Caribbean' },
  { city: 'Tegucigalpa',        wikiTitle: 'Tegucigalpa',            country: 'Honduras',                continent: 'Americas', region: 'Central America' },
  { city: 'Washington',         wikiTitle: 'Washington, D.C.',       country: 'United States',           continent: 'Americas', region: 'North America' },
  // Africa
  { city: 'Abuja',              wikiTitle: 'Abuja',                  country: 'Nigeria',                 continent: 'Africa',   region: 'West Africa' },
  { city: 'Accra',              wikiTitle: 'Accra',                  country: 'Ghana',                   continent: 'Africa',   region: 'West Africa' },
  { city: 'Addis Ababa',        wikiTitle: 'Addis Ababa',            country: 'Ethiopia',                continent: 'Africa',   region: 'East Africa' },
  { city: 'Algiers',            wikiTitle: 'Algiers',                country: 'Algeria',                 continent: 'Africa',   region: 'North Africa' },
  { city: 'Antananarivo',       wikiTitle: 'Antananarivo',           country: 'Madagascar',              continent: 'Africa',   region: 'East Africa' },
  { city: 'Asmara',             wikiTitle: 'Asmara',                 country: 'Eritrea',                 continent: 'Africa',   region: 'East Africa' },
  { city: 'Banjul',             wikiTitle: 'Banjul',                 country: 'Gambia',                  continent: 'Africa',   region: 'West Africa' },
  { city: 'Bissau',             wikiTitle: 'Bissau',                 country: 'Guinea-Bissau',           continent: 'Africa',   region: 'West Africa' },
  { city: 'Brazzaville',        wikiTitle: 'Brazzaville',            country: 'Republic of the Congo',   continent: 'Africa',   region: 'Central Africa' },
  { city: 'Cairo',              wikiTitle: 'Cairo',                  country: 'Egypt',                   continent: 'Africa',   region: 'North Africa' },
  { city: 'Conakry',            wikiTitle: 'Conakry',                country: 'Guinea',                  continent: 'Africa',   region: 'West Africa' },
  { city: 'Dakar',              wikiTitle: 'Dakar',                  country: 'Senegal',                 continent: 'Africa',   region: 'West Africa' },
  { city: 'Djibouti',           wikiTitle: 'Djibouti City',          country: 'Djibouti',                continent: 'Africa',   region: 'East Africa' },
  { city: 'Dodoma',             wikiTitle: 'Dodoma',                 country: 'Tanzania',                continent: 'Africa',   region: 'East Africa' },
  { city: 'Freetown',           wikiTitle: 'Freetown',               country: 'Sierra Leone',            continent: 'Africa',   region: 'West Africa' },
  { city: 'Gaborone',           wikiTitle: 'Gaborone',               country: 'Botswana',                continent: 'Africa',   region: 'Southern Africa' },
  { city: 'Harare',             wikiTitle: 'Harare',                 country: 'Zimbabwe',                continent: 'Africa',   region: 'Southern Africa' },
  { city: 'Juba',               wikiTitle: 'Juba',                   country: 'South Sudan',             continent: 'Africa',   region: 'East Africa' },
  { city: 'Kampala',            wikiTitle: 'Kampala',                country: 'Uganda',                  continent: 'Africa',   region: 'East Africa' },
  { city: 'Khartoum',           wikiTitle: 'Khartoum',               country: 'Sudan',                   continent: 'Africa',   region: 'North Africa' },
  { city: 'Kigali',             wikiTitle: 'Kigali',                 country: 'Rwanda',                  continent: 'Africa',   region: 'East Africa' },
  { city: 'Kinshasa',           wikiTitle: 'Kinshasa',               country: 'DR Congo',                continent: 'Africa',   region: 'Central Africa' },
  { city: 'Libreville',         wikiTitle: 'Libreville',             country: 'Gabon',                   continent: 'Africa',   region: 'Central Africa' },
  { city: 'Lilongwe',           wikiTitle: 'Lilongwe',               country: 'Malawi',                  continent: 'Africa',   region: 'Southern Africa' },
  { city: 'Lome',               wikiTitle: 'Lomé',                   country: 'Togo',                    continent: 'Africa',   region: 'West Africa' },
  { city: 'Luanda',             wikiTitle: 'Luanda',                 country: 'Angola',                  continent: 'Africa',   region: 'Central Africa' },
  { city: 'Lusaka',             wikiTitle: 'Lusaka',                 country: 'Zambia',                  continent: 'Africa',   region: 'Southern Africa' },
  { city: 'Malabo',             wikiTitle: 'Malabo',                 country: 'Equatorial Guinea',       continent: 'Africa',   region: 'Central Africa' },
  { city: 'Maputo',             wikiTitle: 'Maputo',                 country: 'Mozambique',              continent: 'Africa',   region: 'Southern Africa' },
  { city: 'Maseru',             wikiTitle: 'Maseru',                 country: 'Lesotho',                 continent: 'Africa',   region: 'Southern Africa' },
  { city: 'Mbabane',            wikiTitle: 'Mbabane',                country: 'Eswatini',                continent: 'Africa',   region: 'Southern Africa' },
  { city: 'Mogadishu',          wikiTitle: 'Mogadishu',              country: 'Somalia',                 continent: 'Africa',   region: 'East Africa' },
  { city: 'Monrovia',           wikiTitle: 'Monrovia',               country: 'Liberia',                 continent: 'Africa',   region: 'West Africa' },
  { city: 'Moroni',             wikiTitle: 'Moroni, Comoros',        country: 'Comoros',                 continent: 'Africa',   region: 'East Africa' },
  { city: 'Nairobi',            wikiTitle: 'Nairobi',                country: 'Kenya',                   continent: 'Africa',   region: 'East Africa' },
  { city: "N'Djamena",          wikiTitle: "N'Djamena",              country: 'Chad',                    continent: 'Africa',   region: 'Central Africa' },
  { city: 'Niamey',             wikiTitle: 'Niamey',                 country: 'Niger',                   continent: 'Africa',   region: 'West Africa' },
  { city: 'Nouakchott',         wikiTitle: 'Nouakchott',             country: 'Mauritania',              continent: 'Africa',   region: 'West Africa' },
  { city: 'Ouagadougou',        wikiTitle: 'Ouagadougou',            country: 'Burkina Faso',            continent: 'Africa',   region: 'West Africa' },
  { city: 'Porto-Novo',         wikiTitle: 'Porto-Novo',             country: 'Benin',                   continent: 'Africa',   region: 'West Africa' },
  { city: 'Praia',              wikiTitle: 'Praia',                  country: 'Cape Verde',              continent: 'Africa',   region: 'West Africa' },
  { city: 'Rabat',              wikiTitle: 'Rabat',                  country: 'Morocco',                 continent: 'Africa',   region: 'North Africa' },
  { city: 'Tripoli',            wikiTitle: 'Tripoli',                country: 'Libya',                   continent: 'Africa',   region: 'North Africa' },
  { city: 'Tunis',              wikiTitle: 'Tunis',                  country: 'Tunisia',                 continent: 'Africa',   region: 'North Africa' },
  { city: 'Victoria',           wikiTitle: 'Victoria, Seychelles',   country: 'Seychelles',              continent: 'Africa',   region: 'East Africa' },
  { city: 'Windhoek',           wikiTitle: 'Windhoek',               country: 'Namibia',                 continent: 'Africa',   region: 'Southern Africa' },
  { city: 'Yamoussoukro',       wikiTitle: 'Yamoussoukro',           country: 'Ivory Coast',             continent: 'Africa',   region: 'West Africa' },
  // Middle East
  { city: 'Abu Dhabi',          wikiTitle: 'Abu Dhabi',              country: 'United Arab Emirates',    continent: 'Asia',     region: 'Middle East' },
  { city: 'Amman',              wikiTitle: 'Amman',                  country: 'Jordan',                  continent: 'Asia',     region: 'Middle East' },
  { city: 'Ankara',             wikiTitle: 'Ankara',                 country: 'Turkey',                  continent: 'Asia',     region: 'Middle East' },
  { city: 'Baghdad',            wikiTitle: 'Baghdad',                country: 'Iraq',                    continent: 'Asia',     region: 'Middle East' },
  { city: 'Beirut',             wikiTitle: 'Beirut',                 country: 'Lebanon',                 continent: 'Asia',     region: 'Middle East' },
  { city: 'Doha',               wikiTitle: 'Doha',                   country: 'Qatar',                   continent: 'Asia',     region: 'Middle East' },
  { city: 'Jerusalem',          wikiTitle: 'Jerusalem',              country: 'Israel',                  continent: 'Asia',     region: 'Middle East' },
  { city: 'Kuwait City',        wikiTitle: 'Kuwait City',            country: 'Kuwait',                  continent: 'Asia',     region: 'Middle East' },
  { city: 'Manama',             wikiTitle: 'Manama',                 country: 'Bahrain',                 continent: 'Asia',     region: 'Middle East' },
  { city: 'Muscat',             wikiTitle: 'Muscat',                 country: 'Oman',                    continent: 'Asia',     region: 'Middle East' },
  { city: 'Riyadh',             wikiTitle: 'Riyadh',                 country: 'Saudi Arabia',            continent: 'Asia',     region: 'Middle East' },
  { city: 'Sanaa',              wikiTitle: "Sana'a",                 country: 'Yemen',                   continent: 'Asia',     region: 'Middle East' },
  { city: 'Tehran',             wikiTitle: 'Tehran',                 country: 'Iran',                    continent: 'Asia',     region: 'Middle East' },
  // Central Asia
  { city: 'Astana',             wikiTitle: 'Astana',                 country: 'Kazakhstan',              continent: 'Asia',     region: 'Central Asia' },
  { city: 'Baku',               wikiTitle: 'Baku',                   country: 'Azerbaijan',              continent: 'Asia',     region: 'Central Asia' },
  { city: 'Bishkek',            wikiTitle: 'Bishkek',                country: 'Kyrgyzstan',              continent: 'Asia',     region: 'Central Asia' },
  { city: 'Dushanbe',           wikiTitle: 'Dushanbe',               country: 'Tajikistan',              continent: 'Asia',     region: 'Central Asia' },
  { city: 'Tashkent',           wikiTitle: 'Tashkent',               country: 'Uzbekistan',              continent: 'Asia',     region: 'Central Asia' },
  { city: 'Yerevan',            wikiTitle: 'Yerevan',                country: 'Armenia',                 continent: 'Asia',     region: 'Central Asia' },
  // South Asia
  { city: 'Colombo',            wikiTitle: 'Colombo',                country: 'Sri Lanka',               continent: 'Asia',     region: 'South Asia' },
  { city: 'Dhaka',              wikiTitle: 'Dhaka',                  country: 'Bangladesh',              continent: 'Asia',     region: 'South Asia' },
  { city: 'Islamabad',          wikiTitle: 'Islamabad',              country: 'Pakistan',                continent: 'Asia',     region: 'South Asia' },
  { city: 'Kabul',              wikiTitle: 'Kabul',                  country: 'Afghanistan',             continent: 'Asia',     region: 'South Asia' },
  { city: 'Kathmandu',          wikiTitle: 'Kathmandu',              country: 'Nepal',                   continent: 'Asia',     region: 'South Asia' },
  { city: 'New Delhi',          wikiTitle: 'New Delhi',              country: 'India',                   continent: 'Asia',     region: 'South Asia' },
  { city: 'Thimphu',            wikiTitle: 'Thimphu',                country: 'Bhutan',                  continent: 'Asia',     region: 'South Asia' },
  // Southeast Asia
  { city: 'Bandar Seri Begawan', wikiTitle: 'Bandar Seri Begawan',   country: 'Brunei',                  continent: 'Asia',     region: 'Southeast Asia' },
  { city: 'Bangkok',            wikiTitle: 'Bangkok',                country: 'Thailand',                continent: 'Asia',     region: 'Southeast Asia' },
  { city: 'Dili',               wikiTitle: 'Dili',                   country: 'Timor-Leste',             continent: 'Asia',     region: 'Southeast Asia' },
  { city: 'Hanoi',              wikiTitle: 'Hanoi',                  country: 'Vietnam',                 continent: 'Asia',     region: 'Southeast Asia' },
  { city: 'Jakarta',            wikiTitle: 'Jakarta',                country: 'Indonesia',               continent: 'Asia',     region: 'Southeast Asia' },
  { city: 'Kuala Lumpur',       wikiTitle: 'Kuala Lumpur',           country: 'Malaysia',                continent: 'Asia',     region: 'Southeast Asia' },
  { city: 'Manila',             wikiTitle: 'Manila',                 country: 'Philippines',             continent: 'Asia',     region: 'Southeast Asia' },
  { city: 'Naypyidaw',          wikiTitle: 'Naypyidaw',              country: 'Myanmar',                 continent: 'Asia',     region: 'Southeast Asia' },
  { city: 'Phnom Penh',         wikiTitle: 'Phnom Penh',             country: 'Cambodia',                continent: 'Asia',     region: 'Southeast Asia' },
  { city: 'Singapore',          wikiTitle: 'Singapore',              country: 'Singapore',               continent: 'Asia',     region: 'Southeast Asia' },
  { city: 'Vientiane',          wikiTitle: 'Vientiane',              country: 'Laos',                    continent: 'Asia',     region: 'Southeast Asia' },
  // East Asia
  { city: 'Beijing',            wikiTitle: 'Beijing',                country: 'China',                   continent: 'Asia',     region: 'East Asia' },
  { city: 'Pyongyang',          wikiTitle: 'Pyongyang',              country: 'North Korea',             continent: 'Asia',     region: 'East Asia' },
  { city: 'Seoul',              wikiTitle: 'Seoul',                  country: 'South Korea',             continent: 'Asia',     region: 'East Asia' },
  { city: 'Taipei',             wikiTitle: 'Taipei',                 country: 'Taiwan',                  continent: 'Asia',     region: 'East Asia' },
  { city: 'Tokyo',              wikiTitle: 'Tokyo',                  country: 'Japan',                   continent: 'Asia',     region: 'East Asia' },
  { city: 'Ulaanbaatar',        wikiTitle: 'Ulaanbaatar',            country: 'Mongolia',                continent: 'Asia',     region: 'East Asia' },
  // Oceania
  { city: 'Canberra',           wikiTitle: 'Canberra',               country: 'Australia',               continent: 'Oceania',  region: 'Australasia' },
  { city: 'Honiara',            wikiTitle: 'Honiara',                country: 'Solomon Islands',         continent: 'Oceania',  region: 'Melanesia' },
  { city: 'Palikir',            wikiTitle: 'Palikir',                country: 'Micronesia',              continent: 'Oceania',  region: 'Micronesia' },
  { city: 'Port Moresby',       wikiTitle: 'Port Moresby',           country: 'Papua New Guinea',        continent: 'Oceania',  region: 'Melanesia' },
  { city: 'Port Vila',          wikiTitle: 'Port Vila',              country: 'Vanuatu',                 continent: 'Oceania',  region: 'Melanesia' },
  { city: 'Suva',               wikiTitle: 'Suva',                   country: 'Fiji',                    continent: 'Oceania',  region: 'Melanesia' },
  { city: 'Wellington',         wikiTitle: 'Wellington',             country: 'New Zealand',             continent: 'Oceania',  region: 'Australasia' },
];

async function fetchCapital() {
  const capital     = WORLD_CAPITALS[Math.floor(Math.random() * WORLD_CAPITALS.length)];
  const summaryUrl  = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(capital.wikiTitle)}`;
  const resp        = await fetchWithTimeout(summaryUrl, {}, 8000);
  if (!resp.ok) {
    // Try the city name directly as fallback
    const fallback = await fetchWithTimeout(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(capital.city)}`, {}, 8000
    );
    if (!fallback.ok) throw new Error('Could not load capital city article.');
    const d = await fallback.json();
    return buildCapitalArticle(capital, d);
  }
  const data = await resp.json();
  return buildCapitalArticle(capital, data);
}

function buildCapitalArticle(capital, data) {
  return {
    title:       capital.city,
    description: data.description || '',
    extract:     data.extract     || '',
    thumbnail:   data.thumbnail   ? data.thumbnail.source : null,
    pageUrl:     data.content_urls ? data.content_urls.desktop.page
                                   : `https://en.wikipedia.org/wiki/${encodeURIComponent(capital.wikiTitle)}`,
    country:     capital.country,
    continent:   capital.continent,
    region:      capital.region,
  };
}

function showContinentHint() {
  const val = state.article.continent;
  if (!val) { addHintCard('Continent', '<em>Not available.</em>'); return; }
  addHintCard('Continent', `Continent: <strong>${escapeHtml(val)}</strong>`);
}

function showRegionHint() {
  const val = state.article.region;
  if (!val) { addHintCard('Region', '<em>Not available.</em>'); return; }
  addHintCard('Region', `Region: <strong>${escapeHtml(val)}</strong>`);
}

function showCountryHint() {
  const val = state.article.country;
  if (!val) { addHintCard('Country', '<em>Not available.</em>'); return; }
  addHintCard('Country', `Capital of: <strong>${escapeHtml(val)}</strong>`);
}

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
