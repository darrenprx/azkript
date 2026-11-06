/* Silence the app's table-read speech inside automated browsers.
 *
 * Why this file exists: `openReadDock()` ends with `speakCurrent()`, so any test
 * or audit that opens the read dock (to measure or screenshot it) starts real
 * speech synthesis. On a headless CI box that is inaudible, but on a developer's
 * machine Playwright inherits the OS audio output and the user hears the app
 * "reading aloud" every time a suite runs. The app itself does NOT auto-start the
 * table read on launch — only automation that opens the dock does.
 *
 * Usage, in any Playwright script, BEFORE `page.goto(...)`:
 *
 *     const { silenceSpeech } = require("./lib/silence-speech.cjs");
 *     const page = await browser.newPage({ ... });
 *     await silenceSpeech(page);
 *     await page.goto(appUrl);
 *
 * `page.addInitScript` runs before any of the page's own scripts, so the stub is
 * in place before app.js captures a reference to `window.speechSynthesis`.
 *
 * It stubs `speak()` to record instead of talking, and leaves `cancel`,
 * `pause`, `resume` and `getVoices` working so the read-dock state machine still
 * behaves exactly as it does for a user (only the audio output is dropped). The
 * recorded calls are on `window.__spokenLines` for assertions.
 */
"use strict";

const VOICE_LIST = [
  { default: true, lang: "en-US", localService: true, name: "Stub English (US)", voiceURI: "stub-en-US" },
  { default: false, lang: "en-GB", localService: true, name: "Stub English (UK)", voiceURI: "stub-en-GB" },
];

/** Install the speech stub on a page. Must be called before navigation. */
async function silenceSpeech(page) {
  await page.addInitScript((voices) => {
    /* Record rather than speak. */
    window.__spokenLines = [];
    const synth = window.speechSynthesis;
    if (synth) {
      synth.speak = (utterance) => {
        window.__spokenLines.push(String((utterance && utterance.text) || ""));
      };
      synth.cancel = () => {};
      synth.pause = () => {};
      synth.resume = () => {};
      /* A voice list keeps populateReadVoices() from rendering an empty select,
       * so the dock's geometry is measured in a realistic state. */
      synth.getVoices = () => voices.map((v) => ({ ...v }));
    }
    /* Some code paths construct the utterance before calling speak(). */
    class StubUtterance {
      constructor(text) {
        this.text = text;
        this.lang = "en-US";
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.voice = null;
      }
      addEventListener() {}
      removeEventListener() {}
    }
    window.SpeechSynthesisUtterance = StubUtterance;
  }, VOICE_LIST);
}

/** Every line the app tried to speak on this page. */
async function spokenLines(page) {
  return page.evaluate(() => window.__spokenLines || []);
}

module.exports = { silenceSpeech, spokenLines, VOICE_LIST };
