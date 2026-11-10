// 音高识别：用弱基频的“手机人声”模拟，高 → 低、隔空再低、超低都要到最左；保存的中心偏了也要在两个音内纠正
const { open, wait, check, done } = require('./lib');
const WAVE = [0.3, 1, 0.8, 0.5, 0.4, 0.3, 0.2];
const st = (c, s) => c * Math.pow(2, s / 12);
(async () => {
  {
    const { browser, page, qa, act, voice } = await open({ wave: WAVE, center: 220 });
    await act('record'); await wait(800);
    const hold = async (s, ms) => { await voice(s === null ? 0 : st(220, s)); await wait(ms); return (await qa()).paddleX; };
    await hold(0, 1000);
    const hi = await hold(8, 900);
    const lo = await hold(-4, 900);           // 高音直接滑到低音
    await hold(null, 300); await hold(8, 800); await hold(null, 250);
    const lo2 = await hold(-4, 900);          // 高音后停一下再唱低音
    await hold(null, 300);
    const vlo = await hold(-6, 900);
    check(hi > 260, 'high note → paddle right', Math.round(hi));
    check(lo < 100, 'high → low glide → paddle left', Math.round(lo));
    check(lo2 < 100, 'low after a gap → paddle left', Math.round(lo2));
    check(vlo < 100, 'very low → paddle left', Math.round(vlo));
    await browser.close();
  }
  for (const saved of [150, 400]) {
    const { browser, qa, act, voice } = await open({ wave: WAVE, center: saved });
    await act('record'); await wait(800);
    let x;
    for (let k = 0; k < 3; k++) { await voice(185); await wait(700); x = (await qa()).paddleX; await voice(0); await wait(300); await voice(330); await wait(700); await voice(0); await wait(300); }
    check(x < 110, `saved center ${saved} Hz (wrong) → low reaches left by the 3rd note`, Math.round(x));
    await browser.close();
  }
  done();
})();
