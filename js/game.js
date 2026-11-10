(() => {
'use strict';

// =====================================================================
// 配置
// =====================================================================
const W = 390;                   // 设计稿宽度
let H = 694, SH = 792;           // 摄像头区域高度 / 整个界面高度（随浏览器高度自适应）
let dCam = 0, dBot = 0;          // 底部元素相对设计稿的位移：贴摄像头底边 / 贴屏幕底边
let recLimit = 60;               // 录制上限（秒）：默认 60s，可在拍摄页切换 10m / 60s / 15s
// 声音 → 板子：以校准音高为中心；不对称，低音方向需要变的半音更少
const RANGE = { down: 3.5, up: 11 };   // 往左（低音）只需降 3.5 个半音就到最左
const MIN_GATE = 0.0003, YIN_THRESHOLD = 0.3, YIN_FALLBACK = 0.5;
const LANES = 7, SNAP = 0.25, OE_MIN_CUTOFF = 2.0, OE_BETA = 8;
const PADDLE_FOLLOW = 16, PADDLE_MAX_SPEED = 2.2, PADDLE_SPEED_SCALE = 0.7, SILENCE_HOLD_MS = 180;
const SPEED_BASE = 1.2, SPEED_PER_POINT = 0.07, SPEED_MAX = 3.2;   // 开局就比原来快 20%

// 设计稿尺寸
let LINE_Y = 469, PAD_Y = 452;
const LINE_X0 = 21, LINE_X1 = 371;
const PAD_W = 100, PAD_H = 36;   // 板子比设计稿的 120 窄一点，提高难度
const BOX = { x: 68, y: 276, w: 253, h: 143, r: 16 };
const RING = { x: 195, y: 380, r: 23, w: 4.5 };
const SIDE = 19;                 // 左右安全边距
const FACE = 66;                 // 表情显示尺寸
const R = 28;                    // 碰撞半径

// =====================================================================
// DOM
// =====================================================================
const $ = s => document.querySelector(s);
const stage = $('#stage'), cam = $('#cam'), playback = $('#playback'), retryBtn = $('#retryBtn');
retryBtn.addEventListener('click', e => { e.stopPropagation(); if (performance.now() - screenAt >= 400) actions.retry(); });
const cv = $('#game'), ctx = cv.getContext('2d');
const timerEl = $('#timer'), arcEl = $('#arc'), recUI = $('#recUI'), errEl = $('#err');

// 每个设计稿切图分成上下两块：上半块贴顶，下半块跟着底边走
// anchor: cam = 贴摄像头画面底边；bottom = 贴屏幕底边（下面有黑色按钮区的页面）
const OV = {
  panel:  { top: 300, bot: 300, anchor: 'bottom' },
  camera: { top: 400, bot: 792, anchor: 'cam' },   // 下半部分（特效轮盘）改由代码画，可以左右滑
  rec:    { top: 274, bot: 556, anchor: 'cam' },
  paused: { top: 274, bot: 556, anchor: 'cam' },
  feed:   { top: 300, bot: 300, anchor: 'bottom' },
};
const SCREEN_ANCHOR = { panel: 'bottom', camera: 'cam', rec: 'cam', paused: 'cam', feed: 'bottom', edit: 'bottom' };
for (const id in OV) {
  const top = $('#ov-' + id), bot = top.cloneNode();
  bot.id = 'ov-' + id + '-b';
  top.after(bot);
  top.style.clipPath = `inset(0 0 ${792 - OV[id].top}px 0)`;
  bot.style.clipPath = `inset(${OV[id].bot}px 0 0 0)`;
}
const hps = [...document.querySelectorAll('.hp')];
hps.forEach(b => { b.dataset.top = parseFloat(b.style.top); });

let S = 1, DPR = 1;
function placeVideo(el, h, r) {
  const left = (window.innerWidth - 390 * S) / 2;
  el.style.left = left + 'px'; el.style.top = '0px';
  el.style.width = 390 * S + 'px'; el.style.height = h * S + 'px';
  el.style.borderRadius = r * S + 'px';
}
function layout() {
  const vw = window.innerWidth, vh = window.innerHeight;
  S = vw / 390; SH = vh / S;
  if (SH < 640) { S = vh / 640; SH = 640; }        // 电脑横屏等特别矮的窗口：居中显示
  stage.style.transform = `scale(${S})`;
  stage.style.left = ((vw - 390 * S) / 2) + 'px';
  stage.style.height = SH + 'px';
  H = SH;                                          // 摄像头画面铺满整个可用高度
  dCam = H - 694; dBot = SH - 792;
  placeVideo(cam, H, 20);
  $('#carousel').style.marginTop = dCam + 'px';
  for (const id in OV) $('#ov-' + id + '-b').style.transform = `translateY(${OV[id].anchor === 'cam' ? dCam : dBot}px)`;
  recUI.style.transform = `translateY(${dCam}px)`;
  $('#tabs').style.marginTop = dCam + 'px';
  const eu = $('#editUI');
  eu.style.height = SH + 'px'; eu.setAttribute('viewBox', `0 0 390 ${SH}`);
  $('#editBottom').setAttribute('transform', `translate(0 ${dBot})`);
  $('#storyBtn').style.top = $('#nextBtn').style.top = (712 + dBot) + 'px';
  hps.forEach(b => {
    const base = +b.dataset.top;
    const d = SCREEN_ANCHOR[b.dataset.s] === 'cam' ? dCam : dBot;
    b.style.top = (base >= 300 ? base + d : base) + 'px';
  });
  // 游戏层：轨道、板子、提示框跟着摄像头底边走
  LINE_Y = 469 + dCam; PAD_Y = 452 + dCam; BOX.y = 276 + dCam; RING.y = 380 + dCam;
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  cv.style.height = H + 'px';
  cv.width = Math.round(W * S * DPR); cv.height = Math.round(H * S * DPR);
  if (typeof screen === 'string') setPlaybackSize();
}

let mode = 'voice';               // voice（声控弹球）| sing（唱 Happy Birthday）
const faces = [1, 2, 3].map(i => { const im = new Image(); im.src = `assets/game/face${i}.svg?v=3`; return im; });
let faceIdx = 0;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
// 中心音高：有保存过就直接用；没有的话，你发出的第一声先当中心。之后按“一个一个音”快速校准：
// 记住最近 16 个唱稳的音，让其中偏低的那几个（15% 分位）落在最左边附近。几个音之内就能纠正过来。
// （v3：换了存储 key，丢掉以前按帧慢慢学、可能被拖偏的旧中心）
let centerLog = parseFloat(store.get('vb_center3', ''));
let baseReady = isFinite(centerLog);
if (!baseReady) centerLog = Math.log2(200);
const firstSamples = [], stableWin = [], curNote = [], noteBuf = [];
const median = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
function adaptCenter(lf) {
  if (!baseReady) {
    firstSamples.push(lf);
    if (firstSamples.length >= 12) {
      centerLog = median(firstSamples); baseReady = true;
      store.set('vb_center3', String(centerLog));
    }
  }
  // 只收“唱稳了”的帧：起音、滑音、收尾往下掉的那一截都不算
  stableWin.push(lf); if (stableWin.length > 6) stableWin.shift();
  if (stableWin.length < 6 || (Math.max(...stableWin) - Math.min(...stableWin)) * 12 > 0.6) return;
  curNote.push(lf);
  // 正在唱的这个音就是你最低的那几个之一，板子却没到左边 → 当场把中心往上挪，板子跟着滑到左边
  if (baseReady && noteBuf.length >= 2 && curNote.length >= 8) {
    const b = noteBuf.slice().sort((x, y) => x - y);
    const lo = b[Math.floor(b.length * 0.15)], hi = b[b.length - 1];
    const cur = median(curNote.slice(-8));
    const target = cur + (RANGE.down - 0.35) / 12;
    if ((hi - lo) * 12 >= 2.5 && cur <= lo + 0.5 / 12 && target > centerLog) centerLog += (target - centerLog) * 0.15;
  }
}
// 一个音唱完（静音）时调用：这个音的稳定音高记一票，然后校准中心
function endNote() {
  const n = curNote.length;
  if (n >= 8) {
    noteBuf.push(median(curNote));
    if (noteBuf.length > 16) noteBuf.shift();
    if (baseReady && noteBuf.length >= 2) {
      const b = noteBuf.slice().sort((x, y) => x - y);
      const lo = b[Math.floor(b.length * 0.15)], hi = b[b.length - 1];
      if ((hi - lo) * 12 >= 2.5) {                       // 有高有低才调整
        const target = lo + (RANGE.down - 0.35) / 12;     // 偏低的音 → 最左边附近
        centerLog += (target - centerLog) * 0.5;         // 每个音纠正一半，几个音就到位
        store.set('vb_center3', String(centerLog));
      }
    }
  }
  curNote.length = 0;
}

// =====================================================================
// 音高检测（YIN + 中值 + 八度纠错 + One Euro）
// =====================================================================
let audioCtx = null, analyser = null, tdBuf = null, yinBuf = null;
let micOK = false, micTrack = null, micSrc = null, micAEC = false, recDest = null;
let pitchHz = -1, lastVoiceT = 0, noiseFloor = 0.004;
let smoothLog = null, jumpFrames = 0, octFrames = 0, lastPitchT = performance.now();
let paddleT = null;
const pitchHist = [];

function yin(buf, sr) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  if (rms < noiseFloor) noiseFloor = rms;
  const unvoiced = () => { noiseFloor = Math.min(0.012, noiseFloor + (rms - noiseFloor) * 0.002); return -1; };
  if (rms < Math.max(MIN_GATE, noiseFloor * 1.8)) return unvoiced();
  const minTau = Math.max(2, Math.floor(sr / 1200));
  const maxTau = Math.min(Math.floor(sr / 75), buf.length >> 1);
  const n = Math.min(buf.length - maxTau, Math.max(maxTau, Math.round(sr * 0.012)));
  const o = buf.length - n - maxTau;
  const d = yinBuf;
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let j = o; j < o + n; j++) { const x = buf[j] - buf[j + tau]; s += x * x; }
    running += s;
    d[tau] = running > 0 ? s * tau / running : 1;
  }
  let tau = -1, minV = Infinity;
  for (let t = minTau; t < maxTau; t++) if (d[t] < minV) minV = d[t];
  const th = minV < YIN_THRESHOLD ? YIN_THRESHOLD : (minV < YIN_FALLBACK ? minV + 0.08 : -1);
  if (th < 0) return unvoiced();
  for (let t = minTau; t < maxTau; t++) {
    if (d[t] < th) { while (t + 1 < maxTau && d[t + 1] < d[t]) t++; tau = t; break; }
  }
  if (tau < 1) return unvoiced();
  const x0 = d[tau - 1], x1 = d[tau], x2 = d[tau + 1];
  const den = x0 + x2 - 2 * x1;
  return sr / (den !== 0 ? tau + (x0 - x2) / (2 * den) : tau);
}

function resetPitch() {
  pitchHz = -1; smoothLog = null; paddleT = null;
  pitchHist.length = 0; oe.x = null; jumpFrames = 0; octFrames = 0; stableWin.length = 0;
}

function updatePitch(now) {
  if (!micOK) return;
  analyser.getFloatTimeDomainData(tdBuf);
  const f = yin(tdBuf, audioCtx.sampleRate);
  const dt = Math.max(0.005, Math.min(0.05, (now - lastPitchT) / 1000));
  lastPitchT = now;
  if (f > 0 && f < 1500) {
    // 唱歌模式：这个音高正好是伴奏此刻在响的音，多半是外放漏进麦克风，跳过
    if (mode === 'sing' && song && accMasked(f)) { lastVoiceT = now; return; }   // 板子保持不动
    lastVoiceT = now;
    let raw = Math.log2(f);
    if (mode === 'voice' && baseReady) {
      while (raw - centerLog > (RANGE.up + 3) / 12) raw -= 1;
      while (centerLog - raw > (RANGE.down + 12) / 12) raw += 1;   // 低到离谱才当作八度误判
    } else if (singReady()) {
      const c = (singLo + singHi) / 2, h = (singHi - singLo) / 2 + 5 / 12;
      while (raw - c > h) raw -= 1;
      while (c - raw > h) raw += 1;
    }
    if (smoothLog !== null) {
      const dd = raw - smoothLog;
      const inRange = mode === 'voice' && baseReady &&
        (raw - centerLog) * 12 <= RANGE.up + 2 && (centerLog - raw) * 12 <= RANGE.down + 6;
      if (!inRange && Math.abs(Math.abs(dd) - 1) < 0.12) { if (++octFrames < 10) raw -= Math.sign(dd); }
      else octFrames = 0;
      if (Math.abs(raw - smoothLog) > 0.5) { if (++jumpFrames < 2) return; }
      else jumpFrames = 0;
    }
    pitchHist.push(raw);
    if (pitchHist.length > 5) pitchHist.shift();
    if (smoothLog === null && pitchHist.length < 3) return;
    const sorted = pitchHist.slice().sort((a, b) => a - b);
    const lf = sorted[sorted.length >> 1];
    if (mode === 'voice') adaptCenter(lf);
    if (mode === 'sing' && song && song.gbNow >= -0.5) singSamples.push(lf);
    smoothLog = oneEuro(lf, dt);
    pitchHz = Math.pow(2, smoothLog);
    const u = pitchToT(pitchHz);
    if (mode === 'voice') paddleT = baseReady ? softSnap(u * (LANES - 1)) / (LANES - 1) : null;
    else paddleT = singReady() ? u : null;             // 唱歌校准期间板子不动
  } else if (now - lastVoiceT > (mode === 'sing' ? SING_HOLD_MS : SILENCE_HOLD_MS)) {
    if (mode === 'sing') { const keep = paddleT; resetPitch(); paddleT = keep; }   // 唱歌：字间停顿时板子停在原地
    else { if (smoothLog !== null) endNote(); resetPitch(); }
  }
}

