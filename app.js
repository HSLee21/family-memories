console.log("APP.JS v12-1784358136 loaded");
const cfg = window.APP_CONFIG;

// Keep the Supabase session signed in across app restarts, until the user
// explicitly signs out (or clears the app's storage / reinstalls).
const client = window.supabase.createClient(
  cfg.SUPABASE_URL,
  cfg.SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      storage: window.localStorage,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

// --- Backblaze B2 storage, via the Cloudflare Worker (cfg.WORKER_URL) ---
// Drop-in replacement for the `client.storage.from(bucket)` calls this app
// used to make against Supabase Storage. Same method names/shapes
// (upload/createSignedUrl/remove) so the rest of app.js barely changed.
async function b2Fetch(endpoint, body) {
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch(`${cfg.WORKER_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

const b2Storage = {
  async upload(path, file, opts = {}) {
    try {
      const contentType = opts.contentType || file.type || "application/octet-stream";
      const { data: { session } } = await client.auth.getSession();
      if (!session) throw new Error("Not signed in.");
      const url = `${cfg.WORKER_URL}/upload?path=${encodeURIComponent(path)}&contentType=${encodeURIComponent(contentType)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "content-type": contentType
        },
        body: file
      });
      const resJson = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resJson.error || `Upload failed (${res.status})`);
      return { error: null };
    } catch (err) {
      return { error: err };
    }
  },

  async createSignedUrl(path, expiresIn = 3600) {
    try {
      const { url } = await b2Fetch("/sign-download", { path, expiresIn });
      return { data: { signedUrl: url }, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  },

  async remove(paths) {
    try {
      for (const path of paths) {
        await b2Fetch("/delete", { path });
      }
      return { error: null };
    } catch (err) {
      return { error: err };
    }
  }
};

let currentUser = null, currentProfile = null, currentAddType = "memory";

const $ = id => document.getElementById(id);

/* Locks the background page in place while a fullscreen overlay (slideshow/video)
   is open. Without this, the home page underneath can still scroll/rubber-band
   on mobile, which is what caused the two views to visibly overlap/bleed
   into each other. */
let _scrollLockY = 0;
function lockBodyScroll(){
  _scrollLockY = window.scrollY || window.pageYOffset || 0;
  document.body.style.position = "fixed";
  document.body.style.top = `-${_scrollLockY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
  document.body.style.overflow = "hidden";
}
function unlockBodyScroll(){
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  document.body.style.overflow = "";
  window.scrollTo(0, _scrollLockY);
}
const views = ["authView","pendingView","appView"];
const pages = ["home","memories","trips","celebrations","study","mediaHub","mediaSection","search","profile","admin"];
const tableMap = {memory:"memories",trip:"trips",celebration:"celebrations",study:"study_materials"};

function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600)}
function showView(id){views.forEach(v=>$(v).classList.toggle("hidden",v!==id))}
function initials(name){return (name||"?").split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase()}

function showAuthForm(name){
  $("signInForm").classList.toggle("hidden",name!=="signin");
  $("signUpForm").classList.toggle("hidden",name!=="signup");
  $("forgotPasswordForm").classList.toggle("hidden",name!=="forgot");
  $("newPasswordForm").classList.toggle("hidden",name!=="newpassword");
  document.querySelector(".tabs").classList.toggle("hidden",name==="forgot"||name==="newpassword");
  document.querySelectorAll("[data-auth-tab]").forEach(x=>x.classList.toggle("active",x.dataset.authTab===name));
}
document.querySelectorAll("[data-auth-tab]").forEach(btn=>btn.onclick=()=>showAuthForm(btn.dataset.authTab));
$("forgotPasswordBtn").onclick=()=>{
  $("resetEmail").value=$("signInEmail").value.trim();
  showAuthForm("forgot");
};
$("backToSignInBtn").onclick=()=>{
  if(currentUser){ showView("appView"); navigate("profile"); }
  else showAuthForm("signin");
};

$("signInForm").onsubmit=async e=>{
  e.preventDefault();
  const {error}=await client.auth.signInWithPassword({email:$("signInEmail").value,password:$("signInPassword").value});
  if(error) toast(error.message);
};
$("signUpForm").onsubmit=async e=>{
  e.preventDefault();
  const {error}=await client.auth.signUp({
    email:$("signUpEmail").value,password:$("signUpPassword").value,
    options:{data:{name:$("signUpName").value}}
  });
  if(error) return toast(error.message);
  toast("Account created. Check your email to verify your address.");
};
$("forgotPasswordForm").onsubmit=async e=>{
  e.preventDefault();
  const email=$("resetEmail").value.trim();
  const redirectTo=new URL(window.location.pathname,window.location.origin).href;
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo});
  if(error) return toast(error.message);
  toast("Password reset email sent. Check your inbox.");
  showAuthForm("signin");
};
$("newPasswordForm").onsubmit=async e=>{
  e.preventDefault();
  const password=$("newPassword").value;
  const confirm=$("confirmNewPassword").value;
  if(password!==confirm) return toast("Passwords do not match.");
  const {error}=await client.auth.updateUser({password});
  if(error) return toast(error.message);
  toast("Password updated successfully.");
  history.replaceState({},document.title,window.location.pathname);
  showAuthForm("signin");
};
async function signOut(){
  await client.auth.signOut();
  $("signInForm")?.reset();
}
$("signOutBtn").onclick=signOut; $("pendingSignOut").onclick=signOut;

async function loadProfile(){
  const {data,error}=await client.from("profiles").select("*").eq("id",currentUser.id).single();
  if(error){console.error(error);toast("Could not load your profile.");return}
  currentProfile=data;
  if(data.status!=="approved"){showView("pendingView");return}
  showView("appView");
  $("welcomeText").textContent=`Welcome, ${data.name||currentUser.email}`;
  $("userBadge").textContent=`${initials(data.name)}  ${data.name||currentUser.email}`;
  $("adminNav").classList.toggle("hidden",data.role!=="admin");
  navigate("home");
}
function hideLoader(){
  const l=document.getElementById("appLoader");
  if(l){ l.style.opacity="0"; setTimeout(()=>l.remove(),300); }
}
async function handleSession(session){
  currentUser=session?.user||null;
  if(!currentUser){ hideLoader();currentProfile=null;showView("authView");return}
  await loadProfile();
}
client.auth.getSession().then(({data})=>handleSession(data.session));
client.auth.onAuthStateChange((event,session)=>{
  if(event==="PASSWORD_RECOVERY"){
    currentUser=session?.user||null;
    showView("authView");
    showAuthForm("newpassword");
    return;
  }
  setTimeout(()=>handleSession(session),0);
});


const sectionType = {memories:"memory",trips:"trip",celebrations:"celebration",study:"study"};
const folderTarget = {memories:"memoriesFolders",trips:"tripsFolders",celebrations:"celebrationsFolders",study:"studyFolders"};
const browserTarget = {memories:"memoriesBrowser",trips:"tripsBrowser",celebrations:"celebrationsBrowser",study:"studyBrowser"};
let currentFolderSection = null;
let currentFolder = null;
let editingFolderId = null;
let folderOptionsSection = null;
let folderOptionsTarget = null;

function navigate(page){
  pages.forEach(p=>$(p+"Page").classList.toggle("hidden",p!==page));
  document.querySelectorAll(".nav-item[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  document.querySelectorAll(".mobile-nav-item[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  $("pageTitle").textContent=({home:"Home",memories:"Our Memories",trips:"Family Trips",celebrations:"Celebrations",study:"Study Hub",mediaHub:"Gallery",mediaSection:"Memories",search:"Search",profile:"Profile",admin:"Family Admin"})[page];
  document.querySelector(".sidebar").classList.remove("open");
  if(sectionType[page]) { currentFolder=null; loadFolders(page); }
  if(page==="admin"){ loadFamilyTree(); loadMembers(); loadInvites(); }
  if(page==="home") loadHomeExperience();
  if(page==="profile") loadProfilePage();
}
document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>navigate(b.dataset.page));
document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>navigate(b.dataset.go));
if($("mobileMenu")) $("mobileMenu").onclick=()=>document.querySelector(".sidebar")?.classList.toggle("open");

document.querySelectorAll(".open-folder").forEach(b=>b.onclick=()=>{
  currentFolderSection=b.dataset.section;
  editingFolderId=null;
  $("folderForm").reset();
  $("folderDialogTitle").textContent="New Folder";
  $("folderFormSubmitBtn").textContent="Create";
  $("folderDialog").showModal();
});
$("closeFolderDialog").onclick=$("cancelFolderDialog").onclick=()=>$("folderDialog").close();

$("folderForm").onsubmit=async e=>{
  e.preventDefault();
  const name=$("folderName").value.trim();
  const description=$("folderDescription").value.trim()||null;

  if(editingFolderId){
    const {error}=await client.from("folders").update({name,description,updated_at:new Date().toISOString()}).eq("id",editingFolderId);
    if(error) return toast(error.message);
    $("folderDialog").close();
    toast("Folder renamed.");
    loadFolders(folderOptionsSection||currentFolderSection);
    return;
  }

  const payload={name,description,section:currentFolderSection,created_by:currentUser.id};
  const {error}=await client.from("folders").insert(payload);
  if(error) return toast(error.message);
  $("folderDialog").close();
  toast("Folder created.");
  loadFolders(currentFolderSection);
};

$("closeFolderOptions").onclick=()=>$("folderOptionsDialog").close();
$("folderOptionsRename").onclick=()=>{
  $("folderOptionsDialog").close();
  editingFolderId=folderOptionsTarget.id;
  $("folderName").value=folderOptionsTarget.name;
  $("folderDescription").value=folderOptionsTarget.description||"";
  $("folderDialogTitle").textContent="Rename Folder";
  $("folderFormSubmitBtn").textContent="Save";
  $("folderDialog").showModal();
};
$("folderOptionsDelete").onclick=async()=>{
  if(!confirm(`Delete "${folderOptionsTarget.name}"? Files/items will remain but will no longer be inside this folder.`)) return;
  const {error}=await client.from("folders").delete().eq("id",folderOptionsTarget.id);
  $("folderOptionsDialog").close();
  if(error) toast(error.message); else {toast("Folder deleted.");loadFolders(folderOptionsSection)}
};

async function loadFolders(section){
  const target=folderTarget[section], browser=browserTarget[section], type=sectionType[section];
  $(browser).classList.add("hidden");
  $(browser).innerHTML="";
  $(target).classList.remove("hidden");
  $(target).innerHTML='<div class="empty">Loading folders…</div>';
  const {data,error}=await client.from("folders").select("*").eq("section",section).order("created_at",{ascending:false});
  if(error){$(target).innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}

  // Items can end up disconnected from any real folder in two ways:
  // 1) folder_id is NULL (never filed into an album), or
  // 2) folder_id still points at a folder row that's since been deleted —
  //    deleting a folder here only removes the folder row, it does NOT
  //    clear folder_id on the items that were inside it, so those items
  //    are left with a "dangling" folder_id that matches nothing.
  // Either way, they're invisible in the folder browser below, so we
  // detect both cases and surface them as an "Uncategorized" pseudo-folder.
  let orphanIds = [];
  const orphanTable = tableMap[type];
  const validFolderIds = new Set((data||[]).map(f=>f.id));
  if(orphanTable){
    const {data:itemRows} = await client.from(orphanTable).select("id,folder_id");
    if(itemRows) orphanIds = itemRows.filter(r=>!r.folder_id || !validFolderIds.has(r.folder_id)).map(r=>r.id);
  }
  const orphanCount = orphanIds.length;

  const folderCards = (data||[]).map(f=>`<article class="folder-card" data-folder="${f.id}">
    <div class="folder-icon">📁</div>
    <div class="folder-info"><h3>${escapeHtml(f.name)}</h3><p>${escapeHtml(f.description||"Open folder")}</p></div>
    <button class="folder-menu secondary" data-menu="${f.id}" title="Folder options">•••</button>
  </article>`).join("");
  const uncategorizedCard = orphanCount>0 ? `<article class="folder-card" data-folder="__uncategorized__">
    <div class="folder-icon">🗂️</div>
    <div class="folder-info"><h3>Uncategorized</h3><p>${orphanCount} item${orphanCount===1?"":"s"} not inside any album</p></div>
  </article>` : "";

  if(!data?.length && !orphanCount){$(target).innerHTML='<div class="empty">No folders yet. Create your first folder.</div>';return}
  $(target).innerHTML = uncategorizedCard + folderCards;
  document.querySelectorAll(`#${target} [data-folder]`).forEach(card=>card.onclick=e=>{
    if(e.target.closest("[data-menu]")) return;
    if(card.dataset.folder==="__uncategorized__"){
      openFolder(section,{id:null,name:"Uncategorized",description:"Items not inside any album",_orphanIds:orphanIds});
      return;
    }
    openFolder(section,data.find(f=>f.id===card.dataset.folder));
  });
  document.querySelectorAll(`#${target} [data-menu]`).forEach(btn=>btn.onclick=e=>{
    e.stopPropagation();
    const f=data.find(x=>x.id===btn.dataset.menu);
    folderActions(section,f);
  });
}

