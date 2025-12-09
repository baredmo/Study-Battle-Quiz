
// Study Battle — Quiz Game
// Local leaderboards by group; optional Firebase for online leaderboards & real-time Match mode.

// --- Optional: Fill this to enable online leaderboards & Match mode ---
window.firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

let backend = { type: 'local', db: null };
function initBackend() {
  const cfg = window.firebaseConfig || {};
  if (cfg.apiKey && cfg.databaseURL) {
    try {
      const app = firebase.initializeApp(cfg);
      backend = { type: 'firebase', db: firebase.database() };
      console.log('[Backend] Firebase initialized');
    } catch (e) {
      console.warn('[Backend] Firebase init failed, falling back to local:', e.message);
      backend = { type: 'local', db: null };
    }
  } else {
    backend = { type: 'local', db: null };
  }
}
initBackend();

// Leaderboard helpers
function saveScore(entry) {
  const group = entry.group || 'default';
  if (backend.type === 'firebase') {
    const ref = backend.db.ref(`leaderboards/${encodeURIComponent(group)}`);
    const pushRef = ref.push();
    return pushRef.set(entry);
  } else {
    const key = `leaderboard-${group}`;
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    list.push(entry);
    localStorage.setItem(key, JSON.stringify(list));
    return Promise.resolve();
  }
}

async function fetchLeaderboard(group, limit = 50) {
  group = group || 'default';
  if (backend.type === 'firebase') {
    const snapshot = await backend.db.ref(`leaderboards/${encodeURIComponent(group)}`).get();
    const val = snapshot.val() || {};
    const list = Object.values(val);
    return sortLeaderboard(list).slice(0, limit);
  } else {
    const key = `leaderboard-${group}`;
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    return sortLeaderboard(list).slice(0, limit);
  }
}

function sortLeaderboard(list) {
  return [...list].sort((a, b) => {
    // Higher score first; then higher %; then faster time
    const aPct = a.correct / a.total;
    const bPct = b.correct / b.total;
    if (a.score !== b.score) return b.score - a.score;
    if (aPct !== bPct) return bPct - aPct;
    return a.timeMs - b.timeMs;
  });
}

// Quiz state
let state = {
  player: '',
  group: '',
  questions: [],
  order: [],
  mode: 'practice',
  showExplain: true,
  shuffle: true,
  idx: 0,
  score: 0,
  correct: 0,
  total: 0,
  startTime: 0,
  endTime: 0,
  timeLimitMs: 0,
  timerInterval: null,
};

// Sample questions (used if no file loaded)
const sampleQuestions = [
  {
    id: 1,
    question: "Which planet is known as the Red Planet?",
    choices: ["Earth", "Mars", "Jupiter", "Venus"],
    correctIndex: 1,
    explanation: "Mars appears red due to iron oxide (rust) on its surface."
  },
  {
    id: 2,
    question: "In biology, DNA stands for…",
    choices: ["Deoxyribonucleic Acid", "Dicarboxylic Nitrogenous Acid", "Dual Nucleotide Assembly", "Dynamic Nuclear Array"],
    correctIndex: 0,
    explanation: "DNA = Deoxyribonucleic Acid."
  }
];

// DOM references
const el = {
  setupPanel: document.getElementById('setupPanel'),
  quizPanel: document.getElementById('quizPanel'),
  resultsPanel: document.getElementById('resultsPanel'),
  leaderboardPanel: document.getElementById('leaderboardPanel'),
  playerName: document.getElementById('playerName'),
  classCode: document.getElementById('classCode'),
  modeSelect: document.getElementById('modeSelect'),
  timeMinutes: document.getElementById('timeMinutes'),
  timedOptions: document.getElementById('timedOptions'),
  shuffleToggle: document.getElementById('shuffleToggle'),
  showExplainToggle: document.getElementById('showExplainToggle'),
  questionsFile: document.getElementById('questionsFile'),
  startBtn: document.getElementById('startBtn'),
  hudPlayer: document.getElementById('hudPlayer'),
  hudGroup: document.getElementById('hudGroup'),
  hudScore: document.getElementById('hudScore'),
  hudProgress: document.getElementById('hudProgress'),
  hudTime: document.getElementById('hudTime'),
  qText: document.getElementById('qText'),
  choices: document.getElementById('choices'),
  feedback: document.getElementById('feedback'),
  nextBtn: document.getElementById('nextBtn'),
  resultSummary: document.getElementById('resultSummary'),
  retryBtn: document.getElementById('retryBtn'),
  shareBtn: document.getElementById('shareBtn'),
  lbClassFilter: document.getElementById('lbClassFilter'),
  refreshLbBtn: document.getElementById('refreshLbBtn'),
  leaderboardTableBody: document.querySelector('#leaderboardTable tbody'),
  helpLink: document.getElementById('helpLink'),
};

