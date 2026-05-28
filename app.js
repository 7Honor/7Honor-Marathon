
(function(){
  "use strict";

  const C = window.RUNPILOT_CONFIG || {};
  const Icons = window.RunPilotIcons || {};
  let supabaseClient = null;
  let session = null;
  let appState = null;
  let syncStatus = "guest";
  let chart = null;

  const todayISO = () => new Date().toISOString().slice(0,10);
  const n = (v, fallback=0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const pct = (a,b) => b > 0 ? Math.max(0, Math.min(100, Math.round(a/b*100))) : 0;
  const uid = () => Math.random().toString(36).slice(2,10);
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

  function defaultState(){
    const d = todayISO();
    return {
      version: 16,
      settings: { theme:"light", guestMode:false },
      profile: {
        name:"",
        sex:"male",
        age:27,
        heightCm:165,
        weightKg:71.5,
        activityFactor:1.35
      },
      usmle: {
        dailyQuestionTarget:40,
        dailyAnkiTarget:300,
        blocks:{},
        systems:[
          "Mixed","Cardio","Pulmo","Renal","GI","Endocrine","Neuro","Biochem","Micro","Pharm","Pathology","Immunology","Biostats","Ethics"
        ]
      },
      calories: {
        logs: {
          [d]: {
            calories:0,
            calorieTarget:2200,
            protein:0,
            proteinTarget:140,
            fat:0,
            fatTarget:60,
            carbs:0,
            carbsTarget:220,
            weight:71.5
          }
        }
      },
      running: {
        goalName:"Персональная цель",
        goalDate:"",
        weeklyTargetKm:50,
        plan:[],
        logs:{}
      },
      updatedAt: new Date().toISOString()
    };
  }

  function mergeState(saved){
    const base = defaultState();
    return {
      ...base,
      ...saved,
      settings:{...base.settings, ...(saved?.settings||{})},
      profile:{...base.profile, ...(saved?.profile||{})},
      usmle:{...base.usmle, ...(saved?.usmle||{}), blocks: saved?.usmle?.blocks || {}},
      calories:{...base.calories, ...(saved?.calories||{}), logs: saved?.calories?.logs || base.calories.logs},
      running:{...base.running, ...(saved?.running||{}), logs: saved?.running?.logs || {}, plan: saved?.running?.plan || []}
    };
  }

  function readLocal(){
    try { return mergeState(JSON.parse(localStorage.getItem(C.localKey) || "null")); }
    catch { return defaultState(); }
  }

  function writeLocal(){
    appState.updatedAt = new Date().toISOString();
    localStorage.setItem(C.localKey, JSON.stringify(appState));
  }

  function isGuest(){
    return localStorage.getItem(C.guestKey) === "1" || appState?.settings?.guestMode;
  }

  function setGuestMode(on){
    localStorage.setItem(C.guestKey, on ? "1" : "0");
    if(appState){
      appState.settings.guestMode = !!on;
      writeLocal();
    }
  }

  async function initSupabase(){
    if(!window.supabase || !C.supabaseUrl || !C.supabaseKey){
      syncStatus = "guest";
      return;
    }
    supabaseClient = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
      auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
    });
    const { data } = await supabaseClient.auth.getSession();
    session = data.session || null;
    supabaseClient.auth.onAuthStateChange(async (_event, s) => {
      session = s || null;
      if(session){
        setGuestMode(false);
        await loadState();
      }else{
        appState = readLocal();
      }
      render();
    });
  }

  async function loadState(){
    appState = readLocal();
    if(!supabaseClient || !session || isGuest()){
      syncStatus = isGuest() ? "guest" : "local";
      return;
    }
    try{
      const { data, error } = await supabaseClient
        .from(C.stateTable)
        .select("data, updated_at")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if(error) throw error;

      if(data?.data){
        appState = mergeState(data.data);
        writeLocal();
        syncStatus = "synced";
      }else{
        await saveState();
      }
    }catch(err){
      console.error("loadState", err);
      syncStatus = "error";
    }
  }

  let saveTimer = null;
  function scheduleSave(){
    writeLocal();
    renderSyncBadge();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 450);
  }

  async function saveState(){
    writeLocal();
    if(!supabaseClient || !session || isGuest()){
      syncStatus = isGuest() ? "guest" : "local";
      renderSyncBadge();
      return;
    }
    syncStatus = "syncing";
    renderSyncBadge();
    try{
      const { error } = await supabaseClient
        .from(C.stateTable)
        .upsert({
          user_id: session.user.id,
          data: appState,
          updated_at: new Date().toISOString()
        }, { onConflict:"user_id" });
      if(error) throw error;
      syncStatus = "synced";
    }catch(err){
      console.error("saveState", err);
      syncStatus = "error";
    }
    renderSyncBadge();
  }

  function icon(name, cls=""){
    return `<span class="icon ${cls}">${Icons[name] || ""}</span>`;
  }

  function topbar(){
    const page = document.body.dataset.page || "home";
    const links = [
      ["home","index.html","Главная"],
      ["usmle","usmle.html","USMLE"],
      ["calories","calories.html","Калораж"],
      ["run","run.html","Бег"],
      ["auth","auth.html","Аккаунт"]
    ];
    return `
      <header class="topbar">
        <div class="topbar-inner">
          <a class="brand" href="./index.html">
            <span class="brand-mark">${Icons.logo || "R"}</span>
            <span>RunPilot<small>USMLE · Калораж · Бег</small></span>
          </a>
          <nav class="nav" aria-label="Основная навигация">
            ${links.map(([id,href,label]) => `<a class="${page===id ? "active" : ""}" href="./${href}">${label}</a>`).join("")}
          </nav>
          <a id="syncBadge" class="auth-pill" href="./auth.html"><span class="dot"></span><span>...</span></a>
        </div>
      </header>
    `;
  }

  function pageShell(content){
    return `<div class="shell">${topbar()}<main class="main fade-in">${content}</main><footer class="footer">Создано Amankeldin Beibarys © 2026. Все права защищены.</footer></div>`;
  }

  function renderSyncBadge(){
    const el = $("#syncBadge");
    if(!el) return;
    let text = "Локально";
    let cls = "";
    if(syncStatus === "synced"){ text = "Синхронизировано"; cls="synced"; }
    if(syncStatus === "syncing"){ text = "Синхронизация..."; cls="synced"; }
    if(syncStatus === "guest"){ text = "Гость"; cls="guest"; }
    if(syncStatus === "local"){ text = "Войти"; cls="guest"; }
    if(syncStatus === "error"){ text = "Ошибка sync"; cls="error"; }
    if(session && syncStatus !== "error") text = session.user.email || text;
    el.className = `auth-pill ${cls}`;
    el.innerHTML = `<span class="dot"></span><span>${text}</span>`;
  }

  function getTodayUsmle(){
    const d = todayISO();
    const blocks = appState.usmle.blocks[d] || [];
    const q = blocks.reduce((s,b)=>s+n(b.questions),0);
    const correct = blocks.reduce((s,b)=>s+n(b.correct),0);
    const anki = blocks.reduce((s,b)=>s+n(b.anki),0);
    const reviewed = blocks.reduce((s,b)=>s+n(b.mistakesReviewed),0);
    return { q, correct, anki, reviewed, rate: q ? Math.round(correct/q*100) : 0, target: n(appState.usmle.dailyQuestionTarget,40), ankiTarget:n(appState.usmle.dailyAnkiTarget,300)};
  }

  function getTodayCalories(){
    const d=todayISO();
    const log = appState.calories.logs[d] || {};
    const prof = appState.profile;
    const weight = n(log.weight, n(prof.weightKg,71.5));
    const height = n(prof.heightCm,165);
    const age = n(prof.age,27);
    const sexAdd = prof.sex === "female" ? -161 : 5;
    const bmr = Math.round(10*weight + 6.25*height - 5*age + sexAdd);
    const baseBurn = Math.round(bmr * n(prof.activityFactor,1.35));
    const runBurn = getRunBurnForDate(d);
    const totalBurn = baseBurn + runBurn;
    const consumed = n(log.calories,0);
    const target = n(log.calorieTarget,2200);
    const remaining = target - consumed + runBurn;
    const deficit = totalBurn - consumed;
    return {log, weight, bmr, baseBurn, runBurn, totalBurn, consumed, target, remaining, deficit};
  }

  function getRunBurnForDate(date){
    const log = appState.running.logs[date] || {};
    const kg = n(appState.calories.logs[date]?.weight, n(appState.profile.weightKg,71.5));
    return Math.round(kg * n(log.km,0));
  }

  function getRunning(){
    const d=todayISO();
    const logs = appState.running.logs;
    const today = logs[d] || {};
    const weekKm = Object.entries(logs).filter(([date]) => isThisWeek(date)).reduce((s,[_,v])=>s+n(v.km),0);
    const todayPlan = findTodayPlan();
    return { today, todayPlan, weekKm, weeklyTarget:n(appState.running.weeklyTargetKm,50)};
  }

  function isThisWeek(dateStr){
    const dt = new Date(dateStr+"T00:00:00");
    const now = new Date();
    const day = (now.getDay()+6)%7;
    const monday = new Date(now); monday.setDate(now.getDate()-day); monday.setHours(0,0,0,0);
    const next = new Date(monday); next.setDate(monday.getDate()+7);
    return dt >= monday && dt < next;
  }

  function findTodayPlan(){
    const d=todayISO();
    return (appState.running.plan||[]).find(x=>x.date===d) || null;
  }

  function homePage(){
    const u = getTodayUsmle();
    const c = getTodayCalories();
    const r = getRunning();
    return pageShell(`
      <section class="hero">
        <h1>Выбери фронт.</h1>
        <p>Минимальная главная: три рабочих пространства. Никакой каши на одном экране.</p>
      </section>
      <section class="tiles">
        <a class="tile" href="./usmle.html">
          <div>
            <div class="tile-icon">${Icons.usmle}</div>
            <h2>USMLE</h2>
            <p>QBank, correct rate, Anki, ошибки и слабые системы.</p>
          </div>
          <div class="tile-metrics">
            <span class="metric-chip">${u.q}/${u.target} Q</span>
            <span class="metric-chip">${u.rate}% correct</span>
          </div>
        </a>
        <a class="tile" href="./calories.html">
          <div>
            <div class="tile-icon">${Icons.body}</div>
            <h2>Калораж</h2>
            <p>Вес, БЖУ, остаток калорий, базовый расход и учтённый бег.</p>
          </div>
          <div class="tile-metrics">
            <span class="metric-chip">${c.remaining} ккал осталось</span>
            <span class="metric-chip">${c.weight} кг</span>
          </div>
        </a>
        <a class="tile" href="./run.html">
          <div>
            <div class="tile-icon">${Icons.run}</div>
            <h2>Бег</h2>
            <p>План, факт, недельный объём и тренировка дня. Без калорий в интерфейсе бега.</p>
          </div>
          <div class="tile-metrics">
            <span class="metric-chip">${n(r.today.km,0)} км сегодня</span>
            <span class="metric-chip">${r.weekKm}/${r.weeklyTarget} км</span>
          </div>
        </a>
      </section>
    `);
  }

  function authPage(){
    return pageShell(`
      <section class="login-wrap">
        <div class="card login-card">
          <h1>Вход</h1>
          <p>Войди для Supabase-синхронизации или продолжи как гость. Гость хранит данные только в браузере.</p>
          <div class="status-note" id="authStatus">${session ? "Вы вошли: " + session.user.email : "Вы не вошли"}</div>
          <div style="height:16px"></div>
          <label>Email</label>
          <input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com">
          <div style="height:10px"></div>
          <label>Password</label>
          <input id="authPassword" type="password" autocomplete="current-password" placeholder="минимум 6 символов">
          <div class="actions">
            <button class="btn" id="loginBtn">Войти</button>
            <button class="btn secondary" id="registerBtn">Регистрация</button>
            <button class="btn secondary" id="guestBtn">Продолжить как гость</button>
            ${session ? `<button class="btn bad" id="logoutBtn">Выйти</button>` : ""}
          </div>
          ${session ? `<div class="actions"><button class="btn good" id="migrateBtn">Перенести локальные данные в аккаунт</button></div>` : ""}
        </div>
      </section>
    `);
  }

  function usmlePage(){
    const u=getTodayUsmle();
    const d=todayISO();
    const blocks = appState.usmle.blocks[d] || [];
    const systems = appState.usmle.systems || [];
    return pageShell(`
      <section class="hero">
        <h1>USMLE tracker.</h1>
        <p>Только отслеживание: вопросы, правильность, Anki, ошибки. Без учебника.</p>
      </section>
      <section class="grid">
        <div>
          <div class="card">
            <h2>Сегодня</h2>
            <div class="kpi">
              <div class="kpi-box"><strong>${u.q}/${u.target}</strong><span>QBank</span></div>
              <div class="kpi-box"><strong>${u.rate}%</strong><span>Correct</span></div>
              <div class="kpi-box"><strong>${u.anki}/${u.ankiTarget}</strong><span>Anki</span></div>
              <div class="kpi-box"><strong>${u.reviewed}</strong><span>Ошибки</span></div>
            </div>
            <div style="height:14px"></div>
            <div class="progress"><i style="width:${pct(u.q,u.target)}%"></i></div>
          </div>
          <div class="card">
            <h2>Добавить QBank-блок</h2>
            <div class="form-grid">
              <div><label>Система</label><select id="usmleSystem">${systems.map(s=>`<option>${s}</option>`).join("")}</select></div>
              <div><label>Режим</label><select id="usmleMode"><option>Timed</option><option>Tutor</option><option>Mixed</option><option>Incorrects</option></select></div>
              <div><label>Вопросов</label><input id="usmleQ" type="number" value="40"></div>
              <div><label>Правильно</label><input id="usmleCorrect" type="number" value="0"></div>
              <div><label>Anki сегодня</label><input id="usmleAnki" type="number" value="0"></div>
              <div><label>Ошибок разобрано</label><input id="usmleMistakes" type="number" value="0"></div>
            </div>
            <div style="height:12px"></div>
            <label>Заметка</label><textarea id="usmleNote" placeholder="Например: renal tubular acidosis, murmurs, autonomics..."></textarea>
            <div class="actions"><button class="btn" id="saveUsmleBlock">Сохранить блок</button></div>
          </div>
        </div>
        <div>
          <div class="card">
            <h2>Последние блоки</h2>
            <div class="table-list">
              ${blocks.length ? blocks.slice().reverse().map(b=>`
                <div class="item">
                  <div><b>${b.system} · ${b.mode}</b><small>${b.questions}Q · ${b.correct} correct · ${b.note || ""}</small></div>
                  <b>${b.questions ? Math.round(b.correct/b.questions*100) : 0}%</b>
                </div>
              `).join("") : `<p class="muted">Сегодня блоков ещё нет.</p>`}
            </div>
          </div>
          <div class="card">
            <h2>Цели</h2>
            <div class="form-grid">
              <div><label>QBank target</label><input id="qTarget" type="number" value="${u.target}"></div>
              <div><label>Anki target</label><input id="ankiTarget" type="number" value="${u.ankiTarget}"></div>
            </div>
            <div class="actions"><button class="btn secondary" id="saveUsmleTargets">Сохранить цели</button></div>
          </div>
        </div>
      </section>
    `);
  }

  function caloriesPage(){
    const d=todayISO();
    const c=getTodayCalories();
    const log=c.log;
    return pageShell(`
      <section class="hero">
        <h1>Калораж.</h1>
        <p>Здесь отображаются калории. Бег учитывается в расчёте, но не показывается в разделе бега.</p>
      </section>
      <section class="grid">
        <div>
          <div class="card">
            <h2>Сегодня</h2>
            <div class="kpi">
              <div class="kpi-box"><strong>${c.remaining}</strong><span>ккал осталось</span></div>
              <div class="kpi-box"><strong>${c.consumed}</strong><span>съел</span></div>
              <div class="kpi-box"><strong>${c.runBurn}</strong><span>бег учтён</span></div>
              <div class="kpi-box"><strong>${c.totalBurn}</strong><span>сожжено всего</span></div>
            </div>
          </div>
          <div class="card">
            <h2>Ввод</h2>
            <div class="form-grid">
              <div><label>Съел ккал</label><input id="caloriesIn" type="number" value="${n(log.calories,0)}"></div>
              <div><label>Цель ккал</label><input id="calorieTarget" type="number" value="${n(log.calorieTarget,2200)}"></div>
              <div><label>Вес, кг</label><input id="weightKg" type="number" step="0.1" value="${c.weight}"></div>
              <div><label>Белок, г</label><input id="protein" type="number" value="${n(log.protein,0)}"></div>
              <div><label>Жиры, г</label><input id="fat" type="number" value="${n(log.fat,0)}"></div>
              <div><label>Углеводы, г</label><input id="carbs" type="number" value="${n(log.carbs,0)}"></div>
            </div>
            <div class="actions"><button class="btn" id="saveCalories">Сохранить</button></div>
          </div>
        </div>
        <div>
          <div class="card">
            <h2>Расход</h2>
            <div class="row"><span>Базовый расход</span><b>${c.baseBurn} ккал</b></div>
            <div class="row"><span>Бег учтён</span><b>${c.runBurn} ккал</b></div>
            <div class="row"><span>Итого сожжено</span><b>${c.totalBurn} ккал</b></div>
            <div class="row"><span>Дефицит</span><b>${c.deficit} ккал</b></div>
          </div>
          <div class="card">
            <h2>Профиль расчёта</h2>
            <div class="form-grid">
              <div><label>Пол</label><select id="sex"><option value="male" ${appState.profile.sex==="male"?"selected":""}>Мужчина</option><option value="female" ${appState.profile.sex==="female"?"selected":""}>Женщина</option></select></div>
              <div><label>Возраст</label><input id="age" type="number" value="${n(appState.profile.age,27)}"></div>
              <div><label>Рост, см</label><input id="heightCm" type="number" value="${n(appState.profile.heightCm,165)}"></div>
              <div><label>Активность</label><input id="activityFactor" type="number" step="0.05" value="${n(appState.profile.activityFactor,1.35)}"></div>
            </div>
            <div class="actions"><button class="btn secondary" id="saveProfile">Сохранить профиль</button></div>
          </div>
        </div>
      </section>
    `);
  }

  function runPage(){
    const r=getRunning();
    const d=todayISO();
    const log=r.today;
    return pageShell(`
      <section class="hero">
        <h1>Бег.</h1>
        <p>План, факт и объём. Калории здесь не показываются, но расход считается для раздела калоража.</p>
      </section>
      <section class="grid">
        <div>
          <div class="card">
            <h2>Сегодня</h2>
            <div class="kpi">
              <div class="kpi-box"><strong>${n(log.km,0)}</strong><span>км факт</span></div>
              <div class="kpi-box"><strong>${r.todayPlan ? r.todayPlan.km : "—"}</strong><span>км план</span></div>
              <div class="kpi-box"><strong>${n(log.duration,0)}</strong><span>мин</span></div>
              <div class="kpi-box"><strong>${n(log.rpe,0)}</strong><span>RPE</span></div>
            </div>
          </div>
          <div class="card">
            <h2>Записать пробежку</h2>
            <div class="form-grid">
              <div><label>Км</label><input id="runKm" type="number" step="0.1" value="${n(log.km,0)}"></div>
              <div><label>Время, мин</label><input id="runDuration" type="number" value="${n(log.duration,0)}"></div>
              <div><label>RPE</label><input id="runRpe" type="number" min="1" max="10" value="${n(log.rpe,0)}"></div>
              <div><label>Тип</label><select id="runType"><option>Easy</option><option>Long</option><option>Tempo</option><option>Intervals</option><option>Recovery</option></select></div>
            </div>
            <div class="actions"><button class="btn" id="saveRun">Сохранить пробежку</button></div>
          </div>
        </div>
        <div>
          <div class="card">
            <h2>Недельный объём</h2>
            <div class="row"><span>Факт</span><b>${r.weekKm} км</b></div>
            <div class="row"><span>Цель</span><b>${r.weeklyTarget} км</b></div>
            <div class="progress"><i style="width:${pct(r.weekKm,r.weeklyTarget)}%"></i></div>
          </div>
          <div class="card">
            <h2>План</h2>
            <div class="form-grid">
              <div><label>Цель недели, км</label><input id="weeklyTargetKm" type="number" value="${r.weeklyTarget}"></div>
              <div><label>Цель / забег</label><input id="goalName" value="${appState.running.goalName || ""}"></div>
            </div>
            <div class="actions">
              <button class="btn secondary" id="saveRunSettings">Сохранить</button>
              <button class="btn secondary" id="createSimplePlan">Создать простой план</button>
            </div>
          </div>
          <div class="card">
            <h2>Ближайшие тренировки</h2>
            <div class="table-list">
              ${(appState.running.plan||[]).slice(0,5).map(p=>`
                <div class="item"><div><b>${p.date} · ${p.type}</b><small>${p.note||""}</small></div><b>${p.km} км</b></div>
              `).join("") || `<p class="muted">План ещё не создан.</p>`}
            </div>
          </div>
        </div>
      </section>
    `);
  }

  function bindEvents(){
    const page = document.body.dataset.page || "home";

    if(page==="auth"){
      $("#guestBtn")?.addEventListener("click", async ()=>{
        setGuestMode(true);
        syncStatus="guest";
        location.href="./index.html";
      });
      $("#loginBtn")?.addEventListener("click", authLogin);
      $("#registerBtn")?.addEventListener("click", authRegister);
      $("#logoutBtn")?.addEventListener("click", authLogout);
      $("#migrateBtn")?.addEventListener("click", async ()=>{
        setGuestMode(false);
        await saveState();
        alert("Локальные данные сохранены в аккаунт.");
        render();
      });
    }

    if(page==="usmle"){
      $("#saveUsmleBlock")?.addEventListener("click", ()=>{
        const d=todayISO();
        appState.usmle.blocks[d] = appState.usmle.blocks[d] || [];
        appState.usmle.blocks[d].push({
          id:uid(),
          system:$("#usmleSystem").value,
          mode:$("#usmleMode").value,
          questions:n($("#usmleQ").value),
          correct:n($("#usmleCorrect").value),
          anki:n($("#usmleAnki").value),
          mistakesReviewed:n($("#usmleMistakes").value),
          note:$("#usmleNote").value.trim(),
          createdAt:new Date().toISOString()
        });
        scheduleSave();
        render();
      });
      $("#saveUsmleTargets")?.addEventListener("click", ()=>{
        appState.usmle.dailyQuestionTarget = n($("#qTarget").value,40);
        appState.usmle.dailyAnkiTarget = n($("#ankiTarget").value,300);
        scheduleSave(); render();
      });
    }

    if(page==="calories"){
      $("#saveCalories")?.addEventListener("click", ()=>{
        const d=todayISO();
        appState.calories.logs[d] = {
          ...(appState.calories.logs[d]||{}),
          calories:n($("#caloriesIn").value),
          calorieTarget:n($("#calorieTarget").value,2200),
          weight:n($("#weightKg").value,n(appState.profile.weightKg,71.5)),
          protein:n($("#protein").value),
          fat:n($("#fat").value),
          carbs:n($("#carbs").value)
        };
        appState.profile.weightKg = appState.calories.logs[d].weight;
        scheduleSave(); render();
      });
      $("#saveProfile")?.addEventListener("click", ()=>{
        appState.profile.sex=$("#sex").value;
        appState.profile.age=n($("#age").value,27);
        appState.profile.heightCm=n($("#heightCm").value,165);
        appState.profile.activityFactor=n($("#activityFactor").value,1.35);
        scheduleSave(); render();
      });
    }

    if(page==="run"){
      $("#saveRun")?.addEventListener("click", ()=>{
        const d=todayISO();
        appState.running.logs[d] = {
          ...(appState.running.logs[d]||{}),
          km:n($("#runKm").value),
          duration:n($("#runDuration").value),
          rpe:n($("#runRpe").value),
          type:$("#runType").value,
          updatedAt:new Date().toISOString()
        };
        scheduleSave(); render();
      });
      $("#saveRunSettings")?.addEventListener("click", ()=>{
        appState.running.weeklyTargetKm = n($("#weeklyTargetKm").value,50);
        appState.running.goalName = $("#goalName").value.trim() || "Персональная цель";
        scheduleSave(); render();
      });
      $("#createSimplePlan")?.addEventListener("click", ()=>{
        createSimpleRunPlan();
        scheduleSave(); render();
      });
    }
  }

  async function authLogin(){
    if(!supabaseClient) return alert("Supabase client не загружен.");
    const email=$("#authEmail").value.trim();
    const password=$("#authPassword").value;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(error) return alert(error.message);
    setGuestMode(false);
    location.href="./index.html";
  }

  async function authRegister(){
    if(!supabaseClient) return alert("Supabase client не загружен.");
    const email=$("#authEmail").value.trim();
    const password=$("#authPassword").value;
    const { error } = await supabaseClient.auth.signUp({ email, password });
    if(error) return alert(error.message);
    alert("Регистрация создана. Если включено подтверждение email — проверь почту.");
  }

  async function authLogout(){
    if(supabaseClient) await supabaseClient.auth.signOut();
    session=null;
    setGuestMode(true);
    location.href="./auth.html";
  }

  function createSimpleRunPlan(){
    const plan=[];
    const start = new Date();
    const weekTarget = n(appState.running.weeklyTargetKm,50);
    const days = [
      ["Easy", .22],
      ["Tempo", .18],
      ["Easy", .20],
      ["Long", .40]
    ];
    for(let w=0; w<8; w++){
      const factor = w%4===3 ? .75 : 1 + w*.04;
      const weekly = Math.round(weekTarget * factor);
      [1,3,5,6].forEach((offset, idx)=>{
        const date = new Date(start);
        date.setDate(start.getDate() + w*7 + offset);
        plan.push({
          date: date.toISOString().slice(0,10),
          type: days[idx][0],
          km: Math.max(3, Math.round(weekly * days[idx][1])),
          note: idx===3 ? "Длинная тренировка" : "Контроль пульса"
        });
      });
    }
    appState.running.plan=plan;
  }

  function render(){
    if(!appState) appState = readLocal();
    document.documentElement.dataset.theme = appState.settings.theme || "light";
    const page = document.body.dataset.page || "home";
    if(page==="home") document.body.innerHTML = homePage();
    if(page==="auth") document.body.innerHTML = authPage();
    if(page==="usmle") document.body.innerHTML = usmlePage();
    if(page==="calories") document.body.innerHTML = caloriesPage();
    if(page==="run") document.body.innerHTML = runPage();
    if(["plan","week","calendar","stats"].includes(page)) document.body.innerHTML = homePage();
    renderSyncBadge();
    bindEvents();
  }

  async function init(){
    try{
      appState = readLocal();
      await initSupabase();
      await loadState();
      render();
    }catch(err){
      console.error("init",err);
      appState = readLocal();
      syncStatus="error";
      render();
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