async function folderActions(section,folder){
  folderOptionsSection=section;
  folderOptionsTarget=folder;
  $("folderOptionsTitle").textContent=folder.name;
  $("folderOptionsDialog").showModal();
}

async function openFolder(section,folder){
  currentFolderSection=section; currentFolder=folder;
  const target=folderTarget[section], browser=browserTarget[section], type=sectionType[section];
  $(target).classList.add("hidden");
  $(browser).classList.remove("hidden");
  const isUncategorized = !folder.id;
  $(browser).innerHTML=`<div class="folder-toolbar">
    <button class="secondary back-folders">← All folders</button>
    <div><h2>${escapeHtml(folder.name)}</h2><p class="muted">${escapeHtml(folder.description||"")}</p></div>
    ${isUncategorized ? "" : '<button class="primary upload-folder">+ Add / Upload</button>'}
  </div><div id="${browser}Items" class="content-grid"></div>`;
  $(browser).querySelector(".back-folders").onclick=()=>loadFolders(section);
  const uploadBtn=$(browser).querySelector(".upload-folder");
  if(uploadBtn) uploadBtn.onclick=()=>openAddForFolder(type);
  loadFolderItems(type, isUncategorized ? {ids:folder._orphanIds||[]} : folder.id, browser+"Items");
}

function openAddForFolder(type){
  currentAddType=type;
  $("dialogTitle").textContent=({memory:"Add to Memory Folder",trip:"Add to Family Trip Folder",celebration:"Add to Celebration Folder",study:"Upload Study Material"})[type];
  $("addForm").reset();
  $("itemFileLabel").textContent="Choose photo or file";
  $("addDialog").showModal();
}
$("closeDialog").onclick=$("cancelDialog").onclick=()=>$("addDialog").close();

$("itemFile").onchange = () => {
  const f = $("itemFile").files[0];
  if (f) {
    $("itemFileLabel").textContent = `✅ Selected: ${f.name}`;
    alert(`Selected: ${f.name}`);
  } else {
    $("itemFileLabel").textContent = "Choose photo or file";
  }
};

$("addForm").onsubmit = async e => {
  e.preventDefault();

  if (!currentFolder) {
    return toast("Open a folder first.");
  }

  const table = tableMap[currentAddType];
  const files = [...$("itemFile").files];

  // Everything is optional, but at least one file or some text must be provided
  const title = $("itemTitle").value.trim();
  const description = $("itemDescription").value.trim();
  const eventDate = $("itemDate").value;

  if (!files.length && !title && !description && !eventDate) {
    return toast("Please add a file, photo, or some information.");
  }

  try {
    let file_path = null;
    let uploadFile = null;

    // Upload file/photo if selected
    if (files[0]) {
      uploadFile = await compressImageIfNeeded(files[0]);
      const safe = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      file_path = `${currentUser.id}/${currentFolder.id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safe}`;

      const { error: uploadError } = await b2Storage
        .upload(file_path, uploadFile);

      if (uploadError) throw uploadError;

      alert("File is uploaded");

      if (uploadFile.type && uploadFile.type.startsWith("video/")) {
        const poster = await captureVideoPosterFromFile(uploadFile);
        if (poster) setVideoPosterCached(file_path, poster);
      }
    }

    // Use file name as title automatically if title is empty
    const autoTitle = uploadFile
      ? uploadFile.name.replace(/\.[^/.]+$/, "")
      : "Untitled";

    const payload = {
      title: title || autoTitle,
      description: description || null,
      user_id: currentUser.id,
      folder_id: currentFolder.id
    };

    // Add date only if user entered one
    if (eventDate) {
      payload.event_date = eventDate;
    }

    // Add file path only if a file was uploaded
    if (file_path) {
      payload.file_path = file_path;
    }

    // Compatibility with your existing trips table
    if (currentAddType === "trip") {
      payload.trip_name = title || autoTitle;
      payload.created_by = currentUser.id;
    }

    const { error } = await client
      .from(table)
      .insert(payload);

    if (error) throw error;

    $("addDialog").close();
    $("addForm").reset();

    mediaIndexCache.items=null;
    toast("Saved successfully!");

    // Refresh folder immediately
    openFolder(currentFolderSection, currentFolder);

  } catch (err) {
    console.error(err);
    alert("Save failed: " + (err.message || "Could not save item."));
    toast(err.message || "Could not save item.");
  }
};



const lazyImageObserver=('IntersectionObserver' in window)
?new IntersectionObserver(entries=>{
  entries.forEach(entry=>{
    if(!entry.isIntersecting) return;
    const img=entry.target;
    if(img.dataset.src){
      img.src=img.dataset.src;
      img.removeAttribute('data-src');
    }
    lazyImageObserver.unobserve(img);
  });
},{rootMargin:'250px'})
:null;


const renderChunkSize=24;
function renderItemsIncrementally(items,target){
  const el=document.getElementById(target);
  let index=0;
  el.innerHTML="";
  function renderBatch(){
    const end=Math.min(index+renderChunkSize,items.length);
    let html="";
    for(let i=index;i<end;i++) html+=items[i];
    el.insertAdjacentHTML("beforeend",html);
    index=end;
    if(index<items.length){
      requestAnimationFrame(renderBatch);
    }
  }
  renderBatch();
}

