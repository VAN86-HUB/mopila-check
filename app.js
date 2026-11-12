/* MOPILA CHECK — application web (client, chauffeur, propriétaire, agent, admin)
   Auteur : Ingénieur Van MUFWAR */
(() => {
  "use strict";

  const C = window.MOPILA_CONFIG;
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey);
  const app = document.getElementById("app");

  const MODES = { taxi_bus: "Taxi-bus", taxi: "Taxi", taxi_moto: "Taxi-moto" };
  const DOCS = {
    permis: "Permis de conduire",
    controle_technique: "Contrôle technique",
    assurance: "Assurance",
    autorisation_transport: "Autorisation de transport",
    vignette: "Vignette"
  };
  const ROLES = { client: "Client", chauffeur: "Chauffeur", proprietaire: "Propriétaire", agent: "Agent de contrôle", admin: "Administrateur" };
  const STATUTS_SIG = { nouveau: "Nouveau", en_verification: "En vérification", confirme: "Confirmé", rejete: "Rejeté" };
  const CACHE_KEY = "mopila_grille_v1";

  const etat = { session: null, profil: null, lieux: [], communes: [], tarifs: [], scanner: null };

  /* ---------- Outils ---------- */
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fc = (n) => (n == null ? "—" : Number(n).toLocaleString("fr-FR").replace(/ /g, " ") + " FC");
  const $ = (sel) => app.querySelector(sel);
  const dateFr = (d) => new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  const jourFr = (d) => new Date(d + "T00:00:00").toLocaleDateString("fr-FR");

  function toast(msg, erreur = false) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast" + (erreur ? " erreur" : "");
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 4000);
  }
  function erreur(e) { console.error(e); toast(e?.message || "Une erreur est survenue.", true); }

  function lieuNom(id) { return etat.lieux.find((l) => l.id === Number(id))?.nom || "—"; }
  function optionsLieux(sel) {
    return '<option value="">— Choisir —</option>' + etat.lieux
      .map((l) => `<option value="${l.id}" ${Number(sel) === l.id ? "selected" : ""}>${esc(l.nom)}${l.commune ? " (" + esc(l.commune) + ")" : ""}</option>`)
      .join("");
  }
  function optionsModes(sel) {
    return Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${sel === k ? "selected" : ""}>${v}</option>`).join("");
  }
  function prixLocal(dep, arr, mode) {
    return etat.tarifs.find((t) => t.depart_id === Number(dep) && t.arrivee_id === Number(arr) && t.mode === mode);
  }
  function params() {
    const q = location.hash.split("?")[1] || "";
    return Object.fromEntries(new URLSearchParams(q));
  }
  function aRole(...roles) { return etat.profil && roles.includes(etat.profil.role); }

  /* ---------- Grille (avec cache hors ligne) ---------- */
  async function chargerGrille() {
    try {
      const [l, c, t] = await Promise.all([
        sb.from("lieux").select("id, nom, commune_id, communes(nom)").order("nom"),
        sb.from("communes").select("id, nom").order("nom"),
        sb.from("tarifs_en_vigueur").select("*")
      ]);
      if (l.error || c.error || t.error) throw l.error || c.error || t.error;
      etat.lieux = l.data.map((x) => ({ id: x.id, nom: x.nom, commune_id: x.commune_id, commune: x.communes?.nom }));
      etat.communes = c.data;
      etat.tarifs = t.data;
      localStorage.setItem(CACHE_KEY, JSON.stringify({ lieux: etat.lieux, communes: etat.communes, tarifs: etat.tarifs, le: new Date().toISOString() }));
    } catch (e) {
      try {
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        if (cache) Object.assign(etat, { lieux: cache.lieux, communes: cache.communes, tarifs: cache.tarifs });
      } catch (_) { /* cache illisible */ }
    }
  }

  async function chargerProfil() {
    const { data } = await sb.auth.getSession();
    etat.session = data.session;
    etat.profil = null;
    if (etat.session) {
      const { data: p } = await sb.from("profils").select("*").eq("id", etat.session.user.id).maybeSingle();
      etat.profil = p;
    }
  }

  /* ---------- Vue : Prix ---------- */
  function vuePrix() {
    const p = params();
    app.innerHTML = `
      <p class="eyebrow">Grille tarifaire officielle</p>
      <h1>Quel est le bon prix ?</h1>
      <p class="muted">Choisissez votre trajet : le tarif fixé par l’arrêté provincial s’affiche, même sans connexion.</p>
      <div class="card">
        <label for="mode">Type de véhicule</label>
        <select id="mode">${optionsModes(p.mode || "taxi_bus")}</select>
        <label for="dep">Départ</label>
        <select id="dep">${optionsLieux(p.dep)}</select>
        <label for="arr">Arrivée</label>
        <select id="arr">${optionsLieux(p.arr)}</select>
        <button class="btn ligne" id="inverser" type="button">⇅ Inverser le trajet</button>
      </div>
      <div id="resultat"></div>
      <p class="footer-note">${etat.tarifs.length} tarif(s) officiel(s) enregistré(s) · ${etat.lieux.length} lieu(x)</p>`;

    const maj = () => {
      const dep = $("#dep").value, arr = $("#arr").value, mode = $("#mode").value;
      const r = $("#resultat");
      if (!dep || !arr) { r.innerHTML = ""; return; }
      if (dep === arr) { r.innerHTML = `<div class="card">Le départ et l’arrivée sont identiques.</div>`; return; }
      const t = prixLocal(dep, arr, mode);
      r.innerHTML = t
        ? `<div class="card dark">
             <p class="muted">${esc(lieuNom(dep))} → ${esc(lieuNom(arr))} · ${MODES[mode]}</p>
             <div class="prix-grand">${fc(t.prix_fc)}</div>
             <p class="muted">Selon : ${esc(t.arrete)} (en vigueur depuis le ${jourFr(t.date_effet)})</p>
             <a class="btn jaune" href="#/signaler?dep=${dep}&arr=${arr}&mode=${mode}">On me demande plus ? Signaler</a>
           </div>`
        : `<div class="card accent"><h3>Trajet pas encore dans la grille</h3>
             <p class="muted">Ce trajet n’a pas encore de tarif officiel dans MOPILA CHECK. Essayez un trajet proche ou un autre type de véhicule.</p></div>`;
    };
    ["#dep", "#arr", "#mode"].forEach((s) => $(s).addEventListener("change", maj));
    $("#inverser").addEventListener("click", () => { const d = $("#dep").value; $("#dep").value = $("#arr").value; $("#arr").value = d; maj(); });
    maj();
  }

  /* ---------- Vue : Vérifier un véhicule ---------- */
  function extraireCode(texte) {
    try { const u = new URL(texte); return u.searchParams.get("v") || texte.trim(); } catch (_) { return texte.trim(); }
  }

  async function vueVerifier() {
    const p = params();
    app.innerHTML = `
      <p class="eyebrow">Contrôle du véhicule</p>
      <h1>Ce véhicule est-il en règle ?</h1>
      <p class="muted">Scannez le QR code collé dans le véhicule, ou saisissez son code.</p>
      <div class="card">
        <div id="lecteur"></div>
        <button class="btn jaune" id="scanner" type="button">📷 Scanner le QR code</button>
        <label for="code">Code du véhicule</label>
        <div class="row"><input id="code" placeholder="Code du QR" value="${esc(p.v || "")}"><button class="btn petit" id="chercher" type="button">OK</button></div>
      </div>
      <div id="resultat"></div>`;

    const verifier = async (code) => {
      code = extraireCode(code || "");
      if (!code) return;
      $("#code").value = code;
      const r = $("#resultat");
      r.innerHTML = `<div class="card">Vérification…</div>`;
      const { data, error } = await sb.rpc("verifier_vehicule", { p_qr: code });
      if (error) { r.innerHTML = ""; return erreur(error); }
      const v = data?.[0];
      if (!v) { r.innerHTML = `<div class="card accent"><h3>Code inconnu</h3><p class="muted">Ce QR code n’est pas enregistré dans MOPILA CHECK. Soyez prudent.</p></div>`; return; }
      const ok = v.agree && v.chauffeur_conforme;
      r.innerHTML = `
        <div class="card ${ok ? "dark" : "accent"}">
          <p class="muted">${MODES[v.mode]}</p>
          <h2>${esc(v.plaque)}</h2>
          <p>Véhicule : <span class="badge ${v.agree ? "ok" : "ko"}">${v.agree ? "Agréé" : "Non agréé"}</span></p>
          <p>Chauffeur : ${esc(v.chauffeur_nom || "non déclaré")} <span class="badge ${v.chauffeur_conforme ? "ok" : "ko"}">${v.chauffeur_conforme ? "Chauffeur conforme" : "Non conforme"}</span></p>
          <p>Signalements confirmés : <b>${v.signalements_confirmes}</b></p>
          <a class="btn ${ok ? "jaune" : ""}" href="#/signaler?plaque=${encodeURIComponent(v.plaque)}&mode=${v.mode}">Signaler un abus sur ce véhicule</a>
        </div>`;
    };

    $("#chercher").addEventListener("click", () => verifier($("#code").value));
    $("#code").addEventListener("keydown", (e) => { if (e.key === "Enter") verifier($("#code").value); });
    $("#scanner").addEventListener("click", async () => {
      if (!window.Html5Qrcode) return toast("Le scanner n’a pas pu se charger. Saisissez le code.", true);
      try {
        await arreterScanner();
        etat.scanner = new Html5Qrcode("lecteur");
        await etat.scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, async (texte) => {
          await arreterScanner();
          verifier(texte);
        });
      } catch (e) { erreur({ message: "Impossible d’ouvrir la caméra : " + (e?.message || e) }); }
    });
    if (p.v) verifier(p.v);
  }

  async function arreterScanner() {
    if (etat.scanner) {
      try { await etat.scanner.stop(); etat.scanner.clear(); } catch (_) { /* déjà arrêté */ }
      etat.scanner = null;
    }
  }

  /* ---------- Vue : Signaler ---------- */
  function besoinConnexion(titre) {
    app.innerHTML = `
      <h1>${titre}</h1>
      <div class="card accent"><p>Connectez-vous pour continuer. C’est gratuit et rapide.</p>
      <a class="btn" href="#/compte?retour=${encodeURIComponent(location.hash)}">Se connecter ou créer un compte</a></div>`;
  }

  function vueSignaler() {
    if (!etat.session) return besoinConnexion("Signaler un abus");
    const p = params();
    app.innerHTML = `
      <p class="eyebrow">Signalement</p>
      <h1>On vous a demandé plus que le tarif officiel ?</h1>
      <form class="card" id="form">
        <label for="mode">Type de véhicule</label>
        <select id="mode" required>${optionsModes(p.mode || "taxi_bus")}</select>
        <label for="plaque">Plaque du véhicule</label>
        <input id="plaque" required placeholder="Ex. 1234AB01" value="${esc(p.plaque || "")}">
        <div class="row">
          <div><label for="dep">Départ</label><select id="dep">${optionsLieux(p.dep)}</select></div>
          <div><label for="arr">Arrivée</label><select id="arr">${optionsLieux(p.arr)}</select></div>
        </div>
        <p id="officiel" class="muted"></p>
        <label for="prix">Prix demandé (FC)</label>
        <input id="prix" type="number" min="1" step="50" required inputmode="numeric">
        <label for="photo">Photo (facultatif)</label>
        <input id="photo" type="file" accept="image/*" capture="environment">
        <label for="com">Commentaire (facultatif)</label>
        <textarea id="com" placeholder="Heure, lieu, ce qui s’est passé…"></textarea>
        <button class="btn jaune" id="envoyer">Envoyer le signalement</button>
      </form>`;

    const maj = () => {
      const t = prixLocal($("#dep").value, $("#arr").value, $("#mode").value);
      $("#officiel").innerHTML = t ? `Prix officiel de ce trajet : <b>${fc(t.prix_fc)}</b>` : "";
    };
    ["#dep", "#arr", "#mode"].forEach((s) => $(s).addEventListener("change", maj));
    maj();

    $("#form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = $("#envoyer"); b.disabled = true;
      try {
        let photo_url = null;
        const f = $("#photo").files[0];
        if (f) {
          if (f.size > 5 * 1024 * 1024) throw new Error("La photo dépasse 5 Mo.");
          const ext = (f.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
          const chemin = `${etat.session.user.id}/${Date.now()}.${ext}`;
          const up = await sb.storage.from("photos").upload(chemin, f, { contentType: f.type });
          if (up.error) throw up.error;
          photo_url = chemin;
        }
        const { error } = await sb.from("signalements").insert({
          mode: $("#mode").value,
          plaque_saisie: $("#plaque").value.trim().toUpperCase(),
          depart_id: $("#dep").value || null,
          arrivee_id: $("#arr").value || null,
          prix_demande_fc: Number($("#prix").value),
          commentaire: $("#com").value.trim() || null,
          photo_url
        });
        if (error) throw error;
        toast("Merci ! Votre signalement a été envoyé aux agents de contrôle.");
        location.hash = "#/compte";
      } catch (err) { erreur(err); } finally { b.disabled = false; }
    });
  }

  /* ---------- Vue : Compte ---------- */
  async function vueCompte() {
    if (!etat.session) return vueConnexion();
    const p = etat.profil || {};
    const { data: sigs } = await sb.from("signalements")
      .select("id, plaque_saisie, mode, prix_demande_fc, prix_officiel_fc, statut, date_heure")
      .eq("client_id", etat.session.user.id).order("date_heure", { ascending: false }).limit(20);

    const espaces = [];
    if (aRole("chauffeur")) espaces.push(`<a class="btn" href="#/chauffeur">🚖 Mon espace chauffeur</a>`);
    if (aRole("proprietaire", "admin")) espaces.push(`<a class="btn" href="#/proprietaire">🚌 Mes véhicules</a>`);
    if (aRole("agent", "admin")) espaces.push(`<a class="btn jaune" href="#/admin">🛡️ Espace contrôle et administration</a>`);

    app.innerHTML = `
      <p class="eyebrow">Mon compte</p>
      <h1>Bonjour ${esc(p.nom || "")}</h1>
      <div class="card">
        <p><b>Rôle :</b> ${ROLES[p.role] || "—"}</p>
        <form id="profil">
          <label for="nom">Nom</label><input id="nom" value="${esc(p.nom || "")}">
          <label for="tel">Téléphone</label><input id="tel" value="${esc(p.telephone || "")}" inputmode="tel">
          <button class="btn ligne">Enregistrer</button>
        </form>
      </div>
      ${espaces.join("")}
      <div class="card" style="margin-top:16px">
        <h2>Mes signalements</h2>
        ${sigs?.length ? `<ul class="liste">${sigs.map((s) => `
          <li><div class="ligne-haut"><b>${esc(s.plaque_saisie || "—")}</b>${badgeStatut(s.statut)}</div>
          <div class="muted">${MODES[s.mode]} · demandé ${fc(s.prix_demande_fc)} · officiel ${fc(s.prix_officiel_fc)} · ${dateFr(s.date_heure)}</div></li>`).join("")}</ul>`
        : `<p class="muted">Aucun signalement pour l’instant.</p>`}
      </div>
      <button class="btn ligne" id="sortir">Se déconnecter</button>
      <p class="footer-note">${esc(C.appName)} · conçu par ${esc(C.auteur)} · ${esc(C.contact)}</p>`;

    $("#profil").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await sb.from("profils").update({ nom: $("#nom").value.trim(), telephone: $("#tel").value.trim() }).eq("id", etat.session.user.id);
      if (error) return erreur(error);
      await chargerProfil(); toast("Profil enregistré.");
    });
    $("#sortir").addEventListener("click", async () => { await sb.auth.signOut(); location.hash = "#/prix"; });
  }

  function badgeStatut(s) {
    const cls = s === "confirme" ? "ok" : s === "rejete" ? "ko" : "att";
    return `<span class="badge ${cls}">${STATUTS_SIG[s] || s}</span>`;
  }

  function vueConnexion() {
    const p = params();
    const inscription = p.mode === "inscription";
    app.innerHTML = `
      <p class="eyebrow">Mon compte</p>
      <h1>${inscription ? "Créer un compte" : "Se connecter"}</h1>
      <form class="card" id="form">
        ${inscription ? `
          <label for="nom">Nom complet</label><input id="nom" required>
          <label for="tel">Téléphone</label><input id="tel" inputmode="tel" placeholder="+243…">
          <label for="role">Je suis</label>
          <select id="role"><option value="client">Client (passager)</option><option value="chauffeur">Chauffeur</option><option value="proprietaire">Propriétaire de véhicules</option></select>` : ""}
        <label for="email">E-mail</label><input id="email" type="email" required autocomplete="email">
        <label for="mdp">Mot de passe</label><input id="mdp" type="password" required minlength="6" autocomplete="${inscription ? "new-password" : "current-password"}">
        <button class="btn" id="valider">${inscription ? "Créer mon compte" : "Se connecter"}</button>
      </form>
      <p style="text-align:center">${inscription
        ? `Déjà inscrit ? <a href="#/compte">Se connecter</a>`
        : `Pas encore de compte ? <a href="#/compte?mode=inscription">Créer un compte</a>`}</p>`;

    $("#form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = $("#valider"); b.disabled = true;
      try {
        const email = $("#email").value.trim(), password = $("#mdp").value;
        if (inscription) {
          const { data, error } = await sb.auth.signUp({
            email, password,
            options: {
              emailRedirectTo: location.origin + location.pathname,
              data: { nom: $("#nom").value.trim(), telephone: $("#tel").value.trim(), role: $("#role").value }
            }
          });
          if (error) throw error;
          if (!data.session) { toast("Compte créé. Ouvrez l’e-mail de confirmation, puis connectez-vous."); location.hash = "#/compte"; return; }
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
        await chargerProfil();
        location.hash = p.retour ? decodeURIComponent(p.retour) : "#/compte";
        route();
      } catch (err) { erreur(err); } finally { b.disabled = false; }
    });
  }

  /* ---------- Vue : Chauffeur ---------- */
  async function vueChauffeur() {
    if (!etat.session) return besoinConnexion("Espace chauffeur");
    if (!aRole("chauffeur")) { app.innerHTML = `<div class="card">Cet espace est réservé aux chauffeurs.</div>`; return; }
    const uid = etat.session.user.id;
    const aujourdhui = new Date(); aujourdhui.setHours(0, 0, 0, 0);
    const [conf, docs, aff, courses] = await Promise.all([
      sb.rpc("chauffeur_est_conforme", { p_chauffeur: uid }),
      sb.from("documents_chauffeur").select("*").eq("chauffeur_id", uid).order("created_at", { ascending: false }),
      sb.from("affectations").select("vehicule_id, vehicules(plaque, mode, agree)").eq("chauffeur_id", uid).eq("actif", true).maybeSingle(),
      sb.from("courses").select("*").eq("chauffeur_id", uid).order("date_heure", { ascending: false }).limit(30)
    ]);
    const conforme = conf.data === true;
    const veh = aff.data?.vehicules;
    const coursesJour = (courses.data || []).filter((c) => new Date(c.date_heure) >= aujourdhui);
    const recetteJour = coursesJour.reduce((s, c) => s + c.prix_fc * (c.passagers || 1), 0);
    const auj = new Date().toISOString().slice(0, 10);

    app.innerHTML = `
      <p class="eyebrow">Espace chauffeur</p>
      <h1>${esc(etat.profil?.nom || "Chauffeur")}</h1>
      <div class="card ${conforme ? "dark" : "accent"}">
        <h2>${conforme ? "✔ Chauffeur conforme" : "Pas encore conforme"}</h2>
        <p class="muted">${conforme ? "Vos 4 documents obligatoires sont vérifiés et valides. Le badge s’affiche aux clients." : "Il faut le permis, le contrôle technique, l’assurance et l’autorisation de transport, vérifiés par un agent et non expirés."}</p>
      </div>
      <div class="card">
        <h3>Mon code chauffeur</h3>
        <p class="muted">Donnez ce code au propriétaire du véhicule pour qu’il vous affecte.</p>
        <code class="cle" id="moncode">${esc(uid)}</code>
        <button class="btn ligne" id="copier" type="button">Copier le code</button>
        <p style="margin-top:12px">Véhicule actuel : <b>${veh ? esc(veh.plaque) + " · " + MODES[veh.mode] : "aucun"}</b></p>
      </div>

      <div class="card">
        <h2>Mes documents</h2>
        <ul class="liste">${(docs.data || []).map((d) => {
          const expire = d.date_expiration < auj;
          const bientot = !expire && (new Date(d.date_expiration) - new Date()) / 86400000 < 30;
          return `<li><div class="ligne-haut"><b>${DOCS[d.type]}</b>${badgeDoc(d.statut)}</div>
            <div class="muted">N° ${esc(d.numero || "—")} · expire le ${jourFr(d.date_expiration)}
            ${expire ? ' <span class="badge ko">Expiré</span>' : bientot ? ' <span class="badge att">Expire bientôt</span>' : ""}</div></li>`;
        }).join("") || '<li class="muted">Aucun document déposé.</li>'}</ul>
        <form id="doc">
          <h3 style="margin-top:16px">Ajouter un document</h3>
          <label for="type">Type</label><select id="type">${Object.entries(DOCS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
          <div class="row">
            <div><label for="num">Numéro</label><input id="num"></div>
            <div><label for="exp">Expire le</label><input id="exp" type="date" required></div>
          </div>
          <button class="btn">Déposer pour vérification</button>
        </form>
      </div>

      <div class="card">
        <h2>Mes courses</h2>
        <p>Aujourd’hui : <b>${coursesJour.length}</b> course(s) · recette <b>${fc(recetteJour)}</b></p>
        <form id="course">
          <div class="row">
            <div><label for="cdep">Départ</label><select id="cdep">${optionsLieux()}</select></div>
            <div><label for="carr">Arrivée</label><select id="carr">${optionsLieux()}</select></div>
          </div>
          <div class="row">
            <div><label for="cprix">Prix (FC)</label><input id="cprix" type="number" min="0" step="50" required></div>
            <div><label for="cpass">Passagers</label><input id="cpass" type="number" min="1" value="1" required></div>
          </div>
          <button class="btn">Enregistrer la course</button>
        </form>
        <ul class="liste" style="margin-top:12px">${(courses.data || []).slice(0, 10).map((c) => `
          <li><div class="ligne-haut"><span>${esc(lieuNom(c.depart_id))} → ${esc(lieuNom(c.arrivee_id))}</span><b>${fc(c.prix_fc)} × ${c.passagers}</b></div>
          <div class="muted">${dateFr(c.date_heure)}</div></li>`).join("")}</ul>
      </div>`;

    $("#copier").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(uid); toast("Code copié."); } catch (_) { toast("Sélectionnez le code pour le copier.", true); }
    });
    $("#doc").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await sb.from("documents_chauffeur").insert({ chauffeur_id: uid, type: $("#type").value, numero: $("#num").value.trim() || null, date_expiration: $("#exp").value });
      if (error) return erreur(error);
      toast("Document déposé. Un agent va le vérifier."); vueChauffeur();
    });
    const prixAuto = () => {
      const t = veh && prixLocal($("#cdep").value, $("#carr").value, veh.mode);
      if (t) $("#cprix").value = t.prix_fc;
    };
    $("#cdep").addEventListener("change", prixAuto);
    $("#carr").addEventListener("change", prixAuto);
    $("#course").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await sb.from("courses").insert({
        chauffeur_id: uid, vehicule_id: aff.data?.vehicule_id || null,
        depart_id: $("#cdep").value || null, arrivee_id: $("#carr").value || null,
        prix_fc: Number($("#cprix").value), passagers: Number($("#cpass").value)
      });
      if (error) return erreur(error);
      toast("Course enregistrée."); vueChauffeur();
    });
  }

  function badgeDoc(s) {
    return s === "verifie" ? '<span class="badge ok">Vérifié</span>' : s === "rejete" ? '<span class="badge ko">Rejeté</span>' : '<span class="badge att">En attente</span>';
  }

  /* ---------- Vue : Propriétaire ---------- */
  function lienQR(code) { return `${location.origin}${location.pathname}?v=${encodeURIComponent(code)}`; }

  async function vueProprietaire() {
    if (!etat.session) return besoinConnexion("Mes véhicules");
    if (!aRole("proprietaire", "admin")) { app.innerHTML = `<div class="card">Cet espace est réservé aux propriétaires de véhicules.</div>`; return; }
    const uid = etat.session.user.id;
    const { data: vehs, error } = await sb.from("vehicules")
      .select("id, plaque, mode, agree, qr_code, affectations(chauffeur_id, actif)")
      .eq("proprietaire_id", uid).order("created_at", { ascending: false });
    if (error) return erreur(error);

    app.innerHTML = `
      <p class="eyebrow">Propriétaire</p>
      <h1>Mes véhicules</h1>
      <form class="card" id="ajout">
        <h3>Enregistrer un véhicule</h3>
        <div class="row">
          <div><label for="plaque">Plaque</label><input id="plaque" required></div>
          <div><label for="mode">Type</label><select id="mode">${optionsModes("taxi_bus")}</select></div>
        </div>
        <button class="btn">Enregistrer</button>
        <p class="muted" style="margin-top:8px">Un agent devra ensuite agréer le véhicule.</p>
      </form>
      ${(vehs || []).map((v) => {
        const actif = (v.affectations || []).find((a) => a.actif);
        return `<div class="card">
          <div class="ligne-haut" style="display:flex;justify-content:space-between"><h2>${esc(v.plaque)}</h2><span class="badge ${v.agree ? "ok" : "att"}">${v.agree ? "Agréé" : "En attente d’agrément"}</span></div>
          <p class="muted">${MODES[v.mode]} · chauffeur : ${actif ? "code " + esc(actif.chauffeur_id.slice(0, 8)) + "…" : "aucun"}</p>
          <div class="qr-box" data-qr="${esc(lienQR(v.qr_code))}"></div>
          <p class="muted">QR code à imprimer et coller dans le véhicule.</p>
          <form class="affecter" data-id="${v.id}">
            <label>Affecter un chauffeur (code chauffeur)</label>
            <div class="row"><input name="code" required placeholder="Code donné par le chauffeur"><button class="btn petit">Affecter</button></div>
          </form>
        </div>`;
      }).join("") || '<p class="muted">Aucun véhicule enregistré.</p>'}`;

    app.querySelectorAll(".qr-box").forEach((el) => {
      if (window.QRCode) new QRCode(el, { text: el.dataset.qr, width: 180, height: 180 });
      else el.textContent = el.dataset.qr;
    });
    $("#ajout").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await sb.from("vehicules").insert({ plaque: $("#plaque").value.trim().toUpperCase(), mode: $("#mode").value, proprietaire_id: uid });
      if (error) return erreur(error.code === "23505" ? { message: "Cette plaque est déjà enregistrée." } : error);
      toast("Véhicule enregistré."); vueProprietaire();
    });
    app.querySelectorAll(".affecter").forEach((f) => f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const vid = Number(f.dataset.id), code = f.code.value.trim();
      const r1 = await sb.from("affectations").update({ actif: false, fin: new Date().toISOString() }).eq("vehicule_id", vid).eq("actif", true);
      if (r1.error) return erreur(r1.error);
      const r2 = await sb.from("affectations").insert({ vehicule_id: vid, chauffeur_id: code });
      if (r2.error) return erreur({ message: "Code chauffeur invalide ou inconnu." });
      toast("Chauffeur affecté."); vueProprietaire();
    }));
  }

  /* ---------- Vue : Contrôle et administration ---------- */
  async function vueAdmin() {
    if (!etat.session) return besoinConnexion("Espace contrôle");
    if (!aRole("agent", "admin")) { app.innerHTML = `<div class="card">Cet espace est réservé aux agents de contrôle et aux administrateurs.</div>`; return; }
    const onglet = params().o || "signalements";
    const onglets = { signalements: "Signalements", documents: "Documents", vehicules: "Véhicules", recidivistes: "Récidivistes" };
    if (aRole("admin")) Object.assign(onglets, { grille: "Grille tarifaire", utilisateurs: "Utilisateurs" });

    app.innerHTML = `
      <p class="eyebrow">${ROLES[etat.profil.role]}</p>
      <h1>Contrôle et administration</h1>
      <div class="onglets">${Object.entries(onglets).map(([k, v]) => `<button data-o="${k}" class="${k === onglet ? "actif" : ""}">${v}</button>`).join("")}</div>
      <div id="contenu"><div class="card">Chargement…</div></div>`;
    app.querySelectorAll(".onglets button").forEach((b) => b.addEventListener("click", () => (location.hash = "#/admin?o=" + b.dataset.o)));

    const zone = $("#contenu");
    try {
      if (onglet === "signalements") await adminSignalements(zone);
      else if (onglet === "documents") await adminDocuments(zone);
      else if (onglet === "vehicules") await adminVehicules(zone);
      else if (onglet === "recidivistes") await adminRecidivistes(zone);
      else if (onglet === "grille" && aRole("admin")) await adminGrille(zone);
      else if (onglet === "utilisateurs" && aRole("admin")) await adminUtilisateurs(zone);
    } catch (e) { erreur(e); }
  }

  async function adminSignalements(zone) {
    const { data, error } = await sb.from("signalements")
      .select("*, vehicules(plaque)").in("statut", ["nouveau", "en_verification"])
      .order("date_heure", { ascending: false }).limit(100);
    if (error) throw error;
    zone.innerHTML = data.length ? data.map((s) => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:8px"><h3>${esc(s.vehicules?.plaque || s.plaque_saisie || "Plaque inconnue")}</h3>${badgeStatut(s.statut)}</div>
        <p class="muted">${MODES[s.mode]} · ${esc(lieuNom(s.depart_id))} → ${esc(lieuNom(s.arrivee_id))} · ${dateFr(s.date_heure)}</p>
        <p>Demandé <b>${fc(s.prix_demande_fc)}</b> · officiel <b>${fc(s.prix_officiel_fc)}</b>
        ${s.prix_officiel_fc ? ` · écart <b>${fc(s.prix_demande_fc - s.prix_officiel_fc)}</b>` : ""}</p>
        ${s.commentaire ? `<p>« ${esc(s.commentaire)} »</p>` : ""}
        ${s.photo_url ? `<button class="btn petit ligne voir-photo" data-p="${esc(s.photo_url)}">Voir la photo</button>` : ""}
        ${s.vehicule_id ? "" : '<p class="muted">Plaque non enregistrée dans MOPILA CHECK.</p>'}
        <label>Note de l’agent</label><input class="note" data-id="${s.id}" value="${esc(s.note_agent || "")}">
        <div class="row">
          <button class="btn petit ligne statut" data-id="${s.id}" data-s="en_verification">En vérification</button>
          <button class="btn petit statut" data-id="${s.id}" data-s="confirme">Confirmer</button>
          <button class="btn petit ligne statut" data-id="${s.id}" data-s="rejete">Rejeter</button>
        </div>
      </div>`).join("") : `<div class="card">Aucun signalement à traiter.</div>`;

    zone.querySelectorAll(".statut").forEach((b) => b.addEventListener("click", async () => {
      const note = zone.querySelector(`.note[data-id="${b.dataset.id}"]`).value.trim();
      const { error } = await sb.from("signalements").update({ statut: b.dataset.s, traite_par: etat.session.user.id, note_agent: note || null }).eq("id", b.dataset.id);
      if (error) return erreur(error);
      toast("Signalement mis à jour."); adminSignalements(zone);
    }));
    zone.querySelectorAll(".voir-photo").forEach((b) => b.addEventListener("click", async () => {
      const { data, error } = await sb.storage.from("photos").createSignedUrl(b.dataset.p, 300);
      if (error) return erreur(error);
      window.open(data.signedUrl, "_blank", "noopener");
    }));
  }

  async function adminDocuments(zone) {
    const { data, error } = await sb.from("documents_chauffeur")
      .select("*, chauffeurs(profils(nom, telephone))").eq("statut", "en_attente").order("created_at");
    if (error) throw error;
    zone.innerHTML = data.length ? data.map((d) => `
      <div class="card">
        <h3>${DOCS[d.type]}</h3>
        <p>${esc(d.chauffeurs?.profils?.nom || "Chauffeur")} · ${esc(d.chauffeurs?.profils?.telephone || "")}</p>
        <p class="muted">N° ${esc(d.numero || "—")} · expire le ${jourFr(d.date_expiration)}</p>
        <div class="row">
          <button class="btn petit doc" data-id="${d.id}" data-s="verifie">Valider</button>
          <button class="btn petit ligne doc" data-id="${d.id}" data-s="rejete">Rejeter</button>
        </div>
      </div>`).join("") : `<div class="card">Aucun document en attente.</div>`;
    zone.querySelectorAll(".doc").forEach((b) => b.addEventListener("click", async () => {
      const { error } = await sb.from("documents_chauffeur").update({ statut: b.dataset.s, verifie_par: etat.session.user.id }).eq("id", b.dataset.id);
      if (error) return erreur(error);
      toast("Document mis à jour."); adminDocuments(zone);
    }));
  }

  async function adminVehicules(zone) {
    const { data, error } = await sb.from("vehicules").select("id, plaque, mode, agree, qr_code").order("agree").order("plaque");
    if (error) throw error;
    zone.innerHTML = `<div class="card"><input id="filtre" placeholder="Rechercher une plaque">
      <ul class="liste" id="lv">${data.map((v) => `
        <li data-p="${esc(v.plaque)}"><div class="ligne-haut"><b>${esc(v.plaque)}</b>
        <button class="btn petit ${v.agree ? "ligne" : "jaune"} agr" data-id="${v.id}" data-a="${v.agree}">${v.agree ? "Retirer l’agrément" : "Agréer"}</button></div>
        <div class="muted">${MODES[v.mode]} · <a href="${esc(lienQR(v.qr_code))}" target="_blank" rel="noopener">fiche publique</a></div></li>`).join("") || '<li class="muted">Aucun véhicule.</li>'}</ul></div>`;
    $("#filtre").addEventListener("input", (e) => {
      const q = e.target.value.toUpperCase().replace(/\s/g, "");
      zone.querySelectorAll("#lv li[data-p]").forEach((li) => (li.hidden = !li.dataset.p.toUpperCase().replace(/\s/g, "").includes(q)));
    });
    zone.querySelectorAll(".agr").forEach((b) => b.addEventListener("click", async () => {
      const { error } = await sb.from("vehicules").update({ agree: b.dataset.a !== "true" }).eq("id", b.dataset.id);
      if (error) return erreur(error);
      adminVehicules(zone);
    }));
  }

  async function adminRecidivistes(zone) {
    const { data, error } = await sb.from("recidivistes").select("*").order("signalements_confirmes", { ascending: false });
    if (error) throw error;
    zone.innerHTML = `<div class="card"><h2>Véhicules avec au moins 2 abus confirmés</h2>
      <ul class="liste">${data.map((r) => `<li><div class="ligne-haut"><b>${esc(r.plaque)}</b><span class="badge ko">${r.signalements_confirmes} abus</span></div>
      <div class="muted">${MODES[r.mode]} · dernier le ${dateFr(r.dernier_signalement)}</div></li>`).join("") || '<li class="muted">Aucun récidiviste.</li>'}</ul></div>`;
  }

  async function adminGrille(zone) {
    const { data: arretes, error } = await sb.from("arretes").select("*").order("date_effet", { ascending: false });
    if (error) throw error;
    await chargerGrille();
    zone.innerHTML = `
      <form class="card" id="ftarif">
        <h2>Ajouter un tarif</h2>
        <label for="tar">Arrêté</label>
        <select id="tar" required>${arretes.map((a) => `<option value="${a.id}">${esc(a.reference)} (${jourFr(a.date_effet)})${a.actif ? "" : " — inactif"}</option>`).join("")}</select>
        <div class="row">
          <div><label for="tdep">Départ</label><select id="tdep" required>${optionsLieux()}</select></div>
          <div><label for="tarr">Arrivée</label><select id="tarr" required>${optionsLieux()}</select></div>
        </div>
        <div class="row">
          <div><label for="tmode">Type</label><select id="tmode">${optionsModes("taxi_bus")}</select></div>
          <div><label for="tprix">Prix (FC)</label><input id="tprix" type="number" min="50" step="50" required></div>
        </div>
        <label><input type="checkbox" id="tar2" checked style="width:auto"> Même prix dans le sens inverse</label>
        <button class="btn">Ajouter le tarif</button>
      </form>

      <form class="card" id="flieu">
        <h2>Ajouter un lieu (arrêt, rond-point, marché)</h2>
        <div class="row">
          <div><label for="lnom">Nom</label><input id="lnom" required placeholder="Ex. Rond-point Victoire"></div>
          <div><label for="lcom">Commune</label><select id="lcom">${etat.communes.map((c) => `<option value="${c.id}">${esc(c.nom)}</option>`).join("")}</select></div>
        </div>
        <button class="btn ligne">Ajouter le lieu</button>
      </form>

      <form class="card" id="farrete">
        <h2>Enregistrer un nouvel arrêté</h2>
        <label for="aref">Référence</label><input id="aref" required placeholder="Ex. Arrêté n° … du …">
        <div class="row">
          <div><label for="asig">Signé le</label><input id="asig" type="date"></div>
          <div><label for="aeff">En vigueur le</label><input id="aeff" type="date" required></div>
        </div>
        <button class="btn ligne">Enregistrer l’arrêté</button>
        <p class="muted" style="margin-top:8px">Les tarifs du nouvel arrêté remplacent les anciens à partir de sa date d’entrée en vigueur.</p>
      </form>

      <div class="card">
        <h2>Tarifs en vigueur (${etat.tarifs.length})</h2>
        <ul class="liste">${etat.tarifs.map((t) => `<li><div class="ligne-haut"><span>${esc(t.depart)} → ${esc(t.arrivee)}</span><b>${fc(t.prix_fc)}</b></div>
          <div class="muted">${MODES[t.mode]} · ${esc(t.arrete)} <button class="btn petit ligne suppr" data-id="${t.id}" style="margin-left:8px">Supprimer</button></div></li>`).join("")}</ul>
      </div>`;

    $("#ftarif").addEventListener("submit", async (e) => {
      e.preventDefault();
      const a = Number($("#tar").value), d = Number($("#tdep").value), r = Number($("#tarr").value), m = $("#tmode").value, p = Number($("#tprix").value);
      if (d === r) return erreur({ message: "Le départ et l’arrivée doivent être différents." });
      const lignes = [{ arrete_id: a, depart_id: d, arrivee_id: r, mode: m, prix_fc: p }];
      if ($("#tar2").checked) lignes.push({ arrete_id: a, depart_id: r, arrivee_id: d, mode: m, prix_fc: p });
      const { error } = await sb.from("tarifs").upsert(lignes, { onConflict: "arrete_id,depart_id,arrivee_id,mode" });
      if (error) return erreur(error);
      toast("Tarif enregistré."); adminGrille(zone);
    });
    $("#flieu").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await sb.from("lieux").insert({ nom: $("#lnom").value.trim(), commune_id: Number($("#lcom").value) });
      if (error) return erreur(error.code === "23505" ? { message: "Ce lieu existe déjà dans cette commune." } : error);
      toast("Lieu ajouté."); adminGrille(zone);
    });
    $("#farrete").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await sb.from("arretes").insert({ reference: $("#aref").value.trim(), date_signature: $("#asig").value || null, date_effet: $("#aeff").value });
      if (error) return erreur(error);
      toast("Arrêté enregistré."); adminGrille(zone);
    });
    zone.querySelectorAll(".suppr").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Supprimer ce tarif ?")) return;
      const { error } = await sb.from("tarifs").delete().eq("id", b.dataset.id);
      if (error) return erreur(error);
      adminGrille(zone);
    }));
  }

  async function adminUtilisateurs(zone) {
    const { data, error } = await sb.from("profils").select("id, nom, telephone, role, created_at").order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    zone.innerHTML = `<div class="card"><h2>Utilisateurs</h2><ul class="liste">${data.map((u) => `
      <li><div class="ligne-haut"><b>${esc(u.nom || "Sans nom")}</b><span class="muted">${esc(u.telephone || "")}</span></div>
      <select class="role" data-id="${u.id}" ${u.id === etat.session.user.id ? "disabled" : ""}>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${v}</option>`).join("")}</select></li>`).join("")}</ul></div>`;
    zone.querySelectorAll(".role").forEach((s) => s.addEventListener("change", async () => {
      const { error } = await sb.from("profils").update({ role: s.value }).eq("id", s.dataset.id);
      if (error) return erreur(error);
      if (s.value === "chauffeur") await sb.from("chauffeurs").upsert({ id: s.dataset.id }, { onConflict: "id", ignoreDuplicates: true });
      toast("Rôle mis à jour.");
    }));
  }

  /* ---------- Routeur ---------- */
  const VUES = { prix: vuePrix, verifier: vueVerifier, signaler: vueSignaler, compte: vueCompte, chauffeur: vueChauffeur, proprietaire: vueProprietaire, admin: vueAdmin };

  async function route() {
    await arreterScanner();
    const nom = (location.hash.replace(/^#\//, "").split("?")[0]) || "prix";
    const vue = VUES[nom] || vuePrix;
    document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("actif", a.dataset.tab === nom || (nom === "chauffeur" || nom === "proprietaire" || nom === "admin") && a.dataset.tab === "compte"));
    try { await vue(); } catch (e) { erreur(e); }
    window.scrollTo(0, 0);
  }

  function majReseau() { document.getElementById("net").hidden = navigator.onLine; }

  async function demarrer() {
    // Un QR code scanné avec l’appareil photo ouvre l’adresse ?v=CODE
    const v = new URLSearchParams(location.search).get("v");
    if (v) { history.replaceState(null, "", location.pathname + "#/verifier?v=" + encodeURIComponent(v)); }
    majReseau();
    window.addEventListener("online", () => { majReseau(); chargerGrille(); });
    window.addEventListener("offline", majReseau);
    app.innerHTML = `<div class="card">Chargement de la grille tarifaire…</div>`;
    await Promise.all([chargerGrille(), chargerProfil()]);
    sb.auth.onAuthStateChange(async (evt) => {
      if (evt === "SIGNED_IN" || evt === "SIGNED_OUT") { await chargerProfil(); if (evt === "SIGNED_OUT") route(); }
    });
    window.addEventListener("hashchange", route);
    route();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  demarrer();
})();
