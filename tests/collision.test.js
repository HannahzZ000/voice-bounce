// 碰撞判定：一个“完美玩家”（手指拖到预测落点）必须能一路接到 40 分（含最高速度）；故意躲开必须掉水
const { open, wait, check, done } = require('./lib');
(async () => {
  for (let run = 1; run <= 2; run++) {
    const { browser, page, qa, act } = await open({ audio: false });
    await act('record');
    await page.evaluate(() => setInterval(() => { const q = window.__qa, g = q.get(); if (g.state === 'play') q.setPointer(q.landX()); }, 8));
    let g; const t0 = Date.now();
    while (Date.now() - t0 < 75000) { await wait(500); g = await qa(); if (g.state !== 'play' && g.state !== 'countdown' || g.score >= 40) break; }
    check(g.score >= 40, `run ${run}: perfect player reaches 40`, `score ${g.score}, state ${g.state}`);
    await browser.close();
  }
  const { browser, page, qa, act } = await open({ audio: false });
  await act('record'); await page.evaluate(() => window.__qa.setPointer(30));   // 第一球往右落，板子守在最左
  await wait(6500);
  const g = await qa();
  check(g.state === 'result' && g.score === 0, 'missing the ball → falls in → result', `${g.state} score ${g.score}`);
  await browser.close();
  done();
})();