const oe = { x: null, dx: 0 };
const oeAlpha = (cut, dt) => 1 / (1 + 1 / (2 * Math.PI * cut * dt));
function oneEuro(x, dt) {
  if (oe.x === null) { oe.x = x; oe.dx = 0; return x; }
  oe.dx += oeAlpha(1.0, dt) * ((x - oe.x) / dt - oe.dx);
  const cut = Math.min(8, OE_MIN_CUTOFF + OE_BETA * Math.abs(oe.dx));
  oe.x += oeAlpha(cut, dt) * (x - oe.x);
  return oe.x;
}
function softSnap(u) {
  const n = Math.round(u), d = u - n;
  const curved = Math.sign(d) * 0.5 * Math.pow(2 * Math.abs(d), 1.8);
  return n + (1 - SNAP) * d + SNAP * curved;
}
function pitchToT(f) {
  if (mode === 'sing') return Math.max(0, Math.min(1, (Math.log2(f) - singLo) / (singHi - singLo)));
  const semis = (Math.log2(f) - centerLog) * 12;
  const t = 0.5 + (semis >= 0 ? semis / RANGE.up : semis / RANGE.down) / 2;
  return Math.max(0, Math.min(1, t));
}

// =====================================================================
// 摄像头 / 麦克风
// =====================================================================
async function initMedia() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Camera and microphone are not available. Open this page over HTTPS in Safari or Chrome.');
  }
  const audioC = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const videoC = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
  let audioStream = null, videoStream = null;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: audioC, video: videoC });
    audioStream = videoStream = s;
  } catch {
    try { audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioC }); } catch {}
    try { videoStream = await navigator.mediaDevices.getUserMedia({ video: videoC }); } catch {}
  }
  if (videoStream && videoStream.getVideoTracks().length) {
    cam.srcObject = new MediaStream(videoStream.getVideoTracks());
    try { await cam.play(); } catch {}
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AC();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  tdBuf = new Float32Array(analyser.fftSize);
  yinBuf = new Float32Array(analyser.fftSize);
  try { recDest = audioCtx.createMediaStreamDestination(); } catch {}
  loadSfx();
  if (audioStream && audioStream.getAudioTracks().length) {
    const at = audioStream.getAudioTracks()[0];
    try { await at.applyConstraints(audioC); } catch {}
    connectMic(at, false);
  }
  if (!micOK) throw new Error('Microphone is off, so your voice can\'t move the paddle. Allow microphone access in settings and reload. For now you can drag the paddle with your finger.');
  if (!videoStream) throw new Error('Camera is off. Allow camera access in settings and reload to see yourself in the video. The game still works.');
}

function connectMic(track, aec) {
  if (micSrc) { try { micSrc.disconnect(); } catch {} }
  if (micTrack && micTrack !== track) { try { micTrack.stop(); } catch {} }
  micTrack = track; micAEC = aec;
  micSrc = audioCtx.createMediaStreamSource(new MediaStream([track]));
  micSrc.connect(analyser);
  if (recDest) micSrc.connect(recDest);
  noiseFloor = 0.004;
  resetPitch();
  micOK = true;
}
// 唱歌模式要开回声消除（把手机自己放的伴奏从麦克风里减掉），声控模式关掉
async function setupMic(aec, force) {
  if (!audioCtx) return;
  const dead = !micTrack || micTrack.readyState === 'ended';
  if (!force && !dead && micAEC === aec) return;
  const c = { echoCancellation: aec, noiseSuppression: false, autoGainControl: false };
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: c });
    connectMic(st.getAudioTracks()[0], aec);
  } catch {
    try { await micTrack.applyConstraints(c); micAEC = aec; } catch {}
  }
}

// =====================================================================
// 录制（摄像头画面 + 游戏画面 + 麦克风）
// =====================================================================
const recCv = document.createElement('canvas');
recCv.width = 540; recCv.height = 960;
const recCtx = recCv.getContext('2d');
let recorder = null, chunks = [], recElapsed = 0, videoURL = null;

function drawRecFrame() {
  const vw = cam.videoWidth, vh = cam.videoHeight;
  recCtx.fillStyle = '#000';
  recCtx.fillRect(0, 0, recCv.width, recCv.height);
  if (vw && vh) {
    const sc = Math.max(recCv.width / vw, recCv.height / vh);
    const dw = vw * sc, dh = vh * sc;
    recCtx.save();
    recCtx.translate(recCv.width, 0); recCtx.scale(-1, 1);
    recCtx.drawImage(cam, (recCv.width - dw) / 2, (recCv.height - dh) / 2, dw, dh);
    recCtx.restore();
  }
  recCtx.drawImage(cv, 0, 0, recCv.width, recCv.height);
}

function startRecorder() {
  chunks = [];
  recorder = null;
  try {
    if (!window.MediaRecorder || !recCv.captureStream) return;
    recCv.height = 2 * Math.round(270 * H / 390);    // 和屏幕上摄像头画面同比例
    drawRecFrame();
    const tracks = recCv.captureStream(30).getVideoTracks();
    const at = recDest && recDest.stream.getAudioTracks()[0];
    if (at) tracks.push(at); else if (micTrack) tracks.push(micTrack);
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = types.find(t => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType, videoBitsPerSecond: 4e6 } : undefined);
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.start(250);
  } catch (e) { console.warn(e); recorder = null; }
}
function pauseRecorder() { try { if (recorder && recorder.state === 'recording') recorder.pause(); } catch {} }
function resumeRecorder() { try { if (recorder && recorder.state === 'paused') recorder.resume(); } catch {} }
function stopRecorder(keep) {
  return new Promise(resolve => {
    const r = recorder;
    recorder = null;
    if (!r || r.state === 'inactive') { resolve(null); return; }
    r.onstop = () => resolve(keep && chunks.length ? new Blob(chunks, { type: r.mimeType || 'video/mp4' }) : null);
    try { r.stop(); } catch { resolve(null); }
  });
}

// =====================================================================
// 界面流程：panel（特效面板）→ camera（拍摄页）→ rec（录制中）⇄ paused → feed（成片）
// =====================================================================
let screen = 'panel';
let screenAt = 0;                 // 换页时间：换页后 400ms 内的点击当作“同一下点击的残影”忽略
function setScreen(s) {
  screen = s; screenAt = performance.now();
  for (const id in OV) $('#ov-' + id).style.display = $('#ov-' + id + '-b').style.display = id === s ? 'block' : 'none';
  tabs.style.display = s === 'camera' ? 'block' : 'none';
  $('#carousel').style.display = s === 'camera' ? 'block' : 'none';
  const edit = s === 'edit';
  $('#editUI').style.display = edit ? 'block' : 'none';
  $('#storyBtn').style.display = $('#nextBtn').style.display = edit ? 'block' : 'none';
  document.querySelectorAll('.hp').forEach(b => { b.style.display = b.dataset.s === s ? 'block' : 'none'; });
  recUI.style.display = (s === 'rec' || s === 'paused') ? 'block' : 'none';
  if (s !== 'rec' && s !== 'paused') retryBtn.style.display = 'none';
  cv.style.display = (s === 'rec' || s === 'paused') ? 'block' : 'none';
  const feed = s === 'feed' || edit;
  // iOS Safari：摄像头 video 一旦 display:none 再显示会变小，所以摄像头始终显示，回放盖在上面
  playback.style.visibility = feed ? 'visible' : 'hidden';
  if (!feed && cam.srcObject && cam.paused) cam.play().catch(() => {});
  setPlaybackSize();
  if (!feed) { try { playback.pause(); } catch {} }
  updateRecUI();
}

function setPlaybackSize() {
  const edit = screen === 'edit';
  placeVideo(playback, edit ? H : 709 + dBot, edit ? 20 : 22);   // 编辑页：和拍摄时的摄像头画面一样大，录的比例正好吻合，不裁切
}

function updateRecUI() {
  const sec = Math.min(recLimit, Math.floor(recElapsed));
  timerEl.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  const big = screen === 'rec';
  const r = big ? 54.4 : 45, w = big ? 7.25 : 6;
  const p = Math.min(1, recElapsed / recLimit);
  arcEl.setAttribute('stroke-width', w);
  if (p <= 0.001) { arcEl.setAttribute('d', ''); return; }
  const a = -Math.PI / 2 + p * Math.PI * 2 * 0.9999;
  const x = 195 + r * Math.cos(a), y = 625 + r * Math.sin(a);
  arcEl.setAttribute('d', `M195 ${625 - r} A${r} ${r} 0 ${p > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`);
}

const actions = {
  toCamera() { discardTake(); setScreen('camera'); },
  toPanel() { discardTake(); setScreen('panel'); },
  record() { unlockAudio(); mediaReady.then(() => startTake()); },
  stop() { endRound(true); },
  retry() { unlockAudio(); if (screen === 'rec') newRound(); else mediaReady.then(() => startTake()); },   // 录制中直接重开一局，不打断录制
  finish() { finishTake(); },
  discard() { discardTake(); setScreen('camera'); },
  togglePlay() { if (playback.paused) playback.play().catch(() => {}); else playback.pause(); },
};
// 手机上一次点按会先触发 pointerup 再补发 click：点中间圆开始录制后，补发的 click 会落在刚出现的“停止”键上，录制立刻停掉。
// 所以换页后 400ms 内的点击一律忽略
const ghost = () => performance.now() - screenAt < 400;
document.querySelectorAll('.hp').forEach(b => b.addEventListener('click', e => {
  e.stopPropagation();
  if (ghost()) return;
  const f = actions[b.dataset.a];
  if (f) f();
}));

// ---- 音效：接住 = pop，掉海里 = splash（也录进视频） ----
const SFX = {};
function loadSfx() {
  ['pop', 'splash'].forEach(n => {
    fetch('assets/sfx/' + n + '.mp3').then(r => r.arrayBuffer())
      .then(ab => new Promise((ok, no) => audioCtx.decodeAudioData(ab, ok, no)))
      .then(b => { SFX[n] = b; }).catch(() => {});
  });
}
function playSfx(n, vol, rate) {
  const b = SFX[n];
  if (!b || !audioCtx || audioCtx.state !== 'running') return;
  const src = audioCtx.createBufferSource(), g = audioCtx.createGain();
  src.buffer = b; src.playbackRate.value = rate || 1; g.gain.value = vol;
  src.connect(g); g.connect(audioCtx.destination);
  if (recDest) g.connect(recDest);
  src.start();
}

function unlockAudio() {
  if (audioCtx && audioCtx.state !== 'running') { try { audioCtx.resume(); } catch {} }
}

let starting = false;
async function startTake() {
  if (screen !== 'camera' && screen !== 'panel' && screen !== 'paused') return;
  if (starting) return;
  starting = true;
  try { await setupMic(mode === 'sing'); } finally { starting = false; }
  if (audioCtx && audioCtx.state !== 'running') { try { await audioCtx.resume(); } catch {} }
  if (screen === 'paused') {
    if (recElapsed >= recLimit) return;
    resumeRecorder();
    setScreen('rec');
    newRound();
    return;
  }
  recElapsed = 0;
  setScreen('rec');
  newRound();
  startRecorder();
}

async function finishTake() {
  stopSong();
  if (['play', 'countdown', 'sink', 'sing'].includes(state)) state = 'over';
  const blob = await stopRecorder(true);
  if (videoURL) { URL.revokeObjectURL(videoURL); videoURL = null; }
  if (blob) {
    videoURL = URL.createObjectURL(blob);
    playback.srcObject = null;
    playback.src = videoURL;
    playback.style.transform = '';
    playback.muted = false;
  } else {
    playback.removeAttribute('src');
    playback.srcObject = cam.srcObject;
    playback.style.transform = 'scaleX(-1)';
    playback.muted = true;
  }
  setScreen('edit');
  playback.currentTime = 0;
  playPlayback();
}
// iOS：停止录制要等编码收尾，等完已经不算“用户点击”了，有声自动播放会被拦。被拦就先静音播，点一下屏幕再开声音
let needUnmute = false;
function playPlayback() {
  const p = playback.play();
  if (p && p.catch) p.catch(() => {
    if (!videoURL) return;
    playback.muted = true; needUnmute = true;
    playback.play().catch(() => {});
  });
}
document.addEventListener('pointerdown', () => {
  if (needUnmute && (screen === 'edit' || screen === 'feed')) { needUnmute = false; playback.muted = false; playback.play().catch(() => {}); }
}, true);
const publish = () => { setScreen('feed'); playback.currentTime = 0; playPlayback(); };
$('#nextBtn').addEventListener('click', publish);
$('#storyBtn').addEventListener('click', publish);

// 时长选择：选中的那一项滑到正中间
const tabs = $('#tabs');
function selectTab(el) {
  tabs.querySelectorAll('span').forEach(t => t.classList.toggle('on', t === el));
  recLimit = +el.dataset.d;
  tabs.style.transform = `translateX(${195 - (el.offsetLeft + el.offsetWidth / 2)}px)`;
}
tabs.querySelectorAll('span[data-d]').forEach(t => t.addEventListener('click', e => { e.stopPropagation(); selectTab(t); }));

