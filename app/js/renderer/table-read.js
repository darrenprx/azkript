"use strict";

window.AzkriptRenderer.speechActions = function ({
  desktopState,
  documentSession,
  editorActions,
  fileActions,
  modalActions,
  planningViews,
  preferences,
  ribbonActions,
  shared,
}) {
  const { $$, on, clamp, els, escapeHtml, getCharacters, getScenes, icon, paragraphText } = shared;

  function openAssignVoicesDialog() {
    const chars = getCharacters(documentSession.doc);
    const voices = getSpeechVoices();
    modalActions.openDialog({
      eyebrow: "Tools · Speech Control",
      title: "Assign Voices for Table Read",
      body: `
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          ${
            chars.length
              ? chars
                  .map((c) => {
                    const cast = documentSession.doc.cast[c.id] || {};
                    return `<div class="shortcut-row">
                      <span><strong>${escapeHtml(c.name)}</strong></span>
                      <select class="char-voice-select" data-char-voice="${escapeHtml(c.id)}">
                        <option value="">Auto voice</option>
                        ${voices
                          .map(
                            (v) =>
                              `<option value="${escapeHtml(v.voiceURI)}"${cast.voiceURI === v.voiceURI ? " selected" : ""}>${escapeHtml(v.name)}</option>`,
                          )
                          .join("")}
                      </select>
                    </div>`;
                  })
                  .join("")
              : `<div class="shortcut-row"><span>No speaking characters yet.</span></div>`
          }
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save Voice Assignments",
          kind: "primary",
          onClick: () => {
            $$("[data-char-voice]", els.dialogBody).forEach((sel) => {
              const id = sel.dataset.charVoice;
              documentSession.doc.cast[id] = { ...(documentSession.doc.cast[id] || {}), voiceURI: sel.value };
            });
            fileActions.markDirty();
            planningViews.renderCharacters();
            modalActions.toast("Voices assigned", "Character voices updated for Table Read.", "success");
          },
        },
      ],
    });
  }
  /* ---------- speech transport ------------------------------------- */
  const speechState = {
    active: false,
    playing: false,
    paused: false,
    items: [],
    index: 0,
    token: 0,
    utterance: null,
    currentName: "",
  };

  function speechPlay() {
    if (!("speechSynthesis" in window)) {
      modalActions.toast("Table read unavailable", "This browser does not expose speech synthesis.", "warning");
      return;
    }
    if (!speechState.active) {
      openReadDock(false);
      return;
    }
    if (speechState.paused) pauseOrResume();
    else if (!speechState.playing) speakCurrent();
  }
  function speechStop() {
    if (!speechState.active) {
      ribbonActions.ribbonToast("Table read", "The table read is not running.", "info", 1800);
      return;
    }
    stopRead();
    ribbonActions.ribbonToast("Table read stopped", "Speech playback stopped.", "info", 1800);
  }
  function speechTransport(direction) {
    if (!speechState.active) {
      openReadDock(false);
      return;
    }
    advanceRead(direction);
  }
  // table read
  function getSpeechVoices() {
    if (!("speechSynthesis" in window)) return [];
    return window.speechSynthesis.getVoices().slice().sort((a, b) => {
      const aEn = /^en/i.test(a.lang) ? 0 : 1;
      const bEn = /^en/i.test(b.lang) ? 0 : 1;
      return aEn - bEn || a.name.localeCompare(b.name);
    });
  }
  function populateReadVoices() {
    if (!els.readVoice) return;
    /* The <button><selectedcontent></selectedcontent></button> child is customizable
     * select's display slot: it is what lets a long voice name ellipsis-truncate
     * while keeping the arrow, which the base-select value box cannot do (see the
     * Select normalisation block in app/styles-desktop.css for the measurements).
     * It has to be re-emitted with the options, because this function replaces
     * innerHTML wholesale. */
    const slot = `<button type="button"><selectedcontent></selectedcontent></button>`;
    const voices = getSpeechVoices();
    if (!voices.length) {
      els.readVoice.innerHTML = `${slot}<option value="">System voice</option>`;
      return;
    }
    const current =
      preferences.readVoiceURI ||
      (desktopState.appInfo && navigator.language) ||
      voices.find((voice) => /^en/i.test(voice.lang))?.voiceURI ||
      voices[0].voiceURI;
    if (!voices.some((voice) => voice.voiceURI === current)) {
      preferences.readVoiceURI = voices[0].voiceURI;
    }
    els.readVoice.innerHTML = slot + voices
      .map(
        (voice) =>
          `<option value="${escapeHtml(voice.voiceURI)}"${voice.voiceURI === preferences.readVoiceURI ? " selected" : ""}>${escapeHtml(voice.name)}${voice.lang ? ` · ${escapeHtml(voice.lang)}` : ""}</option>`,
      )
      .join("");
  }
  function buildReadItems() {
    const scenes = getScenes(documentSession.doc);
    const omitted = new Set();
    for (const scene of scenes) {
      if (!scene.omit) continue;
      for (let index = scene.startIndex; index < scene.endIndex; index += 1) omitted.add(index);
    }
    const items = [];
    let currentName = "";
    documentSession.doc.paragraphs.forEach((paragraph, index) => {
      if (omitted.has(index)) return;
      const text = paragraphText(paragraph).trim();
      if (!text) return;
      if (paragraph.type === "Character") {
        currentName = text.replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase();
        return;
      }
      const speaker =
        paragraph.type === "Dialogue" ? currentName || "Character" : "Narrator";
      items.push({
        paragraphId: paragraph.id,
        type: paragraph.type,
        text,
        speaker,
        speak: true,
      });
    });
    return items;
  }
  function rebuildReadItems() {
    const current = speechState.items[speechState.index];
    speechState.items = buildReadItems();
    if (current) {
      const found = speechState.items.findIndex((item) => item.paragraphId === current.paragraphId);
      if (found >= 0) speechState.index = found;
    }
    updateReadDock();
  }
  function openReadDock(fromHere) {
    if (!("speechSynthesis" in window)) {
      modalActions.toast("Table read unavailable", "This browser does not expose speech synthesis.", "warning");
      return;
    }
    stopRead();
    speechState.active = true;
    speechState.items = buildReadItems();
    if (!speechState.items.length) {
      modalActions.toast("Nothing to read", "Add some action or dialogue first.", "info", 2200);
      return;
    }
    const active = editorActions.activeParagraph();
    if (fromHere && active) {
      const index = speechState.items.findIndex((item) => item.paragraphId === active.id);
      if (index >= 0) speechState.index = index;
    } else {
      speechState.index = 0;
    }
    els.readDock.classList.remove("is-closing");
    els.readDock.classList.add("is-open");
    els.readDock.setAttribute("aria-hidden", "false");
    document.body.classList.add("read-open");
    populateReadVoices();
    updateReadDock();
    speakCurrent();
  }
  function closeReadDock() {
    stopRead();
    speechState.active = false;
    document.body.classList.remove("read-open");
    removeReadHighlight();
    if (els.readDock) {
      els.readDock.classList.remove("is-open");
      els.readDock.classList.add("is-closing");
      setTimeout(() => {
        if (!speechState.active) {
          els.readDock.classList.remove("is-closing");
          els.readDock.setAttribute("aria-hidden", "true");
        }
      }, 220);
    }
  }
  function resetDocumentSpeech() {
    if (speechState.active) closeReadDock();
    speechState.items = [];
    speechState.index = 0;
    speechState.currentName = "";
  }
  function removeReadHighlight() {
    $$(".para.is-reading", els.editor).forEach((el) => el.classList.remove("is-reading"));
  }
  function highlightRead(paragraphId) {
    removeReadHighlight();
    const el = editorActions.paragraphElement(paragraphId);
    if (el) {
      el.classList.add("is-reading");
      editorActions.scrollParagraphIntoView(el, "center", true);
    }
  }
  function updateReadDock() {
    const item = speechState.items[speechState.index];
    const count = speechState.items.length;
    els.readLine.textContent = item ? truncate(item.text, 165) : "Ready when you are.";
    els.readSpeaker.textContent = item ? item.speaker : "Narrator";
    els.readKicker.textContent = speechState.playing
      ? speechState.paused
        ? "TABLE READ · PAUSED"
        : "TABLE READ · PLAYING"
      : "TABLE READ";
    els.readProgress.style.width = `${count ? ((speechState.index + 1) / count) * 100 : 0}%`;
    els.readPulse.classList.toggle("is-speaking".playing && !speechState.paused);
    els.readPlay.innerHTML = speechState.playing && !speechState.paused ? icon("pause") : icon("play");
    els.readPlay.setAttribute(
      "aria-label",
      speechState.playing && !speechState.paused ? "Pause table read" : "Play table read",
    );
    if (els.readRate) els.readRate.value = String(preferences.readRate);
  }
  function truncate(text, length) {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }
  function voiceForSpeaker(speaker) {
    const voices = getSpeechVoices();
    if (!voices.length) return null;
    const narrator =
      (preferences.readVoiceURI && voices.find((voice) => voice.voiceURI === preferences.readVoiceURI)) ||
      voices.find((voice) => /^en/i.test(voice.lang)) ||
      voices[0];
    if (speaker === "Narrator") return narrator;
    const character = getCharacters(documentSession.doc).find((item) => item.name === speaker);
    const meta = character && documentSession.doc.cast ? documentSession.doc.cast[character.id] : null;
    if (meta && meta.voiceURI) {
      const found = voices.find((voice) => voice.voiceURI === meta.voiceURI);
      if (found) return found;
    }
    if (!character) return narrator;
    const pool = voices.filter((voice) => voice.voiceURI !== narrator.voiceURI);
    if (!pool.length) return narrator;
    const chars = getCharacters(documentSession.doc);
    const index = Math.max(0, chars.findIndex((item) => item.name === speaker));
    return pool[index % pool.length];
  }
  function speakCurrent() {
    if (!speechState.active) return;
    const speech = window.speechSynthesis;
    if (!speech) return;
    const item = speechState.items[speechState.index];
    if (!item) {
      stopRead();
      return;
    }
    speech.cancel();
    const token = ++speechState.token;
    highlightRead(item.paragraphId);
    const readItem=FDProduction.readPlan(documentSession.doc).items.find(p=>p.paragraphId===item.paragraphId);
    const utterance = new SpeechSynthesisUtterance(readItem?.text || item.text);
    const voice = voiceForSpeaker(item.speaker);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || "en-US";
    }
    utterance.rate = clamp(Number(preferences.readRate) || 1, 0.5, 2);
    utterance.pitch = item.speaker === "Narrator" ? 0.92 : 1.04;
    const profile=readItem?.profile;
    if(profile){const selected=window.speechSynthesis.getVoices().find(v=>v.name===profile.voice);if(selected){utterance.voice=selected;utterance.lang=selected.lang;}utterance.rate=clamp(Number(profile.rate)||1,0.5,2);utterance.pitch=clamp(Number(profile.pitch)||1,0,2);}
    utterance.onstart = () => {
      if (token !== speechState.token) return;
      speechState.playing = true;
      speechState.paused = false;
      updateReadDock();
    };
    utterance.onend = () => {
      if (token !== speechState.token) return;
      speechState.playing = false;
      advanceRead(1);
    };
    utterance.onerror = (event) => {
      if (token !== speechState.token) return;
      if (event.error === "interrupted" || event.error === "canceled") return;
      speechState.playing = false;
      updateReadDock();
      modalActions.toast("Table read stopped", event.error || "Speech synthesis could not continue.", "warning", 3200);
    };
    speechState.utterance = utterance;
    setTimeout(() => {
      if (token !== speechState.token) return;
      try {
        speech.speak(utterance);
      } catch (error) {
        speechState.playing = false;
        updateReadDock();
        modalActions.toast("Table read stopped", error.message || "Speech synthesis could not start.", "warning", 3200);
      }
    }, 28);
    speechState.playing = true;
    speechState.paused = false;
    updateReadDock();
  }
  function advanceRead(direction) {
    if (!speechState.active) return;
    let next = speechState.index + direction;
    while (next >= 0 && next < speechState.items.length) {
      if (speechState.items[next].speak) break;
      next += direction;
    }
    if (next < 0 || next >= speechState.items.length) {
      speechState.playing = false;
      speechState.paused = false;
      speechState.index = direction > 0 ? speechState.items.length - 1 : 0;
      updateReadDock();
      removeReadHighlight();
      return;
    }
    speechState.index = next;
    speakCurrent();
  }
  function pauseOrResume() {
    if (!speechState.active) {
      openReadDock(true);
      return;
    }
    const speech = window.speechSynthesis;
    if (!speech) return;
    if (speechState.playing && !speechState.paused) {
      speech.pause();
      speechState.paused = true;
      updateReadDock();
    } else if (speechState.paused) {
      speech.resume();
      speechState.paused = false;
      speechState.playing = true;
      updateReadDock();
    } else {
      speakCurrent();
    }
  }
  function stopRead() {
    if (!("speechSynthesis" in window)) return;
    speechState.token += 1;
    window.speechSynthesis.cancel();
    speechState.playing = false;
    speechState.paused = false;
    speechState.utterance = null;
    removeReadHighlight();
    updateReadDock();
  }
  function isReadDockOpen() { return speechState.active; }
  function bindReadEvents() {
    for (const toggle of ["readToggle", "readRailButton"]) {
      on(toggle, "click", () => speechState.active ? closeReadDock() : openReadDock(false));
    }
    on("readPlay", "click", pauseOrResume);
    on("readPrev", "click", () => {
      stopRead();
      advanceRead(-1);
    });
    on("readNext", "click", () => {
      stopRead();
      advanceRead(1);
    });
    on("readStop", "click", stopRead);
    on("readClose", "click", closeReadDock);
    on("readVoice", "change", () => {
      preferences.readVoiceURI = els.readVoice.value;
      fileActions.persistPrefs();
      if (speechState.active) {
        stopRead();
        speakCurrent();
      }
    });
    on("readRate", "change", () => {
      preferences.readRate = Number(els.readRate.value) || 1;
      fileActions.persistPrefs();
      if (speechState.active && speechState.playing) {
        stopRead();
        speakCurrent();
      }
    });
    if ("speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        populateReadVoices();
        if (speechState.active) rebuildReadItems();
      });
    }
  }
  return {
    bindReadEvents,
    isReadDockOpen,
    getSpeechVoices,
    openAssignVoicesDialog,
    openReadDock,
    rebuildReadItems,
    resetDocumentSpeech,
    speechPlay,
    speechStop,
    speechTransport,
    truncate
  };
};
