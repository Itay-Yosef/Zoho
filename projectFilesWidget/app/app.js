/* global ZOHO, zrc, ZDK */

let currentRecordId;
let currentEntity;
let currentFolderId;
let rootFolderId;
let workDriveZrc;

let breadcrumbStack = []; // [{id, name}]
let isUploading = false;

/** ===========================
 * ✅ התאמות אצלך
 * =========================== */
const CRM_FOLDER_FIELD = "projectFolderId"; // השדה ב-CRM שמכיל את ID התיקייה
const WORKDRIVE_CONNECTION = "zohoworkdrive"; // שם ה-Connection

const FUNC_LIST_API_NAME = "getprojectfiles"; // API NAME של פונקציית הרשימה
const FUNC_UPLOAD_API_NAME = "uploadprojectfiles"; // API NAME של פונקציית העלאה (חדשה)

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

function isProbablyMobile() {
  const ua = String(navigator.userAgent || "");
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

function withTimeout(promise, ms, msg) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(msg || "timeout")), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

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

function showFallbackMessage(text, isError = false) {
  const el = document.getElementById("message");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", !!isError);
  el.style.display = "block";
  clearTimeout(showFallbackMessage._t);
  showFallbackMessage._t = setTimeout(() => (el.style.display = "none"), 3000);
}

function showMessage(text, isError = false) {
  try {
    if (window.ZDK?.Client?.showMessage) {
      ZDK.Client.showMessage(String(text), {
        type: isError ? "error" : "success",
      });
      return;
    }
  } catch (e) {}
  showFallbackMessage(text, isError);
}

function showEmptyState(text) {
  const empty = document.getElementById("empty-state");
  const body = document.getElementById("file-listing-body");
  if (!empty || !body) return;
  body.innerHTML = "";
  empty.textContent = text;
  empty.style.display = "block";
}

function hideEmptyState() {
  const empty = document.getElementById("empty-state");
  if (!empty) return;
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
        <td data-label="שם">
          <div class="skel-name-wrap">
            <span class="file-icon"><div class="skel skel-icon"></div></span>
            <div class="skel skel-name"></div>
          </div>
        </td>
        <td data-label="סוג"><div class="skel skel-type"></div></td>
        <td data-label="עודכן"><div class="skel skel-date"></div></td>
      </tr>
    `;
  }
  tbody.innerHTML = html;
}

/* ===== Breadcrumbs ===== */
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
      breadcrumbStack = [
        { id: rootFolderId, name: breadcrumbStack[0]?.name || "תיקייה" },
      ];
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

/** ===========================
 * ✅ WorkDrive – 2 דרכים:
 * Desktop: ZRC
 * Mobile: פונקציות Deluge
 * =========================== */

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

function initWorkDriveZrcIfPossible() {
  // במובייל לא נשתמש בזה בכלל
  if (isProbablyMobile()) return;
  if (typeof zrc === "undefined" || !zrc?.createInstance) return;

  const apiDomain = getZohoApiDomainFromHost();
  workDriveZrc = zrc.createInstance({
    baseUrl: `${apiDomain}/workdrive/api/v1`,
    connection: WORKDRIVE_CONNECTION,
  });
}

function parseFunctionOutput(resp) {
  const outStr =
    resp?.details?.output ?? resp?.details?.Output ?? resp?.details ?? resp;
  const parsed = typeof outStr === "string" ? JSON.parse(outStr) : outStr;
  const body = parsed?.crmAPIResponse?.body ?? parsed?.body ?? parsed;
  return body;
}

/* ===== Mobile: list via function ===== */
async function executeFunctionListFiles(folderId) {
  const req_data = {
    arguments: JSON.stringify({ folder_id: String(folderId) }),
  };

  const resp = await withTimeout(
    ZOHO.CRM.FUNCTIONS.execute(FUNC_LIST_API_NAME, req_data),
    20000,
    "Function timeout",
  );

  const body = parseFunctionOutput(resp);

  if (!body || body.ok !== true) {
    throw new Error(body?.error || "function_failed");
  }

  return {
    folder: body.folder || null,
    items: Array.isArray(body.items) ? body.items : [],
  };
}

/* ===== Mobile: upload via function ===== */
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("file_read_failed"));
    r.onload = () => resolve(String(r.result || ""));
    r.readAsDataURL(file);
  });
}

async function executeFunctionUploadFile(folderId, file) {
  const fileName = file?.name || "file";
  const format = /[`^+\=\[\]{};"\\<>\/]/;
  if (format.test(fileName)) {
    showMessage(`שם קובץ לא נתמך: ${fileName}`, true);
    return false;
  }

  // בגלל Base64 + מגבלות פונקציות, מומלץ לא קבצים גדולים
  // (Base64 מגדיל ~33%). בפועל, תשמור על ~15-18MB לכל היותר.
  const maxBytes = 18 * 1024 * 1024;
  if (Number(file?.size || 0) > maxBytes) {
    showMessage("הקובץ גדול מדי להעלאה במובייל (נסה קובץ קטן יותר)", true);
    return false;
  }

  const dataUrl = await readFileAsDataURL(file);
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";
  if (!base64) {
    showMessage("לא הצלחתי לקרוא את הקובץ", true);
    return false;
  }

  const req_data = {
    arguments: JSON.stringify({
      folder_id: String(folderId),
      file_name: String(fileName),
      file_base64: String(base64),
      override: "false", // אם תרצה להחליף קובץ קיים -> "true"
    }),
  };

  const resp = await withTimeout(
    ZOHO.CRM.FUNCTIONS.execute(FUNC_UPLOAD_API_NAME, req_data),
    90000,
    "Upload timeout",
  );

  const body = parseFunctionOutput(resp);

  if (!body || body.ok !== true) {
    showMessage(`העלאה נכשלה: ${body?.error || "upload_failed"}`, true);
    return false;
  }

  return true;
}

