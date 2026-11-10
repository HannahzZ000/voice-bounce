// 相机 / 麦克风授权：各种拒绝情况下都有提示、能开始游戏、没麦克风时可以手指拖板子
const { open, wait, check, done } = require('./lib');
const CASES = [
  ['all allowed', {}, ''],
  ['mic denied', { audio: false }, 'Microphone'],
  ['camera denied', { video: false }, 'Camera is off'],
  ['both denied', { audio: false, video: false }, 'Microphone'],
  ['no mediaDevices (not HTTPS)', { noMedia: true }, 'not available'],
];
(async () => {
  for (const [name, o, msg] of CASES) {
    console.log(name);
    const { browser, page, qa, act, realErrors } = await open(o);
    const g0 = await qa();
    check(msg ? g0.err.includes(msg) : g0.err === '', msg ? `shows message "${msg}…"` : 'no error message', g0.err.slice(0, 60));
    await act('record'); await wait(1000);
    const g1 = await qa();
    check(g1.screen === 'rec' && g1.state === 'countdown', 'game starts', `${g1.screen}/${g1.state}`);
    if (!g1.micOK) {
      await page.mouse.move(60, 400); await page.mouse.down(); await page.mouse.move(80, 400, { steps: 5 }); await wait(400);
      const g2 = await qa(); await page.mouse.up();
      check(Math.abs(g2.paddleX - 80) < 30, 'finger drag moves the paddle', `paddleX ${Math.round(g2.paddleX)}`);
    }
    check(realErrors().length === 0, 'no JS errors', realErrors().join('; '));
    await browser.close();
  }
  done();
})();