async function loadFolderItems(type,folderIdOrIds,target){
  $(target).innerHTML='<div class="empty">Loading…</div>';
  const table=tableMap[type];
  let query = client.from(table).select("*");
  if(folderIdOrIds && typeof folderIdOrIds==="object" && Array.isArray(folderIdOrIds.ids)){
    if(!folderIdOrIds.ids.length){
      $(target).innerHTML='<div class="empty">Nothing here.</div>';
      return;
    }
    query = query.in("id",folderIdOrIds.ids);
  } else if(folderIdOrIds){
    query = query.eq("folder_id",folderIdOrIds);
  } else {
    query = query.is("folder_id",null);
  }
  const {data,error} = await query.order("created_at",{ascending:false});
  if(error){$(target).innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}
  if(!data?.length){$(target).innerHTML='<div class="empty">This folder is empty. Add the first item or file.</div>';return}

  const items=await Promise.all(data.map(async item=>{
    let signedUrl=null;
    if(item.file_path){
      const {data:signed}=await b2Storage.createSignedUrl(item.file_path,3600);
      signedUrl=signed?.signedUrl||null;
    }
    return {...item,signedUrl};
  }));

const cards=items.map(item=>{
    const ext=(item.file_path||"").split(".").pop().toLowerCase();
    const isImage=["jpg","jpeg","png","gif","webp","bmp","svg","avif"].includes(ext);
    const isVideo=isVideoPath(item.file_path);
    const media=item.file_path&&item.signedUrl
      ? isImage
        ? `<img class="content-preview" loading="lazy" decoding="async" data-src="${item.signedUrl}" src="" alt="${escapeHtml(item.title||"Uploaded image")}" data-file="${encodeURIComponent(item.file_path)}">`
        : isVideo
          ? `<div class="video-wrap"><video class="content-preview" playsinline muted preload="metadata"${getVideoPosterCached(item.file_path)?` poster="${getVideoPosterCached(item.file_path)}"`:""} data-video-path="${encodeURIComponent(item.file_path)}" src="${item.signedUrl}"></video><button type="button" class="video-play-btn" aria-label="Play video"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button><button type="button" class="video-fs-btn" aria-label="Full screen">⛶</button></div>`
          : `<button class="secondary file-link" data-file="${encodeURIComponent(item.file_path)}">Open file</button>`
      : "";
    return `<article class="content-card">
      ${media}
      <div class="meta">${item.event_date||new Date(item.created_at).toLocaleDateString()}</div>
      <h3>${escapeHtml(item.title||"Untitled")}</h3>
      ${item.description?`<p>${escapeHtml(item.description)}</p>`:""}
      <button class="secondary delete-item" data-id="${item.id}" data-file-path="${item.file_path?encodeURIComponent(item.file_path):""}">Delete</button>
    </article>`;
  });
  renderItemsIncrementally(cards,target);

  setTimeout(()=>{
  document.querySelectorAll(`#${target} [data-file]`).forEach(el=>el.onclick=()=>openPrivateFile(decodeURIComponent(el.dataset.file)));
  document.querySelectorAll(`#${target} video.content-preview`).forEach(el=>attachVideoPoster(el,el.currentSrc||el.src, el.dataset.videoPath ? decodeURIComponent(el.dataset.videoPath) : null));
  document.querySelectorAll(`#${target} .video-play-btn`).forEach(btn=>{
    btn.onclick=(e)=>{
      e.stopPropagation();
      const video=btn.parentElement.querySelector("video.content-preview");
      if(!video) return;
      if(video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      else if(video.requestFullscreen) video.requestFullscreen();
      else if(video.webkitRequestFullscreen) video.webkitRequestFullscreen();
      video.muted=false;
      video.play().catch(()=>{});
    };
  });
  document.querySelectorAll(`#${target} .video-fs-btn`).forEach(btn=>{
    btn.onclick=(e)=>{
      e.stopPropagation();
      const video=btn.parentElement.querySelector("video.content-preview");
      if(!video) return;
      if(video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iOS Safari
      else if(video.requestFullscreen) video.requestFullscreen();
      else if(video.webkitRequestFullscreen) video.webkitRequestFullscreen();
    };
  });
  document.querySelectorAll(`#${target} img.content-preview`).forEach(img=>{
    if(lazyImageObserver) lazyImageObserver.observe(img);
    else if(img.dataset.src){img.src=img.dataset.src;}
  });

  document.querySelectorAll(`#${target} .delete-item`).forEach(el=>el.onclick=async()=>{
    if(!confirm("Delete this item? This cannot be undone.")) return;
    const id=el.dataset.id;
    const filePath=el.dataset.filePath?decodeURIComponent(el.dataset.filePath):null;
    const {error}=await client.from(table).delete().eq("id",id);
    if(error){ toast(error.message); return; }
    if(filePath){
      await b2Storage.remove([filePath]);
      videoPosterCache.delete(filePath);
      persistVideoPosterCache();
    }
    mediaIndexCache.items=null;
    toast("Deleted.");
    loadFolderItems(type,folderIdOrIds,target);
  });
  },0);
}
// Videos hosted in storage have no poster image, so mobile browsers show a
// blank box until the user taps play. Grab the first frame ourselves on a
// hidden probe video and use it as the poster so the preview looks like a
// real thumbnail. Fails silently (no poster, same as before) if the storage
// CORS policy blocks canvas reads.

function attachVideoPoster(videoEl,src,filePath){
  try{
    if(filePath){
      const cached = getVideoPosterCached(filePath);
      if(cached){
        videoEl.poster = cached;
        return;
      }
    }
    const probe=document.createElement("video");
    probe.crossOrigin="anonymous";
    probe.preload="auto";
    probe.muted=true;
    probe.playsInline=true;
    probe.src=src;

    const tryCapture = ()=>{
      try{
        const canvas=document.createElement("canvas");
        canvas.width=probe.videoWidth||320;
        canvas.height=probe.videoHeight||320;
        const ctx = canvas.getContext("2d");
        if(!ctx) throw new Error("no ctx");
        ctx.drawImage(probe,0,0,canvas.width,canvas.height);
        const poster = canvas.toDataURL("image/jpeg",0.78);
        videoEl.poster = poster;
        if(filePath) setVideoPosterCached(filePath, poster);
      }catch(e){ /* tainted canvas / decode failure - leave without poster */ }
    };

    probe.addEventListener("loadedmetadata",()=>{
      try{
        const jumpTo = Math.min(0.1, Math.max(0.01, (probe.duration || 1) * 0.02));
        probe.currentTime = jumpTo;
      }catch(e){
        tryCapture();
      }
    },{once:true});

    probe.addEventListener("seeked",()=>{ tryCapture(); },{once:true});
    probe.addEventListener("loadeddata",()=>{ tryCapture(); },{once:true});
    probe.addEventListener("error",()=>{ /* ignore - not critical */ },{once:true});
  }catch(e){ /* ignore - not critical */ }
}
async function openPrivateFile(path){
  const {data,error}=await b2Storage.createSignedUrl(path,60);
  if(error) return toast(error.message);
  window.open(data.signedUrl,"_blank","noopener");
}

async function compressImageIfNeeded(file){
  if(!file || !file.type.startsWith("image/")) return file;
  return new Promise((resolve)=>{
    const img=new Image();
    const reader=new FileReader();
    reader.onload=e=>img.src=e.target.result;
    reader.onerror=()=>resolve(file);
    img.onerror=()=>resolve(file);
    img.onload=()=>{
      const MAX=1920;
      let w=img.width,h=img.height;
      if(w>h && w>MAX){h=Math.round(h*MAX/w);w=MAX;}
      else if(h>=w && h>MAX){w=Math.round(w*MAX/h);h=MAX;}
      const c=document.createElement("canvas");
      c.width=w;c.height=h;
      c.getContext("2d").drawImage(img,0,0,w,h);
      c.toBlob(b=>{
        if(!b){resolve(file);return;}
        resolve(new File([b],file.name.replace(/\.[^.]+$/,"")+".jpg",{type:"image/jpeg"}));
      },"image/jpeg",0.9);
    };
    reader.readAsDataURL(file);
  });
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}


const VIDEO_POSTER_CACHE_KEY = "family-memories:video-poster-cache-v1";
const videoPosterCache = new Map();
try{
  const raw = localStorage.getItem(VIDEO_POSTER_CACHE_KEY);
  if(raw){
    const parsed = JSON.parse(raw);
    if(parsed && typeof parsed === "object"){
      Object.entries(parsed).forEach(([k,v])=>{
        if(typeof v === "string" && v) videoPosterCache.set(k,v);
      });
    }
  }
}catch(e){}

function persistVideoPosterCache(){
  try{
    const obj = Object.fromEntries(videoPosterCache);
    localStorage.setItem(VIDEO_POSTER_CACHE_KEY, JSON.stringify(obj));
  }catch(e){}
}
function getVideoPosterCached(path){
  return path ? (videoPosterCache.get(path) || null) : null;
}
function setVideoPosterCached(path, poster){
  if(!path || !poster) return;
  if(!videoPosterCache.has(path) && videoPosterCache.size >= 20){
    const firstKey = videoPosterCache.keys().next().value;
    if(firstKey) videoPosterCache.delete(firstKey);
  }
  videoPosterCache.set(path, poster);
  persistVideoPosterCache();
}
function captureVideoPosterFromFile(file){
  if(!file || !file.type || !file.type.startsWith("video/")) return Promise.resolve(null);
  return new Promise(resolve=>{
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.crossOrigin = "anonymous";
    probe.preload = "auto";
    probe.muted = true;
    probe.playsInline = true;
    probe.src = url;

    const cleanup = () => {
      try{ URL.revokeObjectURL(url); }catch(e){}
    };

    const finish = () => {
      try{
        const canvas = document.createElement("canvas");
        canvas.width = probe.videoWidth || 320;
        canvas.height = probe.videoHeight || 320;
        const ctx = canvas.getContext("2d");
        if(!ctx) throw new Error("no canvas ctx");
        ctx.drawImage(probe, 0, 0, canvas.width, canvas.height);
        const poster = canvas.toDataURL("image/jpeg", 0.78);
        cleanup();
        resolve(poster);
      }catch(e){
        cleanup();
        resolve(null);
      }
    };

    probe.addEventListener("loadedmetadata",()=>{
      try{
        const jumpTo = Math.min(0.1, Math.max(0.01, (probe.duration || 1) * 0.02));
        probe.currentTime = jumpTo;
      }catch(e){
        finish();
      }
    }, {once:true});

    probe.addEventListener("seeked", finish, {once:true});
    probe.addEventListener("loadeddata", ()=>{ finish(); }, {once:true});
    probe.addEventListener("error", ()=>{ cleanup(); resolve(null); }, {once:true});
  });
}

const AVATAR_COLORS=["#dbeafe:#2563eb","#fde2e7:#db2777","#ede9fe:#7c3aed","#dcfce7:#16a34a","#fef3c7:#d97706","#e0f2fe:#0284c7"];
function initialsOf(name,email){
  const src=(name||"").trim()||(email||"").trim();
  if(!src) return "?";
  const parts=src.split(/\s+/).filter(Boolean);
  if(parts.length>=2) return (parts[0][0]+parts[1][0]).toUpperCase();
  return src.slice(0,2).toUpperCase();
}
function avatarColorFor(id){
  let hash=0;
  for(const ch of String(id||"")) hash=(hash*31+ch.charCodeAt(0))>>>0;
  return AVATAR_COLORS[hash%AVATAR_COLORS.length].split(":");
}

async function loadMembers(){
  if(currentProfile?.role!=="admin") return;
  $("membersList").innerHTML="Loading…";
  const {data,error}=await client.from("profiles").select("id,name,email,role,status,created_at").order("created_at",{ascending:false});
  if(error){$("membersList").innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}

  $("membersCount").textContent=data.length;

  const rows=await Promise.all(data.map(async m=>{
    const [bg,fg]=avatarColorFor(m.id);
    let avatarHtml=`<span class="admin-row-avatar" style="background:${bg};color:${fg}">${escapeHtml(initialsOf(m.name,m.email))}</span>`;
    const {data:signed}=await b2Storage.createSignedUrl(`${m.id}/profile/profile-photo`,3600);
    if(signed?.signedUrl) avatarHtml=`<img class="admin-row-avatar admin-row-avatar-photo" src="${signed.signedUrl}" alt="${escapeHtml(m.name||m.email||"")}"/>`;
    return `<div class="admin-member-row">
      ${avatarHtml}
      <div class="admin-row-body">
        <strong>${escapeHtml(m.name||m.email||"Unnamed member")}</strong>
        <div class="small muted">${escapeHtml(m.email||"")} · ${escapeHtml(m.role||"family")}${m.status!=="approved"?` · ${escapeHtml(m.status||"pending")}`:""}</div>
      </div>
      ${m.status!=="approved"?`<button class="admin-approve-btn approve-member" data-id="${m.id}">Approve</button>`:`
      <div class="admin-row-actions">
        <button class="admin-icon-btn rename-member" data-id="${m.id}" data-name="${escapeHtml(m.name||"")}" title="Rename">✏️</button>
        <button class="admin-icon-btn admin-icon-btn-danger delete-member" data-id="${m.id}" data-name="${escapeHtml(m.name||m.email||"this member")}" title="Remove">🗑️</button>
      </div>`}
    </div>`;
  }));
  $("membersList").innerHTML=rows.join("");
  document.querySelectorAll(".approve-member").forEach(b=>b.onclick=()=>approveMember(b.dataset.id));
  document.querySelectorAll(".rename-member").forEach(b=>b.onclick=()=>renameMember(b.dataset.id,b.dataset.name));
  document.querySelectorAll(".delete-member").forEach(b=>b.onclick=()=>deleteMember(b.dataset.id,b.dataset.name));
}

const FAMILY_TREE_ORDER=["dad","mom","daughter1","daughter2"];
const familyTreeStoragePath=(slotKey)=>`${currentUser.id}/app-settings/family-tree-${slotKey}`;

function setFamilyTreeTitle(){
  const name=(currentProfile?.name||"").trim();
  const surname=name.split(/\s+/).pop();
  $("adminTreeTitle").innerHTML=`${surname?escapeHtml(surname)+"'s":"Our"} Family <span class="admin-tree-heart">♥</span>`;
}


async function loadFamilyTree(){
  setFamilyTreeTitle();
  const isAdmin=currentProfile?.role==="admin";
  const {data,error}=await client.from("family_tree_slots").select("slot_key,label,photo_path");
  if(error){ $("adminTreeAvatars").innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`; return; }
  const bySlot=Object.fromEntries(data.map(d=>[d.slot_key,d]));
  const CAMERA_BADGE = '<span class="admin-tree-edit-badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 4.5a1.5 1.5 0 0 0-1.27.7L6.8 6.9H4.5A2.5 2.5 0 0 0 2 9.4v8.1A2.5 2.5 0 0 0 4.5 20h15a2.5 2.5 0 0 0 2.5-2.5V9.4a2.5 2.5 0 0 0-2.5-2.5H17.2l-.93-1.7A1.5 1.5 0 0 0 15 4.5H9zm3 12.2A4.2 4.2 0 1 1 12 8.3a4.2 4.2 0 0 1 0 8.4zm0-1.9a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z"/></svg></span>';

  const cells=await Promise.all(FAMILY_TREE_ORDER.map(async key=>{
    const slot=bySlot[key]||{label:key,photo_path:null};
    let avatarHtml=`<span class="admin-tree-avatar admin-tree-avatar-empty">👤</span>`;
    if(slot.photo_path){
      const {data:signed}=await b2Storage.createSignedUrl(slot.photo_path,3600);
      if(signed?.signedUrl) avatarHtml=`<img alt="${escapeHtml(slot.label)}" class="admin-tree-avatar admin-tree-avatar-photo" src="${signed.signedUrl}" loading="lazy" decoding="async"/>`;
    }
    return `<div class="admin-tree-member${isAdmin?" admin-tree-editable":""}" data-slot="${key}">
      <div class="admin-tree-avatar-wrap">${avatarHtml}${isAdmin?CAMERA_BADGE:""}</div>
      <span class="admin-tree-name">${escapeHtml(slot.label)}</span>
    </div>`;
  }));
  $("adminTreeAvatars").innerHTML=cells.join("");

  if(isAdmin){
    document.querySelectorAll(".admin-tree-editable").forEach(el=>{
      el.onclick=()=>{
        $("familyTreePhotoInput").dataset.slot=el.dataset.slot;
        $("familyTreePhotoInput").click();
      };
    });
  }
}

if($("familyTreePhotoInput")) $("familyTreePhotoInput").onchange=async e=>{
  const file=e.target.files[0];
  const slotKey=e.target.dataset.slot;
  e.target.value="";
  if(!file||!slotKey) return;
  const path=familyTreeStoragePath(slotKey);
  const {error:upErr}=await b2Storage.upload(path,file,{upsert:true,contentType:file.type});
  if(upErr) return toast(upErr.message);
  const {error:dbErr}=await client.from("family_tree_slots").update({photo_path:path,updated_at:new Date().toISOString()}).eq("slot_key",slotKey);
  if(dbErr) return toast(dbErr.message);
  toast("Photo updated.");
  loadFamilyTree();
};

async function rejectMember(id){
  if(!confirm("Reject this member?")) return;
  const {error}=await client.from("profiles").delete().eq("id",id);
  if(error) toast(error.message); else {toast("Member rejected.");loadMembers();}
}

async function approveMember(id){
  const {error}=await client.from("profiles").update({status:"approved"}).eq("id",id);
  if(error) toast(error.message); else {toast("Member approved.");loadMembers()}
}

async function renameMember(id,currentName){
  const newName=prompt("Rename family member:",currentName||"");
  if(newName===null) return;
  const trimmed=newName.trim();
  if(!trimmed) return toast("Name can't be empty.");
  const {error}=await client.from("profiles").update({name:trimmed}).eq("id",id);
  if(error) toast(error.message); else {toast("Name updated.");loadMembers();}
}

async function deleteMember(id,name){
  if(currentUser?.id===id) return toast("You can't remove yourself.");
  if(!confirm(`Remove ${name} from the family? They will lose access immediately.`)) return;
  const {error}=await client.from("profiles").delete().eq("id",id);
  if(error) toast(error.message); else {toast("Member removed.");loadMembers();}
}

if($("addMemberForm")) $("addMemberForm").onsubmit=async e=>{
  e.preventDefault();
  const email=$("newMemberEmail").value.trim().toLowerCase();
  const role=$("newMemberRole").value;
  if(!email) return;
  const {error}=await client.from("invites").insert({email,role,invited_by:currentUser.id});
  if(error) return toast(error.message);
  toast(`Invite added for ${email}. Share the app link with them.`);
  $("addMemberForm").reset();
  loadInvites();
};

async function loadInvites(){
  if(currentProfile?.role!=="admin") return;
  $("invitesList").innerHTML="Loading…";
  const {data,error}=await client.from("invites").select("email,role,created_at").order("created_at",{ascending:false});
  if(error){$("invitesList").innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}

  $("invitesCount").textContent=data.length;

  if(!data.length){$("invitesList").innerHTML=`<div class="empty">No pending invites.</div>`;return}
  $("invitesList").innerHTML=data.map(inv=>{
    const invitedOn=inv.created_at?new Date(inv.created_at).toLocaleDateString(undefined,{day:"2-digit",month:"short",year:"numeric"}):"";
    return `<div class="admin-invite-row-item">
      <span class="admin-row-avatar admin-row-avatar-invite">✉️</span>
      <div class="admin-row-body">
        <strong>${escapeHtml(inv.email)}</strong>
        <div class="small muted">Invited as ${escapeHtml(inv.role)} · awaiting sign-up</div>
        ${invitedOn?`<div class="small muted admin-invite-date">📅 Invited on ${invitedOn}</div>`:""}
      </div>
      <button class="admin-cancel-btn cancel-invite" data-email="${escapeHtml(inv.email)}">Cancel Invite</button>
    </div>`;
  }).join("");
  document.querySelectorAll(".cancel-invite").forEach(b=>b.onclick=()=>cancelInvite(b.dataset.email));
}

async function cancelInvite(email){
  if(!confirm(`Cancel invite for ${email}?`)) return;
  const {error}=await client.from("invites").delete().eq("email",email);
  if(error) toast(error.message); else {toast("Invite cancelled.");loadInvites();}
}


// Warm family home experience
const DEFAULT_FAMILY_COVER = "assets/images/hero.jpg";

const LOCAL_CARD_IMAGES = {
  memories:"assets/images/memories.jpg",
  trips:"assets/images/trips.jpg",
  celebrations:"assets/images/celebrations.jpg",
  study:"assets/images/study.jpg"
};

const profileStoragePath = () => `${currentUser.id}/profile/profile-photo`;

async function loadProfilePhoto(){
  if(!currentUser) return;
  const img=$("profilePhotoImage"), fallback=$("profilePhotoFallback");
  const largeImg=$("profileLargePhoto"), largeFallback=$("profileLargeFallback");
  const {data}=await b2Storage.createSignedUrl(profileStoragePath(),3600);
  if(data?.signedUrl){
    if(img){ img.src=data.signedUrl; img.classList.remove("hidden"); }
    if(fallback) fallback.classList.add("hidden");
    if(largeImg){ largeImg.src=data.signedUrl; largeImg.classList.remove("hidden"); }
    if(largeFallback) largeFallback.classList.add("hidden");
  }else{
    if(img) img.classList.add("hidden");
    if(fallback) fallback.classList.remove("hidden");
    if(largeImg) largeImg.classList.add("hidden");
    if(largeFallback) largeFallback.classList.remove("hidden");
  }
}

if($("profilePhotoBtn")) $("profilePhotoBtn").onclick=()=>$("profilePhotoInput").click();
if($("profilePhotoInput")) $("profilePhotoInput").onchange=async e=>{
  const file=e.target.files?.[0];
  if(!file || !currentUser) return;
  const {error}=await b2Storage.upload(
    profileStoragePath(), file, {upsert:true,contentType:file.type}
  );
  if(error) return toast(error.message);
  await loadProfilePhoto();
  toast("Profile photo updated.");
  e.target.value="";
};

const coverStoragePath = () => `${currentUser.id}/app-settings/family-cover`;

async function loadHomeExperience(){
  const changeBtn=$("changeCoverBtn");
  if(changeBtn) changeBtn.classList.toggle("hidden",currentProfile?.role!=="admin");
  await loadFamilyCover();
  await loadProfilePhoto();
  await loadCardImages();
  setTimeout(()=>warmSlideshowCache(),1000);
}


async function loadFamilyCover(){
  const cover=$("coverImage");
  if(!cover) return;

  const cacheKey="cover_signed_url_cache";
  let cached=null;
  try{ cached=JSON.parse(localStorage.getItem(cacheKey)||"null"); }catch(e){ cached=null; }

  // Show cached photo immediately (no flash of the default placeholder, no wait)
  if(cached && cached.url && cached.expires>Date.now()){
    cover.style.backgroundImage=`url("${cached.url}")`;
  }

  // Refresh in the background if the cache is missing/near expiry, so it's ready next time too
  const needsRefresh=!cached || cached.expires<Date.now()+300000; // refresh if <5min left
  if(needsRefresh){
    const {data}=await b2Storage.createSignedUrl(coverStoragePath(),3600);
    const url=data?.signedUrl||DEFAULT_FAMILY_COVER;
    cover.style.backgroundImage=`url("${url}")`;
    if(data?.signedUrl){
      try{
        localStorage.setItem(cacheKey, JSON.stringify({url, expires: Date.now()+3600*1000}));
      }catch(e){ /* localStorage full or unavailable - ignore, just skip caching */ }
    }
  }
}

if($("changeCoverBtn")) $("changeCoverBtn").onclick=()=>$("coverFileInput").click();
if($("coverFileInput")) $("coverFileInput").onchange=async e=>{
  const file=e.target.files?.[0];
  if(!file) return;
  if(!file.type.startsWith("image/")) return toast("Please choose an image file.");
  const {error}=await b2Storage.upload(coverStoragePath(),file,{upsert:true,contentType:file.type});
  if(error) return toast(error.message);
  try{ localStorage.removeItem("cover_signed_url_cache"); }catch(e){}
  toast("Family cover updated.");
  await loadFamilyCover();
  await loadProfilePhoto();
  e.target.value="";
};



// Homepage cards - manual photo upload via camera button
const HOME_CARDS = ["memories","trips","celebrations","study"];
const cardLocalKey = (c) => `family-memories:card-full:${c}`;
const cardStoragePath = (c) => `${currentUser.id}/app-settings/card-full-${c}`;
function setCardImageDOM(card, src){
  const img=document.querySelector(`.family-space-card.${card}-card .card-local-image`);
  if(!img) return;
  img.src = src || LOCAL_CARD_IMAGES[card];
}
const cardCacheKey = (c) => `card_signed_url_cache:${c}`;
async function loadCardImages(){
  for(const card of HOME_CARDS){
    setCardImageDOM(card, LOCAL_CARD_IMAGES[card]);
  }
}
function initCardCameraButtons(){
  document.querySelectorAll(".family-space-card[data-go]").forEach(el=>{
    el.addEventListener("click",(e)=>{
      if(e.target.closest(".card-camera-btn")) return;
      navigate(el.dataset.go);
    });
  });
  document.querySelectorAll(".card-camera-btn").forEach(btn=>{
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const card = btn.dataset.card;
      document.getElementById(`cardFile-${card}`)?.click();
    });
  });
  HOME_CARDS.forEach(card=>{
    const input = document.getElementById(`cardFile-${card}`);
    if(!input) return;
    input.addEventListener("change", async (e)=>{
      const file = e.target.files?.[0];
      if(!file) return;
      if(!file.type.startsWith("image/")) return toast("Please choose an image file.");
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        setCardImageDOM(card, dataUrl);
        try{ localStorage.setItem(cardLocalKey(card), dataUrl); }catch{}
      };
      reader.readAsDataURL(file);
      if(currentUser){
        try{
          const {error} = await b2Storage.upload(cardStoragePath(card), file, {upsert:true, contentType:file.type});
          if(error) toast("Saved locally. Cloud error: "+error.message);
          else {
            toast("Card image updated.");
            const {data}=await b2Storage.createSignedUrl(cardStoragePath(card),86400);
            if(data?.signedUrl){
              setCardImageDOM(card,data.signedUrl);
              try{ localStorage.setItem(cardCacheKey(card), JSON.stringify({url:data.signedUrl, expires:Date.now()+86400*1000})); }catch(e){}
            }
          }
        }catch(err){ toast(err.message); }
      }
      e.target.value="";
    });
  });
}
document.addEventListener("DOMContentLoaded", ()=>{
  initCardCameraButtons();
  const backBtn=document.getElementById("bottomBackBtn");
  if(backBtn) backBtn.addEventListener("click", ()=>{ if(activePage!=="home") navigate("home"); });
});


// Scientific calculator (tap-based)
(function(){
  const display = $("calcDisplay");
  const resultBox = $("calcResult");
  $("calcKeys").addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.act === "clear") { display.value = ""; resultBox.classList.add("hidden"); resultBox.textContent = ""; return; }
    if (btn.dataset.act === "back") { display.value = display.value.slice(0, -1); return; }
    if (btn.dataset.act === "eq") {
      try {
        let expr = display.value.trim().replace(/\^/g, "**").replace(/%/g, "/100");
        if (!expr) return;
        const deg = x => x * Math.PI / 180;
        const fn = new Function("sin","cos","tan","sqrt","log","ln","PI",`"use strict";return (${expr})`);
        const result = fn(x=>Math.sin(deg(x)), x=>Math.cos(deg(x)), x=>Math.tan(deg(x)), Math.sqrt, Math.log10, Math.log, Math.PI);
        if (!Number.isFinite(result)) throw new Error("Invalid result");
        resultBox.classList.remove("hidden");
        resultBox.textContent = result;
        display.value = String(result);
      } catch { resultBox.classList.remove("hidden"); resultBox.textContent = "Invalid expression"; }
      return;
    }
    if (btn.dataset.op) { display.value += btn.dataset.op; return; }
    if (btn.dataset.k) { display.value += btn.dataset.k; return; }
  });
})();

// Currency converter (open.er-api.com - free, no API key, ~160 currencies incl. MYR)
(function(){
  const CURRENCIES = ["USD","EUR","GBP","JPY","MYR","SGD","CNY","AUD","CAD","HKD","KRW","INR","THB","IDR","TWD","CHF","NZD"];
  const fromSel = $("currFrom"), toSel = $("currTo"), out = $("currResult");
  fromSel.innerHTML = CURRENCIES.map(c=>`<option ${c==="USD"?"selected":""}>${c}</option>`).join("");
  toSel.innerHTML = CURRENCIES.map(c=>`<option ${c==="MYR"?"selected":""}>${c}</option>`).join("");
  $("currRun").onclick = async () => {
    const v = parseFloat($("currValue").value), from = fromSel.value, to = toSel.value;
    if (Number.isNaN(v)) { out.textContent = "Enter a valid amount."; return; }
    out.textContent = "Loading rate...";
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
      if (!res.ok) throw new Error(`Rate service returned ${res.status}`);
      const data = await res.json();
      if (data.result !== "success" || !data.rates || !(to in data.rates)) throw new Error("Rate not available for this currency pair.");
      const converted = v * data.rates[to];
      out.textContent = `${v} ${from} = ${Number(converted.toFixed(4))} ${to}`;
    } catch (err) { out.textContent = "Could not fetch exchange rate: " + (err.message || "check your connection and try again."); }
  };
})();

// Study timer (Pomodoro-style countdown)
(function(){
  const disp = $("timerDisplay");
  let totalSeconds = 5*60, remaining = totalSeconds, tickHandle = null, running = false;
  function render(){ const m=Math.floor(remaining/60), s=remaining%60; disp.textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`; }
  function setMinutes(mins){
    clearInterval(tickHandle); running=false; $("timerStart").textContent="Start";
    totalSeconds=remaining=mins*60; render();
  }
  render();
  document.querySelectorAll("[data-timer-preset]").forEach(btn=>{
    btn.onclick = () => { $("timerCustomRow").classList.add("hidden"); setMinutes(Number(btn.dataset.timerPreset)); };
  });
  $("timerOtherBtn").onclick = () => { $("timerCustomRow").classList.toggle("hidden"); };
  $("timerCustomSet").onclick = () => {
    const mins = parseInt($("timerCustomMinutes").value, 10);
    if (!mins || mins < 1) { alert("Enter a whole number of minutes (1 or more)."); return; }
    setMinutes(mins);
    $("timerCustomRow").classList.add("hidden");
  };
  $("timerStart").onclick = () => {
    if (running) { clearInterval(tickHandle); running=false; $("timerStart").textContent="Start"; return; }
    running = true; $("timerStart").textContent="Pause";
    tickHandle = setInterval(()=>{
      remaining--;
      if (remaining <= 0) { clearInterval(tickHandle); running=false; $("timerStart").textContent="Start"; remaining=0; render(); alert("Time's up!"); return; }
      render();
    }, 1000);
  };
  $("timerReset").onclick = () => { clearInterval(tickHandle); running=false; $("timerStart").textContent="Start"; remaining=totalSeconds; render(); };
})();


// Calendar (stored locally in this browser)
(function(){
  const KEY = "family-memories-calendar-events-v1";
  let events = {}; try { events = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { events = {}; }
  let viewDate = new Date();
  const grid = $("calendarGrid"), label = $("calMonthLabel"), list = $("calEventList");
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(events)); } catch {} }
  function dateKey(y,m,d){ return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
  function render(){
    const y = viewDate.getFullYear(), m = viewDate.getMonth();
    label.textContent = viewDate.toLocaleDateString(undefined, {month:"long", year:"numeric"});
    const firstDow = new Date(y,m,1).getDay(), daysInMonth = new Date(y,m+1,0).getDate();
    let html = ["S","M","T","W","T","F","S"].map(d=>`<div class="cal-day empty-cell"><b>${d}</b></div>`).join("");
    for (let i=0;i<firstDow;i++) html += `<div class="cal-day empty-cell"></div>`;
    for (let d=1; d<=daysInMonth; d++){
      const key = dateKey(y,m,d);
      html += `<div class="cal-day${events[key]?.length ? " has-event" : ""}" data-date="${key}">${d}</div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll("[data-date]").forEach(cell => cell.onclick = () => { $("calEventDate").value = cell.dataset.date; renderEventList(); });
    renderEventList();
  }
  function renderEventList(){
    const allDates = Object.keys(events).filter(k=>events[k].length).sort();
    if (!allDates.length) { list.textContent = "No events yet."; return; }
    list.innerHTML = allDates.map(date => `<div style="margin-bottom:8px"><b>${date}</b><br>${events[date].map((title,i)=>`${escapeHtml(title)} <button data-del-date="${date}" data-del-idx="${i}" style="border:0;background:none;color:#dc2626;cursor:pointer">✕</button>`).join("<br>")}</div>`).join("");
    list.querySelectorAll("[data-del-date]").forEach(btn=>btn.onclick=()=>{
      events[btn.dataset.delDate].splice(Number(btn.dataset.delIdx),1);
      if (!events[btn.dataset.delDate].length) delete events[btn.dataset.delDate];
      save(); render();
    });
  }
  $("calPrevMonth").onclick = () => { viewDate.setMonth(viewDate.getMonth()-1); render(); };
  $("calNextMonth").onclick = () => { viewDate.setMonth(viewDate.getMonth()+1); render(); };
  $("calAddEvent").onclick = () => {
    const title = $("calEventTitle").value.trim(), date = $("calEventDate").value;
    if (!title || !date) { alert("Please enter both an event title and a date."); return; }
    (events[date] ||= []).push(title);
    save(); $("calEventTitle").value = ""; render();
  };
  render();
})();

// Study Tools: 9-icon grid <-> individual tool panel (contained entirely
// within the existing Study Tools tab; doesn't touch page navigation).
const studyChromeEls = () => document.querySelectorAll("#studyPage .page-hero-photo, #studyPage .hub-card-row, #studyPage .study-tools-heading");
function showToolIconGrid(){
  $("toolPanelsWrap").classList.add("hidden");
  $("toolIconGrid").classList.remove("hidden");
  document.querySelectorAll("#toolPanelsWrap .tool-card").forEach(p=>p.classList.add("hidden"));
  studyChromeEls().forEach(el=>el.classList.remove("hidden"));
  const periodicWrap = $("periodicImageWrap");
  if (periodicWrap) periodicWrap.classList.remove("landscape-view");
  if ($("periodicExitBtn")) $("periodicExitBtn").classList.add("hidden");
  document.body.style.overflow = "";
  $("studyPage").classList.remove("tool-open");
}
document.querySelectorAll("#toolIconGrid [data-tool]").forEach(btn=>btn.onclick=()=>{
  $("toolIconGrid").classList.add("hidden");
  $("toolPanelsWrap").classList.remove("hidden");
  document.querySelectorAll("#toolPanelsWrap .tool-card").forEach(p=>p.classList.toggle("hidden", p.id !== `toolPanel-${btn.dataset.tool}`));
  studyChromeEls().forEach(el=>el.classList.add("hidden"));
  $("studyPage").classList.add("tool-open");
  window.scrollTo({top:0,behavior:"smooth"});
});
if ($("toolPanelBackBtn")) $("toolPanelBackBtn").onclick = showToolIconGrid;


// Dictionary - dictionaryapi.dev (free, no key) for languages it supports;
// Chinese and Malay aren't in its coverage, so those two fall back to a
// free translation lookup (MyMemory) showing an English translation
// instead of a full definition.
(function(){
  const TRANSLATE_ONLY = { "zh-CN": "Chinese", "ms-MY": "Malay" };
  $("dictRun").onclick = async () => {
    const word = $("dictWord").value.trim();
    const out = $("dictResult");
    const lang = $("dictLang").value;
    if (!word) { out.textContent = "Type a word first."; return; }
    out.textContent = "Looking up...";

    if (TRANSLATE_ONLY[lang]) {
      try {
        const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${lang}|en`);
        if (!res.ok) throw new Error(`Translation service returned ${res.status}`);
        const data = await res.json();
        if (data.responseStatus && Number(data.responseStatus) !== 200) throw new Error(data.responseDetails || `Translation service returned status ${data.responseStatus}`);
        const translated = data?.responseData?.translatedText;
        if (!translated) throw new Error("No translation found");
        out.innerHTML = `<b>${escapeHtml(word)}</b> (${TRANSLATE_ONLY[lang]}) →<br><br>${escapeHtml(translated)}<br><br><span style="font-size:12px;color:var(--muted)">Full dictionary definitions aren't available for this language yet - showing an English translation instead.</span>`;
      } catch (err) { out.textContent = "Could not translate that word: " + (err.message || "check your connection and try again."); }
      return;
    }

    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/${lang}/${encodeURIComponent(word)}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      const entry = data[0];
      const parts = entry.meanings.map(m => `<b>${m.partOfSpeech}</b>: ${m.definitions.slice(0,2).map(d=>d.definition).join("; ")}`).join("<br><br>");
      out.innerHTML = `<b>${entry.word}</b>${entry.phonetic?` (${entry.phonetic})`:""}<br><br>${parts}`;
    } catch { out.textContent = "No definition found for that word in this language."; }
  };
  $("dictClear").onclick = () => { $("dictWord").value = ""; $("dictResult").textContent = "Definitions will appear here"; };
})();

