'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isTrustedSender, isEditorUrl, allowsPermission } = require('../security');
const entry = 'file:///C:/application/app/index.html';
function editor() {
  const mainFrame = { url: entry };
  return { mainFrame, isDestroyed: () => false, getURL: () => mainFrame.url };
}
test('equivalent file URL escapes remain trusted without accepting different files or query strings', () => {
  const expected = 'file:///C:/application/WRITER%7E1/app/index.html';
  assert.equal(isEditorUrl('file:///C:/application/WRITER~1/app/index.html', expected), true);
  assert.equal(isEditorUrl(expected, 'file:///C:/application/WRITER~1/app/index.html'), true);
  assert.equal(isEditorUrl('file:///C:/application/WRITER%257E1/app/index.html', expected), false);
  assert.equal(isEditorUrl('file:///C:/application/WRITER~1/app/index.html?other=1', expected), false);
  assert.equal(isEditorUrl('file:///C:/application/WRITER~1/app/index.html.evil', expected), false);
});
test('desktop bridge rejects other windows, child frames, navigated frames and lookalike URLs', () => {
  const contents = editor(), event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(isTrustedSender(event, contents, entry), true);
  assert.equal(isTrustedSender({ ...event, sender: editor() }, contents, entry), false);
  assert.equal(isTrustedSender({ ...event, senderFrame: { url: entry } }, contents, entry), false);
  contents.mainFrame.url = entry + '#help';
  assert.equal(isTrustedSender(event, contents, entry), true);
  for (const url of [entry + '?other=1', entry + '.evil', 'https://example.test/index.html', 'data:text/html,test']) {
    contents.mainFrame.url = url;
    assert.equal(isTrustedSender(event, contents, entry), false);
  }
  assert.equal(isEditorUrl('invalid', entry), false);
});
test('only the editor can request audio recording; camera and unrelated permissions are denied', () => {
  const contents = editor(), audio = { mediaTypes: ['audio'], isMainFrame: true, requestingUrl: entry };
  assert.equal(allowsPermission(contents, contents, 'media', audio, entry), true);
  for (const mediaTypes of [[], ['video'], ['audio', 'video'], undefined]) assert.equal(allowsPermission(contents, contents, 'media', { ...audio, mediaTypes }, entry), false);
  assert.equal(allowsPermission(contents, contents, 'media', { ...audio, isMainFrame: false }, entry), false);
  assert.equal(allowsPermission(contents, contents, 'media', { ...audio, requestingUrl: 'https://example.test' }, entry), false);
  assert.equal(allowsPermission(editor(), contents, 'media', audio, entry), false);
  for (const permission of ['geolocation', 'notifications', 'display-capture', 'midi']) assert.equal(allowsPermission(contents, contents, permission, audio, entry), false);
});
test('clipboard permissions support editing only in the trusted editor', () => {
  const contents = editor(), details = { isMainFrame: true, requestingUrl: entry };
  for (const permission of ['clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read']) {
    assert.equal(allowsPermission(contents, contents, permission, details, entry), true);
    assert.equal(allowsPermission(editor(), contents, permission, details, entry), false);
    assert.equal(allowsPermission(contents, contents, permission, { ...details, isMainFrame: false }, entry), false);
  }
});
