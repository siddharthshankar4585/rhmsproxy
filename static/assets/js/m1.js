// main.js
let qp;

try {
  qp = window.top.location.pathname === "/d";
} catch {
  try {
    qp = window.parent.location.pathname === "/d";
  } catch {
    qp = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const CHAT_COLLAPSED_KEY = "proxyChatCollapsed";
  const CHAT_POSITION_KEY = "proxyChatPosition";
  const LIVE_GAME_SESSION_KEY = "liveGameSessionId";
  const EFFECTS_REVISION_KEY = "adminEffectsRevision";
  const MAX_ACTIVE_CONFETTI_PIECES = 72;
  const LIVE_GAME_SYNC_INTERVAL_MS = 900;
  let hasLoadedEffects = false;
  let lastConfettiVersion = 0;
  let lastJumpscareVersion = 0;
  let lastClientRefreshVersion = 0;
  let lastLiveGameSessionId = 0;
  let lastAcceptedEffectsRevision = Number(sessionStorage.getItem(EFFECTS_REVISION_KEY) || "0");
  let confettiIntervalId = null;
  let dismissedPopupVersion = null;
  let weatherFlashIntervalId = null;
  let weatherCurrentEffect = "";
  let chatPollIntervalId = null;
  let lastRenderedChatMessageId = 0;
  let liveGameJoinInFlight = false;
  let liveGameSyncInFlight = false;
  let liveGameLocalSurvivalMs = 0;
  let activeConfettiPieces = 0;
  const liveGameRuntime = {
    sessionId: 0,
    active: false,
    alive: false,
    joinedAt: 0,
    endsAt: 0,
    seed: 0,
    rngState: 0,
    rafId: 0,
    lastTickAt: 0,
    lastSyncedAt: 0,
    obstacleCooldownMs: 0,
    runnerY: 0,
    runnerVelocity: 0,
    obstacles: [],
  };

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function getChatVisitorId() {
    let visitorId = localStorage.getItem("visitorId");
    if (!visitorId) {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        visitorId = crypto.randomUUID().replace(/[^a-zA-Z0-9-_]/g, "");
      } else {
        visitorId = `v${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
      }
      localStorage.setItem("visitorId", visitorId);
    }
    return visitorId;
  }

  function getSavedChatName() {
    return String(localStorage.getItem("proxyChatName") || "").trim();
  }

  function getLiveGamePlayerName() {
    return getSavedChatName() || `Player ${String(getChatVisitorId()).slice(-4)}`;
  }

  function sanitizeLocalChatName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24);
  }

  function setChatStatus(message, isError = false) {
    const status = document.getElementById("proxy-chat-status");
    if (!status) {
      return;
    }
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function getSavedLiveGameSessionId() {
    return Number(sessionStorage.getItem(LIVE_GAME_SESSION_KEY) || "0");
  }

  function setSavedLiveGameSessionId(sessionId) {
    sessionStorage.setItem(LIVE_GAME_SESSION_KEY, String(sessionId || 0));
  }

  function updateChatComposerState() {
    const name = getSavedChatName();
    const badge = document.getElementById("proxy-chat-name-badge");
    const nameInput = document.getElementById("proxy-chat-name-input");
    const messageInput = document.getElementById("proxy-chat-message-input");
    const sendButton = document.getElementById("proxy-chat-send");

    if (badge) {
      badge.textContent = name ? `Chatting as ${name}` : "Pick a name to join";
    }
    if (nameInput && !nameInput.matches(":focus")) {
      nameInput.value = name;
    }
    if (messageInput) {
      messageInput.disabled = !name;
      messageInput.placeholder = name ? "Send a message" : "Pick a name first";
    }
    if (sendButton) {
      sendButton.disabled = !name;
    }
  }

  function formatChatTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return "now";
    }
  }

  function renderChatMessages(messages) {
    const list = document.getElementById("proxy-chat-messages");
    if (!list) {
      return;
    }

    const ownName = getSavedChatName();
    const shouldStickToBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 36;
    list.replaceChildren();

    if (!Array.isArray(messages) || messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "proxy-chat-empty";
      empty.textContent = "Nobody has said anything yet.";
      list.appendChild(empty);
      lastRenderedChatMessageId = 0;
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const message of messages) {
      const isSystem = message.roleTag === "SYSTEM" || message.name === "SYSTEM";
      const item = document.createElement("div");
      item.className = "proxy-chat-message";
      if (isSystem) {
        item.classList.add("system");
      }
      if (ownName && message.name === ownName) {
        item.classList.add("own");
      }

      const meta = document.createElement("div");
      meta.className = "proxy-chat-meta";

      const authorWrap = document.createElement("div");
      authorWrap.className = "proxy-chat-author-wrap";

      const author = document.createElement("span");
      author.className = "proxy-chat-author";
      author.textContent = isSystem ? "<SYSTEM>" : (message.name || "Unknown");
      if (message.color) {
        author.style.color = message.color;
      }

      authorWrap.appendChild(author);

      if (message.roleTag && !isSystem) {
        const tag = document.createElement("span");
        tag.className = "proxy-chat-tag";
        tag.textContent = message.roleTag;
        if (message.color) {
          tag.style.borderColor = message.color;
          tag.style.color = message.color;
          tag.style.background = `${message.color}18`;
        }
        authorWrap.appendChild(tag);
      }

      const time = document.createElement("span");
      time.textContent = formatChatTime(message.createdAt);

      const text = document.createElement("div");
      text.className = "proxy-chat-text";
      text.textContent = message.message || "";

      meta.append(authorWrap, time);
      item.append(meta, text);
      fragment.appendChild(item);
    }

    list.appendChild(fragment);
    lastRenderedChatMessageId = Number(messages[messages.length - 1]?.id) || 0;
    if (shouldStickToBottom || !list.dataset.loadedOnce) {
      list.scrollTop = list.scrollHeight;
    }
    list.dataset.loadedOnce = "true";
  }

  async function fetchChatMessages() {
    try {
      const res = await fetch("/api/chat/messages", { cache: "no-store" });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      const messages = Array.isArray(data.messages) ? data.messages : [];
      const newestId = Number(messages[messages.length - 1]?.id) || 0;
      if (newestId !== lastRenderedChatMessageId || newestId === 0) {
        renderChatMessages(messages);
      }
    } catch {
      // Ignore transient chat polling errors silently.
    }
  }

  async function sendChatMessage() {
    const name = getSavedChatName();
    const input = document.getElementById("proxy-chat-message-input");
    if (!name || !input) {
      setChatStatus("Pick a name first.", true);
      return;
    }

    const message = String(input.value || "").trim();
    if (!message) {
      setChatStatus("Type a message first.", true);
      return;
    }

    setChatStatus("Sending...");

    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId: getChatVisitorId(),
          name,
          message,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChatStatus((data && data.error) || "Failed to send message.", true);
        return;
      }

      input.value = "";
      setChatStatus("Message sent.");
      renderChatMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch {
      setChatStatus("Network error. Try again.", true);
    }
  }

  function saveChatName() {
    const input = document.getElementById("proxy-chat-name-input");
    if (!input) {
      return;
    }

    const name = sanitizeLocalChatName(input.value);
    if (!name || name.length < 2 || !/^[a-zA-Z0-9 ._-]+$/.test(name)) {
      setChatStatus("Use 2-24 letters, numbers, spaces, dots, dashes, or underscores.", true);
      return;
    }

    localStorage.setItem("proxyChatName", name);
    updateChatComposerState();
    setChatStatus(`Joined chat as ${name}.`);
  }

  function getChatWidget() {
    return document.getElementById("proxy-chat-widget");
  }

  function isChatCollapsed() {
    return localStorage.getItem(CHAT_COLLAPSED_KEY) === "true";
  }

  function setChatCollapsed(collapsed) {
    localStorage.setItem(CHAT_COLLAPSED_KEY, collapsed ? "true" : "false");
    const widget = getChatWidget();
    if (!widget) {
      return;
    }
    const toggle = document.getElementById("proxy-chat-toggle");
    widget.classList.toggle("collapsed", collapsed);
    if (toggle) {
      toggle.textContent = collapsed ? "+" : "-";
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.setAttribute("title", collapsed ? "Expand chat" : "Collapse chat");
    }
  }

  function getSavedChatPosition() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CHAT_POSITION_KEY) || "null");
      if (!parsed || !Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) {
        return null;
      }
      return { left: parsed.left, top: parsed.top };
    } catch {
      return null;
    }
  }

  function saveChatPosition(left, top) {
    localStorage.setItem(CHAT_POSITION_KEY, JSON.stringify({ left, top }));
  }

  function clampChatPosition(left, top, widget) {
    const safeLeft = Math.max(8, Math.min(left, window.innerWidth - widget.offsetWidth - 8));
    const safeTop = Math.max(8, Math.min(top, window.innerHeight - widget.offsetHeight - 8));
    return { left: safeLeft, top: safeTop };
  }

  function applyChatPosition(position = getSavedChatPosition()) {
    const widget = getChatWidget();
    if (!widget) {
      return;
    }
    if (!position) {
      widget.style.left = "16px";
      widget.style.top = "";
      widget.style.bottom = window.innerWidth <= 640 ? "108px" : "16px";
      widget.style.right = window.innerWidth <= 640 ? "12px" : "";
      return;
    }

    const clamped = clampChatPosition(position.left, position.top, widget);
    widget.style.left = `${clamped.left}px`;
    widget.style.top = `${clamped.top}px`;
    widget.style.bottom = "auto";
    widget.style.right = "auto";
    saveChatPosition(clamped.left, clamped.top);
  }

  function enableChatDragging() {
    const widget = getChatWidget();
    const header = document.getElementById("proxy-chat-header");
    if (!widget || !header || header.dataset.dragBound === "true") {
      return;
    }

    let dragState = null;

    header.addEventListener("pointerdown", event => {
      if (event.button !== 0) {
        return;
      }
      if (event.target instanceof Element && event.target.closest("button")) {
        return;
      }

      const rect = widget.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };

      widget.classList.add("dragging");
      header.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    header.addEventListener("pointermove", event => {
      if (!dragState) {
        return;
      }
      const nextLeft = event.clientX - dragState.offsetX;
      const nextTop = event.clientY - dragState.offsetY;
      const clamped = clampChatPosition(nextLeft, nextTop, widget);
      widget.style.left = `${clamped.left}px`;
      widget.style.top = `${clamped.top}px`;
      widget.style.bottom = "auto";
      widget.style.right = "auto";
    });

    function finishDrag(event) {
      if (!dragState) {
        return;
      }
      if (event?.pointerId !== undefined && header.hasPointerCapture?.(event.pointerId)) {
        header.releasePointerCapture(event.pointerId);
      }
      dragState = null;
      widget.classList.remove("dragging");
      saveChatPosition(parseFloat(widget.style.left) || 16, parseFloat(widget.style.top) || 16);
    }

    header.addEventListener("pointerup", finishDrag);
    header.addEventListener("pointercancel", finishDrag);
    header.addEventListener("lostpointercapture", () => {
      dragState = null;
      widget.classList.remove("dragging");
    });
    header.dataset.dragBound = "true";
  }

  function mountChatWidget() {
    if (document.getElementById("proxy-chat-widget")) {
      updateChatComposerState();
      return;
    }

    const widget = document.createElement("section");
    widget.id = "proxy-chat-widget";
    widget.innerHTML = `
      <div id="proxy-chat-header">
        <div id="proxy-chat-title-wrap">
          <div id="proxy-chat-title">Proxy Chat</div>
          <div id="proxy-chat-name-badge"></div>
        </div>
        <button id="proxy-chat-toggle" type="button" aria-expanded="true" title="Collapse chat">-</button>
      </div>
      <div id="proxy-chat-body">
        <div id="proxy-chat-name-row">
          <input id="proxy-chat-name-input" type="text" maxlength="24" placeholder="Pick a name" autocomplete="off" />
          <button id="proxy-chat-save-name" type="button">Use Name</button>
        </div>
        <div id="proxy-chat-messages"></div>
        <div id="proxy-chat-compose">
          <input id="proxy-chat-message-input" type="text" maxlength="280" placeholder="Pick a name first" autocomplete="off" />
          <button id="proxy-chat-send" type="button">Send</button>
        </div>
        <div id="proxy-chat-status"></div>
      </div>
    `;

    document.body.appendChild(widget);

    document.getElementById("proxy-chat-toggle")?.addEventListener("click", event => {
      event.stopPropagation();
      setChatCollapsed(!isChatCollapsed());
    });

    document.getElementById("proxy-chat-save-name")?.addEventListener("click", saveChatName);
    document.getElementById("proxy-chat-send")?.addEventListener("click", sendChatMessage);
    document.getElementById("proxy-chat-name-input")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        saveChatName();
      }
    });
    document.getElementById("proxy-chat-message-input")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        sendChatMessage();
      }
    });

    enableChatDragging();
    setChatCollapsed(isChatCollapsed());
    applyChatPosition();

    updateChatComposerState();
    fetchChatMessages();
    if (chatPollIntervalId === null) {
      chatPollIntervalId = window.setInterval(fetchChatMessages, 3000);
    }
  }

  function hideLiveGameOverlay() {
    if (liveGameRuntime.rafId) {
      cancelAnimationFrame(liveGameRuntime.rafId);
      liveGameRuntime.rafId = 0;
    }
    liveGameRuntime.active = false;
    liveGameRuntime.obstacles = [];
    document.getElementById("admin-live-game-overlay")?.remove();
  }

  function formatLiveGameDuration(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    return `${(safeMs / 1000).toFixed(safeMs >= 10_000 ? 0 : 1)}s`;
  }

  function nextLiveGameRandom() {
    liveGameRuntime.rngState = (liveGameRuntime.rngState * 1664525 + 1013904223) >>> 0;
    return liveGameRuntime.rngState / 4294967296;
  }

  function clearLiveGameObstacles() {
    for (const obstacle of liveGameRuntime.obstacles) {
      obstacle.element?.remove();
    }
    liveGameRuntime.obstacles = [];
  }

  function resetLiveGameRuntime(sessionId = 0) {
    if (liveGameRuntime.rafId) {
      cancelAnimationFrame(liveGameRuntime.rafId);
    }
    liveGameRuntime.sessionId = sessionId;
    liveGameRuntime.active = false;
    liveGameRuntime.alive = false;
    liveGameRuntime.joinedAt = 0;
    liveGameRuntime.endsAt = 0;
    liveGameRuntime.seed = 0;
    liveGameRuntime.rngState = 0;
    liveGameRuntime.rafId = 0;
    liveGameRuntime.lastTickAt = 0;
    liveGameRuntime.lastSyncedAt = 0;
    liveGameRuntime.obstacleCooldownMs = 0;
    liveGameRuntime.runnerY = 0;
    liveGameRuntime.runnerVelocity = 0;
    clearLiveGameObstacles();
  }

  function armLiveGameRuntime(gameState) {
    const sessionId = Number(gameState?.sessionId) || 0;
    if (!sessionId || !gameState?.active) {
      return;
    }

    ensureLiveGameRuntime(gameState);
    if (!liveGameRuntime.joinedAt) {
      liveGameRuntime.joinedAt = Date.now();
      liveGameRuntime.alive = true;
    }
    if (!liveGameRuntime.rafId) {
      liveGameRuntime.rafId = requestAnimationFrame(tickLiveGame);
    }
  }

  function triggerLiveGameJump() {
    if (!liveGameRuntime.active || !liveGameRuntime.alive) {
      return;
    }
    if (liveGameRuntime.runnerY > 4) {
      return;
    }
    liveGameRuntime.runnerVelocity = 0.82;
  }

  function ensureLiveGameOverlay() {
    let overlay = document.getElementById("admin-live-game-overlay");
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("section");
    overlay.id = "admin-live-game-overlay";
    overlay.innerHTML = `
      <div id="admin-live-game-card">
        <div id="admin-live-game-topline">
          <div>
            <div id="admin-live-game-kicker">Live Game</div>
            <h2 id="admin-live-game-title">Sky Sprint</h2>
          </div>
          <div id="admin-live-game-timer">0s</div>
        </div>
        <div id="admin-live-game-meta">
          <div id="admin-live-game-player">Joining...</div>
          <div id="admin-live-game-score">Survived: 0.0s</div>
        </div>
        <div id="admin-live-game-stage">
          <div id="admin-live-game-track"></div>
          <div id="admin-live-game-obstacles"></div>
          <div id="admin-live-game-runner"></div>
        </div>
        <button id="admin-live-game-tap" type="button">Jump</button>
        <div id="admin-live-game-status"></div>
        <div id="admin-live-game-leaderboard-title">Leaderboard</div>
        <div id="admin-live-game-leaderboard"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("admin-live-game-tap")?.addEventListener("pointerdown", event => {
      event.preventDefault();
      triggerLiveGameJump();
    });
    if (document.body.dataset.liveGameKeysBound !== "true") {
      document.addEventListener("keydown", event => {
        const target = event.target;
        if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
          return;
        }
        if (event.key === " " || event.key === "ArrowUp" || event.key.toLowerCase() === "w") {
          event.preventDefault();
          triggerLiveGameJump();
        }
      });
      document.body.dataset.liveGameKeysBound = "true";
    }
    return overlay;
  }

  function renderLiveGameLeaderboard(entries) {
    const leaderboard = document.getElementById("admin-live-game-leaderboard");
    if (!leaderboard) {
      return;
    }

    leaderboard.replaceChildren();

    if (!Array.isArray(entries) || entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "admin-live-game-empty";
      empty.textContent = "No runs yet. Stay alive to take the lead.";
      leaderboard.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const [index, entry] of entries.entries()) {
      const row = document.createElement("div");
      row.className = "admin-live-game-entry";
      if (entry.visitorId === getChatVisitorId()) {
        row.classList.add("own");
      }
      row.innerHTML = `
        <span class="admin-live-game-rank">#${index + 1}</span>
        <span class="admin-live-game-name">${entry.name || "Player"}</span>
        <span class="admin-live-game-points">${formatLiveGameDuration(entry.survivalMs || 0)}${entry.alive ? " alive" : ""}</span>
      `;
      fragment.appendChild(row);
    }

    leaderboard.appendChild(fragment);
  }

  function renderLiveGameStage() {
    const runner = document.getElementById("admin-live-game-runner");
    const overlay = document.getElementById("admin-live-game-overlay");
    if (runner) {
      runner.style.transform = `translateY(${-liveGameRuntime.runnerY}px)`;
    }
    for (const obstacle of liveGameRuntime.obstacles) {
      obstacle.element.style.transform = `translateX(${obstacle.x}px)`;
      obstacle.element.style.height = `${obstacle.height}px`;
      obstacle.element.style.width = `${obstacle.width}px`;
      obstacle.element.style.bottom = `${obstacle.bottom}px`;
    }
    overlay?.classList.toggle("finished", !liveGameRuntime.alive);
  }

  async function syncLiveGameProgress(force = false) {
    if (!liveGameRuntime.sessionId || liveGameSyncInFlight) {
      return;
    }
    const now = Date.now();
    if (!force && now - liveGameRuntime.lastSyncedAt < LIVE_GAME_SYNC_INTERVAL_MS) {
      return;
    }

    liveGameSyncInFlight = true;
    liveGameRuntime.lastSyncedAt = now;
    try {
      const res = await fetch("/api/live-game/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId: getChatVisitorId(),
          name: getLiveGamePlayerName(),
          survivalMs: liveGameLocalSurvivalMs,
          alive: liveGameRuntime.alive,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return;
      }
      liveGameLocalSurvivalMs = Number(data?.player?.survivalMs) || liveGameLocalSurvivalMs;
      if (data?.liveGame?.sessionId === liveGameRuntime.sessionId) {
        renderLiveGameLeaderboard(data.liveGame.leaderboard || []);
      }
    } catch {
      // Ignore transient live game sync errors silently.
    } finally {
      liveGameSyncInFlight = false;
    }
  }

  function createLiveGameObstacle(obstacleLayer, stageWidth, config) {
    const obstacle = document.createElement("div");
    obstacle.className = `admin-live-game-obstacle ${config.className || ""}`.trim();
    obstacleLayer.appendChild(obstacle);

    liveGameRuntime.obstacles.push({
      x: stageWidth + (config.offsetX || 24),
      width: config.width,
      height: config.height,
      bottom: config.bottom ?? 22,
      hitHeight: config.hitHeight ?? config.height,
      element: obstacle,
    });
  }

  function spawnLiveGameObstacle() {
    const obstacleLayer = document.getElementById("admin-live-game-obstacles");
    const stage = document.getElementById("admin-live-game-stage");
    if (!obstacleLayer || !stage) {
      return;
    }

    const stageWidth = stage.clientWidth;
    const elapsedMs = liveGameLocalSurvivalMs;
    const patternRoll = nextLiveGameRandom();

    if (elapsedMs > 12000 && patternRoll > 0.74) {
      const firstWidth = 18 + Math.round(nextLiveGameRandom() * 8);
      const secondWidth = 18 + Math.round(nextLiveGameRandom() * 10);
      createLiveGameObstacle(obstacleLayer, stageWidth, {
        className: "spike",
        width: firstWidth,
        height: 18 + Math.round(nextLiveGameRandom() * 6),
        hitHeight: 16,
      });
      createLiveGameObstacle(obstacleLayer, stageWidth, {
        className: "spike alt",
        offsetX: 56 + Math.round(nextLiveGameRandom() * 18),
        width: secondWidth,
        height: 18 + Math.round(nextLiveGameRandom() * 8),
        hitHeight: 16,
      });
      return;
    }

    if (elapsedMs > 18000 && patternRoll > 0.5) {
      createLiveGameObstacle(obstacleLayer, stageWidth, {
        className: "tall",
        width: 24 + Math.round(nextLiveGameRandom() * 10),
        height: 58 + Math.round(nextLiveGameRandom() * 18),
        hitHeight: 54,
      });
      return;
    }

    if (patternRoll > 0.26) {
      createLiveGameObstacle(obstacleLayer, stageWidth, {
        className: "block",
        width: 28 + Math.round(nextLiveGameRandom() * 20),
        height: 28 + Math.round(nextLiveGameRandom() * 16),
        hitHeight: 24 + Math.round(nextLiveGameRandom() * 14),
      });
      return;
    }

    createLiveGameObstacle(obstacleLayer, stageWidth, {
      className: "spike",
      width: 18 + Math.round(nextLiveGameRandom() * 10),
      height: 18 + Math.round(nextLiveGameRandom() * 8),
      hitHeight: 16,
    });
  }

  function finishLiveGameRun() {
    if (!liveGameRuntime.alive) {
      return;
    }
    liveGameRuntime.alive = false;
    syncLiveGameProgress(true);
    const status = document.getElementById("admin-live-game-status");
    if (status) {
      status.textContent = `Crashed at ${formatLiveGameDuration(liveGameLocalSurvivalMs)}. Wait for the next round or reset.`;
    }
  }

  function tickLiveGame(timestamp) {
    if (!liveGameRuntime.active || !liveGameRuntime.sessionId) {
      liveGameRuntime.rafId = 0;
      return;
    }

    if (!liveGameRuntime.lastTickAt) {
      liveGameRuntime.lastTickAt = timestamp;
    }

    const dt = Math.min(34, timestamp - liveGameRuntime.lastTickAt || 16);
    liveGameRuntime.lastTickAt = timestamp;
    const now = Date.now();
    const remainingMs = Math.max(0, liveGameRuntime.endsAt - now);
    const runnerLeft = 42;
    const runnerWidth = 34;
    const gravity = 0.00235;
    const obstacleSpeed = 0.18 + Math.min(0.1, liveGameLocalSurvivalMs / 180000);

    if (liveGameRuntime.alive && remainingMs > 0) {
      liveGameLocalSurvivalMs = Math.max(0, now - liveGameRuntime.joinedAt);
      liveGameRuntime.obstacleCooldownMs -= dt;
      if (liveGameRuntime.obstacleCooldownMs <= 0) {
        spawnLiveGameObstacle();
        liveGameRuntime.obstacleCooldownMs = 1250 + nextLiveGameRandom() * 1050;
      }

      liveGameRuntime.runnerVelocity -= gravity * dt;
      liveGameRuntime.runnerY = Math.max(0, liveGameRuntime.runnerY + liveGameRuntime.runnerVelocity * dt);
      if (liveGameRuntime.runnerY === 0 && liveGameRuntime.runnerVelocity < 0) {
        liveGameRuntime.runnerVelocity = 0;
      }

      liveGameRuntime.obstacles = liveGameRuntime.obstacles.filter(obstacle => {
        obstacle.x -= obstacleSpeed * dt * 60 / 16;
        const horizontalHit = obstacle.x < runnerLeft + runnerWidth && obstacle.x + obstacle.width > runnerLeft;
        const verticalHit = liveGameRuntime.runnerY < (obstacle.hitHeight || obstacle.height) - 4;
        if (horizontalHit && verticalHit) {
          finishLiveGameRun();
        }
        if (obstacle.x + obstacle.width < -24) {
          obstacle.element.remove();
          return false;
        }
        return true;
      });

      syncLiveGameProgress(false);
    }

    if (remainingMs <= 0) {
      liveGameRuntime.active = false;
      liveGameRuntime.alive = false;
      syncLiveGameProgress(true);
    }

    renderLiveGameStage();
    renderLiveGameState({
      active: true,
      sessionId: liveGameRuntime.sessionId,
      title: document.getElementById("admin-live-game-title")?.textContent || "Sky Sprint",
      buttonLabel: document.getElementById("admin-live-game-tap")?.textContent || "Jump",
      endsAt: liveGameRuntime.endsAt,
      totalPlayers: Number(document.getElementById("admin-live-game-overlay")?.dataset.totalPlayers || "0"),
      leaderboard: [],
    }, true);

    if (liveGameRuntime.active || liveGameRuntime.alive) {
      liveGameRuntime.rafId = requestAnimationFrame(tickLiveGame);
    } else {
      liveGameRuntime.rafId = 0;
    }
  }

  function ensureLiveGameRuntime(gameState) {
    const sessionId = Number(gameState?.sessionId) || 0;
    if (!sessionId) {
      return;
    }

    if (liveGameRuntime.sessionId !== sessionId) {
      resetLiveGameRuntime(sessionId);
      liveGameRuntime.seed = Number(gameState?.seed) || sessionId;
      liveGameRuntime.rngState = liveGameRuntime.seed || sessionId;
      liveGameRuntime.obstacleCooldownMs = 900;
    }

    liveGameRuntime.active = Boolean(gameState?.active);
    liveGameRuntime.endsAt = Number(gameState?.endsAt) || 0;
    if (!liveGameRuntime.joinedAt) {
      liveGameRuntime.joinedAt = Date.now() - liveGameLocalSurvivalMs;
    }
  }

  function renderLiveGameState(gameState, preserveLeaderboard = false) {
    if (!gameState?.active) {
      hideLiveGameOverlay();
      setSavedLiveGameSessionId(0);
      lastLiveGameSessionId = Number(gameState?.sessionId) || lastLiveGameSessionId;
      resetLiveGameRuntime(Number(gameState?.sessionId) || 0);
      return;
    }

    const overlay = ensureLiveGameOverlay();
    ensureLiveGameRuntime(gameState);
    armLiveGameRuntime(gameState);
    const title = document.getElementById("admin-live-game-title");
    const timer = document.getElementById("admin-live-game-timer");
    const player = document.getElementById("admin-live-game-player");
    const score = document.getElementById("admin-live-game-score");
    const status = document.getElementById("admin-live-game-status");
    const tapButton = document.getElementById("admin-live-game-tap");

    if (title) {
      title.textContent = gameState.title || "Sky Sprint";
    }

    const remainingMs = Math.max(0, Number(gameState.endsAt || 0) - Date.now());
    if (timer) {
      timer.textContent = `${Math.ceil(remainingMs / 1000)}s`;
    }

    if (player) {
      player.textContent = `Playing as ${getLiveGamePlayerName()}`;
    }

    if (score) {
      score.textContent = `Survived: ${formatLiveGameDuration(liveGameLocalSurvivalMs)}`;
    }

    if (status) {
      if (liveGameRuntime.alive && remainingMs > 0) {
        status.textContent = `Stay alive. Players: ${gameState.totalPlayers || 0}`;
      } else if (remainingMs > 0) {
        status.textContent = `Round live. Players: ${gameState.totalPlayers || 0}`;
      } else {
        status.textContent = "Final leaderboard";
      }
    }

    if (tapButton) {
      tapButton.textContent = gameState.buttonLabel || "Jump";
      tapButton.disabled = !liveGameRuntime.alive || remainingMs <= 0;
    }

    overlay.dataset.totalPlayers = String(gameState.totalPlayers || 0);
    overlay.classList.toggle("finished", remainingMs <= 0 || !liveGameRuntime.alive);
    if (!preserveLeaderboard) {
      renderLiveGameLeaderboard(gameState.leaderboard || []);
    }
  }

  async function joinLiveGame(gameState) {
    if (!gameState?.active || liveGameJoinInFlight) {
      return;
    }
    const currentSessionId = Number(gameState.sessionId) || 0;
    if (!currentSessionId || getSavedLiveGameSessionId() === currentSessionId) {
      return;
    }

    liveGameJoinInFlight = true;
    try {
      const res = await fetch("/api/live-game/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId: getChatVisitorId(),
          name: getLiveGamePlayerName(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return;
      }
      setSavedLiveGameSessionId(currentSessionId);
      lastLiveGameSessionId = currentSessionId;
      liveGameLocalSurvivalMs = Number(data?.player?.survivalMs) || 0;
      ensureLiveGameRuntime(data?.liveGame || gameState);
      liveGameRuntime.joinedAt = Date.now() - liveGameLocalSurvivalMs;
      liveGameRuntime.alive = data?.player?.alive !== false;
      armLiveGameRuntime(data?.liveGame || gameState);
      renderLiveGameState(data?.liveGame || gameState);
    } catch {
      // Ignore transient live game join errors silently.
    } finally {
      liveGameJoinInFlight = false;
    }
  }

  function normalizeProxyHijackUrl(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      return "";
    }
    if (/^http(s?):\/\//.test(trimmed)) {
      return trimmed;
    }
    if (trimmed.includes(".")) {
      return `https://${trimmed}`;
    }
    return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
  }

  function shouldBypassProxyOnHost() {
    const host = window.location.hostname.toLowerCase();
    return host.endsWith(".vercel.app");
  }

  function applyProxyUrlHijack(state) {
    const version = Number(state.proxyUrlHijackVersion) || 0;
    const rawUrl = state.proxyUrlHijack || "";
    if (!version || !rawUrl) {
      return;
    }

    const handledVersion = Number(sessionStorage.getItem("admin_proxy_url_hijack_version") || 0);
    if (version <= handledVersion) {
      return;
    }

    const normalizedUrl = normalizeProxyHijackUrl(rawUrl);
    if (!normalizedUrl) {
      return;
    }

    if (shouldBypassProxyOnHost()) {
      window.location.href = normalizedUrl;
      return;
    }

    sessionStorage.setItem("admin_proxy_url_hijack_version", String(version));

    if (window.location.pathname === "/d" && typeof window.adminOpenProxyUrl === "function") {
      window.adminOpenProxyUrl(normalizedUrl);
      return;
    }

    sessionStorage.setItem("GoUrl", __uv$config.encodeUrl(normalizedUrl));
    window.location.href = "/d";
  }

  function applyTabHijack(state) {
    const iconElement = document.getElementById("tab-favicon");
    const titleElement = document.getElementById("t");
    if (!iconElement || !titleElement) {
      return;
    }

    if (!titleElement.dataset.defaultTitle) {
      titleElement.dataset.defaultTitle = titleElement.textContent || document.title || "Home";
    }
    if (!iconElement.dataset.defaultHref) {
      iconElement.dataset.defaultHref = iconElement.getAttribute("href") || "favicon.png";
    }

    const nextTitle = state.tabTitleOverride || titleElement.dataset.defaultTitle;
    const nextFavicon = state.tabFaviconOverride || iconElement.dataset.defaultHref;

    titleElement.textContent = nextTitle;
    document.title = nextTitle;
    iconElement.setAttribute("href", nextFavicon);
  }

  function randomBinaryString(length = 40) {
    return Array.from({ length }, () => (Math.random() > 0.5 ? "1" : "0")).join(" ");
  }

  function ensureEffectStyles() {
    if (document.getElementById("admin-effects-style")) return;
    const style = document.createElement("style");
    style.id = "admin-effects-style";
    style.textContent = `
      body.takeover-matrix {
        background: radial-gradient(circle at top, rgba(29, 255, 141, .08), transparent 45%), #050a06 !important;
        color: #9affc9;
      }
      body.takeover-emergency {
        background: linear-gradient(135deg, #2b0000, #6f0909) !important;
        color: #ffe8e8;
      }
      body.takeover-arcade {
        background: radial-gradient(circle at top left, rgba(0,255,247,.18), transparent 35%), radial-gradient(circle at bottom right, rgba(255,0,183,.18), transparent 40%), #12091f !important;
        color: #f7ebff;
      }
      body.takeover-gold {
        background: linear-gradient(145deg, #14110b, #2a2314) !important;
        color: #fff0b3;
      }
      body.takeover-matrix .main,
      body.takeover-matrix .f-nav,
      body.takeover-matrix .nav,
      body.takeover-matrix .nav-bar,
      body.takeover-matrix button,
      body.takeover-matrix input {
        border-color: rgba(80, 255, 161, .32) !important;
        background: rgba(5, 21, 10, .75) !important;
        color: #9affc9 !important;
        box-shadow: 0 0 18px rgba(63, 255, 153, .12);
      }
      body.takeover-emergency .main,
      body.takeover-emergency .f-nav,
      body.takeover-emergency .nav,
      body.takeover-emergency .nav-bar,
      body.takeover-emergency button,
      body.takeover-emergency input {
        border-color: rgba(255, 125, 125, .28) !important;
        background: rgba(73, 8, 8, .76) !important;
        color: #fff0f0 !important;
        box-shadow: 0 0 22px rgba(255, 59, 59, .16);
      }
      body.takeover-arcade .main,
      body.takeover-arcade .f-nav,
      body.takeover-arcade .nav,
      body.takeover-arcade .nav-bar,
      body.takeover-arcade button,
      body.takeover-arcade input {
        border-color: rgba(255, 95, 214, .32) !important;
        background: rgba(31, 10, 47, .76) !important;
        color: #fff1ff !important;
        box-shadow: 0 0 26px rgba(0, 241, 255, .14);
      }
      body.takeover-gold .main,
      body.takeover-gold .f-nav,
      body.takeover-gold .nav,
      body.takeover-gold .nav-bar,
      body.takeover-gold button,
      body.takeover-gold input {
        border-color: rgba(255, 211, 97, .34) !important;
        background: rgba(42, 31, 11, .78) !important;
        color: #fff0b3 !important;
        box-shadow: 0 0 26px rgba(255, 208, 76, .12);
      }
      body.takeover-matrix::after {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background: repeating-linear-gradient(to bottom, rgba(95,255,143,.03), rgba(95,255,143,.03) 2px, transparent 2px, transparent 6px);
        z-index: 2;
      }
      #admin-matrix-overlay {
        position: fixed;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
        z-index: 1;
      }
      .admin-matrix-column {
        position: absolute;
        top: -120%;
        color: rgba(111, 255, 163, 0.7);
        font: 700 18px/1 monospace;
        text-shadow: 0 0 10px rgba(111, 255, 163, 0.4);
        white-space: pre;
        writing-mode: vertical-rl;
        text-orientation: upright;
        user-select: none;
        animation-name: admin-matrix-fall;
        animation-timing-function: linear;
        animation-iteration-count: infinite;
      }
      @keyframes admin-matrix-fall {
        0% { transform: translateY(-120%); opacity: 0; }
        8% { opacity: 0.9; }
        100% { transform: translateY(220vh); opacity: 0.15; }
      }
      #admin-broadcast-banner {
        position: fixed;
        top: 74px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 8000;
        max-width: min(92vw, 980px);
        padding: 10px 14px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.28);
        background: rgba(11, 56, 52, .86);
        color: #f3fffd;
        text-align: center;
        box-shadow: 0 10px 26px rgba(0,0,0,.28);
        backdrop-filter: blur(8px);
        pointer-events: none;
      }
      #admin-global-popup {
        position: fixed;
        inset: 0;
        z-index: 9500;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        pointer-events: none;
        background: rgba(2, 11, 14, 0.55);
        backdrop-filter: blur(8px);
      }
      #admin-global-popup-card {
        pointer-events: auto;
        width: min(560px, 92vw);
        border-radius: 18px;
        border: 1px solid rgba(255,255,255,.24);
        background: linear-gradient(135deg, rgba(10, 82, 76, .92), rgba(16, 108, 100, .86));
        box-shadow: 0 26px 60px rgba(0,0,0,.34);
        padding: 24px;
        color: #f3fffd;
        text-align: center;
      }
      #admin-global-popup-card h2 {
        margin: 0 0 10px;
        font-size: clamp(1.35rem, 2.5vw, 2rem);
        letter-spacing: .04em;
      }
      #admin-global-popup-card p {
        margin: 0;
        font-size: 1rem;
        line-height: 1.6;
        color: rgba(243,255,253,.88);
      }
      #admin-global-popup-card button {
        margin-top: 18px;
        min-width: 140px;
      }
      #admin-maintenance-overlay {
        position: fixed;
        inset: 0;
        z-index: 9700;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: radial-gradient(circle at 20% 20%, rgba(17, 62, 56, .65), rgba(2, 8, 10, .92));
        backdrop-filter: blur(8px);
      }
      #admin-maintenance-card {
        width: min(620px, 94vw);
        border-radius: 18px;
        border: 1px solid rgba(255,255,255,.22);
        background: linear-gradient(145deg, rgba(9, 58, 53, .92), rgba(7, 38, 35, .92));
        box-shadow: 0 24px 50px rgba(0,0,0,.42);
        padding: 24px;
        text-align: center;
        color: #f3fffd;
      }
      #admin-maintenance-card h2 {
        margin: 0 0 10px;
        font-size: clamp(1.3rem, 2.3vw, 2rem);
        letter-spacing: .05em;
      }
      #admin-maintenance-card p {
        margin: 0;
        line-height: 1.55;
        color: rgba(243,255,253,.86);
      }
      #admin-live-game-overlay {
        position: fixed;
        inset: 0;
        z-index: 9650;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        pointer-events: none;
      }
      #admin-live-game-card {
        pointer-events: auto;
        width: min(420px, calc(100vw - 32px));
        border-radius: 18px;
        border: 1px solid rgba(255,255,255,.2);
        background: linear-gradient(145deg, rgba(9, 36, 55, .94), rgba(16, 88, 123, .88));
        box-shadow: 0 24px 54px rgba(0,0,0,.36);
        padding: 18px;
        color: #f3fffd;
      }
      #admin-live-game-topline,
      #admin-live-game-meta,
      .admin-live-game-entry {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      #admin-live-game-kicker {
        font-size: 11px;
        letter-spacing: .12em;
        text-transform: uppercase;
        color: rgba(243,255,253,.68);
      }
      #admin-live-game-title {
        margin: 4px 0 0;
        font-size: clamp(1.2rem, 3vw, 1.6rem);
      }
      #admin-live-game-timer {
        font: 700 1.2rem/1 monospace;
        padding: 8px 10px;
        border-radius: 999px;
        background: rgba(255,255,255,.12);
      }
      #admin-live-game-meta {
        margin-top: 14px;
        font-size: 13px;
        color: rgba(243,255,253,.82);
      }
      #admin-live-game-stage {
        position: relative;
        overflow: hidden;
        height: 148px;
        margin-top: 14px;
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,.18);
        background: linear-gradient(180deg, rgba(164, 230, 255, .18), rgba(25, 74, 120, .22) 55%, rgba(15, 34, 49, .66) 56%, rgba(10, 24, 34, .88) 100%);
      }
      #admin-live-game-track {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 22px;
        height: 3px;
        background: repeating-linear-gradient(to right, rgba(255,255,255,.3) 0 18px, transparent 18px 30px);
      }
      #admin-live-game-obstacles {
        position: absolute;
        inset: 0;
      }
      #admin-live-game-runner,
      .admin-live-game-obstacle {
        position: absolute;
        bottom: 22px;
      }
      #admin-live-game-runner {
        left: 42px;
        width: 34px;
        height: 34px;
        border-radius: 10px;
        background: linear-gradient(145deg, #9fffe7, #45ddb4);
        box-shadow: 0 10px 18px rgba(0,0,0,.25);
        will-change: transform;
      }
      #admin-live-game-runner::before,
      #admin-live-game-runner::after {
        content: "";
        position: absolute;
        top: 8px;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #052b1f;
      }
      #admin-live-game-runner::before {
        left: 8px;
      }
      #admin-live-game-runner::after {
        right: 8px;
      }
      .admin-live-game-obstacle {
        width: 28px;
        min-height: 28px;
        border-radius: 8px 8px 3px 3px;
        background: linear-gradient(180deg, rgba(255, 157, 101, .96), rgba(158, 67, 38, .96));
        box-shadow: 0 10px 18px rgba(0,0,0,.22);
        will-change: transform;
      }
      .admin-live-game-obstacle.block {
        border-radius: 8px 8px 3px 3px;
        background: linear-gradient(180deg, rgba(255, 180, 112, .96), rgba(166, 83, 45, .96));
      }
      .admin-live-game-obstacle.tall {
        border-radius: 10px 10px 4px 4px;
        background: linear-gradient(180deg, rgba(255, 139, 96, .98), rgba(129, 46, 31, .98));
        box-shadow: 0 12px 22px rgba(0,0,0,.28);
      }
      .admin-live-game-obstacle.spike {
        min-height: 16px;
        border-radius: 0;
        background: linear-gradient(180deg, rgba(255, 226, 144, .98), rgba(224, 102, 55, .96));
        clip-path: polygon(50% 0, 100% 100%, 0 100%);
        box-shadow: none;
      }
      .admin-live-game-obstacle.spike.alt {
        background: linear-gradient(180deg, rgba(255, 244, 184, .98), rgba(242, 123, 66, .96));
      }
      #admin-live-game-tap {
        width: 100%;
        margin-top: 14px;
        border-radius: 14px;
        border: 1px solid rgba(255,255,255,.2);
        padding: 16px 18px;
        background: linear-gradient(145deg, rgba(94, 239, 201, .28), rgba(25, 176, 197, .24));
        color: #f3fffd;
        font: 700 1.1rem/1.1 inherit;
        cursor: pointer;
      }
      #admin-live-game-tap:disabled {
        opacity: .55;
        cursor: not-allowed;
      }
      #admin-live-game-status {
        margin-top: 10px;
        min-height: 16px;
        font-size: 12px;
        color: rgba(243,255,253,.72);
      }
      #admin-live-game-leaderboard-title {
        margin-top: 14px;
        font-size: 12px;
        letter-spacing: .12em;
        text-transform: uppercase;
        color: rgba(243,255,253,.66);
      }
      #admin-live-game-leaderboard {
        display: grid;
        gap: 7px;
        margin-top: 10px;
      }
      .admin-live-game-entry {
        border-radius: 12px;
        background: rgba(255,255,255,.08);
        padding: 9px 10px;
        font-size: 13px;
      }
      .admin-live-game-entry.own {
        background: rgba(91, 240, 192, .16);
        border: 1px solid rgba(91, 240, 192, .24);
      }
      .admin-live-game-rank {
        width: 30px;
        color: rgba(243,255,253,.7);
      }
      .admin-live-game-name {
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .admin-live-game-points {
        font-weight: 700;
      }
      .admin-live-game-empty {
        border-radius: 12px;
        background: rgba(255,255,255,.06);
        padding: 12px;
        font-size: 13px;
        color: rgba(243,255,253,.68);
        text-align: center;
      }
      #admin-live-game-overlay.finished #admin-live-game-tap {
        background: rgba(255,255,255,.08);
      }
      @media (max-width: 640px) {
        #admin-live-game-overlay {
          padding: 12px;
        }
      }
      #admin-jumpscare-overlay {
        position: fixed;
        inset: 0;
        z-index: 9800;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 12px;
        pointer-events: none;
        opacity: 0;
        background: radial-gradient(circle at center, rgba(255, 0, 0, 0.84) 0%, rgba(15, 0, 0, 0.94) 42%, rgba(0, 0, 0, 1) 100%);
      }
      #admin-jumpscare-overlay.active {
        animation: admin-jumpscare-pop 210ms ease-out both;
      }
      #admin-jumpscare-title {
        color: #ffffff;
        font-family: Impact, Haettenschweiler, "Arial Black", sans-serif;
        font-size: clamp(2rem, 9vw, 5.8rem);
        letter-spacing: .08em;
        text-shadow: 0 0 20px rgba(255, 0, 0, .95), 0 0 40px rgba(0, 0, 0, .9);
        transform: rotate(-2deg);
      }
      #admin-jumpscare-face {
        width: min(56vw, 420px);
        aspect-ratio: 1 / 1;
        border-radius: 50%;
        background: radial-gradient(circle at 50% 58%, #0d0d0d 0%, #070707 48%, #000 100%);
        box-shadow: 0 0 80px rgba(255, 40, 40, .82), inset 0 -20px 40px rgba(255, 0, 0, .25);
        position: relative;
      }
      .admin-jumpscare-eye {
        position: absolute;
        top: 33%;
        width: 16%;
        height: 16%;
        border-radius: 50%;
        background: #ff2d2d;
        box-shadow: 0 0 35px rgba(255, 32, 32, .95);
      }
      .admin-jumpscare-eye.left {
        left: 27%;
      }
      .admin-jumpscare-eye.right {
        right: 27%;
      }
      #admin-jumpscare-mouth {
        position: absolute;
        left: 50%;
        bottom: 19%;
        transform: translateX(-50%);
        width: 40%;
        height: 21%;
        border-radius: 0 0 50% 50%;
        background: linear-gradient(to bottom, #090909, #330000 70%, #770000);
        box-shadow: inset 0 12px 18px rgba(255, 15, 15, .25);
      }
      body.admin-jumpscare-shake {
        animation: admin-jumpscare-shake 360ms ease-in-out 2;
      }
      @keyframes admin-jumpscare-pop {
        0% { transform: scale(.84); filter: blur(8px); opacity: 0; }
        14% { transform: scale(1.07); filter: blur(1px); opacity: 1; }
        26% { transform: scale(.99); }
        100% { transform: scale(1); filter: blur(0); opacity: 1; }
      }
      @keyframes admin-jumpscare-shake {
        0%, 100% { transform: translate(0, 0); }
        20% { transform: translate(-10px, 6px); }
        40% { transform: translate(12px, -8px); }
        60% { transform: translate(-8px, -5px); }
        80% { transform: translate(8px, 7px); }
      }
      #proxy-chat-widget {
        position: fixed;
        left: 16px;
        bottom: 16px;
        z-index: 9400;
        width: min(420px, calc(100vw - 32px));
        max-width: calc(100vw - 32px);
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,.24);
        background: linear-gradient(145deg, rgba(6, 36, 34, .9), rgba(10, 68, 63, .82));
        box-shadow: 0 16px 36px rgba(0,0,0,.28);
        backdrop-filter: blur(10px);
        overflow: hidden;
      }
      #proxy-chat-widget,
      #proxy-chat-widget * {
        box-sizing: border-box;
      }
      #proxy-chat-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        background: rgba(255,255,255,.06);
        border-bottom: 1px solid rgba(255,255,255,.12);
        cursor: grab;
        touch-action: none;
      }
      #proxy-chat-widget.dragging #proxy-chat-header {
        cursor: grabbing;
      }
      #proxy-chat-title-wrap {
        min-width: 0;
        flex: 1 1 auto;
      }
      #proxy-chat-title {
        font: 700 14px/1.2 inherit;
        letter-spacing: .04em;
        color: #f3fffd;
      }
      #proxy-chat-name-badge {
        flex: 1 1 auto;
        min-width: 0;
        max-width: 58%;
        font-size: 12px;
        color: rgba(243,255,253,.7);
        text-align: right;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #proxy-chat-toggle {
        flex: 0 0 34px !important;
        width: 34px !important;
        min-width: 34px;
        padding: 7px 0 !important;
        border-radius: 9px;
        font-size: 18px;
        line-height: 1;
      }
      #proxy-chat-body {
        display: grid;
        gap: 10px;
        padding: 12px;
      }
      #proxy-chat-widget.collapsed {
        width: min(260px, calc(100vw - 32px));
      }
      #proxy-chat-widget.collapsed #proxy-chat-body {
        display: none;
      }
      #proxy-chat-name-row,
      #proxy-chat-compose {
        display: flex;
        align-items: stretch;
        gap: 8px;
        width: 100%;
      }
      #proxy-chat-widget input,
      #proxy-chat-widget button {
        font-family: inherit;
      }
      #proxy-chat-widget input {
        flex: 1 1 0;
        min-width: 0;
        width: auto !important;
        max-width: 100%;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,.18);
        padding: 9px 11px;
        background: rgba(255,255,255,.08);
        color: #f3fffd;
        outline: none;
      }
      #proxy-chat-widget input::placeholder {
        color: rgba(243,255,253,.48);
      }
      #proxy-chat-widget button {
        flex: 0 0 auto;
        width: auto;
        max-width: 100%;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,.2);
        padding: 9px 12px;
        background: rgba(255,255,255,.12);
        color: #f3fffd;
        cursor: pointer;
        white-space: nowrap;
      }
      #proxy-chat-widget button:hover {
        background: rgba(255,255,255,.2);
      }
      #proxy-chat-widget button:disabled,
      #proxy-chat-widget input:disabled {
        opacity: .55;
        cursor: not-allowed;
      }
      #proxy-chat-messages {
        height: 240px;
        overflow-y: auto;
        display: grid;
        gap: 8px;
        padding-right: 4px;
      }
      .proxy-chat-empty {
        padding: 20px 10px;
        text-align: center;
        font-size: 13px;
        color: rgba(243,255,253,.62);
      }
      .proxy-chat-message {
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(255,255,255,.08);
        border: 1px solid rgba(255,255,255,.08);
      }
      .proxy-chat-message.system {
        background: linear-gradient(145deg, rgba(70, 164, 214, .18), rgba(54, 120, 198, .12));
        border-color: rgba(139, 216, 255, .45);
        box-shadow: inset 0 0 0 1px rgba(139, 216, 255, .2);
      }
      .proxy-chat-message.own {
        background: rgba(77, 233, 193, .14);
        border-color: rgba(77, 233, 193, .2);
      }
      .proxy-chat-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 4px;
        font-size: 11px;
        color: rgba(243,255,253,.62);
      }
      .proxy-chat-author-wrap {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .proxy-chat-author {
        color: #f3fffd;
        font-weight: 700;
      }
      .proxy-chat-tag {
        padding: 1px 6px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.16);
        background: rgba(255,255,255,.08);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .06em;
      }
      .proxy-chat-text {
        color: rgba(243,255,253,.88);
        font-size: 13px;
        line-height: 1.45;
        word-break: break-word;
      }
      #proxy-chat-status {
        min-height: 15px;
        font-size: 12px;
        color: rgba(243,255,253,.66);
      }
      #proxy-chat-status.error {
        color: #ffd4d4;
      }
      @media (max-width: 640px) {
        #proxy-chat-widget {
          left: 12px;
          right: 12px;
          bottom: 108px;
          width: auto;
        }
        #proxy-chat-name-row,
        #proxy-chat-compose {
          flex-wrap: wrap;
        }
        #proxy-chat-name-badge {
          max-width: 50%;
        }
        #proxy-chat-widget.collapsed {
          width: auto;
        }
        #proxy-chat-widget button,
        #proxy-chat-widget input {
          width: 100% !important;
        }
      }
      #admin-weather-overlay {
        position: fixed;
        inset: 0;
        pointer-events: none;
        overflow: hidden;
        z-index: 3;
      }
      #admin-weather-overlay.weather-rain,
      #admin-weather-overlay.weather-hail,
      #admin-weather-overlay.weather-lightning {
        background: linear-gradient(to bottom, rgba(7, 15, 24, .12), transparent 30%, rgba(4, 10, 18, .08));
      }
      #admin-weather-overlay.weather-fog {
        background: radial-gradient(circle at 20% 40%, rgba(235, 243, 255, .16), transparent 35%), radial-gradient(circle at 80% 60%, rgba(235, 243, 255, .14), transparent 42%);
      }
      #admin-weather-overlay.weather-lightning {
        background: radial-gradient(circle at 20% 10%, rgba(255, 255, 255, .08), transparent 28%), linear-gradient(to bottom, rgba(3, 7, 13, .42), rgba(6, 12, 20, .18) 38%, rgba(3, 8, 12, .28));
      }
      .admin-weather-cloud {
        position: absolute;
        top: 0;
        width: 38vw;
        min-width: 220px;
        height: 110px;
        background: radial-gradient(circle at 20% 50%, rgba(246, 250, 255, .16), transparent 26%), radial-gradient(circle at 46% 38%, rgba(246, 250, 255, .2), transparent 30%), radial-gradient(circle at 68% 52%, rgba(246, 250, 255, .15), transparent 27%);
        filter: blur(8px);
        opacity: .75;
      }
      .admin-weather-rain-drop,
      .admin-weather-hail-drop,
      .admin-weather-snowflake {
        position: absolute;
        top: -12vh;
        pointer-events: none;
        animation-timing-function: linear;
        animation-iteration-count: infinite;
      }
      .admin-weather-rain-drop {
        width: 2px;
        height: 18px;
        background: linear-gradient(to bottom, rgba(205, 233, 255, 0), rgba(205, 233, 255, .82));
        transform: rotate(12deg);
        animation-name: admin-rain-fall;
      }
      .admin-weather-hail-drop {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: rgba(240, 247, 255, .92);
        box-shadow: 0 0 8px rgba(255,255,255,.24);
        animation-name: admin-hail-fall;
      }
      .admin-weather-snowflake {
        color: rgba(255,255,255,.92);
        font-size: 14px;
        text-shadow: 0 0 8px rgba(255,255,255,.22);
        animation-name: admin-snow-fall;
      }
      .admin-weather-fog-layer {
        position: absolute;
        left: -10%;
        width: 120%;
        height: 28%;
        background: radial-gradient(circle at 20% 50%, rgba(236, 244, 255, .16), transparent 24%), radial-gradient(circle at 50% 60%, rgba(236, 244, 255, .12), transparent 28%), radial-gradient(circle at 80% 40%, rgba(236, 244, 255, .14), transparent 24%);
        filter: blur(18px);
        animation: admin-fog-drift 18s ease-in-out infinite alternate;
      }
      .admin-weather-flash {
        position: absolute;
        inset: 0;
        background: rgba(214, 233, 255, .0);
      }
      .admin-weather-flash.active {
        animation: admin-lightning-flash .55s ease-out;
      }
      .admin-weather-bolt {
        position: absolute;
        top: 8%;
        width: 16px;
        height: 42vh;
        opacity: 0;
        filter: drop-shadow(0 0 14px rgba(255,255,255,.9));
        clip-path: polygon(40% 0, 78% 0, 54% 28%, 88% 28%, 22% 100%, 42% 54%, 12% 54%);
        background: linear-gradient(to bottom, rgba(255,255,255,.98), rgba(201, 232, 255, .74));
      }
      .admin-weather-flash.active .admin-weather-bolt,
      .admin-weather-bolt.active {
        animation: admin-lightning-bolt .48s ease-out;
      }
      @keyframes admin-rain-fall {
        from { transform: translate3d(0, -10vh, 0) rotate(12deg); opacity: .2; }
        to { transform: translate3d(-90px, 120vh, 0) rotate(12deg); opacity: .95; }
      }
      @keyframes admin-hail-fall {
        from { transform: translate3d(0, -8vh, 0); opacity: .5; }
        to { transform: translate3d(-50px, 120vh, 0); opacity: 1; }
      }
      @keyframes admin-snow-fall {
        from { transform: translate3d(0, -10vh, 0); opacity: .2; }
        to { transform: translate3d(60px, 120vh, 0); opacity: 1; }
      }
      @keyframes admin-fog-drift {
        from { transform: translateX(-3%) translateY(0); opacity: .55; }
        to { transform: translateX(3%) translateY(2%); opacity: .85; }
      }
      @keyframes admin-lightning-flash {
        0% { background: rgba(214, 233, 255, 0); }
        12% { background: rgba(214, 233, 255, .42); }
        20% { background: rgba(255,255,255,.08); }
        26% { background: rgba(214, 233, 255, .56); }
        100% { background: rgba(214, 233, 255, 0); }
      }
      @keyframes admin-lightning-bolt {
        0% { opacity: 0; transform: scaleY(.72) skewX(-10deg); }
        16% { opacity: .96; transform: scaleY(1.02) skewX(-10deg); }
        40% { opacity: .38; transform: scaleY(.96) skewX(-10deg); }
        100% { opacity: 0; transform: scaleY(.7) skewX(-10deg); }
      }
      body.party-mode::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 1;
        background: rgba(255, 0, 80, 0.2);
        animation: admin-party-flash 1.25s steps(1, end) infinite;
      }
      @keyframes admin-party-flash {
        0% { background: rgba(255, 0, 80, 0.22); }
        20% { background: rgba(0, 255, 110, 0.22); }
        40% { background: rgba(0, 140, 255, 0.22); }
        60% { background: rgba(255, 40, 200, 0.22); }
        80% { background: rgba(255, 210, 0, 0.22); }
        100% { background: rgba(255, 0, 80, 0.22); }
      }
      body.chaos-mode {
        animation: admin-chaos-shake .35s steps(2, end) infinite;
      }
      body.chaos-mode .main,
      body.chaos-mode .f-nav,
      body.chaos-mode .nav,
      body.chaos-mode .nav-bar {
        animation: admin-chaos-pop .65s ease-in-out infinite alternate;
      }
      body.chaos-mode .title,
      body.chaos-mode .navbar-link,
      body.chaos-mode button,
      body.chaos-mode input {
        filter: hue-rotate(120deg) saturate(1.4);
      }
      .admin-confetti-piece {
        position: fixed;
        top: -20px;
        width: 10px;
        height: 18px;
        border-radius: 2px;
        pointer-events: none;
        z-index: 9000;
        opacity: .92;
        will-change: transform, opacity;
      }
      @keyframes admin-chaos-shake {
        0% { transform: translate(0, 0) rotate(0deg); }
        25% { transform: translate(1px, -1px) rotate(-.6deg); }
        50% { transform: translate(-2px, 1px) rotate(.8deg); }
        75% { transform: translate(2px, 2px) rotate(-.5deg); }
        100% { transform: translate(-1px, -2px) rotate(.4deg); }
      }
      @keyframes admin-chaos-pop {
        0% { transform: scale(1) rotate(-1deg); }
        100% { transform: scale(1.02) rotate(1deg); }
      }
    `;
    document.head.appendChild(style);
  }

  function blastConfetti(pieceCount = 90) {
    const availableSlots = Math.max(0, MAX_ACTIVE_CONFETTI_PIECES - activeConfettiPieces);
    const safePieceCount = Math.min(pieceCount, availableSlots);
    if (safePieceCount <= 0) {
      return;
    }

    const colors = ["#ff295f", "#24ff72", "#1da1ff", "#ff4fd8", "#ffd429", "#ffffff"];
    for (let index = 0; index < safePieceCount; index += 1) {
      const piece = document.createElement("div");
      piece.className = "admin-confetti-piece";
      piece.style.left = `${Math.random() * 100}vw`;
      piece.style.background = colors[index % colors.length];
      piece.style.transform = `translate3d(0, 0, 0) rotate(${Math.random() * 360}deg)`;
      document.body.appendChild(piece);
      activeConfettiPieces += 1;

      const drift = (Math.random() - 0.5) * 220;
      const fall = window.innerHeight + 120 + Math.random() * 180;
      const spin = 360 + Math.random() * 720;
      const duration = 1200 + Math.random() * 1200;

      piece.animate(
        [
          { transform: `translate3d(0, -20px, 0) rotate(0deg)`, opacity: 1 },
          { transform: `translate3d(${drift}px, ${fall}px, 0) rotate(${spin}deg)`, opacity: 0.1 },
        ],
        { duration, easing: "cubic-bezier(.18,.74,.34,.98)", fill: "forwards" },
      );

      setTimeout(() => {
        piece.remove();
        activeConfettiPieces = Math.max(0, activeConfettiPieces - 1);
      }, duration + 60);
    }
  }

  function startConfettiLoop() {
    if (confettiIntervalId !== null) {
      return;
    }

    blastConfetti(14);
    confettiIntervalId = window.setInterval(() => {
      blastConfetti(8);
    }, 900);
  }

  function stopConfettiLoop() {
    if (confettiIntervalId === null) {
      return;
    }
    window.clearInterval(confettiIntervalId);
    confettiIntervalId = null;
  }

  function disableWeatherOverlay() {
    document.getElementById("admin-weather-overlay")?.remove();
    if (weatherFlashIntervalId !== null) {
      window.clearInterval(weatherFlashIntervalId);
      weatherFlashIntervalId = null;
    }
    weatherCurrentEffect = "";
  }

  function startWeatherFlashLoop(overlay) {
    if (weatherFlashIntervalId !== null) {
      window.clearInterval(weatherFlashIntervalId);
    }
    const isLightningStorm = overlay.classList.contains("weather-lightning");
    const interval = isLightningStorm ? 1200 : 1800;
    weatherFlashIntervalId = window.setInterval(() => {
      const flash = overlay.querySelector(".admin-weather-flash");
      if (!flash) {
        return;
      }
      const shouldFlash = isLightningStorm ? Math.random() < 0.82 : Math.random() < 0.55;
      if (!shouldFlash) {
        return;
      }
      flash.classList.remove("active");
      for (const bolt of flash.querySelectorAll(".admin-weather-bolt")) {
        bolt.classList.remove("active");
        bolt.style.left = `${randomBetween(12, 82)}%`;
        bolt.style.height = `${randomBetween(24, 54)}vh`;
      }
      void flash.offsetWidth;
      flash.classList.add("active");
      for (const bolt of flash.querySelectorAll(".admin-weather-bolt")) {
        bolt.classList.add("active");
      }
    }, interval + Math.random() * interval);
  }

  function addStormClouds(overlay, count = 3) {
    for (let index = 0; index < count; index += 1) {
      const cloud = document.createElement("div");
      cloud.className = "admin-weather-cloud";
      cloud.style.left = `${index * 24 - 8}%`;
      cloud.style.top = `${2 + (index % 2) * 3}%`;
      cloud.style.opacity = `${0.72 + index * 0.05}`;
      cloud.style.transform = `scale(${1 + index * 0.08})`;
      overlay.appendChild(cloud);
    }
  }

  function addLightningFlashLayer(overlay, boltCount = 2) {
    const flash = document.createElement("div");
    flash.className = "admin-weather-flash";
    for (let index = 0; index < boltCount; index += 1) {
      const bolt = document.createElement("div");
      bolt.className = "admin-weather-bolt";
      bolt.style.left = `${randomBetween(12, 82)}%`;
      bolt.style.height = `${randomBetween(24, 54)}vh`;
      flash.appendChild(bolt);
    }
    overlay.appendChild(flash);
    startWeatherFlashLoop(overlay);
  }

  function enableWeatherOverlay(effect) {
    if (weatherCurrentEffect === effect && document.getElementById("admin-weather-overlay")) {
      return;
    }

    disableWeatherOverlay();

    if (!effect) {
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = "admin-weather-overlay";
    overlay.className = `weather-${effect}`;

    if (effect === "rain" || effect === "hail" || effect === "lightning") {
      addStormClouds(overlay, effect === "lightning" ? 4 : 3);
    }

    if (effect === "rain") {
      for (let index = 0; index < 36; index += 1) {
        const drop = document.createElement("div");
        drop.className = "admin-weather-rain-drop";
        drop.style.left = `${Math.random() * 100}%`;
        drop.style.animationDuration = `${0.8 + Math.random() * 0.7}s`;
        drop.style.animationDelay = `${Math.random() * -1.5}s`;
        overlay.appendChild(drop);
      }
      addLightningFlashLayer(overlay, 1);
    }

    if (effect === "hail") {
      for (let index = 0; index < 32; index += 1) {
        const hail = document.createElement("div");
        hail.className = "admin-weather-hail-drop";
        hail.style.left = `${Math.random() * 100}%`;
        hail.style.animationDuration = `${0.7 + Math.random() * 0.5}s`;
        hail.style.animationDelay = `${Math.random() * -1.2}s`;
        overlay.appendChild(hail);
      }
      addLightningFlashLayer(overlay, 2);
    }

    if (effect === "lightning") {
      for (let index = 0; index < 18; index += 1) {
        const drop = document.createElement("div");
        drop.className = "admin-weather-rain-drop";
        drop.style.left = `${Math.random() * 100}%`;
        drop.style.height = `${12 + Math.random() * 12}px`;
        drop.style.opacity = `${0.3 + Math.random() * 0.45}`;
        drop.style.animationDuration = `${0.65 + Math.random() * 0.45}s`;
        drop.style.animationDelay = `${Math.random() * -1.4}s`;
        overlay.appendChild(drop);
      }
      addLightningFlashLayer(overlay, 3);
    }

    if (effect === "snow") {
      for (let index = 0; index < 28; index += 1) {
        const flake = document.createElement("div");
        flake.className = "admin-weather-snowflake";
        flake.textContent = Math.random() > 0.5 ? "*" : "❄";
        flake.style.left = `${Math.random() * 100}%`;
        flake.style.fontSize = `${10 + Math.random() * 12}px`;
        flake.style.animationDuration = `${5 + Math.random() * 6}s`;
        flake.style.animationDelay = `${Math.random() * -8}s`;
        overlay.appendChild(flake);
      }
    }

    if (effect === "fog") {
      for (let index = 0; index < 4; index += 1) {
        const layer = document.createElement("div");
        layer.className = "admin-weather-fog-layer";
        layer.style.top = `${8 + index * 20}%`;
        layer.style.animationDuration = `${14 + index * 3}s`;
        layer.style.animationDelay = `${index * -2}s`;
        overlay.appendChild(layer);
      }
    }

    document.body.appendChild(overlay);
    weatherCurrentEffect = effect;
  }

  function disableMatrixOverlay() {
    document.getElementById("admin-matrix-overlay")?.remove();
  }

  function hideGlobalPopup() {
    const overlay = document.getElementById("admin-global-popup");
    if (!overlay) {
      return;
    }
    overlay.style.display = "none";
  }

  function ensureGlobalPopupOverlay() {
    let overlay = document.getElementById("admin-global-popup");
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = "admin-global-popup";
    overlay.innerHTML = `
      <div id="admin-global-popup-card">
        <h2></h2>
        <p></p>
        <button type="button">Close</button>
      </div>
    `;

    const button = overlay.querySelector("button");
    button.addEventListener("click", () => {
      dismissedPopupVersion = Number(overlay.dataset.popupVersion || "0") || dismissedPopupVersion;
      hideGlobalPopup();
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function hideMaintenanceOverlay() {
    const overlay = document.getElementById("admin-maintenance-overlay");
    if (!overlay) {
      return;
    }
    overlay.style.display = "none";
  }

  function ensureMaintenanceOverlay() {
    let overlay = document.getElementById("admin-maintenance-overlay");
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = "admin-maintenance-overlay";
    overlay.innerHTML = `
      <div id="admin-maintenance-card">
        <h2>Maintenance Mode</h2>
        <p></p>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function showMaintenanceOverlay(message) {
    const overlay = ensureMaintenanceOverlay();
    const copy = overlay.querySelector("p");
    if (copy) {
      copy.textContent = message || "Maintenance in progress. Please check back soon.";
    }
    overlay.style.display = "flex";
  }

  function ensureJumpscareOverlay() {
    let overlay = document.getElementById("admin-jumpscare-overlay");
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = "admin-jumpscare-overlay";
    overlay.innerHTML = `
      <div id="admin-jumpscare-title">DON'T LOOK BEHIND YOU</div>
      <div id="admin-jumpscare-face" aria-hidden="true">
        <div class="admin-jumpscare-eye left"></div>
        <div class="admin-jumpscare-eye right"></div>
        <div id="admin-jumpscare-mouth"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    return overlay;
  }

  function playJumpscareScream() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      return;
    }

    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 1.35);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);

    for (let index = 0; index < bufferSize; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / bufferSize);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(1700, now);
    noiseFilter.Q.setValueAtTime(0.8, now);

    const oscA = ctx.createOscillator();
    oscA.type = "sawtooth";
    oscA.frequency.setValueAtTime(620, now);
    oscA.frequency.exponentialRampToValueAtTime(320, now + 0.45);

    const oscB = ctx.createOscillator();
    oscB.type = "triangle";
    oscB.frequency.setValueAtTime(980, now);
    oscB.frequency.exponentialRampToValueAtTime(540, now + 0.7);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.55, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 8;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.22;

    noise.connect(noiseFilter);
    noiseFilter.connect(gain);
    oscA.connect(gain);
    oscB.connect(gain);
    gain.connect(compressor);
    compressor.connect(ctx.destination);

    noise.start(now);
    oscA.start(now);
    oscB.start(now);

    noise.stop(now + 1.3);
    oscA.stop(now + 1.3);
    oscB.stop(now + 1.3);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1500);
  }

  function triggerAdminJumpscare() {
    const overlay = ensureJumpscareOverlay();
    overlay.classList.remove("active");
    overlay.style.display = "flex";
    void overlay.offsetWidth;
    overlay.classList.add("active");
    document.body.classList.add("admin-jumpscare-shake");

    playJumpscareScream();

    setTimeout(() => {
      overlay.style.display = "none";
      overlay.classList.remove("active");
      document.body.classList.remove("admin-jumpscare-shake");
    }, 1100);
  }

  function showGlobalPopup(state) {
    const popupVersion = Number(state.popupVersion) || 0;
    if (!state.popupTitle && !state.popupMessage) {
      hideGlobalPopup();
      return;
    }
    if (dismissedPopupVersion === popupVersion) {
      return;
    }

    const overlay = ensureGlobalPopupOverlay();
    overlay.dataset.popupVersion = String(popupVersion);

    const heading = overlay.querySelector("h2");
    const copy = overlay.querySelector("p");
    const button = overlay.querySelector("button");
    if (heading) {
      heading.textContent = state.popupTitle || "Message";
    }
    if (copy) {
      copy.textContent = state.popupMessage || "";
    }
    if (button) {
      button.textContent = state.popupButtonText || "Close";
    }
    overlay.style.display = "flex";
  }

  function enableMatrixOverlay() {
    let overlay = document.getElementById("admin-matrix-overlay");
    if (overlay) {
      return;
    }

    overlay = document.createElement("div");
    overlay.id = "admin-matrix-overlay";

    const columnCount = Math.max(14, Math.floor(window.innerWidth / 28));
    for (let index = 0; index < columnCount; index += 1) {
      const column = document.createElement("div");
      column.className = "admin-matrix-column";
      column.textContent = randomBinaryString(34 + Math.floor(Math.random() * 16));
      column.style.left = `${(index / columnCount) * 100}%`;
      column.style.animationDuration = `${6 + Math.random() * 5}s`;
      column.style.animationDelay = `${Math.random() * -8}s`;
      column.style.opacity = `${0.45 + Math.random() * 0.4}`;
      overlay.appendChild(column);
    }

    document.body.appendChild(overlay);
  }

  function applyPublicEffects(state) {
    ensureEffectStyles();
    const currentLiveGameSessionId = Number(state.liveGame?.sessionId) || 0;
    const isStaleLiveGameState = currentLiveGameSessionId < lastLiveGameSessionId;

    document.body.classList.remove("takeover-matrix", "takeover-emergency", "takeover-arcade", "takeover-gold");
    if (state.takeoverTheme) {
      document.body.classList.add(`takeover-${state.takeoverTheme}`);
    }

    if (state.takeoverTheme === "matrix") {
      enableMatrixOverlay();
    } else {
      disableMatrixOverlay();
    }

    if (state.weatherEffect) {
      enableWeatherOverlay(state.weatherEffect);
    } else {
      disableWeatherOverlay();
    }

    if (isStaleLiveGameState) {
      // Keep the current overlay until a same-or-newer session snapshot arrives.
    } else if (state.liveGame?.active) {
      renderLiveGameState(state.liveGame);
      joinLiveGame(state.liveGame);
    } else {
      renderLiveGameState(state.liveGame || null);
    }

    applyProxyUrlHijack(state);
    applyTabHijack(state);
    showGlobalPopup(state);
    if (state.maintenanceMode) {
      showMaintenanceOverlay(state.maintenanceMessage);
    } else {
      hideMaintenanceOverlay();
    }

    let banner = document.getElementById("admin-broadcast-banner");
    if (state.bannerText) {
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "admin-broadcast-banner";
        document.body.appendChild(banner);
      }
      banner.textContent = state.bannerText;
    } else if (banner) {
      banner.remove();
    }

    document.body.classList.toggle("party-mode", Boolean(state.partyMode));
    document.body.classList.toggle("chaos-mode", Boolean(state.chaosMode));

    if (state.partyMode) {
      startConfettiLoop();
    } else {
      stopConfettiLoop();
    }

    if (!hasLoadedEffects) {
      lastConfettiVersion = Number(state.confettiVersion) || 0;
      lastJumpscareVersion = Number(state.jumpscareVersion) || 0;
      lastClientRefreshVersion = Number(state.clientRefreshVersion) || 0;
      lastLiveGameSessionId = Number(state.liveGame?.sessionId) || 0;
      hasLoadedEffects = true;
      return;
    }

    if (currentLiveGameSessionId !== lastLiveGameSessionId) {
      liveGameLocalSurvivalMs = 0;
      if (!state.liveGame?.active) {
        liveGameLocalSurvivalMs = 0;
        resetLiveGameRuntime(0);
        setSavedLiveGameSessionId(0);
      } else {
        resetLiveGameRuntime(currentLiveGameSessionId);
        armLiveGameRuntime(state.liveGame);
      }
      lastLiveGameSessionId = currentLiveGameSessionId;
    }

    const currentConfettiVersion = Number(state.confettiVersion) || 0;
    if (currentConfettiVersion > lastConfettiVersion) {
      blastConfetti();
      lastConfettiVersion = currentConfettiVersion;
    }

    const currentJumpscareVersion = Number(state.jumpscareVersion) || 0;
    if (currentJumpscareVersion > lastJumpscareVersion) {
      triggerAdminJumpscare();
      lastJumpscareVersion = currentJumpscareVersion;
    }

    const currentClientRefreshVersion = Number(state.clientRefreshVersion) || 0;
    if (currentClientRefreshVersion > lastClientRefreshVersion) {
      const seenRefreshVersion = Number(sessionStorage.getItem("adminClientRefreshVersion") || "0");
      lastClientRefreshVersion = currentClientRefreshVersion;
      if (currentClientRefreshVersion > seenRefreshVersion) {
        sessionStorage.setItem("adminClientRefreshVersion", String(currentClientRefreshVersion));
        window.location.reload();
      }
    }
  }

  async function fetchPublicEffects() {
    try {
      const res = await fetch(`/api/admin/public-state?ts=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const nextRevision = Number(data?.effectsRevision) || 0;
      if (nextRevision < lastAcceptedEffectsRevision) {
        return;
      }
      lastAcceptedEffectsRevision = nextRevision;
      sessionStorage.setItem(EFFECTS_REVISION_KEY, String(lastAcceptedEffectsRevision));
      applyPublicEffects(data);
    } catch {
      // Ignore effect polling errors silently.
    }
  }

  let effectsIntervalId = null;
  const EFFECTS_POLL_INTERVAL_MS = 1000;

  // Blocked Hostnames Check
  const blockedHostnames = ["gointerstellar.app"];

  if (!blockedHostnames.includes(window.location.hostname)) {
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "//nightsclotheshazardous.com/1c/c3/8a/1cc38a6899fdf8ba4dfe779bcc54627b.js";
    document.body.appendChild(script);
  }

  const nav = document.querySelector(".f-nav");

  if (nav) {
    const themeId = localStorage.getItem("theme");
    let LogoUrl = "/assets/media/favicon/main.png";
    if (themeId === "Inverted") {
      LogoUrl = "/assets/media/favicon/main-inverted.png";
    }
    const html = `
      <div id="icon-container">
        <a class="icon" href="/./"><img alt="nav" id="INImg" src="${LogoUrl}"/></a>
      </div>
      <div class="f-nav-right">
        <a class="navbar-link" href="/./a"><i class="fa-solid fa-gamepad navbar-icon"></i><an>&#71;&#97;</an><an>&#109;&#101;&#115;</an></a>
        <a class="navbar-link" href="/./b"><i class="fa-solid fa-phone navbar-icon"></i><an>&#65;&#112;</an><an>&#112;&#115;</an></a>
        ${qp ? "" : '<a class="navbar-link" href="/./d"><i class="fa-solid fa-laptop navbar-icon"></i><an>&#84;&#97;</an><an>&#98;&#115;</an></a>'}
        <a class="navbar-link" href="/admin"><i class="fa-solid fa-shield-halved navbar-icon"></i><an>&#65;&#100;</an><an>&#109;&#105;&#110;</an></a>
        <a class="navbar-link" href="/./c"><i class="fa-solid fa-gear navbar-icon settings-icon"></i><an>&#83;&#101;&#116;</an><an>&#116;&#105;&#110;&#103;</an></a>
      </div>`;
    nav.innerHTML = html;
  }

  // LocalStorage Setup for 'dy'
  if (localStorage.getItem("dy") === null || localStorage.getItem("dy") === undefined) {
    localStorage.setItem("dy", "false");
  }

  // Theme Logic
  const themeid = localStorage.getItem("theme");
  const themeEle = document.createElement("link");
  themeEle.rel = "stylesheet";
  const themes = {
    catppuccinMocha: "/assets/css/themes/catppuccin/mocha.css?v=00",
    catppuccinMacchiato: "/assets/css/themes/catppuccin/macchiato.css?v=00",
    catppuccinFrappe: "/assets/css/themes/catppuccin/frappe.css?v=00",
    catppuccinLatte: "/assets/css/themes/catppuccin/latte.css?v=00",
    Inverted: "/assets/css/themes/colors/inverted.css?v=00",
    sky: "/assets/css/themes/colors/sky.css?v=00",
  };

  if (themes[themeid]) {
    themeEle.href = themes[themeid];
    document.body.appendChild(themeEle);
  } else {
    const customThemeEle = document.createElement("style");
    customThemeEle.textContent = localStorage.getItem(`theme-${themeid}`);
    document.head.appendChild(customThemeEle);
  }

  // Favicon and Name Logic
  const icon = document.getElementById("tab-favicon");
  const name = document.getElementById("t");
  const selectedValue = localStorage.getItem("selectedOption");

  function setCloak(nameValue, iconUrl) {
    const customName = localStorage.getItem("CustomName");
    const customIcon = localStorage.getItem("CustomIcon");

    let FinalNameValue = nameValue;
    let finalIconUrl = iconUrl;

    if (customName) {
      FinalNameValue = customName;
    }
    if (customIcon) {
      finalIconUrl = customIcon;
    }

    if (finalIconUrl) {
      icon.setAttribute("href", finalIconUrl);
      localStorage.setItem("icon", finalIconUrl);
    }
    if (FinalNameValue) {
      name.textContent = FinalNameValue;
      localStorage.setItem("name", FinalNameValue);
    }
  }

  const options = {
    Google: { name: "Google", icon: "/assets/media/favicon/google.png" },
    "Savvas Realize": {
      name: "Savvas Realize",
      icon: "/assets/media/favicon/savvas-realize.png",
    },
    SmartPass: {
      name: "SmartPass",
      icon: "/assets/media/favicon/smartpass.png",
    },
    "World Book Online - Super Home": {
      name: "Super Home Page",
      icon: "/assets/media/favicon/wbo.ico",
    },
    "World Book Online - Student": {
      name: "WBO Student | Home Page",
      icon: "/assets/media/favicon/wbo.ico",
    },
    "World Book Online - Timelines": {
      name: "Timelines - Home Page",
      icon: "/assets/media/favicon/wbo.ico",
    },
    Naviance: {
      name: "Naviance Student",
      icon: "/assets/media/favicon/naviance.png",
    },
    "PBS Learning Media": {
      name: "PBS LearningMedia | Teaching Resources For Students And Teachers",
      icon: "/assets/media/favicon/pbslearningmedia.ico",
    },
    "PBS Learning Media Student Home": {
      name: "Student Homepage | PBS LearningMedia",
      icon: "/assets/media/favicon/pbslearningmedia.ico",
    },
    Drive: {
      name: "My Drive - Google Drive",
      icon: "/assets/media/favicon/drive.png",
    },
    Classroom: { name: "Home", icon: "/assets/media/favicon/classroom.png" },
    Schoology: {
      name: "Home | Schoology",
      icon: "/assets/media/favicon/schoology.png",
    },
    Gmail: { name: "Gmail", icon: "/assets/media/favicon/gmail.png" },
    Clever: {
      name: "Clever | Portal",
      icon: "/assets/media/favicon/clever.png",
    },
    Khan: {
      name: "Dashboard | Khan Academy",
      icon: "/assets/media/favicon/khan.png",
    },
    Dictionary: {
      name: "Dictionary.com | Meanings & Definitions of English Words",
      icon: "/assets/media/favicon/dictionary.png",
    },
    Thesaurus: {
      name: "Synonyms and Antonyms of Words | Thesaurus.com",
      icon: "/assets/media/favicon/thesaurus.png",
    },
    Campus: {
      name: "Infinite Campus",
      icon: "/assets/media/favicon/campus.png",
    },
    IXL: { name: "IXL | Dashboard", icon: "/assets/media/favicon/ixl.png" },
    Canvas: { name: "Dashboard", icon: "/assets/media/favicon/canvas.png" },
    LinkIt: { name: "Test Taker", icon: "/assets/media/favicon/linkit.ico" },
    Edpuzzle: { name: "Edpuzzle", icon: "/assets/media/favicon/edpuzzle.png" },
    "i-Ready Math": {
      name: "Math To Do, i-Ready",
      icon: "/assets/media/favicon/i-ready.ico",
    },
    "i-Ready Reading": {
      name: "Reading To Do, i-Ready",
      icon: "/assets/media/favicon/i-ready.ico",
    },
    "ClassLink Login": {
      name: "Login",
      icon: "/assets/media/favicon/classlink-login.png",
    },
    "Google Meet": {
      name: "Google Meet",
      icon: "/assets/media/favicon/google-meet.png",
    },
    "Google Docs": {
      name: "Google Docs",
      icon: "/assets/media/favicon/google-docs.ico",
    },
    "Google Slides": {
      name: "Google Slides",
      icon: "/assets/media/favicon/google-slides.ico",
    },
    Wikipedia: {
      name: "Wikipedia",
      icon: "/assets/media/favicon/wikipedia.png",
    },
    Britannica: {
      name: "Encyclopedia Britannica | Britannica",
      icon: "/assets/media/favicon/britannica.png",
    },
    Ducksters: {
      name: "Ducksters",
      icon: "/assets/media/favicon/ducksters.png",
    },
    Minga: {
      name: "Minga – Creating Amazing Schools",
      icon: "/assets/media/favicon/minga.png",
    },
    "i-Ready Learning Games": {
      name: "Learning Games, i-Ready",
      icon: "/assets/media/favicon/i-ready.ico",
    },
    "NoRedInk Home": {
      name: "Student Home | NoRedInk",
      icon: "/assets/media/favicon/noredink.png",
    },
    Desmos: {
      name: "Desmos | Graphing Calculator",
      icon: "/assets/media/favicon/desmos.ico",
    },
    "Newsela Binder": {
      name: "Newsela | Binder",
      icon: "/assets/media/favicon/newsela.png",
    },
    "Newsela Assignments": {
      name: "Newsela | Assignments",
      icon: "/assets/media/favicon/newsela.png",
    },
    "Newsela Home": {
      name: "Newsela | Instructional Content Platform",
      icon: "/assets/media/favicon/newsela.png",
    },
    "PowerSchool Sign In": {
      name: "Student and Parent Sign In",
      icon: "/assets/media/favicon/powerschool.png",
    },
    "PowerSchool Grades and Attendance": {
      name: "Grades and Attendance",
      icon: "/assets/media/favicon/powerschool.png",
    },
    "PowerSchool Teacher Comments": {
      name: "Teacher Comments",
      icon: "/assets/media/favicon/powerschool.png",
    },
    "PowerSchool Standards Grades": {
      name: "Standards Grades",
      icon: "/assets/media/favicon/powerschool.png",
    },
    "PowerSchool Attendance": {
      name: "Attendance",
      icon: "/assets/media/favicon/powerschool.png",
    },
    Nearpod: { name: "Nearpod", icon: "/assets/media/favicon/nearpod.png" },
    StudentVUE: {
      name: "StudentVUE",
      icon: "/assets/media/favicon/studentvue.ico",
    },
    "Quizlet Home": {
      name: "Flashcards, learning tools and textbook solutions | Quizlet",
      icon: "/assets/media/favicon/quizlet.webp",
    },
    "Google Forms Locked Mode": {
      name: "Start your quiz",
      icon: "/assets/media/favicon/googleforms.png",
    },
    DeltaMath: {
      name: "DeltaMath",
      icon: "/assets/media/favicon/deltamath.png",
    },
    Kami: { name: "Kami", icon: "/assets/media/favicon/kami.png" },
    "GoGuardian Admin Restricted": {
      name: "Restricted",
      icon: "/assets/media/favicon/goguardian-lock.png",
    },
    "GoGuardian Teacher Block": {
      name: "Uh oh!",
      icon: "/assets/media/favicon/goguardian.png",
    },
    "World History Encyclopedia": {
      name: "World History Encyclopedia",
      icon: "/assets/media/favicon/worldhistoryencyclopedia.png",
    },
    "Big Ideas Math Assignment Player": {
      name: "Assignment Player",
      icon: "/assets/media/favicon/bim.ico",
    },
    "Big Ideas Math": {
      name: "Big Ideas Math",
      icon: "/assets/media/favicon/bim.ico",
    },
  };

  if (options[selectedValue]) {
    setCloak(options[selectedValue].name, options[selectedValue].icon);
  }

  mountChatWidget();
  fetchPublicEffects();
  effectsIntervalId = setInterval(fetchPublicEffects, EFFECTS_POLL_INTERVAL_MS);

  window.addEventListener("resize", () => {
    if (getSavedChatPosition()) {
      applyChatPosition();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      fetchPublicEffects();
    }
  });

  // Event Key Logic
  const eventKey = JSON.parse(localStorage.getItem("eventKey")) || ["Ctrl", "E"];
  const pLink = localStorage.getItem("pLink") || "https://classroom.google.com/";
  let pressedKeys = [];

  document.addEventListener("keydown", event => {
    pressedKeys.push(event.key);
    if (pressedKeys.length > eventKey.length) {
      pressedKeys.shift();
    }
    if (eventKey.every((key, index) => key === pressedKeys[index])) {
      window.location.href = pLink;
      pressedKeys = [];
    }
  });

  // Background Image Logic
  const savedBackgroundImage = localStorage.getItem("backgroundImage");
  if (savedBackgroundImage) {
    document.body.style.backgroundImage = `url('${savedBackgroundImage}')`;
  }

  // Random timed jumpscare – fires once per session on any page.
  if (sessionStorage.getItem("jumpscarePlayed") !== "1") {
    const jsOverlay = document.createElement("div");
    jsOverlay.id = "jumpscare-overlay";
    jsOverlay.style.cssText = "position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;flex-direction:column;gap:1rem;pointer-events:none;background:radial-gradient(circle at center,rgba(255,0,0,.85) 0%,rgba(15,0,0,.95) 40%,rgba(0,0,0,1) 100%);backdrop-filter:blur(2px)";

    const jsTitle = document.createElement("div");
    jsTitle.textContent = "DON'T LOOK BEHIND YOU";
    jsTitle.style.cssText = "color:#fff;font-family:Impact,Haettenschweiler,'Arial Black',sans-serif;font-size:clamp(2rem,9vw,6rem);letter-spacing:.08em;text-shadow:0 0 20px rgba(255,0,0,.9),0 0 40px rgba(0,0,0,.9);transform:rotate(-2deg)";

    const jsFace = document.createElement("div");
    jsFace.setAttribute("aria-hidden", "true");
    jsFace.style.cssText = "width:min(58vw,460px);aspect-ratio:1/1;border-radius:50%;background:radial-gradient(circle at 50% 58%,#111 0%,#090909 48%,#000 100%);box-shadow:0 0 80px rgba(255,40,40,.8),inset 0 -20px 40px rgba(255,0,0,.25);position:relative";

    const jsEyeL = document.createElement("div");
    const jsEyeR = document.createElement("div");
    const jsMouth = document.createElement("div");
    for (const eye of [jsEyeL, jsEyeR]) {
      eye.style.cssText = "position:absolute;top:33%;width:16%;height:16%;border-radius:50%;background:#ff2d2d;box-shadow:0 0 35px rgba(255,32,32,.95)";
    }
    jsEyeL.style.left = "27%";
    jsEyeR.style.right = "27%";
    jsMouth.style.cssText = "position:absolute;left:50%;bottom:19%;transform:translateX(-50%);width:40%;height:21%;border-radius:0 0 50% 50%;background:linear-gradient(to bottom,#090909,#330000 70%,#770000);box-shadow:inset 0 12px 18px rgba(255,15,15,.25)";

    jsFace.append(jsEyeL, jsEyeR, jsMouth);
    jsOverlay.append(jsTitle, jsFace);
    document.body.appendChild(jsOverlay);

    const jsFxStyle = document.createElement("style");
    jsFxStyle.textContent = `
      @keyframes jumpscare-pop{0%{transform:scale(.84);filter:blur(8px);opacity:0}12%{transform:scale(1.06);filter:blur(1px);opacity:1}24%{transform:scale(.98)}100%{transform:scale(1);filter:blur(0);opacity:1}}
      @keyframes jumpscare-shake{0%,100%{transform:translate(0,0)}20%{transform:translate(-10px,6px)}40%{transform:translate(12px,-8px)}60%{transform:translate(-8px,-5px)}80%{transform:translate(8px,7px)}}
    `;
    document.head.appendChild(jsFxStyle);

    function jsPlayScream() {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * 1.35);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.setValueAtTime(1700, now);
      noiseFilter.Q.setValueAtTime(0.8, now);
      const oscA = ctx.createOscillator();
      oscA.type = "sawtooth";
      oscA.frequency.setValueAtTime(620, now);
      oscA.frequency.exponentialRampToValueAtTime(320, now + 0.45);
      const oscB = ctx.createOscillator();
      oscB.type = "triangle";
      oscB.frequency.setValueAtTime(980, now);
      oscB.frequency.exponentialRampToValueAtTime(540, now + 0.7);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.55, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.3, now + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 8;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.22;
      noise.connect(noiseFilter);
      noiseFilter.connect(gain);
      oscA.connect(gain);
      oscB.connect(gain);
      gain.connect(compressor);
      compressor.connect(ctx.destination);
      noise.start(now); oscA.start(now); oscB.start(now);
      noise.stop(now + 1.3); oscA.stop(now + 1.3); oscB.stop(now + 1.3);
      setTimeout(() => ctx.close().catch(() => {}), 1500);
    }

    function jsFireJumpscare() {
      if (sessionStorage.getItem("jumpscarePlayed") === "1") return;
      sessionStorage.setItem("jumpscarePlayed", "1");
      jsOverlay.style.display = "flex";
      jsOverlay.style.animation = "jumpscare-pop 170ms ease-out both";
      document.body.style.animation = "jumpscare-shake 360ms ease-in-out 2";
      jsPlayScream();
      setTimeout(() => {
        jsOverlay.style.display = "none";
        document.body.style.animation = "";
      }, 1100);
    }

    function jsArmOnce() {
      const delay = Math.floor(Math.random() * 7000) + 6000;
      setTimeout(jsFireJumpscare, delay);
    }

    document.addEventListener("pointerdown", jsArmOnce, { once: true });
    document.addEventListener("keydown", jsArmOnce, { once: true });
  }
});