/* ===== Desktop: list via ZRC ===== */
async function listFolderItems(folderId, needFolderInfo) {
  if (isProbablyMobile()) {
    return await executeFunctionListFiles(folderId);
  }

  if (!workDriveZrc) {
    throw new Error("workDriveZrc not initialized");
  }

  const headers = { Accept: "application/vnd.api+json" };

  const listResp = await workDriveZrc.get(`/files/${folderId}/files`, {
    headers,
  });
  const listData = await safeParseZrcData(listResp);
  const items = Array.isArray(listData?.data) ? listData.data : [];

  let folder = null;
  if (needFolderInfo) {
    const folderResp = await workDriveZrc.get(`/files/${folderId}`, {
      headers,
    });
    const folderData = await safeParseZrcData(folderResp);
    folder = folderData?.data || null;
  }

  return { folder, items };
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
    tdName.setAttribute("data-label", "שם");
    const nameDiv = document.createElement("div");
    nameDiv.className = "file-name";
    nameDiv.innerHTML = `
      <span class="file-icon">${iconHTMLForItem(item)}</span>
      <span class="file-text">${escapeHtml(displayName)}</span>
    `;
    nameDiv.onclick = () => onItemClick(item);
    tdName.appendChild(nameDiv);

    const tdType = document.createElement("td");
    tdType.setAttribute("data-label", "סוג");
    tdType.textContent = extOrType;

    const tdMod = document.createElement("td");
    tdMod.setAttribute("data-label", "עודכן");
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
  renderSkeletonRows(7);

  try {
    const { folder, items } = await listFolderItems(folderId, isRoot);

    if (isRoot && breadcrumbStack.length === 0) {
      const name = folder?.attributes?.name || "תיקייה";
      breadcrumbStack = [{ id: folderId, name }];
    }

    renderBreadcrumbs();
    renderTable(items);
  } catch (e) {
    console.error(e);
    showEmptyState("שגיאה בטעינת התיקייה");
    showMessage("שגיאה בטעינת התיקייה", true);
  }
}

/* ===== Upload UI (Desktop + Mobile) ===== */
function setUploadBusy(isBusy) {
  const btn = document.getElementById("btn-upload-files");
  if (!btn) return;
  btn.disabled = !!isBusy;
  btn.textContent = isBusy ? "מעלה..." : "העלה קבצים";
}

function wireUploadUI() {
  const btnFiles = document.getElementById("btn-upload-files");
  const inputFiles = document.getElementById("file-upload");
  if (!btnFiles || !inputFiles) return;

  btnFiles.addEventListener("click", () => inputFiles.click());

  inputFiles.addEventListener("change", async () => {
    await uploadFiles(inputFiles.files);
    inputFiles.value = "";
  });
}

/* ===== Upload (Desktop ZRC / Mobile Function) ===== */
async function uploadFiles(fileList) {
  if (isUploading) return;
  if (!fileList || fileList.length === 0) return;

  if (!currentFolderId) {
    showMessage("אין תיקייה פעילה להעלאה", true);
    return;
  }

  // Desktop חייב workDriveZrc
  if (!isProbablyMobile() && !workDriveZrc) {
    showMessage("Upload לא זמין כרגע (ZRC לא מאותחל)", true);
    return;
  }

  isUploading = true;
  setUploadBusy(true);

  try {
    const files = Array.from(fileList);
    let successCount = 0;
    let failCount = 0;

    for (const f of files) {
      let ok = false;

      if (isProbablyMobile()) {
        ok = await executeFunctionUploadFile(currentFolderId, f);
      } else {
        ok = await uploadSingleFileToWorkDriveZrc(f, currentFolderId);
      }

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
    setUploadBusy(false);
  }
}

/* ===== Desktop upload via ZRC ===== */
async function uploadSingleFileToWorkDriveZrc(file, folderId) {
  const fileName = file?.name || "file";
  const format = /[`^+\=\[\]{};"\\<>\/]/;
  if (format.test(fileName)) return false;

  try {
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

    return !!ok;
  } catch (error) {
    console.error("Upload error:", error);
    return false;
  }
}

/** ===== CRM record fetch (כדי להביא projectFolderId) ===== */
async function getCrmRecord(entity, recordId) {
  if (!isProbablyMobile() && typeof zrc !== "undefined" && zrc?.get) {
    const crmResp = await zrc.get(`/crm/v8/${entity}/${recordId}`);
    const crmData = await safeParseZrcData(crmResp);
    return crmData?.data?.[0] || null;
  }

  const resp = await ZOHO.CRM.API.getRecord({
    Entity: entity,
    RecordID: recordId,
  });
  return resp?.data?.[0] || null;
}

/* ===== Zoho init ===== */
ZOHO.embeddedApp.on("PageLoad", async function (data) {
  try {
    wireUploadUI();
    initWorkDriveZrcIfPossible();

    currentRecordId = data.EntityId;
    currentEntity = data.Entity;

    const row = await withTimeout(
      getCrmRecord(currentEntity, currentRecordId),
      20000,
      "CRM getRecord timeout",
    );

    const folderId = row?.[CRM_FOLDER_FIELD];
    if (!folderId) {
      showEmptyState("אין תיקיית WorkDrive מקושרת לרשומה הזאת");
      return;
    }

    rootFolderId = String(folderId).trim();
    currentFolderId = rootFolderId;
    breadcrumbStack = [];

    await loadFolder(rootFolderId, true);
  } catch (e) {
    console.error("PageLoad error:", e);
    showEmptyState("שגיאה בטעינה");
    showMessage("שגיאה בהתחברות/טעינה", true);
  }
});

ZOHO.embeddedApp.init();
