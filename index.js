import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createBareServer } from "@nebula-services/bare-server-node";
import chalk from "chalk";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import basicAuth from "express-basic-auth";
import mime from "mime";
import fetch from "node-fetch";
// import { setupMasqr } from "./Masqr.js";
import config from "./config.js";

console.log(chalk.yellow("🚀 Starting server..."));

const __dirname = process.cwd();
const server = http.createServer();
const app = express();
const bareServer = createBareServer("/ca/");
const PORT = process.env.PORT || 8080;
const cache = new Map();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // Cache for 30 Days
const ONLINE_TTL = 60 * 1000;
const CHAT_MESSAGE_LIMIT = 60;
const CHAT_FETCH_LIMIT = 40;
const CHAT_NAME_MAX = 24;
const CHAT_MESSAGE_MAX = 280;
const CHAT_COOLDOWN_MS = 1200;
const OWNER_CHAT_COLORS = ["#ff7a59", "#ffd166", "#7bdff2", "#b2f7ef", "#cdb4db", "#ff99c8", "#a0ff6e"];
const SYSTEM_CHAT_COLOR = "#8bd8ff";
const onlineUsers = new Map();
const dailyOpens = new Map();
const adminSessions = new Map(); // best-effort local metrics for non-serverless runtimes
const chatMessages = [];
const chatSendCooldowns = new Map();
let nextChatMessageId = 1;
const ADMIN_SESSION_TTL = 2 * 60 * 60 * 1000; // 2 hours
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_CODE || config.adminCode;
const adminLoginAttempts = new Map(); // ip -> { count, lockedUntil }
const DEFAULT_MAINTENANCE_MESSAGE = "Maintenance in progress. Please check back soon.";
const LIVE_GAME_DEFAULT_DURATION_SECONDS = 45;
const LIVE_GAME_MAX_DURATION_SECONDS = 300;
const VOICE_BLAST_MAX_LENGTH = 240;
const VOICE_BLAST_DEFAULT_VOICE = process.env.VOICE_BLAST_VOICE || "Brian";
const INPUT_LOCK_DEFAULT_DURATION_MS = 5000;
const INPUT_LOCK_MAX_DURATION_MS = 15000;
const siteEffects = {
  effectsRevision: 1,
  bannerText: "",
  partyMode: false,
  chaosMode: false,
  confettiVersion: 0,
  takeoverTheme: "",
  popupTitle: "",
  popupMessage: "",
  popupButtonText: "Close",
  popupVersion: 0,
  jumpscareVersion: 0,
  voiceBlastText: "",
  voiceBlastVersion: 0,
  inputLockDurationMs: 0,
  inputLockVersion: 0,
  maintenanceMode: false,
  maintenanceMessage: DEFAULT_MAINTENANCE_MESSAGE,
  clientRefreshVersion: 0,
  tabTitleOverride: "",
  tabFaviconOverride: "",
  proxyUrlHijack: "",
  proxyUrlHijackVersion: 0,
  weatherEffect: "",
};
const liveGameState = {
  active: false,
  sessionId: 0,
  mode: "runner",
  title: "Sky Sprint",
  buttonLabel: "Jump",
  durationSeconds: LIVE_GAME_DEFAULT_DURATION_SECONDS,
  startedAt: 0,
  endsAt: 0,
  seed: 0,
  scores: new Map(),
};

const takeoverThemes = new Set(["matrix", "emergency", "arcade", "gold"]);
const weatherEffects = new Set(["snow", "rain", "fog", "hail", "lightning"]);

function getActiveExclusiveEffects() {
  const activeEffects = [];

  if (siteEffects.bannerText) activeEffects.push("banner");
  if (siteEffects.partyMode) activeEffects.push("party");
  if (siteEffects.chaosMode) activeEffects.push("chaos");
  if (siteEffects.takeoverTheme) activeEffects.push("takeover");
  if (siteEffects.popupTitle || siteEffects.popupMessage) activeEffects.push("popup");
  if (siteEffects.maintenanceMode) activeEffects.push("maintenance");
  if (siteEffects.tabTitleOverride || siteEffects.tabFaviconOverride) activeEffects.push("tabHijack");
  if (siteEffects.proxyUrlHijack) activeEffects.push("proxyUrlHijack");
  if (siteEffects.weatherEffect) activeEffects.push("weather");
  if (liveGameState.active) activeEffects.push("liveGame");

  return activeEffects;
}

function isOnlyExclusiveEffectActive(effectName) {
  const activeEffects = getActiveExclusiveEffects();
  return activeEffects.length === 1 && activeEffects[0] === effectName;
}

