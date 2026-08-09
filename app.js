/* ============================================
   ChachaNFC v2 - App Principal
   ============================================ */

(() => {
  "use strict";

  /* ---------- Utils ---------- */
  const $ = id => document.getElementById(id);
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const card = v => (v || "").trim().toUpperCase().replace(/-/g, ":").replace(/\s+/g, "");
  const norm = v => (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const day = (v = new Date()) => {
    const d = new Date(v);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const dt = v => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(v));
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const isEmployeeActive = employee => employee?.active !== false;

  /* ---------- Storage Seguro ---------- */
  const KEYS = {
    employees: "bafometro_employees_v1",
    records:   "bafometro_records_v1",
    operator:  "bafometro_operator_v1",
    schema:    "bafometro_schema_v1"
  };

  const Storage = {
    read(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
      catch { return fallback; }
    },
    write(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(new CustomEvent("bafometro:data-changed", { detail: { key } }));
    },
    exportAll() {
      return {
        version: 2,
        schema: 1,
        generatedAt: new Date().toISOString(),
        employees: this.read(KEYS.employees, []),
        records:   this.read(KEYS.records, [])
      };
    },
    importAll(data) {
      if (!Array.isArray(data.employees) || !Array.isArray(data.records)) throw new Error("Invalid backup");
      this.write(KEYS.employees, data.employees);
      this.write(KEYS.records, data.records);
    }
  };

  // Garantir schema version para futuras migrações
  if (!localStorage.getItem(KEYS.schema)) {
    localStorage.setItem(KEYS.schema, "1");
  }

  /* ---------- Estado ---------- */
  let employees = Storage.read(KEYS.employees, []);
  let records   = Storage.read(KEYS.records, []);
  if (!Array.isArray(employees)) employees = [];
  if (!Array.isArray(records)) records = [];
  let identified = null;   // funcionário atualmente identificado
  let pending    = null;   // item pendente de exclusão no dialog
  let isScanning = false;  // NFC está lendo?

  /* ---------- Audio Feedback (Web Audio API) ---------- */
  const AudioFX = {
    ctx: null,
    ensure() {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    },
    play(freq, type = "sine", duration = 0.15, vol = 0.08) {
      try {
        this.ensure();
        if (this.ctx.state === "suspended") this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) { /* silencioso */ }
    },
    success() { this.play(880); setTimeout(() => this.play(1100), 120); },
    error()   { this.play(200, "sawtooth", 0.3, 0.06); },
    click()   { this.play(600, "sine", 0.05, 0.04); }
  };

  /* ---------- Haptic Feedback ---------- */
  const Haptic = {
    success() { if (navigator.vibrate) navigator.vibrate([50, 30, 80]); },
    error()   { if (navigator.vibrate) navigator.vibrate([100, 50, 100]); },
    light()   { if (navigator.vibrate) navigator.vibrate(20); }
  };

  /* ---------- Status & UI Helpers ---------- */
  function setStatus(el, msg, type = "") {
    el.textContent = msg;
    el.className = `status ${type}`.trim();
  }

  function setNfcState(state, msg) {
    const box = $("nfcBox");
    const status = $("scanTestStatus");
    box.classList.remove("reading", "success", "error");
    if (state) box.classList.add(state);
    if (msg) setStatus(status, msg, state === "success" ? "good" : state === "error" ? "bad" : state === "reading" ? "info" : "");
  }

  function toggleRegisterForm(enabled) {
    const form = $("registerForm");
    const btn = $("saveTest");
    if (enabled) {
      form.classList.remove("form-disabled");
      btn.disabled = false;
    } else {
      form.classList.add("form-disabled");
      btn.disabled = true;
    }
  }

  /* ---------- Navigation ---------- */
  function view(name) {
    document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    $(`view-${name}`)?.classList.add("active");
    document.querySelector(`[data-view="${name}"]`)?.classList.add("active");
    if (name === "funcionarios") renderEmployees();
    if (name === "registros") renderRecords();
  }

  document.querySelectorAll(".tab").forEach(x => {
    x.addEventListener("click", () => {
      AudioFX.click();
      view(x.dataset.view);
    });
  });

  /* ---------- NFC Scan ---------- */
  function reportScan(statusEl, useNfcBox, state, message) {
    if (useNfcBox) {
      setNfcState(state, message);
      return;
    }
    const type = state === "success" ? "good" : state === "error" ? "bad" : state === "reading" ? "info" : "";
    setStatus(statusEl, message, type);
  }

  async function scan(input, statusEl, done, useNfcBox = false) {
    if (!("NDEFReader" in window)) {
      reportScan(statusEl, useNfcBox, "error", "Web NFC indisponível. Use Chrome Android em HTTPS ou digite o ID manualmente.");
      AudioFX.error();
      Haptic.error();
      return;
    }

    if (isScanning) return;
    isScanning = true;

    const controller = new AbortController();
    const reader = new NDEFReader();

    reportScan(statusEl, useNfcBox, "reading", "Aproxime o crachá do celular…");
    Haptic.light();

    const timer = setTimeout(() => {
      controller.abort();
      reportScan(statusEl, useNfcBox, "error", "Tempo esgotado (30s). Tente novamente.");
      AudioFX.error();
      Haptic.error();
      isScanning = false;
    }, 30000);

    reader.addEventListener("readingerror", () => {
      clearTimeout(timer);
      reportScan(statusEl, useNfcBox, "error", "O crachá foi detectado, mas não pôde ser lido.");
      AudioFX.error();
      Haptic.error();
      isScanning = false;
    }, { once: true });

    reader.addEventListener("reading", e => {
      clearTimeout(timer);
      controller.abort();
      const id = card(e.serialNumber);
      if (!id) {
        reportScan(statusEl, useNfcBox, "error", "O navegador não informou o ID do crachá.");
        AudioFX.error();
        Haptic.error();
        isScanning = false;
        return;
      }
      input.value = id;
      reportScan(statusEl, useNfcBox, "success", `✅ Crachá detectado: ${id}`);
      AudioFX.success();
      Haptic.success();
      if (done) done(id);
      isScanning = false;
    }, { once: true });

    try {
      await reader.scan({ signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      if (e.name !== "AbortError") {
        reportScan(statusEl, useNfcBox, "error", `Não foi possível iniciar o NFC (${e.name || "erro"}).`);
        AudioFX.error();
        Haptic.error();
      }
      isScanning = false;
    }
  }

  $("scanTest").addEventListener("click", () => scan($("cardSearch"), $("scanTestStatus"), findEmployee, true));
  $("scanRegister").addEventListener("click", () => scan($("employeeCard"), $("registerStatus"), null, false));

  /* ---------- Identify Employee ---------- */
  function findEmployee(raw) {
    const id = card(raw);
    $("cardSearch").value = id;
    identified = employees.find(e => card(e.cardId) === id && isEmployeeActive(e)) || null;

    if (!identified) {
      $("person").classList.remove("show");
      setStatus($("saveStatus"), `Crachá ${id || "(vazio)"} não cadastrado ou inativo.`, "bad");
      toggleRegisterForm(false);
      AudioFX.error();
      Haptic.error();
      return;
    }

    $("personName").textContent = identified.name;
    $("personInfo").innerHTML = `
      <span class="pill">Matrícula: ${esc(identified.number)}</span>
      ${identified.company ? `<span class="pill">${esc(identified.company)}</span>` : ""}
      ${identified.role ? `<span class="pill">${esc(identified.role)}</span>` : ""}
      <span class="pill">Crachá: ${esc(identified.cardId)}</span>
    `;
    $("person").classList.add("show");
    setStatus($("saveStatus"), `Funcionário identificado: ${identified.name}. Preencha o resultado.`, "good");
    toggleRegisterForm(true);
    AudioFX.success();
    Haptic.success();

    // Auto-focus no resultado para agilizar
    setTimeout(() => $("result").focus(), 300);
  }

  $("findEmployee").addEventListener("click", () => findEmployee($("cardSearch").value));
  $("cardSearch").addEventListener("keydown", e => {
    if (e.key === "Enter") findEmployee(e.currentTarget.value);
  });

  /* ---------- Result Mask & Auto-outcome ---------- */
  function maskResult(value) {
    // Remove tudo exceto números e vírgula
    let v = value.replace(/\./g, ",").replace(/[^0-9,]/g, "");
    // Garante apenas uma vírgula
    const parts = v.split(",");
    if (parts.length > 2) v = parts[0] + "," + parts.slice(1).join("");
    // Limita a 3 casas decimais após a vírgula
    if (parts[1] && parts[1].length > 3) v = parts[0] + "," + parts[1].slice(0, 3);
    return v;
  }

  $("result").addEventListener("input", e => {
    const input = e.target;
    const cursor = input.selectionStart;
    const oldLen = input.value.length;
    input.value = maskResult(input.value);
    const newLen = input.value.length;
    // Ajusta cursor
    input.setSelectionRange(cursor + (newLen - oldLen), cursor + (newLen - oldLen));

    const n = Number(input.value.replace(",", "."));
    if (Number.isFinite(n)) {
      $("outcome").value = n === 0 ? "Liberado" : "Encaminhar";
    }
  });

  /* ---------- Register Test ---------- */
  $("saveTest").addEventListener("click", () => {
    if (!identified) {
      setStatus($("saveStatus"), "Identifique um funcionário antes de registrar.", "bad");
      AudioFX.error();
      return;
    }

    const operator = $("operator").value.trim();
    if (!operator) {
      setStatus($("saveStatus"), "Informe o responsável pelo teste.", "bad");
      $("operator").focus();
      AudioFX.error();
      return;
    }

    const resultVal = $("result").value.trim();
    if (!resultVal) {
      setStatus($("saveStatus"), "Informe o resultado do teste.", "bad");
      $("result").focus();
      AudioFX.error();
      return;
    }

    localStorage.setItem(KEYS.operator, operator);

    const todayRecords = records.filter(r => r.employeeId === identified.id && day(r.createdAt) === day());
    if (todayRecords.length > 0) {
      if (!confirm(`${identified.name} já possui ${todayRecords.length} registro(s) hoje. Registrar novamente?`)) {
        return;
      }
    }

    const now = new Date();
    const r = {
      id: uid(),
      createdAt: now.toISOString(),
      employeeId: identified.id,
      name: identified.name,
      number: identified.number,
      company: identified.company || "",
      role: identified.role || "",
      cardId: identified.cardId,
      result: resultVal,
      unit: $("unit").value,
      outcome: $("outcome").value,
      notes: $("notes").value.trim(),
      operator
    };

    records.unshift(r);
    Storage.write(KEYS.records, records);

    setStatus($("saveStatus"), `✅ Registro salvo para ${identified.name}. Pronto para o próximo!`, "good");
    AudioFX.success();
    Haptic.success();

    // Reset para próximo
    identified = null;
    $("person").classList.remove("show");
    $("cardSearch").value = "";
    $("result").value = "0,00";
    $("outcome").value = "Liberado";
    $("notes").value = "";
    setNfcState(null, "Leitura ainda não iniciada.");
    toggleRegisterForm(false);

    // Foca no campo de busca para agilizar
    setTimeout(() => $("cardSearch").focus(), 200);
  });

  /* ---------- Employee Form ---------- */
  $("employeeForm").addEventListener("submit", e => {
    e.preventDefault();
    const id = $("employeeId").value || uid();
    const existingEmployee = employees.find(x => x.id === id);
    const emp = {
      id,
      name: $("employeeName").value.trim(),
      number: $("employeeNumber").value.trim(),
      company: $("employeeCompany").value.trim(),
      role: $("employeeRole").value.trim(),
      cardId: card($("employeeCard").value),
      active: existingEmployee ? isEmployeeActive(existingEmployee) : true,
      updatedAt: new Date().toISOString()
    };

    if (!emp.name || !emp.number || !emp.cardId) {
      setStatus($("registerStatus"), "Preencha nome, matrícula e ID do crachá.", "bad");
      AudioFX.error();
      return;
    }

    const dc = employees.find(x => card(x.cardId) === emp.cardId && x.id !== id);
    const dn = employees.find(x => x.number === emp.number && x.id !== id);
    if (dc) {
      setStatus($("registerStatus"), `Crachá já vinculado a ${dc.name}.`, "bad");
      AudioFX.error();
      return;
    }
    if (dn) {
      setStatus($("registerStatus"), `Matrícula já pertence a ${dn.name}.`, "bad");
      AudioFX.error();
      return;
    }

    const i = employees.findIndex(x => x.id === id);
    if (i >= 0) employees[i] = emp;
    else employees.push(emp);

    Storage.write(KEYS.employees, employees);
    clearEmployee();
    renderEmployees();
    setStatus($("registerStatus"), "Cadastro salvo com sucesso.", "good");
    AudioFX.success();
    Haptic.success();
  });

  function clearEmployee() {
    $("employeeForm").reset();
    $("employeeId").value = "";
  }

  $("clearEmployee").addEventListener("click", () => {
    clearEmployee();
    setStatus($("registerStatus"), "Formulário limpo.");
  });

  function editEmployee(id) {
    const e = employees.find(x => x.id === id);
    if (!e) return;
    $("employeeId").value = e.id;
    $("employeeName").value = e.name;
    $("employeeNumber").value = e.number;
    $("employeeCompany").value = e.company || "";
    $("employeeRole").value = e.role || "";
    $("employeeCard").value = e.cardId;
    scrollTo({ top: 0, behavior: "smooth" });
    setStatus($("registerStatus"), `Editando ${e.name}.`, "warn");
    AudioFX.click();
  }

  function toggleEmployeeActive(id) {
    const emp = employees.find(x => x.id === id);
    if (!emp) return;
    const currentlyActive = isEmployeeActive(emp);
    const action = currentlyActive ? "inativar" : "ativar";
    if (!confirm(`Confirma ${action} ${emp.name}?`)) return;
    emp.active = !currentlyActive;
    emp.updatedAt = new Date().toISOString();
    Storage.write(KEYS.employees, employees);
    renderEmployees();
    AudioFX.click();
  }

  /* ---------- Dialog / Delete ---------- */
  function askDelete(type, id, label) {
    pending = { type, id };
    $("dialogText").textContent = `Excluir ${label}?`;
    $("dialog").showModal();
  }

  $("cancelDelete").addEventListener("click", () => {
    $("dialog").close();
    pending = null;
  });

  $("confirmDelete").addEventListener("click", () => {
    if (!pending) return;
    if (pending.type === "employee") {
      employees = employees.filter(x => x.id !== pending.id);
      Storage.write(KEYS.employees, employees);
      renderEmployees();
    } else {
      records = records.filter(x => x.id !== pending.id);
      Storage.write(KEYS.records, records);
      renderRecords();
    }
    pending = null;
    $("dialog").close();
    AudioFX.click();
  });

  /* ---------- Render Employees ---------- */
  function renderEmployees() {
    const q = norm($("employeeSearch").value);
    const list = employees
      .filter(e => !q || norm(`${e.name} ${e.number} ${e.company} ${e.role} ${e.cardId}`).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    if (!list.length) {
      $("employeesList").innerHTML = '<div class="empty">Nenhum funcionário encontrado.</div>';
      return;
    }

    $("employeesList").innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Matrícula</th>
              <th>Empresa</th>
              <th>Crachá</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(e => `
              <tr class="${isEmployeeActive(e) ? "" : "muted"}">
                <td data-label="Nome"><strong>${esc(e.name)}</strong><br><span class="muted small">${esc(e.role || "")}</span></td>
                <td data-label="Matrícula">${esc(e.number)}</td>
                <td data-label="Empresa">${esc(e.company || "—")}</td>
                <td data-label="Crachá">${esc(e.cardId)}</td>
                <td data-label="Status">${isEmployeeActive(e) ? "Ativo" : "Inativo"}</td>
                <td data-label="Ações">
                  <button class="link-btn" data-edit="${e.id}">Editar</button>
                  <button class="link-btn ${isEmployeeActive(e) ? "delete" : ""}" data-toggle="${e.id}">${isEmployeeActive(e) ? "Inativar" : "Ativar"}</button>
                  <button class="link-btn delete" data-del="${e.id}">Excluir</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    document.querySelectorAll("[data-edit]").forEach(b => {
      b.addEventListener("click", () => editEmployee(b.dataset.edit));
    });
    document.querySelectorAll("[data-toggle]").forEach(b => {
      b.addEventListener("click", () => toggleEmployeeActive(b.dataset.toggle));
    });
    document.querySelectorAll("[data-del]").forEach(b => {
      b.addEventListener("click", () => {
        const e = employees.find(x => x.id === b.dataset.del);
        askDelete("employee", b.dataset.del, e?.name || "o funcionário");
      });
    });
  }

  $("employeeSearch").addEventListener("input", renderEmployees);

  /* ---------- Render Records ---------- */
  function matches(r, q, d) {
    return (!q || norm(`${r.name} ${r.number} ${r.company} ${r.cardId} ${r.outcome} ${r.operator}`).includes(q))
      && (!d || day(r.createdAt) === d);
  }

  function renderRecords() {
    const q = norm($("recordSearch").value);
    const d = $("recordDate").value;
    const list = records.filter(r => matches(r, q, d));
    const today = records.filter(r => day(r.createdAt) === day());

    $("kpiToday").textContent = today.length;
    $("kpiReleased").textContent = today.filter(r => r.outcome === "Liberado").length;
    $("kpiReferred").textContent = today.filter(r => r.outcome === "Encaminhar").length;
    $("kpiEmployees").textContent = employees.filter(isEmployeeActive).length;

    if (!list.length) {
      $("recordsList").innerHTML = '<div class="empty">Nenhum registro encontrado.</div>';
      return;
    }

    $("recordsList").innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data e hora</th>
              <th>Funcionário</th>
              <th>Matrícula</th>
              <th>Resultado</th>
              <th>Situação</th>
              <th>Responsável</th>
              <th>Observação</th>
              <th class="no-print">Ação</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(r => `
              <tr>
                <td>${esc(dt(r.createdAt))}</td>
                <td><strong>${esc(r.name)}</strong><br><span class="muted small">${esc(r.company)}</span></td>
                <td>${esc(r.number)}</td>
                <td>${esc(r.result)} ${esc(r.unit)}</td>
                <td><span class="pill ${r.outcome === "Liberado" ? "status good" : r.outcome === "Encaminhar" ? "status bad" : "status warn"}">${esc(r.outcome)}</span></td>
                <td>${esc(r.operator)}</td>
                <td>${esc(r.notes || "—")}</td>
                <td class="no-print"><button class="link-btn delete" data-rdel="${r.id}">Excluir</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    document.querySelectorAll("[data-rdel]").forEach(b => {
      b.addEventListener("click", () => {
        const r = records.find(x => x.id === b.dataset.rdel);
        askDelete("record", b.dataset.rdel, `o registro de ${r?.name || "teste"}`);
      });
    });
  }

  $("recordSearch").addEventListener("input", renderRecords);
  $("recordDate").addEventListener("change", renderRecords);

  /* ---------- Export / Backup ---------- */
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

  function download(name, data, type) {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function csv(name, head, rows) {
    download(name, "\uFEFF" + [head, ...rows].map(r => r.map(cell).join(";")).join("\r\n"), "text/csv;charset=utf-8");
  }

  $("exportEmployees").addEventListener("click", () => {
    csv(`funcionarios_${day()}.csv`, ["Nome", "Matrícula", "Empresa", "Função", "ID do crachá", "Ativo"],
      employees.map(e => [e.name, e.number, e.company, e.role, e.cardId, isEmployeeActive(e) ? "Sim" : "Não"]));
    AudioFX.click();
  });

  $("exportRecords").addEventListener("click", () => {
    const q = norm($("recordSearch").value);
    const d = $("recordDate").value;
    const list = records.filter(r => matches(r, q, d));
    csv(`bafometro_${d || day()}.csv`,
      ["Data e hora", "Nome", "Matrícula", "Empresa", "Função", "ID do crachá", "Resultado", "Unidade", "Situação", "Responsável", "Observação"],
      list.map(r => [dt(r.createdAt), r.name, r.number, r.company, r.role, r.cardId, r.result, r.unit, r.outcome, r.operator, r.notes]));
    AudioFX.click();
  });

  function clearPrintMode() {
    document.body.classList.remove("print-records");
  }

  window.addEventListener("afterprint", clearPrintMode);

  $("printRecords").addEventListener("click", () => {
    AudioFX.click();
    document.body.classList.add("print-records");
    setTimeout(() => window.print(), 50);
  });

  $("backup").addEventListener("click", () => {
    download(`backup_bafometro_${day()}.json`, JSON.stringify(Storage.exportAll(), null, 2), "application/json");
    AudioFX.success();
  });

  $("restore").addEventListener("click", () => $("restoreFile").click());

  $("restoreFile").addEventListener("change", async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!confirm("Substituir os dados locais pelos dados do backup? Os dados atuais serão perdidos.")) return;
      Storage.importAll(data);
      employees = Storage.read(KEYS.employees, []);
      records = Storage.read(KEYS.records, []);
      renderEmployees();
      renderRecords();
      AudioFX.success();
      alert("✅ Backup restaurado com sucesso.");
    } catch {
      AudioFX.error();
      alert("❌ Arquivo de backup inválido ou corrompido.");
    } finally {
      e.target.value = "";
    }
  });

  /* ---------- Sincronização App ↔ Indicadores / outras abas ---------- */
  function syncFromStorage(changedKey = null) {
    if (!changedKey || changedKey === KEYS.employees) {
      const nextEmployees = Storage.read(KEYS.employees, []);
      employees = Array.isArray(nextEmployees) ? nextEmployees : [];

      if (identified) {
        const refreshed = employees.find(e => e.id === identified.id);
        if (!refreshed || !isEmployeeActive(refreshed)) {
          const previousName = identified.name;
          identified = null;
          $("person").classList.remove("show");
          toggleRegisterForm(false);
          setStatus($("saveStatus"), `${previousName} foi inativado ou removido do cadastro.`, "warn");
        } else {
          identified = refreshed;
        }
      }
      renderEmployees();
    }

    if (!changedKey || changedKey === KEYS.records) {
      const nextRecords = Storage.read(KEYS.records, []);
      records = Array.isArray(nextRecords) ? nextRecords : [];
    }

    renderRecords();
  }

  window.addEventListener("bafometro:data-changed", event => {
    syncFromStorage(event.detail?.key || null);
  });

  window.addEventListener("storage", event => {
    if (!event.key || event.key === KEYS.employees || event.key === KEYS.records) {
      syncFromStorage(event.key);
    }
  });

  /* ---------- Before unload warning ---------- */
  window.addEventListener("beforeunload", e => {
    if (identified) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  /* ---------- Init ---------- */
  $("operator").value = localStorage.getItem(KEYS.operator) || "";
  $("recordDate").value = day();
  toggleRegisterForm(false);
  renderEmployees();
  renderRecords();

  if ("serviceWorker" in navigator) {
    addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
  }
})();
