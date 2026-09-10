(() => {
  "use strict";

  const view = document.getElementById("view-ndef");
  if (!view) return;

  const PASSWORD_SHA256 = "a16c5b00bf16bf31b3e093e8af1f5b139931f77e7fe9a90fe751babf2db91c45";
  let unlocked = false;

  const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");

  async function verify(password) {
    if (!window.crypto?.subtle) return false;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(password || "")));
    return hex(digest) === PASSWORD_SHA256;
  }

  const secure = document.createElement("div");
  secure.id = "nfcLabSecure";
  secure.className = "nfc-lab-secure";

  Array.from(view.children).forEach(child => secure.appendChild(child));

  const gate = document.createElement("article");
  gate.className = "card nfc-lab-gate";
  gate.innerHTML = `
    <div class="nfc-lab-gate-head">
      <div class="nfc-lab-lock-icon" aria-hidden="true">NFC</div>
      <div>
        <h2>NFC Lab do EvCS</h2>
        <p class="muted">Área experimental para amadurecer leitura, gravação e automações NFC antes de levar os recursos ao EvCS principal.</p>
      </div>
    </div>
    <div id="nfcLabLockedControls">
      <div class="field" style="margin-top:14px;margin-bottom:9px">
        <label for="nfcLabPassword">Senha de acesso</label>
        <div class="row nfc-lab-password-row">
          <input id="nfcLabPassword" type="password" inputmode="numeric" autocomplete="off" placeholder="Digite a senha">
          <button class="btn" type="button" id="nfcLabUnlock">Desbloquear</button>
        </div>
      </div>
      <div class="status" id="nfcLabGateStatus">Laboratório bloqueado. A senha é exigida novamente ao sair desta tela ou ocultar o aplicativo.</div>
    </div>
    <div id="nfcLabUnlockedControls" class="nfc-lab-unlocked" hidden>
      <span class="pill">🔓 Laboratório liberado</span>
      <span class="muted small">Ações que alteram uma tag pedem confirmação de senha novamente.</span>
      <button class="btn ghost" type="button" id="nfcLabLock">Bloquear agora</button>
    </div>
  `;

  view.replaceChildren(gate, secure);
  secure.hidden = true;

  const passwordInput = document.getElementById("nfcLabPassword");
  const unlockButton = document.getElementById("nfcLabUnlock");
  const lockButton = document.getElementById("nfcLabLock");
  const lockedControls = document.getElementById("nfcLabLockedControls");
  const unlockedControls = document.getElementById("nfcLabUnlockedControls");
  const gateStatus = document.getElementById("nfcLabGateStatus");

  function setGateStatus(message, type = "") {
    gateStatus.textContent = message;
    gateStatus.className = `status ${type}`.trim();
  }

  function setUnlocked(value) {
    unlocked = Boolean(value);
    secure.hidden = !unlocked;
    lockedControls.hidden = unlocked;
    unlockedControls.hidden = !unlocked;
    gate.classList.toggle("is-unlocked", unlocked);
    if (!unlocked) {
      passwordInput.value = "";
      window.setTimeout(() => passwordInput.focus(), 30);
    }
  }

  async function unlock() {
    unlockButton.disabled = true;
    setGateStatus("Validando acesso…", "info");
    try {
      if (!(await verify(passwordInput.value))) {
        setGateStatus("Senha incorreta. O NFC Lab continua bloqueado.", "bad");
        passwordInput.select();
        return false;
      }
      setUnlocked(true);
      passwordInput.value = "";
      return true;
    } finally {
      unlockButton.disabled = false;
    }
  }

  function lock() {
    if (!unlocked) return;
    setUnlocked(false);
    setGateStatus("Laboratório bloqueado.", "");
  }

  async function requirePassword(action = "continuar") {
    if (!unlocked) {
      setGateStatus("Desbloqueie o NFC Lab antes de continuar.", "warn");
      gate.scrollIntoView({ behavior: "smooth", block: "start" });
      return false;
    }

    const value = window.prompt(`Senha para ${action}:`);
    if (value === null) return false;
    const ok = await verify(value);
    if (!ok) {
      window.alert("Senha incorreta. Operação cancelada.");
      return false;
    }
    return true;
  }

  unlockButton.addEventListener("click", unlock);
  passwordInput.addEventListener("keydown", event => {
    if (event.key === "Enter") unlock();
  });
  lockButton.addEventListener("click", lock);

  [
    ["writeNdefUrl", "gravar dados no NFC"],
    ["restoreNdefBackup", "restaurar o backup NDEF"],
  ].forEach(([id, action]) => {
    const button = document.getElementById(id);
    if (!button) return;
    let authorizedReplay = false;
    button.addEventListener("click", async event => {
      if (authorizedReplay) {
        authorizedReplay = false;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!(await requirePassword(action))) return;
      authorizedReplay = true;
      button.click();
    }, true);
  });

  document.querySelectorAll(".tab").forEach(tab => {
    if (tab.dataset.view !== "ndef") tab.addEventListener("click", lock);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) lock();
  });

  window.ChachaNfcSecurity = Object.freeze({
    verify,
    require: requirePassword,
    lock,
    isUnlocked: () => unlocked,
  });

  setUnlocked(false);
})();
