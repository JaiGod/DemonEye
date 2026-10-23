/* DemonEye — a cosmic demon eye that watches you.
   Canvas renderer + interaction layer (moods, themes, blink/idle, touch & tilt,
   audio-reactive soundtrack, Comet Hunt gaze game, snapshots, settings). */
(() => {
'use strict';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const bgMusic = document.getElementById('bgMusic');
const $ = (s) => document.querySelector(s);
const TAU = Math.PI * 2;
const APP_URL = 'https://jaineil32624.github.io/DemonEye/';
const APK_URL = 'https://github.com/jaineil32624/DemonEye/releases/latest/download/DemonEye.apk';
const RELEASES_URL = 'https://github.com/jaineil32624/DemonEye/releases/latest';

/* ---------- storage (always guarded) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('demoneye.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('demoneye.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

/* ---------- themes & moods ---------- */
const THEMES = [
  { id: 'inferno', name: 'Inferno', hue: 14 },
  { id: 'abyss', name: 'Abyss', hue: 198 },
  { id: 'venom', name: 'Venom', hue: 124 },
  { id: 'void', name: 'Void', hue: 272 },
  { id: 'solar', name: 'Solar', hue: 46 },
  { id: 'prism', name: 'Prism', hue: null },
];
const MOODS = [
  { id: 'watchful', name: 'Watchful', open: 1, pupil: 1, slit: 1, follow: 0.22, iris: 1, glow: 1, tilt: 0 },
  { id: 'feral', name: 'Feral', open: 0.8, pupil: 0.95, slit: 0.32, follow: 0.42, iris: 2.4, glow: 1.4, tilt: 0.38 },
  { id: 'hypnotic', name: 'Hypnotic', open: 1, pupil: 1.22, slit: 1, follow: 0.07, iris: 1, glow: 1.15, tilt: 0, spiral: true },
  { id: 'sleepy', name: 'Sleepy', open: 0.44, pupil: 1.12, slit: 1, follow: 0.05, iris: 0.35, glow: 0.7, tilt: -0.15 },
  { id: 'startled', name: 'Startled', open: 1.06, pupil: 0.5, slit: 1, follow: 0.55, iris: 1.5, glow: 1.25, tilt: 0, jitter: true },
];
const DENSITY = { low: 0.5, med: 1, high: 1.7 };

const prefersReduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const settings = Object.assign(
  { density: 'med', reduced: prefersReduced, reactive: true, volume: 0.7, idle: true, haptics: true },
  store.get('settings', {})
);
let themeIdx = Math.max(0, THEMES.findIndex((t) => t.id === store.get('theme', 'inferno')));
let moodIdx = Math.max(0, MOODS.findIndex((m) => m.id === store.get('mood', 'watchful')));
let soundPref = store.get('sound', true);

// Share links: #theme=abyss&mood=feral (or ?theme=…) override the saved look
(function readLink() {
  const params = new URLSearchParams((location.hash.slice(1) || '') + '&' + location.search.slice(1));
  const t = THEMES.findIndex((x) => x.id === params.get('theme'));
  const m = MOODS.findIndex((x) => x.id === params.get('mood'));
  if (t >= 0) themeIdx = t;
  if (m >= 0) moodIdx = m;
})();

/* ---------- world state ---------- */
let width = 0, height = 0, dpr = 1, S = 1;
let eyeRadius = 148, pupilLimit = 44, pupilBase = 34;
const center = { x: 0, y: 0 };
const mouse = { x: 0, y: 0 };            // gaze target (pointer / tilt / keyboard / idle)
const pupil = { x: 0, y: 0 };            // smoothed pupil offset
let stars = [], brightStars = [], planets = [], supernovas = [], gammaWaves = [], orbiters = [];
let shockwaves = [], sparks = [], userNovas = [], floaters = [];
let shake = 0, flash = 0, startle = 0, drowsy = 0;
let lastInput = performance.now(), lastPointerSpeedT = 0, lastMove = null;
let blinkT = -1, nextBlink = performance.now() + 2600, flinch = 0;
let wander = { x: 0, y: 0, next: 0 };
let press = null, charge = 0;
let pokes = [], tempMood = null, tempMoodUntil = 0;
let running = true, rafId = 0, lastFrame = performance.now();
let frameCount = 0, accentTimer = 0;
const tilt = { on: false, x: 0, y: 0, base: null, got: false, overrideUntil: 0 };
let cssHue = -1;

function randomBetween(min, max) { return min + Math.random() * (max - min); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
const mood = () => (tempMood && performance.now() < tempMoodUntil ? tempMood : MOODS[moodIdx]);
const theme = () => THEMES[themeIdx];
const themeHue = (time) => (theme().hue === null ? (time * 24) % 360 : theme().hue);

/* ---------- sizing (DPR capped at 2) ---------- */
function resize() {
  const ow = width, oh = height;
  width = window.innerWidth;
  height = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  center.x = width / 2;
  center.y = height / 2;
  S = clamp(Math.min(width, height) / 560, 0.62, 1);
  eyeRadius = 148 * S;
  pupilLimit = 44 * S;
  pupilBase = 34 * S;
  // keep existing scenery spread over the new viewport instead of bunching in a corner
  if (ow && oh && (ow !== width || oh !== height)) {
    const sx = width / ow, sy = height / oh;
    [stars, brightStars, planets, supernovas].forEach((list) => list.forEach((p) => { p.x *= sx; p.y *= sy; }));
    orbiters.forEach((o, i) => { o.radius = (220 + i * 65) * S; o.trail.length = 0; });
  }
  if (!mouse.x && !mouse.y) { mouse.x = center.x; mouse.y = center.y; }
}

/* ---------- scenery (original generators, density-aware) ---------- */
function initStars() {
  const d = DENSITY[settings.density] || 1;
  stars = Array.from({ length: Math.round(190 * d) }, () => ({
    x: randomBetween(0, width),
    y: randomBetween(0, height),
    radius: randomBetween(0.7, 3.1),
    alpha: randomBetween(0.1, 0.95),
    pulse: randomBetween(0.002, 0.012),
    speed: randomBetween(0.08, 0.24),
    vx: 0, vy: 0,
    color: `rgba(255, ${230 - Math.random() * 30}, ${180 - Math.random() * 40},`,
  }));
  brightStars = Array.from({ length: Math.round(28 * d) }, () => ({
    x: randomBetween(0, width),
    y: randomBetween(0, height),
    size: randomBetween(1.6, 3.8),
    alpha: randomBetween(0.65, 1),
    pulse: randomBetween(0.006, 0.016),
  }));
}

function initPlanets() {
  const d = DENSITY[settings.density] || 1;
  planets = Array.from({ length: Math.max(2, Math.round(6 * Math.min(d, 1.3))) }, () => ({
    x: randomBetween(width * 0.1, width * 0.9),
    y: randomBetween(height * 0.15, height * 0.75),
    radius: randomBetween(22, 45) * Math.max(S, 0.75),
    speed: randomBetween(0.28, 0.65),
    drift: randomBetween(-0.14, 0.14),
    phase: Math.random() * TAU,
    explodeSpeed: randomBetween(0.003, 0.01),
    vx: 0, vy: 0,
  }));
}

function initSupernovas() {
  supernovas = Array.from({ length: 4 }, () => ({
    x: randomBetween(width * 0.1, width * 0.9),
    y: randomBetween(height * 0.1, height * 0.8),
    radius: randomBetween(42, 72) * Math.max(S, 0.75),
    phase: Math.random() * TAU,
    glow: randomBetween(0.12, 0.2),
    pulseSpeed: randomBetween(1.6, 2.8),
  }));
}

function initGammaWaves() {
  gammaWaves = Array.from({ length: settings.reduced ? 3 : 5 }, (_, i) => ({
    angle: randomBetween(0, TAU),
    offset: randomBetween(-height * 0.18, height * 0.18),
    speed: randomBetween(0.003, 0.009),
    strength: randomBetween(0.12, 0.22),
    hue: 50 + i * 8,
  }));
}

function initOrbiters() {
  orbiters = Array.from({ length: 4 }, (_, i) => ({
    radius: (220 + i * 65) * S,
    speed: 0.0008 + i * 0.0004,
    size: (8 + i * 2) * Math.max(S, 0.75),
    phase: Math.random() * TAU,
    color: `hsla(${10 + i * 18}, 100%, ${65 - i * 8}%, 0.92)`,
    trail: [],
  }));
}

function initScene() { initStars(); initPlanets(); initSupernovas(); initGammaWaves(); initOrbiters(); }

/* ---------- audio: soundtrack + analyser + sfx ---------- */
let audioCtx = null, musicGain = null, sfxGain = null, analyser = null, freq = null, mediaSrc = null;
let musicOn = false, resumeMusicOnShow = false;
const audioLevel = { bass: 0, level: 0, avgBass: 0, beatCd: 0 };

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      audioCtx = new AC();
      musicGain = audioCtx.createGain();
      musicGain.gain.value = settings.volume;
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.78;
      freq = new Uint8Array(analyser.frequencyBinCount);
      musicGain.connect(analyser);
      analyser.connect(audioCtx.destination);
      sfxGain = audioCtx.createGain();
      sfxGain.gain.value = 0.9;
      sfxGain.connect(audioCtx.destination);
    } catch (e) { audioCtx = null; return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

async function startMusic() {
  ensureAudio();
  // file:// (offline zip) media is origin-tainted, so an analyser would only output silence there
  if (audioCtx && !mediaSrc && location.protocol !== 'file:') {
    try { mediaSrc = audioCtx.createMediaElementSource(bgMusic); mediaSrc.connect(musicGain); } catch (e) { mediaSrc = null; }
  }
  if (!mediaSrc) bgMusic.volume = settings.volume;
  bgMusic.preload = 'auto';
  try {
    await bgMusic.play();
    musicOn = true;
    setHint('Space-Ranger soundtrack activated.');
  } catch (e) {
    musicOn = false;
    if (e && e.name !== 'AbortError') toast('Tap again to start the soundtrack');
  }
  renderSound();
}

function stopMusic() {
  bgMusic.pause();
  musicOn = false;
  renderSound();
}

function setSound(on, quiet) {
  soundPref = on;
  store.set('sound', on);
  if (on) startMusic(); else { stopMusic(); setHint('Sound is off — press M or tap Sound to bring it back.'); }
  if (!quiet) toast(on ? 'Sound on' : 'Sound muted');
  renderSound();
}

function renderSound() {
  const b = $('#btnSound');
  b.setAttribute('aria-pressed', String(soundPref && musicOn));
  $('#soundLbl').textContent = soundPref ? (musicOn ? 'Sound' : 'Sound') : 'Muted';
  b.title = soundPref ? 'Mute (M)' : 'Unmute (M)';
}

function sfxOK() { return soundPref && audioCtx && audioCtx.state === 'running'; }

function playClickSound() {
  if (!sfxOK()) return;
  const now = audioCtx.currentTime;
  const clickOsc = audioCtx.createOscillator();
  const clickGain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  clickOsc.type = 'square';
  clickOsc.frequency.setValueAtTime(620, now);
  clickOsc.frequency.exponentialRampToValueAtTime(260, now + 0.18);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1200, now);
  clickGain.gain.setValueAtTime(0.12, now);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  clickOsc.connect(filter);
  filter.connect(clickGain).connect(sfxGain);
  clickOsc.start(now);
  clickOsc.stop(now + 0.2);
}

function playTone(f1, f2, dur, type, vol) {
  if (!sfxOK()) return;
  const now = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(f1, now);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), now + dur);
  g.gain.setValueAtTime(vol || 0.14, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g).connect(sfxGain);
  o.start(now);
  o.stop(now + dur + 0.02);
}

