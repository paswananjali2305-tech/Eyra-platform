const assert = require('node:assert/strict');
const test = require('node:test');
const { renderInvestigation } = require('../out/investigationHtml');
const { eyraHeroBotSvg } = require('../out/eyraHero');

function view(turns = []) {
  return {
    tab: 'chat',
    nonce: 'n',
    stale: false,
    botImgUri: '',
    cspSource: '',
    brainOnline: true,
    userInitial: 'K',
    chat: { turns },
    analysis: { status: 'empty', error: '', result: null, localPath: '', hasOrigin: false, startLine: null, endLine: null },
    execution: { status: 'empty', error: '', view: null, localPath: '', fileName: '' },
    tests: { status: 'empty', error: '', generated: null, run: null, localPath: '', fileName: '' },
    suggestions: { status: 'empty', error: '', performance: null, optimize: null, localPath: '' },
    history: { status: 'empty', error: '', total: null, items: [], query: '' },
  };
}

test('hero bot svg keeps the colorful reference palette', () => {
  const svg = eyraHeroBotSvg();
  assert.match(svg, /class="hero-bot-svg"/);
  assert.match(svg, /#22D3EE/);
  assert.match(svg, /#A855F7/);
  assert.match(svg, /&lt;\/&gt;/);
});

test('empty chat shows the EYRA preview screen with bot and composer', () => {
  const html = renderInvestigation(view());
  assert.match(html, /class="hero"/);
  assert.match(html, /hero-bot-svg/);
  assert.match(html, /AI Debugging Platform/);
  assert.match(html, /Understand code\. Find bugs\. Fix with confidence\./);
  assert.match(html, /id="chat-form"/);
  assert.match(html, /id="chat-input"/);
  assert.doesNotMatch(html, /Hello, I'm EYRA/);
});

test('preview screen disappears once a conversation starts', () => {
  const html = renderInvestigation(view([
    { id: 'u1', role: 'user', text: 'hi', at: Date.now() },
  ]));
  assert.doesNotMatch(html, /class="hero"/);
  assert.match(html, /msg user/);
});
