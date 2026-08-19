(() => {
  "use strict";

  const view = document.getElementById("view-ndef");
  if (!view) return;

  const TEST_URL = `${location.origin}${location.pathname}?nfc_bridge_test=1`;

  const toBytes = data => {
    if (!data) return new Uint8Array();
    try {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    } catch {
      return new Uint8Array();
    }
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
    const init = {
      recordType: record.recordType || "unknown",
      data: record.data,
    };
    if (record.mediaType) init.mediaType = record.mediaType;
    if (record.id) init.id = record.id;
    if (record.encoding) init.encoding = record.encoding;
    if (record.lang) init.lang = record.lang;
    return init;
  };

  const decode = record => {
    try {
      return new TextDecoder(record.encoding || "utf-8").decode(record.data);
    } catch {
      return "";
    }
  };

  const isExactTestUrlRecord = record => {
    if (record.recordType !== "url" && record.recordType !== "absolute-url") {
      return false;
    }
    try {
      const current = new URL(decode(record));
      const expected = new URL(TEST_URL);
      return (
        current.origin === expected.origin &&
        current.pathname === expected.pathname &&
        current.searchParams.get("nfc_bridge_test") === "1"
      );
    } catch {
      return false;
    }
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
    <h2>Remover URL de teste do ChachaNFC</h2>
    <p class="muted" style="margin-top:0">
      Remove somente o registro URL com <code>nfc_bridge_test=1</code> deste Pages e preserva os demais registros NDEF, incluindo o EVCS1.
    </p>
    <button class="btn secondary block" type="button" id="removeChachaTestUrl">
      Remover URL de teste e preservar EVCS1
    </button>
    <div class="status" id="removeChachaTestUrlStatus">
      Nenhuma alteração foi feita.
    </div>
  `;
  view.appendChild(card);

  const removeButton = document.getElementById("removeChachaTestUrl");
  const removeStatus = document.getElementById("removeChachaTestUrlStatus");

  const setStatus = (message, type = "") => {
    removeStatus.textContent = message;
    removeStatus.className = `status ${type}`.trim();
  };

  removeButton.addEventListener("click", async () => {
    if (
      !confirm(
        "Remover somente a URL temporária do ChachaNFC e manter os demais registros NDEF?",
      )
    ) {
      return;
    }

    removeButton.disabled = true;
    setStatus("Aproxime o crachá. Primeiro vou ler e conferir o conteúdo…", "info");

    try {
      const event = await readOnce();
      const serialBefore = event.serialNumber || "";
      const records = Array.from(event.message.records || []).map(serializeRecord);
      const removable = records.filter(isExactTestUrlRecord);
      const preserved = records.filter(record => !isExactTestUrlRecord(record));

      if (!removable.length) {
        setStatus("ℹ️ A URL temporária do ChachaNFC não foi encontrada. Nada foi alterado.", "warn");
        return;
      }
      if (!preserved.length) {
        throw new Error(
          "A remoção deixaria a mensagem NDEF sem registros. Operação interrompida por segurança.",
        );
      }

      const evcs1Present = preserved.some(record =>
        record.recordType === "text" && decode(record).startsWith("EVCS1|"),
      );
      if (!evcs1Present) {
        throw new Error(
          "O registro EVCS1 não foi localizado entre os registros preservados. Operação interrompida por segurança.",
        );
      }

      setStatus(
        `URL de teste localizada. Mantenha o MESMO crachá encostado para preservar ${preserved.length} registro(s) e remover ${removable.length}.`,
        "info",
      );

      const writer = new NDEFReader();
      await writer.write(
        { records: preserved.map(recordInit) },
        { overwrite: true },
      );

      setStatus("Gravação concluída. Aproxime novamente o mesmo crachá para verificar…", "info");
      const verification = await readOnce();
      const verifiedRecords = Array.from(verification.message.records || []).map(serializeRecord);
      const testUrlStillPresent = verifiedRecords.some(isExactTestUrlRecord);
      const evcs1StillPresent = verifiedRecords.some(record =>
        record.recordType === "text" && decode(record).startsWith("EVCS1|"),
      );
      const serialAfter = verification.serialNumber || "";
      const sameSerial = !serialBefore || !serialAfter || serialBefore.toLowerCase() === serialAfter.toLowerCase();

      if (testUrlStillPresent || !evcs1StillPresent || !sameSerial) {
        throw new Error(
          "A verificação final não confirmou a remoção segura. Confira o conteúdo pelo teste NDEF antes de usar o crachá.",
        );
      }

      setStatus(
        `✅ URL de teste removida. EVCS1 preservado. Registros atuais: ${verifiedRecords.length}.`,
        "good",
      );
    } catch (error) {
      setStatus(friendlyError(error), "bad");
    } finally {
      removeButton.disabled = false;
    }
  });
})();