function playBoom(power) {
  if (!sfxOK()) return;
  const now = audioCtx.currentTime;
  const len = Math.floor(audioCtx.sampleRate * 0.9);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900 + power * 1400, now);
  lp.frequency.exponentialRampToValueAtTime(60, now + 0.85);
  const g = audioCtx.createGain();
  g.gain.value = 0.22 + power * 0.3;
  src.connect(lp).connect(g).connect(sfxGain);
  src.start(now);
  playTone(110, 32, 0.7, 'sine', 0.25 + power * 0.2);
}

function updateAudioLevels(dt) {
  if (analyser && musicOn && !bgMusic.paused) {
    analyser.getByteFrequencyData(freq);
    let b = 0, l = 0;
    for (let i = 1; i < 9; i++) b += freq[i];
    for (let i = 0; i < 96; i++) l += freq[i];
    b = b / (8 * 255);
    l = l / (96 * 255);
    audioLevel.bass += (b - audioLevel.bass) * 0.35;
    audioLevel.level += (l - audioLevel.level) * 0.2;
    audioLevel.avgBass += (b - audioLevel.avgBass) * 0.02;
    audioLevel.beatCd -= dt;
    if (settings.reactive && !settings.reduced && audioLevel.beatCd <= 0 && b > 0.42 && b > audioLevel.avgBass * 1.22) {
      audioLevel.beatCd = 420;
      shockwaves.push({ x: center.x, y: center.y, radius: eyeRadius + 8, alpha: 0.34, width: 2, speed: 11, power: 0.6 });
    }
  } else {
    audioLevel.bass *= 0.92;
    audioLevel.level *= 0.92;
  }
}

/* ---------- feedback helpers ---------- */
let toastTimer = 0;
function toast(msg, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1800);
}
function setHint(msg) { const h = $('#hint'); if (h) h.textContent = msg; }
function buzz(ms) { if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } } }

function burst(x, y, n, speed, hue, life) {
  const d = DENSITY[settings.density] || 1;
  const count = Math.round(n * Math.min(1.3, d));
  for (let i = 0; i < count && sparks.length < 700; i++) {
    const a = Math.random() * TAU, v = (0.3 + Math.random()) * speed;
    sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life || 1, max: life || 1, size: randomBetween(1, 3.2) * Math.max(S, 0.8), hue });
  }
}

function blink(force) { if (blinkT < 0 || force) blinkT = 0; }

/* ---------- interactions ---------- */
function markInput() {
  const now = performance.now();
  if (drowsy > 0.3 && !game.on) {
    startle = 1;
    blink(true);
    setHint('It saw you.');
  }
  lastInput = now;
}

function tap(x, y) {
  playClickSound();
  shockwaves.push({ x: center.x, y: center.y, radius: eyeRadius + 8, alpha: 0.9, width: 4, speed: 16, power: 1.6 });
  burst(x, y, 16, 3.2, null, 0.8);
  buzz(8);
  if (Math.hypot(x - center.x, y - center.y) < eyeRadius) poke();
}

function poke() {
  const now = performance.now();
  blink(true);
  flinch = 1;
  pokes = pokes.filter((t) => now - t < 1600);
  pokes.push(now);
  if (pokes.length >= 3) {
    pokes = [];
    tempMood = MOODS[1];
    tempMoodUntil = now + 4500;
    toast('You have angered the Eye');
    playTone(90, 50, 0.6, 'sawtooth', 0.12);
    shake = Math.max(shake, 8);
  }
}

function nova(x, y, c) {
  userNovas.push({ x, y, r: 0, max: (110 + 260 * c) * Math.max(S, 0.8), life: 1 });
  shockwaves.push({ x, y, radius: 10, alpha: 1, width: 3 + 5 * c, speed: 14 + 12 * c, power: 3 + 6 * c });
  shockwaves.push({ x: center.x, y: center.y, radius: eyeRadius + 8, alpha: 0.7, width: 3, speed: 16, power: 1 });
  burst(x, y, 50 + 90 * c, 5 + 7 * c, null, 1.3);
  if (!settings.reduced) shake = Math.max(shake, 6 + 14 * c);
  flash = Math.max(flash, 0.25 + 0.4 * c);
  startle = 1;
  blink(true);
  playBoom(c);
  buzz([20, 30, 40]);
}

function onPointerDown(e) {
  if (e.target !== canvas) return;
  markInput();
  awaken();
  mouse.x = e.clientX; mouse.y = e.clientY;
  tilt.overrideUntil = performance.now() + 1500;
  press = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, moved: false, type: e.pointerType };
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
}

function onPointerMove(e) {
  const now = performance.now();
  if (lastMove) {
    const dtm = Math.max(1, now - lastMove.t);
    const sp = Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y) / dtm;
    if (sp > 3.2 && now - lastPointerSpeedT > 600 && !game.on) { startle = Math.min(1, startle + 0.7); lastPointerSpeedT = now; }
  }
  lastMove = { x: e.clientX, y: e.clientY, t: now };
  if (e.pointerType === 'mouse' || press || e.buttons) {
    mouse.x = e.clientX; mouse.y = e.clientY;
    tilt.overrideUntil = now + 1500;
    markInput();
  }
  if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 14) press.moved = true;
}

function onPointerUp(e) {
  if (!press || press.id !== e.pointerId) return;
  const p = press;
  press = null;
  const held = performance.now() - p.t;
  if (game.on) {
    if (!game.paused && !p.moved && Math.hypot(e.clientX - center.x, e.clientY - center.y) < eyeRadius * 1.1) gameBlast();
    charge = 0;
    return;
  }
  if (charge >= 0.18) nova(p.x, p.y, charge);
  else if (!p.moved || held < 220) tap(e.clientX, e.clientY);
  charge = 0;
}

let awakened = false;
function awaken() {
  ensureAudio();
  if (awakened) return;
  awakened = true;
  $('#awaken').classList.add('gone');
  if (soundPref) startMusic();
  else setHint('Sound is muted — press M or tap Sound to listen.');
  setTimeout(() => $('#hud').classList.add('compact'), 6000);
}

/* ---------- tilt (DeviceOrientation, iOS permission on tap) ---------- */
function onOrient(e) {
  if (e.gamma === null || e.beta === null) return;
  tilt.got = true;
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  let x = e.gamma, y = e.beta;
  if (ang === 90) { x = e.beta; y = -e.gamma; } else if (ang === -90 || ang === 270) { x = -e.beta; y = e.gamma; }
  if (tilt.base === null) tilt.base = y;
  tilt.x = clamp(x / 28, -1, 1);
  tilt.y = clamp((y - tilt.base) / 24, -1, 1);
}