// Mode-specific UI
el.modeSelect.addEventListener('change', () => {
  const v = el.modeSelect.value;
  el.timedOptions.classList.toggle('hide', v !== 'timed');
  document.getElementById('matchDetails').classList.toggle('hide', v !== 'match');
});

// File upload for questions
el.questionsFile.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    // Expect an array of { id?, question, choices[], correctIndex, explanation? }
    if (Array.isArray(data) && data.length && data[0].question && Array.isArray(data[0].choices)) {
      state.questions = data.map((q, idx) => ({
        id: q.id ?? (idx + 1),
        question: q.question,
        choices: q.choices,
        correctIndex: q.correctIndex,
        explanation: q.explanation || ''
      }));
      alert(`Loaded ${state.questions.length} questions.`);
    } else {
      alert('Invalid questions file format. Expect an array with { question, choices[], correctIndex, explanation? }');
    }
  } catch (err) {
    alert('Failed to read questions file: ' + err.message);
  }
});

// Start quiz
el.startBtn.addEventListener('click', () => {
  const player = (el.playerName.value || '').trim();
  if (!player) { alert('Please enter your name.'); return; }
  state.player = player;
  state.group = (el.classCode.value || '').trim() || 'default';
  state.mode = el.modeSelect.value;
  state.showExplain = el.showExplainToggle.checked;
  state.shuffle = el.shuffleToggle.checked;

  const qs = state.questions.length ? state.questions : sampleQuestions;
  state.total = qs.length;
  state.questions = qs;
  state.order = [...qs.keys()];
  if (state.mode === 'challenge') {
    const seed = hashString(state.group);
    state.order = seededShuffle(state.order, seed);
  } else if (state.shuffle) {
    state.order = shuffle(state.order);
  }

  // Timer config
  if (state.mode === 'timed') {
    const minutes = parseInt(el.timeMinutes.value || '15', 10);
    state.timeLimitMs = Math.max(1, minutes) * 60 * 1000;
  } else {
    state.timeLimitMs = 0;
  }

  // Reset runtime
  state.idx = 0; state.score = 0; state.correct = 0; state.startTime = Date.now(); state.endTime = 0;
  updateHud();
  el.setupPanel.classList.add('hide');
  el.quizPanel.classList.remove('hide');
  renderQuestion();
  startTimer();
});

function updateHud() {
  el.hudPlayer.textContent = state.player || '—';
  el.hudGroup.textContent = state.group || '—';
  el.hudScore.textContent = String(state.score);
  el.hudProgress.textContent = `${state.idx} / ${state.total}`;
}

// Render a question
function renderQuestion() {
  if (state.idx >= state.total) { return finishQuiz(); }
  const q = state.questions[state.order[state.idx]];
  el.qText.textContent = q.question;
  el.choices.innerHTML = '';
  el.feedback.textContent = '';
  el.nextBtn.disabled = true;

  q.choices.forEach((choice, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `<strong>${String.fromCharCode(65 + i)}.</strong> ${escapeHtml(choice)}`;
    btn.addEventListener('click', () => handleAnswer(q, i, btn));
    el.choices.appendChild(btn);
  });

  updateHud();
}

function handleAnswer(q, idx, clickedBtn) {
  const correct = idx === q.correctIndex;
  if (correct) { state.score += 10; state.correct += 1; }
  // lock buttons
  [...el.choices.children].forEach((b, i) => {
    b.disabled = true;
    b.classList.add(i === q.correctIndex ? 'correct' : (i === idx ? 'wrong' : ''));
  });
  el.feedback.innerHTML = correct ? '✅ Correct!' : '❌ Incorrect';
  if (state.showExplain && q.explanation) {
    el.feedback.innerHTML += `<br><em>${escapeHtml(q.explanation)}</em>`;
  }
  el.nextBtn.disabled = false;
  el.nextBtn.onclick = () => { state.idx += 1; renderQuestion(); };
  updateHud();

  // Match mode: record answer
  if (el.modeSelect.value === 'match' && match.roomRef) {
    const path = matchRoomPath(state.group, match.matchId);
    const ansRef = backend.db.ref(path + '/answers');
    ansRef.push({
      player: state.player,
      qid: q.id,
      selected: idx,
      correct: correct,
      ts: Date.now()
    });
  }
}

