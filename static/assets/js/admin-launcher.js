(() => {
  const WIDGET_ID = "admin-launcher";
  const INPUT_ID = "admin-launcher-input";
  const STATUS_ID = "admin-launcher-status";
  const TOKEN_KEY = "admin_token";

  if (document.getElementById(WIDGET_ID)) {
    return;
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #${WIDGET_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.28);
        background: rgba(7, 35, 33, 0.72);
        backdrop-filter: blur(8px);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3);
      }

      #${WIDGET_ID} input {
        width: 160px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 8px;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        outline: none;
      }

      #${WIDGET_ID} input::placeholder {
        color: rgba(255, 255, 255, 0.58);
      }

      #${WIDGET_ID} button {
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 8px;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.13);
        color: #fff;
        cursor: pointer;
        font-family: inherit;
      }

      #${WIDGET_ID} button:hover {
        background: rgba(255, 255, 255, 0.22);
      }

      #${STATUS_ID} {
        position: fixed;
        right: 16px;
        bottom: 74px;
        z-index: 9999;
        font-size: 12px;
        color: #ffd2d2;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
      }

      @media (max-width: 640px) {
        #${WIDGET_ID} {
          left: 12px;
          right: 12px;
          bottom: 12px;
          justify-content: center;
          flex-wrap: wrap;
        }

        #${WIDGET_ID} input {
          width: 100%;
        }

        #${STATUS_ID} {
          left: 12px;
          right: 12px;
          bottom: 94px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function setStatus(message, ok = false) {
    const status = document.getElementById(STATUS_ID);
    if (!status) {
      return;
    }
    status.textContent = message;
    status.style.color = ok ? "#c9ffe6" : "#ffd2d2";
  }

  async function loginAndOpenAdmin() {
    const input = document.getElementById(INPUT_ID);
    if (!input) {
      return;
    }

    const code = input.value.trim();
    if (!code) {
      setStatus("Enter a code.");
      return;
    }

    setStatus("Checking code...");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.token) {
        setStatus((data && data.error) || "Wrong code.");
        return;
      }

      sessionStorage.setItem(TOKEN_KEY, data.token);
      setStatus("Access granted. Opening admin...", true);
      window.location.href = "/admin";
    } catch {
      setStatus("Network error. Try again.");
    }
  }

  function mount() {
    injectStyles();

    const wrapper = document.createElement("div");
    wrapper.id = WIDGET_ID;
    wrapper.innerHTML = `
      <input id="${INPUT_ID}" type="password" placeholder="Enter admin code" autocomplete="off" />
      <button id="admin-launcher-btn" type="button">Open Admin</button>
    `;

    const status = document.createElement("div");
    status.id = STATUS_ID;

    document.body.appendChild(wrapper);
    document.body.appendChild(status);

    const button = document.getElementById("admin-launcher-btn");
    const input = document.getElementById(INPUT_ID);

    button.addEventListener("click", loginAndOpenAdmin);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        loginAndOpenAdmin();
      }
    });
  }

  if (window.location.pathname === "/admin") {
    return;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