async function toggleTilt() {
  awaken();
  if (tilt.on) {
    tilt.on = false;
    window.removeEventListener('deviceorientation', onOrient);
    $('#btnTilt').setAttribute('aria-pressed', 'false');
    toast('Tilt control off');
    return;
  }
  if (typeof DeviceOrientationEvent === 'undefined') { toast('Tilt needs a phone or tablet with a gyroscope'); return; }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') { toast('Motion access was denied'); return; }
    }
  } catch (err) { toast('Motion access is unavailable here'); return; }
  tilt.on = true; tilt.base = null; tilt.got = false;
  window.addEventListener('deviceorientation', onOrient);
  $('#btnTilt').setAttribute('aria-pressed', 'true');
  toast('Tilt your device to steer the gaze');
  setTimeout(() => {
    if (tilt.on && !tilt.got) {
      tilt.on = false;
      window.removeEventListener('deviceorientation', onOrient);
      $('#btnTilt').setAttribute('aria-pressed', 'false');
      toast('No gyroscope detected on this device');
    }
  }, 1600);
}

/* ---------- Comet Hunt (gaze game) ---------- */
const game = {
  on: false, paused: false, score: 0, combo: 1, bestCombo: 1, lives: 3, level: 1, caught: 0,
  t: 0, spawnT: 0, comets: [], blastCd: 0, best: store.get('best', 0), played: store.get('played', 0),
};
const BLAST_CD = 9000;

function reticleR() { return (press && press.type === 'touch') || matchMedia('(pointer: coarse)').matches ? 62 * Math.max(S, 0.85) : 50 * Math.max(S, 0.85); }

function startGame() {
  closeAll();
  awaken();
  Object.assign(game, { on: true, paused: false, score: 0, combo: 1, bestCombo: 1, lives: 3, level: 1, caught: 0, t: -1.3, spawnT: 0, comets: [], blastCd: 0 });
  document.body.classList.add('in-game');
  $('#gameHud').hidden = false;
  renderGameHud(true);
  toast('Stare down the comets before they hit the Eye!', 2400);
  playTone(220, 660, 0.35, 'triangle', 0.12);
}

function endGame(quit) {
  game.on = false;
  game.comets = [];
  document.body.classList.remove('in-game');
  $('#gameHud').hidden = true;
  if (quit) return;
  game.played += 1;
  store.set('played', game.played);
  const isBest = game.score > game.best;
  if (isBest) { game.best = game.score; store.set('best', game.best); }
  playTone(isBest ? 330 : 200, isBest ? 990 : 70, 0.8, isBest ? 'triangle' : 'sawtooth', 0.14);
  const o = modal('gameOver', `
    <h2>Eye overwhelmed</h2><p class="sub">Comet Hunt · level ${game.level}</p>
    <div class="big-score"><small>Score</small><b>${game.score}</b></div>
    ${isBest ? '<p class="newbest">New best!</p>' : `<p class="muted" style="text-align:center;margin:0">Best: ${game.best}</p>`}
    <div class="stats"><div><b>${game.caught}</b><small>Comets</small></div><div><b>x${game.bestCombo}</b><small>Best combo</small></div><div><b>${game.level}</b><small>Level</small></div></div>
    <div class="btns"><button class="btn" id="again">Play again</button><button class="btn ghost" data-close>Back to the void</button></div>`);
  o.querySelector('#again').addEventListener('click', startGame);
  setTimeout(() => { const b = o.querySelector('#again'); if (b) b.focus(); }, 50);
}

function openGameIntro() {
  const o = modal('gameIntro', `
    <h2>Comet Hunt</h2><p class="sub">Defend the Eye with nothing but your gaze.</p>
    <ul class="rules">
      <li>Comets fall toward the Eye. <b>Hold your gaze</b> (mouse, finger or tilt) on one until the ring fills to burn it.</li>
      <li>Chain catches for a <b>combo</b> up to x8. <b>Gold</b> comets are worth 5x.</li>
      <li>Green orbs restore a life. Three hits and it is over.</li>
      <li><b>Space</b> or <b>tap the Eye</b> unleashes an Eye Blast that clears the sky (recharges).</li>
    </ul>
    <p class="muted">Best score: <b>${game.best}</b> · games played: ${game.played}</p>
    <div class="btns"><button class="btn" id="go">Start hunting</button><button class="btn ghost" data-close>Not now</button></div>`);
  o.querySelector('#go').addEventListener('click', startGame);
  setTimeout(() => { const b = o.querySelector('#go'); if (b) b.focus(); }, 50);
}

function pauseGame(p) {
  if (!game.on) return;
  game.paused = p;
  if (p) {
    const o = modal('paused', `<h2>Paused</h2><p class="sub">Score ${game.score} · level ${game.level}</p>
      <div class="btns"><button class="btn" data-close>Resume</button><button class="btn ghost" id="quit">Quit game</button></div>`, () => { game.paused = false; lastFrame = performance.now(); });
    o.querySelector('#quit').addEventListener('click', () => { closeAll(); endGame(true); });
  }
}

function spawnComet() {
  const ang = Math.random() * TAU;
  // spawn just beyond the visible edge in that direction
  const dist = Math.min(width / 2 / Math.max(1e-3, Math.abs(Math.cos(ang))), height / 2 / Math.max(1e-3, Math.abs(Math.sin(ang)))) + 30;
  const x = center.x + Math.cos(ang) * dist, y = center.y + Math.sin(ang) * dist;
  const off = randomBetween(-0.6, 0.6) * eyeRadius;
  const tx = center.x - Math.sin(ang) * off, ty = center.y + Math.cos(ang) * off;
  const minDim = Math.min(width, height);
  const r = Math.random();
  const type = r < 0.11 ? 'gold' : (r < 0.15 && game.lives < 3 ? 'life' : 'comet');
  let speed = minDim * (0.13 + (game.level - 1) * 0.02) * randomBetween(0.85, 1.2);
  if (type === 'gold') speed *= 1.35;
  if (type === 'life') speed *= 0.8;
  const a = Math.atan2(ty - y, tx - x);
  game.comets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: (type === 'comet' ? 9 : 11) * Math.max(S, 0.8), type, lock: 0, trail: [] });
}

function catchComet(c, viaBlast) {
  const base = c.type === 'gold' ? 50 : c.type === 'life' ? 5 : 10;
  const pts = viaBlast ? Math.round(base / 2) : base * game.combo;
  game.score += pts;
  game.caught += 1;
  if (c.type === 'life') { game.lives = Math.min(3, game.lives + 1); floaters.push({ x: c.x, y: c.y, text: '+1 life', life: 1 }); }
  else floaters.push({ x: c.x, y: c.y, text: '+' + pts, life: 1 });
  if (!viaBlast) {
    game.combo = Math.min(8, game.combo + 1);
    game.bestCombo = Math.max(game.bestCombo, game.combo);
    const el = $('#ghCombo'); el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 150);
  }
  burst(c.x, c.y, c.type === 'gold' ? 40 : 24, 4, c.type === 'gold' ? 46 : c.type === 'life' ? 130 : null, 0.9);
  playTone(440 * Math.pow(1.12, game.combo), 880 * Math.pow(1.12, game.combo), 0.16, 'triangle', 0.1);
  buzz(12);
}

function gameBlast() {
  if (game.blastCd > 0) { toast('Eye Blast recharging…', 900); return; }
  game.blastCd = BLAST_CD;
  shockwaves.push({ x: center.x, y: center.y, radius: eyeRadius, alpha: 1, width: 7, speed: 22, power: 4, blast: true });
  flash = 0.35;
  if (!settings.reduced) shake = 10;
  playBoom(0.7);
  buzz([15, 20, 30]);
}

function updateGame(dt) {
  if (!game.on || game.paused) return;
  const s = dt / 1000;
  game.t += s;
  game.blastCd = Math.max(0, game.blastCd - dt);
  const lvl = 1 + Math.floor(Math.max(0, game.t) / 18);
  if (lvl !== game.level) { game.level = lvl; toast('Level ' + lvl + ' — the sky grows restless', 1600); }
  if (game.t > 0) {
    game.spawnT -= s;
    if (game.spawnT <= 0) {
      spawnComet();
      if (game.level >= 4 && Math.random() < 0.18) spawnComet();
      game.spawnT = Math.max(0.42, 1.45 - (game.level - 1) * 0.13) * randomBetween(0.75, 1.25);
    }
  }
  const rr = reticleR();
  const R = eyeRadius;
  for (let i = game.comets.length - 1; i >= 0; i--) {
    const c = game.comets[i];
    c.x += c.vx * s; c.y += c.vy * s;
    c.trail.unshift({ x: c.x, y: c.y });
    if (c.trail.length > 14) c.trail.pop();
    const near = Math.hypot(c.x - mouse.x, c.y - mouse.y) < rr + c.r;
    const lockTime = c.type === 'gold' ? 520 : 340;
    c.lock = near ? c.lock + dt / lockTime : Math.max(0, c.lock - dt / 700);
    if (c.lock >= 1) { catchComet(c, false); game.comets.splice(i, 1); continue; }
    // blast waves burn comets they pass
    let burned = false;
    for (const w of shockwaves) {
      if (w.blast && Math.abs(Math.hypot(c.x - w.x, c.y - w.y) - w.radius) < w.speed + c.r + 6) { burned = true; break; }
    }
    if (burned) { catchComet(c, true); game.comets.splice(i, 1); continue; }
    if (Math.hypot(c.x - center.x, c.y - center.y) < R + c.r) {
      game.comets.splice(i, 1);
      if (c.type === 'life') continue;
      game.lives -= 1;
      game.combo = 1;
      burst(c.x, c.y, 30, 4, 0, 1);
      flash = 0.5; flinch = 1; blink(true);
      if (!settings.reduced) shake = 12;
      playTone(160, 40, 0.5, 'sawtooth', 0.16);
      buzz([40, 30, 60]);
      if (game.lives <= 0) { renderGameHud(); endGame(false); return; }
    }
  }
  renderGameHud();
}

