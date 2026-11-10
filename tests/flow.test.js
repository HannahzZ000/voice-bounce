// 模式切换 + 重新开始 + 录制流程（含“点开始录制被误判成停止”的回归测试）
const { open, wait, check, done } = require('./lib');
(async () => {
  const { browser, page, qa, act, tap, realErrors } = await open();
  let g;
  await tap('#ring'); await wait(1000); g = await qa();
  check(g.screen === 'rec' && g.rec === 'recording', 'tap the record ring → recording (not instantly stopped)', `${g.screen}/${g.rec}`);
  await tap('.hp[data-s="rec"][data-a="stop"]'); await wait(1000); g = await qa();
  check(g.screen === 'paused' && g.rec === 'paused', 'tap stop → paused (not instantly resumed)', `${g.screen}/${g.rec}`);
  await tap('.hp[data-s="paused"][data-a="record"]'); await wait(600); g = await qa();
  check(g.screen === 'rec' && g.rec === 'recording', 'tap record again → resumes');
  await page.evaluate(() => window.__qa.setPointer(30));   // 板子守在最左，让球掉水
  await page.evaluate(() => window.__setVoice(0));
  await wait(6500); g = await qa();
  check(g.state === 'result' && g.retry === 'block' && g.rec === 'recording', 'game over shows Retry, recording continues');
  const t1 = g.recElapsed;
  await tap('#retryBtn'); await wait(40); await page.evaluate(() => document.querySelector('#retryBtn').click()); await wait(400); g = await qa();
  check(g.state === 'countdown' && g.score === 0 && g.rec === 'recording' && g.recElapsed > t1, 'Retry (double tap) → fresh round, same recording');
  await act('stop'); await wait(500); await act('discard'); await wait(500); g = await qa();
  check(g.screen === 'camera' && g.rec === null, 'discard → back to camera');
  await page.evaluate(() => window.__qa.selectFx(1)); await act('record'); await wait(1200); g = await qa();
  check(g.mode === 'sing' && g.state === 'sing' && g.song && g.micAEC === true, 'Sing Along: song plays, echo cancellation on');
  await act('stop'); await wait(500); g = await qa();
  check(!g.song, 'stop → accompaniment stops');
  await act('discard'); await wait(500);
  await page.evaluate(() => window.__qa.selectFx(2)); await act('record'); await wait(1200); g = await qa();
  check(g.mode === 'voice' && g.state === 'countdown' && !g.song && g.micAEC === false, 'back to Voice Bounce: no song, echo cancellation off');
  await act('finish'); await wait(1500); g = await qa();
  check(g.screen === 'edit', 'finish → playback screen');
  check(realErrors().length === 0, 'no JS errors', realErrors().join('; '));
  await browser.close();
  done();
})();
