// index.js
window.addEventListener("load", () => {
  navigator.serviceWorker.register("../sw.js?v=2025-04-15", {
    scope: "/a/",
  });
});

let xl;

try {
  xl = window.top.location.pathname === "/d";
} catch {
  try {
    xl = window.parent.location.pathname === "/d";
  } catch {
    xl = false;
  }
}

const form = document.getElementById("fv");
const input = document.getElementById("input");

if (form && input) {
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      if (xl) processUrl(input.value, "");
      else processUrl(input.value, "/d");
    } catch {
      processUrl(input.value, "/d");
    }
  });
}
function processUrl(value, path) {
  let url = value.trim();
  const engine = localStorage.getItem("engine");

  if (!isUrl(url)) {
    url = buildSearchUrl(url, engine);
  } else if (!(url.startsWith("https://") || url.startsWith("http://"))) {
    url = `https://${url}`;
  }

  const blockedReason = getBlockedReason(url);
  if (blockedReason) {
    alert(blockedReason);
    return;
  }

  if (shouldOpenDirectUrl(url)) {
    window.location.href = url;
    return;
  }

  sessionStorage.setItem("GoUrl", __uv$config.encodeUrl(url));
  const dy = localStorage.getItem("dy");
  const forceDynamic = shouldUseDynamic(url);

  if (dy === "true" || forceDynamic) {
    window.location.href = `/a/${__uv$config.encodeUrl(url)}`;
  } else if (path) {
    location.href = path;
  } else {
    window.location.href = `/a/${__uv$config.encodeUrl(url)}`;
  }
}

function go(value) {
  processUrl(value, "/d");
}

function blank(value) {
  processUrl(value);
}

function dy(value) {
  processUrl(value, `/a/${__uv$config.encodeUrl(value)}`);
}

function isUrl(val = "") {
  if (/^http(s?):\/\//.test(val) || (val.includes(".") && val.substr(0, 1) !== " ")) {
    return true;
  }
  return false;
}

function shouldUseDynamic(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return hostname === "poxel.io" || hostname.endsWith(".poxel.io");
  } catch {
    return false;
  }
}

function getBlockedReason(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (hostname === "poxel.io" || hostname.endsWith(".poxel.io")) {
      return "poxel.io is currently blocked by anti-bot/security verification and may not work on this proxy.";
    }
    return "";
  } catch {
    return "";
  }
}

function buildSearchUrl(query, engine) {
  const fallback = "https://duckduckgo.com/?q=";
  const safeQuery = encodeURIComponent(query.trim());

  if (!engine) {
    return `${fallback}${safeQuery}`;
  }

  if (engine.includes("%s")) {
    try {
      const probe = engine.replace("%s", "test");
      new URL(probe);
      return engine.replace("%s", safeQuery);
    } catch {
      return `${fallback}${safeQuery}`;
    }
  }

  try {
    const normalizedBase = engine.endsWith("=") || engine.endsWith("/") ? engine : `${engine}`;
    new URL(`${normalizedBase}test`);
    return `${normalizedBase}${safeQuery}`;
  } catch {
    return `${fallback}${safeQuery}`;
  }
}

function shouldOpenDirectUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return hostname === "duckduckgo.com"
      || hostname.endsWith(".duckduckgo.com")
      || hostname === "google.com"
      || hostname.endsWith(".google.com")
      || hostname === "bing.com"
      || hostname.endsWith(".bing.com")
      || hostname === "search.yahoo.com"
      || hostname === "qwant.com"
      || hostname.endsWith(".qwant.com")
      || hostname === "startpage.com"
      || hostname.endsWith(".startpage.com")
      || hostname === "searchencrypt.com"
      || hostname.endsWith(".searchencrypt.com")
      || hostname === "ecosia.org"
      || hostname.endsWith(".ecosia.org");
  } catch {
    return false;
  }
}


