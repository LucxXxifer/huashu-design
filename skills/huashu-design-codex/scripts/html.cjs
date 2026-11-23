const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Problem, check, dependency, localFile } = require('./runtime.cjs');

const vendor = path.join(__dirname, '..', 'assets', 'vendor');
const pins = new Map([
  ['react@18.3.1/umd/react.development.js', 'hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L'],
  ['react-dom@18.3.1/umd/react-dom.development.js', 'u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm'],
  ['react@18.3.1/umd/react.production.min.js', 'DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z'],
  ['react-dom@18.3.1/umd/react-dom.production.min.js', 'gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1'],
]);
const babelUrl = 'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js';
const babelIntegrity = 'sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y';
const mediaTypes = {
  '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.vtt': 'text/vtt',
};
const mediaAttributes = {
  img: ['src', 'srcset'], source: ['src', 'srcset'], video: ['src', 'poster'],
  audio: ['src'], track: ['src'], image: ['href'], use: ['href'],
};
const http = value => /^(?:https?:)?\/\//i.test(value);
const inertUrl = value => /^(data:|blob:|#)/i.test(value);
const text = node => (node.childNodes || []).map(child => child.value || '').join('');
const attr = (node, name) => node.attrs?.find(item => item.name === name);
const typeOf = node => attr(node, 'type')?.value.trim().toLowerCase() ?? '';
const jsxType = type => ['text/babel', 'text/jsx'].includes(type);
const cdn = 'https://unpkg.com/';
const remoteName = src => src.startsWith(cdn) ? src.slice(cdn.length).split(/[?#]/, 1)[0] : '';

function pinnedReact(name) {
  const bytes = fs.readFileSync(path.join(vendor, path.posix.basename(name)));
  check(createHash('sha384').update(bytes).digest('base64') === pins.get(name), `Integrity mismatch for the pinned ${name}.`, 'VENDOR_INTEGRITY');
  return bytes.toString('utf8');
}

function elements(ast) {
  const found = [];
  function visit(node) {
    if (node.tagName) found.push(node);
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  }
  visit(ast);
  return found;
}

function replaceText(node, value) {
  node.childNodes = [{ nodeName: '#text', value, parentNode: node }];
}

function dropAttrs(node, names) {
  node.attrs = node.attrs.filter(item => !names.includes(item.name));
}

function scopedFile(root, base, reference) {
  check(!http(reference) && !/^[a-z][a-z\d+.-]*:/i.test(reference), `External resource cannot be embedded: ${reference}`, 'EXTERNAL_RESOURCE');
  const pathname = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  const relative = pathname.startsWith('/') ? pathname.slice(1) : path.posix.join(path.posix.dirname(base), pathname);
  return { relative, absolute: localFile(root, relative) };
}

function dataUrl(root, base, value) {
  const reference = value.trim();
  if (!reference || inertUrl(reference)) return value;
  const { absolute } = scopedFile(root, base, reference);
  const kind = mediaTypes[path.extname(absolute).toLowerCase()];
  check(kind, `Unsupported offline asset type: ${path.extname(absolute)}.`, 'OFFLINE_ASSET_TYPE');
  check(fs.statSync(absolute).size <= 10 * 1024 * 1024, 'A local offline asset exceeds the 10 MiB per-file limit.', 'OFFLINE_ASSET_SIZE');
  const fragment = reference.includes('#') ? reference.slice(reference.indexOf('#')) : '';
  return `data:${kind};base64,${fs.readFileSync(absolute).toString('base64')}${fragment}`;
}

function rewriteSrcset(value, embed) {
  // A data URL contains commas. Candidate URLs terminate at whitespace or a
  // trailing separator. Preserve descriptors for responsive image selection.
  const candidates = [];
  let remainder = value;
  while ((remainder = remainder.replace(/^[\t\n\f\r ,]+/, ''))) {
    const token = remainder.match(/^[^\t\n\f\r ]+/)[0];
    remainder = remainder.slice(token.length);
    const url = token.replace(/,+$/, '');
    if (url !== token) {
      candidates.push(embed(url));
      continue;
    }
    const separator = remainder.indexOf(',');
    const descriptor = (separator < 0 ? remainder : remainder.slice(0, separator)).trim();
    candidates.push(descriptor ? `${embed(url)} ${descriptor}` : embed(url));
    remainder = separator < 0 ? '' : remainder.slice(separator + 1);
  }
  return candidates.join(', ');
}

function cssValue(value, root, base) {
  const parseValue = dependency('postcss-value-parser');
  const parsed = parseValue(value);
  parsed.walk(node => {
    if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return;
    check(node.nodes.length === 1 && ['word', 'string'].includes(node.nodes[0].type), 'Cannot parse a CSS image or font URL.', 'CSS_URL');
    const target = node.nodes[0].value;
    const embedded = dataUrl(root, base, target);
    if (embedded !== target) node.nodes = [{ type: 'string', quote: '"', value: embedded }];
    return false;
  });
  return parsed.toString();
}

function inlineCss(css, root, base, chain = [base]) {
  const postcss = dependency('postcss');
  let ast;
  try { ast = postcss.parse(css, { from: base }); }
  catch (error) { throw new Problem('CSS_PARSE', `Could not parse ${base}: ${error.reason}`); }
  ast.walkDecls(decl => { decl.value = cssValue(decl.value, root, base); });
  ast.walkAtRules('import', node => {
    const match = node.params.match(/^(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)|"([^"]+)"|'([^']+)')\s*$/i);
    check(match, 'Use plain local CSS imports. Inline conditional imports in the source first.', 'CSS_IMPORT');
    const { absolute, relative } = scopedFile(root, base, match.slice(1).find(Boolean));
    check(!chain.includes(relative) && chain.length < 12, `Recursive or deeply nested CSS import: ${relative}`, 'CSS_IMPORT_CYCLE');
    const imported = inlineCss(fs.readFileSync(absolute, 'utf8'), root, relative, [...chain, relative]);
    node.replaceWith(...postcss.parse(imported).nodes);
  });
  return ast.toString();
}

function compileJsx(source, filename, root, htmlFile, embedAssets) {
  const babel = dependency('@babel/standalone');
  const { types: t } = babel.packages;
  const assets = () => ({ visitor: { JSXAttribute(item) {
    const element = item.parent.name;
    const name = item.node.name.name;
    const value = item.node.value;
    const literal = t.isJSXExpressionContainer(value) ? value.expression : value;
    if (name === 'style' && t.isObjectExpression(literal)) {
      for (const prop of literal.properties) {
        if (t.isObjectProperty(prop) && t.isStringLiteral(prop.value)) prop.value = t.stringLiteral(cssValue(prop.value.value, root, htmlFile));
      }
    }
    if (!t.isJSXIdentifier(element) || !t.isStringLiteral(literal)) return;
    const key = typeof name === 'string' ? name.toLowerCase() : '';
    if (!mediaAttributes[element.name]?.includes(key)) return;
    const embed = value => dataUrl(root, htmlFile, value);
    const rewritten = key === 'srcset' ? rewriteSrcset(literal.value, embed) : embed(literal.value);
    item.node.value = t.jsxExpressionContainer(t.stringLiteral(rewritten));
  } } });
  try {
    return babel.transform(source, {
      filename, sourceType: 'script', ast: false, comments: false, babelrc: false, configFile: false,
      plugins: [...(embedAssets ? [assets] : []), 'transform-react-jsx'],
    }).code;
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw new Problem('JSX_COMPILE', `Could not compile ${filename}: ${error.message.split('\n')[0]}`);
  }
}

function deferScript(source) {
  const encoded = JSON.stringify(source).replace(/</g, '\\u003c');
  return `(()=>{const run=()=>{const script=document.createElement('script');script.textContent=${encoded};document.head.append(script);};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();})();`;
}

function inlineScript(node, source, defer = false) {
  replaceText(node, defer ? deferScript(source) : source.replace(/<\/script/gi, '<\\/script'));
  dropAttrs(node, ['src', 'type', 'integrity', 'crossorigin', 'defer', 'async', 'data-presets', 'data-type']);
}

function rewriteDocument(html, root, htmlFile, { embedAssets = true } = {}) {
  const parse5 = dependency('parse5');
  const ast = parse5.parse(html);
  const nodes = elements(ast);
  let embeddedReact = false;
  for (const node of nodes) {
    if (embedAssets && node.tagName === 'base') check(!attr(node, 'href'), 'Resolve <base href> references in the source before offline export.', 'OFFLINE_BASE');
    if (node.tagName === 'script') {
      const src = attr(node, 'src')?.value;
      const type = typeOf(node);
      const isJsx = jsxType(type) || (src && /\.jsx(?:$|[?#])/i.test(src));
      if (src?.split(/[?#]/, 1)[0] === babelUrl) {
        const integrity = attr(node, 'integrity')?.value;
        check(!integrity || integrity === babelIntegrity, 'Babel integrity differs from the pinned release.', 'VENDOR_INTEGRITY');
        node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
      } else if (src && pins.has(remoteName(src))) {
        const name = remoteName(src);
        const integrity = attr(node, 'integrity')?.value;
        check(!integrity || integrity === `sha384-${pins.get(name)}`, `Integrity mismatch for the pinned ${name}.`, 'VENDOR_INTEGRITY');
        const selected = embedAssets ? name.replace(/\.development\.js$/, '.production.min.js') : name;
        inlineScript(node, pinnedReact(selected), Boolean(attr(node, 'defer')));
        embeddedReact ||= embedAssets;
      } else if (isJsx || (embedAssets && src)) {
        check(!attr(node, 'async') && !attr(node, 'data-type') && (!type || jsxType(type) || ['text/javascript', 'application/javascript'].includes(type)), 'Offline export supports classic ordered scripts. Bundle modules and async scripts first.', 'OFFLINE_SCRIPT_TYPE');
        const filename = src ? scopedFile(root, htmlFile, src) : null;
        const source = filename ? fs.readFileSync(filename.absolute, 'utf8') : text(node);
        const code = isJsx ? compileJsx(source, filename?.relative || htmlFile, root, htmlFile, embedAssets) : source;
        inlineScript(node, code, isJsx || Boolean(attr(node, 'defer')));
      }
    }
    if (!embedAssets) continue;
    if (node.tagName === 'link' && /(?:^|\s)stylesheet(?:$|\s)/i.test(attr(node, 'rel')?.value || '') && attr(node, 'href')) {
      const { absolute, relative } = scopedFile(root, htmlFile, attr(node, 'href').value);
      node.tagName = node.nodeName = 'style';
      node.attrs = node.attrs.filter(({ name }) => name === 'media' || name === 'nonce' || name === 'id');
      replaceText(node, inlineCss(fs.readFileSync(absolute, 'utf8'), root, relative).replace(/<\/style/gi, '\\3c /style'));
    } else if (node.tagName === 'style') {
      replaceText(node, inlineCss(text(node), root, htmlFile));
    }
    const style = attr(node, 'style');
    if (style) style.value = inlineCss(style.value, root, htmlFile);
    const resources = mediaAttributes[node.tagName] || (node.tagName === 'link' && /\bicon\b/i.test(attr(node, 'rel')?.value || '') ? ['href'] : []);
    for (const name of resources) {
      const entry = attr(node, name);
      if (!entry) continue;
      const embed = value => dataUrl(root, htmlFile, value);
      entry.value = name === 'srcset' ? rewriteSrcset(entry.value, embed) : embed(entry.value);
    }
  }
  if (embeddedReact) {
    const head = nodes.find(node => node.tagName === 'head');
    head.childNodes.unshift({ nodeName: '#comment', data: `\nReact and React DOM 18.3.1\n${fs.readFileSync(path.join(vendor, 'LICENSE.react'), 'utf8')}`, parentNode: head });
  }
  return parse5.serialize(ast);
}

function unresolved(html) {
  const parse5 = dependency('parse5');
  const found = new Set();
  for (const node of elements(parse5.parse(html))) {
    for (const { name, value } of node.attrs) {
      const resource = name === 'src' || name === 'poster' || (name === 'href' && !['a', 'area'].includes(node.tagName));
      if (resource && http(value.trim())) found.add(value.trim());
      if (name === 'srcset') rewriteSrcset(value, url => { if (http(url)) found.add(url); return url; });
    }
    for (const match of (node.tagName === 'style' ? text(node) : attr(node, 'style')?.value || '').matchAll(/url\(\s*["']?((?:https?:)?\/\/[^\s"')]+)/gi)) found.add(match[1]);
  }
  return [...found].sort();
}

function localPreview(html, root, filename) {
  return /<script\b[^>]*(?:text\/(?:babel|jsx)|unpkg\.com\/(?:react(?:-dom)?@|@babel\/standalone@)|\bsrc\s*=\s*["'][^"']+\.jsx["'?])/i.test(html)
    ? rewriteDocument(html, root, filename, { embedAssets: false }) : null;
}

module.exports = { localPreview, mediaTypes, rewriteDocument, unresolved };
