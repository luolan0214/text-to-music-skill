// 用法：node render.cjs <歌的 index.html 路径> [--check]
//   --check  只做自检（每段音量、是否爆音、有无报错），不出视频
//   不带参数 逐帧渲染 + 合成，输出 <同目录>/<曲名>.mp4（1080×1440，30fps）
// 逐帧渲染而不是录屏：不掉帧，画质稳定，也不需要人守着。
const path = require('path'), fs = require('fs'), os = require('os'), { spawn } = require('child_process');

function loadPlaywright() {
  const tries = ['playwright', path.join(process.cwd(), 'node_modules/playwright'), path.join(__dirname, 'node_modules/playwright'), path.join(__dirname, '..', 'node_modules/playwright'), path.join(__dirname, '..', '..', 'node_modules/playwright')];
  for (const t of tries) { try { return require(t); } catch {} }
  console.error('找不到 playwright。在任意目录运行 npm i playwright 后，从那个目录执行本脚本。'); process.exit(1);
}

(async () => {
  const html = path.resolve(process.argv[2] || ''), checkOnly = process.argv.includes('--check');
  if (!fs.existsSync(html)) { console.error('找不到文件：' + html); process.exit(1); }
  const { chromium } = loadPlaywright();
  const br = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await br.newPage(); const errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  pg.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await pg.goto('file://' + encodeURI(html));
  await pg.waitForFunction(() => window.__song, null, { timeout: 15000 }).catch(() => {});
  if (errors.length || !(await pg.evaluate(() => !!window.__song))) { console.error('页面报错：\n' + errors.join('\n')); await br.close(); process.exit(1); }

  const report = await pg.evaluate(() => window.__check());
  console.log(JSON.stringify(report, null, 2));
  if (report.nan) console.log('⚠️ 有无效采样（NaN），某个乐器参数写错了');
  if (report.peak > 1) console.log(`⚠️ 爆音：峰值 ${report.peak}，把 volume 调到 ${(0.95 / report.peak).toFixed(2)} 倍左右`);
  if (checkOnly) { await br.close(); return; }

  const { title, TOTAL } = await pg.evaluate(() => window.__song);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'song-')), wav = path.join(tmp, 'audio.wav'), out = path.join(path.dirname(html), title + '.mp4');
  const b64 = await pg.evaluate(async () => { const u8 = await window.__wav(); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); });
  fs.writeFileSync(wav, Buffer.from(b64, 'base64'));

  const fps = 30, N = Math.ceil(TOTAL * fps);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-i', wav,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '15', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < N; i++) {
    const f = await pg.evaluate(t => { window.__draw(t, false); return document.getElementById('c').toDataURL('image/jpeg', 0.97).slice(23); }, i / fps);
    if (!ff.stdin.write(Buffer.from(f, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
  await br.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`完成：${out}（${N} 帧，${TOTAL.toFixed(1)} 秒）`);
})();