// Grammar checker (LanguageTool public API - free)
(function(){
  $("grammarRun").onclick = async () => {
    const text = $("grammarInput").value.trim();
    const out = $("grammarResult");
    if (!text) { out.textContent = "Type or paste some text first."; return; }
    out.textContent = "Checking...";
    try {
      const res = await fetch("https://api.languagetool.org/v2/check", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `text=${encodeURIComponent(text)}&language=en-US`
      });
      if (!res.ok) throw new Error("Check failed");
      const data = await res.json();
      if (!data.matches.length) { out.textContent = "No issues found - looks good!"; return; }
      out.innerHTML = data.matches.slice(0,10).map(m => `<div style="margin-bottom:8px"><b>"${text.slice(m.offset,m.offset+m.length)}"</b> - ${m.message}${m.replacements.length?` (suggestion: ${m.replacements.slice(0,3).map(r=>r.value).join(", ")})`:""}</div>`).join("");
    } catch { out.textContent = "Could not reach the grammar checking service. Check your connection and try again."; }
  };
  $("grammarClear").onclick = () => { $("grammarInput").value = ""; $("grammarResult").textContent = "Suggestions will appear here"; };
})();

// Periodic table - "landscape view" toggle (rotates via CSS transform,
// since real orientation-lock APIs aren't supported on iOS Safari)
(function(){
  const wrap = $("periodicImageWrap");
  function exitLandscape(){
    wrap.classList.remove("landscape-view");
    $("periodicExitBtn").classList.add("hidden");
    document.body.style.overflow = "";
  }
  $("periodicRotateBtn").onclick = () => {
    wrap.classList.add("landscape-view");
    $("periodicExitBtn").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  };
  $("periodicExitBtn").onclick = exitLandscape;
})();

