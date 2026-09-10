(() => {
  "use strict";

  const view = document.getElementById("view-ndef");
  if (!view) return;

  // Senha geral temporária solicitada para proteger a exclusão.
  // Como o ChachaNFC é uma aplicação estática, esta senha existe no front-end
  // e deve ser substituída por autenticação real quando o fluxo for integrado ao EvCS.
  const DELETE_PASSWORD = "8441";

  const toBytes = data => {
    if (!data) return new Uint8Array();
    try {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    } catch {
      return new Uint8Array();
    }
  };

  const bytesToBase64 = bytes => {
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  };

  const serializeRecord = record => ({
    recordType: record.recordType || "unknown",
    mediaType: record.mediaType || "",
    id: record.id || "",
    encoding: record.encoding || "",
    lang: record.lang || "",
    data: toBytes(record.data),
  });

  const recordInit = record => {
    const init = { recordType: record.recordType || "unknown" };
    if (record.recordType !== "empty") init.data = record.data;
    if (record.mediaType) init.mediaType = record.mediaType;
    if (record.id) init.id = record.id;
    if (record.encoding) init.encoding = record.encoding;
    if (record.lang) init.lang = record.lang;
    return init;
  };

  const decode = record => {
    if (!record?.data?.byteLength) return "";
    try {
      return new TextDecoder(record.encoding || "utf-8").decode(record.data);
    } catch {
      return "";
    }
  };

  const signature = record => [
    record.recordType || "unknown",
    record.mediaType || "",
    record.id || "",
    record.encoding || "",
    record.lang || "",
    bytesToBase64(record.data || new Uint8Array()),
  ].join("|");

  const signatureCounts = records => {
    const counts = new Map();
    records.forEach(record => {
      const key = signature(record);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  };

  const sameRecordMultiset = (actual, expected) => {
    if (actual.length !== expected.length) return false;
    const a = signatureCounts(actual);
    const e = signatureCounts(expected);
    if (a.size !== e.size) return false;
    for (const [key, count] of e.entries()) {
      if (a.get(key) !== count) return false;
    }
    return true;
  };

  const describeRecord = (record, index) => {
    const text = decode(record).replace(/\s+/g, " ").trim();
    const type = record.recordType || "unknown";
    let title = `Registro ${index + 1} · ${type}`;
    if (record.mediaType) title += ` · ${record.mediaType}`;
    if (record.id) title += ` · id=${record.id}`;

    let detail = text;
    if (!detail && type === "empty") detail = "Registro vazio NDEF";
    if (!detail) detail = `${record.data?.byteLength || 0} byte(s) de dados`;
    if (detail.length > 220) detail = `${detail.slice(0, 217)}…`;

    return { title, detail };
  };

  async function readOnce(timeoutMs = 30000) {
    if (!("NDEFReader" in window)) {
      throw new DOMException("Web NFC indisponível.", "NotSupportedError");
    }
    if (!window.isSecureContext) {
      throw new DOMException("Abra a versão HTTPS publicada.", "SecurityError");
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const reader = new NDEFReader();
      await reader.scan({ signal: controller.signal });
      return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          fn(value);
        };
        reader.addEventListener(
          "readingerror",
          () => finish(reject, new Error("Não foi possível ler a mensagem NDEF.")),
          { once: true },
        );
        reader.addEventListener(
          "reading",
          event => finish(resolve, event),
          { once: true },
        );
        controller.signal.addEventListener(
          "abort",
          () => finish(reject, new DOMException("Tempo esgotado.", "AbortError")),
          { once: true },
        );
      });
    } finally {
      window.clearTimeout(timer);
      if (!controller.signal.aborted) controller.abort();
    }
  }

  function friendlyError(error) {
    const name = error?.name || "Erro";
    let message = error?.message || "Não foi possível concluir a operação.";
    if (name === "NotAllowedError") {
      message = "Permissão NFC negada. Abra a página HTTPS no Chrome para Android e permita NFC.";
    } else if (name === "AbortError") {
      message = "Tempo esgotado ou leitura cancelada. Tente novamente.";
    } else if (name === "NotSupportedError") {
      message = "A etiqueta não aceita esta operação NDEF ou pode estar protegida contra gravação.";
    } else if (name === "NetworkError") {
      message = "Mantenha o crachá encostado durante toda a gravação.";
    }
    return `${name}: ${message}`;
  }

  const card = document.createElement("article");
  card.className = "card";
  card.style.marginTop = "15px";
  card.innerHTML = `
    <h2>Excluir registros gravados no NFC</h2>
    <p class="muted" style="margin-top:0">
      Leia o crachá para ver exatamente o que está gravado. Selecione somente os registros que deseja apagar; os demais serão preservados.
    </p>

    <button class="btn secondary block" type="button" id="loadNdefForDelete">
      1. Ler registros gravados
    </button>

    <div id="ndefDeleteRecords" style="display:grid;gap:9px;margin-top:13px"></div>

    <div class="field" id="ndefDeletePasswordField" style="margin-top:13px" hidden>
      <label for="ndefDeletePassword">Senha para excluir</label>
      <input id="ndefDeletePassword" type="password" inputmode="numeric" autocomplete="off" placeholder="Digite a senha">
    </div>

    <button class="btn secondary block" type="button" id="deleteSelectedNdef" disabled style="margin-top:9px">
      2. Excluir selecionados
    </button>

    <div class="status" id="deleteSelectedNdefStatus">
      Primeiro leia o crachá para carregar os registros.
    </div>
  `;
  view.appendChild(card);

  const loadButton = document.getElementById("loadNdefForDelete");
  const deleteButton = document.getElementById("deleteSelectedNdef");
  const passwordField = document.getElementById("ndefDeletePasswordField");
  const passwordInput = document.getElementById("ndefDeletePassword");
  const recordsContainer = document.getElementById("ndefDeleteRecords");
  const deleteStatus = document.getElementById("deleteSelectedNdefStatus");

  let prepared = null;

  const setStatus = (message, type = "") => {
    deleteStatus.textContent = message;
    deleteStatus.className = `status ${type}`.trim();
  };

  const getSelectedIndexes = () => Array.from(
    recordsContainer.querySelectorAll('input[type="checkbox"][data-record-index]:checked'),
    checkbox => Number(checkbox.dataset.recordIndex),
  ).filter(Number.isInteger);

  const updateDeleteEnabled = () => {
    deleteButton.disabled = !(prepared?.records?.length && getSelectedIndexes().length);
  };

  const renderRecords = records => {
    recordsContainer.replaceChildren();

    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "status warn";
      empty.textContent = "Nenhum registro NDEF foi encontrado neste crachá.";
      recordsContainer.appendChild(empty);
      passwordField.hidden = true;
      updateDeleteEnabled();
      return;
    }

    records.forEach((record, index) => {
      const label = document.createElement("label");
      label.style.cssText = "display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border:1px solid var(--border,#dfe3eb);border-radius:12px;cursor:pointer";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.recordIndex = String(index);
      checkbox.style.cssText = "width:auto;margin-top:4px;flex:0 0 auto";
      checkbox.addEventListener("change", updateDeleteEnabled);

      const text = document.createElement("span");
      text.style.cssText = "min-width:0;display:grid;gap:3px";

      const { title, detail } = describeRecord(record, index);
      const strong = document.createElement("strong");
      strong.textContent = title;
      const small = document.createElement("span");
      small.className = "muted";
      small.style.cssText = "overflow-wrap:anywhere;font-weight:400";
      small.textContent = detail;

      text.append(strong, small);
      label.append(checkbox, text);
      recordsContainer.appendChild(label);
    });

    passwordField.hidden = false;
    passwordInput.value = "";
    updateDeleteEnabled();
  };

  const loadRecords = async (statusMessage = "Aproxime o crachá para ler os registros gravados…") => {
    loadButton.disabled = true;
    deleteButton.disabled = true;
    prepared = null;
    recordsContainer.replaceChildren();
    passwordField.hidden = true;
    setStatus(statusMessage, "info");

    try {
      const event = await readOnce();
      const records = Array.from(event.message.records || []).map(serializeRecord);
      prepared = {
        serialNumber: event.serialNumber || "",
        records,
      };
      renderRecords(records);

      if (records.length) {
        setStatus(
          `✅ ${records.length} registro(s) encontrado(s). Marque o que deseja excluir.`,
          "good",
        );
      } else {
        setStatus("ℹ️ O crachá não possui registros NDEF para excluir.", "warn");
      }
      return prepared;
    } catch (error) {
      setStatus(friendlyError(error), "bad");
      return null;
    } finally {
      loadButton.disabled = false;
      updateDeleteEnabled();
    }
  };

  loadButton.addEventListener("click", () => loadRecords());

  deleteButton.addEventListener("click", async () => {
    if (!prepared?.records?.length) return;

    const selectedIndexes = getSelectedIndexes();
    if (!selectedIndexes.length) {
      setStatus("Selecione pelo menos um registro para excluir.", "warn");
      return;
    }

    if (passwordInput.value !== DELETE_PASSWORD) {
      setStatus("Senha incorreta. A exclusão não foi liberada.", "bad");
      passwordInput.focus();
      passwordInput.select();
      return;
    }

    const selected = new Set(selectedIndexes);
    const preserved = prepared.records.filter((_, index) => !selected.has(index));
    const deletingAll = preserved.length === 0;

    const confirmation = deletingAll
      ? `Excluir os ${selectedIndexes.length} registro(s) selecionado(s)? O crachá ficará com um registro NDEF vazio.`
      : `Excluir ${selectedIndexes.length} registro(s) e preservar ${preserved.length}?`;

    if (!confirm(confirmation)) return;

    deleteButton.disabled = true;
    loadButton.disabled = true;
    passwordInput.disabled = true;
    setStatus(
      deletingAll
        ? "Mantenha o MESMO crachá encostado. Limpando o conteúdo NDEF…"
        : `Mantenha o MESMO crachá encostado. Preservando ${preserved.length} registro(s) e removendo ${selectedIndexes.length}…`,
      "info",
    );

    try {
      const writer = new NDEFReader();
      const recordsToWrite = deletingAll
        ? [{ recordType: "empty" }]
        : preserved.map(recordInit);

      await writer.write({ records: recordsToWrite }, { overwrite: true });

      setStatus("Gravação concluída. Aproxime novamente o mesmo crachá para verificar…", "info");
      const verification = await readOnce();
      const verifiedRecords = Array.from(verification.message.records || []).map(serializeRecord);
      const serialAfter = verification.serialNumber || "";
      const sameSerial = !prepared.serialNumber || !serialAfter || prepared.serialNumber.toLowerCase() === serialAfter.toLowerCase();

      if (!sameSerial) {
        throw new Error("O crachá apresentado na verificação não tem o mesmo serial/UID do crachá lido antes da exclusão.");
      }

      if (deletingAll) {
        const clean = verifiedRecords.length === 0 || (
          verifiedRecords.length === 1 && verifiedRecords[0].recordType === "empty"
        );
        if (!clean) {
          throw new Error("A verificação final encontrou conteúdo além do registro vazio esperado.");
        }
      } else if (!sameRecordMultiset(verifiedRecords, preserved)) {
        throw new Error("A verificação final não confirmou exatamente os registros que deveriam permanecer.");
      }

      prepared = {
        serialNumber: serialAfter || prepared.serialNumber,
        records: verifiedRecords,
      };
      renderRecords(verifiedRecords);
      passwordInput.value = "";

      if (deletingAll) {
        setStatus("✅ Conteúdo removido. O crachá ficou com um registro NDEF vazio.", "good");
      } else {
        setStatus(
          `✅ Exclusão confirmada. Permanecem ${verifiedRecords.length} registro(s) no crachá.`,
          "good",
        );
      }
    } catch (error) {
      setStatus(friendlyError(error), "bad");
    } finally {
      loadButton.disabled = false;
      passwordInput.disabled = false;
      updateDeleteEnabled();
    }
  });
})();
