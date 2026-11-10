// 手机适配：不同屏幕下各页面不溢出、关键按钮在屏幕内；截图存到 tests/output/
const { open, wait, check, done, OUT } = require('./lib');
const VPS = [[375, 548, 'iphone-se-safari'], [375, 667, 'iphone-se'], [390, 664, 'iphone13-safari'], [390, 844, 'iphone13'],
  [430, 932, 'iphone-pro-max'], [360, 740, 'android-small'], [412, 915, 'pixel']];
(async () => {
  for (const [w, h, name] of VPS) {
    console.log(`${name} ${w}x${h}`);
    const { browser, page, qa, tap, realErrors } = await open({ w, h, audio: false });
    await page.screenshot({ path: `${OUT}/${name}-camera.png` });
    await tap('#ring'); await wait(1200);
    await page.screenshot({ path: `${OUT}/${name}-countdown.png` });
    await wait(5500);
    const g = await qa();
    const box = await page.evaluate(() => {
      const r = s => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return [b.top, b.bottom, getComputedStyle(e).display]; };
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight, retry: r('#retryBtn'), stop: r('.hp[data-s="rec"][data-a="stop"]') };
    });
    await page.screenshot({ path: `${OUT}/${name}-result.png` });
    check(box.sw <= box.iw, 'no horizontal overflow');
    check(g.screen === 'rec' && g.state === 'result', 'record → miss → result while still recording', `${g.screen}/${g.state}`);
    check(box.retry[2] === 'block' && box.retry[1] <= box.ih, 'Retry visible on screen');
    check(box.stop[1] <= box.ih, 'stop button on screen');
    check(realErrors().length === 0, 'no JS errors', realErrors().join('; '));
    await browser.close();
  }
  const { browser, page } = await open({ w: 844, h: 390 });
  const rot = await page.evaluate(() => getComputedStyle(document.querySelector('#rotate')).display);
  check(rot === 'flex', 'landscape phone shows "turn your phone upright"');
  await browser.close();
  done();
})();