// OCR - Photo to text (Tesseract.js, loaded lazily on first use, runs fully in-browser)
(function(){
  let tesseractLoaded = false;
  function loadTesseract(){
    if (tesseractLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js";
      s.onload = () => { tesseractLoaded = true; resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  $("ocrFile").onchange = async () => {
    const file = $("ocrFile").files[0];
    const out = $("ocrResult"), label = $("ocrFileLabel");
    if (!file) return;
    label.textContent = `Selected: ${file.name}`;
    out.textContent = "Loading OCR engine...";
    try {
      await loadTesseract();
      out.textContent = "Reading text from image... this can take a moment.";
      const { data } = await Tesseract.recognize(file, "eng");
      out.textContent = data.text.trim() || "No text detected in that image.";
    } catch (err) {
      out.textContent = "OCR failed: " + (err.message || "could not process image.");
    }
  };
})();
const units={
 length:{m:1,km:1000,cm:.01,mm:.001,in:.0254,ft:.3048,mi:1609.344},
 mass:{kg:1,g:.001,mg:.000001,lb:.45359237,oz:.028349523125},
 volume:{L:1,mL:.001,"US cup":.2365882365,tbsp:.0147867648,tsp:.00492892159},
 temperature:{C:"C",F:"F",K:"K"}
};
function fillUnits(){
 const type=$("convertType").value, keys=Object.keys(units[type]);
 $("convertFrom").innerHTML=keys.map(x=>`<option>${x}</option>`).join("");
 $("convertTo").innerHTML=keys.map((x,i)=>`<option ${i===1?"selected":""}>${x}</option>`).join("");
 convert();
}
function convert(){
 const type=$("convertType").value,v=parseFloat($("convertValue").value),from=$("convertFrom").value,to=$("convertTo").value;
 if(Number.isNaN(v)) return $("convertResult").textContent="";
 let out;
 if(type!=="temperature") out=v*units[type][from]/units[type][to];
 else{
   let c=from==="C"?v:from==="F"?(v-32)*5/9:v-273.15;
   out=to==="C"?c:to==="F"?c*9/5+32:c+273.15;
 }
 $("convertResult").textContent=`${v} ${from} = ${Number(out.toPrecision(10))} ${to}`;
}
["convertType","convertValue","convertFrom","convertTo"].forEach(id=>$(id).addEventListener(id==="convertValue"?"input":"change",id==="convertType"?fillUnits:convert));
fillUnits();


// Latest mockup top profile-photo bridge
document.addEventListener("DOMContentLoaded", () => {
  const topBtn = document.getElementById("topProfilePhotoBtn");
  const topImg = document.getElementById("topProfilePhotoImage");
  const topFallback = document.getElementById("topProfilePhotoFallback");
  const originalBtn = document.getElementById("profilePhotoBtn");
  const originalImg = document.getElementById("profilePhotoImage");
  const originalFallback = document.getElementById("profilePhotoFallback");

  if (topBtn && originalBtn) topBtn.addEventListener("click", () => originalBtn.click());

  const syncTopProfile = () => {
    if (!topImg || !originalImg) return;
    if (originalImg.src && !originalImg.classList.contains("hidden")) {
      topImg.src = originalImg.src;
      topImg.classList.remove("hidden");
      if (topFallback) topFallback.classList.add("hidden");
    } else {
      topImg.classList.add("hidden");
      if (topFallback) {
        topFallback.classList.remove("hidden");
        topFallback.textContent = "👤";
      }
    }
  };

  if (originalImg) {
    new MutationObserver(syncTopProfile).observe(originalImg, {attributes:true, attributeFilter:["src","class"]});
  }
  setTimeout(syncTopProfile, 500);
  setTimeout(syncTopProfile, 1500);
});


// Approved 2026 mobile navigation and utility pages
let activePage = "home";
const originalNavigate = navigate;
navigate = function(page){
  activePage = page;
  originalNavigate(page);
};

function loadProfilePage(){
  if(!currentProfile || !currentUser) return;
  $("profileDisplayName").textContent=currentProfile.name||"Family Member";
  $("profileDisplayEmail").textContent=currentProfile.email||currentUser.email||"";
  $("profileLargeFallback").textContent=initials(currentProfile.name||currentUser.email);
  $("familyAdminShortcut").classList.toggle("hidden",currentProfile.role!=="admin");
  loadProfilePhoto();
}

document.querySelectorAll("[data-study-tab]").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll("[data-study-tab]").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  const showTools = btn.dataset.studyTab==="tools";
  $("studyMaterialsPanel").classList.toggle("hidden", showTools);
  $("studyToolsPanel").classList.toggle("hidden", !showTools);
  if (showTools) showToolIconGrid();
});

if($("profileEditPhoto")) $("profileEditPhoto").onclick=()=>$("profilePhotoInput").click();
if($("profileSignOut")) $("profileSignOut").onclick=signOut;
if($("familyAdminShortcut")) $("familyAdminShortcut").onclick=()=>navigate("admin");
if($("changePasswordShortcut")) $("changePasswordShortcut").onclick=()=>{showView("authView");showAuthForm("forgot");};
if($("settingsShortcut")) $("settingsShortcut").onclick=()=>{
  $("settingsDisplayName").value = currentProfile?.name || "";
  $("settingsDialog").showModal();
};
if($("closeSettingsDialog")) $("closeSettingsDialog").onclick=()=>$("settingsDialog").close();
if($("cancelSettingsDialog")) $("cancelSettingsDialog").onclick=()=>$("settingsDialog").close();
if($("settingsForm")) $("settingsForm").onsubmit=async e=>{
  e.preventDefault();
  const name=$("settingsDisplayName").value.trim();
  if(!name) return toast("Please enter a name.");
  const {error}=await client.from("profiles").update({name}).eq("id",currentUser.id);
  if(error) return toast(error.message);
  currentProfile.name=name;
  $("welcomeText").textContent=`Welcome, ${name}`;
  $("userBadge").textContent=`${initials(name)}  ${name}`;
  if($("profileDisplayName")) $("profileDisplayName").textContent=name;
  toast("Settings saved.");
  $("settingsDialog").close();
};
if($("notificationBtn")) $("notificationBtn").onclick=()=>toast("Activity notifications will appear here.");

if($("globalSearch")) $("globalSearch").addEventListener("input",async e=>{
  const q=e.target.value.trim();
  const out=$("searchResults");
  if(q.length<2){out.innerHTML='<div class="empty">Type at least 2 characters.</div>';return;}
  out.innerHTML='<div class="empty">Searching…</div>';
  const {data,error}=await client.from("folders").select("*").ilike("name",`%${q}%`).order("created_at",{ascending:false});
  if(error){out.innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return;}
  if(!data?.length){out.innerHTML='<div class="empty">No matching folders found.</div>';return;}
  out.innerHTML=data.map(f=>`<article class="folder-card search-hit" data-search-section="${f.section}" data-search-id="${f.id}"><div class="folder-icon">📁</div><div class="folder-info"><h3>${escapeHtml(f.name)}</h3><p>${escapeHtml(f.section)} · ${escapeHtml(f.description||"")}</p></div></article>`).join("");
  out.querySelectorAll(".search-hit").forEach(card=>card.onclick=()=>navigate(card.dataset.searchSection));
});

/* ===================== Memories Hub: aggregated photo slideshow + video gallery ===================== */

const VIDEO_EXTENSIONS = ["mp4","mov","m4v","webm","avi","mkv","3gp"];
function isVideoPath(path){
  if(!path) return false;
  const ext = path.split(".").pop().toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

// Fetch every item (with a file attached) across one or more section types, newest first.
// Optionally scoped to a single folder id (used for homepage auto-cover selection).
async function fetchMediaItems(types, folderId){
  if(!folderId && mediaIndexCache.items && (Date.now()-mediaIndexCache.loaded)<300000){
    return mediaIndexCache.items.filter(i=>types.includes(i._type));
  }
  let all = [];
  for(const type of types){
    const table = tableMap[type];
    if(!table) continue;
    let query = client.from(table).select("*").not("file_path","is",null).order("created_at",{ascending:false});
    if(folderId) query = query.eq("folder_id",folderId);
    const {data,error} = await query;
    if(error) continue;
    if(data) all = all.concat(data.map(d=>({...d,_type:type})));
  }
  all.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  if(!folderId){
    mediaIndexCache.items=all;
    mediaIndexCache.loaded=Date.now();
  }
  return all;
}

const signedUrlCache = new Map();
const slideshowDataCache = new Map();
const mediaIndexCache = {items:null, loaded:0};

async function signMediaItems(items){
  return Promise.all(items.map(async item=>{
    try{
      const cached = signedUrlCache.get(item.file_path);
      if(cached && cached.expiry > Date.now()){
        return {...item, signedUrl: cached.url};
      }
      const {data} = await b2Storage.createSignedUrl(item.file_path,3600);
      if(data?.signedUrl){
        signedUrlCache.set(item.file_path,{
          url:data.signedUrl,
          expiry:Date.now()+55*60*1000
        });
      }
      return {...item, signedUrl: data?.signedUrl||null};
    }catch(e){
      return {...item, signedUrl: null};
    }
  }));
}


async function preloadSlideshowImages(items){
  const queue = items.slice(0,30);
  queue.forEach(item=>{
    if(!item.signedUrl) return;
    const img=new Image();
    img.decoding="async";
    img.loading="eager";
    img.src=item.signedUrl;
  });
}

const MEDIA_TYPES_ALL = ["memory","trip","celebration"];
let currentMediaSection = null; // 'memory' | 'trip' | 'celebration' | null

let slideshowPrefetchStarted=false;
async function warmSlideshowCache(){
  if(slideshowPrefetchStarted) return;
  slideshowPrefetchStarted=true;
  try{
    const items=await fetchMediaItems(MEDIA_TYPES_ALL);
    const photos=items.filter(i=>!isVideoPath(i.file_path)).slice(0,60);
    const signed=await signMediaItems(photos);
    preloadSlideshowImages(signed.filter(i=>i.signedUrl));
  }catch(e){}
}

/* ---- Photo slideshow ---- */
let slideshowPhotos = [];
let slideshowIndex = 0;
let slideshowTimer = null;
let slideshowPlaying = true;
let slideshowFallbackLabel = "";
let lastSlideUrl = "";
const musicStoragePath = (key) => `${currentUser.id}/app-settings/slideshow-music-${key||"all"}`;
let slideshowMusicKey = "all";
let slideshowHasMusic = false;

async function loadSlideshowMusic(key){
  const audio = $("slideshowMusic");
  try{
    const {data,error} = await b2Storage.createSignedUrl(musicStoragePath(key),3600);
    if(error || !data?.signedUrl){
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      return false;
    }
    audio.src = data.signedUrl;
    return true;
  }catch(e){
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    return false;
  }
}
function updateMusicBtn(){
  const btn = $("slideshowMusicBtn");
  const audio = $("slideshowMusic");
  if(!btn || !audio) return;

  btn.classList.remove("has-music","muted");

  if(!audio.src) return; // grey: no music loaded

  if(audio.paused){
    btn.classList.add("muted"); // white: loaded but paused
  }else{
    btn.classList.add("has-music"); // blue: playing
  }
}
const musicBtn = $("slideshowMusicBtn");

if(musicBtn){

  musicBtn.addEventListener("click",()=>{

    if(!slideshowHasMusic){
      $("slideshowMusicInput").click();
      return;
    }

    const audio=$("slideshowMusic");

    if(audio.paused){
      audio.play().catch(()=>{});
    }else{
      audio.pause();
    }

    updateMusicBtn();

  });

}
if($("slideshowMusicUploadBtn")) $("slideshowMusicUploadBtn").addEventListener("click",()=>{
  $("slideshowMusicInput").click();
});
if($("slideshowMusicInput")) $("slideshowMusicInput").onchange=async(e)=>{
  const file = e.target.files[0];
  e.target.value="";
  if(!file) return;
  toast("Uploading music…");
  const {error} = await b2Storage.upload(musicStoragePath(slideshowMusicKey),file,{upsert:true,contentType:file.type});
  if(error){ toast(error.message); return; }
  toast("Music added — it'll play for this collection's slideshows.");
  slideshowHasMusic = await loadSlideshowMusic(slideshowMusicKey);
  if(slideshowHasMusic && !$("slideshowOverlay").classList.contains("hidden")){
    $("slideshowMusic").currentTime=0;
    $("slideshowMusic").play().catch(()=>{});
  }
  updateMusicBtn();
};

async function foldersById(){
  const {data,error} = await client.from("folders").select("id,name");
  const map={};
  if(!error && data) data.forEach(f=>{ map[f.id]=f.name; });
  return map;
}

let slideshowHideTimer=null;
function showControls(){
  const ov=$("slideshowOverlay");
  ov.classList.remove("hide-controls");
  clearTimeout(slideshowHideTimer);
  slideshowHideTimer=setTimeout(()=>ov.classList.add("hide-controls"),3000);
}
function toggleControls(){
  const ov=$("slideshowOverlay");
  if(ov.classList.contains("hide-controls")) showControls();
  else{ ov.classList.add("hide-controls"); clearTimeout(slideshowHideTimer); }
}
let slideshowOpenToken = 0;
let slideshowActiveKey = null;
async function openSlideshow(types,label){
  const requestedKey = JSON.stringify(types) + "|" + (label||"");
  if(slideshowActiveKey === requestedKey && !$("slideshowOverlay").classList.contains("hidden") && slideshowPhotos.length){
    // Already actively showing this exact section - don't silently re-fetch/rebuild mid-playback
    showControls();
    return;
  }
  slideshowActiveKey = requestedKey;
  const myToken = ++slideshowOpenToken; // invalidates any earlier in-flight call
  slideshowMusicKey = (types && types.length===1) ? types[0] : "all";
  lockBodyScroll();
  $("slideshowOverlay").classList.remove("hidden");
  $("slideshowEmpty").classList.add("hidden");
  $("slideshowEmpty").textContent = "No photos found in this collection yet.";
  $("slideshowImage").classList.add("hidden");
  slideshowFallbackLabel = label || "";
  if($("slideshowTitle")) $("slideshowTitle").textContent = label ? `Playing: ${label}` : "";
  $("slideshowCounter").textContent="Loading…";
  try{
    const items = await fetchMediaItems(types);
    if(myToken !== slideshowOpenToken) return; // a newer call has taken over, abandon this one
    const photoItems = items.filter(i=>!isVideoPath(i.file_path));
    const [signed, folderNames] = await Promise.all([
      signMediaItems(photoItems),
      foldersById()
    ]);
    if(myToken !== slideshowOpenToken) return;
    slideshowPhotos = signed.filter(i=>i.signedUrl).map(i=>{
      const sectionTitle = SECTION_META[i._type]?.title || label || "";
      const folderName = i.folder_id ? folderNames[i.folder_id] : null;
      return {...i,_label: folderName ? `${sectionTitle} - ${folderName}` : sectionTitle};
    });
  }catch(e){
    if(myToken !== slideshowOpenToken) return;
    $("slideshowEmpty").textContent = "Couldn't load photos — check your connection and try again.";
    $("slideshowEmpty").classList.remove("hidden");
    $("slideshowCounter").textContent="";
    return;
  }
  slideshowIndex = 0;
  slideshowPlaying = true;
  if(!slideshowPhotos.length){
    $("slideshowEmpty").classList.remove("hidden");
    $("slideshowCounter").textContent="";
    return;
  }
  lastSlideUrl = "";
  showSlide(0);

  // Start loading music in parallel.
  const musicPromise = loadSlideshowMusic(slideshowMusicKey);

  // Wait until the first image is actually visible before starting the timer.
  while(!slideshowImageReady){
    await new Promise(r=>setTimeout(r,50));
    if(myToken !== slideshowOpenToken) return;
  }

  slideshowPhotos.slice(1,4).forEach(p=>{
    const preload=new Image();
    preload.src=p.signedUrl;
  });

  // Continue preloading remaining images in the background.
  setTimeout(()=>preloadSlideshowImages(slideshowPhotos.slice(4)),0);

  setPlayPauseIcon();
  startSlideshowTimer();
  showControls();

  slideshowHasMusic = await musicPromise;
  if(myToken !== slideshowOpenToken) return;
  updateMusicBtn();
  if(slideshowHasMusic){
    const audio=$("slideshowMusic");
    audio.currentTime=0;
    const playNow=()=>audio.play().catch(()=>{});
    if(document.visibilityState==="visible"){
      requestAnimationFrame(playNow);
    }else{
      playNow();
    }
  }
}

let slideshowLoadToken = 0;
let slideshowImageReady = true;
function showSlide(i){
  if(!slideshowPhotos.length) return;
  slideshowIndex=(i+slideshowPhotos.length)%slideshowPhotos.length;
  const photo=slideshowPhotos[slideshowIndex];
  const img=$("slideshowImage");
  const token=++slideshowLoadToken;
  if(lastSlideUrl===photo.signedUrl){
    $("slideshowCounter").textContent=`${slideshowIndex+1} / ${slideshowPhotos.length}`;
    if($("slideshowTitle")) $("slideshowTitle").textContent=photo._label||slideshowFallbackLabel||"";
    slideshowImageReady = true;
    return;
  }
  lastSlideUrl=photo.signedUrl;
  slideshowImageReady = false;

  img.onload = null;
  img.onerror = null;

  img.classList.add("hidden");
  img.style.transition = "none";
  img.style.opacity = "0";

  requestAnimationFrame(() => {
    if (token !== slideshowLoadToken) return;

    img.onload = () => {
      if (token !== slideshowLoadToken) return;

      requestAnimationFrame(() => {
        img.classList.remove("hidden");
        img.style.transition = "opacity .35s ease";
        img.style.opacity = "1";
        slideshowImageReady = true;
      });
    };

    img.onerror = () => {
      if (token === slideshowLoadToken) slideshowImageReady = true;
    };

    img.src = photo.signedUrl;
  });
  $("slideshowCounter").textContent=`${slideshowIndex+1} / ${slideshowPhotos.length}`;
  if($("slideshowTitle")) $("slideshowTitle").textContent=photo._label||slideshowFallbackLabel||"";
}
function setPlayPauseIcon(){
  $("slideshowPlayPause").innerHTML = slideshowPlaying
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
}
function startSlideshowTimer(){
  clearTimeout(slideshowTimer);
  if(!slideshowPlaying) return;
  slideshowTimer = setTimeout(function tick(){
    if(!slideshowPlaying){ return; }
    if(document.hidden){
      slideshowTimer = setTimeout(tick,4000);
      return;
    }
    if(!slideshowImageReady){
      // current photo (e.g. first-time load on a slow connection) hasn't finished loading yet -
      // recheck shortly instead of racing ahead to the next photo
      slideshowTimer = setTimeout(tick,300);
      return;
    }
    showSlide(slideshowIndex+1);
    slideshowTimer = setTimeout(tick,4000);
  },4000);
}
document.addEventListener("visibilitychange",()=>{
  if(document.hidden){
    clearTimeout(slideshowTimer);
  }else if(slideshowPlaying && !$("slideshowOverlay").classList.contains("hidden")){
    startSlideshowTimer(); // resume with a fresh full interval, never a burst of missed ticks
  }
});
function closeSlideshow(){
  slideshowOpenToken++;
  slideshowActiveKey = null;
  clearTimeout(slideshowTimer);
  clearTimeout(slideshowHideTimer);
  $("slideshowOverlay").classList.add("hidden");
  $("slideshowOverlay").classList.remove("hide-controls");
  $("slideshowImage").src="";
  lastSlideUrl="";
  const music=$("slideshowMusic");
  music.pause(); music.currentTime=0;
  unlockBodyScroll();
}
$("slideshowClose").onclick=closeSlideshow;
$("slideshowDelete").onclick=async()=>{
  if(!slideshowPhotos.length) return;
  const photo = slideshowPhotos[slideshowIndex];
  if(!confirm(`Delete "${photo.title||"this photo"}"? This cannot be undone.`)) return;
  const table = tableMap[photo._type];
  if(!table) return;
  const {error} = await client.from(table).delete().eq("id",photo.id);
  if(error){ toast(error.message); return; }
  if(photo.file_path){
    await b2Storage.remove([photo.file_path]);
  }
  slideshowPhotos.splice(slideshowIndex,1);
  mediaIndexCache.items=null;
  toast("Photo deleted.");
  if(!slideshowPhotos.length){
    clearTimeout(slideshowTimer);
    const music=$("slideshowMusic");
    music.pause(); music.currentTime=0;
    $("slideshowImage").classList.add("hidden");
    $("slideshowImage").src="";
    $("slideshowEmpty").classList.remove("hidden");
    $("slideshowCounter").textContent="";
    if($("slideshowTitle")) $("slideshowTitle").textContent="";
    return;
  }
  showSlide(slideshowIndex);
};
$("slideshowPlayPause").onclick=()=>{
  slideshowPlaying=!slideshowPlaying;
  setPlayPauseIcon();
  if(slideshowPlaying) startSlideshowTimer(); else clearTimeout(slideshowTimer);
  if(slideshowHasMusic){
    const music=$("slideshowMusic");
    if(slideshowPlaying) music.play().catch(()=>{}); else music.pause();
    updateMusicBtn();
  }
};
// Swipe left/right, and tap-to-toggle controls
(function(){
  let startX=null, wasSwipe=false, lastSwipeAt=0;
  const stage=document.querySelector(".slideshow-stage");
  stage.addEventListener("touchstart",e=>{ startX=e.touches[0].clientX; wasSwipe=false; },{passive:true});
  stage.addEventListener("touchend",e=>{
    if(startX===null) return;
    const dx = e.changedTouches[0].clientX - startX;
    const now = Date.now();
    if(Math.abs(dx)>40 && (now-lastSwipeAt)>450){
      lastSwipeAt = now;
      wasSwipe=true;
      dx<0 ? showSlide(slideshowIndex+1) : showSlide(slideshowIndex-1);
      startSlideshowTimer();
      showControls();
    }
    startX=null;
  });
  stage.addEventListener("click",()=>{
    if(wasSwipe){ wasSwipe=false; return; }
    toggleControls();
  });
  const toolbar=$("slideshowToolbar");
  if(toolbar) toolbar.addEventListener("pointerdown",()=>showControls());
})();

/* ---- Video gallery + player ---- */
async function openVideoGallery(types,label){
  lockBodyScroll();
  $("videoOverlay").classList.remove("hidden");
  $("videoPlayerWrap").classList.add("hidden");
  $("videoGalleryList").classList.remove("hidden");
  if($("videoGalleryTitle")) $("videoGalleryTitle").textContent = label || "Videos";
  $("videoGalleryList").innerHTML='<div class="empty">Loading…</div>';
  const items = await fetchMediaItems(types);
  const videoItems = items.filter(i=>isVideoPath(i.file_path));
  const signed = await signMediaItems(videoItems);
  const playable = signed.filter(i=>i.signedUrl);
  if(!playable.length){
    $("videoGalleryList").innerHTML='<div class="empty">No videos found in this collection yet.</div>';
    return;
  }
  $("videoGalleryList").innerHTML = playable.map((v,i)=>`<button class="video-gallery-item" data-video-index="${i}"><span class="video-thumb"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><span class="video-gallery-title">${escapeHtml(v.title||"Untitled video")}</span></button>`).join("");
  $("videoGalleryList").querySelectorAll("[data-video-index]").forEach(btn=>{
    btn.onclick=()=>{
      const v = playable[Number(btn.dataset.videoIndex)];
      $("videoGalleryList").classList.add("hidden");
      $("videoPlayerWrap").classList.remove("hidden");
      if($("videoPlayerTitle")) $("videoPlayerTitle").textContent = `Playing: ${label ? label+" – " : ""}${v.title||"Untitled video"}`;
      const el=$("videoPlayerEl");
      el.src=v.signedUrl;
      el.load();
      const tryPlay=()=>el.play().catch(()=>{});
      tryPlay();
      el.addEventListener("loadedmetadata",tryPlay,{once:true});
    };
  });
}
function closeVideoOverlay(){
  $("videoOverlay").classList.add("hidden");
  const el=$("videoPlayerEl");
  el.pause(); el.removeAttribute("src"); el.load();
  unlockBodyScroll();
}
$("videoOverlayClose").onclick=closeVideoOverlay;
$("videoPlayerBack").onclick=()=>{
  const el=$("videoPlayerEl");
  el.pause();
  $("videoPlayerWrap").classList.add("hidden");
  $("videoGalleryList").classList.remove("hidden");
};

/* ---- Navigation wiring for the hub ---- */
const SECTION_META = {
  memory:{title:"Our Memories",art:"🖼️💗",cls:"hub-blue"},
  trip:{title:"Family Trips",art:"🧳📷",cls:"hub-pink"},
  celebration:{title:"Celebrations",art:"🎈🎉",cls:"hub-purple"}
};
document.querySelectorAll("[data-hub-section]").forEach(btn=>btn.onclick=()=>{
  currentMediaSection = btn.dataset.hubSection;
  const meta = SECTION_META[currentMediaSection];
  $("mediaSectionTitle").textContent = meta.title;
  $("mediaSectionArt").textContent = meta.art;
  ["hub-blue","hub-pink","hub-purple"].forEach(c=>{
    $("mediaSectionPhotosBtn").classList.remove(c);
    $("mediaSectionVideosBtn").classList.remove(c);
  });
  $("mediaSectionPhotosBtn").classList.add(meta.cls);
  $("mediaSectionVideosBtn").classList.add(meta.cls);
  navigate("mediaSection");
});
document.querySelectorAll("[data-hub-action]").forEach(btn=>btn.onclick=()=>{
  const action = btn.dataset.hubAction;
  if(action==="all-photos") openSlideshow(MEDIA_TYPES_ALL,"All Photos");
  else if(action==="all-videos") openVideoGallery(MEDIA_TYPES_ALL,"All Videos");
  else if(action==="section-photos") openSlideshow([currentMediaSection],SECTION_META[currentMediaSection]?.title);
  else if(action==="section-videos") openVideoGallery([currentMediaSection],SECTION_META[currentMediaSection]?.title);
});