// 特效轮盘：左右滑动 / 点旁边的圆切换；中间那个就是拍摄键
// 从左到右：AI、粉色图标（唱歌模式）、黑色图标（声控模式，默认选中）、猫
const CAROUSEL = [
  { img: 'fx_ai.png' }, { img: 'fx_sing.png', mode: 'sing', name: 'Sing Along' },
  { img: 'fx_voice.png', mode: 'voice', name: 'Voice Bounce' }, { img: 'fx_cat.png' },
];
const carEl = $('#carousel');
let carSel = 2;
const carItems = CAROUSEL.map(c => {
  const d = document.createElement('div'); d.className = 'ci';
  const im = document.createElement('img'); im.src = `assets/effects/${c.img}?v=2`; im.alt = '';
  d.appendChild(im); carEl.insertBefore(d, $('#ring')); return d;
});
// 左右对称：中间圆两边的间距一样（相邻 105，再往外 201）
const CAR_X = { '-3': -102, '-2': -6, '-1': 90, '0': 195, '1': 300, '2': 396, '3': 492 };
const CY = 67;                                     // 轮盘里圆心的纵坐标（= 设计稿 627）
function renderCarousel() {
  carItems.forEach((d, i) => {
    const r = Math.max(-3, Math.min(3, i - carSel)), sz = r === 0 ? 74 : 56;
    d.style.left = (CAR_X[r] - sz / 2) + 'px'; d.style.top = (CY - sz / 2) + 'px';
    d.style.width = d.style.height = sz + 'px';
  });
  $('#ring').style.top = (CY - 41.5) + 'px';
}
let nameTimer = 0;
function selectFx(i) {
  i = Math.max(1, Math.min(2, i));                   // 目前只有雕像（唱歌）和 AI（声控）两个能用
  if (i === carSel) return;
  carSel = i; mode = CAROUSEL[i].mode;
  renderCarousel();
  const n = $('#fxName'); n.textContent = CAROUSEL[i].name; n.style.opacity = 1;
  clearTimeout(nameTimer); nameTimer = setTimeout(() => { n.style.opacity = 0; }, 1300);
}
let carDown = null;
carEl.addEventListener('pointerdown', e => { carDown = { x: e.clientX, y: e.clientY }; });
carEl.addEventListener('pointerup', e => {
  if (!carDown) return;
  const dx = (e.clientX - carDown.x) / S;
  carDown = null;
  if (Math.abs(dx) > 25) { selectFx(carSel + (dx > 0 ? -1 : 1)); return; }   // 手指往右滑 → 左边那个转到中间
  const x = (e.clientX - stage.getBoundingClientRect().left) / S;
  if (Math.abs(x - 195) < 45) actions.record();
  else selectFx(carSel + (x < 195 ? -1 : 1));
});
carEl.addEventListener('pointercancel', () => { carDown = null; });

function discardTake() {
  stopSong();
  stopRecorder(false);
  recElapsed = 0;
  state = 'idle';
}

// =====================================================================
// 游戏
// =====================================================================
let state = 'idle';              // idle | countdown | play | sink（掉水里）| result（结算）| over
let score = 0, paddleX = W / 2, paddleW = PAD_W;
let bx = W / 2, by = 190, vx = 0, vy = 0, squash = 0;
let countdownEnd = 0, sinkAt = 0, resultAt = 0, newBest = false;
let best = parseInt(store.get('vb_best', '0'), 10) || 0;
let pointerX = null;

const gravity = () => 694 * 0.85;
const speedMul = () => Math.min(SPEED_MAX, SPEED_BASE + score * SPEED_PER_POINT);
const restY = () => 190 + Math.sin(performance.now() / 300) * 8;

function newRound() {
  score = 0; paddleW = PAD_W; faceIdx = 0; squash = 0; clearFx(); clearWater();
  bx = W / 2; by = restY(); vx = 0; vy = 0;
  resetPitch();
  if (mode === 'sing') { newSingRound(); return; }
  stopSong();
  state = 'countdown'; countdownEnd = performance.now() + 3000;   // 不再有测基准音环节
}

function launch() {
  state = 'play';
  // 第一球：总是往右边一点落（稍微抬高声音就能接到），而且下落慢一些；往左要压低声音，开局太难
  vy = 0;
  const tx = W / 2 + 65 + Math.random() * 35;
  const t = Math.sqrt(2 * Math.max(40, PAD_Y - R - by) / gravity());
  vx = (tx - bx) / t;
}

// 手动停止录制（或到时长 / 切后台）：录制暂停，回到可继续拍 / 完成的状态
function endRound() {
  if (screen !== 'rec') return;
  if (['play', 'countdown', 'sink', 'sing'].includes(state)) showResult(performance.now());
  stopSong();
  pauseRecorder();
  setScreen('paused');
  if (recElapsed >= recLimit) finishTake();
}

// =====================================================================
// 唱歌模式（Sing Along）：示例曲 Happy Birthday（有和声的伴奏 + 前两句引导人声，之后逐渐淡出）
// =====================================================================
const SING_BPM = 100, SING_HOLD_MS = 600, SING_PADDLE_MUL = 1.4;
const HIT_GRACE = 0.3;             // 落拍后还允许板子赶到的时间（抵消麦克风识别延迟）
const HIT_TOL = 0.8;               // 判定宽度：板子半宽 + 表情半径 × 这个系数
// 只在 "you" 上落到板子：第一句、第二句、第四句的 you（第三句结尾是 friend，不落）
const HIT_BEATS = [4, 10, 22];
const HOP_H = 42, RISE_H = 70, DROP_H = 22;   // 空中小跳 / 接住后弹起 / 落向板子前的小抛起 的高度
const SING_MIN_SPAN = 7;           // 音域至少按这么多半音铺满
const VERSE_BEATS = 24, SING_HITS = 3, SONG_END_BEAT = 25;
// Happy Birthday（公有领域），F 大调 3/4 拍；[音节, 起始拍, 连接符]
const SYL = [
  ['Hap', 0, '-'], ['py', 0.75, ' '], ['birth', 1, '-'], ['day', 2, ' '], ['to', 3, ' '], ['you', 4, ''],
  ['Hap', 6, '-'], ['py', 6.75, ' '], ['birth', 7, '-'], ['day', 8, ' '], ['to', 9, ' '], ['you', 10, ''],
  ['Hap', 12, '-'], ['py', 12.75, ' '], ['birth', 13, '-'], ['day', 14, ' '], ['dear', 15, ' '], ['friend', 16, ''],
  ['Hap', 18, '-'], ['py', 18.75, ' '], ['birth', 19, '-'], ['day', 20, ' '], ['to', 21, ' '], ['you', 22, ''],
];
// 旋律 [midi, 起始拍, 时值]
const MEL = [
  [60, 0, .75], [60, .75, .25], [62, 1, 1], [60, 2, 1], [65, 3, 1], [64, 4, 2],
  [60, 6, .75], [60, 6.75, .25], [62, 7, 1], [60, 8, 1], [67, 9, 1], [65, 10, 2],
  [60, 12, .75], [60, 12.75, .25], [72, 13, 1], [69, 14, 1], [65, 15, 1], [64, 16, 1], [62, 17, 1],
  [70, 18, .75], [70, 18.75, .25], [69, 19, 1], [65, 20, 1], [67, 21, 1], [65, 22, 2],
];
const guideGain = beat => beat < 12 ? 1 : Math.max(0, 1 - (beat - 12) / 9);   // 前两句完整，第三句开始淡出
const BARS = ['F', 'C7', 'C7', 'F', 'F7', 'Bb', ['F', 'C7', 'C7'], 'F'];
const CHORDS = {
  F:  { bass: 41, keys: [65, 69, 72], pad: [77, 81, 84] },
  C7: { bass: 36, keys: [64, 67, 70], pad: [76, 79, 82] },
  F7: { bass: 41, keys: [63, 65, 69], pad: [75, 77, 81] },
  Bb: { bass: 46, keys: [62, 65, 70], pad: [74, 77, 82] },
};
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = lg => { const m = Math.round(69 + 12 * (lg - Math.log2(440))); return NOTE_NAMES[(m % 12 + 12) % 12] + (Math.floor(m / 12) - 1); };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

let singLo = parseFloat(store.get('vb_sing_lo', '')), singHi = parseFloat(store.get('vb_sing_hi', ''));
let hasSingCalib = isFinite(singLo) && isFinite(singHi);
let song = null, noiseBuf = null;
const accNotes = [];
let hitK = 0, targets = [], results = [], singSamples = [], lastRangeT = 0;
const singReady = () => mode === 'sing' && !!song;
const audioNow = () => audioCtx.currentTime - (audioCtx.outputLatency || audioCtx.baseLatency || 0);

// 伴奏/引导人声此刻正在响的音：麦克风听到同样的音高就当作外放漏音
function accMasked(f) {
  const t = audioCtx.currentTime;
  for (let i = accNotes.length - 1; i >= 0; i--) {
    const n = accNotes[i];
    if (n.t1 < t - 1) { accNotes.splice(i, 1); continue; }
    if (t >= n.t0 - 0.02 && t <= n.t1 + 0.1 && Math.abs(12 * Math.log2(f / n.f)) < 0.45) return true;
  }
  return false;
}
function getNoise() {
  if (!noiseBuf) {
    const n = Math.floor(audioCtx.sampleRate * 0.5);
    noiseBuf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function env(g, t, a, peak, rel, end) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(0.0001, end, rel);
}
// 电钢琴：正弦 + 二倍频 + 三角波，自然衰减
function synthKeys(midi, t, dur, vol) {
  const f = mtof(midi), g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.18);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  [[1, 'sine', 1], [2, 'sine', 0.25], [1, 'triangle', 0.35]].forEach(([m, type, a]) => {
    const o = audioCtx.createOscillator(), og = audioCtx.createGain();
    o.type = type; o.frequency.value = f * m; og.gain.value = a;
    o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 0.05);
  });
  g.connect(song.out);
  accNotes.push({ f, t0: t, t1: t + Math.min(dur, 0.25) });
}
// 温暖的长音铺底（高音区，不和人声抢）
function synthPad(midis, t, dur, vol) {
  const g = audioCtx.createGain(), lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2000; lp.Q.value = 0.5;
  env(g, t, 0.25, vol, 0.25, t + dur - 0.1);
  midis.forEach((m, i) => [-6, 6].forEach(det => {
    const o = audioCtx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det + i;
    o.connect(lp); o.start(t); o.stop(t + dur + 1.2);
  }));
  lp.connect(g); g.connect(song.out);
}
function synthBass(midi, t, dur, vol) {
  const f = mtof(midi), g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  [['triangle', 1], ['sine', 0.8]].forEach(([type, a]) => {
    const o = audioCtx.createOscillator(), og = audioCtx.createGain();
    o.type = type; o.frequency.value = f; og.gain.value = a;
    o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 0.05);
  });
  g.connect(song.out);
  accNotes.push({ f, t0: t, t1: t + Math.min(dur, 0.4) });
}
// 引导人声："啊——"，锯齿波 + 共振峰 + 颤音（比原调高八度，免得和你的声音混淆）
function synthVoice(midi, t, dur, vol) {
  if (vol < 0.003) return;
  const f = mtof(midi + 12), g = audioCtx.createGain(), mix = audioCtx.createGain();
  const end = t + Math.max(0.12, dur - 0.05);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
  g.gain.setValueAtTime(vol, end - 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, end + 0.08);
  const lfo = audioCtx.createOscillator(), lg = audioCtx.createGain();
  lfo.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + 0.25);
  lfo.connect(lg);
  [0, 7].forEach(det => {
    const o = audioCtx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
    lg.connect(o.frequency); o.connect(mix); o.start(t); o.stop(end + 0.15);
  });
  lfo.start(t); lfo.stop(end + 0.15);
  [[800, 5, 1], [1150, 7, 0.55], [2900, 9, 0.18]].forEach(([fr, q, a]) => {   // "啊" 的共振峰
    const bp = audioCtx.createBiquadFilter(), bg = audioCtx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q; bg.gain.value = a;
    mix.connect(bp); bp.connect(bg); bg.connect(g);
  });
  const lp = audioCtx.createBiquadFilter(), lpg = audioCtx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = 1100; lpg.gain.value = 0.35;
  mix.connect(lp); lp.connect(lpg); lpg.connect(g);
  g.connect(song.out);
  accNotes.push({ f, t0: t, t1: end });
}
function synthNoise(t, dur, vol, type, freq) {
  const sN = audioCtx.createBufferSource(), flt = audioCtx.createBiquadFilter(), g = audioCtx.createGain();
  sN.buffer = getNoise(); flt.type = type; flt.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  sN.connect(flt); flt.connect(g); g.connect(song.out);
  sN.start(t); sN.stop(t + dur + 0.05);
}
function synthKick(t, vol) {
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g); g.connect(song.out);
  o.start(t); o.stop(t + 0.3);
}
function chordAt(b) {
  const bar = Math.floor((b - 1) / 3), pos = (b - 1) % 3;
  const c = BARS[Math.min(7, bar)];
  return { ch: CHORDS[Array.isArray(c) ? c[pos] : c], pos, name: Array.isArray(c) ? c[pos] : c };
}
const beatLen = () => 60 / SING_BPM;
function playBeat(gb, t) {
  const d = beatLen();
  if (gb < 0) {                                      // 预备拍：两小节咔嗒声，第一下给出调
    if (gb >= -5) {
      const accent = gb === -5 || gb === -2;
      synthNoise(t, 0.04, accent ? 0.3 : 0.18, 'bandpass', accent ? 2600 : 1800);
    }
    if (gb === -5) CHORDS.F.keys.forEach(m => synthKeys(m, t, 1.2, 0.07));
  }
  // 引导人声：这一拍里开始的旋律音
  for (const [m, st, du] of MEL) if (st >= gb && st < gb + 1 && gb >= 0) synthVoice(m, t + (st - gb) * d, du * d, 0.11 * guideGain(st));
  if (gb < 1) return;
  if (gb >= SONG_END_BEAT) {                         // 结尾：F 和弦延长
    if (gb === SONG_END_BEAT) {
      synthBass(41, t, 2.2, 0.2); CHORDS.F.keys.forEach(m => synthKeys(m, t, 2, 0.06));
      synthPad(CHORDS.F.pad, t, 2.4, 0.02); synthKick(t, 0.35);
    }
    return;
  }
  const { ch, pos, name } = chordAt(gb);
  const prev = gb > 1 ? chordAt(gb - 1).name : null;
  if (name !== prev) synthPad(ch.pad, t, (pos === 0 ? 3 : 1) * d + 0.05, 0.018);   // 换和弦就换铺底
  if (pos === 0) { synthKick(t, 0.4); synthBass(ch.bass, t, 1.1 * d, 0.2); }
  else { ch.keys.forEach(m => synthKeys(m, t, 0.55, 0.045)); synthNoise(t, 0.05, 0.04, 'highpass', 7000); }
}
const beatTime = gb => song.T0 + gb * beatLen();
const timeToBeat = t => (t - song.T0) / beatLen();
function startSong() {
  stopSong();
  const out = audioCtx.createGain();
  out.gain.value = 0.9;
  out.connect(audioCtx.destination);
  if (recDest) out.connect(recDest);                 // 伴奏也录进视频
  song = { out, T0: audioCtx.currentTime + 0.5 + 5 * beatLen(), nextGb: -5, gbNow: -99 };
}
function stopSong() {
  if (!song) return;
  const out = song.out, t = audioCtx.currentTime;
  try { out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + 0.15); } catch {}
  setTimeout(() => { try { out.disconnect(); } catch {} }, 400);
  song = null;
  accNotes.length = 0;
}
function scheduleSong() {
  while (song.nextGb <= SONG_END_BEAT && beatTime(song.nextGb) < audioCtx.currentTime + 0.25) {
    playBeat(song.nextGb, beatTime(song.nextGb)); song.nextGb++;
  }
}

