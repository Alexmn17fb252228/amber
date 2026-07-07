const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 8767;
const DIR = '/Users/zhangdayu/Documents/vs_code/meizi/Clementine/tools/凌晨自控';

let failures = 0, passes = 0;
function fail(n, d) { failures++; console.log(`  ❌ ${n}: ${d}`); }
function pass(n) { passes++; console.log(`  ✅ ${n}`); }

const server = http.createServer((req, res) => {
  let fp = path.join(DIR, req.url === '/' ? 'index.html' : req.url);
  try { res.end(fs.readFileSync(fp)); } catch(e) { res.writeHead(404); res.end(); }
});

(async () => {
  server.listen(PORT);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  async function toastText() {
    return page.evaluate(() => {
      const t = document.getElementById('toast');
      return t.classList.contains('show') ? t.textContent : null;
    });
  }

  async function injectAndReload(data) {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(300);
    await page.evaluate((d) => { localStorage.setItem('liming_zikong', JSON.stringify(d)); }, data);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(1200);
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
  const todayKey = new Date().toISOString().slice(0, 10);

  // Test 1: consecutive 6 → today login → should hit 7
  console.log('\nTest 1: 连续6天→今天登录→触发7天庆祝');
  await injectAndReload({ v:2, log:{ [todayKey]:{urge:0,memos:0,erp:0,restructure:0} }, memos:[], consecutiveDays:6, lastCheckin:yesterday, date:todayKey });
  const t1 = await toastText();
  if (t1 && t1.includes('7 天')) pass('7天里程碑: ' + t1);
  else fail('7天里程碑', t1 ? '内容='+t1 : '未弹出');

  // Test 2: non-milestone day
  console.log('\nTest 2: 连续5天→不应弹toast');
  await injectAndReload({ v:2, log:{ [todayKey]:{urge:0,memos:0,erp:0,restructure:0} }, memos:[], consecutiveDays:5, lastCheckin:yesterday, date:todayKey });
  const t2 = await toastText();
  if (!t2) pass('非里程碑日无toast');
  else fail('非里程碑日', '弹出了: '+t2);

  // Test 3: gap >1 day resets, no toast
  console.log('\nTest 3: 连续6天但间隔2天→重置为1无toast');
  await injectAndReload({ v:2, log:{ [todayKey]:{urge:0,memos:0,erp:0,restructure:0} }, memos:[], consecutiveDays:6, lastCheckin:twoDaysAgo, date:todayKey });
  const t3 = await toastText();
  const dayCount = await page.evaluate(() => document.getElementById('stat-days').textContent);
  if (!t3 && dayCount === '1') pass('间隔断档→重置为1无toast');
  else fail('间隔断档', `toast=${t3} days=${dayCount}`);

  // Test 4: Day 30 milestone
  console.log('\nTest 4: 连续29天→触发30天庆祝');
  await injectAndReload({ v:2, log:{ [todayKey]:{urge:0,memos:0,erp:0,restructure:0} }, memos:[], consecutiveDays:29, lastCheckin:yesterday, date:todayKey });
  const t4 = await toastText();
  if (t4 && t4.includes('30 天')) pass('30天里程碑: ' + t4);
  else fail('30天里程碑', t4 ? '内容='+t4 : '未弹出');

  console.log(`\n${'='.repeat(40)}`);
  console.log(`✅ ${passes}  ❌ ${failures}`);
  console.log('='.repeat(40));

  await browser.close();
  server.close();
  process.exit(failures > 0 ? 1 : 0);
})();