let hudCache = '';
function renderGameHud(force) {
  const key = game.score + '|' + game.combo + '|' + game.lives;
  if (!force && key === hudCache) return;
  hudCache = key;
  $('#ghScore').textContent = game.score;
  $('#ghCombo').textContent = 'x' + game.combo;
  $('#ghLives').innerHTML = [0, 1, 2].map((i) => `<i class="${i < game.lives ? '' : 'lost'}"></i>`).join('');
}

function drawGame(time, hue) {
  if (!game.on) return;
  const ch = (hue + 180) % 360;
  const rr = reticleR();
  // gaze beam from the pupil to the reticle
  const px = center.x + pupil.x, py = center.y + pupil.y;
  const anyLock = game.comets.some((c) => c.lock > 0.02);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const beam = ctx.createLinearGradient(px, py, mouse.x, mouse.y);
  beam.addColorStop(0, `hsla(${hue}, 100%, 70%, ${anyLock ? 0.55 : 0.18})`);
  beam.addColorStop(1, `hsla(${hue}, 100%, 80%, ${anyLock ? 0.35 : 0.06})`);
  ctx.strokeStyle = beam;
  ctx.lineWidth = (anyLock ? 4 + Math.sin(time * 40) * 1.5 : 2) * S;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
  ctx.restore();

  // comets
  game.comets.forEach((c) => {
    const h = c.type === 'gold' ? 46 : c.type === 'life' ? 130 : ch;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = c.trail.length - 1; i > 0; i--) {
      const p = c.trail[i];
      ctx.fillStyle = `hsla(${h}, 100%, 70%, ${0.22 * (1 - i / c.trail.length)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, c.r * (1 - i / c.trail.length) * 1.1, 0, TAU); ctx.fill();
    }
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r * 2.4);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, `hsla(${h}, 100%, 70%, 0.9)`);
    g.addColorStop(1, `hsla(${h}, 100%, 50%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 2.4, 0, TAU); ctx.fill();
    ctx.restore();
    if (c.type === 'life') {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(c.x - 4, c.y); ctx.lineTo(c.x + 4, c.y); ctx.moveTo(c.x, c.y - 4); ctx.lineTo(c.x, c.y + 4); ctx.stroke();
    }
    if (c.lock > 0.01) {
      ctx.strokeStyle = 'rgba(255, 245, 230, 0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 9, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, c.lock)); ctx.stroke();
    }
  });

  // reticle
  ctx.save();
  ctx.translate(mouse.x, mouse.y);
  ctx.rotate(time * 0.8);
  ctx.strokeStyle = `hsla(${hue}, 100%, 78%, 0.85)`;
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath(); ctx.arc(0, 0, rr, i * Math.PI / 2 + 0.25, i * Math.PI / 2 + Math.PI / 2 - 0.25); ctx.stroke();
  }
  ctx.fillStyle = `hsla(${hue}, 100%, 85%, 0.9)`;
  ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, TAU); ctx.fill();
  ctx.restore();

  // blast charge ring around the eye
  const ready = 1 - game.blastCd / BLAST_CD;
  ctx.strokeStyle = ready >= 1 ? `hsla(${hue}, 100%, 80%, ${0.5 + Math.sin(time * 5) * 0.3})` : 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(center.x, center.y, eyeRadius + 22 * S, -Math.PI / 2, -Math.PI / 2 + TAU * ready); ctx.stroke();

  if (game.t < 0) {
    ctx.fillStyle = 'rgba(255, 240, 220, 0.95)';
    ctx.font = `700 ${Math.round(28 * Math.max(S, 0.8))}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('GET READY', center.x, center.y - eyeRadius - 44 * S);
  }
}

/* ---------- lids (blink / moods / drowsiness) ---------- */
function drawLids(cx, cy, r, openTop, openBot, tiltV, hue) {
  if (openTop >= 0.999 && openBot >= 0.999) return;
  const N = 28;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r + 1, 0, TAU); ctx.clip();
  ctx.beginPath();
  ctx.rect(cx - r - 4, cy - r - 4, r * 2 + 8, r * 2 + 8);
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const u = -1 + (2 * i) / N;
    const shape = 1 - tiltV * (1 - Math.abs(u));
    pts.push([cx + u * r, cy - r * openTop * Math.sqrt(1 - u * u) * shape * 1.02]);
  }
  for (let i = N; i >= 0; i--) {
    const u = -1 + (2 * i) / N;
    pts.push([cx + u * r, cy + r * openBot * Math.sqrt(1 - u * u) * 1.02]);
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  const lid = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  lid.addColorStop(0, '#2a080c');
  lid.addColorStop(0.5, '#120306');
  lid.addColorStop(1, '#2a080c');
  ctx.fillStyle = lid;
  ctx.fill('evenodd');
  // glowing lash line
  ctx.strokeStyle = 'rgba(255, 120, 90, 0.85)';
  ctx.lineWidth = 3 * S;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) { const p = pts[i]; i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
  ctx.stroke();
  ctx.beginPath();
  for (let i = N + 1; i < pts.length; i++) { const p = pts[i]; i > N + 1 ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
  ctx.stroke();
  ctx.restore();
}

/* ---------- main loop ---------- */
function draw(now) {
  if (!running) return;
  now = now || performance.now();
  const dt = clamp(now - lastFrame, 0, 64);
  lastFrame = now;
  frameCount++;
  const time = now * 0.001;
  const motion = settings.reduced ? 0.35 : 1;
  const k = (dt / 16.67) * motion;      // frame-rate independent step for ambient motion
  const kf = dt / 16.67;                 // full-speed step for interactive effects
  const m = mood();
  const hue = themeHue(time);

  updateAudioLevels(dt);
  updateGame(game.paused ? 0 : dt);
  const reactive = settings.reactive ? 1 : 0;
  const bass = audioLevel.bass * reactive;
  const lvl = audioLevel.level * reactive;

  // gaze target: tilt → idle wander → pointer
  const idleFor = now - lastInput;
  if (tilt.on && tilt.got && now > tilt.overrideUntil) {
    mouse.x = center.x + tilt.x * width * 0.5;
    mouse.y = center.y + tilt.y * height * 0.5;
    lastInput = now;
  } else if (settings.idle && !game.on && idleFor > 5000) {
    if (now > wander.next) {
      const a = Math.random() * TAU, d = randomBetween(0.3, 1) * Math.min(width, height) * 0.4;
      wander.x = center.x + Math.cos(a) * d; wander.y = center.y + Math.sin(a) * d * 0.7;
      wander.next = now + randomBetween(900, 2600);
    }
    mouse.x += (wander.x - mouse.x) * 0.2 * kf;
    mouse.y += (wander.y - mouse.y) * 0.2 * kf;
  }
  drowsy = settings.idle && !game.on ? clamp((idleFor - 25000) / 9000, 0, 0.55) : 0;

  // blink scheduler
  if (now > nextBlink && blinkT < 0) {
    blink();
    const base = m.id === 'sleepy' ? 1600 : 2600;
    nextBlink = now + randomBetween(base, base * 2.6);
  }
  let blinkF = 1;
  if (blinkT >= 0) {
    blinkT += dt / (settings.reduced ? 420 : 260);
    blinkF = blinkT < 0.4 ? 1 - blinkT / 0.4 : clamp((blinkT - 0.4) / 0.6, 0, 1);
    blinkF = blinkF * blinkF * (3 - 2 * blinkF);
    if (blinkT >= 1) blinkT = -1;
  }
  startle = Math.max(0, startle - 0.02 * kf);
  flinch = Math.max(0, flinch - 0.05 * kf);

  // hold-to-charge supernova
  if (press && !press.moved && !game.on) {
    const held = now - press.t;
    charge = held > 280 ? Math.min(1, (held - 280) / 1100) : 0;
  } else if (!press) charge = 0;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  shake *= Math.pow(0.86, kf);
  if (shake > 0.3) ctx.translate(randomBetween(-shake, shake), randomBetween(-shake, shake));

  // Background gradient and subtle noise
  const bg = ctx.createRadialGradient(center.x, center.y - 80, 0, center.x, center.y, Math.max(width, height) * 0.75);
  bg.addColorStop(0, '#1e0910');
  bg.addColorStop(0.45, '#120512');
  bg.addColorStop(1, '#020107');
  ctx.fillStyle = bg;
  ctx.fillRect(-40, -40, width + 80, height + 80);

  // parallax: background drifts against the gaze
  const parX = -pupil.x * 0.35, parY = -pupil.y * 0.35;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(parX, parY);
  const starBoost = 1 + lvl * 0.9;
  stars.forEach((star) => {
    star.alpha += star.pulse * k;
    if (star.alpha > 1 || star.alpha < 0.15) { star.pulse *= -1; star.alpha = clamp(star.alpha, 0.15, 1); }
    star.y += star.speed * k + star.vy * kf;
    star.x += Math.sin(time * 0.3 + star.x * 0.02) * 0.12 * k + star.vx * kf;
    star.vx *= Math.pow(0.93, kf); star.vy *= Math.pow(0.93, kf);
    if (star.y > height + 20) star.y = -20;
    if (star.y < -20) star.y = height + 20;
    if (star.x > width + 20) star.x = -20;
    if (star.x < -20) star.x = width + 20;
    ctx.fillStyle = `${star.color} ${Math.min(1, star.alpha * starBoost)})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, TAU);
    ctx.fill();
  });
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Soft nebula glow waves
  for (let i = 0; i < 4; i++) {
    const wave = ctx.createRadialGradient(
      center.x + Math.cos(time * motion * (0.5 + i * 0.12)) * 120,
      center.y + Math.sin(time * motion * (0.4 + i * 0.14)) * 60,
      0, center.x, center.y, Math.max(width, height) * 0.6
    );
    wave.addColorStop(0, `rgba(255, 100, 80, ${(0.08 - i * 0.015) * (1 + bass * 1.2)})`);
    wave.addColorStop(0.45, `rgba(160, 40, 35, ${0.018 + i * 0.01})`);
    wave.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wave;
    ctx.fillRect(0, 0, width, height);
  }
  // Light band shimmer
  for (let i = 0; i < 3; i++) {
    const offset = Math.sin(time * motion * (1.1 + i * 0.5) + i * 1.3) * 18;
    const band = ctx.createLinearGradient(0, center.y + offset, width, center.y + offset + 40);
    band.addColorStop(0, 'rgba(255, 210, 155, 0)');
    band.addColorStop(0.32, 'rgba(255, 210, 155, 0.07)');
    band.addColorStop(0.5, `rgba(255, 180, 115, ${0.14 + lvl * 0.2})`);
    band.addColorStop(0.68, 'rgba(255, 210, 155, 0.07)');
    band.addColorStop(1, 'rgba(255, 210, 155, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, center.y + offset - 20, width, 40);
  }
  ctx.restore();

  // Orbit rings and orbiters
  const trailMax = settings.density === 'low' ? 24 : 50;
  orbiters.forEach((orbiter) => {
    orbiter.phase += orbiter.speed * k * (1 + lvl * 2);
    const angle = orbiter.phase;
    const x = center.x + Math.cos(angle) * orbiter.radius;
    const y = center.y + Math.sin(angle) * orbiter.radius * 0.8;
    orbiter.trail.unshift({ x, y });
    if (orbiter.trail.length > trailMax) orbiter.trail.length = trailMax;
    orbiter.trail.forEach((trail, index) => {
      ctx.fillStyle = `rgba(255, 150, 110, ${0.08 * (1 - index / orbiter.trail.length)})`;
      ctx.beginPath();
      ctx.arc(trail.x, trail.y, orbiter.size * 0.5, 0, TAU);
      ctx.fill();
    });
    const ringPulse = 1 + Math.sin(time * 1.3 + orbiter.phase * 0.7) * 0.04 + bass * 0.05;
    ctx.strokeStyle = 'rgba(255, 120, 90, 0.2)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, orbiter.radius * ringPulse, orbiter.radius * 0.8 * ringPulse, 0, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = orbiter.color;
    ctx.shadowColor = orbiter.color;
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(x, y, orbiter.size, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  // Pupil position (smoothed, mood-dependent follow speed)
  const dx = mouse.x - center.x;
  const dy = mouse.y - center.y;
  const angle = Math.atan2(dy, dx);
  const dist = Math.min(Math.hypot(dx, dy), pupilLimit);
  let tx = Math.cos(angle) * dist, ty = Math.sin(angle) * dist;
  if (m.spiral) { tx = tx * 0.4 + Math.cos(time * 1.4) * pupilLimit * 0.25; ty = ty * 0.4 + Math.sin(time * 1.4) * pupilLimit * 0.25; }
  const follow = 1 - Math.pow(1 - m.follow, kf);
  pupil.x += (tx - pupil.x) * follow;
  pupil.y += (ty - pupil.y) * follow;
  let pupilX = center.x + pupil.x;
  let pupilY = center.y + pupil.y;
  if (m.jitter || startle > 0.5) { pupilX += randomBetween(-1.2, 1.2) * S; pupilY += randomBetween(-1.2, 1.2) * S; }

  // Shockwaves (from the eye or anywhere a supernova is born) push the stars around
  shockwaves = shockwaves.filter((wave) => wave.alpha > 0.01 && wave.radius < Math.hypot(width, height) * 1.2);
  shockwaves.forEach((wave) => {
    ctx.strokeStyle = `rgba(255, 235, 160, ${wave.alpha})`;
    ctx.lineWidth = wave.width || 4;
    ctx.beginPath();
    ctx.arc(wave.x, wave.y, wave.radius, 0, TAU);
    ctx.stroke();
    const prev = wave.radius;
    wave.radius += wave.speed * kf;
    wave.alpha *= Math.pow(wave.blast ? 0.93 : 0.86, kf);
    const p = (wave.power || 1) * wave.alpha;
    if (p > 0.05) {
      for (const st of stars) {
        const sx = st.x + parX - wave.x, sy = st.y + parY - wave.y;
        const d = Math.hypot(sx, sy);
        if (d > prev - 30 && d < wave.radius + 30 && d > 1) { st.vx += (sx / d) * p * 0.9; st.vy += (sy / d) * p * 0.9; }
      }
      for (const pl of planets) {
        const sx = pl.x - wave.x, sy = pl.y - wave.y, d = Math.hypot(sx, sy);
        if (d > prev - 40 && d < wave.radius + 40 && d > 1) { pl.vx += (sx / d) * p * 0.25; pl.vy += (sy / d) * p * 0.25; }
      }
    }
  });

  const eyeScale = 1 + Math.max(0, m.open - 1) + startle * 0.03 + bass * 0.045 + (settings.reduced ? 0 : Math.sin(time * 1.6) * 0.006);
  const R = eyeRadius * eyeScale;

  // Eye glow
  const gk = m.glow * (1 + bass * 0.9) + flash;
  const glow = ctx.createRadialGradient(center.x, center.y, R * 0.3, center.x, center.y, R * 1.6);
  glow.addColorStop(0, `rgba(255, 180, 142, ${Math.min(0.9, 0.3 * gk)})`);
  glow.addColorStop(0.4, `rgba(235, 90, 50, ${Math.min(0.6, 0.14 * gk)})`);
  glow.addColorStop(1, 'rgba(8, 4, 3, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(center.x, center.y, R * 1.7, 0, TAU);
  ctx.fill();

  // Bright star cluster highlights
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(parX * 1.4, parY * 1.4);
  brightStars.forEach((star) => {
    star.alpha += star.pulse * (Math.sin(time * 1.3 + star.x * 0.02) + 1) * 0.2 * k;
    star.alpha = clamp(star.alpha, 0.5, 1);
    star.x += Math.cos(time * 0.15 + star.y * 0.01) * 0.04 * k;
    star.y += Math.sin(time * 0.12 + star.x * 0.01) * 0.06 * k;
    if (star.x > width) star.x = 0;
    if (star.x < 0) star.x = width;
    if (star.y > height) star.y = 0;
    if (star.y < 0) star.y = height;
    ctx.fillStyle = `rgba(255, 240, 190, ${star.alpha})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size * 1.2 * (1 + bass * 0.5), 0, TAU);
    ctx.fill();
  });
  ctx.restore();

  // Gamma wave ribbons
  gammaWaves.forEach((ray) => {
    ray.angle += ray.speed * k;
    const xOffset = Math.cos(ray.angle) * width * 0.55;
    const yOffset = Math.sin(ray.angle) * height * 0.18;
    const gradient = ctx.createLinearGradient(center.x - xOffset, center.y - yOffset + ray.offset, center.x + xOffset, center.y + yOffset + ray.offset);
    gradient.addColorStop(0, 'rgba(255,180,120,0)');
    gradient.addColorStop(0.35, `hsla(${ray.hue}, 100%, 75%, 0.08)`);
    gradient.addColorStop(0.5, `hsla(${ray.hue}, 100%, 85%, ${0.12 + lvl * 0.15})`);
    gradient.addColorStop(0.65, `hsla(${ray.hue}, 100%, 75%, 0.08)`);
    gradient.addColorStop(1, 'rgba(255,180,120,0)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = ray.strength * 24 * (1 + bass * 0.8);
    ctx.beginPath();
    ctx.moveTo(center.x - xOffset, center.y - yOffset + ray.offset);
    ctx.lineTo(center.x + xOffset, center.y + yOffset + ray.offset);
    ctx.stroke();
  });

  // Supernova bursts
  supernovas.forEach((nova) => {
    const pulse = Math.sin(time * motion * nova.pulseSpeed + nova.phase) * 0.5 + 0.8;
    const radius = nova.radius * pulse;
    const glowFill = ctx.createRadialGradient(nova.x, nova.y, 0, nova.x, nova.y, radius * 1.2);
    glowFill.addColorStop(0, `rgba(255, 255, 210, ${nova.glow * 0.9})`);
    glowFill.addColorStop(0.3, `rgba(255, 145, 90, ${nova.glow * 0.26})`);
    glowFill.addColorStop(0.6, 'rgba(255, 90, 35, 0.04)');
    glowFill.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glowFill;
    ctx.beginPath();
    ctx.arc(nova.x, nova.y, radius, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 190, 130, ${0.16 * pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(nova.x, nova.y, radius * 0.6, 0, TAU);
    ctx.stroke();
  });

  // Player-made supernovas (hold & release)
  userNovas = userNovas.filter((n) => n.life > 0.01);
  userNovas.forEach((n) => {
    n.r += (n.max - n.r) * 0.12 * kf;
    n.life *= Math.pow(0.978, kf);
    const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
    g.addColorStop(0, `rgba(255, 255, 240, ${n.life})`);
    g.addColorStop(0.18, `rgba(255, 220, 160, ${0.85 * n.life})`);
    g.addColorStop(0.45, `rgba(255, 120, 70, ${0.45 * n.life})`);
    g.addColorStop(0.75, `rgba(200, 40, 25, ${0.18 * n.life})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(255, 220, 170, ${0.6 * n.life})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 0.72, 0, TAU); ctx.stroke();
    ctx.restore();
  });

  // Exploding planets and cosmic debris
  planets.forEach((planet) => {
    planet.x += Math.cos(planet.phase) * planet.speed * 0.5 * k + planet.vx * kf;
    planet.y += planet.drift * k + planet.vy * kf;
    planet.vx *= Math.pow(0.95, kf); planet.vy *= Math.pow(0.95, kf);
    planet.phase += 0.0012 * k;
    if (planet.x < -80) planet.x = width + 80;
    if (planet.x > width + 80) planet.x = -80;
    if (planet.y < -80) planet.y = height + 80;
    if (planet.y > height + 80) planet.y = -80;
    const explosion = Math.sin(time * planet.explodeSpeed + planet.phase) * 0.45 + 0.55;
    const baseRadius = planet.radius * (0.85 + explosion * 0.25);
    const debrisRadius = baseRadius * 1.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const planetGradient = ctx.createRadialGradient(planet.x, planet.y, 0, planet.x, planet.y, baseRadius);
    planetGradient.addColorStop(0, 'rgba(255, 220, 170, 0.92)');
    planetGradient.addColorStop(0.28, `rgba(255, ${Math.round(160 - planet.radius * 0.8)}, 120, 0.75)`);
    planetGradient.addColorStop(0.62, 'rgba(140, 40, 25, 0.34)');
    planetGradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = planetGradient;
    ctx.beginPath();
    ctx.arc(planet.x, planet.y, baseRadius, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 170, 110, ${0.22 + explosion * 0.12})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(planet.x, planet.y, baseRadius * 0.92, 0, TAU);
    ctx.stroke();
    for (let n = 0; n < 5; n++) {
      const debrisAngle = time * motion * 1.4 + n * 1.2 + planet.phase;
      const debrisDist = debrisRadius + Math.sin(time * 2.4 + n) * 9;
      ctx.fillStyle = `rgba(255, 215, 170, ${0.18 - n * 0.02})`;
      ctx.beginPath();
      ctx.arc(planet.x + Math.cos(debrisAngle) * debrisDist, planet.y + Math.sin(debrisAngle) * debrisDist, 4 - n * 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  });

  // Sparks
  if (sparks.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx * kf; s.y += s.vy * kf;
      s.vx *= Math.pow(0.96, kf); s.vy *= Math.pow(0.96, kf);
      s.life -= 0.02 * kf;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      const a = s.life / s.max;
      ctx.fillStyle = s.hue === null || s.hue === undefined ? `rgba(255, ${200 + a * 50}, ${150 + a * 80}, ${a})` : `hsla(${s.hue}, 100%, ${60 + a * 25}%, ${a})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size * (0.5 + a), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // Charge ring while holding
  if (charge > 0 && press) {
    const cx = press.x, cy = press.y, cr = (20 + charge * 70) * Math.max(S, 0.8);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    cg.addColorStop(0, `rgba(255, 250, 220, ${0.5 * charge})`);
    cg.addColorStop(1, 'rgba(255, 120, 60, 0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(255, 220, 170, ${0.4 + charge * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, cr + 8, -Math.PI / 2, -Math.PI / 2 + TAU * charge); ctx.stroke();
    ctx.restore();
    if (Math.random() < 0.6 * kf && sparks.length < 700) {
      const a = Math.random() * TAU, d = cr * 2.2;
      sparks.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, vx: -Math.cos(a) * d / 22, vy: -Math.sin(a) * d / 22, life: 0.5, max: 0.5, size: 1.6, hue: null });
    }
  }

  // Eye outer ring
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(255, 120, 90, 0.88)';
  ctx.lineWidth = 12 * S;
  ctx.beginPath();
  ctx.arc(center.x, center.y, R + 6 * S, 0, TAU);
  ctx.stroke();

  // Flowing halo rings
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = `rgba(255, 186, 124, ${(0.14 - i * 0.02) * (1 + bass * 1.5)})`;
    ctx.lineWidth = (5 - i) * S;
    ctx.beginPath();
    ctx.ellipse(
      center.x, center.y,
      R * 1.05 + (i * 13 + Math.sin(time * motion * (1.5 - i * 0.09) + i * 1.8) * 10 * (1 + bass * 2)) * S,
      R * 0.95 + (i * 11 + Math.cos(time * motion * (1.2 + i * 0.07) + i * 1.4) * 10 * (1 + bass * 2)) * S,
      0, 0, TAU
    );
    ctx.stroke();
  }

  // Sclera
  const sclera = ctx.createRadialGradient(center.x, center.y, 20 * S, center.x, center.y, R);
  sclera.addColorStop(0, '#ffe6cc');
  sclera.addColorStop(0.2, '#ffad7e');
  sclera.addColorStop(0.55, '#af2c21');
  sclera.addColorStop(1, '#210606');
  ctx.fillStyle = sclera;
  ctx.beginPath();
  ctx.arc(center.x, center.y, R, 0, TAU);
  ctx.fill();

  // Iris pattern (radial fibres, or a hypnotic spiral)
  if (m.spiral) {
    for (let arm = 0; arm < 6; arm++) {
      ctx.strokeStyle = `rgba(255, ${150 + arm * 12}, ${100 + arm * 8}, 0.42)`;
      ctx.lineWidth = 2.5 * S;
      ctx.beginPath();
      for (let j = 0; j <= 30; j++) {
        const t = j / 30;
        const a = arm * (TAU / 6) + t * 4.2 + time * 1.6 * motion;
        const rr = R * (0.18 + t * 0.6);
        const x = center.x + Math.cos(a) * rr, y = center.y + Math.sin(a) * rr;
        j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  } else {
    const irisSpeed = 0.0009 * m.iris * (settings.reduced ? 0.4 : 1) * (1 + lvl * 2);
    for (let i = 0; i < 42; i++) {
      const t = i / 42;
      const r1 = R * (0.52 + Math.sin(time * 0.002 + t * 3.1) * 0.008);
      const r2 = R * (0.7 + Math.sin((t + now * irisSpeed) * 7) * (0.05 + bass * 0.05));
      const a = t * TAU;
      ctx.strokeStyle = `rgba(255, ${Math.round(120 + t * 80)}, ${Math.round(70 + t * 50)}, ${0.18 + t * 0.18})`;
      ctx.lineWidth = 2 * S;
      ctx.beginPath();
      ctx.moveTo(center.x + Math.cos(a) * r1, center.y + Math.sin(a) * r1);
      ctx.lineTo(center.x + Math.cos(a) * r2, center.y + Math.sin(a) * r2);
      ctx.stroke();
    }
  }

  const iris = ctx.createRadialGradient(center.x, center.y, 4, center.x, center.y, R * 0.78);
  iris.addColorStop(0, '#ffd8b6');
  iris.addColorStop(0.2, '#ff7a5c');
  iris.addColorStop(0.5, '#a92b1f');
  iris.addColorStop(0.85, m.spiral ? 'rgba(38,8,11,0.6)' : '#26080b');
  ctx.fillStyle = iris;
  ctx.globalAlpha = m.spiral ? 0.75 : 1;
  ctx.beginPath();
  ctx.arc(center.x, center.y, R * 0.78, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Pupil (size reacts to mood, bass, startle; slit for feral)
  let pr = pupilBase * m.pupil * (1 + bass * 0.22) * (1 - startle * 0.45);
  if (m.spiral) pr *= 1 + Math.sin(time * 3) * 0.08;
  const pupilGradient = ctx.createRadialGradient(pupilX, pupilY, 4, pupilX, pupilY, pr * 1.04);
  pupilGradient.addColorStop(0, '#000');
  pupilGradient.addColorStop(1, '#020815');
  ctx.fillStyle = pupilGradient;
  ctx.beginPath();
  ctx.ellipse(pupilX, pupilY, Math.max(3, pr * m.slit), pr * (m.slit < 1 ? 1.25 : 1), 0, 0, TAU);
  ctx.fill();

  // Pupil specular highlight
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.beginPath();
  ctx.arc(pupilX - 12 * S * (m.slit < 1 ? 0.5 : 1), pupilY - 12 * S, 8 * S * (m.slit < 1 ? 0.6 : 1), 0, TAU);
  ctx.fill();

  // Eye detail rings
  ctx.strokeStyle = 'rgba(189, 232, 255, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(center.x, center.y, R * 0.38, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(center.x, center.y, R * 0.22, 0, TAU);
  ctx.stroke();

  // Lids: mood openness, drowsiness, blinking and flinching
  const open = clamp(Math.min(1, m.open) - drowsy - flinch * 0.35 + startle * 0.15, 0.04, 1) * blinkF;
  drawLids(center.x, center.y, R, open, Math.min(1, open * 1.25 + (blinkF < 1 ? 0 : 0)), m.tilt, hue);

  // Theme: re-tint the whole scene with a single hue (keeps the original luminance)
  if (theme().id !== 'inferno') {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'hue';
    ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  drawGame(time, hue);

  // floating score text
  if (floaters.length) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(18 * Math.max(S, 0.85))}px Inter, system-ui, sans-serif`;
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= 0.022 * kf; f.y -= 0.8 * kf;
      if (f.life <= 0) { floaters.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(255, 240, 220, ${f.life})`;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  // hit / nova flash
  if (flash > 0.01) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `rgba(255, 230, 200, ${Math.min(0.35, flash * 0.5)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    flash *= Math.pow(0.88, kf);
  }

  // keep CSS accent in sync with the theme (throttled)
  accentTimer -= dt;
  if (accentTimer <= 0) { accentTimer = 250; applyAccent(hue); }

  rafId = requestAnimationFrame(draw);
}

function applyAccent(h) {
  h = Math.round(h);
  if (h === cssHue) return;
  cssHue = h;
  const r = document.documentElement.style;
  r.setProperty('--accent', `hsl(${h} 100% 68%)`);
  r.setProperty('--accent-soft', `hsla(${h}, 100%, 60%, 0.28)`);
  r.setProperty('--accent-glow', `hsla(${h}, 100%, 60%, 0.45)`);
  r.setProperty('--line', `hsla(${h}, 100%, 72%, 0.22)`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = `hsl(${h}, 45%, 6%)`;
}

/* ---------- pause when hidden ---------- */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    running = false;
    cancelAnimationFrame(rafId);
    resumeMusicOnShow = musicOn;
    if (musicOn) { bgMusic.pause(); musicOn = false; }
    if (audioCtx && audioCtx.state === 'running') audioCtx.suspend().catch(() => {});
    if (game.on && !game.paused) pauseGame(true);
  } else {
    running = true;
    lastFrame = performance.now();
    if (audioCtx && soundPref && awakened) audioCtx.resume().catch(() => {});
    if (resumeMusicOnShow && soundPref) startMusic();
    rafId = requestAnimationFrame(draw);
  }
});

/* ---------- overlays ---------- */
function modal(id, html, onClose) {
  closeAll(true);
  const o = document.createElement('div');
  o.className = 'overlay';
  o.id = id;
  o.innerHTML = `<div class="panel" role="dialog" aria-modal="true"><button class="close" data-close aria-label="Close">×</button>${html}</div>`;
  o._onClose = onClose;
  o.addEventListener('click', (e) => { if (e.target === o || e.target.closest('[data-close]')) closeOverlay(o); });
  $('#overlays').appendChild(o);
  requestAnimationFrame(() => o.classList.add('show'));
  return o;
}
function closeOverlay(o) {
  if (!o || !o.parentNode) return;
  o.classList.remove('show');
  o.style.pointerEvents = 'none';
  const cb = o._onClose; o._onClose = null;
  setTimeout(() => o.remove(), 160);
  if (cb) cb();
}
function closeAll(silent) {
  document.querySelectorAll('.overlay').forEach((o) => {
    if (silent) { o._onClose = null; }
    closeOverlay(o);
  });
}

function openHelp() {
  modal('help', `
    <h2>Commune with the Eye</h2><p class="sub">Gestures and keyboard shortcuts</p>
    <div class="keys">
      <span><kbd>Tap</kbd></span><span>Shockwave from the Eye · tap the Eye itself to poke it (three pokes angers it)</span>
      <span><kbd>Hold</kbd></span><span>Charge a supernova, release to detonate</span>
      <span><kbd>M</kbd></span><span>Mute / unmute the soundtrack</span>
      <span><kbd>1</kbd>–<kbd>5</kbd></span><span>Moods: Watchful, Feral, Hypnotic, Sleepy, Startled</span>
      <span><kbd>T</kbd></span><span>Next color theme</span>
      <span><kbd>G</kbd></span><span>Comet Hunt mini-game · <kbd>P</kbd> pause</span>
      <span><kbd>Space</kbd></span><span>Shockwave (Eye Blast in Comet Hunt)</span>
      <span><kbd>B</kbd></span><span>Make the Eye blink</span>
      <span><kbd>←↑→↓</kbd></span><span>Steer the gaze with the keyboard</span>
      <span><kbd>S</kbd></span><span>Save a PNG snapshot</span>
      <span><kbd>F</kbd></span><span>Fullscreen</span>
      <span><kbd>H</kbd></span><span>Hide / show the interface</span>
      <span><kbd>,</kbd></span><span>Settings</span>
      <span><kbd>?</kbd></span><span>This help · <kbd>Esc</kbd> closes panels</span>
    </div>
    <p class="muted">On phones, turn on <b>Tilt</b> to steer the gaze by tilting your device.</p>`);
}

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
function openInstall() {
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const o = modal('install', `
    <h2>Get DemonEye</h2><p class="sub">Keep the Eye on your home screen — it works offline.</p>
    <div class="dl-grid">
      <a class="dl" href="${APK_URL}"><span class="ic">🤖</span><b>Android</b><small>Download DemonEye.apk</small></a>
      <button class="dl" id="pwaInstall"><span class="ic">💻</span><b>Install app</b><small>Chrome / Edge on desktop &amp; Android</small></button>
      <div class="dl"><span class="ic">🍎</span><b>iPhone / iPad</b><small>Safari → Share → Add to Home Screen</small></div>
      <a class="dl" href="${RELEASES_URL}"><span class="ic">📦</span><b>All downloads</b><small>APK + offline web zip</small></a>
    </div>
    <p class="muted">${isNative ? 'You are already in the app. ' : ''}No account, no ads, no tracking.</p>`);
  o.querySelector('#pwaInstall').addEventListener('click', async () => {
    if (deferredInstall) {
      deferredInstall.prompt();
      const r = await deferredInstall.userChoice;
      deferredInstall = null;
      if (r.outcome === 'accepted') { toast('Installed — the Eye is watching from your home screen'); closeOverlay(o); }
    } else toast('Use your browser menu → “Install app” / “Add to Home screen”', 3400);
  });
}

function lookLink() { return APP_URL + '#theme=' + theme().id + '&mood=' + MOODS[moodIdx].id; }
async function copyLook() {
  const url = lookLink();
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: 'DemonEye', text: 'The Eye is watching you', url }); return; }
    await navigator.clipboard.writeText(url);
    toast('Link to this look copied');
  } catch (e) { if (!e || e.name !== 'AbortError') toast(url, 4000); }
}

function openSettings() {
  const seg = (name, opts, cur) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const sw = (name, on) => `<span class="switch"><input type="checkbox" data-sw="${name}" ${on ? 'checked' : ''} aria-label="${name}"><span></span></span>`;
  const o = modal('settings', `
    <h2>Settings</h2><p class="sub">Tune the void to your device and taste.</p>
    <div class="row"><div class="lbl">Theme</div></div>
    <div class="chips" id="themeChips">${THEMES.map((t, i) => `<button class="chip ${i === themeIdx ? 'on' : ''}" data-theme="${i}"><i style="background:${t.hue === null ? 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' : `hsl(${t.hue} 100% 60%)`}"></i>${t.name}</button>`).join('')}</div>
    <div class="row" style="margin-top:12px"><div class="lbl">Mood</div></div>
    <div class="chips" id="moodChips">${MOODS.map((m, i) => `<button class="chip ${i === moodIdx ? 'on' : ''}" data-mood="${i}">${m.name}</button>`).join('')}</div>
    <div class="row" style="margin-top:12px"><div><div class="lbl">Particle density</div><small>Lower it on older phones</small></div>${seg('density', [['low', 'Low'], ['med', 'Med'], ['high', 'High']], settings.density)}</div>
    <div class="row"><div><div class="lbl">Reduced motion</div><small>Calmer drift, no screen shake</small></div>${sw('reduced', settings.reduced)}</div>
    <div class="row"><div><div class="lbl">Audio-reactive pulse</div><small>The Eye throbs to the soundtrack</small></div>${sw('reactive', settings.reactive)}</div>
    <div class="row"><div><div class="lbl">Music volume</div></div><input type="range" min="0" max="1" step="0.05" value="${settings.volume}" id="vol" aria-label="Music volume"></div>
    <div class="row"><div><div class="lbl">Idle animations</div><small>The Eye looks around and gets drowsy</small></div>${sw('idle', settings.idle)}</div>
    <div class="row"><div><div class="lbl">Haptics</div><small>Vibrate on hits (Android)</small></div>${sw('haptics', settings.haptics)}</div>
    <div class="btns"><button class="btn" id="copyLook">Copy link to this look</button><button class="btn ghost" id="resetBest">Reset best score (${game.best})</button></div>`);
  o.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => { setTheme(+b.dataset.theme); o.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('on', x === b)); }));
  o.querySelectorAll('[data-mood]').forEach((b) => b.addEventListener('click', () => { setMood(+b.dataset.mood); o.querySelectorAll('[data-mood]').forEach((x) => x.classList.toggle('on', x === b)); }));
  o.querySelectorAll('[data-seg] button').forEach((b) => b.addEventListener('click', () => {
    const name = b.parentNode.dataset.seg;
    settings[name] = b.dataset.v;
    b.parentNode.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    saveSettings();
    if (name === 'density') initScene();
  }));
  o.querySelectorAll('[data-sw]').forEach((inp) => inp.addEventListener('change', () => {
    settings[inp.dataset.sw] = inp.checked;
    saveSettings();
    if (inp.dataset.sw === 'reduced') initGammaWaves();
  }));
  o.querySelector('#vol').addEventListener('input', (e) => {
    settings.volume = +e.target.value;
    if (musicGain) musicGain.gain.value = settings.volume; else bgMusic.volume = settings.volume;
    saveSettings();
  });
  o.querySelector('#copyLook').addEventListener('click', copyLook);
  o.querySelector('#resetBest').addEventListener('click', (e) => {
    game.best = 0; store.set('best', 0);
    e.target.textContent = 'Best score reset';
    toast('Best score reset');
  });
}
function saveSettings() { store.set('settings', settings); }

