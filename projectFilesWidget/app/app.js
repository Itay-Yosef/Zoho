/* global ZOHO, zrc, ZDK */

let currentRecordId;
let currentEntity;
let currentFolderId;
let rootFolderId;
let workDriveZrc;

let breadcrumbStack = []; // [{id, name}]
let isUploading = false;

/* ===== Icons (ONLY local) ===== */
const ICON_BASE = "./file-icons/";
const ICONS = {
  audio: "mc-file-audio.svg",
  document: "mc-file-document.svg",
  font: "mc-file-font.svg",
  image: "mc-file-image.svg",
  pack: "mc-file-pack.svg",
  script: "mc-file-script.svg",
  spreadsheet: "mc-file-spreadsheet.svg",
  text: "mc-file-text.svg",
  unknown: "mc-file-unknown.svg",
  video: "mc-file-video.svg",
  pdf: "mc-file-pdf.svg",
  presentation: "mc-file-presentation.svg",
  folderEmpty: "folder-empty.svg",
  folderFull: "folder-full.svg",
  home: "home-icon.svg",
};

const EXT = {
  pdf: new Set(["pdf"]),
  presentation: new Set(["ppt", "pptx", "pps", "ppsx", "odp", "key"]),
  font: new Set(["ttf", "otf", "woff", "woff2", "eot"]),
  script: new Set([
    "js",
    "ts",
    "jsx",
    "tsx",
    "py",
    "cs",
    "cpp",
    "c",
    "h",
    "java",
    "go",
    "rs",
    "php",
    "rb",
    "swift",
    "kt",
    "html",
    "css",
    "scss",
    "less",
    "sql",
    "xml",
    "json",
    "yml",
    "yaml",
    "toml",
    "ini",
    "sh",
    "bat",
    "ps1",
  ]),
  audio: new Set(["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus"]),
  video: new Set(["mp4", "mov", "avi", "mkv", "webm", "m4v", "3gp"]),
  image: new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "svg",
    "webp",
    "bmp",
    "tif",
    "tiff",
    "heic",
  ]),
  pack: new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "iso"]),
  spreadsheet: new Set(["xls", "xlsx", "xlsm", "csv", "tsv", "ods"]),
  document: new Set(["doc", "docx", "rtf"]),
  text: new Set(["txt", "md", "log"]),
};

function getExt(name) {
  if (!name) return "";
  const clean = String(name).split("?")[0].split("#")[0];
  const i = clean.lastIndexOf(".");
  if (i === -1) return "";
  return clean.slice(i + 1).toLowerCase();
}

function stripExt(name) {
  if (!name) return "";
  const s = String(name);
  const i = s.lastIndexOf(".");
  if (i === -1) return s;
  return s.slice(0, i);
}

function pickIconByExt(ext) {
  if (EXT.pdf.has(ext)) return ICONS.pdf;
  if (EXT.presentation.has(ext)) return ICONS.presentation;
  if (EXT.font.has(ext)) return ICONS.font;
  if (EXT.script.has(ext)) return ICONS.script;
  if (EXT.audio.has(ext)) return ICONS.audio;
  if (EXT.video.has(ext)) return ICONS.video;
  if (EXT.image.has(ext)) return ICONS.image;
  if (EXT.pack.has(ext)) return ICONS.pack;
  if (EXT.spreadsheet.has(ext)) return ICONS.spreadsheet;
  if (EXT.document.has(ext)) return ICONS.document;
  if (EXT.text.has(ext)) return ICONS.text;
  return ICONS.unknown;
}

function folderIsEmptyFromAttributes(attrs) {
  const si = (attrs && attrs.storage_info) || {};
  const filesCount = Number(si.files_count ?? si.file_count ?? 0);
  const foldersCount = Number(si.folders_count ?? si.folder_count ?? 0);
  const isEmptyFlag = attrs?.is_empty === true || attrs?.isEmpty === true;

  if (isEmptyFlag) return true;
  if (!Number.isNaN(filesCount) || !Number.isNaN(foldersCount)) {
    return filesCount + foldersCount === 0;
  }
  return false;
}

