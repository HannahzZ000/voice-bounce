// 测试公共工具：用 Headless Chrome 打开游戏，假摄像头 + 可控音高的假麦克风
// 环境变量：BASE_URL（默认 http://localhost:3000/）、CHROME_PATH（默认 macOS 的 Chrome）
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const BASE = process.env.BASE_URL || 'http://localhost:3000/';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
function done() {
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

// opts: w/h 视口；audio/video=false 模拟拒绝授权；noMedia 模拟没有 mediaDevices（非 HTTPS）；center 预设中心音高 Hz
async function open(opts = {}) {
  const { w = 390, h = 844, audio = true, video = true, noMedia = false, center = 220, wave } = opts;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.evaluateOnNewDocument((audio, video, noMedia, center, wave) => {
    localStorage.clear();
    if (center) localStorage.setItem('vb_center3', String(Math.log2(center)));
    if (noMedia) { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }); return; }
    navigator.mediaDevices.getUserMedia = async c => {
      if ((c.audio && !audio) || (c.video && !video)) throw new DOMException('denied', 'NotAllowedError');
      const tracks = [];
      if (c.video) {
        const cv = document.createElement('canvas'); cv.width = 72; cv.height = 128; const g = cv.getContext('2d');
        setInterval(() => { g.fillStyle = '#a77'; g.fillRect(0, 0, 72, 128); }, 33);
        tracks.push(...cv.captureStream(30).getVideoTracks());
      }
      if (c.audio) {
        // 假嗓音：可设谐波（wave）模拟手机麦克风收到的弱基频人声
        const ac = new AudioContext(), o = ac.createOscillator(), gn = ac.createGain(), d = ac.createMediaStreamDestination();
        if (wave) { const re = new Float32Array(wave.length + 1), im = new Float32Array(wave.length + 1); wave.forEach((v, i) => { im[i + 1] = v; }); o.setPeriodicWave(ac.createPeriodicWave(re, im)); }
        else o.type = 'sawtooth';
        gn.gain.value = 0; o.connect(gn); gn.connect(d); o.start();
        window.__setVoice = f => { if (f) { o.frequency.setValueAtTime(f, ac.currentTime); gn.gain.value = 0.2; } else gn.gain.value = 0; };
        tracks.push(...d.stream.getAudioTracks());
      }
      return new MediaStream(tracks);
    };
  }, audio, video, noMedia, center, wave || null);
  await page.goto(BASE + '?qa', { waitUntil: 'domcontentloaded' });
  await wait(1800);
  const qa = () => page.evaluate(() => window.__qa.get());
  const act = a => page.evaluate(a => window.__qa.actions[a](), a);
  const voice = f => page.evaluate(f => window.__setVoice && window.__setVoice(f), f);
  // 像手指一样点某个可见元素的中心
  const tap = async sel => {
    const r = await page.evaluate(s => {
      const e = [...document.querySelectorAll(s)].find(e => getComputedStyle(e).display !== 'none');
      if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, sel);
    if (!r) throw new Error('not visible: ' + sel);
    await page.touchscreen.tap(r.x, r.y);
  };
  const realErrors = () => errors.filter(e => !/404|Failed to load resource/.test(e));
  return { browser, page, qa, act, voice, tap, realErrors };
}

module.exports = { open, wait, check, done, OUT };
