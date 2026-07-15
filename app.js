const cfg = window.APP_CONFIG;
const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
let currentUser = null, currentProfile = null, currentAddType = "memory";

const $ = id => document.getElementById(id);
const views = ["authView","pendingView","appView"];
const pages = ["home","memories","trips","celebrations","study","admin"];
const tableMap = {memory:"memories",trip:"trips",celebration:"celebrations",study:"study_materials"};

function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600)}
function showView(id){views.forEach(v=>$(v).classList.toggle("hidden",v!==id))}
function initials(name){return (name||"?").split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase()}

document.querySelectorAll("[data-auth-tab]").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll("[data-auth-tab]").forEach(x=>x.classList.remove("active")); btn.classList.add("active");
  $("signInForm").classList.toggle("hidden",btn.dataset.authTab!=="signin");
  $("signUpForm").classList.toggle("hidden",btn.dataset.authTab!=="signup");
});

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
  if(!currentUser){currentProfile=null;showView("authView");return}
  await loadProfile();
}
client.auth.getSession().then(({data})=>handleSession(data.session));
client.auth.onAuthStateChange((_event,session)=>setTimeout(()=>handleSession(session),0));


const sectionType = {memories:"memory",trips:"trip",celebrations:"celebration",study:"study"};
const folderTarget = {memories:"memoriesFolders",trips:"tripsFolders",celebrations:"celebrationsFolders",study:"studyFolders"};
const browserTarget = {memories:"memoriesBrowser",trips:"tripsBrowser",celebrations:"celebrationsBrowser",study:"studyBrowser"};
let currentFolderSection = null;
let currentFolder = null;

function navigate(page){
  pages.forEach(p=>$(p+"Page").classList.toggle("hidden",p!==page));
  document.querySelectorAll(".nav-item[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  $("pageTitle").textContent=({home:"Home",memories:"Our Memories",trips:"Family Trips",celebrations:"Celebration",study:"Study Hub",admin:"Family Admin"})[page];
  document.querySelector(".sidebar").classList.remove("open");
  if(sectionType[page]) { currentFolder=null; loadFolders(page); }
  if(page==="admin") loadMembers();
}
document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>navigate(b.dataset.page));
document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>navigate(b.dataset.go));
$("mobileMenu").onclick=()=>document.querySelector(".sidebar").classList.toggle("open");

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

$("addForm").onsubmit=async e=>{
  e.preventDefault();
  if(!currentFolder) return toast("Open a folder first.");
  const table=tableMap[currentAddType], files=[...$("itemFile").files];
  try{
    let file_path=null;
    if(files[0]){
      const safe=files[0].name.replace(/[^a-zA-Z0-9._-]/g,"_");
      file_path=`${currentUser.id}/${currentFolder.id}/${Date.now()}-${safe}`;
      const up=await client.storage.from(cfg.STORAGE_BUCKET).upload(file_path,files[0]);
      if(up.error) throw up.error;
    }
    const payload={title:$("itemTitle").value,description:$("itemDescription").value||null,user_id:currentUser.id,folder_id:currentFolder.id};
    if($("itemDate").value) payload.event_date=$("itemDate").value;
    if(file_path) payload.file_path=file_path;
    const {error}=await client.from(table).insert(payload);
    if(error) throw error;
    $("addDialog").close(); toast("Saved successfully.");
    openFolder(currentFolderSection,currentFolder);
  }catch(err){console.error(err);toast(err.message||"Could not save item.")}
};

async function loadFolderItems(type,folderId,target){
  $(target).innerHTML='<div class="empty">Loading…</div>';
  const table=tableMap[type];
  const {data,error}=await client.from(table).select("*").eq("folder_id",folderId).order("created_at",{ascending:false});
  if(error){$(target).innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}
  if(!data?.length){$(target).innerHTML='<div class="empty">This folder is empty. Add the first item or file.</div>';return}
  $(target).innerHTML=data.map(item=>`<article class="content-card">
    <div class="meta">${item.event_date||new Date(item.created_at).toLocaleDateString()}</div>
    <h3>${escapeHtml(item.title||"Untitled")}</h3>
    <p>${escapeHtml(item.description||"")}</p>
    ${item.file_path?`<button class="secondary file-link" data-file="${encodeURIComponent(item.file_path)}">Open file</button>`:""}
  </article>`).join("");
  document.querySelectorAll(`#${target} [data-file]`).forEach(btn=>btn.onclick=()=>openPrivateFile(decodeURIComponent(btn.dataset.file)));
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
