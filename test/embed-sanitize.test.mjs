import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './harness.mjs';

const { window } = new JSDOM('<!doctype html><body></body>');
const { bhEmbedCheck, bhEmbedParse, sanitizeHTML } = load(['embed'], { document: window.document });
const { safeHref } = load(['safehref']);

const src = r => r && r.src;

test('embed parse: YouTube links become youtube-nocookie, with start time', () => {
  assert.equal(src(bhEmbedParse('https://youtu.be/dQw4w9WgXcQ')), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(src(bhEmbedParse('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s')), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=65');
  assert.equal(src(bhEmbedParse('https://www.youtube.com/playlist?list=PL12345')), 'https://www.youtube-nocookie.com/embed/videoseries?list=PL12345');
});

test('embed parse: Vimeo, Spotify, Canva, Drive, Loom', () => {
  assert.equal(src(bhEmbedParse('https://vimeo.com/channels/staff/123456')), 'https://player.vimeo.com/video/123456');
  assert.equal(src(bhEmbedParse('https://open.spotify.com/intl-pt/track/abc123')), 'https://open.spotify.com/embed/track/abc123');
  assert.equal(src(bhEmbedParse('https://www.canva.com/design/DAF123/abc/edit')), 'https://www.canva.com/design/DAF123/abc/view?embed');
  assert.equal(src(bhEmbedParse('https://drive.google.com/file/d/ID123/view')), 'https://drive.google.com/file/d/ID123/preview');
  assert.equal(src(bhEmbedParse('https://www.loom.com/share/abc123')), 'https://www.loom.com/embed/abc123');
});

test('embed parse: Figma urls are encoded, Speaker Deck pages need a lookup', () => {
  const f = bhEmbedParse('https://www.figma.com/design/KEY/Name?node-id=1-2');
  assert.ok(f.src.startsWith('https://www.figma.com/embed?embed_host=boardhub&url=https%3A%2F%2Fwww.figma.com%2Fdesign%2FKEY'));
  assert.deepEqual(bhEmbedParse('https://speakerdeck.com/user/deck-name'), { lookup: 'speakerdeck', url: 'https://speakerdeck.com/user/deck-name' });
  assert.equal(src(bhEmbedParse('<script class="speakerdeck-embed" data-id="abc123"></script>')), 'https://speakerdeck.com/player/abc123');
});

test('embed parse: whole iframe code, &amp; entities and protocol-relative urls', () => {
  assert.equal(src(bhEmbedParse('<iframe width="1" src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>')), 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(src(bhEmbedCheck('//player.vimeo.com/video/123')), 'https://player.vimeo.com/video/123');
  assert.equal(src(bhEmbedCheck('https://docs.google.com/document/d/ID/preview?a=1&amp;b=2')), 'https://docs.google.com/document/d/ID/preview?a=1&b=2');
});

test('embed check: rejects http, ports, credentials, look-alike hosts and unknown hosts', () => {
  for (const bad of [
    'http://www.youtube.com/embed/abcdefghijk',
    'https://www.youtube.com:8443/embed/abcdefghijk',
    'https://user:pw@www.youtube.com/embed/abcdefghijk',
    'https://youtube.com.evil.com/embed/abcdefghijk',
    'https://evil.com/embed/abcdefghijk',
    'javascript:alert(1)',
    '',
  ]) assert.equal(bhEmbedCheck(bad), null, bad);
  assert.equal(bhEmbedParse('https://evil.example/page'), null);
  assert.equal(bhEmbedParse(''), null);
});

test('embed check: path traversal is normalised by URL and cannot escape the allowlist', () => {
  assert.equal(bhEmbedCheck('https://www.youtube.com/embed/x/../../evil'), null);
});

test('safeHref only returns http(s) links, adding https to bare domains', () => {
  assert.equal(safeHref('https://a.com/x'), 'https://a.com/x');
  assert.equal(safeHref('www.site.com/page'), 'https://www.site.com/page');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '', null, 'just words', '//evil.com']) assert.equal(safeHref(bad), null, String(bad));
});

const clean = html => sanitizeHTML(html);
const parse = html => { const t = window.document.createElement('template'); t.innerHTML = html; return t.content; };

test('sanitizer strips scripts, event handlers and dangerous URLs', () => {
  const out = clean('<p onclick="x()">a</p><script>alert(1)</script><img src="x" onerror="y()"><a href="javascript:alert(1)">l</a><a href="java\tscript:alert(1)">l2</a>');
  assert.ok(!/script|onclick|onerror|javascript/i.test(out), out);
  assert.ok(out.includes('<p>a</p>'));
});

test('sanitizer strips data:text/html, srcdoc, formaction and base', () => {
  const out = clean('<a href="data:text/html,<script>1</script>">x</a><iframe srcdoc="<script>1</script>"></iframe><button formaction="//evil">b</button><base href="//evil">');
  assert.ok(!/data:text|srcdoc|formaction|<base/i.test(out), out);
});

test('sanitizer removes svg, math, template and noscript vectors', () => {
  const out = clean('<svg><script>1</script></svg><math><mi>x</mi></math><template><script>1</script></template><noscript><p title="</noscript><img src=x onerror=1>"></noscript>ok');
  assert.ok(!/svg|math|template|noscript|onerror|script/i.test(out), out);
  assert.ok(out.includes('ok'));
});

test('sanitizer drops inline styles except the proportional image row', () => {
  assert.ok(!clean('<p style="position:fixed;top:0">x</p>').includes('style'));
  const row = clean('<div class="note-image-row" style="grid-template-columns: 1fr 2fr;"><img src="https://a.com/x.png"></div>');
  assert.ok(row.includes('grid-template-columns'));
  assert.ok(!clean('<div class="note-image-row" style="grid-template-columns: 1fr; position:fixed"></div>').includes('style'));
});

test('sanitizer keeps only allowlisted classes', () => {
  const out = clean('<div class="admin-panel note-image-grid evil">x</div>');
  assert.ok(out.includes('class="note-image-grid"'), out);
});

test('sanitizer image sources: https, idb and base64 raster pass; svg data and others are removed', () => {
  assert.ok(clean('<img src="https://a.com/x.png">').includes('src="https://a.com/x.png"'));
  assert.ok(clean('<img src="idb://abc">').includes('idb://abc'));
  assert.ok(clean('<img src="data:image/png;base64,AAAA">').includes('data:image/png'));
  assert.equal(clean('<img src="data:image/svg+xml;base64,AAAA">'), '');
  assert.equal(clean('<img src="ftp://x/y.png">'), '');
});

test('sanitizer adds rel to target=_blank links', () => {
  assert.ok(clean('<a href="https://a.com" target="_blank">x</a>').includes('rel="noopener noreferrer"'));
});

test('sanitizer rebuilds an allowed embed with sandbox and drops others', () => {
  const ok = clean('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" onload="x()"></iframe>');
  const frame = parse(ok).querySelector('.note-embed iframe');
  assert.ok(frame && frame.getAttribute('sandbox'));
  assert.ok(!/onload/.test(ok));
  assert.equal(clean('<iframe src="https://evil.com/x"></iframe>'), '');
  assert.equal(clean('<div class="note-embed" contenteditable="false"><iframe src="https://evil.com/x"></iframe></div>'), '');
});

test('sanitizer is idempotent', () => {
  const html = '<p>a <b>b</b></p><a href="https://a.com" target="_blank">l</a><div class="note-image-grid"><img src="idb://1"></div>'
    + '<iframe src="https://player.vimeo.com/video/1"></iframe>';
  const once = clean(html);
  assert.equal(clean(once), once);
});

test('sanitizer passes through empty and non-string input', () => {
  assert.equal(clean(''), '');
  assert.equal(clean(null), '');
});

for (const attr of ['id="x"', 'name="x"', 'srcset="a.png 1x"', 'ping="//evil"']) {
  test(`sanitizer strips ${attr.split('=')[0]}`, () => {
    assert.ok(!new RegExp(attr.split('=')[0] + '=').test(clean(`<a ${attr} href="https://a.com">x</a>`)));
  });
}

test('sanitizer keeps target=_blank/_self and drops other targets', () => {
  assert.ok(clean('<a href="https://a.com" target="_blank">x</a>').includes('target="_blank"'));
  assert.ok(!clean('<a href="https://a.com" target="evilframe">x</a>').includes('target'));
});
