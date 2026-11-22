const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

if (process.argv.length !== 3) throw new Error('Usage: node build-deck.cjs <new-source-directory>');
const target = path.resolve(process.argv[2]);
const scope = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'fixture-data.js'), 'utf8'), scope, { timeout: 1000 });
const git = scope.window.GIT_FIXTURE;
const ink = '152522', paper = 'F4F1E5', lime = 'DCE89D', soft = 'CBD8CD', darkLine = '5C7065';
const rust = '812F29', green = '2F511E', lightLine = '9EAA98';
const size = [960, 540];
const txt = (value, x, y, w, h, fontSize, color = ink, bold = false, fontFace = 'Arial') =>
  ({ type: 'text', value, box: [x, y, w, h], fontSize, color, bold, fontFace });
const rect = (x, y, w, h, fill) => ({ type: 'rect', box: [x, y, w, h], fill });
const mono = (value, x, y, w, color, fontSize = 14) => txt(value, x, y, w, 26, fontSize, color, true, 'Courier New');

const snapshots = [
  { id: '01', name: 'Working tree', line: git.working },
  { id: '02', name: 'Staging area', line: git.stage },
  { id: '03', name: 'Last commit', line: git.head },
];
const slide1 = [
  mono('GIT FIELD NOTES  /  01', 54, 34, 420, lime),
  rect(54, 66, 852, 1, darkLine),
  txt('Before you commit.', 51, 86, 856, 86, 68, paper, false, 'Georgia'),
  txt('Three versions of field-note.txt', 54, 188, 780, 35, 25, soft),
  rect(54, 247, 852, 214, paper),
  ...snapshots.flatMap(({ id, name, line }, i) => {
    const y = 247 + i * 71;
    return [
      ...(i === 1 ? [rect(54, y, 852, 71, 'E7EDC6'), rect(54, y, 5, 71, '728642')] : []),
      ...(i > 0 ? [rect(54, y, 852, 1, lightLine)] : []),
      mono(id, 77, y + 25, 42, green),
      txt(name, 129, y + 21, 250, 38, 23, ink, true),
      txt(line, 394, y + 24, 475, 33, 21, ink),
    ];
  }),
  txt('Git saves the staged version in the next commit.', 54, 486, 812, 28, 18, lime),
];

const changes = diff => diff.split('\n').filter(line => /^[+-][^+-]/.test(line));
const staged = changes(git.indexDiff), unstaged = changes(git.workingDiff);
const slide2 = [
  mono('GIT FIELD NOTES  /  02', 54, 34, 400, green),
  rect(54, 66, 852, 1, lightLine),
  txt('Which edit will you save?', 51, 94, 856, 81, 58, ink, false, 'Georgia'),
  txt('The staged diff answers before you hit commit.', 54, 183, 805, 33, 24),
  rect(54, 246, 852, 2, ink),
  rect(479, 246, 1, 165, lightLine),
  mono('LAST COMMIT TO INDEX', 64, 262, 398, green),
  mono('INDEX TO DISK', 502, 262, 400, green),
  txt('Staged', 64, 290, 396, 44, 32, ink, true),
  txt('Unstaged', 502, 290, 400, 44, 32, ink, true),
  mono(staged[0], 64, 349, 405, rust, 17),
  mono(staged[1], 64, 375, 405, green, 17),
  mono(unstaged[0], 502, 349, 400, rust, 17),
  mono(unstaged[1], 502, 375, 400, green, 17),
  rect(54, 435, 852, 57, 'E2EAC1'),
  txt('Check the staged changes with git diff --cached.', 70, 449, 818, 34, 21, ink, true),
];

const specs = [
  { file: '01.html', text: ['Before you commit.', 'Working tree', 'Staging area', 'Last commit', 'Keep this second edit for later.', 'Stage the draft.', 'Edit the field note.'], native: { background: ink, items: slide1 } },
  { file: '02.html', text: ['Which edit will you save?', 'Staged', 'Unstaged', '-Edit the field note.', '+Stage the draft.', '+Keep this second edit for later.', 'git diff --cached'], native: { background: paper, items: slide2 } },
];
const escape = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

fs.mkdirSync(target);
for (const { file, native } of specs) {
  const elements = native.items.map(item => {
    const [x, y, w, h] = item.box;
    const box = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    if (item.type === 'rect') return `<i aria-hidden="true" style="${box};background:#${item.fill}"></i>`;
    return `<span style="${box};color:#${item.color};font:${item.bold ? 700 : 400} ${item.fontSize}px/1.2 '${item.fontFace}'">${escape(item.value)}</span>`;
  }).join('\n');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Git Field Notes</title><style>@page{margin:0}*{box-sizing:border-box}html,body{margin:0;width:${size[0]}px;height:${size[1]}px}body{position:relative;background:#${native.background};print-color-adjust:exact}span,i{display:block;position:absolute;white-space:pre}</style><body>\n${elements}\n</body></html>\n`;
  fs.writeFileSync(path.join(target, file), html, { flag: 'wx' });
}
fs.writeFileSync(path.join(target, 'deck.json'), JSON.stringify({ size, pptx: 'native', title: 'Git Field Notes', slides: specs }, null, 2) + '\n', { flag: 'wx' });