// 音域：不用单独校准。用上次的；第一次玩就从声控模式的中心音估一个，边唱边自动调整
function newSingRound() {
  hitK = 0; targets = []; results = []; singSamples = []; lastRangeT = performance.now(); hopKey = '';
  if (!hasSingCalib) {
    const c = baseReady ? centerLog : Math.log2(220);
    singLo = c - 4.5 / 12; singHi = c + 4.5 / 12;
  }
  paddleX = W / 2;
  state = 'sing';
  startSong();
}
function adaptSingRange(now) {
  if (now - lastRangeT < 1000 || singSamples.length < 40) return;
  lastRangeT = now;
  const srt = singSamples.slice(-600).sort((a, b) => a - b);
  let lo = srt[Math.floor(srt.length * 0.1)] - 1 / 12, hi = srt[Math.floor(srt.length * 0.9)] + 1 / 12;
  const minSpan = SING_MIN_SPAN / 12;
  if (hi - lo < minSpan) { const c = (lo + hi) / 2; lo = c - minSpan / 2; hi = c + minSpan / 2; }
  const k = hasSingCalib ? 0.12 : 0.35;
  singLo += (lo - singLo) * k; singHi += (hi - singHi) * k;
}
function saveSingRange() {
  if (singSamples.length < 40) return;
  hasSingCalib = true;
  store.set('vb_sing_lo', String(singLo)); store.set('vb_sing_hi', String(singHi));
}
const hitGb = k => k < SING_HITS ? HIT_BEATS[k] : SONG_END_BEAT + 4;
const floorY = () => yHit() - 190;                 // 空中跳动时那层"看不见的地面"
const yHit = () => PAD_Y - R;
function targetX(k) {
  if (k >= SING_HITS) return W / 2;                  // 唱完最后一下，球落回中间
  while (targets.length <= k) {
    const m = LINE_X0 + paddleW / 2 + 4;
    if (!targets.length) { targets.push(W / 2 + (Math.random() < 0.5 ? -1 : 1) * (35 + Math.random() * 45)); continue; }   // 第一球在中间附近
    const prev = targets[targets.length - 1];
    let x, tries = 0;
    do { x = m + Math.random() * (W - 2 * m); } while (Math.abs(x - prev) < W * 0.22 && ++tries < 20);
    targets.push(x);
  }
  return targets[k];
}
function singHit(x) {
  score++; squash = 1;
  const oldFace = faceIdx;
  faceIdx = (faceIdx + 1) % faces.length;
  impact(x, PAD_Y, oldFace);
  if (navigator.vibrate) navigator.vibrate(12);
}
function singMiss(x, now) {                          // 没接住 = 游戏结束：掉进水里沉下去
  bandCrash(x, waveBase2());                          // 掉进乐队里：撞色纸屑 + 一把音符
  bx = x; by = yHit(); vx = 0; vy = 240;
  state = 'sink'; sinkAt = now;
  saveSingRange();
  stopSong();
}
function updateSing(now) {
  if (!song) return;
  scheduleSong();
  adaptSingRange(now);
  const t = audioNow(), gb = timeToBeat(t);
  song.gbNow = gb;
  if (gb >= SONG_END_BEAT + 0.4) { saveSingRange(); showResult(now); return; }   // 一首唱完就结束
  if (hitK < SING_HITS) {
    const k = hitK, tk = beatTime(hitGb(k));
    if (t >= tk - 0.06) {
      const x = targetX(k);
      if (Math.abs(paddleX - x) <= paddleW / 2 + R * HIT_TOL) { results[k] = 'hit'; hitK++; singHit(x); }
      else if (t >= tk + HIT_GRACE) { singMiss(x, now); return; }
    }
  }
  singBall(gb);
}
// 球的位置完全由节拍时钟算出来：平时在空中每拍跳一下，往下一个落点挪；只在 "you" 那一拍落到板子上
let hopKey = '';
function singBall(gb) {
  const fl = floorY();
  if (gb < 0) { bx = W / 2; by = fl + Math.sin(performance.now() / 300) * 6; return; }
  const k = hitK;
  const A = k === 0 ? 0 : HIT_BEATS[k - 1], B = hitGb(k);
  const xA = k === 0 ? W / 2 : targetX(k - 1), xB = targetX(k);
  if (gb >= B) { bx = xB; by = yHit(); return; }      // 落拍后的宽限时间：停在板子线上
  const g = Math.max(gb, A);                          // 提前一点判定接住时，从板子上开始弹起
  const u = Math.min(1, (g - A) / (B - A)), e = u * u * (3 - 2 * u);
  bx = xA + (xB - xA) * e;
  const i = Math.floor(g - A), f = (g - A) - i;
  const arc = (y0, y1, h, sP) => y0 + (y1 - y0) * sP - 4 * h * sP * (1 - sP);
  let phase;
  if (k > 0 && i === 0) { by = arc(yHit(), fl, RISE_H, f); phase = 'rise'; }        // 接住后弹回空中
  else if (k < SING_HITS && gb >= B - 1) { by = arc(fl, yHit(), DROP_H, f); phase = 'drop'; }   // 唱到 you：落向板子
  else { by = arc(fl, fl, HOP_H, f); phase = 'hop'; }                               // 空中自由小跳
  const key = k + ':' + i;
  if (key !== hopKey) { if (hopKey && phase !== 'rise') squash = Math.max(squash, 0.45); hopKey = key; }   // 每次空中落脚 Q 弹一下
}

// 卡拉 OK 歌词：当前这一句，正在唱的字高亮，要接球的字下面有小圆点
function drawLyrics(gb) {
  const b = gb < 0 ? -1 : Math.min(VERSE_BEATS - 0.01, gb);
  const line = gb < 0 ? 0 : Math.min(3, Math.floor(b / 6));
  const syl = SYL.slice(line * 6, line * 6 + 6);
  let cur = -1;
  if (gb >= 0) for (let i = 0; i < 6; i++) if (syl[i][1] <= b) cur = i;
  const hitIdx = [];
  for (const h of HIT_BEATS) {
    if (h < line * 6 || h >= line * 6 + 6) continue;
    let idx = 0;
    for (let i = 0; i < 6; i++) if (syl[i][1] <= h) idx = i;
    hitIdx.push(idx);
  }
  // 和其他文字统一：Poppins 粗斜体 + 黑描边；没唱到是白色，唱到的从左到右刷成黄色
  const LF = 'italic 800 22px Poppins, "Arial Rounded MT Bold", -apple-system, sans-serif', SUNG = '#FFE600';
  ctx.save();
  ctx.font = LF; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  const parts = syl.map(sy => sy[0] + sy[2]);
  const widths = parts.map(pt => ctx.measureText(pt).width);
  let x = W / 2 - widths.reduce((a, c) => a + c, 0) / 2;
  const y = 96;
  for (let i = 0; i < 6; i++) {
    // 这个音节唱了多少（0~1）：当前音节按时长从左往右推进
    const st = syl[i][1], en = i < 5 ? syl[i + 1][1] : st + 1;
    const f = gb < 0 ? 0 : Math.max(0, Math.min(1, (b - st) / Math.max(0.25, Math.min(1, en - st))));
    const w = widths[i];
    ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(parts[i], x, y);
    ctx.fillStyle = '#fff'; ctx.fillText(parts[i], x, y);
    if (f > 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(x - 4, y - 20, (w + 4) * f + 4, 40); ctx.clip();
      ctx.fillStyle = SUNG; ctx.fillText(parts[i], x, y); ctx.restore();
    }
    if (hitIdx.includes(i)) {                        // “you” 下面的小圆点：落点提示
      const sw = ctx.measureText(syl[i][0]).width;
      ctx.beginPath(); ctx.arc(x + sw / 2, y + 21, 4, 0, Math.PI * 2);
      ctx.fillStyle = f > 0 ? SUNG : '#fff'; ctx.fill();
      ctx.lineWidth = 2; ctx.stroke();
    }
    x += w;
  }
  ctx.restore();
}
function drawSingUI(now) {
  const gb = song.gbNow;
  drawLyrics(gb);
  if (gb < 0) {
    const pos = ((Math.floor(gb) - 1) % 3 + 3) % 3 + 1;
    drawBox(['Sing along and', 'catch the emojis!'], gb < -5 ? 0 : (gb + 5) / 5, gb < -5 ? '' : String(pos));
  } else if (hitK < SING_HITS) {
    // 落点提示：虚线胶囊（下一拍要把板子放到这里），对准了变绿
    const x = targetX(hitK), on = Math.abs(paddleX - x) <= paddleW / 2 + R * HIT_TOL;
    const frac = gb - Math.floor(gb);
    ctx.save();
    ctx.setLineDash([7, 5]); ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.55 + 0.45 * (1 - frac);
    ctx.strokeStyle = on ? '#5CFF8A' : '#fff';
    rr(x - paddleW / 2, PAD_Y, paddleW, PAD_H, PAD_H / 2); ctx.stroke();
    ctx.restore();
  }
}

// =====================================================================
// 海浪：板子下面三层会动的浪；没接住就掉进水里激起水花
// =====================================================================
// 海浪：之前的渐变半透明风格 + 一层淡淡的波点
const WAVES = [
  { off: 0,  A: 5, k: 0.030, w: 1.1,  A2: 3,   k2: 0.071, w2: -1.7, ph: 0, top: 'rgba(130,215,255,.42)', bot: 'rgba(40,130,225,.30)', foam: .5,  dot: 'rgba(255,255,255,.22)' },
  { off: 11, A: 6, k: 0.024, w: -1.4, A2: 2.5, k2: 0.058, w2: 2.1,  ph: 2, top: 'rgba(60,165,248,.58)',  bot: 'rgba(18,92,205,.42)',  foam: .65, dot: 'rgba(255,255,255,.2)' },
  { off: 22, A: 5, k: 0.036, w: 1.9,  A2: 2,   k2: 0.090, w2: -2.6, ph: 4, top: 'rgba(28,120,232,.72)',  bot: 'rgba(6,48,150,.55)',   foam: .85, dot: 'rgba(255,255,255,.18)' },
];


let splashes = [], drops = [], ripples = [];
const waterBase = () => LINE_Y + 42;   // 海面在轨道下方一点
function waveY(i, x, t) {
  const L = WAVES[i];
  let y = waterBase() + L.off + L.A * Math.sin(L.k * x + L.w * t + L.ph) + L.A2 * Math.sin(L.k2 * x + L.w2 * t);
  for (const sp of splashes) {                        // 落水点：先砸出一个坑，再一圈圈荡开
    const age = t - sp.t0;
    if (age < 0) continue;
    const amp = 15 * Math.exp(-age * 1.7) * (i === 0 ? 0.7 : 1);
    const spread = 25 + 150 * age;
    y += amp * Math.cos((x - sp.x) * 0.085 - age * 9) * Math.exp(-(((x - sp.x) / spread) ** 2));
  }
  return y;
}
function clearWater() { splashes = []; drops = []; ripples = []; }

function splash(x, y) {
  const t = performance.now() / 1000;
  splashes.push({ x, t0: t });
  ripples.push({ x, t: 0 }, { x, t: -0.12 });
  for (let i = 0; i < 34; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.85;
    const sp = 160 + Math.random() * 360;
    drops.push({ x: x + (Math.random() - 0.5) * 24, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      r: 1.8 + Math.random() * 3.6, life: 1, c: Math.random() < 0.55 ? '#fff' : '#9EDCFF' });
  }
  fx.shake = 0.6;
  if (navigator.vibrate) navigator.vibrate([30, 20, 50]);
}

function updateWater(dt) {
  const t = performance.now() / 1000;
  splashes = splashes.filter(sp => t - sp.t0 < 2.5);
  for (const r of ripples) r.t += dt;
  ripples = ripples.filter(r => r.t < 0.9);
  for (const d of drops) {
    d.vy += 900 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt * 0.9;
    if (d.vy > 0 && d.y > waveY(1, d.x, t)) d.life = 0;     // 落回水里
  }
  drops = drops.filter(d => d.life > 0);
}

