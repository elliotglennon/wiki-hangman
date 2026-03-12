/* ============================================================
   Wiki Hangman — Game Logic
   Vanilla JS (ES6+), no external dependencies
   ============================================================ */

'use strict';

// ── Constants ─────────────────────────────────────────────────
const MAX_WRONG   = 6;
const BODY_PARTS  = ['bp-head', 'bp-body', 'bp-left-arm', 'bp-right-arm', 'bp-left-leg', 'bp-right-leg'];
const AUTO_REVEAL = new Set(['-', "'", '\u2019', '\u2018', '.', '\u2013', '\u2014']);

const QWERTY_ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M'],
];

const CAT_FILTER_PREFIXES = [
  'articles', 'pages', 'cs1', 'wikipedia', 'all ', 'use ', 'harv',
  'webarchive', 'good articles', 'featured articles',
];

// ── State ──────────────────────────────────────────────────────
let state = {
  article:      null,   // { title, description, extract, thumbnail, pageUrl }
  answer:       '',     // uppercase title
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
const newGameBtn     = $('newGameBtn');
const wrongCountEl   = $('wrongCount');
const wrongLettersEl = $('wrongLetters');
const wordDisplay    = $('wordDisplay');
const hintArea       = $('hintArea');
const keyboard       = $('keyboard');

// ── Initialisation ─────────────────────────────────────────────
function init() {
  buildKeyboard();
  attachEventListeners();
  startNewGame();
}

function attachEventListeners() {
  newGameBtn.addEventListener('click', startNewGame);
  playAgainBtn.addEventListener('click', startNewGame);
  retryBtn.addEventListener('click', startNewGame);

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

  showLoading();
  try {
    const article = await fetchValidArticle();
    hideLoading();
    state.article = article;
    state.answer  = article.title.toUpperCase();
    renderWordDisplay();
    updateHangman();
  } catch (err) {
    hideLoading();
    showError(err.message || 'Could not load a Wikipedia article. Please try again.');
    console.error(err);
  }
}

// ── Wikipedia API Calls ───────────────────────────────────────
async function fetchValidArticle(attempts = 0) {
  if (attempts > 15) throw new Error('Could not find a suitable article after many attempts. Please retry.');

  const url = 'https://en.wikipedia.org/api/rest_v1/page/random/summary';
  const resp = await fetchWithTimeout(url, {}, 8000);
  if (!resp.ok) throw new Error(`Wikipedia API returned ${resp.status}`);
  const data = await resp.json();

  const title       = data.title       || '';
  const description = (data.description || '').toLowerCase();
  const words       = title.trim().split(/\s+/);

  // Filter rules
  if (title.includes(':'))                       return fetchValidArticle(attempts + 1);
  if (description.includes('disambiguation'))    return fetchValidArticle(attempts + 1);
  if (title.length < 3)                          return fetchValidArticle(attempts + 1);
  if (words.length > 5)                          return fetchValidArticle(attempts + 1);

  return {
    title,
    description:  data.description || '',
    extract:      data.extract      || '',
    thumbnail:    data.thumbnail    ? data.thumbnail.source : null,
    pageUrl:      data.content_urls ? data.content_urls.desktop.page : `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}

async function fetchCategories(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=categories&cllimit=40&format=json&origin=*`;
  const resp = await fetchWithTimeout(url, {}, 8000);
  if (!resp.ok) throw new Error('Categories API error');
  const data   = await resp.json();
  const pages  = data.query?.pages || {};
  const page   = Object.values(pages)[0];
  const cats   = (page?.categories || []).map(c => c.title.replace(/^Category:/, ''));

  const filtered = cats.filter(cat => {
    const lower = cat.toLowerCase();
    return !CAT_FILTER_PREFIXES.some(prefix => lower.startsWith(prefix));
  });

  return filtered.slice(0, 5);
}

async function fetchSections(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=sections&format=json&origin=*`;
  const resp = await fetchWithTimeout(url, {}, 8000);
  if (!resp.ok) throw new Error('Sections API error');
  const data     = await resp.json();
  const sections = data.parse?.sections || [];
  return sections.slice(0, 8).map(s => s.line);
}

async function fetchRelated(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/related/${encodeURIComponent(title)}`;
  const resp = await fetchWithTimeout(url, {}, 8000);
  if (!resp.ok) throw new Error('Related API error');
  const data  = await resp.json();
  const pages = data.pages || [];
  return pages.slice(0, 3).map(p => p.title);
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
  const answer = state.answer;

  // Split into words by space, but preserve all chars in order
  const wordsRaw = answer.split(' ');

  wordsRaw.forEach((word, wi) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'word-group';

    for (const char of word) {
      const tile = document.createElement('div');
      tile.className = 'letter-tile';

      const charEl = document.createElement('span');
      charEl.className = 'letter-char';
      charEl.dataset.char = char;

      const lineEl = document.createElement('span');
      lineEl.className = 'letter-line';

      if (AUTO_REVEAL.has(char)) {
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

    // Space between words (not after last word)
    if (wi < wordsRaw.length - 1) {
      const spacer = document.createElement('div');
      spacer.style.width = '10px';
      wordDisplay.appendChild(spacer);
    }
  });
}

function refreshWordDisplay() {
  const charEls = wordDisplay.querySelectorAll('.letter-char');
  charEls.forEach(el => {
    const char = el.dataset.char;
    if (!char || AUTO_REVEAL.has(char)) return;
    if (state.guessed.has(char)) {
      el.textContent = char;
      el.closest('.letter-tile').classList.add('correct');
    }
  });
}

// ── Guessing ──────────────────────────────────────────────────
function guessLetter(letter) {
  if (state.gameOver)              return;
  if (state.guessed.has(letter))   return;
  if (!state.answer)               return;

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
    if (i < state.wrongCount) {
      el.classList.remove('hidden');
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
      el.classList.add('hidden');
    }
  });
}

function updateWrongDisplay() {
  wrongCountEl.textContent = state.wrongCount;
  const wrongLetters = [...state.guessed].filter(l => !state.answer.includes(l));
  wrongLettersEl.textContent = wrongLetters.join('  ');
}

// ── Win / Loss Checks ─────────────────────────────────────────
function checkWin() {
  const answerChars = [...state.answer].filter(c => !AUTO_REVEAL.has(c) && c !== ' ');
  const allGuessed  = answerChars.every(c => state.guessed.has(c));
  if (allGuessed) triggerWin();
}

function checkLoss() {
  if (state.wrongCount >= MAX_WRONG) triggerLoss();
}

function triggerWin() {
  state.gameOver = true;
  state.won      = true;
  disableKeyboard();
  // Reveal all letters
  document.querySelectorAll('.letter-char').forEach(el => {
    const char = el.dataset.char;
    if (char && !AUTO_REVEAL.has(char)) el.textContent = char;
    el.closest('.letter-tile')?.classList.add('correct');
  });
  setTimeout(() => showResult(true), 500);
}

function triggerLoss() {
  state.gameOver = true;
  state.won      = false;
  disableKeyboard();
  // Reveal answer
  document.querySelectorAll('.letter-char').forEach(el => {
    const char = el.dataset.char;
    if (char && !AUTO_REVEAL.has(char) && !state.guessed.has(char)) {
      el.textContent = char;
      el.style.color = '#d33';
    }
  });
  setTimeout(() => showResult(false), 600);
}

function disableKeyboard() {
  document.querySelectorAll('.key-btn').forEach(btn => btn.disabled = true);
}

// ── Result Overlay ────────────────────────────────────────────
function showResult(won) {
  resultBox.classList.remove('won', 'lost');
  if (won) {
    resultBox.classList.add('won');
    resultIcon.textContent    = '🎉';
    resultTitle.textContent   = 'You got it!';
    resultMessage.textContent = `The answer was: "${state.article.title}"`;
  } else {
    resultBox.classList.add('lost');
    resultIcon.textContent    = '💀';
    resultTitle.textContent   = 'Game Over';
    resultMessage.textContent = `The answer was: "${state.article.title}"`;
  }
  resultLink.href        = state.article.pageUrl;
  resultLink.textContent = `Read "${state.article.title}" on Wikipedia →`;
  resultOverlay.classList.remove('hidden');
}

function hideResult() { resultOverlay.classList.add('hidden'); }

// ── Lifelines ─────────────────────────────────────────────────
async function activateLifeline(name) {
  state.lifelinesUsed.add(name);

  const btn = document.querySelector(`[data-lifeline="${name}"]`);
  if (btn) { btn.classList.add('used'); btn.disabled = true; }

  switch (name) {
    case 'description':  showDescriptionHint();          break;
    case 'categories':   await showCategoriesHint();     break;
    case 'contents':     await showContentsHint();       break;
    case 'related':      await showRelatedHint();        break;
    case 'image':        showImageHint();                break;
    case 'firstsentence': showFirstSentenceHint();       break;
  }
}

function showDescriptionHint() {
  if (!state.article.description) {
    addHintCard('Description', '<em>No description available for this article.</em>');
    return;
  }
  addHintCard('Description', escapeHtml(state.article.description));
}

async function showCategoriesHint() {
  addHintCard('Categories', '<em>Loading categories…</em>', 'hint-categories');
  try {
    const cats = await fetchCategories(state.article.title);
    const card = document.querySelector('.hint-categories');
    if (!card) return;
    if (cats.length === 0) {
      card.querySelector('.hint-body').innerHTML = '<em>No categories found.</em>';
    } else {
      const items = cats.map(c => `<li>${escapeHtml(c)}</li>`).join('');
      card.querySelector('.hint-body').innerHTML = `<ul>${items}</ul>`;
    }
  } catch {
    const card = document.querySelector('.hint-categories');
    if (card) card.querySelector('.hint-body').innerHTML = '<em>Could not load categories.</em>';
  }
}

async function showContentsHint() {
  addHintCard('Contents', '<em>Loading sections…</em>', 'hint-contents');
  try {
    const sections = await fetchSections(state.article.title);
    const card = document.querySelector('.hint-contents');
    if (!card) return;
    if (sections.length === 0) {
      card.querySelector('.hint-body').innerHTML = '<em>No sections found.</em>';
    } else {
      const items = sections.map(s => `<li>${escapeHtml(s)}</li>`).join('');
      card.querySelector('.hint-body').innerHTML = `<ul>${items}</ul>`;
    }
  } catch {
    const card = document.querySelector('.hint-contents');
    if (card) card.querySelector('.hint-body').innerHTML = '<em>Could not load sections.</em>';
  }
}

async function showRelatedHint() {
  addHintCard('Related Articles', '<em>Loading related articles…</em>', 'hint-related');
  try {
    const related = await fetchRelated(state.article.title);
    const card = document.querySelector('.hint-related');
    if (!card) return;
    if (related.length === 0) {
      card.querySelector('.hint-body').innerHTML = '<em>No related articles found.</em>';
    } else {
      const items = related.map(t => `<li>${escapeHtml(t)}</li>`).join('');
      card.querySelector('.hint-body').innerHTML = `<ul>${items}</ul>`;
    }
  } catch {
    const card = document.querySelector('.hint-related');
    if (card) card.querySelector('.hint-body').innerHTML = '<em>Could not load related articles.</em>';
  }
}

function showImageHint() {
  if (!state.article.thumbnail) {
    addHintCard('Image', '<em>No image available for this article.</em>');
    return;
  }
  const img = `<img src="${escapeHtml(state.article.thumbnail)}" alt="Article thumbnail" loading="lazy" />`;
  addHintCard('Image', img);
}

function showFirstSentenceHint() {
  const extract = state.article.extract || '';
  if (!extract) {
    addHintCard('First Sentence', '<em>No extract available.</em>');
    return;
  }

  // Extract first sentence (up to first period followed by space or end)
  const firstSentenceMatch = extract.match(/^.+?[.!?](?:\s|$)/);
  let sentence = firstSentenceMatch ? firstSentenceMatch[0].trim() : extract.slice(0, 200).trim();

  // Redact title words (case insensitive)
  const titleWords = state.article.title.split(/\s+/).filter(w => w.length > 0);
  titleWords.forEach(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    sentence = sentence.replace(re, '___');
  });

  addHintCard('First Sentence', escapeHtml(sentence));
}

function addHintCard(title, bodyHtml, extraClass = '') {
  const card = document.createElement('div');
  card.className = `hint-card${extraClass ? ' ' + extraClass : ''}`;
  card.innerHTML = `
    <div class="hint-title">${escapeHtml(title)}</div>
    <div class="hint-body">${bodyHtml}</div>
  `;
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
function showError(msg) {
  errorMsg.textContent = msg;
  errorBanner.classList.remove('hidden');
}
function hideError() { errorBanner.classList.add('hidden'); }

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