function getLiveGameLeaderboard(limit = 8) {
  return Array.from(liveGameState.scores.values())
    .sort((left, right) => {
      const rightScore = Math.max(right.bestSurvivalMs || 0, right.currentSurvivalMs || 0);
      const leftScore = Math.max(left.bestSurvivalMs || 0, left.currentSurvivalMs || 0);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return left.joinedAt - right.joinedAt;
    })
    .slice(0, limit)
    .map(({ visitorId, name, bestSurvivalMs, currentSurvivalMs, alive }) => ({
      visitorId,
      name,
      survivalMs: Math.max(bestSurvivalMs || 0, currentSurvivalMs || 0),
      alive: Boolean(alive),
    }));
}

function resetLiveGameState(bumpSession = true) {
  liveGameState.active = false;
  if (bumpSession) {
    liveGameState.sessionId += 1;
  }
  liveGameState.mode = "runner";
  liveGameState.title = "Sky Sprint";
  liveGameState.buttonLabel = "Jump";
  liveGameState.durationSeconds = LIVE_GAME_DEFAULT_DURATION_SECONDS;
  liveGameState.startedAt = 0;
  liveGameState.endsAt = 0;
  liveGameState.seed = 0;
  liveGameState.scores = new Map();
}

function ensureLiveGameStateCurrent() {
  if (!liveGameState.active) {
    return;
  }
  if (Date.now() >= liveGameState.endsAt) {
    resetLiveGameState(false);
  }
}

function getLiveGamePayload() {
  ensureLiveGameStateCurrent();
  return {
    active: liveGameState.active,
    sessionId: liveGameState.sessionId,
    mode: liveGameState.mode,
    title: liveGameState.title,
    buttonLabel: liveGameState.buttonLabel,
    durationSeconds: liveGameState.durationSeconds,
    startedAt: liveGameState.startedAt,
    endsAt: liveGameState.endsAt,
    seed: liveGameState.seed,
    leaderboard: getLiveGameLeaderboard(),
    totalPlayers: liveGameState.scores.size,
  };
}

function upsertLiveGamePlayer(visitorId, preferredName = "") {
  ensureLiveGameStateCurrent();
  if (!liveGameState.active) {
    return null;
  }

  const sanitizedName = sanitizeChatName(preferredName) || `Player ${String(visitorId).slice(-4)}`;
  const existing = liveGameState.scores.get(visitorId);
  if (existing) {
    if (sanitizedName) {
      existing.name = sanitizedName;
    }
    return existing;
  }

  const player = {
    visitorId,
    name: sanitizedName,
    bestSurvivalMs: 0,
    currentSurvivalMs: 0,
    alive: true,
    finishedAt: 0,
    joinedAt: Date.now(),
  };
  liveGameState.scores.set(visitorId, player);
  return player;
}

function clearExclusiveEffects() {
  siteEffects.effectsRevision += 1;
  siteEffects.bannerText = "";
  siteEffects.partyMode = false;
  siteEffects.chaosMode = false;
  siteEffects.takeoverTheme = "";
  siteEffects.popupTitle = "";
  siteEffects.popupMessage = "";
  siteEffects.popupButtonText = "Close";
  siteEffects.maintenanceMode = false;
  siteEffects.maintenanceMessage = DEFAULT_MAINTENANCE_MESSAGE;
  siteEffects.tabTitleOverride = "";
  siteEffects.tabFaviconOverride = "";
  siteEffects.proxyUrlHijack = "";
  siteEffects.weatherEffect = "";
  resetLiveGameState();
}

function markSiteEffectsUpdated() {
  siteEffects.effectsRevision += 1;
}

async function fetchVoiceBlastAudioBuffer(text) {
  const safeText = String(text || "").trim();
  const providers = [
    {
      url: `https://api.streamelements.com/kappa/v2/speech?${new URLSearchParams({
        voice: VOICE_BLAST_DEFAULT_VOICE,
        text: safeText,
      }).toString()}`,
      headers: { Accept: "audio/mpeg" },
    },
    {
      url: `https://translate.google.com/translate_tts?${new URLSearchParams({
        ie: "UTF-8",
        tl: "en",
        client: "tw-ob",
        q: safeText,
      }).toString()}`,
      headers: {
        Accept: "audio/mpeg",
        "User-Agent": "Mozilla/5.0",
      },
    },
  ];

  for (const provider of providers) {
    try {
      const response = await fetch(provider.url, { headers: provider.headers });
      if (!response.ok) {
        continue;
      }

      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") || "audio/mpeg",
      };
    } catch {
      // Try the next provider.
    }
  }

  return null;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function pruneDailyOpens() {
  const key = todayKey();
  for (const day of dailyOpens.keys()) {
    if (day !== key) {
      dailyOpens.delete(day);
    }
  }
}

