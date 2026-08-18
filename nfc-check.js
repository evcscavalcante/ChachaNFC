(() => {
  "use strict";

  const button = document.getElementById("scanNdefCheck");
  const status = document.getElementById("scanNdefCheckStatus");
  const details = document.getElementById("scanNdefCheckDetails");

  if (!button || !status || !details) return;

  const setStatus = (message, type = "") => {
    status.textContent = message;
    status.className = `status ${type}`.trim();
  };

  const toHex = data => {
    if (!data) return "";
    try {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      return "";
    }
  };

  const decodeRecord = record => {
    if (!record.data) return "";
    try {
      return new TextDecoder(record.encoding || "utf-8").decode(record.data);
    } catch {
      return "";
    }
  };

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

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);

    try {
      const reader = new NDEFReader();
      await reader.scan({ signal: controller.signal });

      const result = await new Promise((resolve, reject) => {
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
      const name = error?.name || "Erro";
      let message = error?.message || "Não foi possível concluir o teste.";

      if (name === "NotAllowedError") {
        message = "Permissão NFC negada. Confirme que a página está em HTTPS e permita NFC quando o Chrome solicitar.";
      } else if (name === "AbortError") {
        message = "Tempo esgotado ou leitura cancelada. Tente novamente e mantenha o crachá próximo ao celular.";
      }

      setStatus(`${name}: ${message}`, "bad");
    } finally {
      window.clearTimeout(timeout);
      if (!controller.signal.aborted) controller.abort();
      button.disabled = false;
    }
  });
})();
