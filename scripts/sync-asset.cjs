// Compare the JSX as data. Narrow cosmetic edits may change literals inside
// rendered style objects. Element names, calls, handlers and props must match.
const fs = require('node:fs');
const path = require('node:path');
const modules = process.env.HUASHU_NODE_MODULES || path.join(__dirname, '../codex/node_modules');
const { parser, generator, types } = require(path.resolve(modules, '@babel/standalone')).packages;
const styleObjects = new Set(['iosFrameStyles', 'wechatFrameStyles']);
const colorProps = new Set(['color', 'background', 'backgroundColor', 'borderColor', 'fill', 'stroke']);
const spacingProps = new Set(['borderRadius', 'fontSize', 'gap', 'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight']);
const color = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function visit(node, style, shape) {
  if (!node) return;
  const key = node.type === 'ObjectProperty' && !node.computed && (node.key.name || node.key.value);
  if (shape && style && key) {
    if (colorProps.has(key) && types.isStringLiteral(node.value) && color.test(node.value.value)) node.value = types.stringLiteral('#000000');
    if (spacingProps.has(key) && types.isNumericLiteral(node.value) && node.value.value >= 0 && node.value.value <= 128) node.value = types.numericLiteral(0);
  }
  for (const field of types.VISITOR_KEYS[node.type] || []) {
    const children = Array.isArray(node[field]) ? node[field] : [node[field]];
    for (const child of children) {
      const isStyleProp = node.type === 'JSXAttribute' && node.name.name === 'style' && field === 'value';
      const isStyleBinding = node.type === 'VariableDeclarator' && styleObjects.has(node.id.name) && field === 'init';
      const remainsStyle = style && (types.isObjectExpression(node) || types.isObjectProperty(node) || types.isJSXExpressionContainer(node));
      visit(child, isStyleProp || isStyleBinding || remainsStyle, shape);
    }
  }
}

function canonical(source, shape = false) {
  const ast = parser.parse(source, { sourceType: 'script', plugins: ['jsx'], createParenthesizedExpressions: true });
  if (ast.program.interpreter) throw new Error('unexpected script interpreter');
  visit(ast, false, shape);
  return generator.default(ast, { comments: false, compact: false }).code + '\n';
}

const { before, after, installed } = JSON.parse(fs.readFileSync(0, 'utf8'));
if (canonical(before) !== canonical(installed)) {
  console.log(JSON.stringify({ reason: 'The Codex component has its own edits. Compare those before replacing it.' }));
} else if (canonical(before, true) !== canonical(after, true)) {
  console.log(JSON.stringify({ reason: 'The JSX structure or a value outside the allowed color/spacing edits changed.' }));
} else {
  console.log(JSON.stringify({ code: canonical(after) }));
}