function getTodaySet() {
  pruneDailyOpens();
  const key = todayKey();
  if (!dailyOpens.has(key)) {
    dailyOpens.set(key, new Set());
  }
  return dailyOpens.get(key);
}

function cleanOnlineUsers() {
  const now = Date.now();
  for (const [visitorId, lastSeen] of onlineUsers.entries()) {
    if (now - lastSeen > ONLINE_TTL) {
      onlineUsers.delete(visitorId);
    }
  }
}

function sanitizeVisitorId(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) {
    return fallback;
  }
  return /^[a-zA-Z0-9-_]+$/.test(trimmed) ? trimmed : fallback;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

function getVisitorId(req) {
  const bodyId = req.body?.visitorId;
  return sanitizeVisitorId(bodyId, getClientIp(req));
}

function sanitizeChatName(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > CHAT_NAME_MAX) {
    return "";
  }

  return /^[a-zA-Z0-9 ._-]+$/.test(trimmed) ? trimmed : "";
}

function sanitizeChatMessage(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function cleanChatCooldowns() {
  const now = Date.now();
  for (const [visitorId, lastSentAt] of chatSendCooldowns.entries()) {
    if (now - lastSentAt > CHAT_COOLDOWN_MS * 10) {
      chatSendCooldowns.delete(visitorId);
    }
  }
}

function randomChatColor() {
  return OWNER_CHAT_COLORS[Math.floor(Math.random() * OWNER_CHAT_COLORS.length)];
}

function pushChatMessage({ name, message, roleTag = "", color = "" }) {
  const chatMessage = {
    id: nextChatMessageId,
    name,
    message,
    roleTag,
    color,
    createdAt: Date.now(),
  };

  nextChatMessageId += 1;
  chatMessages.push(chatMessage);
  if (chatMessages.length > CHAT_MESSAGE_LIMIT) {
    chatMessages.splice(0, chatMessages.length - CHAT_MESSAGE_LIMIT);
  }

  return chatMessage;
}

function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function signAdminSessionPayload(payload) {
  return createHmac("sha256", ADMIN_SESSION_SECRET).update(payload).digest("base64url");
}

function createAdminSessionToken(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + ADMIN_SESSION_TTL }), "utf8").toString("base64url");
  const signature = signAdminSessionPayload(payload);
  return `${payload}.${signature}`;
}

function verifyAdminSessionToken(token) {
  if (typeof token !== "string") {
    return false;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return false;
  }

  const expectedSignature = signAdminSessionPayload(payload);
  if (!safeCompare(signature, expectedSignature)) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number.isFinite(parsed?.exp) && Date.now() <= parsed.exp;
  } catch {
    return false;
  }
}

function getAdminTokenFromRequest(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function cleanAdminSessions() {
  const now = Date.now();
  for (const [token, expiry] of adminSessions.entries()) {
    if (now > expiry) {
      adminSessions.delete(token);
    }
  }
}

function requireAdmin(req, res, next) {
  const token = getAdminTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  cleanAdminSessions();
  if (!adminSessions.has(token) && !verifyAdminSessionToken(token)) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
  return next();
}

if (config.challenge !== false) {
  console.log(chalk.green("🔒 Password protection is enabled! Listing logins below"));
  // biome-ignore lint: idk
  Object.entries(config.users).forEach(([username, password]) => {
    console.log(chalk.blue(`Username: ${username}, Password: ${password}`));
  });
  app.use(basicAuth({ users: config.users, challenge: true }));
}

app.get("/e/*", async (req, res, next) => {
  try {
    if (cache.has(req.path)) {
      const { data, contentType, timestamp } = cache.get(req.path);
      if (Date.now() - timestamp > CACHE_TTL) {
        cache.delete(req.path);
      } else {
        res.writeHead(200, { "Content-Type": contentType });
        return res.end(data);
      }
    }

    const baseUrls = {
      "/e/1/": "https://raw.githubusercontent.com/qrs/x/fixy/",
      "/e/2/": "https://raw.githubusercontent.com/3v1/V5-Assets/main/",
      "/e/3/": "https://raw.githubusercontent.com/3v1/V5-Retro/master/",
    };

    let reqTarget;
    for (const [prefix, baseUrl] of Object.entries(baseUrls)) {
      if (req.path.startsWith(prefix)) {
        reqTarget = baseUrl + req.path.slice(prefix.length);
        break;
      }
    }

    if (!reqTarget) {
      return next();
    }

    const asset = await fetch(reqTarget);
    if (!asset.ok) {
      return next();
    }

    const data = Buffer.from(await asset.arrayBuffer());
    const ext = path.extname(reqTarget);
    const no = [".unityweb"];
    const contentType = no.includes(ext) ? "application/octet-stream" : mime.getType(ext);

    cache.set(req.path, { data, contentType, timestamp: Date.now() });
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch (error) {
    console.error("Error fetching asset:", error);
    res.setHeader("Content-Type", "text/html");
    res.status(500).send("Error fetching the asset");
  }
});

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post("/api/stats/open", (req, res) => {
  const visitorId = getVisitorId(req);
  getTodaySet().add(visitorId);
  cleanOnlineUsers();
  return res.json({ ok: true });
});

app.post("/api/stats/heartbeat", (req, res) => {
  const visitorId = getVisitorId(req);
  onlineUsers.set(visitorId, Date.now());
  cleanOnlineUsers();
  return res.json({ ok: true });
});

app.get("/api/stats", (_req, res) => {
  cleanOnlineUsers();
  return res.json({
    onlineUsers: onlineUsers.size,
    openedToday: getTodaySet().size,
  });
});

app.get("/api/chat/messages", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    messages: chatMessages.slice(-CHAT_FETCH_LIMIT),
  });
});