const dotPatterns = {};
function dotPattern(color) {                         // 均匀的小网点贴图（高分辨率画好再缩小，手机上不糊）
  if (dotPatterns[color]) return dotPatterns[color];
  const sc = 3, step = 8, c = document.createElement('canvas');
  c.width = c.height = step * sc;
  const g = c.getContext('2d');
  g.fillStyle = color;
  [[0, 0], [step, 0], [0, step], [step, step], [step / 2, step / 2]].forEach(([x, y]) => { g.beginPath(); g.arc(x * sc, y * sc, 1.5 * sc, 0, Math.PI * 2); g.fill(); });
  const pat = ctx.createPattern(c, 'repeat');
  if (pat.setTransform && window.DOMMatrix) pat.setTransform(new DOMMatrix().scale(1 / sc));
  return (dotPatterns[color] = pat);
}
const waveDotCache = {};
function waveDots(i) {                               // 网点从海面往底部逐渐变大（预先画好）
  const L = WAVES[i], y0 = waterBase() + L.off, h = Math.max(20, Math.round(H - y0 + 24)), key = i + '_' + h + '_' + W;
  if (waveDotCache[key]) return waveDotCache[key];
  const sc = 3, c = document.createElement('canvas');
  c.width = Math.round(W * sc); c.height = h * sc;
  const g = c.getContext('2d');
  g.scale(sc, sc); g.fillStyle = L.dot;
  const start = 20, span = Math.max(30, (h - start) * 0.8);
  for (let y = 0, row = 0; y <= h; y += 4, row++) {
    const k = Math.min(1, Math.max(0, (y - start) / span));
    if (k <= 0) continue;
    const r = 0.35 + 1.65 * k;
    for (let x = row % 2 ? 4 : 0; x <= W + 4; x += 8) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  }
  return (waveDotCache[key] = c);
}
function wavePath(i, t, close) {
  ctx.beginPath();
  for (let x = -6; x <= W + 6; x += 6) { const y = waveY(i, x, t); x === -6 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
  if (close) { ctx.lineTo(W + 6, H + 10); ctx.lineTo(-6, H + 10); ctx.closePath(); }
}
function drawWave(i, t) {
  const L = WAVES[i], y0 = waterBase() + L.off;
  wavePath(i, t, true);
  const g = ctx.createLinearGradient(0, y0 - 10, 0, H);
  g.addColorStop(0, L.top); g.addColorStop(1, L.bot);
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();                            // 波点：海平面附近没有，越往下越大
  ctx.drawImage(waveDots(i), 0, y0 - 12, W, H - y0 + 24);
  ctx.restore();
  wavePath(i, t, false);                             // 浪尖白色泡沫
  ctx.strokeStyle = `rgba(255,255,255,${L.foam})`; ctx.lineWidth = 3.2; ctx.stroke();
}

function drawSplashFx(t) {
  ctx.save();
  for (const r of ripples) {
    if (r.t <= 0) continue;
    const k = r.t / 0.9, y = waveY(1, r.x, t);
    ctx.strokeStyle = `rgba(255,255,255,${0.85 * (1 - k)})`; ctx.lineWidth = 3 * (1 - k) + 0.5;
    ctx.beginPath(); ctx.ellipse(r.x, y, 12 + 90 * easeOut(k), 4 + 18 * easeOut(k), 0, 0, Math.PI * 2); ctx.stroke();
  }
  for (const d of drops) {
    ctx.globalAlpha = Math.max(0, Math.min(1, d.life * 1.5));
    ctx.fillStyle = d.c;
    const sp = Math.hypot(d.vx, d.vy), st = Math.min(2.2, 1 + sp / 400);   // 速度快的水滴拉长
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(Math.atan2(d.vy, d.vx));
    ctx.beginPath(); ctx.ellipse(0, 0, d.r * st, d.r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// =====================================================================
// 唱歌版舞台：钢琴 + 青色波点背景 + 飘出的音符，跟着节拍动
// =====================================================================
const BAND = { blue: '#2A3BFF', dots: 'rgba(255,46,147,.55)', K: '#111' };
let bandNotes = [], bandLastBeat = -999, bandLastT = 0, bandKey = -1;
const waveBase2 = () => LINE_Y + 42;
const bandBeat = now => (mode === 'sing' && song) ? song.gbNow : now / 1000 * (SING_BPM / 60) * 0.5;
function drawNote(n) {                                // 波普音符：彩色符头 + 黑描边
  ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(n.rot); ctx.scale(n.sz, n.sz);
  ctx.lineJoin = 'round';
  const head = (hx) => { ctx.beginPath(); ctx.ellipse(hx, 0, 5.5, 4, -0.4, 0, Math.PI * 2); ctx.fillStyle = n.c; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = BAND.K; ctx.stroke(); };
  ctx.strokeStyle = BAND.K; ctx.lineWidth = 2.4;
  if (n.dbl) {
    ctx.beginPath(); ctx.moveTo(4.6, 1.5); ctx.lineTo(4.6, -20); ctx.lineTo(18.6, -24); ctx.lineTo(18.6, 1.5); ctx.stroke();   // 符杆伸进符头里，接缝被符头盖住
    ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(4.5, -19); ctx.lineTo(18.5, -23); ctx.stroke();
    head(0); head(14);
  } else {
    ctx.beginPath(); ctx.moveTo(4.6, 1.5); ctx.lineTo(4.6, -21); ctx.quadraticCurveTo(12, -16, 11, -8); ctx.stroke();
    head(0);
  }
  ctx.restore();
}
// 钢琴贴图（截取了一段弯曲的琴键），放大横跨整个屏幕；下面铺一层底色，上面撒一点网点
const pianoImg = new Image();
let pianoEdge = null;                                // 每一列琴键的上沿 / 下沿（0~1），用来让底色和网点贴着钢琴的弧线
pianoImg.onload = () => {
  try {
    const c = document.createElement('canvas'), N = 80;
    c.width = pianoImg.naturalWidth; c.height = pianoImg.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(pianoImg, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, out = [];
    for (let i = 0; i <= N; i++) {
      const x = Math.min(c.width - 1, Math.round(i / N * (c.width - 1)));
      let top = -1, bot = -1;
      for (let y = 0; y < c.height; y++) if (d[(y * c.width + x) * 4 + 3] > 140) { if (top < 0) top = y; bot = y; }
      out.push(top < 0 ? null : [i / N, top / c.height, bot / c.height]);
    }
    pianoEdge = out;
  } catch (e) { pianoEdge = null; }
};
pianoImg.src = 'assets/game/piano.png?v=1';
const PIANO = { bg: '#3AA8C8', bgDot: 'rgba(244,167,185,.9)', topDot: '#F7D44C' };   // 配色参考波普插画：湖蓝底 + 粉色网点 + 黄色点点
function pianoXf(now) {
  const beat = bandBeat(now), ph = beat - Math.floor(beat);
  const pulse = beat >= 0 || !song ? Math.exp(-ph * 6) : 0;
  const w = 760, h = w * (pianoImg.naturalHeight || 256) / (pianoImg.naturalWidth || 1100);
  return { cx: 235, cy: waveBase2() + h * 0.42 + 16 - pulse * 3, w, h, rot: -0.06 + Math.sin(beat * Math.PI / 3) * 0.015, sc: 1 + pulse * 0.02 };
}
function pianoPt(X, u, v) {                         // 图片里的 (u, v) → 屏幕坐标
  const x = (u - 0.5) * X.w * X.sc, y = (v - 0.5) * X.h * X.sc, c = Math.cos(X.rot), s = Math.sin(X.rot);
  return [X.cx + x * c - y * s, X.cy + x * s + y * c];
}
const stageMid = () => waveBase2() + 50;
const BAND_SPOTS = () => [60, 130, 200, 270, 340].map(x => [x, stageMid() + 40]);   // 音符从琴键上冒出来的位置
// 底色里的粉色网点：越往下越大（预先画好）
let pianoDotCache = null;
function pianoBgDots() {
  const h = 320, key = W + '_' + h;
  if (pianoDotCache && pianoDotCache.key === key) return pianoDotCache.c;
  const sc = 3, c = document.createElement('canvas');
  c.width = Math.round(W * sc); c.height = h * sc;
  const g = c.getContext('2d'); g.scale(sc, sc); g.fillStyle = PIANO.bgDot;
  for (let y = 0, row = 0; y <= h; y += 7, row++) for (let x = row % 2 ? 4 : 0; x <= W + 4; x += 8) {
    const k = Math.min(1, Math.max(0, (y - 40) / 200));
    if (k <= 0.03) continue;
    g.beginPath(); g.arc(x, y, 0.4 + 2.2 * k, 0, Math.PI * 2); g.fill();
  }
  pianoDotCache = { key, c };
  return c;
}
function drawBand(now) {
  const dt = Math.min(0.05, (now - (bandLastT || now)) / 1000); bandLastT = now;
  const beat = bandBeat(now), bi = Math.floor(beat), ph = beat - bi;
  const pulse = beat >= 0 || !song ? Math.exp(-ph * 6) : 0;
  if (bi !== bandLastBeat) {                         // 每拍：从某个乐器冒出一个音符，并按一个琴键
    bandLastBeat = bi;
    const spots = BAND_SPOTS(), sp = spots[Math.floor(Math.random() * spots.length)];
    bandNotes.push({ x: sp[0] + (Math.random() - 0.5) * 20, y: sp[1] - 100, vx: (Math.random() - 0.5) * 30, vy: -55 - Math.random() * 30,
      rot: (Math.random() - 0.5) * 0.6, sz: 0.9 + Math.random() * 0.5, c: [POP.Y, POP.M, POP.C, '#fff'][Math.floor(Math.random() * 4)], dbl: Math.random() < 0.4, life: 1 });
    bandKey = Math.floor(Math.random() * 15);
  }
  // 钢琴下面：湖蓝底色 + 往下越来越大的粉色网点；钢琴上面：一圈黄色小点
  if (pianoEdge) {
    const X = pianoXf(now), pts = pianoEdge.filter(Boolean);
    ctx.save();
    ctx.beginPath();
    pts.forEach(([u, t, b], i) => { const [x, y] = pianoPt(X, u, (t + b) / 2); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    const last = pianoPt(X, 1, 0.5), first = pianoPt(X, 0, 0.5);
    ctx.lineTo(Math.max(last[0], W + 10), H + 10); ctx.lineTo(Math.min(first[0], -10), H + 10); ctx.closePath();
    ctx.fillStyle = PIANO.bg; ctx.fill();
    ctx.clip();
    const top = waveBase2();
    ctx.drawImage(pianoBgDots(), 0, top, W, 320);
    ctx.restore();
    // 钢琴上沿外面的黄色网点：贴着琴键往上逐渐变小，高度略有起伏
    const tops = pts.map(([u, t]) => pianoPt(X, u, t)).sort((a, b) => a[0] - b[0]);
    const topAt = x => { for (let i = 1; i < tops.length; i++) if (tops[i][0] >= x) { const [x0, y0] = tops[i - 1], [x1, y1] = tops[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0 || 1); } return tops[tops.length - 1][1]; };
    ctx.fillStyle = PIANO.topDot; ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let x = 2, col = 0; x <= W; x += 7.5, col++) {
      const ty = topAt(x), reach = 36 * (1 + 0.28 * Math.sin(x / 47 + 1) + 0.15 * Math.sin(x / 19));
      for (let dy = 4 + (col % 2 ? 3.4 : 0); dy < reach; dy += 6.8) {
        const k = 1 - dy / reach, r = 2.7 * Math.pow(k, 0.85);
        if (r < 0.45) continue;
        ctx.moveTo(x + r, ty - dy); ctx.arc(x, ty - dy, r, 0, Math.PI * 2);
      }
    }
    ctx.fill(); ctx.globalAlpha = 1;
  }
  for (const n of bandNotes) { n.x += (n.vx + Math.sin(n.y * 0.05) * 20) * dt; n.y += n.vy * dt; n.life -= dt * 0.55; n.rot += dt * 0.8; }
  bandNotes = bandNotes.filter(n => n.life > 0 && n.y > 60);
  for (const n of bandNotes) { ctx.globalAlpha = Math.min(1, n.life * 2.5); drawNote(n); }
  ctx.globalAlpha = 1;
}
function drawKeys(now) {                             // 最前面：放大的弯曲钢琴，随节拍轻轻起伏
  if (!pianoImg.complete || !pianoImg.naturalWidth) return;
  const X = pianoXf(now);
  ctx.save();
  ctx.translate(X.cx, X.cy); ctx.rotate(X.rot); ctx.scale(X.sc, X.sc);
  ctx.drawImage(pianoImg, -X.w / 2, -X.h / 2, X.w, X.h);
  ctx.restore();
}
function bandCrash(x, y) {                           // 唱歌版没接住：掉进乐队，炸出纸屑和音符
  fx.shake = 0.7;
  const cols = [POP.Y, POP.M, POP.C, POP.W, POP.R];
  for (let i = 0; i < 22; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1, sp = 220 + Math.random() * 300;
    fx.confetti.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 16,
      size: 5 + Math.random() * 4, shape: i % 4, c: cols[i % cols.length], life: 1, decay: 1 + Math.random() * 0.5 });
  }
  for (let i = 0; i < 6; i++) bandNotes.push({ x: x + (Math.random() - 0.5) * 40, y, vx: (Math.random() - 0.5) * 120, vy: -120 - Math.random() * 80,
    rot: (Math.random() - 0.5), sz: 1 + Math.random() * 0.5, c: cols[i % 4], dbl: i % 2 === 0, life: 1 });
  if (navigator.vibrate) navigator.vibrate([30, 20, 50]);
}

// =====================================================================
// 结算画面
// =====================================================================
// 评级（波普贴纸）
function ratingWord() {
  if (mode === 'sing') return ['OOPS!', 'NICE!', 'GREAT!', 'PERFECT!'][Math.min(3, score)];
  return score === 0 ? 'OOPS!' : score < 5 ? 'NICE!' : score < 10 ? 'GREAT!' : score < 20 ? 'AMAZING!' : 'PERFECT!';
}
let resultBurst = null;
function showResult(now) {
  state = 'result'; resultAt = now;
  const key = mode === 'sing' ? 'vb_best_sing' : 'vb_best';      // 最高分只在后台记着，不显示
  best = parseInt(store.get(key, '0'), 10) || 0;
  if (score > best) store.set(key, String(score));
  const word = ratingWord(), r0 = word.length > 6 ? 50 : 44, spikes = [];
  for (let i = 0; i < 24; i++) spikes.push(i % 2 ? r0 * (0.64 + Math.random() * 0.06) : r0 * (0.95 + Math.random() * 0.2));
  resultBurst = { t: 0, word, spikes, r0, rot: 0.16, x: 0, y: 0 };
  if (word === 'PERFECT!' || word === 'AMAZING!') {
    const cy = BOX.y + 22;
    for (let i = 0; i < 18; i++) {                    // 高评级：撒星星
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6, sp = 160 + Math.random() * 260;
      fx.stars.push({ x: 290, y: cy - 70, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, delay: 0.85 + Math.random() * 0.3,
        life: 0.8 + Math.random() * 0.5, size: 7 + Math.random() * 8, rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 10, tw: Math.random() * 6, img: starImgs[i % 2] });
    }
  }
}
const easeOutBack = x => { const c = 1.70158; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };

let bubbleDotCache = null;
function bubbleDots(RX, RY) {                        // 右下角 + 左上角网点：离中心越远点越大
  if (bubbleDotCache) return bubbleDotCache;
  const sc = 3, c = document.createElement('canvas');
  c.width = RX * 2 * sc; c.height = RY * 2 * sc;
  const g = c.getContext('2d');
  g.scale(sc, sc); g.translate(RX, RY); g.fillStyle = 'rgba(255,46,147,.5)';
  for (let y = -RY, row = 0; y <= RY; y += 5.5, row++) for (let x = -RX + (row % 2 ? 3.2 : 0); x <= RX; x += 6.4) {
    const d = Math.max(x / RX * 0.75 + y / RY * 0.85, -(x / RX * 0.75 + y / RY * 0.85));   // 右下角和左上角对称
    const k = Math.min(1, Math.max(0, (d - 0.45) / 0.85));
    if (k <= 0.04) continue;
    g.beginPath(); g.arc(x, y, 2.4 * k, 0, Math.PI * 2); g.fill();
  }
  return (bubbleDotCache = c);
}
function drawResult(now) {
  const t = (now - resultAt) / 1000;
  ctx.fillStyle = `rgba(0,0,0,${0.4 * Math.min(1, t / 0.3)})`;      // 背景之上压一层 40% 黑
  ctx.fillRect(-20, -20, W + 40, H + 40);
  const e = t < 0.45 ? easeOutBack(t / 0.45) : 1;
  const cw = 236, ch = 158, cx = 195, cy = BOX.y + 22;
  ctx.save();
  ctx.globalAlpha = Math.min(1, t / 0.15);
  ctx.translate(cx, cy); ctx.scale(e, e);
  ctx.rotate(-0.03);                                 // 漫画对话气泡：奶白椭圆 + 小尾巴 + 粗黑描边 + 蓝色错位硬阴影
  const RX = cw / 2, RY = ch / 2;
  const bubble = (part) => {
    ctx.beginPath();
    if (part !== 2) ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
    if (part !== 1) { ctx.moveTo(-RX * 0.57, RY * 0.6); ctx.lineTo(-RX * 0.66, RY * 1.17); ctx.lineTo(-RX * 0.2, RY * 0.93); ctx.closePath(); }
  };
  const drawBubble = (dx, dy, fill) => {             // 先描双倍粗的边再填色，尾巴和椭圆连成一个外轮廓
    ctx.save(); ctx.translate(dx, dy);
    bubble(); ctx.lineJoin = 'round'; ctx.lineWidth = 9; ctx.strokeStyle = POP.K; ctx.stroke();
    ctx.fillStyle = fill; bubble(1); ctx.fill(); bubble(2); ctx.fill();
    ctx.restore();
  };
  const ep = (a, k) => [Math.cos(a) * RX * k, Math.sin(a) * RY * k];   // 椭圆上的点
  drawBubble(9, 9, '#2F6BFF');
  drawBubble(0, 0, '#FFFBEA');
  // 气泡右下角的粉色网点阴影（越靠边越大）
  ctx.save(); bubble(1); ctx.clip();
  ctx.drawImage(bubbleDots(RX, RY), -RX, -RY, RX * 2, RY * 2);
  ctx.restore();
  // Score（字体和倒计时提示一致）
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  outlineText('Score', 0, -RY + 32, UI_FONT, 2);
  // 大数字：漫画字体，黄字 + 粗黑描边 + 红色错位
  const shown = Math.round(score * Math.min(1, t / 0.7));          // 数字滚动上来
  const pop = t > 0.7 && t < 0.95 ? 1 + 0.15 * Math.sin((t - 0.7) / 0.25 * Math.PI) : 1;
  ctx.save(); ctx.translate(0, 4); ctx.scale(pop, pop);
  ctx.font = `72px ${POP_FONT}`; ctx.lineJoin = 'round';
  ctx.lineWidth = 9; ctx.strokeStyle = POP.K;
  ctx.fillStyle = POP.R; ctx.strokeText(String(shown), 5, 5); ctx.fillText(String(shown), 5, 5);
  ctx.strokeText(String(shown), 0, 0); ctx.fillStyle = POP.Y; ctx.fillText(String(shown), 0, 0);
  ctx.restore();
  // 数字下面一笔带小圈的手绘线（随数字滚动画出来）
  {
    const k = Math.min(1, Math.max(0, (t - 0.3) / 0.6));
    if (k > 0) {
      const sc = 0.46;
      ctx.save(); ctx.translate(-145 * sc, 55 - 90 * sc); ctx.scale(sc, sc);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 11; ctx.strokeStyle = '#FE2C55';
      ctx.setLineDash([520 * k, 2000]);
      ctx.beginPath();
      ctx.moveTo(30, 125);
      ctx.bezierCurveTo(70, 95, 125, 62, 148, 75);
      ctx.bezierCurveTo(165, 88, 150, 132, 125, 130);
      ctx.bezierCurveTo(102, 128, 105, 95, 135, 75);
      ctx.bezierCurveTo(160, 58, 200, 50, 262, 50);
      ctx.stroke(); ctx.restore();
    }
  }
  // 两颗一闪一闪的小星星
  [[RX * 0.98, RY * 0.62, 20, 0, 0], [RX * 1.12, RY * 0.1, 12, 1, 1.7]].forEach(([x, y, z, i, ph]) => {
    const st = starImgs[i];
    if (!st.naturalWidth) return;
    const k = 0.75 + 0.25 * Math.sin(now / 220 + ph);
    ctx.save(); ctx.translate(x, y); ctx.rotate(now / 1600 + ph); ctx.scale(k, k);
    ctx.drawImage(st, -z / 2, -z / 2, z, z); ctx.restore();
  });
  const im = faces[faceIdx];                          // 表情趴在卡片顶上，轻轻上下晃
  if (im.naturalWidth) {
    const sc = 62 / Math.max(im.naturalWidth, im.naturalHeight);
    const w = im.naturalWidth * sc, h = im.naturalHeight * sc, bob = Math.sin(now / 260) * 3;
    ctx.drawImage(im, -w / 2, -ch / 2 - h * 0.88 + bob, w, h);
  }
  if (resultBurst && t > 0.8) {                      // 数字滚完后，右上角拍上评级贴纸
    resultBurst.t = t - 0.8; resultBurst.x = cw / 2 - 22; resultBurst.y = -ch / 2 + 18;
    ctx.globalAlpha = 1;
    drawBurst(resultBurst, true);
  }
  ctx.restore();
}

// =====================================================================
// 碰撞特效（波普艺术 / 漫画风）：网点爆炸 + 黑色速度线 + 粗描边冲击环 + POW! 爆炸字 + 撞色纸屑 + 套色错位残影 + 星星 + 震屏
// =====================================================================
const CYAN = '#25F4EE', RED = '#FE2C55', GOLD = '#FFE45C';
const POP = { Y: '#FFE600', M: '#FF2E93', C: '#00C2FF', R: '#FF2A2A', K: '#111111', W: '#FFFFFF' };
const POP_WORDS = ['POW!', 'BAM!', 'WOW!', 'ZAP!', 'BOOM!', 'YES!', 'WHAM!'];
const POP_FONT = 'Bangers, "Arial Black", Impact, sans-serif';
const fx = { rings: [], confetti: [], ghosts: [], stars: [], dots: [], lines: null, bursts: [], glow: 0, shake: 0, pad: 0, x: 0, y: 0, lastWord: '', side: 1 };
const tintCache = {}, halftoneCache = {};
const starImgs = [1, 2].map(i => { const im = new Image(); im.src = `assets/game/star${i}.svg?v=1`; return im; });
if (document.fonts && document.fonts.load) ['40px Bangers', 'italic 800 20px Poppins'].forEach(f => document.fonts.load(f).catch(() => {}));

function tinted(i, color) {            // 表情的纯色剪影（套色错位残影用）
  const key = i + color;
  if (tintCache[key]) return tintCache[key];
  const im = faces[i];
  if (!im.complete || !im.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = im.naturalWidth * 2; c.height = im.naturalHeight * 2;
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  return (tintCache[key] = c);
}
// 本戴网点：中间大、往外越来越小的圆点（提前画好，之后直接贴图）
function halftone(color, fade) {
  const key = color + fade;
  if (halftoneCache[key]) return halftoneCache[key];
  const R = 100, sc = 3, c = document.createElement('canvas');
  c.width = c.height = R * 2 * sc;
  const g = c.getContext('2d');
  g.scale(sc, sc); g.fillStyle = color;
  const step = 9;
  for (let yy = -R; yy <= R; yy += step) {
    for (let xx = -R + ((yy / step) % 2 ? step / 2 : 0); xx <= R; xx += step) {
      const d = Math.hypot(xx, yy) / R;
      if (d > 1) continue;
      const r = fade ? 4.2 * Math.pow(1 - d, 0.7) : 2.6;
      if (r < 0.4) continue;
      g.beginPath(); g.arc(R + xx, R + yy, r, 0, Math.PI * 2); g.fill();
    }
  }
  return (halftoneCache[key] = c);
}

// 特效等级：一开始很简单，连击越多越复杂
// 0：冲击环 + 小黄网点 + 少量纸屑星星　1：+品红网点、速度线、套色残影　2：+POW! 爆炸字　3：全开
function fxLevel() {
  if (mode === 'sing') return [0, 0, 1, 3][Math.min(3, score)];   // 唱歌只有 3 下：第三下（最后一个 you）全开
  return score <= 2 ? 0 : score <= 5 ? 1 : score <= 9 ? 2 : 3;
}
function impact(x, y, oldFace) {
  const L = fxLevel(), p = Math.min(1, score / 25);
  fx.x = x; fx.y = y;
  fx.glow = 1; fx.pad = 1;
  fx.shake = [0.3, 0.45, 0.6, 0.8][L] + 0.25 * p;
  fx.rings.push({ t: 0, max: [70, 90, 105, 125][L] + 30 * p });
  fx.dots.push({ t: -0.03, x, y: y - 8, c: POP.Y, max: [0.45, 0.7, 0.8, 1.0][L] + 0.2 * p });
  if (L >= 1) {
    fx.dots.push({ t: 0, x, y: y - 8, c: POP.M, max: [0, 0.9, 1.15, 1.4][L] + 0.3 * p });
    fx.lines = { t: 0, rot: Math.random() * Math.PI, n: [0, 10, 14, 20][L], len: [0, 40, 55, 75][L] + 30 * p };
    fx.ghosts.push({ i: oldFace, x: bx, y: by, t: 0 });
  }
  if (L >= 2) {                                      // POW! 爆炸字：左右交替出现在表情旁边
    fx.side = -fx.side;
    let word; do { word = POP_WORDS[Math.floor(Math.random() * POP_WORDS.length)]; } while (word === fx.lastWord);
    fx.lastWord = word;
    const n = 12, r0 = (L === 2 ? 36 : 46) + 12 * p, spikes = [];
    for (let i = 0; i < n * 2; i++) spikes.push(i % 2 ? r0 * (0.62 + Math.random() * 0.08) : r0 * (0.95 + Math.random() * 0.25));
    fx.bursts = [{ t: 0, word, spikes, r0, rot: (Math.random() - 0.5) * 0.45,
      x: Math.max(70, Math.min(W - 70, x + fx.side * (70 + Math.random() * 20))), y: y - 110 - Math.random() * 25 }];
  }
  // 撞色纸屑：三角 / 方块 / 圆点 / 闪电，黑色描边
  const cols = L === 0 ? [POP.Y, POP.W] : [POP.Y, POP.M, POP.C, POP.W, POP.R];
  for (let i = 0, nc = [6, 11, 16, 24][L] + Math.round(p * 8); i < nc; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2;
    const sp = 220 + Math.random() * (260 + 70 * L + 150 * p);
    fx.confetti.push({ x, y: y - 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 16,
      size: 4.5 + Math.random() * (3 + L), shape: L === 0 ? (i % 2) * 2 : i % 4, c: cols[i % cols.length], life: 1, decay: 1.1 + Math.random() * 0.6 });
  }
  // 设计稿里的两种小星星
  for (let i = 0, n2 = [3, 5, 8, 12][L] + Math.round(p * 4); i < n2; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.35;
    const sp = 120 + Math.random() * 230;
    fx.stars.push({ x, y: y - 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, delay: Math.random() * 0.08,
      life: 0.55 + Math.random() * 0.35, size: 6 + Math.random() * 8, rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 10, tw: Math.random() * Math.PI * 2, img: starImgs[i % 2] });
  }
}

function updateFx(dt) {
  fx.glow = Math.max(0, fx.glow - dt * 3);
  fx.pad = Math.max(0, fx.pad - dt * 4);
  fx.shake = Math.max(0, fx.shake - dt * 4);
  for (const d of fx.dots) d.t += dt;
  fx.dots = fx.dots.filter(d => d.t < 0.45);
  if (fx.lines) { fx.lines.t += dt; if (fx.lines.t > 0.28) fx.lines = null; }
  for (const r of fx.rings) r.t += dt;
  fx.rings = fx.rings.filter(r => r.t < 0.5);
  for (const b of fx.bursts) b.t += dt;
  fx.bursts = fx.bursts.filter(b => b.t < 0.7);
  for (const c of fx.confetti) {
    c.vy += 1000 * dt; c.vx *= Math.pow(0.3, dt);
    c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.spin * dt; c.life -= c.decay * dt;
  }
  fx.confetti = fx.confetti.filter(c => c.life > 0);
  for (const st of fx.stars) {
    st.t += dt;
    if (st.t < st.delay) continue;
    st.vx *= Math.pow(0.08, dt); st.vy = st.vy * Math.pow(0.08, dt) + 60 * dt;
    st.x += st.vx * dt; st.y += st.vy * dt; st.rot += st.spin * dt;
  }
  fx.stars = fx.stars.filter(st => st.t < st.life + st.delay);
  for (const g of fx.ghosts) g.t += dt;
  fx.ghosts = fx.ghosts.filter(g => g.t < 0.38);
}
function clearFx() { fx.rings = []; fx.confetti = []; fx.ghosts = []; fx.stars = []; fx.dots = []; fx.bursts = []; fx.lines = null; fx.glow = fx.shake = fx.pad = 0; }

const easeOut = t => 1 - Math.pow(1 - t, 3);

function drawFxBack() {                // 在板子和表情后面：网点爆炸、速度线、冲击环
  const { x, y } = fx;
  ctx.save();
  for (const d of fx.dots) {
    if (d.t <= 0) continue;
    const t = d.t / 0.45, sc = (0.35 + d.max * easeOut(t)), R = 100 * sc;
    ctx.globalAlpha = t < 0.6 ? 1 : (1 - t) / 0.4;
    ctx.drawImage(halftone(d.c, true), d.x - R, d.y - R, R * 2, R * 2);
  }
  ctx.globalAlpha = 1;
  if (fx.lines) {                                   // 漫画速度线：黑色尖三角往外射
    const L = fx.lines, t = L.t / 0.28;
    ctx.save();
    ctx.translate(x, y - 8); ctx.rotate(L.rot);
    ctx.globalAlpha = 1 - t * t;
    ctx.fillStyle = POP.K;
    for (let i = 0; i < L.n; i++) {
      const ang = (i / L.n) * Math.PI * 2, r0 = 46 + 70 * easeOut(t), r1 = r0 + L.len * (i % 2 ? 0.6 : 1), w = 0.045;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang - w) * r0, Math.sin(ang - w) * r0);
      ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
      ctx.lineTo(Math.cos(ang + w) * r0, Math.sin(ang + w) * r0);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  for (const r of fx.rings) {                       // 粗黑描边 + 黄色内圈的冲击环
    const t = r.t / 0.5, rad = 16 + r.max * easeOut(t);
    ctx.beginPath(); ctx.ellipse(x, y, rad, rad * 0.4, 0, 0, Math.PI * 2);
    ctx.lineWidth = 8 * (1 - t) + 1; ctx.strokeStyle = POP.K; ctx.stroke();
    ctx.lineWidth = 4 * (1 - t) + 0.5; ctx.strokeStyle = POP.Y; ctx.stroke();
  }
  ctx.restore();
}

function starPath(b) {
  const n = b.spikes.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * b.spikes[i] * 1.25, Math.sin(a) * b.spikes[i]);
  }
  ctx.closePath();
}
function drawBurst(b, hold) {                // POW! 爆炸贴纸：黄底尖角 + 品红错位阴影 + 网点 + 粗黑描边 + 红字
  const t = b.t;
  let sc;
  if (t < 0.13) sc = easeOutBack(t / 0.13) * 1.12;
  else if (t < 0.48 || hold) sc = 1.12 - 0.12 * Math.min(1, (t - 0.13) / 0.08);
  else sc = Math.max(0, 1 - (t - 0.48) / 0.2);
  if (sc <= 0.01) return;
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.rot + (t < 0.25 ? Math.sin(t * 60) * 0.04 : 0));
  ctx.scale(sc, sc);
  ctx.lineJoin = 'miter';
  ctx.save(); ctx.translate(7, 7); starPath(b); ctx.fillStyle = POP.M; ctx.fill(); ctx.restore();
  starPath(b); ctx.fillStyle = POP.Y; ctx.fill();
  ctx.save(); starPath(b); ctx.clip();
  ctx.globalAlpha = 0.55; const R = b.r0 * 1.4;
  ctx.drawImage(halftone('#FF9F1C', false), -R, -R, R * 2, R * 2);
  ctx.restore();
  starPath(b); ctx.lineWidth = 4; ctx.strokeStyle = POP.K; ctx.stroke();
  const fs = b.r0 * (b.word.length > 6 ? 0.5 : b.word.length > 4 ? 0.62 : 0.74);
  ctx.font = `${fs}px ${POP_FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 6; ctx.strokeStyle = POP.K;
  ctx.fillStyle = POP.C; ctx.strokeText(b.word, 3, 4); ctx.fillText(b.word, 3, 4);   // 青色错位
  ctx.strokeText(b.word, 0, 1); ctx.fillStyle = POP.R; ctx.fillText(b.word, 0, 1);
  ctx.restore();
}

function drawFxFront() {               // 在表情前面：套色残影、纸屑、星星、POW!
  ctx.save();
  for (const g of fx.ghosts) {                      // 印刷套色错位：品红 + 青 两层
    const t = g.t / 0.38, im = faces[g.i];
    if (!im.naturalWidth) continue;
    const sc = FACE / Math.max(im.naturalWidth, im.naturalHeight) * (1 + 0.45 * easeOut(t));
    const w = im.naturalWidth * sc, h = im.naturalHeight * sc;
    ctx.globalAlpha = (1 - t) * 0.85;
    [[POP.M, -1, 0], [POP.C, 1, -1]].forEach(([c, d, dy]) => {
      const tc = tinted(g.i, c);
      if (tc) ctx.drawImage(tc, g.x - w / 2 + d * (4 + 14 * t), g.y - h / 2 + dy * 6 * t - 4 * t, w, h);
    });
  }
  for (const c of fx.confetti) {
    ctx.globalAlpha = Math.min(1, c.life * 2);
    ctx.save();
    ctx.translate(c.x, c.y); ctx.rotate(c.rot);
    const z = c.size;
    ctx.beginPath();
    if (c.shape === 0) { ctx.moveTo(0, -z); ctx.lineTo(z * 0.9, z * 0.7); ctx.lineTo(-z * 0.9, z * 0.7); ctx.closePath(); }
    else if (c.shape === 1) ctx.rect(-z * 0.7, -z * 0.7, z * 1.4, z * 1.4);
    else if (c.shape === 2) ctx.arc(0, 0, z * 0.75, 0, Math.PI * 2);
    else { ctx.moveTo(-z, -z * 0.3); ctx.lineTo(z * 0.1, -z * 0.3); ctx.lineTo(-z * 0.2, z * 0.2); ctx.lineTo(z, z * 0.2); ctx.lineTo(z * 0.2, z); ctx.lineTo(z * 0.4, z * 0.45); ctx.lineTo(-z * 0.6, z * 0.45); ctx.closePath(); }
    ctx.fillStyle = c.c; ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = POP.K; ctx.stroke();
    ctx.restore();
  }
  for (const st of fx.stars) {
    const t = (st.t - st.delay) / st.life;
    if (t <= 0 || !st.img.naturalWidth) continue;
    const pop = t < 0.2 ? easeOut(t / 0.2) * 1.3 : 1.3 - 0.3 * Math.min(1, (t - 0.2) / 0.2);
    const twinkle = 0.75 + 0.25 * Math.sin(st.tw + st.t * 28);
    const sz = st.size * pop * twinkle * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
    if (sz <= 0.3) continue;
    const ar = st.img.naturalHeight / st.img.naturalWidth;
    ctx.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1;
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.rotate(st.rot);
    ctx.drawImage(st.img, -sz, -sz * ar, sz * 2, sz * 2 * ar);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  for (const b of fx.bursts) drawBurst(b);
  ctx.restore();
}

function bounce() {
  score++;
  squash = 1;
  const oldFace = faceIdx;
  faceIdx = (faceIdx + 1) % faces.length;          // 每弹一下换一个表情
  impact(bx, PAD_Y, oldFace);
  playSfx('pop', 0.9, 0.94 + Math.random() * 0.12);
  if (navigator.vibrate) navigator.vibrate(12);
  const apex = 694 * (0.12 + Math.random() * 0.14) + dCam;
  const rise = Math.max(694 * 0.25, (PAD_Y - R) - apex);
  vy = -Math.sqrt(2 * gravity() * rise);
  // 每次都指定一个新落点：离这次击球位置至少 30% 屏宽，逼你每一下都得移动板子
  const lo = SIDE + R + 6, hi = W - SIDE - R - 6;
  let tx, tries = 0;
  do { tx = lo + Math.random() * (hi - lo); } while (Math.abs(tx - bx) < W * 0.3 && ++tries < 40);
  vx = (tx - bx) / (2 * -vy / gravity());
  paddleW = Math.max(PAD_W * 0.65, PAD_W * (1 - score * 0.008));
}

function updatePaddle(dt) {
  let target = W / 2;
  const m = LINE_X0 + paddleW / 2, M = LINE_X1 - paddleW / 2;
  if (micOK) { if (paddleT !== null) target = m + paddleT * (M - m); }
  else if (pointerX !== null) target = pointerX;
  const pm = mode === 'sing' ? SING_PADDLE_MUL : Math.pow(speedMul(), PADDLE_SPEED_SCALE);
  let step = (target - paddleX) * (1 - Math.exp(-dt * PADDLE_FOLLOW * pm));
  const cap = W * PADDLE_MAX_SPEED * pm * dt;
  step = Math.max(-cap, Math.min(cap, step));
  paddleX = Math.max(m, Math.min(M, paddleX + step));
}

function updateBall(dt, now) {
  squash = Math.max(0, squash - dt * 3);
  if (state === 'countdown') {
    bx = W / 2; by = restY();
    if (now >= countdownEnd) launch();
    return;
  }
  if (state === 'sink') {                             // 在水里慢慢沉下去
    vy += (70 - vy) * Math.min(1, dt * 4); vx *= Math.pow(0.15, dt);
    bx += vx * dt; by += vy * dt;
    if (now - sinkAt > 1000) showResult(now);
    return;
  }
  if (state === 'result') return;                     // 结算后录制照常继续，直到用户手动停止或点 Retry
  if (state !== 'play') return;

  dt *= score === 0 ? 0.8 : speedMul();               // 第一球慢一点
  const steps = 4, h = dt / steps, g = gravity();
  for (let i = 0; i < steps; i++) {
    const prevBottom = by + R;
    vy += g * h;
    bx += vx * h; by += vy * h;
    if (bx - R < SIDE) { bx = SIDE + R; vx = Math.abs(vx) * 0.9; }
    if (bx + R > W - SIDE) { bx = W - SIDE - R; vx = -Math.abs(vx) * 0.9; }
    if (by - R < 56 && vy < 0) { by = 56 + R; vy = Math.abs(vy) * 0.5; }
    if (vy > 0) {
      const bottom = by + R;
      if (prevBottom <= PAD_Y + 4 && bottom >= PAD_Y && Math.abs(bx - paddleX) <= paddleW / 2 + R * 0.35) {
        by = PAD_Y - R;
        bounce();
      }
    }
  }
  const surf = waveY(1, bx, now / 1000);
  if (vy > 0 && by > surf + 4) {                      // 没接住：掉进水里
    splash(bx, surf);
    playSfx('splash', 0.8);
    state = 'sink'; sinkAt = now; vy *= 0.25;
  }
}

// =====================================================================
// 绘制（这一层会被录进视频）
// =====================================================================
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const FONT = '700 14.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';

// 设计稿文字样式：Poppins 粗斜体，白字 + 黑描边（描边只露在字外面，所以线宽是外露宽度的两倍）
const UI_FONT = 'italic 800 20px Poppins, "Arial Rounded MT Bold", -apple-system, sans-serif';
function outlineText(text, x, y, font, out, fill = '#fff', shadow = null) {
  ctx.save();
  ctx.font = font; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  if (shadow) {                                      // 硬投影：整个描边字的形状错开一点
    ctx.fillStyle = ctx.strokeStyle = shadow.c; ctx.lineWidth = out * 2;
    ctx.strokeText(text, x + shadow.dx, y + shadow.dy); ctx.fillText(text, x + shadow.dx, y + shadow.dy);
  }
  ctx.lineWidth = out * 2; ctx.strokeStyle = '#000'; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
  ctx.restore();
}
function drawBox(lines, p, center) {               // 倒计时：提示文字 + 大数字（无底框）
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((t, i) => outlineText(t, 195, BOX.y + 6 + i * 26, UI_FONT, 2));
  if (center) outlineText(center, 195, RING.y + 8, 'italic 800 54px Poppins, "Arial Rounded MT Bold", -apple-system, sans-serif', 4, '#fff', { c: '#25F4EE', dx: 4, dy: 4 });
  ctx.restore();
}

// 屏幕上角的波普网点：不规则的一团，从角落往里越来越小；左右形状不同
const cornerCache = {};
const CORNER = { w: 210, h: 240 };
function cornerDots(color, seed) {
  const key = color + seed;
  if (cornerCache[key]) return cornerCache[key];
  const sc = 3, c = document.createElement('canvas');
  c.width = CORNER.w * sc; c.height = CORNER.h * sc;
  const g = c.getContext('2d');
  g.scale(sc, sc); g.fillStyle = color;
  const islands = seed ? [[148, 22, 28], [24, 170, 26]] : [[140, 26, 26], [22, 162, 28]];
  for (let y = 3, row = 0; y <= CORNER.h; y += 7.4, row++) for (let x = 3 + (row % 2 ? 4.25 : 0); x <= CORNER.w; x += 8.5) {
    const th = Math.atan2(y, x);
    const edge = 1 + 0.09 * Math.sin(4 * th + seed * 2.1 + 1) + 0.04 * Math.sin(9 * th + seed * 3.7 + 2);
    let k = (1 - Math.hypot(x / 150, y / 165) / edge);        // 主体：贴着角落的不规则一团
    for (const [ix, iy, ir] of islands) k = Math.max(k, 0.42 * (1 - Math.hypot(x - ix, y - iy) / ir));   // 旁边几小团
    const r = 3.3 * Math.pow(Math.max(0, k), 0.75);
    if (r < 0.45) continue;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return (cornerCache[key] = c);
}
function drawCorners() {
  ctx.save();
  rr(0, 0, W, H, 20); ctx.clip();                      // 跟屏幕/摄像头画面的圆角一致
  ctx.globalAlpha = 0.75;
  ctx.drawImage(cornerDots('#FF2E93', 0), 0, 0, CORNER.w, CORNER.h);
  ctx.translate(W, 0); ctx.scale(-1, 1);
  ctx.drawImage(cornerDots('#25F4EE', 1), 0, 0, CORNER.w, CORNER.h);
  ctx.restore();
}
// 顶部实时记分板：奶白胶囊 + 黑描边 + 蓝色错位阴影，得分时弹一下
let hudScore = -1, hudPopAt = 0;
// ?debug：左上角显示实时音高，方便排查“低音够不到左边”
const DEBUG = /[?&]debug\b/.test(location.search);
const dbgTrail = [];
function drawDebug() {
  const semi = pitchHz > 0 ? (Math.log2(pitchHz) - centerLog) * 12 : null;
  dbgTrail.push(semi); if (dbgTrail.length > 180) dbgTrail.shift();
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(8, 90, 200, 120);
  ctx.fillStyle = '#fff'; ctx.font = '12px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`Hz ${pitchHz > 0 ? pitchHz.toFixed(0) : '-'}  semi ${semi === null ? '-' : semi.toFixed(1)}`, 14, 106);
  ctx.fillText(`center ${Math.pow(2, centerLog).toFixed(0)}Hz  t ${paddleT === null ? '-' : paddleT.toFixed(2)}`, 14, 122);
  // 轨迹：上 = 高（+11），下 = 低（-3.5）
  const y0 = 132, h = 72, yOf = v => y0 + h * (RANGE.up - Math.max(-RANGE.down - 2, Math.min(RANGE.up + 2, v))) / (RANGE.up + RANGE.down + 4);
  ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.moveTo(14, yOf(0)); ctx.lineTo(202, yOf(0)); ctx.stroke();
  ctx.strokeStyle = '#25F4EE'; ctx.beginPath(); let pen = false;
  dbgTrail.forEach((v, i) => { const x = 14 + i * (188 / 180); if (v === null) { pen = false; return; } pen ? ctx.lineTo(x, yOf(v)) : ctx.moveTo(x, yOf(v)); pen = true; });
  ctx.stroke(); ctx.restore();
}
function drawHud(now) {
  if (!['countdown', 'play', 'sink', 'sing'].includes(state)) { hudScore = -1; return; }
  if (score !== hudScore) { if (hudScore >= 0 && score > hudScore) hudPopAt = now; hudScore = score; }
  const pop = 1 + 0.28 * Math.exp(-(now - hudPopAt) / 110) * (now - hudPopAt < 600 ? 1 : 0);
  const num = String(score);
  ctx.save();
  ctx.font = `30px ${POP_FONT}`;
  const nw = ctx.measureText(num).width;
  ctx.font = 'italic 800 14px Poppins, "Arial Rounded MT Bold", -apple-system, sans-serif';
  const lw = ctx.measureText('Score').width;
  const w = 18 + lw + 10 + nw + 18, h = 40, x0 = -w / 2, y0 = -h / 2;
  ctx.translate(195, 46); ctx.rotate(-0.03); ctx.scale(pop, pop);
  rr(x0 + 4, y0 + 4, w, h, h / 2); ctx.fillStyle = '#2F6BFF'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = POP.K; ctx.stroke();
  rr(x0, y0, w, h, h / 2); ctx.fillStyle = '#FFFBEA'; ctx.fill(); ctx.stroke();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  outlineText('Score', x0 + 18, 1, 'italic 800 14px Poppins, "Arial Rounded MT Bold", -apple-system, sans-serif', 2);
  const nx = x0 + 18 + lw + 10;
  ctx.font = `30px ${POP_FONT}`; ctx.lineJoin = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = POP.K;
  ctx.fillStyle = POP.R; ctx.strokeText(num, nx + 2.5, 3.5); ctx.fillText(num, nx + 2.5, 3.5);
  ctx.strokeText(num, nx, 1); ctx.fillStyle = POP.Y; ctx.fillText(num, nx, 1);
  ctx.restore();
}

function draw(now) {
  const k = S * DPR;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (screen !== 'rec' && screen !== 'paused') return;
  if (fx.shake > 0) {                  // 震屏（只震游戏层）
    const m = 7 * fx.shake * fx.shake;
    ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
  }

  if (screen === 'rec' && state === 'countdown') {
    const left = Math.max(0, (countdownEnd - now) / 1000);
    drawBox(['Change your voice', 'pitch to move the', 'paddle'], left / 3, String(Math.max(1, Math.ceil(left))));
  }

  const tw = now / 1000;
  drawCorners();                                     // 上角波普网点（最底层）
  if (mode === 'sing') drawBand(now);                 // 唱歌版：波普乐队舞台
  else { drawWave(0, tw); drawWave(1, tw); }          // 声控版：波普海浪

  // Low / High 轨道
  ctx.save();
  const lx0 = LINE_X0 + 3, lx1 = LINE_X1 - 4;          // 粉→青渐变线 + 上沿白线 + 两端白点
  const lg = ctx.createLinearGradient(lx0, 0, lx1, 0);
  lg.addColorStop(0, '#FE2C55'); lg.addColorStop(1, '#25F4EE');
  ctx.fillStyle = lg; ctx.fillRect(lx0, LINE_Y, lx1 - lx0, 4);
  ctx.fillStyle = '#fff'; ctx.fillRect(lx0, LINE_Y - 1, lx1 - lx0, 2);
  [lx0, lx1].forEach(x => { ctx.beginPath(); ctx.arc(x, LINE_Y + 2, 5, 0, Math.PI * 2); ctx.fill(); });
  ctx.textBaseline = 'middle';
  const LH_FONT = 'italic 800 14.5px Poppins, "Arial Rounded MT Bold", -apple-system, sans-serif';
  ctx.textAlign = 'left'; outlineText('Low', LINE_X0 - 2, LINE_Y + 30, LH_FONT, 1, '#fff', { c: '#FE2C55', dx: -1, dy: 2 });
  ctx.textAlign = 'right'; outlineText('High', LINE_X1, LINE_Y + 30, LH_FONT, 1, '#fff', { c: '#25F4EE', dx: -1, dy: 2 });
  ctx.restore();

  drawFxBack();

  // 板子（黑色胶囊）：被砸时压扁 + 霓虹描边
  {
    const sq = fx.pad, pw = paddleW * (1 + 0.08 * sq), ph = PAD_H * (1 - 0.22 * sq);
    const px = paddleX - pw / 2, py = PAD_Y + (PAD_H - ph) / 2 + 3 * sq;
    ctx.fillStyle = '#000';
    rr(px, py, pw, ph, ph / 2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();   // 白色细描边
    if (fx.glow > 0) {                               // 波普描边：品红错位 + 黄色粗边
      ctx.save();
      ctx.globalAlpha = Math.min(1, fx.glow * 1.6);
      ctx.lineWidth = 4;
      ctx.strokeStyle = POP.M; rr(px + 3, py + 3, pw, ph, ph / 2); ctx.stroke();
      ctx.strokeStyle = POP.Y; rr(px, py, pw, ph, ph / 2); ctx.stroke();
      ctx.restore();
    }
  }

  if (screen === 'rec' && mode === 'sing' && state === 'sing' && song) drawSingUI(now);

  // 表情
  if (screen === 'rec' && (state === 'countdown' || state === 'play' || state === 'sink' || state === 'sing')) {
    const im = faces[faceIdx];
    if (im.complete && im.naturalWidth) {
      const sc = FACE / Math.max(im.naturalWidth, im.naturalHeight);
      const w = im.naturalWidth * sc, h = im.naturalHeight * sc;
      const wob = 0.3 * squash * Math.cos((1 - squash) * Math.PI * 3);   // 弹性果冻感
      const sx = 1 + wob, sy = 1 - wob;
      ctx.save();
      ctx.translate(bx, by);
      if (state === 'sink') {
        const k = Math.min(1, (now - sinkAt) / 1000);
        ctx.globalAlpha = 1 - k * 0.8;
        ctx.rotate(Math.sin(now / 140) * 0.25 * (1 - k));
      }
      ctx.scale(sx, sy);
      ctx.drawImage(im, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
  if (mode === 'sing') drawKeys(now);                 // 最前面一排琴键盖住掉下去的表情
  else drawWave(2, tw);                               // 最前面一层浪盖住沉下去的表情
  drawSplashFx(tw);
  drawFxFront();
  if (screen === 'rec') drawHud(now);                 // 顶部实时记分板
  if (DEBUG) drawDebug();
  if (state === 'result') drawResult(now);
  // Retry 按钮：结算气泡出现后从气泡下面弹出来
  const showRetry = state === 'result' && now - resultAt > 900;
  if (showRetry !== (retryBtn.style.display === 'block')) retryBtn.style.display = showRetry ? 'block' : 'none';
  if (showRetry) retryBtn.style.top = (BOX.y + 22 + 100) + 'px';
}

// =====================================================================
// 主循环
// =====================================================================
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(1 / 30, (now - lastT) / 1000);
  lastT = now;
  try {
    updatePitch(now);
    if (screen === 'rec' || screen === 'paused') {
      updatePaddle(dt);
      if (screen === 'rec') {
        if (state === 'sing') { squash = Math.max(0, squash - dt * 3); updateSing(now); }
        else updateBall(dt, now);
        updateFx(dt);
        updateWater(dt);
        recElapsed += dt;
        if (recElapsed >= recLimit) { recElapsed = recLimit; endRound(); }
      }
      updateRecUI();
    }
    draw(now);
    if (screen === 'rec' && recorder) drawRecFrame();
  } catch (e) { console.error(e); }
  requestAnimationFrame(loop);
}

// 没有麦克风时：手指拖动板子
stage.addEventListener('pointermove', e => { if (screen === 'rec' && !micOK) pointerX = (e.clientX - stage.getBoundingClientRect().left) / S; });
window.addEventListener('pointerup', () => { pointerX = null; });

// 自动化测试用：网址带 ?qa 时把内部状态暴露给 tests/ 里的脚本（正常游玩不受影响）
if (/[?&]qa\b/.test(location.search)) {
  window.__qa = {
    get: () => ({ screen, state, score, mode, bx, by, vx, vy, paddleX, paddleW, PAD_Y, rec: recorder && recorder.state, recElapsed,
      song: !!song, micOK, micAEC, H, S, pitchHz, centerLog, paddleT, retry: retryBtn.style.display, err: errEl.style.display === 'block' ? errEl.textContent : '' }),
    setPointer: x => { pointerX = x; }, actions, selectFx,
    landX: () => {                                   // 预测这一球落到板子高度时的 x（含撞墙反弹）
      const g = gravity(), d = PAD_Y - R - by, t = (-vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * d))) / g;
      let x = bx + vx * t; const lo = SIDE + R, hi = W - SIDE - R;
      for (let i = 0; i < 4; i++) { if (x < lo) x = 2 * lo - x; if (x > hi) x = 2 * hi - x; }
      return x;
    },
  };
}

const mediaReady = initMedia().catch(e => {
  errEl.textContent = e.message || String(e);
  errEl.style.display = 'block';
  setTimeout(() => { errEl.style.display = 'none'; }, 7000);
});
errEl.addEventListener('click', () => { errEl.style.display = 'none'; });   // 点一下提示就收起

async function refreshMedia() {
  layout();
  const st = cam.srcObject, vt = st && st.getVideoTracks()[0];
  if (vt && vt.readyState === 'live') { cam.srcObject = null; cam.srcObject = st; }
  else {
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
      cam.srcObject = new MediaStream(ns.getVideoTracks());
    } catch {}
  }
  cam.play().catch(() => {});
  if (micTrack && micTrack.readyState === 'ended') setupMic(micAEC, true);
  setTimeout(layout, 300);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  if (document.hidden && screen === 'rec') endRound();
  if (!document.hidden) refreshMedia();
});
window.addEventListener('pageshow', () => refreshMedia());

window.addEventListener('resize', layout);
layout();
renderCarousel();
setScreen('camera');
selectTab(tabs.querySelector('span[data-d="60"]'));
if (document.fonts) document.fonts.ready.then(() => selectTab(tabs.querySelector('span.on')));
requestAnimationFrame(loop);
})();
