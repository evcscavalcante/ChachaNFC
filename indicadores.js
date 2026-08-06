(() => {
  "use strict";

  const KEYS = {
    employees: "bafometro_employees_v1",
    records: "bafometro_records_v1",
  };

  const VALID_COMPLETED_OUTCOMES = new Set(["Liberado", "Encaminhar"]);
  const DATA_CHANGED_EVENT = "bafometro:data-changed";

  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
    );
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  const localDay = (value = new Date()) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const formatDateTime = (value) =>
    value
      ? new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(value))
      : "—";
  const formatPercent = (value) =>
    `${Number.isFinite(value) ? value.toFixed(1).replace(".", ",") : "0,0"}%`;
  const parseJson = (raw, fallback) => {
    try {
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  };

  /**
   * Contrato de leitura isolado para permitir futura troca do localStorage
   * por API/backend sem reescrever os cálculos e a interface.
   */
  const dataSource = {
    kind: "localStorage",
    async listEmployees() {
      const items = parseJson(localStorage.getItem(KEYS.employees), []);
      return Array.isArray(items) ? items.map(normalizeEmployee) : [];
    },
    async listRecords() {
      const items = parseJson(localStorage.getItem(KEYS.records), []);
      return Array.isArray(items) ? items.map(normalizeRecord) : [];
    },
    async setEmployeeActive(employeeId, active) {
      const rawItems = parseJson(localStorage.getItem(KEYS.employees), []);
      if (!Array.isArray(rawItems)) return false;
      const index = rawItems.findIndex((item) => item?.id === employeeId);
      if (index < 0) return false;
      rawItems[index] = {
        ...rawItems[index],
        active,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(KEYS.employees, JSON.stringify(rawItems));
      return true;
    },
    subscribe(listener) {
      const onChanged = () => listener();
      const onStorage = (event) => {
        if (!event.key || Object.values(KEYS).includes(event.key)) listener();
      };
      window.addEventListener(DATA_CHANGED_EVENT, onChanged);
      window.addEventListener("storage", onStorage);
      window.addEventListener("focus", onChanged);
      document.addEventListener("visibilitychange", onChanged);
      return () => {
        window.removeEventListener(DATA_CHANGED_EVENT, onChanged);
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("focus", onChanged);
        document.removeEventListener("visibilitychange", onChanged);
      };
    },
  };

  function normalizeEmployee(item) {
    const source = item && typeof item === "object" ? item : {};
    return {
      id: String(source.id ?? ""),
      name: String(source.name ?? "").trim(),
      number: String(source.number ?? "").trim(),
      company: String(source.company ?? "").trim(),
      role: String(source.role ?? "").trim(),
      cardId: String(source.cardId ?? "").trim(),
      active: source.active !== false,
      updatedAt: source.updatedAt ? String(source.updatedAt) : "",
    };
  }

  function normalizeRecord(item) {
    const source = item && typeof item === "object" ? item : {};
    return {
      id: String(source.id ?? ""),
      createdAt: String(source.createdAt ?? ""),
      employeeId: String(source.employeeId ?? ""),
      name: String(source.name ?? "").trim(),
      number: String(source.number ?? "").trim(),
      company: String(source.company ?? "").trim(),
      role: String(source.role ?? "").trim(),
      cardId: String(source.cardId ?? "").trim(),
      result: String(source.result ?? "").trim(),
      unit: String(source.unit ?? "").trim(),
      outcome: String(source.outcome ?? "").trim(),
      notes: String(source.notes ?? "").trim(),
      operator: String(source.operator ?? "").trim(),
    };
  }

  function patchLocalStorageNotifications() {
    if (window.__bafometroStoragePatched) return;
    window.__bafometroStoragePatched = true;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      originalSetItem.call(this, key, value);
      if (this === localStorage && Object.values(KEYS).includes(key)) {
        window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { key } }));
      }
    };
    Storage.prototype.removeItem = function patchedRemoveItem(key) {
      originalRemoveItem.call(this, key);
      if (this === localStorage && Object.values(KEYS).includes(key)) {
        window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { key } }));
      }
    };
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function endOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }

  function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  }

  function monthRange(offset = 0) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  function resolvePresetRange(preset) {
    const now = new Date();
    if (preset === "today") {
      return { start: startOfDay(now), end: endOfDay(now) };
    }
    if (preset === "7days") {
      return { start: startOfDay(addDays(now, -6)), end: endOfDay(now) };
    }
    if (preset === "previousMonth") return monthRange(-1);
    if (preset === "all") return { start: null, end: null };
    return monthRange(0);
  }

  function dateInputValue(value) {
    return value ? localDay(value) : "";
  }

  function parseDateInput(value, end = false) {
    if (!value) return null;
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return null;
    return end
      ? new Date(year, month - 1, day, 23, 59, 59, 999)
      : new Date(year, month - 1, day);
  }

  function recordInRange(record, start, end) {
    const timestamp = new Date(record.createdAt).getTime();
    if (!Number.isFinite(timestamp)) return false;
    return (!start || timestamp >= start.getTime()) && (!end || timestamp <= end.getTime());
  }

  function employeeKey(employee) {
    return employee.id || `number:${normalize(employee.number)}`;
  }

  function recordEmployeeKey(record) {
    return record.employeeId || `number:${normalize(record.number)}`;
  }

  function latestRecord(records) {
    return records.reduce((latest, current) => {
      if (!latest) return current;
      return new Date(current.createdAt).getTime() > new Date(latest.createdAt).getTime()
        ? current
        : latest;
    }, null);
  }

  function classifyEmployee(employee, recordsByEmployee) {
    if (!employee.active) return "inactive";
    const records = recordsByEmployee.get(employeeKey(employee)) ?? [];
    if (records.some((record) => VALID_COMPLETED_OUTCOMES.has(record.outcome))) return "completed";
    const latest = latestRecord(records);
    if (latest?.outcome === "Recusou") return "refused";
    if (latest?.outcome === "Não realizado") return "notCompleted";
    return "pending";
  }

  function buildMetrics(employees, records, filters) {
    const activeEmployees = employees.filter((employee) => employee.active);
    const filteredRecords = records.filter((record) =>
      recordInRange(record, filters.start, filters.end),
    );
    const recordsByEmployee = new Map();
    for (const record of filteredRecords) {
      const key = recordEmployeeKey(record);
      const list = recordsByEmployee.get(key) ?? [];
      list.push(record);
      recordsByEmployee.set(key, list);
    }

    const personRows = employees.map((employee) => {
      const employeeRecords = recordsByEmployee.get(employeeKey(employee)) ?? [];
      const completedRecords = employeeRecords.filter((record) =>
        VALID_COMPLETED_OUTCOMES.has(record.outcome),
      );
      return {
        employee,
        records: employeeRecords,
        completedRecords,
        latest: latestRecord(employeeRecords),
        classification: classifyEmployee(employee, recordsByEmployee),
      };
    });

    const completedPeople = personRows.filter((row) => row.classification === "completed");
    const pendingPeople = personRows.filter(
      (row) => row.employee.active && row.classification !== "completed",
    );
    const approachedPeople = personRows.filter(
      (row) => row.employee.active && row.records.length > 0,
    );
    const completedRecords = filteredRecords.filter((record) =>
      VALID_COMPLETED_OUTCOMES.has(record.outcome),
    );
    const completedRecordCount = completedRecords.length;
    const uniqueCompletedRecordKeys = new Set(
      completedRecords.map((record) => recordEmployeeKey(record)),
    );
    const repeatedCompletedRecords = Math.max(
      0,
      completedRecordCount - uniqueCompletedRecordKeys.size,
    );
    const coverage = activeEmployees.length
      ? (completedPeople.length / activeEmployees.length) * 100
      : 0;
    const approachRate = activeEmployees.length
      ? (approachedPeople.length / activeEmployees.length) * 100
      : 0;

    const outcomes = {
      released: filteredRecords.filter((record) => record.outcome === "Liberado").length,
      referred: filteredRecords.filter((record) => record.outcome === "Encaminhar").length,
      refused: filteredRecords.filter((record) => record.outcome === "Recusou").length,
      notCompleted: filteredRecords.filter((record) => record.outcome === "Não realizado").length,
    };

    return {
      activeEmployees,
      filteredRecords,
      recordsByEmployee,
      personRows,
      completedPeople,
      pendingPeople,
      approachedPeople,
      completedRecordCount,
      repeatedCompletedRecords,
      coverage,
      approachRate,
      outcomes,
    };
  }

  function groupByRole(metrics) {
    const groups = new Map();
    for (const row of metrics.personRows.filter((item) => item.employee.active)) {
      const role = row.employee.role || "Não informada";
      const key = normalize(role) || "nao-informada";
      const group = groups.get(key) ?? {
        role,
        active: 0,
        tested: 0,
        completedRecords: 0,
        referred: 0,
      };
      group.active += 1;
      if (row.classification === "completed") group.tested += 1;
      group.completedRecords += row.completedRecords.length;
      group.referred += row.records.filter((record) => record.outcome === "Encaminhar").length;
      groups.set(key, group);
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        coverage: group.active ? (group.tested / group.active) * 100 : 0,
        occurrenceRate: group.completedRecords
          ? (group.referred / group.completedRecords) * 100
          : 0,
      }))
      .sort((left, right) =>
        right.occurrenceRate - left.occurrenceRate ||
        right.referred - left.referred ||
        left.role.localeCompare(right.role, "pt-BR"),
      );
  }

  function buildDailyEvolution(metrics, start, end) {
    if (!start || !end) return [];
    const days = [];
    const cumulativeCompleted = new Set();
    for (let date = startOfDay(start); date <= end; date = addDays(date, 1)) {
      const dateKey = localDay(date);
      const dayRecords = metrics.filteredRecords.filter(
        (record) => localDay(record.createdAt) === dateKey,
      );
      const newCompleted = new Set();
      for (const record of dayRecords) {
        if (!VALID_COMPLETED_OUTCOMES.has(record.outcome)) continue;
        const key = recordEmployeeKey(record);
        if (!cumulativeCompleted.has(key)) newCompleted.add(key);
        cumulativeCompleted.add(key);
      }
      days.push({
        date: dateKey,
        records: dayRecords.length,
        newCompleted: newCompleted.size,
        cumulative: cumulativeCompleted.size,
        coverage: metrics.activeEmployees.length
          ? (cumulativeCompleted.size / metrics.activeEmployees.length) * 100
          : 0,
      });
    }
    return days;
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function downloadCsv(name, headers, rows) {
    const content =
      "\uFEFF" +
      [headers, ...rows]
        .map((row) => row.map(csvCell).join(";"))
        .join("\r\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function createIndicatorsView() {
    if ($("view-indicadores")) return;
    const main = document.querySelector("main");
    const nav = document.querySelector("nav");
    if (!main || !nav) return;

    const section = document.createElement("section");
    section.id = "view-indicadores";
    section.className = "view indicators-view";
    section.innerHTML = `
      <article class="card indicators-card">
        <div class="indicators-header">
          <div>
            <h2>Indicadores operacionais</h2>
            <p class="muted small">Cobertura calculada sobre funcionários ativos no período selecionado.</p>
          </div>
          <span class="data-source-badge" title="Estrutura preparada para futura troca por API">Fonte: armazenamento local</span>
        </div>

        <div class="indicator-filters no-print">
          <label><span>Período</span><select id="indicatorPreset"><option value="today">Hoje</option><option value="7days">Últimos 7 dias</option><option value="currentMonth" selected>Mês atual</option><option value="previousMonth">Mês anterior</option><option value="custom">Personalizado</option><option value="all">Todo o histórico</option></select></label>
          <label><span>De</span><input id="indicatorStart" type="date"></label>
          <label><span>Até</span><input id="indicatorEnd" type="date"></label>
          <label><span>Empresa</span><select id="indicatorCompany"><option value="">Todas</option></select></label>
          <label><span>Função</span><select id="indicatorRole"><option value="">Todas</option></select></label>
        </div>

        <div class="indicator-kpis">
          <div class="indicator-kpi"><span>Ativos</span><strong id="indicatorActive">0</strong></div>
          <div class="indicator-kpi"><span>Testados</span><strong id="indicatorTested">0</strong></div>
          <div class="indicator-kpi"><span>Pendentes</span><strong id="indicatorPending">0</strong></div>
          <div class="indicator-kpi primary"><span>Cobertura</span><strong id="indicatorCoverage">0,0%</strong></div>
          <div class="indicator-kpi"><span>Registros</span><strong id="indicatorRecords">0</strong></div>
        </div>

        <div class="technical-strip">
          <div><span>Abordados</span><strong id="indicatorApproached">0</strong><small id="indicatorApproachRate">0,0%</small></div>
          <div><span>Liberados</span><strong id="indicatorReleased">0</strong></div>
          <div><span>Encaminhar</span><strong id="indicatorReferred">0</strong></div>
          <div><span>Recusaram</span><strong id="indicatorRefused">0</strong></div>
          <div><span>Não realizados</span><strong id="indicatorNotCompleted">0</strong></div>
          <div><span>Retestes</span><strong id="indicatorRepeats">0</strong></div>
        </div>
      </article>

      <article class="card indicators-card">
        <div class="section-heading">
          <div><h2>Cobertura nominal</h2><p class="muted small">Identifica objetivamente quem concluiu e quem ainda precisa realizar.</p></div>
          <button class="btn secondary no-print" id="exportIndicatorPeople">Exportar lista</button>
        </div>
        <div class="indicator-list-filters no-print">
          <select id="indicatorPersonStatus"><option value="all">Todos os funcionários</option><option value="completed">Concluídos</option><option value="pending">Pendentes sem registro</option><option value="refused">Recusaram</option><option value="notCompleted">Não realizados</option><option value="inactive">Inativos</option></select>
          <input id="indicatorPersonSearch" placeholder="Pesquisar nome, matrícula, empresa ou função">
        </div>
        <div id="indicatorPeopleList"></div>
      </article>

      <div class="grid two indicator-analysis-grid">
        <article class="card indicators-card">
          <div class="section-heading"><div><h2>Análise por função</h2><p class="muted small">Taxa de ocorrência = encaminhamentos ÷ testes concluídos.</p></div></div>
          <div id="indicatorRolesTable"></div>
        </article>
        <article class="card indicators-card">
          <div class="section-heading"><div><h2>Evolução diária</h2><p class="muted small">Pessoas novas concluídas e cobertura acumulada.</p></div></div>
          <div id="indicatorEvolution"></div>
        </article>
      </div>
    `;
    main.appendChild(section);

    const tab = document.createElement("button");
    tab.className = "tab";
    tab.dataset.view = "indicadores";
    tab.textContent = "Indicadores";
    tab.addEventListener("click", () => activateIndicators());
    nav.appendChild(tab);
  }

  function activateIndicators() {
    document.querySelectorAll(".view").forEach((element) => element.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((element) => element.classList.remove("active"));
    $("view-indicadores")?.classList.add("active");
    document.querySelector('[data-view="indicadores"]')?.classList.add("active");
    void renderIndicators();
  }

  const state = {
    filters: {
      preset: "currentMonth",
      start: null,
      end: null,
      company: "",
      role: "",
      personStatus: "all",
      personSearch: "",
    },
    metrics: null,
  };

  function applyPreset(preset) {
    state.filters.preset = preset;
    const custom = preset === "custom";
    if (!custom) {
      const range = resolvePresetRange(preset);
      state.filters.start = range.start;
      state.filters.end = range.end;
      $("indicatorStart").value = dateInputValue(range.start);
      $("indicatorEnd").value = dateInputValue(range.end);
    }
    $("indicatorStart").disabled = !custom;
    $("indicatorEnd").disabled = !custom;
  }

  function populateSelect(select, values, currentValue, allLabel) {
    if (!select) return;
    const normalizedValues = Array.from(
      new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)),
    ).sort((left, right) => left.localeCompare(right, "pt-BR"));
    select.innerHTML = `<option value="">${esc(allLabel)}</option>${normalizedValues
      .map((value) => `<option value="${esc(value)}">${esc(value)}</option>`)
      .join("")}`;
    select.value = normalizedValues.includes(currentValue) ? currentValue : "";
  }

  function filterEmployeesByOrganization(employees) {
    return employees.filter((employee) => {
      const companyMatches =
        !state.filters.company || employee.company === state.filters.company;
      const roleMatches = !state.filters.role || employee.role === state.filters.role;
      return companyMatches && roleMatches;
    });
  }

  async function renderIndicators() {
    if (!$("view-indicadores")) return;
    const [allEmployees, allRecords] = await Promise.all([
      dataSource.listEmployees(),
      dataSource.listRecords(),
    ]);

    populateSelect($("indicatorCompany"), allEmployees.map((item) => item.company), state.filters.company, "Todas");
    populateSelect($("indicatorRole"), allEmployees.map((item) => item.role), state.filters.role, "Todas");
    state.filters.company = $("indicatorCompany").value;
    state.filters.role = $("indicatorRole").value;

    const employees = filterEmployeesByOrganization(allEmployees);
    const hasRosterFilter = Boolean(state.filters.company || state.filters.role);
    const selectedEmployeeKeys = new Set(employees.map((employee) => employeeKey(employee)));
    const records = hasRosterFilter
      ? allRecords.filter((record) => selectedEmployeeKeys.has(recordEmployeeKey(record)))
      : allRecords;
    const metrics = buildMetrics(employees, records, state.filters);
    state.metrics = metrics;

    $("indicatorActive").textContent = metrics.activeEmployees.length;
    $("indicatorTested").textContent = metrics.completedPeople.length;
    $("indicatorPending").textContent = metrics.pendingPeople.length;
    $("indicatorCoverage").textContent = formatPercent(metrics.coverage);
    $("indicatorRecords").textContent = metrics.filteredRecords.length;
    $("indicatorApproached").textContent = metrics.approachedPeople.length;
    $("indicatorApproachRate").textContent = formatPercent(metrics.approachRate);
    $("indicatorReleased").textContent = metrics.outcomes.released;
    $("indicatorReferred").textContent = metrics.outcomes.referred;
    $("indicatorRefused").textContent = metrics.outcomes.refused;
    $("indicatorNotCompleted").textContent = metrics.outcomes.notCompleted;
    $("indicatorRepeats").textContent = metrics.repeatedCompletedRecords;

    renderPeople(metrics.personRows);
    renderRoles(groupByRole(metrics));
    renderEvolution(buildDailyEvolution(metrics, state.filters.start, state.filters.end));
  }

  function personStatusLabel(classification) {
    return {
      completed: "Concluído",
      pending: "Sem registro",
      refused: "Recusou",
      notCompleted: "Não realizado",
      inactive: "Inativo",
    }[classification] ?? classification;
  }

  function personStatusClass(classification) {
    return `indicator-status ${classification}`;
  }

  function renderPeople(rows) {
    const statusFilter = state.filters.personStatus;
    const search = normalize(state.filters.personSearch);
    const visibleRows = rows
      .filter((row) => statusFilter === "all" || row.classification === statusFilter)
      .filter((row) => {
        if (!search) return true;
        return normalize(
          `${row.employee.name} ${row.employee.number} ${row.employee.company} ${row.employee.role}`,
        ).includes(search);
      })
      .sort((left, right) => left.employee.name.localeCompare(right.employee.name, "pt-BR"));

    const container = $("indicatorPeopleList");
    if (!visibleRows.length) {
      container.innerHTML = '<div class="empty">Nenhum funcionário encontrado neste recorte.</div>';
      return;
    }
    container.innerHTML = `
      <div class="table-wrap indicator-table-wrap">
        <table class="indicator-table people-table">
          <thead><tr><th>Funcionário</th><th>Matrícula</th><th>Empresa</th><th>Função</th><th>Situação</th><th>Último registro</th><th class="no-print">Cadastro</th></tr></thead>
          <tbody>${visibleRows
            .map(
              (row) => `<tr>
                <td><strong>${esc(row.employee.name)}</strong></td>
                <td>${esc(row.employee.number)}</td>
                <td>${esc(row.employee.company || "—")}</td>
                <td>${esc(row.employee.role || "—")}</td>
                <td><span class="${personStatusClass(row.classification)}">${esc(personStatusLabel(row.classification))}</span></td>
                <td>${row.latest ? `${esc(formatDateTime(row.latest.createdAt))}<br><span class="muted small">${esc(row.latest.outcome)}</span>` : "—"}</td>
                <td class="no-print"><button class="link-btn" data-active-id="${esc(row.employee.id)}" data-active-value="${row.employee.active ? "false" : "true"}">${row.employee.active ? "Inativar" : "Ativar"}</button></td>
              </tr>`,
            )
            .join("")}</tbody>
        </table>
      </div>`;
    container.querySelectorAll("[data-active-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const active = button.dataset.activeValue === "true";
        const action = active ? "ativar" : "inativar";
        if (!window.confirm(`Confirma ${action} este funcionário?`)) return;
        await dataSource.setEmployeeActive(button.dataset.activeId, active);
        await renderIndicators();
      });
    });
  }

  function renderRoles(groups) {
    const container = $("indicatorRolesTable");
    if (!groups.length) {
      container.innerHTML = '<div class="empty">Sem dados de função para o período.</div>';
      return;
    }
    container.innerHTML = `
      <div class="table-wrap indicator-table-wrap">
        <table class="indicator-table role-table">
          <thead><tr><th>Função</th><th>Ativos</th><th>Testados</th><th>Cobertura</th><th>Encaminhar</th><th>Taxa</th></tr></thead>
          <tbody>${groups
            .map(
              (group) => `<tr><td><strong>${esc(group.role)}</strong></td><td>${group.active}</td><td>${group.tested}</td><td>${formatPercent(group.coverage)}</td><td>${group.referred}</td><td>${formatPercent(group.occurrenceRate)}</td></tr>`,
            )
            .join("")}</tbody>
        </table>
      </div>`;
  }

  function renderEvolution(days) {
    const container = $("indicatorEvolution");
    if (!days.length) {
      container.innerHTML = '<div class="empty">Selecione um período com data inicial e final.</div>';
      return;
    }
    const visibleDays = days.length > 62 ? days.slice(-62) : days;
    container.innerHTML = `<div class="evolution-list">${visibleDays
      .map(
        (item) => `<div class="evolution-row">
          <span>${esc(item.date.split("-").reverse().slice(0, 2).join("/"))}</span>
          <div class="evolution-track"><i style="width:${Math.min(100, item.coverage)}%"></i></div>
          <strong>${formatPercent(item.coverage)}</strong>
          <small>+${item.newCompleted} pessoa(s) · ${item.records} registro(s)</small>
        </div>`,
      )
      .join("")}</div>`;
  }

  function exportPeople() {
    if (!state.metrics) return;
    const statusFilter = state.filters.personStatus;
    const search = normalize(state.filters.personSearch);
    const rows = state.metrics.personRows
      .filter((row) => statusFilter === "all" || row.classification === statusFilter)
      .filter((row) =>
        !search ||
        normalize(
          `${row.employee.name} ${row.employee.number} ${row.employee.company} ${row.employee.role}`,
        ).includes(search),
      );
    downloadCsv(
      `cobertura_bafometro_${localDay()}.csv`,
      ["Nome", "Matrícula", "Empresa", "Função", "Situação", "Último registro", "Último resultado", "Ativo"],
      rows.map((row) => [
        row.employee.name,
        row.employee.number,
        row.employee.company,
        row.employee.role,
        personStatusLabel(row.classification),
        row.latest ? formatDateTime(row.latest.createdAt) : "",
        row.latest?.outcome ?? "",
        row.employee.active ? "Sim" : "Não",
      ]),
    );
  }

  function bindControls() {
    const preset = $("indicatorPreset");
    const currentRange = resolvePresetRange("currentMonth");
    state.filters.start = currentRange.start;
    state.filters.end = currentRange.end;
    $("indicatorStart").value = dateInputValue(currentRange.start);
    $("indicatorEnd").value = dateInputValue(currentRange.end);
    $("indicatorStart").disabled = true;
    $("indicatorEnd").disabled = true;

    preset.addEventListener("change", () => {
      applyPreset(preset.value);
      void renderIndicators();
    });
    $("indicatorStart").addEventListener("change", () => {
      state.filters.start = parseDateInput($("indicatorStart").value);
      void renderIndicators();
    });
    $("indicatorEnd").addEventListener("change", () => {
      state.filters.end = parseDateInput($("indicatorEnd").value, true);
      void renderIndicators();
    });
    $("indicatorCompany").addEventListener("change", () => {
      state.filters.company = $("indicatorCompany").value;
      void renderIndicators();
    });
    $("indicatorRole").addEventListener("change", () => {
      state.filters.role = $("indicatorRole").value;
      void renderIndicators();
    });
    $("indicatorPersonStatus").addEventListener("change", () => {
      state.filters.personStatus = $("indicatorPersonStatus").value;
      renderPeople(state.metrics?.personRows ?? []);
    });
    $("indicatorPersonSearch").addEventListener("input", () => {
      state.filters.personSearch = $("indicatorPersonSearch").value;
      renderPeople(state.metrics?.personRows ?? []);
    });
    $("exportIndicatorPeople").addEventListener("click", exportPeople);
  }

  function init() {
    patchLocalStorageNotifications();
    createIndicatorsView();
    if (!$("view-indicadores")) return;
    bindControls();
    dataSource.subscribe(() => {
      if ($("view-indicadores")?.classList.contains("active")) void renderIndicators();
    });
    void renderIndicators();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