app.post("/api/chat/messages", (req, res) => {
  const visitorId = getVisitorId(req);
  const name = sanitizeChatName(req.body?.name);
  const message = sanitizeChatMessage(req.body?.message);

  if (!name) {
    return res.status(400).json({ error: "Pick a valid name first." });
  }
  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }
  if (message.length > CHAT_MESSAGE_MAX) {
    return res.status(400).json({ error: `Message too long (max ${CHAT_MESSAGE_MAX} chars).` });
  }

  cleanChatCooldowns();
  const now = Date.now();
  const lastSentAt = chatSendCooldowns.get(visitorId) || 0;
  if (now - lastSentAt < CHAT_COOLDOWN_MS) {
    return res.status(429).json({ error: "Slow down a little." });
  }

  chatSendCooldowns.set(visitorId, now);
  const chatMessage = pushChatMessage({ name, message });

  return res.json({
    ok: true,
    message: chatMessage,
    messages: chatMessages.slice(-CHAT_FETCH_LIMIT),
  });
});

app.post("/api/admin/chat-message", requireAdmin, (req, res) => {
  const name = sanitizeChatName(req.body?.name) || "Owner";
  const message = sanitizeChatMessage(req.body?.message);
  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }
  if (message.length > CHAT_MESSAGE_MAX) {
    return res.status(400).json({ error: `Message too long (max ${CHAT_MESSAGE_MAX} chars).` });
  }

  const chatMessage = pushChatMessage({
    name,
    message,
    roleTag: "OWNER",
    color: randomChatColor(),
  });

  return res.json({
    ok: true,
    message: chatMessage,
    messages: chatMessages.slice(-CHAT_FETCH_LIMIT),
  });
});

app.post("/api/admin/system-message", requireAdmin, (req, res) => {
  const actorName = sanitizeChatName(req.body?.actorName) || "owner";
  const command = sanitizeChatMessage(req.body?.command);
  if (!command) {
    return res.status(400).json({ error: "Command is required." });
  }
  if (command.length > 120) {
    return res.status(400).json({ error: "Command too long." });
  }

  const chatMessage = pushChatMessage({
    name: "SYSTEM",
    message: `${actorName} has run ${command}`,
    roleTag: "SYSTEM",
    color: SYSTEM_CHAT_COLOR,
  });

  return res.json({
    ok: true,
    message: chatMessage,
    messages: chatMessages.slice(-CHAT_FETCH_LIMIT),
  });
});

app.post("/api/admin/clear-chat", requireAdmin, (_req, res) => {
  chatMessages.length = 0;
  chatSendCooldowns.clear();
  nextChatMessageId = 1;
  return res.json({ ok: true, messages: [] });
});

app.post("/api/live-game/join", (req, res) => {
  const visitorId = getVisitorId(req);
  const name = sanitizeChatName(req.body?.name);
  const player = upsertLiveGamePlayer(visitorId, name);
  const payload = getLiveGamePayload();

  if (!payload.active || !player) {
    return res.status(409).json({ error: "No live game is running.", liveGame: payload });
  }

  return res.json({
    ok: true,
    liveGame: payload,
    player: {
      visitorId: player.visitorId,
      name: player.name,
      survivalMs: Math.max(player.bestSurvivalMs || 0, player.currentSurvivalMs || 0),
      alive: Boolean(player.alive),
    },
  });
});

