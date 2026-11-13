/* The privileged bridge belongs only to the packaged editor's main frame. */
'use strict';
const { fileURLToPath } = require('node:url');
function isEditorUrl(value, entryUrl) {
  try {
    const candidate = new URL(value), entry = new URL(entryUrl);
    candidate.hash = ''; entry.hash = '';
    // Chromium leaves '~' literal in Windows short paths; Node's file URL
    // serializer may encode it as %7E. Compare the file identity, not spelling.
    if (candidate.protocol === 'file:' && entry.protocol === 'file:' && candidate.search === entry.search) {
      return fileURLToPath(candidate) === fileURLToPath(entry);
    }
    return candidate.href === entry.href;
  } catch { return false; }
}
function isTrustedSender(event, contents, entryUrl) {
  return Boolean(contents && !contents.isDestroyed() && event.sender === contents &&
    event.senderFrame === contents.mainFrame && isEditorUrl(event.senderFrame?.url, entryUrl));
}
function isClipboardPermission(permission) {
  return ['clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read'].includes(permission);
}
function allowsPermission(contents, editorContents, permission, details, entryUrl) {
  if (!contents || contents !== editorContents || contents.isDestroyed() ||
      !isEditorUrl(contents.getURL(), entryUrl) || details?.isMainFrame === false ||
      (details?.requestingUrl && !isEditorUrl(details.requestingUrl, entryUrl))) return false;
  if (isClipboardPermission(permission)) return true;
  return permission === 'media' && Array.isArray(details?.mediaTypes) &&
    details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio';
}
module.exports = { isEditorUrl, isTrustedSender, isClipboardPermission, allowsPermission };
