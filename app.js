const cfg = window.APP_CONFIG;

// Keep the Supabase session only for the current browser tab/session.
// Refreshing the page keeps the login, but opening the app again after the
// tab/browser session has ended requires a new sign-in.
const client = window.supabase.createClient(
  cfg.SUPABASE_URL,
  cfg.SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      storage: window.sessionStorage,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

// One-time cleanup of any old persistent Supabase login left in localStorage
// by earlier versions of this app.
const sessionMigrationKey = "family-memories-session-storage-v1";
if (!sessionStorage.getItem(sessionMigrationKey)) {
  Object.keys(localStorage)
    .filter(key => key.startsWith("sb-") && key.endsWith("-auth-token"))
    .forEach(key => localStorage.removeItem(key));
  sessionStorage.setItem(sessionMigrationKey, "done");
}
let currentUser = null, currentProfile = null, currentAddType = "memory";

const $ = id => document.getElementById(id);
const views = ["authView","pendingView","appView"];
const pages = ["home","memories","trips","celebrations","study","search","profile","admin"];
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
$("backToSignInBtn").onclick=()=>showAuthForm("signin");

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
async function signOut(){await client.auth.signOut()}
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

function navigate(page){
  pages.forEach(p=>$(p+"Page").classList.toggle("hidden",p!==page));
  document.querySelectorAll(".nav-item[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  document.querySelectorAll(".mobile-nav-item[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  $("pageTitle").textContent=({home:"Home",memories:"Our Memories",trips:"Family Trips",celebrations:"Celebrations",study:"Study Hub",search:"Search",profile:"Profile",admin:"Family Admin"})[page];
  document.querySelector(".sidebar").classList.remove("open");
  if(sectionType[page]) { currentFolder=null; loadFolders(page); }
  if(page==="admin") loadMembers();
  if(page==="home") loadHomeExperience();
  if(page==="profile") loadProfilePage();
}
document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>navigate(b.dataset.page));
document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>navigate(b.dataset.go));
if($("mobileMenu")) $("mobileMenu").onclick=()=>document.querySelector(".sidebar")?.classList.toggle("open");

document.querySelectorAll(".open-folder").forEach(b=>b.onclick=()=>{
  currentFolderSection=b.dataset.section;
  $("folderForm").reset();
  $("folderDialogTitle").textContent="New Folder";
  $("folderDialog").showModal();
});
$("closeFolderDialog").onclick=$("cancelFolderDialog").onclick=()=>$("folderDialog").close();

$("folderForm").onsubmit=async e=>{
  e.preventDefault();
  const payload={
    name:$("folderName").value.trim(),
    description:$("folderDescription").value.trim()||null,
    section:currentFolderSection,
    created_by:currentUser.id
  };
  const {error}=await client.from("folders").insert(payload);
  if(error) return toast(error.message);
  $("folderDialog").close();
  toast("Folder created.");
  loadFolders(currentFolderSection);
};

async function loadFolders(section){
  const target=folderTarget[section], browser=browserTarget[section];
  $(browser).classList.add("hidden");
  $(browser).innerHTML="";
  $(target).classList.remove("hidden");
  $(target).innerHTML='<div class="empty">Loading folders…</div>';
  const {data,error}=await client.from("folders").select("*").eq("section",section).order("created_at",{ascending:false});
  if(error){$(target).innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}
  if(!data?.length){$(target).innerHTML='<div class="empty">No folders yet. Create your first folder.</div>';return}
  $(target).innerHTML=data.map(f=>`<article class="folder-card" data-folder="${f.id}">
    <div class="folder-icon">📁</div>
    <div class="folder-info"><h3>${escapeHtml(f.name)}</h3><p>${escapeHtml(f.description||"Open folder")}</p></div>
    <button class="folder-menu secondary" data-menu="${f.id}" title="Folder options">•••</button>
  </article>`).join("");
  document.querySelectorAll(`#${target} [data-folder]`).forEach(card=>card.onclick=e=>{
    if(e.target.closest("[data-menu]")) return;
    openFolder(section,data.find(f=>f.id===card.dataset.folder));
  });
  document.querySelectorAll(`#${target} [data-menu]`).forEach(btn=>btn.onclick=e=>{
    e.stopPropagation();
    const f=data.find(x=>x.id===btn.dataset.menu);
    folderActions(section,f);
  });
}

async function folderActions(section,folder){
  const action=prompt(`Folder: ${folder.name}\nType R to rename or D to delete.`);
  if(!action) return;
  if(action.toLowerCase()==="r"){
    const name=prompt("New folder name:",folder.name);
    if(!name?.trim()) return;
    const {error}=await client.from("folders").update({name:name.trim(),updated_at:new Date().toISOString()}).eq("id",folder.id);
    if(error) toast(error.message); else {toast("Folder renamed.");loadFolders(section)}
  } else if(action.toLowerCase()==="d"){
    if(!confirm(`Delete "${folder.name}"? Files/items will remain but will no longer be inside this folder.`)) return;
    const {error}=await client.from("folders").delete().eq("id",folder.id);
    if(error) toast(error.message); else {toast("Folder deleted.");loadFolders(section)}
  }
}

async function openFolder(section,folder){
  currentFolderSection=section; currentFolder=folder;
  const target=folderTarget[section], browser=browserTarget[section], type=sectionType[section];
  $(target).classList.add("hidden");
  $(browser).classList.remove("hidden");
  $(browser).innerHTML=`<div class="folder-toolbar">
    <button class="secondary back-folders">← All folders</button>
    <div><h2>${escapeHtml(folder.name)}</h2><p class="muted">${escapeHtml(folder.description||"")}</p></div>
    <button class="primary upload-folder">+ Add / Upload</button>
  </div><div id="${browser}Items" class="content-grid"></div>`;
  $(browser).querySelector(".back-folders").onclick=()=>loadFolders(section);
  $(browser).querySelector(".upload-folder").onclick=()=>openAddForFolder(type);
  loadFolderItems(type,folder.id,browser+"Items");
}

function openAddForFolder(type){
  currentAddType=type;
  $("dialogTitle").textContent=({memory:"Add to Memory Folder",trip:"Add to Family Trip Folder",celebration:"Add to Celebration Folder",study:"Upload Study Material"})[type];
  $("addForm").reset();
  $("addDialog").showModal();
}
$("closeDialog").onclick=$("cancelDialog").onclick=()=>$("addDialog").close();

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

    // Upload file/photo if selected
    if (files[0]) {
      const safe = files[0].name.replace(/[^a-zA-Z0-9._-]/g, "_");
      file_path = `${currentUser.id}/${currentFolder.id}/${Date.now()}-${safe}`;

      const { error: uploadError } = await client.storage
        .from(cfg.STORAGE_BUCKET)
        .upload(file_path, files[0]);

      if (uploadError) throw uploadError;
    }

    // Use file name as title automatically if title is empty
    const autoTitle = files[0]
      ? files[0].name.replace(/\.[^/.]+$/, "")
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

    toast("Saved successfully!");

    // Refresh folder immediately
    openFolder(currentFolderSection, currentFolder);

  } catch (err) {
    console.error(err);
    toast(err.message || "Could not save item.");
  }
};
async function loadFolderItems(type,folderId,target){
  $(target).innerHTML='<div class="empty">Loading…</div>';
  const table=tableMap[type];
  const {data,error}=await client.from(table).select("*").eq("folder_id",folderId).order("created_at",{ascending:false});
  if(error){$(target).innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}
  if(!data?.length){$(target).innerHTML='<div class="empty">This folder is empty. Add the first item or file.</div>';return}

  const items=await Promise.all(data.map(async item=>{
    let signedUrl=null;
    if(item.file_path){
      const {data:signed}=await client.storage.from(cfg.STORAGE_BUCKET).createSignedUrl(item.file_path,3600);
      signedUrl=signed?.signedUrl||null;
    }
    return {...item,signedUrl};
  }));

  $(target).innerHTML=items.map(item=>{
    const ext=(item.file_path||"").split(".").pop().toLowerCase();
    const isImage=["jpg","jpeg","png","gif","webp","bmp","svg","avif"].includes(ext);
    const media=item.file_path&&item.signedUrl
      ? isImage
        ? `<img class="content-preview" src="${item.signedUrl}" alt="${escapeHtml(item.title||"Uploaded image")}" data-file="${encodeURIComponent(item.file_path)}">`
        : `<button class="secondary file-link" data-file="${encodeURIComponent(item.file_path)}">Open file</button>`
      : "";
    return `<article class="content-card">
      ${media}
      <div class="meta">${item.event_date||new Date(item.created_at).toLocaleDateString()}</div>
      <h3>${escapeHtml(item.title||"Untitled")}</h3>
      ${item.description?`<p>${escapeHtml(item.description)}</p>`:""}
    </article>`;
  }).join("");
  document.querySelectorAll(`#${target} [data-file]`).forEach(el=>el.onclick=()=>openPrivateFile(decodeURIComponent(el.dataset.file)));
}
async function openPrivateFile(path){
  const {data,error}=await client.storage.from(cfg.STORAGE_BUCKET).createSignedUrl(path,60);
  if(error) return toast(error.message);
  window.open(data.signedUrl,"_blank","noopener");
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

async function loadMembers(){
  if(currentProfile?.role!=="admin") return;
  $("membersList").innerHTML="Loading…";
  const {data,error}=await client.from("profiles").select("id,name,email,role,status,created_at").order("created_at",{ascending:false});
  if(error){$("membersList").innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}
  $("membersList").innerHTML=data.map(m=>`<div class="member-row">
    <div><strong>${escapeHtml(m.name||m.email||"Unnamed member")}</strong><div class="small muted">${escapeHtml(m.email||"")} · ${escapeHtml(m.role||"member")} · ${escapeHtml(m.status||"pending")}</div></div>
    <div class="member-actions">${m.status!=="approved"?`<button class="primary approve-member" data-id="${m.id}">Approve</button>`:""}</div>
  </div>`).join("");
  document.querySelectorAll(".approve-member").forEach(b=>b.onclick=()=>approveMember(b.dataset.id));
}
async function approveMember(id){
  const {error}=await client.from("profiles").update({status:"approved"}).eq("id",id);
  if(error) toast(error.message); else {toast("Member approved.");loadMembers()}
}


// Warm family home experience
const DEFAULT_FAMILY_COVER = "https://images.unsplash.com/photo-1504151932400-72d4384f04b3?auto=format&fit=crop&w=1800&q=85";

const profileStoragePath = () => `${currentUser.id}/profile/profile-photo`;

async function loadProfilePhoto(){
  if(!currentUser) return;
  const img=$("profilePhotoImage"), fallback=$("profilePhotoFallback");
  if(!img || !fallback) return;
  const {data}=await client.storage.from(cfg.STORAGE_BUCKET).createSignedUrl(profileStoragePath(),3600);
  if(data?.signedUrl){
    img.src=data.signedUrl;
    img.classList.remove("hidden");
    fallback.classList.add("hidden");
  }else{
    img.classList.add("hidden");
    fallback.classList.remove("hidden");
  }
}

if($("profilePhotoBtn")) $("profilePhotoBtn").onclick=()=>$("profilePhotoInput").click();
if($("profilePhotoInput")) $("profilePhotoInput").onchange=async e=>{
  const file=e.target.files?.[0];
  if(!file || !currentUser) return;
  const {error}=await client.storage.from(cfg.STORAGE_BUCKET).upload(
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
}


async function loadFamilyCover(){
  const cover=$("coverImage");
  if(!cover) return;
  const {data}=await client.storage.from(cfg.STORAGE_BUCKET).createSignedUrl(coverStoragePath(),3600);
  cover.style.backgroundImage=`url("${data?.signedUrl||DEFAULT_FAMILY_COVER}")`;
}

if($("changeCoverBtn")) $("changeCoverBtn").onclick=()=>$("coverFileInput").click();
if($("coverFileInput")) $("coverFileInput").onchange=async e=>{
  const file=e.target.files?.[0];
  if(!file) return;
  if(!file.type.startsWith("image/")) return toast("Please choose an image file.");
  const {error}=await client.storage.from(cfg.STORAGE_BUCKET).upload(coverStoragePath(),file,{upsert:true,contentType:file.type});
  if(error) return toast(error.message);
  toast("Family cover updated.");
  await loadFamilyCover();
  await loadProfilePhoto();
  e.target.value="";
};



// v8 - camera top-right, centered, back button
const HOME_CARDS = ["memories","trips","celebrations","study"];
const cardLocalKey = (c) => `family-memories:card-full:${c}`;
const cardStoragePath = (c) => `${currentUser.id}/app-settings/card-full-${c}`;
function setCardImageDOM(card, src){
  const cardEl = document.querySelector(`.family-space-card.${card}-card`);
  const fullImg = document.querySelector(`[data-card-full="${card}"]`);
  if(!cardEl || !fullImg) return;
  if(src){
    fullImg.src = src;
    fullImg.classList.remove("hidden");
    cardEl.classList.add("has-custom");
  }else{
    fullImg.removeAttribute("src");
    fullImg.classList.add("hidden");
    cardEl.classList.remove("has-custom");
  }
}
async function loadCardImages(){
  const tasks = HOME_CARDS.map(async (card)=>{
    let src = null;
    const local = localStorage.getItem(cardLocalKey(card));
    if(local){ setCardImageDOM(card, local); }
    if(currentUser){
      try{
        const {data} = await client.storage.from(cfg.STORAGE_BUCKET).createSignedUrl(cardStoragePath(card), 86400);
        if(data?.signedUrl) src = data.signedUrl;
      }catch{}
    }
    if(src) setCardImageDOM(card, src);
  });
  await Promise.allSettled(tasks);
}
async function loadCardImages_old_UNUSED(){

  for(const card of HOME_CARDS){
    let src = null;
    if(currentUser){
      try{
        const {data} = await client.storage.from(cfg.STORAGE_BUCKET).createSignedUrl(cardStoragePath(card), 86400);
        if(data?.signedUrl) src = data.signedUrl;
      }catch{}
    }
    if(!src){
      const local = localStorage.getItem(cardLocalKey(card));
      if(local) src = local;
    }
    if(src) setCardImageDOM(card, src);
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
          const {error} = const toUpload = await compressImage(file);
          await client.storage.from(cfg.STORAGE_BUCKET).upload(cardStoragePath(card), toUpload, {upsert:true, contentType:file.type});
          if(error) toast("Saved locally. Cloud error: "+error.message);
          else { toast("Card image updated."); const {data}=await client.storage.from(cfg.STORAGE_BUCKET).createSignedUrl(cardStoragePath(card),86400); if(data?.signedUrl) setCardImageDOM(card,data.signedUrl); }
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



async function compressImage(file, maxW=900, quality=0.75){
  try{
    if(!file.type.startsWith("image/")) return file;
    if(file.size < 300*1024) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxW / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width * scale;
    canvas.height = bitmap.height * scale;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r=>canvas.toBlob(r,'image/jpeg',quality));
    if(!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\..+$/, '.jpg'), {type:'image/jpeg'});
  }catch{ return file; }
}


// Scientific calculator
$("calcRun").onclick=()=>{
  try{
    let expr=$("calcDisplay").value.trim().replace(/\^/g,"**");
    const deg=x=>x*Math.PI/180;
    const fn=new Function("sin","cos","tan","sqrt","log","ln","PI",`"use strict";return (${expr})`);
    const result=fn(x=>Math.sin(deg(x)),x=>Math.cos(deg(x)),x=>Math.tan(deg(x)),Math.sqrt,Math.log10,Math.log,Math.PI);
    if(!Number.isFinite(result)) throw new Error("Invalid result");
    $("calcResult").textContent=result;
  }catch{$("calcResult").textContent="Invalid expression"}
};
$("calcClear").onclick=()=>{$("calcDisplay").value="";$("calcResult").textContent="Result will appear here"};

// Converter
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
}

if($("quickAddBtn")) $("quickAddBtn").onclick=()=>$("quickAddDialog").showModal();
if($("closeQuickAdd")) $("closeQuickAdd").onclick=()=>$("quickAddDialog").close();
document.querySelectorAll("[data-quick-page]").forEach(btn=>btn.onclick=()=>{
  const page=btn.dataset.quickPage;
  $("quickAddDialog").close();
  navigate(page);
  setTimeout(()=>document.querySelector(`.open-folder[data-section="${page}"]`)?.click(),100);
});
if($("profileEditPhoto")) $("profileEditPhoto").onclick=()=>$("profilePhotoInput").click();
if($("profileSignOut")) $("profileSignOut").onclick=signOut;
if($("familyAdminShortcut")) $("familyAdminShortcut").onclick=()=>navigate("admin");
if($("changePasswordShortcut")) $("changePasswordShortcut").onclick=()=>{showView("authView");showAuthForm("forgot");};
if($("settingsShortcut")) $("settingsShortcut").onclick=()=>toast("Settings will be added here next.");
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