app.post("/api/live-game/score", (req, res) => {
  const visitorId = getVisitorId(req);
  const name = sanitizeChatName(req.body?.name);
  const survivalMs = Number(req.body?.survivalMs);
  const alive = req.body?.alive !== false;
  const player = upsertLiveGamePlayer(visitorId, name);
  const payload = getLiveGamePayload();

  if (!payload.active || !player) {
    return res.status(409).json({ error: "No live game is running.", liveGame: payload });
  }

  const maxSurvivalMs = Math.max(0, liveGameState.endsAt - (player.joinedAt || liveGameState.startedAt));
  const safeSurvivalMs = Number.isFinite(survivalMs)
    ? Math.max(0, Math.min(Math.floor(survivalMs), maxSurvivalMs))
    : 0;

  player.currentSurvivalMs = safeSurvivalMs;
  player.bestSurvivalMs = Math.max(player.bestSurvivalMs || 0, safeSurvivalMs);
  player.alive = Boolean(alive) && Date.now() < liveGameState.endsAt;
  if (!player.alive) {
    player.finishedAt = Date.now();
  }

  return res.json({
    ok: true,
    liveGame: getLiveGamePayload(),
    player: {
      visitorId: player.visitorId,
      name: player.name,
      survivalMs: Math.max(player.bestSurvivalMs || 0, player.currentSurvivalMs || 0),
      alive: Boolean(player.alive),
    },
  });
});

app.get("/api/admin/public-state", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  return res.json({
    effectsRevision: siteEffects.effectsRevision,
    bannerText: siteEffects.bannerText,
    partyMode: siteEffects.partyMode,
    chaosMode: siteEffects.chaosMode,
    confettiVersion: siteEffects.confettiVersion,
    takeoverTheme: siteEffects.takeoverTheme,
    popupTitle: siteEffects.popupTitle,
    popupMessage: siteEffects.popupMessage,
    popupButtonText: siteEffects.popupButtonText,
    popupVersion: siteEffects.popupVersion,
    jumpscareVersion: siteEffects.jumpscareVersion,
    voiceBlastText: siteEffects.voiceBlastText,
    voiceBlastVersion: siteEffects.voiceBlastVersion,
    inputLockDurationMs: siteEffects.inputLockDurationMs,
    inputLockVersion: siteEffects.inputLockVersion,
    maintenanceMode: siteEffects.maintenanceMode,
    maintenanceMessage: siteEffects.maintenanceMessage,
    clientRefreshVersion: siteEffects.clientRefreshVersion,
    tabTitleOverride: siteEffects.tabTitleOverride,
    tabFaviconOverride: siteEffects.tabFaviconOverride,
    proxyUrlHijack: siteEffects.proxyUrlHijack,
    proxyUrlHijackVersion: siteEffects.proxyUrlHijackVersion,
    weatherEffect: siteEffects.weatherEffect,
    liveGame: getLiveGamePayload(),
  });
});

app.post("/api/admin/login", (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();
  const attempts = adminLoginAttempts.get(ip) || { count: 0, lockedUntil: 0 };

  if (now < attempts.lockedUntil) {
    return res.status(429).json({ error: "Too many failed attempts. Try again later." });
  }

  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!code || !safeCompare(code, config.adminCode)) {
    attempts.count += 1;
    if (attempts.count >= 5) {
      attempts.lockedUntil = now + 15 * 60 * 1000;
      attempts.count = 0;
    }
    adminLoginAttempts.set(ip, attempts);
    return res.status(403).json({ error: "Invalid code" });
  }

  adminLoginAttempts.delete(ip);
  const token = createAdminSessionToken(now);
  adminSessions.set(token, now + ADMIN_SESSION_TTL);
  return res.json({ token });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  const token = getAdminTokenFromRequest(req);
  adminSessions.delete(token);
  return res.json({ ok: true });
});

app.get("/api/admin/stats", requireAdmin, (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  cleanOnlineUsers();
  return res.json({
    onlineUsers: onlineUsers.size,
    openedToday: getTodaySet().size,
    cacheEntries: cache.size,
    activeAdminSessions: Math.max(adminSessions.size, 1),
    partyMode: siteEffects.partyMode,
    chaosMode: siteEffects.chaosMode,
    hasBanner: Boolean(siteEffects.bannerText),
    takeoverTheme: siteEffects.takeoverTheme,
    popupActive: Boolean(siteEffects.popupTitle || siteEffects.popupMessage),
    jumpscareVersion: siteEffects.jumpscareVersion,
    maintenanceMode: siteEffects.maintenanceMode,
    clientRefreshVersion: siteEffects.clientRefreshVersion,
    tabHijackActive: Boolean(siteEffects.tabTitleOverride || siteEffects.tabFaviconOverride),
    proxyUrlHijackActive: Boolean(siteEffects.proxyUrlHijack),
    weatherEffect: siteEffects.weatherEffect || "OFF",
    liveGameActive: liveGameState.active,
    liveGamePlayers: liveGameState.scores.size,
    uptime: process.uptime(),
  });
});