function finishQuiz() {
  state.endTime = Date.now();
  stopTimer();
  const timeMs = (state.endTime - state.startTime);
  const pct = Math.round((state.correct / state.total) * 100);

  // Save leaderboard entry
  const entry = {
    name: state.player,
    group: state.group,
    score: state.score,
    correct: state.correct,
    total: state.total,
    percent: pct,
    timeMs,
    dateIso: new Date().toISOString()
  };
  saveScore(entry).then(() => console.log('Saved score')).catch(console.error);

  const mins = Math.floor(timeMs / 60000);
  const secs = Math.floor((timeMs % 60000) / 1000);

  el.quizPanel.classList.add('hide');
  el.resultsPanel.classList.remove('hide');

  el.resultSummary.innerHTML = `
    <p><strong>${escapeHtml(entry.name)}</strong> in <strong>${escapeHtml(entry.group)}</strong></p>
    <p>Score: <strong>${entry.score}</strong> • Correct: <strong>${entry.correct}/${entry.total}</strong> (<strong>${entry.percent}%</strong>)</p>
    <p>Time: <strong>${mins}m ${secs}s</strong></p>
  `;

  el.retryBtn.onclick = () => {
    el.resultsPanel.classList.add('hide');
    el.setupPanel.classList.remove('hide');
  };

  el.shareBtn.onclick = async () => {
    const shareUrl = `${location.origin}${location.pathname}?group=${encodeURIComponent(state.group)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      alert('Share link copied! Send it to your classmates to use the same group leaderboard.');
    } catch (e) {
      prompt('Copy this link:', shareUrl);
    }
  };

  loadLeaderboardUI(state.group);
}

// Timer
function startTimer() {
  const start = Date.now();
  const limit = state.timeLimitMs;
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    const elapsed = Date.now() - start;
    const remaining = limit ? Math.max(0, limit - elapsed) : null;
    if (remaining === 0) { clearInterval(state.timerInterval); finishQuiz(); return; }
    el.hudTime.textContent = limit ? formatMs(remaining) : formatMs(elapsed) + ' elapsed';
  }, 250);
}
function stopTimer() { clearInterval(state.timerInterval); }

// Utilities
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (1103515245 * s + 12345) % 2147483648; // LCG
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h *= 16777619; }
  return Math.abs(h) >>> 0;
}
function formatMs(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

// Leaderboard UI
async function loadLeaderboardUI(group) {
  el.lbClassFilter.value = group || '';
  const list = await fetchLeaderboard(group || 'default', 50);
  const tbody = el.leaderboardTableBody;
  tbody.innerHTML = '';
  list.forEach((e, idx) => {
    const mins = Math.floor(e.timeMs / 60000);
    const secs = Math.floor((e.timeMs % 60000) / 1000);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${idx + 1}</td><td>${escapeHtml(e.name)}</td><td>${e.score}</td><td>${e.total}</td><td>${e.percent}%</td><td>${mins}m ${secs}s</td><td>${new Date(e.dateIso).toLocaleString()}</td>`;
    tbody.appendChild(tr);
  });
}

el.refreshLbBtn.addEventListener('click', () => {
  const grp = (el.lbClassFilter.value || '').trim() || 'default';
  loadLeaderboardUI(grp);
});

// Help link
el.helpLink.addEventListener('click', (e) => {
  e.preventDefault();
  alert('Load your questions JSON, enter your name and a class/group code, choose a mode, then Start Quiz.\nConfigure Firebase in app.js to enable online leaderboards and Match mode across devices.');
});

// Read group from query string
(function initFromQuery() {
  const params = new URLSearchParams(location.search);
  const group = params.get('group');
  if (group) { el.classCode.value = group; el.lbClassFilter.value = group; }
  loadLeaderboardUI(group || 'default');
})();

// --- Real-time match mode (Firebase-required for sync) ---
const match = { roomRef: null, isHost: false, matchId: '' };

function matchRoomPath(group, matchId) {
  return `matches/${encodeURIComponent(group)}/${encodeURIComponent(matchId)}`;
}

