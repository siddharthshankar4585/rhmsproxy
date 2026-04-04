(() => {
  const TOKEN_KEY = "admin_token";

  const loginPanel = document.getElementById("login-panel");
  const adminPanel = document.getElementById("admin-panel");
  const codeInput = document.getElementById("code");
  const statusEl = document.getElementById("status");
  const metricsEl = document.getElementById("metrics");
  const previewPathInput = document.getElementById("preview-path");
  const openPreviewBtn = document.getElementById("open-preview");
  const refreshPreviewBtn = document.getElementById("refresh-preview");
  const sitePreviewFrame = document.getElementById("site-preview");
  const adminChatFeed = document.getElementById("admin-chat-feed");
  const adminChatNameInput = document.getElementById("admin-chat-name");
  const adminChatMessageInput = document.getElementById("admin-chat-message");
  const adminChatSendBtn = document.getElementById("admin-chat-send");
  const adminChatClearBtn = document.getElementById("admin-chat-clear");
  const loginBtn = document.getElementById("login");
  const weatherEffectSelect = document.getElementById("weather-effect");
  const setWeatherEffectBtn = document.getElementById("set-weather-effect");
  const clearWeatherEffectBtn = document.getElementById("clear-weather-effect");
  const proxyUrlHijackInput = document.getElementById("proxy-url-hijack");
  const setProxyUrlHijackBtn = document.getElementById("set-proxy-url-hijack");
  const clearProxyUrlHijackBtn = document.getElementById("clear-proxy-url-hijack");
  const tabTitleOverrideInput = document.getElementById("tab-title-override");
  const tabFaviconOverrideInput = document.getElementById("tab-favicon-override");
  const setTabHijackBtn = document.getElementById("set-tab-hijack");
  const clearTabHijackBtn = document.getElementById("clear-tab-hijack");
  const refreshBtn = document.getElementById("refresh");
  const resetOpensBtn = document.getElementById("reset-opens");
  const clearOnlineBtn = document.getElementById("clear-online");
  const clearCacheBtn = document.getElementById("clear-cache");
  const popupTitleInput = document.getElementById("popup-title");
  const popupMessageInput = document.getElementById("popup-message");
  const popupButtonTextInput = document.getElementById("popup-button-text");
  const setPopupBtn = document.getElementById("set-popup");
  const clearPopupBtn = document.getElementById("clear-popup");
  const maintenanceMessageInput = document.getElementById("maintenance-message");
  const setMaintenanceBtn = document.getElementById("set-maintenance");
  const clearMaintenanceBtn = document.getElementById("clear-maintenance");
  const triggerJumpscareBtn = document.getElementById("trigger-jumpscare");
  const forceClientRefreshBtn = document.getElementById("force-client-refresh");
  const liveGameTitleInput = document.getElementById("live-game-title");
  const liveGameButtonLabelInput = document.getElementById("live-game-button-label");
  const liveGameDurationInput = document.getElementById("live-game-duration");
  const startLiveGameBtn = document.getElementById("start-live-game");
  const resetLiveGameBtn = document.getElementById("reset-live-game");
  const endLiveGameBtn = document.getElementById("end-live-game");
  const takeoverSelect = document.getElementById("takeover-theme");
  const setTakeoverBtn = document.getElementById("set-takeover");
  const clearTakeoverBtn = document.getElementById("clear-takeover");
  const bannerInput = document.getElementById("banner-text");
  const setBannerBtn = document.getElementById("set-banner");
  const clearBannerBtn = document.getElementById("clear-banner");
  const togglePartyBtn = document.getElementById("toggle-party");
  const toggleChaosBtn = document.getElementById("toggle-chaos");
  const logoutBtn = document.getElementById("logout");
  let chatPollIntervalId = null;
  let lastAdminChatId = 0;
  const PREVIEW_PATH_KEY = "admin_preview_path";

  function getAdminChatName() {
    return String(localStorage.getItem("adminChatName") || "Owner").trim() || "Owner";
  }

  function sanitizeAdminChatName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24);
  }

  function getOwnerDisplayName() {
    return sanitizeAdminChatName(adminChatNameInput?.value) || getAdminChatName() || "owner";
  }

  function syncAdminChatNameInput() {
    if (!adminChatNameInput) {
      return;
    }
    if (!adminChatNameInput.matches(":focus")) {
      adminChatNameInput.value = getAdminChatName();
    }
  }

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("error", isError);
  }

  function normalizePreviewPath(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "/";
    }
    if (/^https?:\/\//i.test(raw)) {
      return "/";
    }
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  function setPreviewPath(path, refreshOnly = false) {
    if (!sitePreviewFrame || !previewPathInput) {
      return;
    }

    const finalPath = normalizePreviewPath(path || previewPathInput.value);
    previewPathInput.value = finalPath;
    localStorage.setItem(PREVIEW_PATH_KEY, finalPath);

    if (refreshOnly) {
      const url = new URL(sitePreviewFrame.src || `${window.location.origin}${finalPath}`, window.location.origin);
      url.searchParams.set("previewTs", String(Date.now()));
      sitePreviewFrame.src = url.pathname + url.search;
      return;
    }

    sitePreviewFrame.src = finalPath;
  }

  function refreshPreview() {
    if (!sitePreviewFrame) {
      return;
    }
    setPreviewPath(previewPathInput?.value || "/", true);
  }

  function loadSavedPreviewPath() {
    if (!previewPathInput) {
      return;
    }
    const saved = localStorage.getItem(PREVIEW_PATH_KEY) || "/";
    previewPathInput.value = normalizePreviewPath(saved);
    if (sitePreviewFrame) {
      sitePreviewFrame.src = previewPathInput.value;
    }
  }

  function ensureAdminJumpscareStyles() {
    if (document.getElementById("admin-console-jumpscare-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "admin-console-jumpscare-style";
    style.textContent = `
      #admin-console-jumpscare {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: none;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 12px;
        pointer-events: none;
        background: radial-gradient(circle at center, rgba(255, 0, 0, .84) 0%, rgba(15, 0, 0, .94) 42%, rgba(0, 0, 0, 1) 100%);
      }
      #admin-console-jumpscare.active {
        animation: admin-console-jumpscare-pop 210ms ease-out both;
      }
      #admin-console-jumpscare-title {
        color: #fff;
        font-family: Impact, Haettenschweiler, "Arial Black", sans-serif;
        font-size: clamp(2rem, 8vw, 5.2rem);
        letter-spacing: .08em;
        text-shadow: 0 0 20px rgba(255, 0, 0, .95), 0 0 40px rgba(0, 0, 0, .9);
        transform: rotate(-2deg);
      }
      #admin-console-jumpscare-face {
        width: min(54vw, 360px);
        aspect-ratio: 1 / 1;
        border-radius: 50%;
        background: radial-gradient(circle at 50% 58%, #0d0d0d 0%, #070707 48%, #000 100%);
        box-shadow: 0 0 80px rgba(255, 40, 40, .82), inset 0 -20px 40px rgba(255, 0, 0, .25);
        position: relative;
      }
      .admin-console-jumpscare-eye {
        position: absolute;
        top: 33%;
        width: 16%;
        height: 16%;
        border-radius: 50%;
        background: #ff2d2d;
        box-shadow: 0 0 35px rgba(255, 32, 32, .95);
      }
      .admin-console-jumpscare-eye.left {
        left: 27%;
      }
      .admin-console-jumpscare-eye.right {
        right: 27%;
      }
      #admin-console-jumpscare-mouth {
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
      body.admin-console-jumpscare-shake {
        animation: admin-console-jumpscare-shake 360ms ease-in-out 2;
      }
      @keyframes admin-console-jumpscare-pop {
        0% { transform: scale(.84); filter: blur(8px); opacity: 0; }
        14% { transform: scale(1.07); filter: blur(1px); opacity: 1; }
        26% { transform: scale(.99); }
        100% { transform: scale(1); filter: blur(0); opacity: 1; }
      }
      @keyframes admin-console-jumpscare-shake {
        0%, 100% { transform: translate(0, 0); }
        20% { transform: translate(-10px, 6px); }
        40% { transform: translate(12px, -8px); }
        60% { transform: translate(-8px, -5px); }
        80% { transform: translate(8px, 7px); }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureAdminJumpscareOverlay() {
    ensureAdminJumpscareStyles();

    let overlay = document.getElementById("admin-console-jumpscare");
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = "admin-console-jumpscare";
    overlay.innerHTML = `
      <div id="admin-console-jumpscare-title">DON'T LOOK BEHIND YOU</div>
      <div id="admin-console-jumpscare-face" aria-hidden="true">
        <div class="admin-console-jumpscare-eye left"></div>
        <div class="admin-console-jumpscare-eye right"></div>
        <div id="admin-console-jumpscare-mouth"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function playAdminJumpscareScream() {
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

  function previewAdminJumpscare() {
    const overlay = ensureAdminJumpscareOverlay();
    overlay.classList.remove("active");
    overlay.style.display = "flex";
    void overlay.offsetWidth;
    overlay.classList.add("active");
    document.body.classList.add("admin-console-jumpscare-shake");

    playAdminJumpscareScream();

    window.setTimeout(() => {
      overlay.style.display = "none";
      overlay.classList.remove("active");
      document.body.classList.remove("admin-console-jumpscare-shake");
    }, 1100);
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
  }

  function formatChatTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return "now";
    }
  }

  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(path, { ...options, headers });
    const contentType = res.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await res.json() : null;
    return { res, data };
  }

  function showLogin() {
    loginPanel.classList.remove("hidden");
    adminPanel.classList.add("hidden");
    setStatus("", false);
  }

  function showAdmin() {
    loginPanel.classList.add("hidden");
    adminPanel.classList.remove("hidden");
    syncAdminChatNameInput();
    loadSavedPreviewPath();
    startChatPolling();
  }

  function renderAdminChat(messages) {
    if (!adminChatFeed) {
      return;
    }

    const stickToBottom = adminChatFeed.scrollHeight - adminChatFeed.scrollTop - adminChatFeed.clientHeight < 36;
    adminChatFeed.replaceChildren();

    if (!Array.isArray(messages) || messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "chat-empty";
      empty.textContent = "No chat messages yet.";
      adminChatFeed.appendChild(empty);
      lastAdminChatId = 0;
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const message of messages) {
      const isSystem = message.roleTag === "SYSTEM" || message.name === "SYSTEM";
      const entry = document.createElement("div");
      entry.className = "chat-entry";
      if (isSystem) {
        entry.classList.add("system");
      }

      const meta = document.createElement("div");
      meta.className = "chat-meta";

      const left = document.createElement("div");
      left.className = "chat-meta-left";

      const author = document.createElement("span");
      author.className = "chat-author";
      author.textContent = isSystem ? "<SYSTEM>" : (message.name || "Unknown");
      if (message.color) {
        author.style.color = message.color;
      }
      left.appendChild(author);

      if (message.roleTag && !isSystem) {
        const tag = document.createElement("span");
        tag.className = "chat-tag";
        tag.textContent = message.roleTag;
        if (message.color) {
          tag.style.color = message.color;
          tag.style.borderColor = message.color;
          tag.style.background = `${message.color}18`;
        }
        left.appendChild(tag);
      }

      const time = document.createElement("span");
      time.textContent = formatChatTime(message.createdAt);

      const text = document.createElement("div");
      text.className = "chat-text";
      text.textContent = message.message || "";

      meta.append(left, time);
      entry.append(meta, text);
      fragment.appendChild(entry);
    }

    adminChatFeed.appendChild(fragment);
    lastAdminChatId = Number(messages[messages.length - 1]?.id) || 0;
    if (stickToBottom || !adminChatFeed.dataset.loadedOnce) {
      adminChatFeed.scrollTop = adminChatFeed.scrollHeight;
    }
    adminChatFeed.dataset.loadedOnce = "true";
  }

  async function loadChat() {
    const { res, data } = await api("/api/chat/messages", { method: "GET" });
    if (res.status === 401) {
      clearToken();
      showLogin();
      setStatus("Session expired. Log in again.", true);
      return;
    }
    if (!res.ok) {
      return;
    }
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    const newestId = Number(messages[messages.length - 1]?.id) || 0;
    if (newestId !== lastAdminChatId || newestId === 0) {
      renderAdminChat(messages);
    }
  }

  function startChatPolling() {
    if (chatPollIntervalId !== null) {
      return;
    }
    loadChat();
    chatPollIntervalId = window.setInterval(loadChat, 3000);
  }

  function stopChatPolling() {
    if (chatPollIntervalId === null) {
      return;
    }
    window.clearInterval(chatPollIntervalId);
    chatPollIntervalId = null;
  }

  function renderMetrics(stats) {
    metricsEl.innerHTML = [
      `Online Users: <strong>${stats.onlineUsers}</strong>`,
      `Opened Today: <strong>${stats.openedToday}</strong>`,
      `Cache Entries: <strong>${stats.cacheEntries}</strong>`,
      `Active Admin Sessions: <strong>${stats.activeAdminSessions}</strong>`,
      `Party Mode: <strong>${stats.partyMode ? "ON" : "OFF"}</strong>`,
      `Chaos Mode: <strong>${stats.chaosMode ? "ON" : "OFF"}</strong>`,
      `Takeover Theme: <strong>${stats.takeoverTheme || "OFF"}</strong>`,
      `Banner Active: <strong>${stats.hasBanner ? "YES" : "NO"}</strong>`,
      `Popup Active: <strong>${stats.popupActive ? "YES" : "NO"}</strong>`,
      `Jumpscare Triggers: <strong>${stats.jumpscareVersion || 0}</strong>`,
      `Maintenance Mode: <strong>${stats.maintenanceMode ? "ON" : "OFF"}</strong>`,
      `Forced Refreshes: <strong>${stats.clientRefreshVersion || 0}</strong>`,
      `Tab Hijack: <strong>${stats.tabHijackActive ? "YES" : "NO"}</strong>`,
      `Proxy URL Hijack: <strong>${stats.proxyUrlHijackActive ? "YES" : "NO"}</strong>`,
      `Weather Effect: <strong>${stats.weatherEffect || "OFF"}</strong>`,
      `Live Game: <strong>${stats.liveGameActive ? "ON" : "OFF"}</strong>`,
      `Live Game Players: <strong>${stats.liveGamePlayers || 0}</strong>`,
      `Uptime: <strong>${formatUptime(stats.uptime || 0)}</strong>`,
    ].join("<br>");
  }

  async function loadStats() {
    const { res, data } = await api("/api/admin/stats", { method: "GET" });
    if (res.status === 401) {
      clearToken();
      showLogin();
      setStatus("Session expired. Log in again.", true);
      return;
    }
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to load stats.", true);
      return;
    }
    renderMetrics(data);
    setStatus("Admin data updated.");
  }

  async function login() {
    const code = codeInput.value.trim();
    if (!code) {
      setStatus("Enter a code first.", true);
      return;
    }

    const { res, data } = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ code }),
    });

    if (!res.ok) {
      setStatus((data && data.error) || "Login failed.", true);
      return;
    }

    setToken(data.token);
    codeInput.value = "";
    showAdmin();
    await loadStats();
  }

  async function runAction(path, message) {
    let systemCommandLabel = "";
    if (typeof arguments[2] === "string") {
      systemCommandLabel = arguments[2];
    }
    const { res, data } = await api(path, { method: "POST" });
    if (res.status === 401) {
      clearToken();
      showLogin();
      setStatus("Session expired. Log in again.", true);
      return;
    }
    if (!res.ok) {
      setStatus((data && data.error) || "Action failed.", true);
      return;
    }
    if (systemCommandLabel) {
      await logSystemCommand(systemCommandLabel);
    }
    setStatus(message);
    await loadStats();
    refreshPreview();
  }

  async function logSystemCommand(command) {
    await api("/api/admin/system-message", {
      method: "POST",
      body: JSON.stringify({
        actorName: getOwnerDisplayName(),
        command,
      }),
    });
    await loadChat();
  }

  async function logout() {
    await api("/api/admin/logout", { method: "POST" });
    stopChatPolling();
    clearToken();
    showLogin();
    setStatus("Logged out.");
  }

  async function sendOwnerChatMessage() {
    const name = sanitizeAdminChatName(adminChatNameInput?.value);
    const message = adminChatMessageInput.value.trim();
    if (!name || !/^[a-zA-Z0-9 ._-]+$/.test(name)) {
      setStatus("Use a valid owner name first.", true);
      return;
    }
    if (!message) {
      setStatus("Enter a chat message first.", true);
      return;
    }

    localStorage.setItem("adminChatName", name);

    const { res, data } = await api("/api/admin/chat-message", {
      method: "POST",
      body: JSON.stringify({ name, message }),
    });

    if (res.status === 401) {
      clearToken();
      stopChatPolling();
      showLogin();
      setStatus("Session expired. Log in again.", true);
      return;
    }
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to send owner message.", true);
      return;
    }

    adminChatMessageInput.value = "";
    syncAdminChatNameInput();
    renderAdminChat(Array.isArray(data?.messages) ? data.messages : []);
    setStatus("Owner message sent.");
  }

  async function clearChatForEveryone() {
    const { res, data } = await api("/api/admin/clear-chat", {
      method: "POST",
    });

    if (res.status === 401) {
      clearToken();
      stopChatPolling();
      showLogin();
      setStatus("Session expired. Log in again.", true);
      return;
    }
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to clear chat.", true);
      return;
    }

    lastAdminChatId = 0;
    renderAdminChat([]);
    setStatus("Chat cleared for everyone.");
  }

  loginBtn.addEventListener("click", login);
  codeInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      login();
    }
  });
  setWeatherEffectBtn.addEventListener("click", async () => {
    const effect = weatherEffectSelect.value;
    const { res, data } = await api("/api/admin/set-weather-effect", {
      method: "POST",
      body: JSON.stringify({ effect }),
    });
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to enable weather effect.", true);
      return;
    }
    await logSystemCommand(`weather effect ${effect}`);
    setStatus(`Weather effect enabled: ${effect}.`);
    await loadStats();
    refreshPreview();
  });
  clearWeatherEffectBtn.addEventListener("click", () => runAction("/api/admin/clear-weather-effect", "Weather effect disabled.", "clear weather effect"));
  setProxyUrlHijackBtn.addEventListener("click", async () => {
    const url = proxyUrlHijackInput.value.trim();
    if (!url) {
      setStatus("Enter a proxy URL first.", true);
      return;
    }
    const { res, data } = await api("/api/admin/set-proxy-url-hijack", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to hijack proxy URL.", true);
      return;
    }
    await logSystemCommand(`proxy URL hijack ${url}`);
    setStatus("Proxy URL hijack pushed live.");
    await loadStats();
    refreshPreview();
  });
  clearProxyUrlHijackBtn.addEventListener("click", () => runAction("/api/admin/clear-proxy-url-hijack", "Proxy URL hijack cleared.", "clear proxy URL hijack"));
  setTabHijackBtn.addEventListener("click", async () => {
    const title = tabTitleOverrideInput.value.trim();
    const favicon = tabFaviconOverrideInput.value.trim();
    if (!title && !favicon) {
      setStatus("Enter a title or favicon first.", true);
      return;
    }
    const { res, data } = await api("/api/admin/set-tab-hijack", {
      method: "POST",
      body: JSON.stringify({ title, favicon }),
    });
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to set tab hijack.", true);
      return;
    }
    await logSystemCommand(`tab appearance override`);
    setStatus("Tab hijack pushed live.");
    await loadStats();
    refreshPreview();
  });
  clearTabHijackBtn.addEventListener("click", () => runAction("/api/admin/clear-tab-hijack", "Tab hijack cleared.", "clear tab appearance override"));
  refreshBtn.addEventListener("click", () => loadStats());
  setPopupBtn.addEventListener("click", async () => {
    const title = popupTitleInput.value.trim();
    const message = popupMessageInput.value.trim();
    const buttonText = popupButtonTextInput.value.trim();
    if (!title && !message) {
      setStatus("Enter popup title or message first.", true);
      return;
    }
    const { res, data } = await api("/api/admin/set-popup", {
      method: "POST",
      body: JSON.stringify({ title, message, buttonText }),
    });
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to show popup.", true);
      return;
    }
    await logSystemCommand(`popup message`);
    setStatus("Global popup pushed live.");
    await loadStats();
    refreshPreview();
  });
  clearPopupBtn.addEventListener("click", () => runAction("/api/admin/clear-popup", "Popup cleared.", "clear popup"));
  setMaintenanceBtn.addEventListener("click", async () => {
    const message = maintenanceMessageInput.value.trim();
    if (!message) {
      setStatus("Enter a maintenance message first.", true);
      return;
    }
    const { res, data } = await api("/api/admin/set-maintenance", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to enable maintenance mode.", true);
      return;
    }
    await logSystemCommand("enable maintenance mode");
    setStatus("Maintenance mode enabled.");
    await loadStats();
    refreshPreview();
  });
  clearMaintenanceBtn.addEventListener("click", () => runAction("/api/admin/clear-maintenance", "Maintenance mode disabled.", "disable maintenance mode"));
  triggerJumpscareBtn.addEventListener("click", async () => {
    const { res, data } = await api("/api/admin/trigger-jumpscare", { method: "POST" });
    if (res.status === 401) {
      clearToken();
      showLogin();
      setStatus("Session expired. Log in again.", true);
      return;
    }
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to trigger jumpscare.", true);
      return;
    }

    await logSystemCommand("trigger jumpscare");
    previewAdminJumpscare();
    setStatus("Jumpscare sent to all active users.");
    await loadStats();
    refreshPreview();
  });
  forceClientRefreshBtn.addEventListener("click", () => runAction("/api/admin/force-client-refresh", "Forced refresh pushed to active clients.", "force client refresh"));
  startLiveGameBtn.addEventListener("click", async () => {
    const title = liveGameTitleInput.value.trim();
    const buttonLabel = liveGameButtonLabelInput.value.trim();
    const durationSeconds = Number(liveGameDurationInput.value);
    const { res, data } = await api("/api/admin/live-game/start", {
      method: "POST",
      body: JSON.stringify({ title, buttonLabel, durationSeconds }),
    });
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to start live game.", true);
      return;
    }
    await logSystemCommand(`start live game ${title || "Tap Rush"}`);
    setStatus("Live game started for everyone.");
    await loadStats();
    refreshPreview();
  });
  resetLiveGameBtn.addEventListener("click", async () => {
    const { res, data } = await api("/api/admin/live-game/reset", { method: "POST" });
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to reset live game.", true);
      return;
    }
    await logSystemCommand("reset live game scores");
    setStatus("Live game scores reset.");
    await loadStats();
    refreshPreview();
  });
  endLiveGameBtn.addEventListener("click", async () => {
    const { res, data } = await api("/api/admin/live-game/end", { method: "POST" });
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to end live game.", true);
      return;
    }
    await logSystemCommand("end live game");
    setStatus("Live game ended.");
    await loadStats();
    refreshPreview();
  });
  setTakeoverBtn.addEventListener("click", async () => {
    const theme = takeoverSelect.value;
    const { res, data } = await api("/api/admin/set-takeover-theme", {
      method: "POST",
      body: JSON.stringify({ theme }),
    });
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to enable takeover.", true);
      return;
    }
    await logSystemCommand(`takeover theme ${theme}`);
    setStatus(`Takeover enabled: ${theme}.`);
    await loadStats();
    refreshPreview();
  });
  clearTakeoverBtn.addEventListener("click", () => runAction("/api/admin/clear-takeover-theme", "Takeover disabled.", "clear takeover theme"));
  resetOpensBtn.addEventListener("click", () => runAction("/api/admin/reset-opens", "Daily opens reset.", "reset daily opens"));
  clearOnlineBtn.addEventListener("click", () => runAction("/api/admin/clear-online", "Online users cleared.", "clear online users"));
  clearCacheBtn.addEventListener("click", () => runAction("/api/admin/clear-cache", "Asset cache cleared.", "clear asset cache"));
  setBannerBtn.addEventListener("click", async () => {
    const text = bannerInput.value.trim();
    if (!text) {
      setStatus("Enter banner text first.", true);
      return;
    }
    const { res, data } = await api("/api/admin/set-banner", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      setStatus((data && data.error) || "Failed to set banner.", true);
      return;
    }
    await logSystemCommand(`banner update`);
    setStatus("Banner updated.");
    await loadStats();
    refreshPreview();
  });
  clearBannerBtn.addEventListener("click", () => runAction("/api/admin/clear-banner", "Banner cleared.", "clear banner"));
  togglePartyBtn.addEventListener("click", () => runAction("/api/admin/toggle-party", "Party mode toggled.", "toggle party mode"));
  toggleChaosBtn.addEventListener("click", () => runAction("/api/admin/toggle-chaos", "Chaos mode toggled.", "toggle chaos mode"));
  adminChatSendBtn.addEventListener("click", sendOwnerChatMessage);
  adminChatClearBtn.addEventListener("click", clearChatForEveryone);
  adminChatNameInput.addEventListener("change", () => {
    const name = sanitizeAdminChatName(adminChatNameInput.value);
    if (!name || !/^[a-zA-Z0-9 ._-]+$/.test(name)) {
      setStatus("Use 2-24 letters, numbers, spaces, dots, dashes, or underscores.", true);
      return;
    }
    localStorage.setItem("adminChatName", name);
    syncAdminChatNameInput();
    setStatus(`Owner name set to ${name}.`);
  });
  adminChatMessageInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      sendOwnerChatMessage();
    }
  });
  openPreviewBtn.addEventListener("click", () => setPreviewPath(previewPathInput.value));
  refreshPreviewBtn.addEventListener("click", refreshPreview);
  previewPathInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      setPreviewPath(previewPathInput.value);
    }
  });
  logoutBtn.addEventListener("click", logout);

  if (getToken()) {
    showAdmin();
    loadStats();
  } else {
    showLogin();
  }
})();