app.post("/api/admin/reset-opens", requireAdmin, (_req, res) => {
  dailyOpens.set(todayKey(), new Set());
  return res.json({ ok: true });
});

app.post("/api/admin/clear-online", requireAdmin, (_req, res) => {
  onlineUsers.clear();
  return res.json({ ok: true });
});

app.post("/api/admin/clear-cache", requireAdmin, (_req, res) => {
  cache.clear();
  return res.json({ ok: true });
});

app.post("/api/admin/live-game/start", requireAdmin, (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const buttonLabel = typeof req.body?.buttonLabel === "string" ? req.body.buttonLabel.trim() : "";
  const durationSeconds = Number(req.body?.durationSeconds);
  const safeDurationSeconds = Number.isFinite(durationSeconds)
    ? Math.max(10, Math.min(Math.floor(durationSeconds), LIVE_GAME_MAX_DURATION_SECONDS))
    : LIVE_GAME_DEFAULT_DURATION_SECONDS;

  clearExclusiveEffects();
  liveGameState.active = true;
  liveGameState.mode = "runner";
  liveGameState.title = title || "Sky Sprint";
  liveGameState.buttonLabel = buttonLabel || "Jump";
  liveGameState.durationSeconds = safeDurationSeconds;
  liveGameState.startedAt = Date.now();
  liveGameState.endsAt = liveGameState.startedAt + safeDurationSeconds * 1000;
  liveGameState.seed = Math.floor(Math.random() * 1_000_000_000);
  liveGameState.scores = new Map();

  return res.json({ ok: true, liveGame: getLiveGamePayload() });
});

app.post("/api/admin/live-game/end", requireAdmin, (_req, res) => {
  ensureLiveGameStateCurrent();
  if (!liveGameState.active) {
    return res.json({ ok: true, liveGame: getLiveGamePayload() });
  }
  markSiteEffectsUpdated();
  resetLiveGameState();
  return res.json({ ok: true, liveGame: getLiveGamePayload() });
});

app.post("/api/admin/live-game/reset", requireAdmin, (_req, res) => {
  if (!liveGameState.active) {
    return res.status(409).json({ error: "No live game is running." });
  }
  markSiteEffectsUpdated();
  liveGameState.sessionId += 1;
  liveGameState.scores = new Map();
  liveGameState.startedAt = Date.now();
  liveGameState.endsAt = liveGameState.startedAt + liveGameState.durationSeconds * 1000;
  liveGameState.seed = Math.floor(Math.random() * 1_000_000_000);
  return res.json({ ok: true, liveGame: getLiveGamePayload() });
});

app.post("/api/admin/set-banner", requireAdmin, (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    return res.status(400).json({ error: "Banner text is required" });
  }
  if (text.length > 180) {
    return res.status(400).json({ error: "Banner text too long (max 180 chars)" });
  }
  clearExclusiveEffects();
  siteEffects.bannerText = text;
  return res.json({ ok: true, bannerText: siteEffects.bannerText });
});

app.post("/api/admin/clear-banner", requireAdmin, (_req, res) => {
  markSiteEffectsUpdated();
  siteEffects.bannerText = "";
  return res.json({ ok: true });
});

app.post("/api/admin/toggle-party", requireAdmin, (_req, res) => {
  const disableParty = isOnlyExclusiveEffectActive("party");
  clearExclusiveEffects();
  if (!disableParty) {
    siteEffects.partyMode = true;
    siteEffects.confettiVersion += 1;
  }
  return res.json({
    ok: true,
    partyMode: siteEffects.partyMode,
    confettiVersion: siteEffects.confettiVersion,
  });
});

app.post("/api/admin/toggle-chaos", requireAdmin, (_req, res) => {
  const disableChaos = isOnlyExclusiveEffectActive("chaos");
  clearExclusiveEffects();
  if (!disableChaos) {
    siteEffects.chaosMode = true;
  }
  return res.json({ ok: true, chaosMode: siteEffects.chaosMode });
});

