/* 纸间 PDF · 前端交互
   所有源文件都只传给本机 127.0.0.1 上的 Python 服务。 */

(() => {
  "use strict";

  const TOKEN = document.querySelector('meta[name="paperly-token"]')?.content || "";
  const VERSION = document.querySelector('meta[name="paperly-version"]')?.content || "1.2.0";
  const MAX_FILE = 250 * 1024 * 1024;
  const PDF_RE = /\.pdf$/i;
  const IMAGE_RE = /\.(jpe?g|png|webp|bmp|tiff?)$/i;

  const TOOL_META = {
    organize: { label: "整理页面", emptyHint: "PDF" },
    compose: { label: "替换 / 插入", emptyHint: "PDF" },
    merge: { label: "合并 PDF", emptyHint: "PDF" },
    split: { label: "拆分 PDF", emptyHint: "PDF" },
    images: { label: "图片转 PDF", emptyHint: "图片" },
    pdf2img: { label: "PDF 转图片", emptyHint: "PDF" },
  };

  const state = {
    activeTool: "organize",
    pdfPickerTarget: "organize",
    isInternalDrag: false,
    organize: {
      doc: null,
      pages: [],
      initialPages: [],
      selected: new Set(),
      sourceDoc: null,
      sourcePages: [],
      initialSourcePages: [],
      sourceSelected: new Set(),
      history: [],
      drag: null,
      justDraggedAt: 0,
    },
    compose: {
      target: null,
      source: null,
      sourcePages: new Set(),
      mode: "replace",
      result: null,
      nameAuto: true,
    },
    merge: {
      docs: [],
      result: null,
      draggingId: null,
      dropId: null,
      dropAfter: false,
    },
    split: { doc: null, mode: "ranges", result: null },
    images: {
      items: [],
      result: null,
      draggingId: null,
      dropId: null,
      dropAfter: false,
    },
    pdf2img: { doc: null, result: null },
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const el = {
    crumb: $("#crumbText"),
    navItems: $$(".nav-item"),
    panels: $$(".tool-panel"),
    pdfFileInput: $("#pdfFileInput"),
    pdfFilesInput: $("#pdfFilesInput"),
    imageFilesInput: $("#imageFilesInput"),
    modalLayer: $("#modalLayer"),
    modal: $("#modalLayer .modal"),
    modalBody: $("#modalBody"),
    toastStack: $("#toastStack"),
    busyLayer: $("#busyLayer"),
    busyTitle: $("#busyTitle"),
    busyHint: $("#busyHint"),
    dropOverlay: $("#dropOverlay"),
    dropTitle: $("#dropTitle"),
    dropHint: $("#dropHint"),

    organizeEmpty: $("#organizeEmpty"),
    organizeWorkspace: $("#organizeWorkspace"),
    organizeOpenBtn: $("#organizeOpenBtn"),
    organizeWorkspaceMeta: $("#organizeWorkspaceMeta"),
    organizeAddSourceBtn: $("#organizeAddSourceBtn"),
    organizePanes: $("#organizePanes"),
    targetPane: $("#targetPane"),
    sourcePane: $("#sourcePane"),
    organizeDocName: $("#organizeDocName"),
    organizeDocMeta: $("#organizeDocMeta"),
    organizeName: $("#organizeName"),
    organizeSelectAll: $("#organizeSelectAll"),
    pageCountLabel: $("#pageCountLabel"),
    targetPageHint: $("#targetPageHint"),
    organizeDeleteSelected: $("#organizeDeleteSelected"),
    organizeUndo: $("#organizeUndo"),
    pageGrid: $("#pageGrid"),
    sourceDocName: $("#sourceDocName"),
    sourceDocMeta: $("#sourceDocMeta"),
    sourceSelectAll: $("#sourceSelectAll"),
    sourceCountLabel: $("#sourceCountLabel"),
    sourcePageHint: $("#sourcePageHint"),
    sourceDeleteSelected: $("#sourceDeleteSelected"),
    sourcePageGrid: $("#sourcePageGrid"),
    organizeSaveMeta: $("#organizeSaveMeta"),
    organizeExportBtn: $("#organizeExportBtn"),

    composeResetBtn: $("#composeResetBtn"),
    composeTargetEmpty: $("#composeTargetEmpty"),
    composeTargetDoc: $("#composeTargetDoc"),
    composeTargetCover: $("#composeTargetCover"),
    composeTargetName: $("#composeTargetName"),
    composeTargetMeta: $("#composeTargetMeta"),
    composeSourceEmpty: $("#composeSourceEmpty"),
    composeSourceDoc: $("#composeSourceDoc"),
    composeSourceCover: $("#composeSourceCover"),
    composeSourceName: $("#composeSourceName"),
    composeSourceMeta: $("#composeSourceMeta"),
    composeWorkspace: $("#composeWorkspace"),
    composeSourceSummary: $("#composeSourceSummary"),
    composeRange: $("#composeRange"),
    composeSourceGrid: $("#composeSourceGrid"),
    composeTargetStart: $("#composeTargetStart"),
    composeTargetEnd: $("#composeTargetEnd"),
    composeInsertPosition: $("#composeInsertPosition"),
    composeInsertPageRow: $("#composeInsertPageRow"),
    composeInsertPage: $("#composeInsertPage"),
    composeReplacePanel: $("#composeReplacePanel"),
    composeInsertPanel: $("#composeInsertPanel"),
    composeSummary: $("#composeSummary"),
    composeName: $("#composeName"),
    composeSaveMeta: $("#composeSaveMeta"),
    composeExportBtn: $("#composeExportBtn"),
    composeResult: $("#composeResult"),
    composeResultTitle: $("#composeResultTitle"),
    composeResultMeta: $("#composeResultMeta"),

    mergeEmpty: $("#mergeEmpty"),
    mergeWorkspace: $("#mergeWorkspace"),
    mergeList: $("#mergeList"),
    mergeSummary: $("#mergeSummary"),
    mergeName: $("#mergeName"),
    mergeSaveMeta: $("#mergeSaveMeta"),
    mergeExportBtn: $("#mergeExportBtn"),
    mergeResult: $("#mergeResult"),
    mergeResultTitle: $("#mergeResultTitle"),
    mergeResultMeta: $("#mergeResultMeta"),

    splitEmpty: $("#splitEmpty"),
    splitWorkspace: $("#splitWorkspace"),
    splitCover: $("#splitCover"),
    splitDocName: $("#splitDocName"),
    splitDocMeta: $("#splitDocMeta"),
    splitFactPages: $("#splitFactPages"),
    splitFactSize: $("#splitFactSize"),
    splitMiniPages: $("#splitMiniPages"),
    splitRanges: $("#splitRanges"),
    splitEvery: $("#splitEvery"),
    splitRangePanel: $("#splitRangePanel"),
    splitEveryPanel: $("#splitEveryPanel"),
    splitSinglePanel: $("#splitSinglePanel"),
    splitSingleHint: $("#splitSingleHint"),
    splitName: $("#splitName"),
    splitExportBtn: $("#splitExportBtn"),
    splitResult: $("#splitResult"),
    splitResultTitle: $("#splitResultTitle"),
    splitResultMeta: $("#splitResultMeta"),

    imagesEmpty: $("#imagesEmpty"),
    imagesWorkspace: $("#imagesWorkspace"),
    imagesSummary: $("#imagesSummary"),
    imageGrid: $("#imageGrid"),
    imagesName: $("#imagesName"),
    imagesSaveMeta: $("#imagesSaveMeta"),
    imagesExportBtn: $("#imagesExportBtn"),
    imagesResult: $("#imagesResult"),
    imagesResultTitle: $("#imagesResultTitle"),
    imagesResultMeta: $("#imagesResultMeta"),
    pageSizeHint: $("#pageSizeHint"),
    orientationGroup: $("#orientationGroup"),

    pdf2imgEmpty: $("#pdf2imgEmpty"),
    pdf2imgWorkspace: $("#pdf2imgWorkspace"),
    pdf2imgCover: $("#pdf2imgCover"),
    pdf2imgDocName: $("#pdf2imgDocName"),
    pdf2imgDocMeta: $("#pdf2imgDocMeta"),
    pdf2imgFactPages: $("#pdf2imgFactPages"),
    pdf2imgFactSize: $("#pdf2imgFactSize"),
    pdf2imgMiniPages: $("#pdf2imgMiniPages"),
    pdf2imgRange: $("#pdf2imgRange"),
    pdf2imgRangeHint: $("#pdf2imgRangeHint"),
    pdf2imgName: $("#pdf2imgName"),
    pdf2imgExportBtn: $("#pdf2imgExportBtn"),
    pdf2imgResult: $("#pdf2imgResult"),
    pdf2imgResultTitle: $("#pdf2imgResultTitle"),
    pdf2imgResultMeta: $("#pdf2imgResultMeta"),
    dpiHint: $("#dpiHint"),
  };

  // ---------------------------------------------------------------------
  // 通用工具
  // ---------------------------------------------------------------------
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function stem(name) {
    return String(name || "文档").replace(/\.[^.]+$/, "");
  }

  function outputStem(name, suffix) {
    return `${stem(name).slice(0, 64)}${suffix}`;
  }

  function formatDimensions(width, height, unit) {
    return `${Math.round(width)} × ${Math.round(height)} ${unit === "px" ? "px" : "pt"}`;
  }

  function rangeExample(pageCount) {
    if (pageCount >= 8) return "例如：1-3, 5, 8";
    if (pageCount >= 5) return "例如：1-2, 5";
    if (pageCount >= 3) return "例如：1-2, 3";
    return "例如：1";
  }

  function thumbUrl(docId, page, width) {
    return `/api/thumb?id=${encodeURIComponent(docId)}&page=${page}&w=${width}&token=${encodeURIComponent(TOKEN)}`;
  }

  function downloadUrl(result) {
    return `${result.download}${result.download.includes("?") ? "&" : "?"}token=${encodeURIComponent(TOKEN)}`;
  }

  function isPdf(file) {
    return PDF_RE.test(file.name || "") || file.type === "application/pdf";
  }

  function isImage(file) {
    return IMAGE_RE.test(file.name || "") || String(file.type || "").startsWith("image/");
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
  }

  function getChecked(name, fallback) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
  }

  function markImageLoaded(img) {
    if (!img) return;
    const show = () => {
      img.classList.add("is-loaded");
      const holder = img.closest(".thumb-shell, .image-card-media, .source-thumb, .slot-cover, .document-preview");
      holder?.querySelector(".thumb-loading")?.remove();
    };
    if (img.complete && img.naturalWidth > 0) show();
    img.addEventListener("load", show, { once: true });
    img.addEventListener("error", () => {
      img.classList.remove("is-loaded");
      const shell = img.closest(".thumb-shell, .image-card-media, .source-thumb, .document-preview");
      if (shell) {
        const loading = shell.querySelector(".thumb-loading");
        if (loading) loading.remove();
        shell.classList.add("preview-failed");
      }
    }, { once: true });
  }

  async function parseResponse(response) {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      throw new Error(data?.error || `请求失败（${response.status}）`);
    }
    if (!data) throw new Error("服务返回了空结果，请重试。");
    return data;
  }

  async function apiPost(path, payload) {
    let response;
    try {
      response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Paperly-Token": TOKEN,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error("无法连接本地服务，请确认启动窗口还开着。");
    }
    return parseResponse(response);
  }

  async function uploadFile(file) {
    if (file.size > MAX_FILE) {
      throw new Error(`「${file.name}」超过 250 MB，请先压缩或拆分。`);
    }
    let response;
    try {
      response = await fetch(`/api/import?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Paperly-Token": TOKEN,
        },
        body: file,
      });
    } catch {
      throw new Error("无法连接本地服务，请确认启动窗口还开着。");
    }
    const data = await parseResponse(response);
    return data.doc;
  }

  function showBusy(title, hint = "文件只在本机处理，请稍候") {
    el.busyTitle.textContent = title;
    el.busyHint.textContent = hint;
    el.busyLayer.hidden = false;
    document.body.classList.add("is-modal-open");
  }

  function updateBusy(title, hint) {
    if (title) el.busyTitle.textContent = title;
    if (hint) el.busyHint.textContent = hint;
  }

  function hideBusy() {
    el.busyLayer.hidden = true;
    if (el.modalLayer.hidden) document.body.classList.remove("is-modal-open");
  }

  let toastSequence = 0;
  function toast(title, options = {}) {
    const {
      detail = "",
      type = "success",
      duration = 4200,
      actionLabel = "",
      action = null,
    } = options;
    const node = document.createElement("div");
    const id = `toast-${++toastSequence}`;
    node.className = `toast${type === "error" ? " is-error" : ""}`;
    node.id = id;
    const icon = type === "error" ? "i-close" : "i-check";
    node.innerHTML = `
      <span class="toast-icon"><svg class="icon"><use href="#${icon}"></use></svg></span>
      <div class="toast-copy">
        <strong>${esc(title)}</strong>
        ${detail ? `<p>${esc(detail)}</p>` : ""}
      </div>
      ${actionLabel ? `<button class="toast-action" type="button">${esc(actionLabel)}</button>` : ""}
    `;
    el.toastStack.appendChild(node);
    while (el.toastStack.children.length > 4) {
      el.toastStack.firstElementChild?.remove();
    }

    let timer = null;
    const remove = () => {
      if (timer) clearTimeout(timer);
      node.classList.add("is-leaving");
      window.setTimeout(() => node.remove(), 210);
    };
    const actionButton = node.querySelector(".toast-action");
    if (actionButton) {
      actionButton.addEventListener("click", () => {
        remove();
        if (typeof action === "function") action();
      });
    }
    timer = window.setTimeout(remove, duration);
    node.addEventListener("mouseenter", () => {
      if (timer) clearTimeout(timer);
    });
    node.addEventListener("mouseleave", () => {
      timer = window.setTimeout(remove, 1800);
    });
  }

  function downloadResult(result, announce = true) {
    if (!result?.download) {
      toast("没有可下载的文件", { type: "error" });
      return false;
    }
    const anchor = document.createElement("a");
    anchor.href = downloadUrl(result);
    anchor.download = result.filename || "download";
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (announce) toast("下载已开始", { detail: result.filename || "" });
    return true;
  }

  // ---------------------------------------------------------------------
  // 模态框
  // ---------------------------------------------------------------------
  let previousFocus = null;
  let previewKeyHandler = null;

  function clearPreviewKeys() {
    if (previewKeyHandler) {
      document.removeEventListener("keydown", previewKeyHandler);
      previewKeyHandler = null;
    }
  }

  function openModal(html, { wide = false } = {}) {
    clearPreviewKeys();
    previousFocus = document.activeElement;
    el.modal.classList.toggle("is-wide", wide);
    el.modalBody.innerHTML = html;
    el.modalLayer.hidden = false;
    document.body.classList.add("is-modal-open");
    window.setTimeout(() => {
      const focusTarget = el.modal.querySelector(".modal-close");
      focusTarget?.focus({ preventScroll: true });
    }, 10);
  }

  function closeModal() {
    if (el.modalLayer.hidden) return;
    clearPreviewKeys();
    el.modalLayer.hidden = true;
    el.modalBody.innerHTML = "";
    el.modal.classList.remove("is-wide");
    if (el.busyLayer.hidden) document.body.classList.remove("is-modal-open");
    previousFocus?.focus?.({ preventScroll: true });
    previousFocus = null;
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-modal]")) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el.modalLayer.hidden) {
      event.preventDefault();
      closeModal();
    }
  });

  function openHelp() {
    openModal(`
      <div class="help-hero">
        <span class="help-mark"><svg class="icon"><use href="#i-spark"></use></svg></span>
        <div>
          <h2>把 PDF 当成纸张来整理</h2>
          <p>纸间只做几件小事：把页面排好、合在一起、拆开来，或者在图片和 PDF 之间转换。</p>
        </div>
      </div>
      <div class="help-grid">
        <div class="help-item">
          <svg class="icon"><use href="#i-organize"></use></svg>
          <strong>拖动排序，点选删除</strong>
          <p>在「整理页面」中拖动缩略图调整顺序；单击页面选中，再用工具栏的「删除所选」批量删除。双击可以预览大图。</p>
        </div>
        <div class="help-item">
          <svg class="icon"><use href="#i-merge"></use></svg>
          <strong>合并前先排好文件</strong>
          <p>「合并 PDF」里的文件卡片也能上下拖动。合并完成后可以一键继续整理页面。</p>
        </div>
        <div class="help-item">
          <svg class="icon"><use href="#i-compose"></use></svg>
          <strong>左边目标，右边来源</strong>
          <p>在整理页点「添加来源 PDF」，两栏页面可以左右拖动：拖到边缘插入，拖到目标页中间替换。来源页也会保留，方便反复取用。</p>
        </div>
        <div class="help-item">
          <svg class="icon"><use href="#i-split"></use></svg>
          <strong>范围写法很自由</strong>
          <p>输入 1-3, 5, 8-10 这样的范围，每一段会成为一个独立 PDF；也可以按固定页数或逐页拆分。</p>
        </div>
        <div class="help-item">
          <svg class="icon"><use href="#i-shield"></use></svg>
          <strong>文件只在本机</strong>
          <p>工具运行在你自己的电脑上，处理过程不联网。导出完成后，可以随时关闭启动窗口。</p>
        </div>
        <div class="help-item">
          <svg class="icon"><use href="#i-download"></use></svg>
          <strong>结果还能继续编辑</strong>
          <p>合并完成的 PDF 提供“继续整理”；整理页导出的结果也可以重新打开，接着拖动或删除页面。</p>
        </div>
      </div>
      <div class="help-note">
        <strong>小心快捷键：</strong> Ctrl + Z 可以撤销整理操作，Delete 可以删除已选页面，Esc 可以关闭预览。切换工具不会丢失当前工作进度。
      </div>
      <div class="help-foot">
        <button class="btn btn-primary" type="button" data-close-modal>知道了</button>
      </div>
    `);
  }

  // ---------------------------------------------------------------------
  // 工具切换
  // ---------------------------------------------------------------------
  function switchTool(tool) {
    if (!TOOL_META[tool]) return;
    state.activeTool = tool;
    if (["organize", "split", "pdf2img"].includes(tool)) {
      state.pdfPickerTarget = tool;
    } else if (tool === "compose") {
      state.pdfPickerTarget = state.compose.target ? "composeSource" : "composeTarget";
    }
    el.navItems.forEach((button) => {
      const active = button.dataset.tool === tool;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    el.panels.forEach((panel) => {
      const active = panel.dataset.panel === tool;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    el.crumb.textContent = TOOL_META[tool].label;
    document.title = `${TOOL_META[tool].label} · 纸间 PDF`;
    el.dropTitle.textContent = tool === "images" ? "松开即可添加图片" : "松开即可添加 PDF";
    el.dropHint.textContent = tool === "merge"
      ? "可以一次放入多个 PDF，稍后还能调整顺序"
      : "文件只会在本机处理";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  el.navItems.forEach((button) => {
    button.addEventListener("click", () => switchTool(button.dataset.tool));
  });
  $(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    switchTool("organize");
  });

  $("#helpBtn").addEventListener("click", openHelp);
  $("#helpIconBtn").addEventListener("click", openHelp);
  $("#appVersion").textContent = VERSION;

  ["organizeName", "mergeName", "splitName", "imagesName", "pdf2imgName", "composeName"].forEach((id) => {
    const input = document.getElementById(id);
    input?.addEventListener("blur", () => {
      input.value = input.value.replace(/\.(pdf|zip)$/i, "").trim();
    });
  });

  // ---------------------------------------------------------------------
  // 文件选择与拖放
  // ---------------------------------------------------------------------
  function openPdfPicker(target) {
    state.pdfPickerTarget = target;
    el.pdfFileInput.value = "";
    el.pdfFileInput.click();
  }

  $("#organizeOpenBtn").addEventListener("click", () => openPdfPicker("organize"));
  $("#organizeChooseBtn").addEventListener("click", () => openPdfPicker("organize"));
  $("#organizeReplace").addEventListener("click", () => openPdfPicker("organize"));
  $("#organizeAddSourceBtn").addEventListener("click", () => openPdfPicker("organizeSource"));
  $("#sourceReplace").addEventListener("click", () => openPdfPicker("organizeSource"));
  $("#splitOpenBtn").addEventListener("click", () => openPdfPicker("split"));
  $("#splitChooseBtn").addEventListener("click", () => openPdfPicker("split"));
  $("#splitReplace").addEventListener("click", () => openPdfPicker("split"));
  $("#pdf2imgOpenBtn").addEventListener("click", () => openPdfPicker("pdf2img"));
  $("#pdf2imgChooseBtn").addEventListener("click", () => openPdfPicker("pdf2img"));
  $("#pdf2imgReplace").addEventListener("click", () => openPdfPicker("pdf2img"));
  $("#composeTargetBtn").addEventListener("click", () => openPdfPicker("composeTarget"));
  $("#composeTargetReplace").addEventListener("click", () => openPdfPicker("composeTarget"));
  $("#composeSourceBtn").addEventListener("click", () => openPdfPicker("composeSource"));
  $("#composeSourceReplace").addEventListener("click", () => openPdfPicker("composeSource"));

  el.pdfFileInput.addEventListener("change", async () => {
    const file = el.pdfFileInput.files?.[0];
    el.pdfFileInput.value = "";
    if (!file) return;
    if (!isPdf(file)) {
      toast("请选择 PDF 文件", { type: "error" });
      return;
    }
    const target = state.pdfPickerTarget;
    if (target === "organize") await importOrganizeFile(file);
    else if (target === "organizeSource") await importOrganizeSource(file);
    else if (target === "split") await importSplitFile(file);
    else if (target === "pdf2img") await importPdf2imgFile(file);
    else if (target === "composeTarget") await importComposeFile(file, "target");
    else if (target === "composeSource") await importComposeFile(file, "source");
  });

  $("#mergeAddBtn").addEventListener("click", () => {
    el.pdfFilesInput.value = "";
    el.pdfFilesInput.click();
  });
  $("#mergeChooseBtn").addEventListener("click", () => {
    el.pdfFilesInput.value = "";
    el.pdfFilesInput.click();
  });
  $("#mergeAddMoreBtn").addEventListener("click", () => {
    el.pdfFilesInput.value = "";
    el.pdfFilesInput.click();
  });
  el.pdfFilesInput.addEventListener("change", async () => {
    const files = Array.from(el.pdfFilesInput.files || []);
    el.pdfFilesInput.value = "";
    if (files.length) await addMergeFiles(files);
  });

  $("#imagesAddBtn").addEventListener("click", () => openImagePicker());
  $("#imagesChooseBtn").addEventListener("click", () => openImagePicker());
  $("#imagesAddMoreBtn").addEventListener("click", () => openImagePicker());

  function openImagePicker() {
    el.imageFilesInput.value = "";
    el.imageFilesInput.click();
  }
  el.imageFilesInput.addEventListener("change", async () => {
    const files = Array.from(el.imageFilesInput.files || []);
    el.imageFilesInput.value = "";
    if (files.length) await addImageFiles(files);
  });

  let dragDepth = 0;
  function hasFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  }

  window.addEventListener("dragenter", (event) => {
    if (!hasFiles(event) || state.isInternalDrag) return;
    event.preventDefault();
    dragDepth += 1;
    el.dropOverlay.hidden = false;
  });

  window.addEventListener("dragover", (event) => {
    if (!hasFiles(event) || state.isInternalDrag) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("dragleave", (event) => {
    if (!hasFiles(event) || state.isInternalDrag) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) el.dropOverlay.hidden = true;
  });

  window.addEventListener("drop", async (event) => {
    if (state.isInternalDrag) return;
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    el.dropOverlay.hidden = true;
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    await routeDroppedFiles(files);
  });

  async function routeDroppedFiles(files) {
    const tool = state.activeTool;
    if (tool === "merge") {
      const pdfs = files.filter(isPdf);
      if (!pdfs.length) {
        toast("这里需要 PDF 文件", { type: "error" });
        return;
      }
      if (pdfs.length !== files.length) toast("已忽略不是 PDF 的文件");
      await addMergeFiles(pdfs);
      return;
    }
    if (tool === "images") {
      const images = files.filter(isImage);
      if (!images.length) {
        toast("这里需要图片文件", { type: "error" });
        return;
      }
      if (images.length !== files.length) toast("已忽略不是图片的文件");
      await addImageFiles(images);
      return;
    }
    if (tool === "compose") {
      const pdfs = files.filter(isPdf);
      if (!pdfs.length) {
        toast("这里需要 PDF 文件", { type: "error" });
        return;
      }
      const compose = state.compose;
      if (!compose.target && !compose.source && pdfs.length >= 2) {
        await importComposeFile(pdfs[0], "target");
        await importComposeFile(pdfs[1], "source");
        return;
      }
      if (!compose.target) {
        await importComposeFile(pdfs[0], "target");
        return;
      }
      if (!compose.source) {
        await importComposeFile(pdfs[0], "source");
        return;
      }
      toast("目标与来源文件都已选择", {
        detail: "请使用上方对应卡片里的“更换”按钮来换文件。",
      });
      return;
    }
    if (tool === "organize") {
      const pdfs = files.filter(isPdf);
      if (!pdfs.length) {
        toast("这里需要 PDF 文件", { type: "error" });
        return;
      }
      if (!state.organize.doc) {
        await importOrganizeFile(pdfs[0]);
        if (pdfs[1]) await importOrganizeSource(pdfs[1]);
        return;
      }
      if (!state.organize.sourceDoc) {
        await importOrganizeSource(pdfs[0]);
        return;
      }
      toast("工作区里已有目标和来源 PDF", {
        detail: "请用两侧标题旁的“更换”按钮来换文件。",
      });
      return;
    }
    const pdf = files.find(isPdf);
    if (!pdf) {
      toast("请选择 PDF 文件", { type: "error" });
      return;
    }
    if (files.length > 1) toast("这个工具一次处理一份 PDF，已选择第一个文件");
    if (tool === "split") await importSplitFile(pdf);
    else if (tool === "pdf2img") await importPdf2imgFile(pdf);
  }

  // ---------------------------------------------------------------------
  // 整理页面
  // ---------------------------------------------------------------------
  let organizePageSeed = 0;

  function newOrganizePageKey() {
    organizePageSeed += 1;
    return `page_${Date.now().toString(36)}_${organizePageSeed.toString(36)}`;
  }

  function organizePageFromDoc(doc, page) {
    return {
      key: newOrganizePageKey(),
      docId: doc.id,
      page: page.index,
      width: page.width,
      height: page.height,
      fromSource: false,
      originName: "",
    };
  }

  function organizePagesFromDoc(doc) {
    return doc.pages.map((page) => organizePageFromDoc(doc, page));
  }

  function copyPageForTarget(page) {
    return {
      ...page,
      key: newOrganizePageKey(),
      fromSource: true,
      originName: state.organize.sourceDoc?.name || page.originName || "来源 PDF",
    };
  }

  function copyPageForSource(page) {
    return {
      ...page,
      key: newOrganizePageKey(),
      fromSource: false,
      originName: "",
    };
  }

  async function importOrganizeFile(file) {
    showBusy("正在打开目标 PDF…", "马上就好");
    try {
      const doc = await uploadFile(file);
      if (doc.kind !== "pdf") throw new Error("这个文件不是 PDF。");
      const hadSource = Boolean(state.organize.sourceDoc);
      loadOrganizeDoc(doc);
      toast(hadSource ? "目标 PDF 已更换" : "目标 PDF 已打开", {
        detail: hadSource
          ? `${doc.page_count} 页，右侧来源页会继续保留。`
          : `${doc.page_count} 页，可以拖动排序，或添加来源 PDF 取页。`,
      });
    } catch (error) {
      toast("打开失败", { detail: error.message, type: "error", duration: 6500 });
    } finally {
      hideBusy();
    }
  }

  async function importOrganizeSource(file) {
    if (!state.organize.doc) {
      toast("请先打开目标 PDF", { type: "error" });
      return;
    }
    showBusy("正在读取来源 PDF…", "马上就好");
    try {
      const doc = await uploadFile(file);
      if (doc.kind !== "pdf") throw new Error("这个文件不是 PDF。");
      const replacing = Boolean(state.organize.sourceDoc);
      loadOrganizeSource(doc);
      toast(replacing ? "来源 PDF 已更换" : "来源 PDF 已打开", {
        detail: `${doc.page_count} 页，拖到左侧边缘插入，拖到目标页中间替换。`,
      });
    } catch (error) {
      toast("打开失败", { detail: error.message, type: "error", duration: 6500 });
    } finally {
      hideBusy();
    }
  }

  function loadOrganizeDoc(doc) {
    const pages = organizePagesFromDoc(doc);
    state.organize.doc = doc;
    state.organize.pages = pages;
    state.organize.initialPages = pages.slice();
    state.organize.selected.clear();
    state.organize.history = [];
    state.organize.drag = null;
    state.organize.justDraggedAt = 0;
    el.organizeEmpty.hidden = true;
    el.organizeWorkspace.hidden = false;
    el.organizeOpenBtn.hidden = true;
    el.organizeDocName.textContent = doc.name;
    el.organizeDocMeta.textContent = `${doc.page_count} 页 · ${doc.size_text}`;
    el.organizeName.value = outputStem(doc.name, "-已整理");
    el.pageGrid.classList.add("initial-render");
    renderOrganize();
    window.setTimeout(() => el.pageGrid.classList.remove("initial-render"), 500);
  }

  function loadOrganizeSource(doc) {
    state.organize.sourceDoc = doc;
    state.organize.sourcePages = organizePagesFromDoc(doc);
    state.organize.initialSourcePages = state.organize.sourcePages.slice();
    state.organize.sourceSelected.clear();
    state.organize.history = [];
    state.organize.drag = null;
    el.sourceDocName.textContent = doc.name;
    el.sourceDocMeta.textContent = `${doc.page_count} 页 · ${doc.size_text}`;
    el.sourcePageGrid.classList.add("initial-render");
    renderOrganize();
    window.setTimeout(() => el.sourcePageGrid.classList.remove("initial-render"), 500);
  }

  function removeOrganizeSource() {
    const o = state.organize;
    if (!o.sourceDoc) return;
    const previous = {
      doc: o.sourceDoc,
      pages: o.sourcePages.slice(),
      initialPages: o.initialSourcePages.slice(),
    };
    o.sourceDoc = null;
    o.sourcePages = [];
    o.initialSourcePages = [];
    o.sourceSelected.clear();
    o.history = [];
    o.drag = null;
    renderOrganize();
    toast("来源 PDF 已移除", {
      detail: "已经拖到左侧的页面会保留。",
      actionLabel: "撤销",
      action: () => {
        if (state.organize.sourceDoc) return;
        state.organize.sourceDoc = previous.doc;
        state.organize.sourcePages = previous.pages;
        state.organize.initialSourcePages = previous.initialPages;
        state.organize.history = [];
        renderOrganize();
      },
    });
  }

  function renderOrganize() {
    const o = state.organize;
    const { doc, pages, selected, sourceDoc, sourcePages, sourceSelected } = o;
    if (!doc) return;
    const hasSource = Boolean(sourceDoc);
    const selectedCount = selected.size;
    const sourceSelectedCount = sourceSelected.size;

    el.sourcePane.hidden = !hasSource;
    el.organizePanes.classList.toggle("is-dual", hasSource);
    el.organizeAddSourceBtn.hidden = hasSource;
    el.organizeOpenBtn.hidden = true;
    el.organizeDocName.textContent = doc.name;
    el.organizeDocMeta.textContent = `${doc.page_count} 页 · ${doc.size_text}`;
    if (sourceDoc) {
      el.sourceDocName.textContent = sourceDoc.name;
      el.sourceDocMeta.textContent = `${sourceDoc.page_count} 页 · ${sourceDoc.size_text}`;
    }
    el.organizeWorkspaceMeta.textContent = hasSource
      ? `2 个文件 · 输出 ${pages.length} 页 · 来源 ${sourcePages.length} 页`
      : `1 个文件 · 输出 ${pages.length} 页`;
    el.pageCountLabel.textContent = selectedCount
      ? `输出 ${pages.length} 页 · 已选 ${selectedCount}`
      : `输出 ${pages.length} 页`;
    el.sourceCountLabel.textContent = sourceSelectedCount
      ? `来源 ${sourcePages.length} 页 · 已选 ${sourceSelectedCount}`
      : `来源 ${sourcePages.length} 页`;
    el.targetPageHint.textContent = hasSource
      ? "拖动排序 · 边缘插入 · 中间替换"
      : "拖动排序 · 双击预览";
    el.sourcePageHint.textContent = "拖到左侧复制 · 双击预览";

    el.organizeSelectAll.checked = pages.length > 0 && selectedCount === pages.length;
    el.organizeSelectAll.indeterminate = selectedCount > 0 && selectedCount < pages.length;
    el.organizeSelectAll.disabled = pages.length === 0;
    el.sourceSelectAll.checked = sourcePages.length > 0 && sourceSelectedCount === sourcePages.length;
    el.sourceSelectAll.indeterminate = sourceSelectedCount > 0 && sourceSelectedCount < sourcePages.length;
    el.sourceSelectAll.disabled = sourcePages.length === 0;
    el.organizeDeleteSelected.disabled = selectedCount === 0;
    el.organizeDeleteSelected.hidden = selectedCount === 0;
    el.sourceDeleteSelected.disabled = sourceSelectedCount === 0;
    el.sourceDeleteSelected.hidden = sourceSelectedCount === 0;
    el.organizeUndo.disabled = o.history.length === 0;
    el.organizeExportBtn.disabled = pages.length === 0;
    el.organizeSaveMeta.textContent = pages.length
      ? `将导出左侧 ${pages.length} 页`
      : "至少放入 1 页";

    renderOrganizeGrid("target");
    if (hasSource) renderOrganizeGrid("source");
    else {
      el.sourcePageGrid.innerHTML = "";
      el.sourcePageGrid.classList.remove("is-empty");
    }
  }

  function renderOrganizeGrid(pane) {
    const o = state.organize;
    const isTarget = pane === "target";
    const pages = isTarget ? o.pages : o.sourcePages;
    const selected = isTarget ? o.selected : o.sourceSelected;
    const grid = isTarget ? el.pageGrid : el.sourcePageGrid;
    if (!pages.length) {
      grid.classList.add("is-empty");
      grid.innerHTML = isTarget
        ? `<div class="page-empty">
            <strong>输出区还没有页面</strong>
            <p>${o.sourceDoc ? "从右侧拖动来源页到这里，或撤销刚才的删除。" : "打开 PDF 或撤销删除来恢复页面。"}</p>
          </div>`
        : `<div class="page-empty">
            <strong>来源页已全部移除</strong>
            <p>可以更换来源 PDF，或撤销刚才的删除。</p>
          </div>`;
      return;
    }
    grid.classList.remove("is-empty");
    grid.innerHTML = pages.map((page, index) => {
      const pageNumber = index + 1;
      const isSelected = selected.has(page.key);
      const fromSource = isTarget && page.fromSource;
      const label = isTarget ? "输出" : "来源";
      const originTitle = fromSource && page.originName ? ` title="来自：${esc(page.originName)}"` : "";
      return `
        <article class="page-card${isSelected ? " is-selected" : ""}${fromSource ? " is-from-source" : ""}${isTarget ? "" : " is-source-page"}"
          draggable="true" data-pane="${pane}" data-key="${esc(page.key)}" data-index="${index}"
          tabindex="0" role="option" aria-selected="${isSelected}"
          aria-label="${label}第 ${pageNumber} 页${isSelected ? "，已选中" : ""}"${originTitle}>
          <div class="thumb-shell">
            <div class="thumb-loading"></div>
            <img src="${thumbUrl(page.docId, page.page, 360)}" alt="${label}第 ${pageNumber} 页预览" loading="lazy" draggable="false">
            <span class="page-number">${String(pageNumber).padStart(2, "0")}</span>
            ${fromSource ? '<span class="origin-badge" title="来自来源 PDF">源</span>' : ""}
            <button class="card-select" type="button" data-act="select" aria-label="选择${label}第 ${pageNumber} 页">
              <svg class="icon"><use href="#i-check"></use></svg>
            </button>
            <div class="card-actions">
              <button class="card-icon-btn" type="button" data-act="preview" aria-label="预览${label}第 ${pageNumber} 页" title="预览">
                <svg class="icon"><use href="#i-eye"></use></svg>
              </button>
              <button class="card-icon-btn is-danger" type="button" data-act="delete" aria-label="删除${label}第 ${pageNumber} 页" title="删除这一页">
                <svg class="icon"><use href="#i-trash"></use></svg>
              </button>
            </div>
          </div>
          <div class="page-meta">
            <strong>第 ${pageNumber} 页</strong>
            <span>${formatDimensions(page.width, page.height, "pt")}</span>
          </div>
        </article>
      `;
    }).join("");
    $$(".thumb-shell img", grid).forEach(markImageLoaded);
  }

  function organizeSnapshot() {
    return {
      pages: state.organize.pages.slice(),
      sourcePages: state.organize.sourcePages.slice(),
    };
  }

  function organizeSnapshotsSame(a, b) {
    if (!a || !b) return false;
    if (a.pages.length !== b.pages.length || a.sourcePages.length !== b.sourcePages.length) return false;
    return a.pages.every((page, index) => page.key === b.pages[index].key)
      && a.sourcePages.every((page, index) => page.key === b.sourcePages[index].key);
  }

  function pushOrganizeHistory() {
    const snapshot = organizeSnapshot();
    const last = state.organize.history[state.organize.history.length - 1];
    if (organizeSnapshotsSame(last, snapshot)) return;
    state.organize.history.push(snapshot);
    if (state.organize.history.length > 40) state.organize.history.shift();
  }

  function undoOrganize() {
    const previous = state.organize.history.pop();
    if (!previous) return;
    state.organize.pages = previous.pages;
    state.organize.sourcePages = previous.sourcePages;
    const targetKeys = new Set(previous.pages.map((page) => page.key));
    const sourceKeys = new Set(previous.sourcePages.map((page) => page.key));
    state.organize.selected.forEach((key) => {
      if (!targetKeys.has(key)) state.organize.selected.delete(key);
    });
    state.organize.sourceSelected.forEach((key) => {
      if (!sourceKeys.has(key)) state.organize.sourceSelected.delete(key);
    });
    state.organize.justDraggedAt = Date.now();
    renderOrganize();
    toast("已撤销上一步");
  }

  function deleteOrganizePages(pane, keys) {
    const o = state.organize;
    const list = pane === "target" ? o.pages : o.sourcePages;
    const removing = new Set(keys.filter((key) => list.some((page) => page.key === key)));
    if (!removing.size) return;
    pushOrganizeHistory();
    if (pane === "target") {
      o.pages = o.pages.filter((page) => !removing.has(page.key));
      removing.forEach((key) => o.selected.delete(key));
    } else {
      o.sourcePages = o.sourcePages.filter((page) => !removing.has(page.key));
      removing.forEach((key) => o.sourceSelected.delete(key));
    }
    o.justDraggedAt = Date.now();
    renderOrganize();
    const count = removing.size;
    const targetEmpty = pane === "target" && o.pages.length === 0;
    const sourceEmpty = pane === "source" && o.sourcePages.length === 0;
    toast(pane === "target" ? `已删除 ${count} 页` : `已从来源移除 ${count} 页`, {
      detail: targetEmpty
        ? "输出区已清空，可以从右侧拖入来源页，或撤销。"
        : sourceEmpty
          ? "来源页已清空，可以更换来源 PDF，或撤销。"
          : "原文件没有被修改。",
      actionLabel: "撤销",
      action: undoOrganize,
    });
  }

  function toggleOrganizeSelection(pane, key) {
    const selected = pane === "target" ? state.organize.selected : state.organize.sourceSelected;
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    state.organize.justDraggedAt = 0;
    renderOrganize();
  }

  function openOrganizePreview(pane, key) {
    const o = state.organize;
    const list = pane === "target" ? o.pages : o.sourcePages;
    const index = list.findIndex((page) => page.key === key);
    if (index < 0) return;
    const items = list.map((page, itemIndex) => ({
      docId: page.docId,
      page: page.page,
      label: `第 ${itemIndex + 1} 页`,
    }));
    const title = pane === "target" ? o.doc?.name : o.sourceDoc?.name;
    openPreview(items, index, title || "PDF 预览");
  }

  function initOrganizeGrid(grid, pane) {
    grid.addEventListener("click", (event) => {
      const card = event.target.closest(".page-card");
      if (!card) return;
      if (Date.now() - state.organize.justDraggedAt < 250) return;
      const key = card.dataset.key;
      const action = event.target.closest("[data-act]")?.dataset.act;
      if (action === "preview") {
        openOrganizePreview(pane, key);
        return;
      }
      if (action === "delete") {
        deleteOrganizePages(pane, [key]);
        return;
      }
      toggleOrganizeSelection(pane, key);
    });

    grid.addEventListener("dblclick", (event) => {
      const card = event.target.closest(".page-card");
      if (!card || event.target.closest("button")) return;
      openOrganizePreview(pane, card.dataset.key);
    });

    grid.addEventListener("keydown", (event) => {
      if (event.target.closest("button")) return;
      const card = event.target.closest(".page-card");
      if (!card) return;
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        toggleOrganizeSelection(pane, card.dataset.key);
      } else if (event.key === "Enter") {
        event.preventDefault();
        openOrganizePreview(pane, card.dataset.key);
      }
    });

    grid.addEventListener("dragstart", (event) => {
      if (event.target.closest("button")) {
        event.preventDefault();
        return;
      }
      const card = event.target.closest(".page-card");
      if (!card) return;
      const o = state.organize;
      const list = pane === "target" ? o.pages : o.sourcePages;
      const selected = pane === "target" ? o.selected : o.sourceSelected;
      const keySet = selected.has(card.dataset.key)
        ? new Set(selected)
        : new Set([card.dataset.key]);
      const keys = list.filter((page) => keySet.has(page.key)).map((page) => page.key);
      if (!keys.length) return;
      o.drag = { from: pane, keys, over: null };
      state.isInternalDrag = true;
      el.organizePanes.classList.add("is-dragging-pages");
      $$(".page-card", grid).forEach((item) => {
        item.classList.toggle("is-dragging", keySet.has(item.dataset.key));
      });
      event.dataTransfer.effectAllowed = "copyMove";
      event.dataTransfer.setData("text/plain", "paperly-pages");
    });

    grid.addEventListener("dragover", (event) => {
      const drag = state.organize.drag;
      if (!drag) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = drag.from === pane ? "move" : "copy";
      clearOrganizeDropHints();
      const paneEl = pane === "target" ? el.targetPane : el.sourcePane;
      paneEl.classList.add("is-drop-target");
      const pages = pane === "target" ? state.organize.pages : state.organize.sourcePages;
      if (!pages.length) {
        grid.classList.add("is-drop-empty");
        drag.over = { pane, index: 0, mode: "insert" };
        return;
      }
      const card = findOrganizeDropCard(grid, event.clientX, event.clientY);
      if (!card) {
        grid.classList.add("is-drop-empty");
        drag.over = { pane, index: pages.length, mode: "insert" };
        return;
      }
      const rect = card.getBoundingClientRect();
      const relX = (event.clientX - rect.left) / Math.max(1, rect.width);
      const relY = (event.clientY - rect.top) / Math.max(1, rect.height);
      const canReplace = drag.from === "source" && pane === "target" && relX > 0.2 && relX < 0.8 && relY > 0.18 && relY < 0.82;
      const index = pages.findIndex((page) => page.key === card.dataset.key);
      if (index < 0) return;
      if (canReplace) {
        card.classList.add("drop-replace");
        drag.over = { pane, index, mode: "replace", key: card.dataset.key };
        return;
      }
      const after = event.clientX > rect.left + rect.width / 2;
      card.classList.add(after ? "drop-after" : "drop-before");
      drag.over = { pane, index: index + (after ? 1 : 0), mode: "insert", key: card.dataset.key };
    });

    grid.addEventListener("drop", (event) => {
      const drag = state.organize.drag;
      if (!drag) return;
      event.preventDefault();
      event.stopPropagation();
      const over = drag.over;
      cleanupOrganizeDrag();
      if (!over) return;
      applyOrganizeDrop(drag, over);
    });

    grid.addEventListener("dragend", cleanupOrganizeDrag);
  }

  function findOrganizeDropCard(grid, x, y) {
    const direct = document.elementFromPoint(x, y)?.closest?.(".page-card");
    if (direct && grid.contains(direct)) return direct;
    const cards = $$(".page-card", grid);
    let best = null;
    let bestDistance = Infinity;
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        best = card;
        bestDistance = 0;
        return;
      }
      const dx = x - (rect.left + rect.width / 2);
      const dy = y - (rect.top + rect.height / 2);
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = card;
      }
    });
    return best;
  }

  function clearOrganizeDropHints() {
    [el.pageGrid, el.sourcePageGrid].forEach((grid) => {
      grid.classList.remove("is-drop-empty");
      $$(".page-card", grid).forEach((card) => {
        card.classList.remove("drop-before", "drop-after", "drop-replace");
      });
    });
    el.targetPane.classList.remove("is-drop-target");
    el.sourcePane.classList.remove("is-drop-target");
  }

  function cleanupOrganizeDrag() {
    state.organize.drag = null;
    state.isInternalDrag = false;
    clearOrganizeDropHints();
    el.organizePanes.classList.remove("is-dragging-pages");
    [el.pageGrid, el.sourcePageGrid].forEach((grid) => {
      $$(".page-card.is-dragging", grid).forEach((card) => card.classList.remove("is-dragging"));
    });
  }

  function moveOrganizeGroup(list, keys, targetIndex) {
    const keySet = new Set(keys);
    const moving = list.filter((page) => keySet.has(page.key));
    const rest = list.filter((page) => !keySet.has(page.key));
    if (!moving.length) return list;
    let insertAt = targetIndex;
    for (let index = 0; index < Math.min(targetIndex, list.length); index += 1) {
      if (keySet.has(list[index].key)) insertAt -= 1;
    }
    insertAt = clamp(insertAt, 0, rest.length);
    rest.splice(insertAt, 0, ...moving);
    return rest;
  }

  function samePageOrder(a, b) {
    return a.length === b.length && a.every((page, index) => page.key === b[index].key);
  }

  function applyOrganizeDrop(drag, over) {
    const o = state.organize;
    const fromList = drag.from === "target" ? o.pages : o.sourcePages;
    const keySet = new Set(drag.keys);
    const moving = fromList.filter((page) => keySet.has(page.key));
    if (!moving.length) return;

    if (drag.from === over.pane) {
      const current = fromList;
      const next = moveOrganizeGroup(current, drag.keys, over.index);
      if (samePageOrder(current, next)) return;
      pushOrganizeHistory();
      if (over.pane === "target") o.pages = next;
      else o.sourcePages = next;
      o.justDraggedAt = Date.now();
      renderOrganize();
      return;
    }

    pushOrganizeHistory();
    if (over.pane === "target") {
      const copies = moving.map(copyPageForTarget);
      let replaced = false;
      if (over.mode === "replace" && o.pages[over.index]) {
        o.pages.splice(over.index, 1, ...copies);
        replaced = true;
      } else {
        o.pages.splice(over.index, 0, ...copies);
      }
      o.justDraggedAt = Date.now();
      renderOrganize();
      toast(replaced ? `已替换 1 页` : `已插入 ${copies.length} 页`, {
        detail: replaced
          ? copies.length > 1
            ? `这一页已换成 ${copies.length} 页来源内容。`
            : "这一页已换成来源页面。"
          : `已放到左侧第 ${over.index + 1} 页的位置，来源页仍保留在右侧。`,
      });
    } else {
      const copies = moving.map(copyPageForSource);
      o.sourcePages.splice(over.index, 0, ...copies);
      o.justDraggedAt = Date.now();
      renderOrganize();
      toast(`已复制 ${copies.length} 页到右侧`, {
        detail: "左侧输出页没有变化。",
      });
    }
  }

  initOrganizeGrid(el.pageGrid, "target");
  initOrganizeGrid(el.sourcePageGrid, "source");

  el.organizeSelectAll.addEventListener("change", () => {
    state.organize.selected.clear();
    if (el.organizeSelectAll.checked) {
      state.organize.pages.forEach((page) => state.organize.selected.add(page.key));
    }
    renderOrganize();
  });

  el.sourceSelectAll.addEventListener("change", () => {
    state.organize.sourceSelected.clear();
    if (el.sourceSelectAll.checked) {
      state.organize.sourcePages.forEach((page) => state.organize.sourceSelected.add(page.key));
    }
    renderOrganize();
  });

  el.organizeDeleteSelected.addEventListener("click", () => {
    deleteOrganizePages("target", Array.from(state.organize.selected));
  });
  el.sourceDeleteSelected.addEventListener("click", () => {
    deleteOrganizePages("source", Array.from(state.organize.sourceSelected));
  });
  el.organizeUndo.addEventListener("click", undoOrganize);
  $("#sourceRemove").addEventListener("click", removeOrganizeSource);

  $("#organizeReset").addEventListener("click", () => {
    const o = state.organize;
    if (!o.doc) return;
    pushOrganizeHistory();
    o.pages = o.initialPages.slice();
    o.sourcePages = o.sourceDoc ? o.initialSourcePages.slice() : [];
    o.selected.clear();
    o.sourceSelected.clear();
    o.justDraggedAt = Date.now();
    renderOrganize();
    toast("已恢复打开时的页面", {
      actionLabel: "撤销",
      action: undoOrganize,
    });
  });

  el.organizeExportBtn.addEventListener("click", async () => {
    if (!state.organize.pages.length) return;
    const items = state.organize.pages.map((page) => ({ doc_id: page.docId, page: page.page }));
    const name = el.organizeName.value.trim() || "整理结果";
    showBusy("正在生成 PDF…", "会保留原有页面尺寸与清晰度");
    try {
      const result = await apiPost("/api/export-pages", { items, name });
      startDownloadWithToast(result);
    } catch (error) {
      toast("导出失败", { detail: error.message, type: "error", duration: 6500 });
    } finally {
      hideBusy();
    }
  });

  function startDownloadWithToast(result) {
    downloadResult(result, false);
    toast("PDF 已生成，下载已开始", {
      detail: `${result.page_count || ""}${result.page_count ? " 页 · " : ""}${result.size_text || ""}`,
      actionLabel: "再次下载",
      action: () => downloadResult(result),
    });
  }

  // ---------------------------------------------------------------------
  // 合并 PDF
  // ---------------------------------------------------------------------
  async function addMergeFiles(files) {
    const pdfs = files.filter(isPdf);
    if (!pdfs.length) {
      toast("请选择 PDF 文件", { type: "error" });
      return;
    }
    if (state.merge.docs.length + pdfs.length > 100) {
      toast("一次最多合并 100 个文件", { type: "error" });
      return;
    }
    state.merge.result = null;
    el.mergeResult.hidden = true;
    let added = 0;
    const errors = [];
    showBusy("正在读取 PDF…", `0 / ${pdfs.length}`);
    try {
      for (let index = 0; index < pdfs.length; index += 1) {
        updateBusy(`正在读取 PDF…`, `${index + 1} / ${pdfs.length} · ${pdfs[index].name}`);
        try {
          const doc = await uploadFile(pdfs[index]);
          if (doc.kind !== "pdf") throw new Error("不是 PDF 文件。");
          state.merge.docs.push(doc);
          added += 1;
        } catch (error) {
          errors.push(`${pdfs[index].name}：${error.message}`);
        }
      }
      if (added > 0) {
        el.mergeEmpty.hidden = true;
        el.mergeWorkspace.hidden = false;
        if (!el.mergeName.value.trim()) {
          el.mergeName.value = outputStem(state.merge.docs[0].name, "-合并");
        }
        renderMerge();
        toast(`已添加 ${added} 个文件`, {
          detail: state.merge.docs.length < 2 ? "再添加一个 PDF 就可以合并了。" : "可以拖动文件调整先后顺序。",
        });
      }
      if (errors.length) {
        toast("部分文件没有添加", {
          detail: errors.slice(0, 2).join("；") + (errors.length > 2 ? `；还有 ${errors.length - 2} 个` : ""),
          type: "error",
          duration: 7000,
        });
      }
    } finally {
      hideBusy();
    }
  }

  function renderMerge() {
    const { docs } = state.merge;
    if (!docs.length) {
      el.mergeEmpty.hidden = false;
      el.mergeWorkspace.hidden = true;
      return;
    }
    el.mergeEmpty.hidden = true;
    el.mergeWorkspace.hidden = false;
    const totalPages = docs.reduce((sum, doc) => sum + doc.page_count, 0);
    el.mergeSummary.textContent = `${docs.length} 个文件 · 共 ${totalPages} 页`;
    el.mergeSaveMeta.textContent = `共 ${totalPages} 页`;
    el.mergeExportBtn.disabled = docs.length === 0;
    el.mergeList.innerHTML = docs.map((doc, index) => `
      <article class="merge-row" draggable="true" data-id="${esc(doc.id)}">
        <span class="merge-grip" title="拖动排序"><svg class="icon"><use href="#i-grip"></use></svg></span>
        <span class="merge-order">${String(index + 1).padStart(2, "0")}</span>
        <img class="merge-cover" src="${thumbUrl(doc.id, 0, 200)}" alt="" loading="lazy">
        <div class="merge-info">
          <strong title="${esc(doc.name)}">${esc(doc.name)}</strong>
          <p>${doc.page_count} 页 · ${esc(doc.size_text)}</p>
        </div>
        <div class="merge-row-actions">
          <button class="icon-button up" type="button" data-act="up" aria-label="上移" title="上移" ${index === 0 ? "disabled" : ""}>
            <svg class="icon"><use href="#i-arrow-up"></use></svg>
          </button>
          <button class="icon-button down" type="button" data-act="down" aria-label="下移" title="下移" ${index === docs.length - 1 ? "disabled" : ""}>
            <svg class="icon"><use href="#i-arrow-down"></use></svg>
          </button>
          <button class="icon-button remove" type="button" data-act="remove" aria-label="移除 ${esc(doc.name)}" title="移除">
            <svg class="icon"><use href="#i-close"></use></svg>
          </button>
        </div>
      </article>
    `).join("");
    $$(".merge-cover", el.mergeList).forEach((img) => {
      img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
    });
  }

  el.mergeList.addEventListener("click", (event) => {
    const row = event.target.closest(".merge-row");
    const action = event.target.closest("[data-act]")?.dataset.act;
    if (!row || !action) return;
    const id = row.dataset.id;
    const index = state.merge.docs.findIndex((doc) => doc.id === id);
    if (index < 0) return;
    if (action === "remove") {
      const [removed] = state.merge.docs.splice(index, 1);
      state.merge.result = null;
      el.mergeResult.hidden = true;
      renderMerge();
      toast(`已移除「${removed.name}」`, {
        actionLabel: "撤销",
        action: () => {
          state.merge.docs.splice(index, 0, removed);
          renderMerge();
        },
      });
      return;
    }
    if (action === "up" && index > 0) {
      [state.merge.docs[index - 1], state.merge.docs[index]] = [state.merge.docs[index], state.merge.docs[index - 1]];
      state.merge.result = null;
      el.mergeResult.hidden = true;
      renderMerge();
    } else if (action === "down" && index < state.merge.docs.length - 1) {
      [state.merge.docs[index + 1], state.merge.docs[index]] = [state.merge.docs[index], state.merge.docs[index + 1]];
      state.merge.result = null;
      el.mergeResult.hidden = true;
      renderMerge();
    }
  });

  $("#mergeClearBtn").addEventListener("click", () => {
    if (!state.merge.docs.length) return;
    const previous = state.merge.docs.slice();
    const previousName = el.mergeName.value;
    state.merge.docs = [];
    state.merge.result = null;
    el.mergeResult.hidden = true;
    el.mergeName.value = "";
    renderMerge();
    toast("已清空文件列表", {
      actionLabel: "撤销",
      action: () => {
        state.merge.docs = previous;
        el.mergeName.value = previousName;
        renderMerge();
      },
    });
  });

  el.mergeExportBtn.addEventListener("click", async () => {
    if (state.merge.docs.length < 2) {
      toast("再多添加一个 PDF 吧", { type: "error", detail: "合并至少需要两个文件。" });
      return;
    }
    const totalPages = state.merge.docs.reduce((sum, doc) => sum + doc.page_count, 0);
    showBusy("正在合并 PDF…", `共 ${state.merge.docs.length} 个文件、${totalPages} 页`);
    try {
      const result = await apiPost("/api/merge", {
        doc_ids: state.merge.docs.map((doc) => doc.id),
        name: el.mergeName.value.trim() || "合并文档",
      });
      state.merge.result = result;
      el.mergeResult.hidden = false;
      el.mergeResultTitle.textContent = `合并完成 · ${result.page_count} 页`;
      el.mergeResultMeta.textContent = `${result.filename} · ${result.size_text}，可以下载或继续调整页面顺序。`;
      toast("合并完成", { detail: `${result.page_count} 页 · ${result.size_text}` });
      el.mergeResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      toast("合并失败", { detail: error.message, type: "error", duration: 6500 });
    } finally {
      hideBusy();
    }
  });

  $("#mergeDownloadBtn").addEventListener("click", () => {
    if (state.merge.result) downloadResult(state.merge.result);
  });
  $("#mergeContinueBtn").addEventListener("click", () => {
    if (!state.merge.result?.doc) return;
    loadOrganizeDoc(state.merge.result.doc);
    switchTool("organize");
    toast("已打开合并结果", { detail: "现在可以拖动页面，或删除不需要的页面。" });
  });

  // 合并文件的纵向排序
  el.mergeList.addEventListener("dragstart", (event) => {
    const row = event.target.closest(".merge-row");
    if (!row) return;
    state.isInternalDrag = true;
    state.merge.draggingId = row.dataset.id;
    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.dataset.id);
  });

  el.mergeList.addEventListener("dragover", (event) => {
    if (!state.merge.draggingId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    clearDropHints(el.mergeList);
    const row = event.target.closest(".merge-row");
    if (!row || row.dataset.id === state.merge.draggingId) {
      state.merge.dropId = null;
      return;
    }
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    row.classList.add(after ? "drop-after" : "drop-before");
    state.merge.dropId = row.dataset.id;
    state.merge.dropAfter = after;
  });

  el.mergeList.addEventListener("drop", (event) => {
    if (!state.merge.draggingId) return;
    event.preventDefault();
    event.stopPropagation();
    const fromId = state.merge.draggingId;
    const targetId = state.merge.dropId;
    const after = state.merge.dropAfter;
    cleanupMergeDrag();
    if (!targetId || fromId === targetId) return;
    const fromIndex = state.merge.docs.findIndex((doc) => doc.id === fromId);
    const target = state.merge.docs.find((doc) => doc.id === targetId);
    if (fromIndex < 0 || !target) return;
    const [moved] = state.merge.docs.splice(fromIndex, 1);
    const targetIndex = state.merge.docs.indexOf(target);
    state.merge.docs.splice(targetIndex + (after ? 1 : 0), 0, moved);
    state.merge.result = null;
    el.mergeResult.hidden = true;
    renderMerge();
  });

  el.mergeList.addEventListener("dragend", cleanupMergeDrag);
  function cleanupMergeDrag() {
    state.merge.draggingId = null;
    state.merge.dropId = null;
    state.isInternalDrag = false;
    clearDropHints(el.mergeList);
    $$(".merge-row.is-dragging", el.mergeList).forEach((row) => row.classList.remove("is-dragging"));
  }

  // ---------------------------------------------------------------------
  // 替换 / 插入
  // ---------------------------------------------------------------------
  async function importComposeFile(file, role) {
    const label = role === "target" ? "目标" : "来源";
    showBusy(`正在读取${label} PDF…`, "马上就好");
    try {
      const doc = await uploadFile(file);
      if (doc.kind !== "pdf") throw new Error("这个文件不是 PDF。");
      loadComposeDoc(doc, role);
      toast(`${label} PDF 已打开`, {
        detail: role === "source"
          ? `${doc.page_count} 页，请选择要使用的页面。`
          : `${doc.page_count} 页，接下来设置替换或插入位置。`,
      });
    } catch (error) {
      toast("打开失败", { detail: error.message, type: "error", duration: 6500 });
    } finally {
      hideBusy();
    }
  }

  function loadComposeDoc(doc, role) {
    const compose = state.compose;
    compose.result = null;
    el.composeResult.hidden = true;
    if (role === "target") {
      compose.target = doc;
      el.composeTargetStart.value = "1";
      el.composeTargetEnd.value = "1";
      el.composeInsertPage.value = "1";
      if (compose.nameAuto || !el.composeName.value.trim()) {
        el.composeName.value = outputStem(doc.name, "-已合成");
        compose.nameAuto = true;
      }
      setCover(el.composeTargetCover, thumbUrl(doc.id, 0, 480));
    } else {
      compose.source = doc;
      compose.sourcePages.clear();
      if (doc.page_count > 0) compose.sourcePages.add(0);
      el.composeRange.value = "";
      el.composeRange.placeholder = rangeExample(doc.page_count).replace("例如：", "");
      setCover(el.composeSourceCover, thumbUrl(doc.id, 0, 480));
      renderComposeSourceGrid();
    }
    renderComposeSlots();
    updateCompose();
  }

  function renderComposeSlots() {
    const { target, source } = state.compose;
    el.composeTargetEmpty.hidden = Boolean(target);
    el.composeTargetDoc.hidden = !target;
    el.composeSourceEmpty.hidden = Boolean(source);
    el.composeSourceDoc.hidden = !source;
    el.composeResetBtn.hidden = !(target || source);
    el.composeWorkspace.hidden = !(target && source);

    if (target) {
      el.composeTargetName.textContent = target.name;
      el.composeTargetMeta.textContent = `${target.page_count} 页 · ${target.size_text}`;
      el.composeTargetStart.max = String(target.page_count);
      el.composeTargetEnd.max = String(target.page_count);
      el.composeInsertPage.max = String(target.page_count);
    }
    if (source) {
      el.composeSourceName.textContent = source.name;
      el.composeSourceMeta.textContent = `${source.page_count} 页 · ${source.size_text}`;
    }
  }

  function renderComposeSourceGrid() {
    const source = state.compose.source;
    if (!source) {
      el.composeSourceGrid.innerHTML = "";
      return;
    }
    el.composeSourceGrid.innerHTML = source.pages.map((page) => {
      const pageNumber = page.index + 1;
      const selected = state.compose.sourcePages.has(page.index);
      return `
        <button class="source-page${selected ? " is-selected" : ""}" type="button"
          data-page="${page.index}" aria-pressed="${selected}"
          aria-label="来源第 ${pageNumber} 页${selected ? "，已选中" : ""}"
          title="来源第 ${pageNumber} 页 · 点击选择">
          <span class="source-thumb">
            <span class="thumb-loading"></span>
            <img src="${thumbUrl(source.id, page.index, 270)}" alt="来源第 ${pageNumber} 页" loading="lazy" draggable="false">
            <span class="source-check"><svg class="icon"><use href="#i-check"></use></svg></span>
          </span>
          <span class="source-page-label">第 ${pageNumber} 页</span>
        </button>
      `;
    }).join("");
    $$("img", el.composeSourceGrid).forEach(markImageLoaded);
    refreshComposeSourceSelection();
  }

  function refreshComposeSourceSelection() {
    $$(".source-page", el.composeSourceGrid).forEach((card) => {
      const index = Number(card.dataset.page);
      const selected = state.compose.sourcePages.has(index);
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
      card.setAttribute("aria-label", `来源第 ${index + 1} 页${selected ? "，已选中" : ""}`);
    });
  }

  function setComposeMode(mode) {
    state.compose.mode = mode === "insert" ? "insert" : "replace";
    $$('input[name="composeMode"]').forEach((input) => {
      input.checked = input.value === state.compose.mode;
      input.closest(".mode-option")?.classList.toggle("is-selected", input.checked);
    });
    el.composeReplacePanel.hidden = state.compose.mode !== "replace";
    el.composeInsertPanel.hidden = state.compose.mode !== "insert";
    updateCompose();
  }

  function getComposeLocation(selectedCount) {
    const target = state.compose.target;
    if (!target) {
      return { ok: false, message: "请选择目标 PDF。" };
    }
    const count = target.page_count;
    if (state.compose.mode === "replace") {
      const start = Number.parseInt(el.composeTargetStart.value, 10);
      const end = Number.parseInt(el.composeTargetEnd.value, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return { ok: false, message: "请填写有效的目标页码范围。" };
      }
      if (start < 1 || end < 1 || start > count || end > count) {
        return { ok: false, message: `目标页码需要在 1 到 ${count} 之间。` };
      }
      if (start > end) {
        return { ok: false, message: "目标范围的起始页不能大于结束页。" };
      }
      return {
        ok: true,
        start: start - 1,
        end: end - 1,
        label: start === end ? `第 ${start} 页` : `第 ${start}-${end} 页`,
        resultCount: count - (end - start + 1) + selectedCount,
      };
    }

    const position = el.composeInsertPosition.value;
    if (position === "start") {
      return { ok: true, insertIndex: 0, label: "文档开头", resultCount: count + selectedCount };
    }
    if (position === "end") {
      return { ok: true, insertIndex: count, label: "文档末尾", resultCount: count + selectedCount };
    }
    const page = Number.parseInt(el.composeInsertPage.value, 10);
    if (!Number.isFinite(page) || page < 1 || page > count) {
      return { ok: false, message: `插入位置需要在 1 到 ${count} 之间。` };
    }
    return {
      ok: true,
      insertIndex: page,
      label: `第 ${page} 页之后`,
      resultCount: count + selectedCount,
    };
  }

  function composePageText(pages) {
    const numbers = pages.map((page) => page + 1);
    if (numbers.length <= 8) return `第 ${numbers.join("、")} 页`;
    return `第 ${numbers.slice(0, 8).join("、")} 等 ${numbers.length} 页`;
  }

  function updateCompose() {
    const { target, source } = state.compose;
    if (state.compose.result) {
      state.compose.result = null;
      el.composeResult.hidden = true;
    }
    el.composeInsertPageRow.hidden = el.composeInsertPosition.value !== "after";

    if (!target || !source) {
      el.composeSourceSummary.textContent = source
        ? `${source.page_count} 页 · 尚未选择页面`
        : "尚未选择页面";
      el.composeSummary.textContent = "先选择目标 PDF 和来源 PDF。";
      el.composeSaveMeta.textContent = "选择两份 PDF 后开始";
      el.composeExportBtn.disabled = true;
      return;
    }

    const selected = Array.from(state.compose.sourcePages).sort((a, b) => a - b);
    el.composeSourceSummary.textContent = selected.length
      ? `已选 ${selected.length} 页 / 共 ${source.page_count} 页`
      : `共 ${source.page_count} 页 · 尚未选择`;

    if (!selected.length) {
      el.composeSummary.textContent = "先在左侧选择来源页面，再设置目标位置。";
      el.composeSaveMeta.textContent = "选择来源页面后可生成";
      el.composeExportBtn.disabled = true;
      return;
    }

    const location = getComposeLocation(selected.length);
    if (!location.ok) {
      el.composeSummary.textContent = location.message;
      el.composeSaveMeta.textContent = "请检查目标位置";
      el.composeExportBtn.disabled = true;
      return;
    }

    if (state.compose.mode === "replace") {
      el.composeSummary.innerHTML = `将用来源<strong>${composePageText(selected)}</strong>替换目标<strong>${location.label}</strong>，结果共 <strong>${location.resultCount} 页</strong>。`;
    } else {
      el.composeSummary.innerHTML = `将来源<strong>${composePageText(selected)}</strong>插入到<strong>${location.label}</strong>，结果共 <strong>${location.resultCount} 页</strong>。`;
    }
    el.composeSaveMeta.textContent = `结果共 ${location.resultCount} 页 · 来源 ${selected.length} 页`;
    el.composeExportBtn.disabled = location.resultCount < 1;
  }

  function parseComposePageSet(text, pageCount) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("请输入页码，例如 1-3, 5。");
    if (raw.toLowerCase() === "all" || raw === "全部") {
      return Array.from({ length: pageCount }, (_, index) => index);
    }
    const pieces = raw.split(/[,，;；\n]+/).map((piece) => piece.trim()).filter(Boolean);
    if (!pieces.length) throw new Error("请输入有效的页码。");
    const selected = new Set();
    for (const piece of pieces) {
      const match = piece.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (!match) throw new Error(`“${piece}”不是有效页码，请使用 1-3 这样的格式。`);
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (start < 1 || end < 1) throw new Error("页码从 1 开始。");
      if (start > end) throw new Error(`“${piece}”的起始页不能大于结束页。`);
      if (end > pageCount) throw new Error(`“${piece}”超出了来源文档范围（共 ${pageCount} 页）。`);
      for (let page = start; page <= end; page += 1) selected.add(page - 1);
    }
    if (!selected.size) throw new Error("没有选中任何页面。");
    return Array.from(selected).sort((a, b) => a - b);
  }

  function applyComposeRange() {
    const source = state.compose.source;
    if (!source) return;
    try {
      const pages = parseComposePageSet(el.composeRange.value, source.page_count);
      state.compose.sourcePages = new Set(pages);
      refreshComposeSourceSelection();
      updateCompose();
      toast(`已选择 ${pages.length} 页`, { detail: composePageText(pages) });
    } catch (error) {
      toast("页码无效", { detail: error.message, type: "error" });
      el.composeRange.focus();
    }
  }

  function normalizeComposeTargetRange(changed) {
    const target = state.compose.target;
    if (!target) return;
    const count = target.page_count;
    let start = clamp(Number.parseInt(el.composeTargetStart.value, 10) || 1, 1, count);
    let end = clamp(Number.parseInt(el.composeTargetEnd.value, 10) || 1, 1, count);
    if (start > end) {
      if (changed === "start") end = start;
      else start = end;
    }
    el.composeTargetStart.value = String(start);
    el.composeTargetEnd.value = String(end);
    updateCompose();
  }

  function resetCompose(announce = true) {
    state.compose = {
      target: null,
      source: null,
      sourcePages: new Set(),
      mode: "replace",
      result: null,
      nameAuto: true,
    };
    el.composeTargetEmpty.hidden = false;
    el.composeTargetDoc.hidden = true;
    el.composeSourceEmpty.hidden = false;
    el.composeSourceDoc.hidden = true;
    el.composeTargetCover.removeAttribute("src");
    el.composeSourceCover.removeAttribute("src");
    el.composeTargetCover.classList.remove("is-loaded");
    el.composeSourceCover.classList.remove("is-loaded");
    el.composeTargetName.textContent = "目标.pdf";
    el.composeTargetMeta.textContent = "0 页";
    el.composeSourceName.textContent = "来源.pdf";
    el.composeSourceMeta.textContent = "0 页";
    el.composeSourceGrid.innerHTML = "";
    el.composeRange.value = "";
    el.composeName.value = "";
    el.composeTargetStart.value = "1";
    el.composeTargetEnd.value = "1";
    el.composeInsertPosition.value = "after";
    el.composeInsertPage.value = "1";
    el.composeInsertPageRow.hidden = false;
    el.composeWorkspace.hidden = true;
    el.composeResetBtn.hidden = true;
    el.composeResult.hidden = true;
    setComposeMode("replace");
    if (announce) toast("已清空替换 / 插入工作区");
  }

  async function exportCompose() {
    const { target, source } = state.compose;
    if (!target || !source) return;
    const selected = Array.from(state.compose.sourcePages).sort((a, b) => a - b);
    if (!selected.length) {
      toast("先选择来源页面", { type: "error" });
      return;
    }
    const location = getComposeLocation(selected.length);
    if (!location.ok) {
      toast("目标位置不正确", { type: "error", detail: location.message });
      return;
    }
    const payload = {
      target_id: target.id,
      source_id: source.id,
      source_pages: selected,
      mode: state.compose.mode,
      name: el.composeName.value.trim() || outputStem(target.name, "-已合成"),
    };
    if (state.compose.mode === "replace") {
      payload.target_start = location.start;
      payload.target_end = location.end;
    } else {
      payload.insert_index = location.insertIndex;
    }

    showBusy("正在生成新 PDF…", state.compose.mode === "replace" ? "替换目标页范围" : "插入来源页面");
    try {
      const result = await apiPost("/api/compose", payload);
      state.compose.result = result;
      el.composeResult.hidden = false;
      el.composeResultTitle.textContent = `新 PDF 已生成 · ${result.page_count} 页`;
      el.composeResultMeta.textContent = `${result.filename} · ${result.size_text}，原文件未改动。`;
      toast("页面合成完成", { detail: `${result.page_count} 页 · ${result.size_text}` });
      el.composeResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      toast("生成失败", { detail: error.message, type: "error", duration: 6500 });
    } finally {
      hideBusy();
    }
  }

  $("#composeResetBtn").addEventListener("click", () => resetCompose());
  $$('input[name="composeMode"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) setComposeMode(input.value);
    });
  });

  el.composeSourceGrid.addEventListener("click", (event) => {
    const card = event.target.closest(".source-page");
    if (!card) return;
    const index = Number(card.dataset.page);
    if (state.compose.sourcePages.has(index)) state.compose.sourcePages.delete(index);
    else state.compose.sourcePages.add(index);
    refreshComposeSourceSelection();
    updateCompose();
  });

  $("#composeSelectAllBtn").addEventListener("click", () => {
    const source = state.compose.source;
    if (!source) return;
    state.compose.sourcePages = new Set(source.pages.map((page) => page.index));
    refreshComposeSourceSelection();
    updateCompose();
  });
  $("#composeClearBtn").addEventListener("click", () => {
    state.compose.sourcePages.clear();
    refreshComposeSourceSelection();
    updateCompose();
  });
  $("#composeRangeApplyBtn").addEventListener("click", applyComposeRange);
  el.composeRange.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyComposeRange();
    }
  });

  el.composeTargetStart.addEventListener("input", updateCompose);
  el.composeTargetEnd.addEventListener("input", updateCompose);
  el.composeTargetStart.addEventListener("change", () => normalizeComposeTargetRange("start"));
  el.composeTargetEnd.addEventListener("change", () => normalizeComposeTargetRange("end"));
  el.composeInsertPage.addEventListener("input", updateCompose);
  el.composeInsertPage.addEventListener("change", () => {
    const target = state.compose.target;
    if (!target) return;
    el.composeInsertPage.value = String(clamp(Number.parseInt(el.composeInsertPage.value, 10) || 1, 1, target.page_count));
    updateCompose();
  });
  el.composeInsertPosition.addEventListener("change", updateCompose);
  el.composeName.addEventListener("input", () => {
    state.compose.nameAuto = false;
  });
  el.composeExportBtn.addEventListener("click", exportCompose);
  $("#composeDownloadBtn").addEventListener("click", () => {
    if (state.compose.result) downloadResult(state.compose.result);
  });
  $("#composeContinueBtn").addEventListener("click", () => {
    if (!state.compose.result?.doc) return;
    loadOrganizeDoc(state.compose.result.doc);
    switchTool("organize");
    toast("已打开合成结果", { detail: "可以继续拖动页面或删除页面。" });
  });

  setComposeMode("replace");

  // ---------------------------------------------------------------------
  // 拆分 PDF
  // ---------------------------------------------------------------------
  async function importSplitFile(file) {
    showBusy("正在读取 PDF…", "马上就好");
    try {
      const doc = await uploadFile(file);
      if (doc.kind !== "pdf") throw new Error("这个文件不是 PDF。");
      loadSplitDoc(doc);
      toast("PDF 已打开", { detail: `${doc.page_count} 页，接下来选择拆分方式。` });
    } catch (error) {
      toast("打开失败", { detail: error.message, type: "error", duration: 6500 });
    } finally {
      hideBusy();
    }
  }

  function loadSplitDoc(doc) {
    state.split.doc = doc;
    state.split.result = null;
    el.splitEmpty.hidden = true;
    el.splitWorkspace.hidden = false;
    el.splitResult.hidden = true;
    el.splitDocName.textContent = doc.name;
    el.splitDocMeta.textContent = `${doc.page_count} 页 · ${doc.size_text}`;
    el.splitFactPages.textContent = doc.page_count;
    el.splitFactSize.textContent = doc.size_text;
    el.splitName.value = outputStem(doc.name, "-拆分");
    el.splitRanges.value = "";
    el.splitRanges.placeholder = rangeExample(doc.page_count);
    el.splitEvery.value = String(Math.min(10, doc.page_count));
    el.splitEvery.max = String(doc.page_count);
    el.splitSingleHint.textContent = doc.page_count > 500
      ? `文档有 ${doc.page_count} 页，逐页拆分最多生成 500 个文件，请改用按范围拆分。`
      : `将生成 ${doc.page_count} 个 PDF，打包为一个 ZIP。`;
    setSplitMode("ranges");
    setCover(el.splitCover, thumbUrl(doc.id, 0, 720));
    renderMiniPages(el.splitMiniPages, doc, 5);
  }

  function setCover(img, src) {
    if (!img) return;
    img.classList.remove("is-loaded");
    img.src = src;
    markImageLoaded(img);
  }

  function renderMiniPages(container, doc, limit = 5) {
    const count = Math.min(doc.page_count, limit);
    const items = [];
    for (let index = 0; index < count; index += 1) {
      items.push(`
        <div class="mini-page">
          <img src="${thumbUrl(doc.id, index, 120)}" alt="第 ${index + 1} 页" loading="lazy">
          <span>${index + 1}</span>
        </div>
      `);
    }
    if (doc.page_count > limit) {
      items.push(`<div class="mini-page more">+${doc.page_count - limit}</div>`);
    }
    container.innerHTML = items.join("");
    $$("img", container).forEach((img) => {
      img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
    });
  }

  function setSplitMode(mode) {
    state.split.mode = mode;
    $$('input[name="splitMode"]').forEach((input) => {
      input.checked = input.value === mode;
      input.closest(".mode-option")?.classList.toggle("is-selected", input.value === mode);
    });
    el.splitRangePanel.hidden = mode !== "ranges";
    el.splitEveryPanel.hidden = mode !== "every";
    el.splitSinglePanel.hidden = mode !== "single";
  }

  $$('input[name="splitMode"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) setSplitMode(input.value);
    });
  });

  $("#splitEveryMinus").addEventListener("click", () => {
    const current = clamp(parseInt(el.splitEvery.value, 10) || 1, 1, state.split.doc?.page_count || 5000);
    el.splitEvery.value = String(Math.max(1, current - 1));
  });
  $("#splitEveryPlus").addEventListener("click", () => {
    const max = Math.max(1, state.split.doc?.page_count || 5000);
    const current = clamp(parseInt(el.splitEvery.value, 10) || 1, 1, max);
    el.splitEvery.value = String(Math.min(max, current + 1));
  });
  el.splitEvery.addEventListener("change", () => {
    const max = Math.max(1, state.split.doc?.page_count || 5000);
    el.splitEvery.value = String(clamp(parseInt(el.splitEvery.value, 10) || 1, 1, max));
  });

  el.splitExportBtn.addEventListener("click", async () => {
    const doc = state.split.doc;
    if (!doc) return;
    if (state.split.mode === "ranges" && !el.splitRanges.value.trim()) {
      toast("先填写页码范围", { type: "error", detail: "例如：1-3, 5, 8-10" });
      el.splitRanges.focus();
      return;
    }
    if (state.split.mode === "every") {
      const every = parseInt(el.splitEvery.value, 10);
      if (!Number.isFinite(every) || every < 1) {
        toast("每份页数需要大于 0", { type: "error" });
        return;
      }
    }
    const modeLabels = { ranges: "按页码范围", every: "每 N 页一份", single: "每页单独拆开" };
    showBusy("正在拆分 PDF…", `方式：${modeLabels[state.split.mode]} · 原文件不会被修改`);
    try {
      const result = await apiPost("/api/split", {
        doc_id: doc.id,
        mode: state.split.mode,
        ranges: el.splitRanges.value.trim(),
        every: parseInt(el.splitEvery.value, 10),
        name: el.splitName.value.trim() || "拆分结果",
      });
      state.split.result = result;
      el.splitResult.hidden = false;
      el.splitResultTitle.textContent = `已生成 ${result.count} 个 PDF`;
      el.splitResultMeta.textContent = `已打包为 ZIP · ${result.size_text}，下载后解压即可使用。`;
      toast("拆分完成", { detail: `${result.count} 个 PDF · ${result.size_text}` });
      el.splitResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      toast("拆分失败", { detail: error.message, type: "error", duration: 6500 });
    } finally {
      hideBusy();
    }
  });

  $("#splitDownloadBtn").addEventListener("click", () => {
    if (state.split.result) downloadResult(state.split.result);
  });

  // ---------------------------------------------------------------------
  // 图片转 PDF
  // ---------------------------------------------------------------------
  async function addImageFiles(files) {
    const images = files.filter(isImage);
    if (!images.length) {
      toast("请选择图片文件", { type: "error" });
      return;
    }
    if (state.images.items.length + images.length > 500) {
      toast("一次最多放入 500 张图片", { type: "error" });
      return;
    }
    state.images.result = null;
    el.imagesResult.hidden = true;
    let added = 0;
    const errors = [];
    showBusy("正在读取图片…", `0 / ${images.length}`);
    try {
      for (let index = 0; index < images.length; index += 1) {
        updateBusy("正在读取图片…", `${index + 1} / ${images.length} · ${images[index].name}`);
        try {
          const doc = await uploadFile(images[index]);
          if (doc.kind !== "image") throw new Error("不是受支持的图片。");
          state.images.items.push(doc);
          added += 1;
        } catch (error) {
          errors.push(`${images[index].name}：${error.message}`);
        }
      }
      if (added > 0) {
        el.imagesEmpty.hidden = true;
        el.imagesWorkspace.hidden = false;
        if (!el.imagesName.value.trim()) {
          el.imagesName.value = state.images.items.length === 1
            ? outputStem(state.images.items[0].name, "-转PDF")
            : outputStem(state.images.items[0].name, "-图片合集");
        }
        renderImages();
        toast(`已添加 ${added} 张图片`, {
          detail: state.images.items.length > 1 ? "可以拖动图片调整页面顺序。" : "",
        });
      }
      if (errors.length) {
        toast("部分图片没有添加", {
          detail: errors.slice(0, 2).join("；") + (errors.length > 2 ? `；还有 ${errors.length - 2} 张` : ""),
          type: "error",
          duration: 7000,
        });
      }
    } finally {
      hideBusy();
    }
  }

  function renderImages() {
    const items = state.images.items;
    if (!items.length) {
      el.imagesEmpty.hidden = false;
      el.imagesWorkspace.hidden = true;
      return;
    }
    el.imagesEmpty.hidden = true;
    el.imagesWorkspace.hidden = false;
    el.imagesSummary.textContent = `${items.length} 张图片 · 将生成 ${items.length} 页`;
    el.imagesSaveMeta.textContent = `共 ${items.length} 页`;
    el.imagesExportBtn.disabled = items.length === 0;
    el.imageGrid.innerHTML = items.map((doc, index) => `
      <article class="image-card" draggable="true" data-id="${esc(doc.id)}">
        <div class="image-card-media">
          <img src="${thumbUrl(doc.id, 0, 480)}" alt="${esc(doc.name)}" loading="lazy" draggable="false">
          <span class="image-index">${String(index + 1).padStart(2, "0")}</span>
          <div class="image-card-actions">
            <button class="card-icon-btn" type="button" data-act="preview" title="预览" aria-label="预览 ${esc(doc.name)}">
              <svg class="icon"><use href="#i-eye"></use></svg>
            </button>
            <button class="card-icon-btn is-danger" type="button" data-act="remove" title="移除" aria-label="移除 ${esc(doc.name)}">
              <svg class="icon"><use href="#i-close"></use></svg>
            </button>
          </div>
        </div>
        <div class="image-name" title="${esc(doc.name)}">${esc(doc.name)}</div>
      </article>
    `).join("");
    $$(".image-card-media img", el.imageGrid).forEach(markImageLoaded);
  }

  el.imageGrid.addEventListener("click", (event) => {
    const card = event.target.closest(".image-card");
    if (!card) return;
    const action = event.target.closest("[data-act]")?.dataset.act;
    if (!action) return;
    const index = state.images.items.findIndex((doc) => doc.id === card.dataset.id);
    if (index < 0) return;
    if (action === "preview") {
      openImagePreview(index);
      return;
    }
    if (action === "remove") {
      const [removed] = state.images.items.splice(index, 1);
      state.images.result = null;
      el.imagesResult.hidden = true;
      if (!state.images.items.length) {
        el.imageGrid.innerHTML = "";
        el.imagesName.value = "";
        el.imagesSaveMeta.textContent = "";
        renderImages();
      } else {
        renderImages();
      }
      toast(`已移除「${removed.name}」`, {
        actionLabel: "撤销",
        action: () => {
          state.images.items.splice(index, 0, removed);
          renderImages();
        },
      });
    }
  });

  $("#imagesSortBtn").addEventListener("click", () => {
    if (state.images.items.length < 2) return;
    const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
    state.images.items.sort((a, b) => collator.compare(a.name, b.name));
    renderImages();
    toast("已按文件名排序");
  });

  function syncImageOptions() {
    const pageSize = getChecked("pageSize", "a4");
    const auto = pageSize === "auto";
    el.orientationGroup.classList.toggle("is-disabled", auto);
    $$('input[name="orientation"]', el.orientationGroup).forEach((input) => {
      input.disabled = auto;
    });
    el.pageSizeHint.textContent = auto
      ? "页面比例跟随图片，长边约为一页 A4，适合截图和长图。"
      : pageSize === "letter"
        ? "Letter 竖版，适合在北美地区打印。"
        : "A4 竖版，适合大多数打印和分享场景。";
  }

  $$('input[name="pageSize"]').forEach((input) => input.addEventListener("change", syncImageOptions));
  syncImageOptions();

  el.imagesExportBtn.addEventListener("click", async () => {
    if (!state.images.items.length) return;
    const pageSize = getChecked("pageSize", "a4");
    const orientation = pageSize === "auto" ? "auto" : getChecked("orientation", "auto");
    showBusy("正在生成 PDF…", `${state.images.items.length} 张图片 · 会完整显示，不裁切`);
    try {
      const result = await apiPost("/api/images-to-pdf", {
        image_ids: state.images.items.map((doc) => doc.id),
        page_size: pageSize,
        orientation,
        margin: Number(getChecked("margin", "18")),
        name: el.imagesName.value.trim() || "图片合集",
      });
      state.images.result = result;
      el.imagesResult.hidden = false;
      el.imagesResultTitle.textContent = `PDF 已生成 · ${result.page_count} 页`;
      el.imagesResultMeta.textContent = `${result.filename} · ${result.size_text}`;
      toast("图片已转换为 PDF", { detail: `${result.page_count} 页 · ${result.size_text}` });
      el.imagesResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      toast("生成失败", { detail: error.message, type: "error", duration: 6500 });
    } finally {
      hideBusy();
    }
  });

  $("#imagesDownloadBtn").addEventListener("click", () => {
    if (state.images.result) downloadResult(state.images.result);
  });

  el.imageGrid.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".image-card");
    if (!card) return;
    state.isInternalDrag = true;
    state.images.draggingId = card.dataset.id;
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.dataset.id);
  });

  el.imageGrid.addEventListener("dragover", (event) => {
    if (!state.images.draggingId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    clearDropHints(el.imageGrid);
    const card = event.target.closest(".image-card");
    if (!card || card.dataset.id === state.images.draggingId) {
      state.images.dropId = null;
      return;
    }
    const rect = card.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    card.classList.add(after ? "drop-after" : "drop-before");
    state.images.dropId = card.dataset.id;
    state.images.dropAfter = after;
  });

  el.imageGrid.addEventListener("drop", (event) => {
    if (!state.images.draggingId) return;
    event.preventDefault();
    event.stopPropagation();
    const fromId = state.images.draggingId;
    const targetId = state.images.dropId;
    const after = state.images.dropAfter;
    cleanupImageDrag();
    if (!targetId || fromId === targetId) return;
    const fromIndex = state.images.items.findIndex((doc) => doc.id === fromId);
    const target = state.images.items.find((doc) => doc.id === targetId);
    if (fromIndex < 0 || !target) return;
    const [moved] = state.images.items.splice(fromIndex, 1);
    const targetIndex = state.images.items.indexOf(target);
    state.images.items.splice(targetIndex + (after ? 1 : 0), 0, moved);
    state.images.result = null;
    el.imagesResult.hidden = true;
    renderImages();
  });

  el.imageGrid.addEventListener("dragend", cleanupImageDrag);
  function cleanupImageDrag() {
    state.images.draggingId = null;
    state.images.dropId = null;
    state.isInternalDrag = false;
    clearDropHints(el.imageGrid);
    $$(".image-card.is-dragging", el.imageGrid).forEach((card) => card.classList.remove("is-dragging"));
  }

  // ---------------------------------------------------------------------
  // PDF 转图片
  // ---------------------------------------------------------------------
  async function importPdf2imgFile(file) {
    showBusy("正在读取 PDF…", "马上就好");
    try {
      const doc = await uploadFile(file);
      if (doc.kind !== "pdf") throw new Error("这个文件不是 PDF。");
      loadPdf2imgDoc(doc);
      toast("PDF 已打开", { detail: `${doc.page_count} 页，选择格式和分辨率即可导出。` });
    } catch (error) {
      toast("打开失败", { detail: error.message, type: "error", duration: 6500 });
    } finally {
      hideBusy();
    }
  }

  function loadPdf2imgDoc(doc) {
    state.pdf2img.doc = doc;
    state.pdf2img.result = null;
    el.pdf2imgEmpty.hidden = true;
    el.pdf2imgWorkspace.hidden = false;
    el.pdf2imgResult.hidden = true;
    el.pdf2imgDocName.textContent = doc.name;
    el.pdf2imgDocMeta.textContent = `${doc.page_count} 页 · ${doc.size_text}`;
    el.pdf2imgFactPages.textContent = doc.page_count;
    el.pdf2imgFactSize.textContent = doc.size_text;
    el.pdf2imgName.value = outputStem(doc.name, "-图片");
    el.pdf2imgRange.value = "";
    el.pdf2imgRange.placeholder = rangeExample(doc.page_count);
    setPdf2imgRangeMode("all");
    setCover(el.pdf2imgCover, thumbUrl(doc.id, 0, 720));
    renderMiniPages(el.pdf2imgMiniPages, doc, 5);
    updateDpiHint();
  }

  function setPdf2imgRangeMode(mode) {
    $$('input[name="pdf2imgRangeMode"]').forEach((input) => {
      input.checked = input.value === mode;
    });
    const custom = mode === "custom";
    el.pdf2imgRange.hidden = !custom;
    el.pdf2imgRangeHint.textContent = custom
      ? "用逗号分隔范围，例如 1-3, 5。重复页面只会导出一次。"
      : "将导出文档中的全部页面。";
    if (custom) window.setTimeout(() => el.pdf2imgRange.focus(), 20);
  }

  $$('input[name="pdf2imgRangeMode"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) setPdf2imgRangeMode(input.value);
    });
  });

  const DPI_HINTS = {
    "96": "96 DPI · 体积小，适合网页预览。",
    "150": "150 DPI · 适合屏幕查看和日常分享。",
    "200": "200 DPI · 适合演示和轻度打印。",
    "300": "300 DPI · 适合打印和存档，文件会比较大。",
  };
  function updateDpiHint() {
    el.dpiHint.textContent = DPI_HINTS[getChecked("dpi", "150")] || DPI_HINTS["150"];
  }
  $$('input[name="dpi"]').forEach((input) => input.addEventListener("change", updateDpiHint));

  el.pdf2imgExportBtn.addEventListener("click", async () => {
    const doc = state.pdf2img.doc;
    if (!doc) return;
    const rangeMode = getChecked("pdf2imgRangeMode", "all");
    if (rangeMode === "custom" && !el.pdf2imgRange.value.trim()) {
      toast("请填写要导出的页码", { type: "error", detail: "或者切换回「全部页面」。" });
      el.pdf2imgRange.focus();
      return;
    }
    showBusy("正在转换页面…", `${getChecked("dpi", "150")} DPI · 页数较多时需要一点时间`);
    try {
      const result = await apiPost("/api/pdf-to-images", {
        doc_id: doc.id,
        format: getChecked("imageFormat", "png"),
        dpi: Number(getChecked("dpi", "150")),
        range: rangeMode === "all" ? "all" : el.pdf2imgRange.value.trim(),
        name: el.pdf2imgName.value.trim() || "页面图片",
      });
      state.pdf2img.result = result;
      el.pdf2imgResult.hidden = false;
      el.pdf2imgResultTitle.textContent = `转换完成 · ${result.count} 张图片`;
      el.pdf2imgResultMeta.textContent = `${result.format} · ${result.dpi} DPI · ${result.size_text}，已打包为 ZIP。`;
      toast("图片已导出", { detail: `${result.count} 张 ${result.format} · ${result.size_text}` });
      el.pdf2imgResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      toast("转换失败", { detail: error.message, type: "error", duration: 6500 });
    } finally {
      hideBusy();
    }
  });

  $("#pdf2imgDownloadBtn").addEventListener("click", () => {
    if (state.pdf2img.result) downloadResult(state.pdf2img.result);
  });

  // ---------------------------------------------------------------------
  // 预览
  // ---------------------------------------------------------------------
  function openImagePreview(startIndex) {
    const items = state.images.items.map((doc) => ({
      docId: doc.id,
      page: 0,
      label: doc.name,
    }));
    if (!items.length) return;
    openPreview(items, clamp(startIndex, 0, items.length - 1), "图片预览");
  }

  function openPreview(items, startIndex, title) {
    if (!items.length) return;
    let current = clamp(startIndex, 0, items.length - 1);
    openModal(`
      <div class="preview-shell">
        <div class="preview-canvas">
          <img id="previewImage" alt="预览图">
        </div>
        <div class="preview-bar">
          <div class="preview-title">
            <strong id="previewTitle"></strong>
            <span id="previewLabel"></span>
          </div>
          <div class="preview-nav">
            <button class="icon-button" type="button" id="previewPrev" aria-label="上一页">
              <svg class="icon"><use href="#i-chevron-left"></use></svg>
            </button>
            <span class="page-indicator" id="previewCounter"></span>
            <button class="icon-button" type="button" id="previewNext" aria-label="下一页">
              <svg class="icon"><use href="#i-chevron-right"></use></svg>
            </button>
          </div>
        </div>
      </div>
    `, { wide: true });

    const image = $("#previewImage");
    const titleNode = $("#previewTitle");
    const labelNode = $("#previewLabel");
    const counter = $("#previewCounter");
    const prev = $("#previewPrev");
    const next = $("#previewNext");

    const show = (index) => {
      current = clamp(index, 0, items.length - 1);
      const item = items[current];
      image.classList.remove("is-loaded");
      image.src = thumbUrl(item.docId, item.page, 1500);
      markImageLoaded(image);
      titleNode.textContent = title;
      labelNode.textContent = item.label;
      counter.textContent = `${current + 1} / ${items.length}`;
      prev.disabled = current === 0;
      next.disabled = current === items.length - 1;
    };
    prev.addEventListener("click", () => show(current - 1));
    next.addEventListener("click", () => show(current + 1));
    previewKeyHandler = (event) => {
      if (el.modalLayer.hidden) {
        clearPreviewKeys();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        show(current - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        show(current + 1);
      }
    };
    document.addEventListener("keydown", previewKeyHandler);
    show(startIndex);
  }

  // ---------------------------------------------------------------------
  // 清理与快捷键
  // ---------------------------------------------------------------------
  function clearDropHints(container) {
    $$(".drop-before, .drop-after", container).forEach((node) => {
      node.classList.remove("drop-before", "drop-after");
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!el.modalLayer.hidden || !el.busyLayer.hidden) return;
    const tag = event.target?.tagName?.toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable;
    if (typing) return;

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
      if (state.activeTool === "organize" && state.organize.history.length) {
        event.preventDefault();
        undoOrganize();
      }
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (state.activeTool === "organize" && state.organize.selected.size) {
        event.preventDefault();
        deleteOrganizePages("target", Array.from(state.organize.selected));
      } else if (state.activeTool === "organize" && state.organize.sourceSelected.size) {
        event.preventDefault();
        deleteOrganizePages("source", Array.from(state.organize.sourceSelected));
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const shortcuts = { "1": "organize", "2": "merge", "3": "split", "4": "images", "5": "pdf2img" };
    if (shortcuts[event.key]) switchTool(shortcuts[event.key]);
  });

  // 启动时显示默认工具
  switchTool("organize");
})();