function setTheme(i, announce) {
  themeIdx = (i + THEMES.length) % THEMES.length;
  store.set('theme', theme().id);
  $('#themeLbl').textContent = theme().name;
  accentTimer = 0;
  if (announce) toast('Theme: ' + theme().name, 1100);
}
function setMood(i, announce) {
  moodIdx = (i + MOODS.length) % MOODS.length;
  tempMood = null;
  store.set('mood', MOODS[moodIdx].id);
  $('#moodLbl').textContent = MOODS[moodIdx].name;
  blink(true);
  if (MOODS[moodIdx].id === 'startled') startle = 1;
  if (announce) toast('Mood: ' + MOODS[moodIdx].name, 1100);
}

/* ---------- snapshot ---------- */
function snapshot() {
  const name = 'demoneye-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png';
  playTone(1400, 700, 0.12, 'square', 0.06);
  flash = Math.max(flash, 0.3);
  canvas.toBlob((blob) => {
    if (!blob) { toast('Could not capture the canvas'); return; }
    const url = URL.createObjectURL(blob);
    const o = modal('snap', `
      <h2>Snapshot</h2><p class="sub">${theme().name} · ${mood().name}</p>
      <img class="snap-img" src="${url}" alt="DemonEye snapshot">
      <div class="btns"><a class="btn" id="dlSnap" href="${url}" download="${name}">Save PNG</a><button class="btn ghost" id="shareSnap">Share</button></div>`,
      () => setTimeout(() => URL.revokeObjectURL(url), 1000));
    o.querySelector('#dlSnap').style.textDecoration = 'none';
    o.querySelector('#dlSnap').addEventListener('click', () => toast('Saved ' + name));
    o.querySelector('#shareSnap').addEventListener('click', async () => {
      try {
        const file = new File([blob], name, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'DemonEye' });
        else copyLook();
      } catch (e) { if (!e || e.name !== 'AbortError') toast('Sharing is not available here'); }
    });
  }, 'image/png');
}