app.post("/api/admin/set-takeover-theme", requireAdmin, (req, res) => {
  const theme = typeof req.body?.theme === "string" ? req.body.theme.trim().toLowerCase() : "";
  if (!takeoverThemes.has(theme)) {
    return res.status(400).json({ error: "Invalid takeover theme" });
  }
  clearExclusiveEffects();
  siteEffects.takeoverTheme = theme;
  return res.json({ ok: true, takeoverTheme: siteEffects.takeoverTheme });
});

app.post("/api/admin/clear-takeover-theme", requireAdmin, (_req, res) => {
  markSiteEffectsUpdated();
  siteEffects.takeoverTheme = "";
  return res.json({ ok: true });
});

app.post("/api/admin/set-popup", requireAdmin, (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const buttonText = typeof req.body?.buttonText === "string" ? req.body.buttonText.trim() : "";

  if (!title && !message) {
    return res.status(400).json({ error: "Popup title or message is required" });
  }
  if (title.length > 80) {
    return res.status(400).json({ error: "Popup title too long (max 80 chars)" });
  }
  if (message.length > 320) {
    return res.status(400).json({ error: "Popup message too long (max 320 chars)" });
  }
  if (buttonText.length > 24) {
    return res.status(400).json({ error: "Button text too long (max 24 chars)" });
  }

  clearExclusiveEffects();
  siteEffects.popupTitle = title;
  siteEffects.popupMessage = message;
  siteEffects.popupButtonText = buttonText || "Close";
  siteEffects.popupVersion += 1;

  return res.json({
    ok: true,
    popupTitle: siteEffects.popupTitle,
    popupMessage: siteEffects.popupMessage,
    popupButtonText: siteEffects.popupButtonText,
    popupVersion: siteEffects.popupVersion,
  });
});

app.post("/api/admin/clear-popup", requireAdmin, (_req, res) => {
  markSiteEffectsUpdated();
  siteEffects.popupTitle = "";
  siteEffects.popupMessage = "";
  siteEffects.popupButtonText = "Close";
  siteEffects.popupVersion += 1;
  return res.json({ ok: true, popupVersion: siteEffects.popupVersion });
});

app.post("/api/admin/set-maintenance", requireAdmin, (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    return res.status(400).json({ error: "Maintenance message is required" });
  }
  if (message.length > 180) {
    return res.status(400).json({ error: "Maintenance message too long (max 180 chars)" });
  }

  clearExclusiveEffects();
  siteEffects.maintenanceMode = true;
  siteEffects.maintenanceMessage = message;
  return res.json({
    ok: true,
    maintenanceMode: siteEffects.maintenanceMode,
    maintenanceMessage: siteEffects.maintenanceMessage,
  });
});

app.post("/api/admin/clear-maintenance", requireAdmin, (_req, res) => {
  markSiteEffectsUpdated();
  siteEffects.maintenanceMode = false;
  siteEffects.maintenanceMessage = DEFAULT_MAINTENANCE_MESSAGE;
  return res.json({ ok: true, maintenanceMode: siteEffects.maintenanceMode });
});

app.post("/api/admin/force-client-refresh", requireAdmin, (_req, res) => {
  markSiteEffectsUpdated();
  siteEffects.clientRefreshVersion += 1;
  return res.json({ ok: true, clientRefreshVersion: siteEffects.clientRefreshVersion });
});

app.post("/api/admin/trigger-jumpscare", requireAdmin, (_req, res) => {
  markSiteEffectsUpdated();
  siteEffects.jumpscareVersion += 1;
  return res.json({ ok: true, jumpscareVersion: siteEffects.jumpscareVersion });
});

app.post("/api/admin/trigger-voice-blast", requireAdmin, (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    return res.status(400).json({ error: "Voice message is required" });
  }
  if (message.length > VOICE_BLAST_MAX_LENGTH) {
    return res.status(400).json({ error: `Voice message too long (max ${VOICE_BLAST_MAX_LENGTH} chars)` });
  }

  markSiteEffectsUpdated();
  siteEffects.voiceBlastText = message;
  siteEffects.voiceBlastVersion += 1;
  return res.json({
    ok: true,
    voiceBlastText: siteEffects.voiceBlastText,
    voiceBlastVersion: siteEffects.voiceBlastVersion,
  });
});

app.post("/api/admin/trigger-input-lock", requireAdmin, (req, res) => {
  const durationMs = Number(req.body?.durationMs);
  const safeDurationMs = Number.isFinite(durationMs)
    ? Math.max(1000, Math.min(Math.floor(durationMs), INPUT_LOCK_MAX_DURATION_MS))
    : INPUT_LOCK_DEFAULT_DURATION_MS;

  markSiteEffectsUpdated();
  siteEffects.inputLockDurationMs = safeDurationMs;
  siteEffects.inputLockVersion += 1;
  return res.json({
    ok: true,
    inputLockDurationMs: siteEffects.inputLockDurationMs,
    inputLockVersion: siteEffects.inputLockVersion,
  });
});