function iconHTMLForItem(item) {
  const attrs = item?.attributes || {};
  const type = String(attrs.type || "").toLowerCase();
  const isFolder = attrs.is_folder === true || type === "folder";

  if (isFolder) {
    const empty = folderIsEmptyFromAttributes(attrs);
    const src = ICON_BASE + (empty ? ICONS.folderEmpty : ICONS.folderFull);
    return `<img class="file-icon-img" src="${src}" alt="" onerror="this.remove()" />`;
  }

  const name = attrs.name || "";
  const ext = getExt(name);
  const src = ICON_BASE + pickIconByExt(ext);
  return `<img class="file-icon-img" src="${src}" alt="" onerror="this.remove()" />`;
}

/* ===== Date: dd/mm/yyyy HH:MM ===== */
function formatILDateFromWorkDrive(attrs) {
  const ms =
    attrs?.modified_time_in_millisecond ??
    attrs?.modified_time_in_millis ??
    null;
  const raw = attrs?.modified_time ?? null;

  let d = null;
  if (ms !== null && ms !== undefined && ms !== "") {
    const n = Number(ms);
    if (!Number.isNaN(n)) d = new Date(n);
  }
  if (!d && raw) {
    const tmp = new Date(raw);
    if (!Number.isNaN(tmp.getTime())) d = tmp;
  }
  if (!d) return "";

  const pad = (x) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/* =========================================================
   ✅ Zoho CRM Built-in Toast (ZDK.Client.showMessage)
   ========================================================= */
function showZohoToast(text, type /* 'success'|'error'|'warning'|'info' */) {
  try {
    if (window.ZDK?.Client?.showMessage) {
      // ZDK.Client.showMessage(message, { type })
      // (Returns a Promise; no need to await here)
      ZDK.Client.showMessage(String(text), { type: type || "info" });
      return true;
    }
  } catch (e) {
    console.warn("ZDK.Client.showMessage failed:", e);
  }
  return false;
}

/* fallback message bar (רק אם אין ZDK) */
function showFallbackMessage(text, isError = false) {
  const el = document.getElementById("message");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", !!isError);
  el.style.display = "block";
  clearTimeout(showFallbackMessage._t);
  showFallbackMessage._t = setTimeout(() => (el.style.display = "none"), 3000);
}

/* wrapper אחד לכל הפרויקט */
function showMessage(text, isError = false) {
  const type = isError ? "error" : "success";

  // Try Zoho CRM built-in toast first
  const usedToast = showZohoToast(text, type);
  if (usedToast) return;

  // fallback (אם רץ מחוץ ל-CRM / בלי ZDK)
  showFallbackMessage(text, isError);
}

/* ===== UI helpers ===== */
function showEmptyState(text, isError = false) {
  const empty = document.getElementById("empty-state");
  const body = document.getElementById("file-listing-body");
  if (!empty || !body) return;
  body.innerHTML = "";
  empty.textContent = text;
  empty.classList.toggle("error", !!isError);
  empty.style.display = "block";
}

function hideEmptyState() {
  const empty = document.getElementById("empty-state");
  if (!empty) return;
  empty.classList.remove("error");
  empty.style.display = "none";
  empty.textContent = "";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function safeParseZrcData(resp) {
  if (!resp) return null;
  if (typeof resp.data === "string") {
    try {
      return JSON.parse(resp.data);
    } catch {
      return null;
    }
  }
  return resp.data;
}

/* ===== Skeleton Loading ===== */
function renderSkeletonRows(count = 7) {
  const tbody = document.getElementById("file-listing-body");
  if (!tbody) return;

  hideEmptyState();

  let html = "";
  for (let i = 0; i < count; i++) {
    html += `
      <tr>
        <td>
          <div class="skel-name-wrap">
            <span class="file-icon"><div class="skel skel-icon"></div></span>
            <div class="skel skel-name"></div>
          </div>
        </td>
        <td><div class="skel skel-type"></div></td>
        <td><div class="skel skel-date"></div></td>
      </tr>
    `;
  }
  tbody.innerHTML = html;
}

/* ===== Breadcrumbs (Root is ICON) ===== */
function renderBreadcrumbs() {
  const wrap = document.getElementById("breadcrumbs");
  if (!wrap) return;

  wrap.innerHTML = "";

  const atRoot = breadcrumbStack.length <= 1;

  const rootCrumb = document.createElement("span");
  rootCrumb.className = `crumb root${atRoot ? " current" : ""}`;
  rootCrumb.title = "תיקייה ראשית";
  rootCrumb.innerHTML = `<img class="root-folder-icon" src="${
    ICON_BASE + ICONS.home
  }" alt="תיקייה" onerror="this.remove()" />`;

  if (!atRoot) {
    rootCrumb.onclick = async () => {
      breadcrumbStack = [{ id: rootFolderId, name: "root" }];
      renderBreadcrumbs();
      await loadFolder(rootFolderId, false);
    };
  }
  wrap.appendChild(rootCrumb);

  for (let i = 1; i < breadcrumbStack.length; i++) {
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "›";
    wrap.appendChild(sep);

    const c = breadcrumbStack[i];
    const isCurrent = i === breadcrumbStack.length - 1;

    const crumb = document.createElement("span");
    crumb.className = `crumb${isCurrent ? " current" : ""}`;
    crumb.textContent = c.name || "תיקייה";
    crumb.title = c.name || "";

    if (!isCurrent) {
      crumb.onclick = async () => {
        breadcrumbStack = breadcrumbStack.slice(0, i + 1);
        renderBreadcrumbs();
        await loadFolder(c.id, false);
      };
    }

    wrap.appendChild(crumb);
  }
}

async function navigateToFolder(folderId) {
  renderBreadcrumbs();
  await loadFolder(folderId, false);
}

/* ===== WorkDrive API ===== */
async function getItemInfo(itemId) {
  const resp = await workDriveZrc.get(`/files/${itemId}`, {
    headers: { Accept: "application/vnd.api+json" },
  });
  const data = await safeParseZrcData(resp);
  return data?.data || null;
}

async function listFolderItems(folderId) {
  const resp = await workDriveZrc.get(`/files/${folderId}/files`, {
    headers: { Accept: "application/vnd.api+json" },
  });
  const data = await safeParseZrcData(resp);
  return Array.isArray(data?.data) ? data.data : [];
}

/* ===== Render table ===== */
function renderTable(items) {
  const tbody = document.getElementById("file-listing-body");
  if (!tbody) return;

  hideEmptyState();
  tbody.innerHTML = "";

  if (!items || items.length === 0) {
    showEmptyState("אין קבצים בתיקייה הזאת");
    return;
  }

  // folders first
  const sorted = [...items].sort((a, b) => {
    const af =
      a?.attributes?.is_folder === true ||
      String(a?.attributes?.type || "").toLowerCase() === "folder";
    const bf =
      b?.attributes?.is_folder === true ||
      String(b?.attributes?.type || "").toLowerCase() === "folder";
    if (af !== bf) return af ? -1 : 1;
    return (a?.attributes?.name || "").localeCompare(
      b?.attributes?.name || "",
      "he",
    );
  });

  sorted.forEach((item) => {
    const attrs = item.attributes || {};
    const type = String(attrs.type || "").toLowerCase();
    const isFolder = attrs.is_folder === true || type === "folder";

    const fullName = attrs.name || "";
    const displayName = isFolder ? fullName : stripExt(fullName);

    const extOrType = isFolder
      ? "תיקייה"
      : attrs.extn || getExt(fullName) || type || "";

    const mod = formatILDateFromWorkDrive(attrs);

    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    const nameDiv = document.createElement("div");
    nameDiv.className = "file-name";
    nameDiv.innerHTML = `
      <span class="file-icon">${iconHTMLForItem(item)}</span>
      <span class="file-text">${escapeHtml(displayName)}</span>
    `;
    nameDiv.onclick = () => onItemClick(item);
    tdName.appendChild(nameDiv);

    const tdType = document.createElement("td");
    tdType.textContent = extOrType;

    const tdMod = document.createElement("td");
    tdMod.textContent = mod;

    tr.appendChild(tdName);
    tr.appendChild(tdType);
    tr.appendChild(tdMod);

    tbody.appendChild(tr);
  });
}

async function onItemClick(item) {
  const attrs = item?.attributes || {};
  const type = String(attrs.type || "").toLowerCase();
  const isFolder = attrs.is_folder === true || type === "folder";

  if (isFolder) {
    breadcrumbStack.push({ id: item.id, name: attrs.name || "תיקייה" });
    await navigateToFolder(item.id);
    return;
  }

  const permalink = attrs.permalink;
  if (permalink) window.open(permalink, "_blank");
}

/* ===== Folder loading ===== */
async function loadFolder(folderId, isRoot) {
  currentFolderId = folderId;

  // show skeleton immediately
  renderSkeletonRows(7);

  try {
    const items = await listFolderItems(folderId);

    if (isRoot && breadcrumbStack.length === 0) {
      const info = await getItemInfo(folderId);
      breadcrumbStack = [
        { id: folderId, name: info?.attributes?.name || "תיקייה" },
      ];
    }

    renderBreadcrumbs();
    renderTable(items);
  } catch (e) {
    console.error(e);
    showEmptyState("שגיאה בטעינת התיקייה");
    showMessage("משהו השתבש בטעינה", true);
  }
}

/* ===== Upload UI ===== */
function wireUploadUI() {
  const btnFiles = document.getElementById("btn-upload-files");
  const inputFiles = document.getElementById("file-upload");

  if (btnFiles && inputFiles) {
    btnFiles.addEventListener("click", () => inputFiles.click());
    inputFiles.addEventListener("change", async () => {
      await uploadFiles(inputFiles.files);
      inputFiles.value = "";
    });
  }
}

/* ===== Upload (LIKE HIS WORKING LOGIC) ===== */
async function uploadFiles(fileList) {
  if (isUploading) return;
  if (!fileList || fileList.length === 0) return;

  isUploading = true;

  try {
    const files = Array.from(fileList);
    let successCount = 0;
    let failCount = 0;

    for (const f of files) {
      const ok = await uploadSingleFileToWorkDrive_likeHis(f, currentFolderId);
      if (ok) successCount++;
      else failCount++;
    }

    if (successCount > 0)
      showMessage(`הועלו ${successCount} קבצים בהצלחה`, false);
    if (failCount > 0) showMessage(`${failCount} קבצים נכשלו`, true);

    await loadFolder(currentFolderId, false);
  } catch (e) {
    console.error(e);
    showMessage("העלאה נכשלה", true);
  } finally {
    isUploading = false;
  }
}

async function uploadSingleFileToWorkDrive_likeHis(file, folderId) {
  const fileName = file?.name || "file";

  // same filename validation as his code
  const format = /[`^+\=\[\]{};"\\<>\/]/;
  if (format.test(fileName)) {
    console.error("Invalid file name:", fileName);
    return false;
  }

  try {
    // EXACTLY like his upload: Blob + multipart header + formdata content=blob
    const fileBlob = new Blob([file], {
      type: file?.type || "application/octet-stream",
    });

    const formData = new FormData();
    formData.append("filename", fileName);
    formData.append("parent_id", String(folderId).trim());
    formData.append("content", fileBlob);

    const uploadResponse = await workDriveZrc.post("/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    const parsed = await safeParseZrcData(uploadResponse);

    const ok =
      uploadResponse?.status === 200 ||
      uploadResponse?.status === 201 ||
      uploadResponse?.code === "SUCCESS" ||
      parsed?.code === "SUCCESS" ||
      !!parsed?.data;

    if (!ok) console.warn("Upload failed response:", uploadResponse, parsed);

    return !!ok;
  } catch (error) {
    console.error("Error uploading file:", fileName, error);
    return false;
  }
}

/* ===== Detect correct Zoho API domain (DC) ===== */
function getZohoApiDomainFromHost() {
  const host = String(window.location.hostname || "").toLowerCase();

  const map = [
    [".zoho.eu", "https://www.zohoapis.eu"],
    [".zoho.in", "https://www.zohoapis.in"],
    [".zoho.com.au", "https://www.zohoapis.com.au"],
    [".zoho.jp", "https://www.zohoapis.jp"],
    [".zohocloud.ca", "https://www.zohoapis.ca"],
    [".zoho.com.cn", "https://www.zohoapis.com.cn"],
    [".zoho.sa", "https://www.zohoapis.sa"],
    [".zoho.com", "https://www.zohoapis.com"],
  ];

  for (const [suffix, api] of map) {
    if (host.endsWith(suffix)) return api;
  }
  return "https://www.zohoapis.com";
}

function resolveRecordIdFromPageLoad(data) {
  if (!data) return null;

  const candidates = [];

  const entityId = data.EntityId;
  if (Array.isArray(entityId) && entityId.length > 0) {
    candidates.push(entityId[0]);
  } else if (entityId !== undefined && entityId !== null) {
    candidates.push(entityId);
  }

  if (data.recordId !== undefined && data.recordId !== null) {
    candidates.push(data.recordId);
  }

  const found = candidates.find((v) => {
    const s = String(v ?? "").trim();
    return !!s;
  });

  return found ? String(found).trim() : null;
}

function resolveEntityFromPageLoad(data) {
  if (!data) return null;
  const raw = data.Entity ?? data.entity ?? null;

  if (Array.isArray(raw)) {
    for (const v of raw) {
      const s = String(v ?? "").trim();
      if (s) return s;
    }
    return null;
  }

  const s = String(raw ?? "").trim();
  return s || null;
}

function showIdentifierError(text) {
  const msg =
    text ||
    "Unable to find the record identifier. Open the widget from a record in Zoho CRM.";
  showEmptyState(msg, true);
  showMessage(msg, true);
}

/* ===== Zoho init ===== */
ZOHO.embeddedApp.on("PageLoad", async function (data) {
  try {
    const apiDomain = getZohoApiDomainFromHost();

    workDriveZrc = zrc.createInstance({
      baseUrl: `${apiDomain}/workdrive/api/v1`,
      connection: "zohoworkdrive", // ⬅️ השארתי כמו אצלך
    });

    wireUploadUI();

    currentRecordId = resolveRecordIdFromPageLoad(data);
    currentEntity = resolveEntityFromPageLoad(data);

    if (!currentRecordId) {
      showIdentifierError(
        "Could not find the identifier of the current record. Please reopen the widget from a record page.",
      );
      return;
    }

    if (!currentEntity) {
      showIdentifierError(
        "Could not determine the module/entity for the current record.",
      );
      return;
    }

    const crmResp = await zrc.get(
      `/crm/v8/${currentEntity}/${currentRecordId}`,
    );
    const crmData = await safeParseZrcData(crmResp);
    const row = crmData?.data?.[0];

    if (!row) {
      showIdentifierError(
        "Record details could not be loaded for the provided identifier.",
      );
      return;
    }

    // ⬅️ השארתי כמו אצלך
    const folderId = row?.projectFolderId;
    if (!folderId) {
      showEmptyState("אין תיקיית WorkDrive מקושרת לרשומה הזאת");
      return;
    }

    rootFolderId = folderId;
    currentFolderId = folderId;

    await loadFolder(rootFolderId, true);
  } catch (e) {
    console.error("PageLoad error:", e);
    showEmptyState("שגיאה בטעינה");
    showMessage("שגיאה בהתחברות ל-Zoho/WorkDrive", true);
  }
});

ZOHO.embeddedApp.init();
