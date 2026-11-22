const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { assertPassed, cleanup, fixture, run } = require('./test-helpers.cjs');

after(() => cleanup());

test('renders an offline prototype, checks its control, and inspects desktop and phone states', { timeout: 205000 }, async () => {
  const html = String.raw`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#152b2d;color:#f4f0e6;font:16px/1.5 Arial}main{max-width:760px;margin:auto}button{min-height:44px;padding:10px 18px;color:#102b24;background:#c3df9b}.choice{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:20px}.choice article{min-width:0;padding:14px;background:#f4f0e6;color:#182c27}.choice p{overflow-wrap:anywhere}@media(max-width:600px){body{padding:16px}.choice{grid-template-columns:1fr}}</style><main><h1>Local design review</h1><button id="open">Compare three drafts</button><p id="state" role="status">Waiting</p><section id="choices" class="choice" hidden><article>Direction A</article><article>Direction B</article><article>Direction C</article></section><script>document.querySelector('#open').onclick=()=>{document.querySelector('#state').textContent='Drafts ready';document.querySelector('#choices').hidden=false}</script>`;
  const job = fixture('web-prototype', {
    file: 'index.html',
    viewports: [[1440, 900], [375, 812]],
    steps: [{ click: '#open' }, { expect: '#state', text: 'Drafts ready' }, { expect: '#choices article:nth-child(3)', text: 'Direction C', screenshot: true }],
  }, { 'index.html': html });
  const result = await run('web', job, { HUASHU_NODE_MODULES: process.env.HUASHU_NODE_MODULES, HUASHU_CHROMIUM: process.env.HUASHU_CHROMIUM });
  assertPassed(result);
  assert.deepEqual(result.report.checks.viewports.map(view => view.width), [1440, 375]);
  assert.ok(result.report.checks.viewports.every(view => view.interactions === 3));
  assert.ok(result.report.artifacts.filter(file => file.endsWith('.png')).length >= 4);
});
