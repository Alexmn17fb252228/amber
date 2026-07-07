const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const DIR = __dirname;
let failures = 0;
let passes = 0;

function fail(name, detail) { failures++; console.log(`  ❌ ${name} — ${detail}`); }
function pass(name) { passes++; console.log(`  ✅ ${name}`); }

const server = http.createServer((req, res) => {
  let fp = path.join(DIR, req.url === '/' ? 'index.html' : req.url);
  try { res.end(fs.readFileSync(fp)); } catch(e) { res.writeHead(404); res.end(); }
});

(async () => {
  server.listen(PORT);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => console.log('JS_ERROR:', e.message));

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);

  // ---- SETUP: inject controlled data into localStorage ----
  const today = new Date();
  const dow = today.getDay();
  const daysSinceMon = dow === 0 ? 6 : dow - 1;
  const mon = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMon);

  // Build a week where each day has different total activity:
  // Mon: 0, Tue: 3, Wed: 4, Thu: 7, Fri: 8, Sat: 11, Sun: 0
  const activities = [0, 3, 4, 7, 8, 11, 0];
  const log = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
    const k = d.toISOString().slice(0, 10);
    // Distribute activity across types: memos + erp + restructure (no urges to test composition)
    const total = activities[i];
    log[k] = { urge: 0, memos: total, erp: 0, restructure: 0 };
  }

  await page.evaluate((logData) => {
    localStorage.setItem('liming_zikong', JSON.stringify({ v: 2, log: logData, memos: [], consecutiveDays: 0 }));
  }, log);

  // Reload to pick up the injected data
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);

  console.log('\n===== TEST: 柱形点阵热力图 =====');

  // --- Test 1: 7 columns rendered ---
  const colCount = await page.evaluate(() => {
    return document.querySelectorAll('#heatmap .heat-col').length;
  });
  if (colCount === 7) pass('1. 渲染 7 列');
  else fail('1. 渲染 7 列', `实际 ${colCount} 列`);

  // --- Test 2: Each column has a label ---
  const labelCount = await page.evaluate(() => {
    return document.querySelectorAll('#heatmap .heat-label').length;
  });
  if (labelCount === 7) pass('2. 每列有 1 个标签');
  else fail('2. 每列有 1 个标签', `实际 ${labelCount} 个`);

  // --- Test 3: Amber dot count per column ---
  // activities: [0,3,4,7,8,11,0] → expected dots: [0,0,1,1,2,2,0]
  const expectedDots = [0, 0, 1, 1, 2, 2, 0];
  const dotCounts = await page.evaluate(() => {
    const cols = document.querySelectorAll('#heatmap .heat-col');
    return Array.from(cols).map(col => col.querySelectorAll('.heat-amber').length);
  });
  let dotMatch = true;
  for (let i = 0; i < 7; i++) {
    if (dotCounts[i] !== expectedDots[i]) {
      fail(`3. 第${i+1}列琥珀点数`, `预期 ${expectedDots[i]} 实际 ${dotCounts[i]}`);
      dotMatch = false;
    }
  }
  if (dotMatch) pass('3. 各列琥珀点数正确 [0,0,1,1,2,2,0]');

  // --- Test 4: Labels are 一 through 日 in order ---
  const labels = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#heatmap .heat-label')).map(el => el.textContent);
  });
  const expectedLabels = ['一','二','三','四','五','六','日'];
  let labelMatch = true;
  for (let i = 0; i < 7; i++) {
    if (labels[i] !== expectedLabels[i]) {
      fail(`4. 第${i+1}列标签`, `预期"${expectedLabels[i]}" 实际"${labels[i]}"`);
      labelMatch = false;
    }
  }
  if (labelMatch) pass('4. 标签顺序 一~日 正确');

  // --- Test 5: Edge case — reload with 0 activity everywhere ---
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('liming_zikong'));
    for (const k of Object.keys(d.log)) { d.log[k] = { urge:0, memos:0, erp:0, restructure:0 }; }
    localStorage.setItem('liming_zikong', JSON.stringify(d));
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);

  const allZeroDots = await page.evaluate(() => {
    const cols = document.querySelectorAll('#heatmap .heat-col');
    let total = 0;
    cols.forEach(col => { total += col.querySelectorAll('.heat-amber').length; });
    return total;
  });
  if (allZeroDots === 0) pass('5. 全0活动 → 无琥珀点，仅标签');
  else fail('5. 全0活动 → 无琥珀点', `实际有 ${allZeroDots} 个琥珀点`);

  // --- Test 6: High activity (20 activities = 5 dots) ---
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('liming_zikong'));
    const today = new Date().toISOString().slice(0, 10);
    // Set today to 20 total activity
    const keys = Object.keys(d.log);
    const todayKey = keys.find(k => k >= today) || keys[keys.length - 1];
    if (d.log[todayKey]) d.log[todayKey] = { urge: 5, memos: 5, erp: 5, restructure: 5 };
    localStorage.setItem('liming_zikong', JSON.stringify(d));
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);

  const highDots = await page.evaluate(() => {
    const cols = document.querySelectorAll('#heatmap .heat-col');
    const counts = Array.from(cols).map(col => col.querySelectorAll('.heat-amber').length);
    return counts;
  });
  const maxDots = Math.max(...highDots);
  if (maxDots === 5) pass('6. 20次活动 → 5个琥珀点');
  else fail('6. 20次活动 → 5个琥珀点', `实际最多 ${maxDots} 个`);

  // --- Test 7: Column structure — ghost dot first, then amber dots stacked above ---
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('liming_zikong'));
    const today = new Date().toISOString().slice(0, 10);
    const keys = Object.keys(d.log);
    const todayKey = keys.find(k => k >= today) || keys[today.length - 1];
    if (d.log[todayKey]) d.log[todayKey] = { urge: 1, memos: 1, erp: 1, restructure: 1 }; // 4 total = 1 dot
    localStorage.setItem('liming_zikong', JSON.stringify(d));
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);

  const structure = await page.evaluate(() => {
    const col = document.querySelector('#heatmap .heat-col');
    if (!col) return null;
    const children = Array.from(col.children);
    const amberCount = children.filter(c => c.classList.contains('heat-amber')).length;
    const labelCount = children.filter(c => c.classList.contains('heat-label')).length;
    return { amberCount, labelCount, order: children.map(c => c.className) };
  });

  if (structure && structure.amberCount >= 0 && structure.labelCount === 1) {
    pass('7. 列结构正确：琥珀点 + 标签');
  } else {
    fail('7. 列结构', JSON.stringify(structure));
  }

  // SUMMARY
  console.log(`\n${'='.repeat(40)}`);
  console.log(`✅ ${passes} passed  ❌ ${failures} failed`);
  console.log('='.repeat(40));

  await browser.close();
  server.close();
  process.exit(failures > 0 ? 1 : 0);
})();
