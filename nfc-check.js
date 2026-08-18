(() => {
  "use strict";

  const button = document.getElementById("scanNdefCheck");
  const status = document.getElementById("scanNdefCheckStatus");
  const details = document.getElementById("scanNdefCheckDetails");
  const view = document.getElementById("view-ndef");

  if (!button || !status || !details || !view) return;

  const BACKUP_KEY = "chachanfc_ndef_backup_v1";
  const DEFAULT_TEST_URL = `${location.origin}${location.pathname}?nfc_bridge_test=1`;

  const setStatus = (message, type = "") => {
    status.textContent = message;
    status.className = `status ${type}`.trim();
  };

  const toBytes = data => {
    if (!data) return new Uint8Array();
    try {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    } catch {
      return new Uint8Array();
    }
  };

  const toHex = data => Array.from(toBytes(data), byte => byte.toString(16).padStart(2, "0")).join("");

  const bytesToBase64 = bytes => {
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  };

  const base64ToBytes = value => {
    const binary = atob(value || "");
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  };

  const decodeRecord = record => {
    if (!record.data) return "";
    try {
      return new TextDecoder(record.encoding || "utf-8").decode(record.data);
    } catch {
      return "";
    }
  };

  const serializeRecord = record => ({
    recordType: record.recordType || "unknown",
    mediaType: record.mediaType || "",
    id: record.id || "",
    encoding: record.encoding || "",
    lang: record.lang || "",
    dataBase64: bytesToBase64(toBytes(record.data)),
  });

  const signature = record => [
    record.recordType || "unknown",
    record.mediaType || "",
    record.id || "",
    record.encoding || "",
    record.lang || "",
    record.dataBase64 || bytesToBase64(toBytes(record.data)),
  ].join("|");

  const recordInitFromSerialized = record => {
    const init = {
      recordType: record.recordType || "unknown",
      data: base64ToBytes(record.dataBase64),
    };
    if (record.mediaType) init.mediaType = record.mediaType;
    if (record.id) init.id = record.id;
    if (record.encoding) init.encoding = record.encoding;
    if (record.lang) init.lang = record.lang;
    return init;
  };

  const friendlyError = error => {
    const name = error?.name || "Erro";
    let message = error?.message || "Não foi possível concluir a operação.";
    if (name === "NotAllowedError") {
      message = "Permissão NFC negada. Confirme HTTPS e permita NFC quando o Chrome solicitar.";
    } else if (name === "AbortError") {
      message = "Tempo esgotado ou leitura cancelada. Tente novamente e mantenha o crachá próximo ao celular.";
    } else if (name === "NotSupportedError") {
      message = "A etiqueta não aceita esta operação NDEF ou pode estar protegida contra gravação.";
    } else if (name === "NetworkError") {
      message = "A etiqueta foi afastada antes do fim da operação. Mantenha-a encostada durante toda a gravação.";
    }
    return `${name}: ${message}`;
  };

  async function readOnce(timeoutMs = 30000) {
    if (!("NDEFReader" in window)) throw new DOMException("Web NFC indisponível.", "NotSupportedError");
    if (!window.isSecureContext) throw new DOMException("Abra a versão HTTPS publicada.", "SecurityError");

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
          () => finish(reject, new Error("Tag detectada, mas o conteúdo NDEF não pôde ser lido.")),
          { once: true },
        );
        reader.addEventListener("reading", event => finish(resolve, event), { once: true });
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

  button.addEventListener("click", async () => {
    details.hidden = true;
    details.textContent = "";

    if (!("NDEFReader" in window)) {
      setStatus(
        "Web NFC indisponível neste navegador. Faça o teste em Android com NFC, Chrome atualizado e página HTTPS.",
        "bad",
      );
      return;
    }

    if (!window.isSecureContext) {
      setStatus(
        "Esta página não está em contexto seguro. Abra a versão HTTPS publicada para testar o NFC.",
        "bad",
      );
      return;
    }

    button.disabled = true;
    setStatus("Aproxime o crachá do celular…", "info");

    try {
      const result = await readOnce();
      const records = Array.from(result.message.records || []);
      const lines = [
        "RESULTADO: NDEF LEGÍVEL",
        `Serial/UID informado pelo navegador: ${result.serialNumber || "(não informado)"}`,
        `Quantidade de registros NDEF: ${records.length}`,
        "",
      ];

      records.forEach((record, index) => {
        lines.push(`Registro ${index + 1}`);
        lines.push(`  tipo: ${record.recordType || "-"}`);
        if (record.mediaType) lines.push(`  mediaType: ${record.mediaType}`);
        if (record.id) lines.push(`  id: ${record.id}`);
        const text = decodeRecord(record);
        if (text) lines.push(`  texto: ${text}`);
        const hex = toHex(record.data);
        if (hex) lines.push(`  bytes: ${hex}`);
        lines.push("");
      });

      lines.push("Conclusão: o crachá atende ao requisito básico de leitura NDEF.");
      lines.push("Este teste NÃO grava e NÃO confirma se o crachá aceita escrita de URL.");

      details.textContent = lines.join("\n");
      details.hidden = false;
      setStatus("✅ Crachá lido como NDEF.", "good");
    } catch (error) {
      setStatus(friendlyError(error), "bad");
    } finally {
      button.disabled = false;
    }
  });

  // A segunda etapa é injetada via JavaScript para manter o teste isolado do app principal.
  const writeCard = document.createElement("article");
  writeCard.className = "card";
  writeCard.style.marginTop = "15px";
  writeCard.innerHTML = `
    <h2>Teste de escrita URL preservando NDEF</h2>
    <div class="status warn" style="margin-top:0">
      ⚠️ Use primeiro um crachá/tag de teste ou reserva. Esta etapa REGRAVA a mensagem NDEF. O sistema lê os registros atuais, cria um backup local e tenta escrever os mesmos registros + uma URL de teste.
    </div>

    <div class="field" style="margin-top:13px">
      <label for="ndefTestUrl">URL que será adicionada</label>
      <input id="ndefTestUrl" type="url" autocomplete="off">
    </div>

    <div class="actions">
      <button class="btn secondary" type="button" id="prepareNdefWrite">1. Ler e preparar backup</button>
      <button class="btn ghost" type="button" id="verifyNdefWrite">Verificar conteúdo atual</button>
    </div>

    <pre id="ndefWritePreview" class="status" hidden style="white-space:pre-wrap;text-align:left;overflow:auto"></pre>

    <label style="display:flex;gap:9px;align-items:flex-start;margin-top:13px;font-weight:600">
      <input id="confirmNdefWrite" type="checkbox" style="width:auto;margin-top:3px">
      <span>Estou usando uma tag/crachá de teste e entendo que a gravação pode falhar, substituir a mensagem NDEF ou exigir restauração do backup.</span>
    </label>

    <button class="btn block" type="button" id="writeNdefUrl" disabled style="margin-top:13px">2. Gravar registros atuais + URL</button>
    <button class="btn secondary block" type="button" id="restoreNdefBackup" disabled style="margin-top:9px">Restaurar backup NDEF salvo neste aparelho</button>
    <div class="status" id="ndefWriteStatus">Primeiro faça a leitura e o backup.</div>
  `;
  view.appendChild(writeCard);

  const urlInput = document.getElementById("ndefTestUrl");
  const prepareButton = document.getElementById("prepareNdefWrite");
  const verifyButton = document.getElementById("verifyNdefWrite");
  const writeButton = document.getElementById("writeNdefUrl");
  const restoreButton = document.getElementById("restoreNdefBackup");
  const confirmWrite = document.getElementById("confirmNdefWrite");
  const writeStatus = document.getElementById("ndefWriteStatus");
  const writePreview = document.getElementById("ndefWritePreview");

  urlInput.value = DEFAULT_TEST_URL;

  let prepared = null;

  const setWriteStatus = (message, type = "") => {
    writeStatus.textContent = message;
    writeStatus.className = `status ${type}`.trim();
  };

  const updateWriteEnabled = () => {
    writeButton.disabled = !(prepared && confirmWrite.checked && urlInput.value.trim());
  };

  confirmWrite.addEventListener("change", updateWriteEnabled);
  urlInput.addEventListener("input", updateWriteEnabled);

  const saveBackup = snapshot => {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot));
    restoreButton.disabled = false;
  };

  const loadBackup = () => {
    try {
      return JSON.parse(localStorage.getItem(BACKUP_KEY) || "null");
    } catch {
      return null;
    }
  };

  restoreButton.disabled = !loadBackup();

  prepareButton.addEventListener("click", async () => {
    prepareButton.disabled = true;
    prepared = null;
    updateWriteEnabled();
    writePreview.hidden = true;
    setWriteStatus("Aproxime o crachá para criar o backup antes da gravação…", "info");

    try {
      const event = await readOnce();
      const records = Array.from(event.message.records || []).map(serializeRecord);
      if (!records.length) throw new Error("Nenhum registro NDEF existente foi encontrado. O teste foi interrompido por segurança.");

      prepared = {
        serialNumber: event.serialNumber || "",
        capturedAt: new Date().toISOString(),
        records,
      };
      saveBackup(prepared);

      const totalPayloadBytes = records.reduce((sum, record) => sum + base64ToBytes(record.dataBase64).byteLength, 0);
      const lines = [
        "BACKUP CRIADO",
        `Serial/UID: ${prepared.serialNumber || "(não informado)"}`,
        `Registros atuais: ${records.length}`,
        `Bytes de dados atuais (aprox.): ${totalPayloadBytes}`,
        "",
        ...records.map((record, index) => `Registro ${index + 1}: ${record.recordType}${record.id ? ` | id=${record.id}` : ""}`),
        "",
        "A capacidade total da tag não é exposta pelo Web NFC. A própria tentativa de escrita confirmará se há espaço suficiente.",
      ];
      writePreview.textContent = lines.join("\n");
      writePreview.hidden = false;
      setWriteStatus("✅ Backup local criado. A gravação só será liberada após marcar a confirmação.", "good");
      updateWriteEnabled();
    } catch (error) {
      setWriteStatus(friendlyError(error), "bad");
    } finally {
      prepareButton.disabled = false;
    }
  });

  writeButton.addEventListener("click", async () => {
    if (!prepared || !confirmWrite.checked) return;

    let parsedUrl;
    try {
      parsedUrl = new URL(urlInput.value.trim());
      if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("Use uma URL HTTP/HTTPS.");
    } catch (error) {
      setWriteStatus(`URL inválida: ${error.message}`, "bad");
      return;
    }

    const currentBackup = prepared;
    const oldRecordInits = currentBackup.records.map(recordInitFromSerialized);
    const urlAlreadyExists = currentBackup.records.some(record => {
      if (record.recordType !== "url" && record.recordType !== "absolute-url") return false;
      try {
        return new TextDecoder().decode(base64ToBytes(record.dataBase64)) === parsedUrl.href;
      } catch {
        return false;
      }
    });

    const recordsToWrite = urlAlreadyExists
      ? oldRecordInits
      : [...oldRecordInits, { recordType: "url", data: parsedUrl.href }];

    writeButton.disabled = true;
    prepareButton.disabled = true;
    setWriteStatus("Mantenha o crachá encostado. Regravando os registros originais + URL…", "info");

    try {
      const writer = new NDEFReader();
      await writer.write({ records: recordsToWrite }, { overwrite: true });
      setWriteStatus(
        "✅ Escrita concluída. Agora toque em “Verificar conteúdo atual” e aproxime novamente o MESMO crachá para confirmar que os registros antigos continuam presentes.",
        "good",
      );
    } catch (error) {
      setWriteStatus(
        `${friendlyError(error)} O backup original continua salvo neste aparelho e pode ser restaurado pelo botão abaixo.`,
        "bad",
      );
    } finally {
      prepareButton.disabled = false;
      updateWriteEnabled();
    }
  });

  verifyButton.addEventListener("click", async () => {
    verifyButton.disabled = true;
    setWriteStatus("Aproxime o crachá que acabou de ser gravado…", "info");
    try {
      const event = await readOnce();
      const current = Array.from(event.message.records || []).map(serializeRecord);
      const backup = loadBackup();
      const url = urlInput.value.trim();
      const currentSignatures = new Set(current.map(signature));
      const originalPreserved = backup?.records?.every(record => currentSignatures.has(signature(record))) ?? false;
      const urlPresent = current.some(record => {
        if (record.recordType !== "url" && record.recordType !== "absolute-url") return false;
        try {
          return new TextDecoder().decode(base64ToBytes(record.dataBase64)) === url;
        } catch {
          return false;
        }
      });

      const lines = [
        "VERIFICAÇÃO APÓS ESCRITA",
        `Serial/UID: ${event.serialNumber || "(não informado)"}`,
        `Registros encontrados: ${current.length}`,
        `Registros originais preservados: ${originalPreserved ? "SIM" : "NÃO"}`,
        `URL de teste presente: ${urlPresent ? "SIM" : "NÃO"}`,
        "",
        ...current.map((record, index) => {
          let text = "";
          try { text = new TextDecoder(record.encoding || "utf-8").decode(base64ToBytes(record.dataBase64)); } catch { /* noop */ }
          return `Registro ${index + 1}: ${record.recordType}${text ? ` | ${text}` : ""}`;
        }),
      ];
      writePreview.textContent = lines.join("\n");
      writePreview.hidden = false;

      if (originalPreserved && urlPresent) {
        setWriteStatus("✅ TESTE APROVADO: conteúdo anterior preservado e URL adicionada.", "good");
      } else if (!originalPreserved) {
        setWriteStatus("⚠️ Os registros originais não foram confirmados byte a byte. NÃO use esse modelo em crachá de produção; restaure o backup.", "bad");
      } else {
        setWriteStatus("⚠️ Os registros antigos permanecem, mas a URL de teste não foi localizada.", "warn");
      }
    } catch (error) {
      setWriteStatus(friendlyError(error), "bad");
    } finally {
      verifyButton.disabled = false;
    }
  });

  restoreButton.addEventListener("click", async () => {
    const backup = loadBackup();
    if (!backup?.records?.length) {
      setWriteStatus("Nenhum backup NDEF foi encontrado neste aparelho.", "bad");
      restoreButton.disabled = true;
      return;
    }

    if (!confirm("Restaurar a mensagem NDEF capturada antes do teste? Use somente no MESMO crachá/tag do backup.")) return;

    restoreButton.disabled = true;
    setWriteStatus("Mantenha o MESMO crachá encostado. Restaurando mensagem NDEF original…", "info");
    try {
      const writer = new NDEFReader();
      await writer.write(
        { records: backup.records.map(recordInitFromSerialized) },
        { overwrite: true },
      );
      setWriteStatus("✅ Backup regravado. Use “Verificar conteúdo atual” para conferir o resultado.", "good");
    } catch (error) {
      setWriteStatus(friendlyError(error), "bad");
    } finally {
      restoreButton.disabled = false;
    }
  });
})();