app.get("/api/admin/voice-blast-audio", async (req, res) => {
  const text = typeof req.query?.text === "string" ? req.query.text.trim() : "";
  if (!text) {
    return res.status(400).send("Missing voice text.");
  }
  if (text.length > VOICE_BLAST_MAX_LENGTH) {
    return res.status(400).send("Voice text too long.");
  }

  const audio = await fetchVoiceBlastAudioBuffer(text);
  if (!audio) {
    return res.status(502).send("Voice generation unavailable.");
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", audio.contentType);
  return res.send(audio.buffer);
});

app.post("/api/admin/set-tab-hijack", requireAdmin, (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const favicon = typeof req.body?.favicon === "string" ? req.body.favicon.trim() : "";

  if (!title && !favicon) {
    return res.status(400).json({ error: "Title or favicon is required" });
  }
  if (title.length > 80) {
    return res.status(400).json({ error: "Title too long (max 80 chars)" });
  }
  if (favicon.length > 400) {
    return res.status(400).json({ error: "Favicon URL too long (max 400 chars)" });
  }

  clearExclusiveEffects();
  siteEffects.tabTitleOverride = title;
  siteEffects.tabFaviconOverride = favicon;

  return res.json({
    ok: true,
    tabTitleOverride: siteEffects.tabTitleOverride,
    tabFaviconOverride: siteEffects.tabFaviconOverride,
  });
});

app.post("/api/admin/clear-tab-hijack", requireAdmin, (_req, res) => {
  markSiteEffectsUpdated();
  siteEffects.tabTitleOverride = "";
  siteEffects.tabFaviconOverride = "";
  return res.json({ ok: true });
});

app.post("/api/admin/set-proxy-url-hijack", requireAdmin, (req, res) => {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!url) {
    return res.status(400).json({ error: "Proxy URL is required" });
  }
  if (url.length > 1000) {
    return res.status(400).json({ error: "Proxy URL too long" });
  }

  clearExclusiveEffects();
  siteEffects.proxyUrlHijack = url;
  siteEffects.proxyUrlHijackVersion += 1;

  return res.json({
    ok: true,
    proxyUrlHijack: siteEffects.proxyUrlHijack,
    proxyUrlHijackVersion: siteEffects.proxyUrlHijackVersion,
  });
});

app.post("/api/admin/clear-proxy-url-hijack", requireAdmin, (_req, res) => {
  markSiteEffectsUpdated();
  siteEffects.proxyUrlHijack = "";
  siteEffects.proxyUrlHijackVersion += 1;
  return res.json({ ok: true, proxyUrlHijackVersion: siteEffects.proxyUrlHijackVersion });
});

app.post("/api/admin/set-weather-effect", requireAdmin, (req, res) => {
  const effect = typeof req.body?.effect === "string" ? req.body.effect.trim().toLowerCase() : "";
  if (!weatherEffects.has(effect)) {
    return res.status(400).json({ error: "Invalid weather effect" });
  }
  clearExclusiveEffects();
  siteEffects.weatherEffect = effect;
  return res.json({ ok: true, weatherEffect: siteEffects.weatherEffect });
});

app.post("/api/admin/clear-weather-effect", requireAdmin, (_req, res) => {
  markSiteEffectsUpdated();
  siteEffects.weatherEffect = "";
  return res.json({ ok: true });
});

/* if (process.env.MASQR === "true") {
  console.log(chalk.green("Masqr is enabled"));
  setupMasqr(app);
} */

app.use(express.static(path.join(__dirname, "static")));
app.use("/ca", cors({ origin: true }));

const routes = [
  { path: "/admin", file: "admin.html" },
  { path: "/b", file: "apps.html" },
  { path: "/a", file: "games.html" },
  { path: "/play.html", file: "games.html" },
  { path: "/c", file: "settings.html" },
  { path: "/d", file: "tabs.html" },
  { path: "/", file: "index.html" },
];

// biome-ignore lint: idk
routes.forEach(route => {
  app.get(route.path, (_req, res) => {
    res.sendFile(path.join(__dirname, "static", route.file));
  });
});

app.use((req, res, next) => {
  res.status(404).sendFile(path.join(__dirname, "static", "404.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(__dirname, "static", "404.html"));
});

server.on("request", (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

server.on("listening", () => {
  console.log(chalk.green(`🌍 Server is running on http://localhost:${PORT}`));
});

server.listen({ port: PORT });