/* ---------- fullscreen ---------- */
function toggleFullscreen() {
  const d = document, el = d.documentElement;
  const fs = d.fullscreenElement || d.webkitFullscreenElement;
  try {
    if (fs) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => toast('Fullscreen is not available here'));
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else toast('Fullscreen is not available here');
  } catch (e) { toast('Fullscreen is not available here'); }
}

/* ---------- keyboard ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (document.querySelector('.overlay.show')) closeAll(); else if (game.on) pauseGame(true); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('.overlay.show')) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key !== 'm') awaken();
  markInput();
  const step = 26;
  switch (key) {
    case 'm': ensureAudio(); awakened = true; $('#awaken').classList.add('gone'); setSound(!soundPref); break;
    case 't': setTheme(themeIdx + 1, true); break;
    case '1': case '2': case '3': case '4': case '5': setMood(+key - 1, true); break;
    case 'g': if (game.on) pauseGame(true); else openGameIntro(); break;
    case 'p': if (game.on) pauseGame(true); break;
    case 's': snapshot(); break;
    case 'f': toggleFullscreen(); break;
    case 'h': document.body.classList.toggle('ui-hidden'); toast(document.body.classList.contains('ui-hidden') ? 'Interface hidden — press H to bring it back' : 'Interface shown', 1400); break;
    case 'b': blink(true); break;
    case ',': openSettings(); break;
    case '?': openHelp(); break;
    case ' ':
      e.preventDefault();
      if (game.on) gameBlast(); else tap(center.x + pupil.x, center.y + pupil.y);
      break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      e.preventDefault();
      if (Math.abs(mouse.x - center.x) > width || Math.abs(mouse.y - center.y) > height) { mouse.x = center.x; mouse.y = center.y; }
      mouse.x = clamp(mouse.x + (key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0), 0, width);
      mouse.y = clamp(mouse.y + (key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0), 0, height);
      tilt.overrideUntil = performance.now() + 3000;
      break;
    }
    default: return;
  }
});

/* ---------- wire up ---------- */
function bindUI() {
  $('#btnSound').addEventListener('click', () => { ensureAudio(); awakened = true; $('#awaken').classList.add('gone'); setSound(!(soundPref && musicOn)); });
  $('#btnMood').addEventListener('click', () => { awaken(); setMood(moodIdx + 1, true); });
  $('#btnTheme').addEventListener('click', () => { awaken(); setTheme(themeIdx + 1, true); });
  $('#btnGame').addEventListener('click', () => { awaken(); openGameIntro(); });
  $('#btnTilt').addEventListener('click', toggleTilt);
  $('#btnSnap').addEventListener('click', snapshot);
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnHelp').addEventListener('click', openHelp);
  $('#btnApp').addEventListener('click', openInstall);
  $('#btnFull').addEventListener('click', toggleFullscreen);
  $('#ghPause').addEventListener('click', () => pauseGame(true));
  const fsOK = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  if (!fsOK) $('#btnFull').hidden = true;
  if (typeof DeviceOrientationEvent === 'undefined' || !matchMedia('(pointer: coarse)').matches) $('#btnTilt').hidden = true;
  $('#themeLbl').textContent = theme().name;
  $('#moodLbl').textContent = MOODS[moodIdx].name;
  renderSound();
  if (!soundPref) setHint('Sound is muted — press M or tap Sound to listen.');
}

function init() {
  resize();
  initScene();
  bindUI();
  window.addEventListener('resize', resize);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', () => { press = null; charge = 0; });
  window.addEventListener('pointerdown', () => ensureAudio(), { capture: true });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  applyAccent(themeHue(0));
  lastFrame = performance.now();
  rafId = requestAnimationFrame(draw);
  if (/(^|[#&])play\b/.test(location.hash)) setTimeout(openGameIntro, 400);
  window.addEventListener('load', () => {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// test / console hooks
window.DemonEye = {
  get state() { return { theme: theme().id, mood: mood().id, sound: soundPref, musicOn, game: { on: game.on, paused: game.paused, score: game.score, lives: game.lives, comets: game.comets.length, best: game.best }, shockwaves: shockwaves.length, sparks: sparks.length, novas: userNovas.length, settings: Object.assign({}, settings), running, dpr, tilt: tilt.on }; },
  startGame, endGame, gameBlast, setTheme, setMood, snapshot, tap, nova, blink,
  spawnComet, _game: game,
};

init();
})();