function requireFirebase() {
  if (backend.type !== 'firebase') {
    alert('Match mode requires Firebase Realtime Database. Please configure firebase in app.js.');
    return false;
  }
  return true;
}

// Show/hide match controls based on mode
(function setupMatchUI(){
  const details = document.getElementById('matchDetails');
  el.modeSelect.addEventListener('change', () => {
    details.classList.toggle('hide', el.modeSelect.value !== 'match');
  });
  const hostBtn = document.getElementById('hostMatchBtn');
  const joinBtn = document.getElementById('joinMatchBtn');
  const matchIdInput = document.getElementById('matchId');
  const rosterList = document.getElementById('rosterList');

  hostBtn.addEventListener('click', async () => {
    if (!requireFirebase()) return;
    const matchId = (matchIdInput.value || '').trim();
    if (!matchId) { alert('Enter a Match ID'); return; }
    match.matchId = matchId;
    const path = matchRoomPath(state.group, matchId);
    match.roomRef = backend.db.ref(path);
    match.isHost = true;
    const qs = state.questions.length ? state.questions : sampleQuestions;
    const order = (state.mode === 'challenge')
      ? seededShuffle([...qs.keys()], hashString(state.group))
      : (state.shuffle ? shuffle([...qs.keys()]) : [...qs.keys()]);
    await match.roomRef.set({
      host: state.player,
      createdIso: new Date().toISOString(),
      roster: {[state.player]: true},
      currentIdx: 0,
      order,
      started: false,
      finished: false,
      scores: {},
    });
    subscribeToRoom(rosterList);
    alert('Match room created. Share the group code and match ID. Click Start Quiz to begin.');
  });

  joinBtn.addEventListener('click', async () => {
    if (!requireFirebase()) return;
    const matchId = (matchIdInput.value || '').trim();
    if (!matchId) { alert('Enter a Match ID'); return; }
    match.matchId = matchId;
    const path = matchRoomPath(state.group, matchId);
    match.roomRef = backend.db.ref(path);
    match.isHost = false;
    await match.roomRef.child('roster').update({[state.player]: true});
    subscribeToRoom(rosterList);
    alert('Joined match room. Wait for host to start the quiz.');
  });
})();

function subscribeToRoom(rosterListEl) {
  match.roomRef.on('value', (snap) => {
    const room = snap.val();
    if (!room) return;
    // Update roster UI
    const names = Object.keys(room.roster || {});
    rosterListEl.textContent = names.join(', ');
    // Sync question order
    if (room.order && Array.isArray(room.order)) {
      state.questions = state.questions.length ? state.questions : sampleQuestions;
      state.total = room.order.length;
      state.order = room.order;
    }
    if (room.started && !room.finished) {
      if (el.quizPanel.classList.contains('hide')) {
        el.setupPanel.classList.add('hide');
        el.quizPanel.classList.remove('hide');
      }
      state.idx = room.currentIdx || 0;
      renderQuestion();
    }
    if (room.finished) {
      finishQuiz();
    }
  });
}

// Override Start for match: host starts the room
(function overrideStartForMatch(){
  el.startBtn.addEventListener('click', async (ev) => {
    const mode = el.modeSelect.value;
    if (mode !== 'match') return;
    ev.preventDefault();
    if (!requireFirebase()) return;
    if (!match.roomRef) { alert('Host or join a match first.'); return; }
    const roomSnap = await match.roomRef.get();
    const room = roomSnap.val();
    if (!room) { alert('Room not found.'); return; }
    if (match.isHost) {
      await match.roomRef.update({ started: true, currentIdx: 0 });
    } else {
      alert('Waiting for host to start.');
    }
  });
})();

// Next button drives room (host only)
(function addNextControl(){
  el.nextBtn.addEventListener('click', async (ev) => {
    const mode = el.modeSelect.value;
    if (mode !== 'match') return;
    ev.preventDefault();
    if (!requireFirebase()) return;
    if (!match.isHost) { alert('Only the host can advance.'); return; }
    const snap = await match.roomRef.get();
    const room = snap.val() || {};
    const nextIdx = (room.currentIdx || 0) + 1;
    if (nextIdx >= (room.order?.length || 0)) {
      await match.roomRef.update({ finished: true });
    } else {
      await match.roomRef.update({ currentIdx: nextIdx });
    }
  });
