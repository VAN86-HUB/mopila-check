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
  /* Mode test : l’administrateur peut voir l’application comme un client, un chauffeur ou un propriétaire. */
  const PERSONA_KEY = "mopila_persona";
  function estVraiAdmin() { return etat.profil?.role === "admin"; }
  function roleVue() {
    if (!etat.profil) return null;
    if (estVraiAdmin()) {
      let p = null;
      try { p = localStorage.getItem(PERSONA_KEY); } catch (_) { /* stockage indisponible */ }
      return ["client", "chauffeur", "proprietaire", "agent", "admin"].includes(p) ? p : "admin";
    }
    return etat.profil.role;
  }
  function aRole(...roles) { return !!etat.profil && roles.includes(roleVue()); }

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
        <p><b>Rôle :</b> ${ROLES[p.role] || "—"}${estVraiAdmin() && roleVue() !== "admin" ? ` · <span class="badge att">Mode test : ${ROLES[roleVue()]}</span>` : ""}</p>
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
        journaliser(inscription ? "inscription" : "connexion");
        const cible = p.retour ? decodeURIComponent(p.retour) : "#/verifier";
        if (location.hash === cible) route(); else location.hash = cible;
      } catch (err) { erreur(err); } finally { b.disabled = false; }
    });
  }

  /* ---------- Vue : Chauffeur ---------- */
  async function vueChauffeur() {
    if (!etat.session) return besoinConnexion("Espace chauffeur");
    if (!aRole("chauffeur")) { app.innerHTML = `<div class="card">Cet espace est réservé aux chauffeurs.</div>`; return; }
    const uid = etat.session.user.id;
    if (estVraiAdmin()) await sb.from("chauffeurs").upsert({ id: uid }, { onConflict: "id", ignoreDuplicates: true });
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
    const onglets = aRole("admin")
      ? { tableau: "Tableau de bord", trajets: "Trajets et prix", utilisateurs: "Utilisateurs", journal: "Journal", signalements: "Signalements", documents: "Documents", vehicules: "Véhicules", recidivistes: "Récidivistes" }
      : { signalements: "Signalements", documents: "Documents", vehicules: "Véhicules", recidivistes: "Récidivistes" };
    const onglet = onglets[params().o] ? params().o : Object.keys(onglets)[0];

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
      else if (onglet === "tableau") await adminTableau(zone);
      else if (onglet === "trajets") await adminGrille(zone);
      else if (onglet === "utilisateurs") await adminUtilisateurs(zone);
      else if (onglet === "journal") await adminJournal(zone);
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
    const uid = etat.session.user.id;
    if (estVraiAdmin()) await sb.from("chauffeurs").upsert({ id: uid }, { onConflict: "id", ignoreDuplicates: true });
    const [vr, pr, cr] = await Promise.all([
      sb.from("vehicules").select("id, plaque, mode, agree, qr_code, proprietaire_id, affectations(chauffeur_id, actif)").order("created_at", { ascending: false }),
      sb.from("profils").select("id, nom, role").in("role", ["proprietaire", "admin"]).order("nom"),
      sb.from("chauffeurs").select("id, profils(nom)")
    ]);
    if (vr.error) throw vr.error;
    const proprios = pr.data || [];
    const chauffeurs = (cr.data || []).map((c) => ({ id: c.id, nom: c.profils?.nom || "Chauffeur" }));
    const nomDe = (liste, id) => liste.find((x) => x.id === id)?.nom || "—";
    const moi = (id) => (id === uid ? " (moi)" : "");
    const optProprios = proprios.map((p) => `<option value="${p.id}" ${p.id === uid ? "selected" : ""}>${esc(p.nom || "Sans nom")}${moi(p.id)}</option>`).join("");
    const optChauffeurs = (sel) => '<option value="">— Aucun chauffeur —</option>' + chauffeurs.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.nom)}${moi(c.id)}</option>`).join("");

    zone.innerHTML = `
      <form class="card accent" id="fveh">
        <h2>Enregistrer un véhicule et créer son QR code</h2>
        <div class="row">
          <div><label for="vplaque">Plaque</label><input id="vplaque" required placeholder="Ex. 1234AB01"></div>
          <div><label for="vmode">Type</label><select id="vmode">${optionsModes("taxi_bus")}</select></div>
        </div>
        <label for="vprop">Propriétaire</label><select id="vprop" required>${optProprios}</select>
        <label for="vchauf">Chauffeur affecté</label><select id="vchauf">${optChauffeurs(null)}</select>
        <label style="font-weight:400"><input type="checkbox" id="vagree" checked style="width:auto"> Véhicule agréé dès maintenant</label>
        <button class="btn jaune">Enregistrer et générer le QR code</button>
      </form>
      <div class="card">
        <h2>Véhicules (${vr.data.length})</h2>
        <input id="filtre" placeholder="Rechercher une plaque">
        <ul class="liste" id="lv">${vr.data.map((v) => {
          const aff = (v.affectations || []).find((a) => a.actif);
          return `<li data-p="${esc(v.plaque)}">
            <div class="ligne-haut"><b>${esc(v.plaque)}</b><span class="badge ${v.agree ? "ok" : "att"}">${v.agree ? "Agréé" : "Non agréé"}</span></div>
            <div class="muted">${MODES[v.mode]} · propriétaire : ${esc(nomDe(proprios, v.proprietaire_id))}${moi(v.proprietaire_id)}</div>
            <label>Chauffeur</label>
            <select class="chauf" data-id="${v.id}">${optChauffeurs(aff?.chauffeur_id)}</select>
            <div class="row" style="margin-top:8px">
              <button class="btn petit ${v.agree ? "ligne" : "jaune"} agr" data-id="${v.id}" data-a="${v.agree}">${v.agree ? "Retirer l’agrément" : "Agréer"}</button>
              <button class="btn petit ligne voirqr" data-id="${v.id}">QR code</button>
            </div>
            <div class="zone-qr" id="qr-${v.id}" hidden style="margin-top:10px;text-align:center">
              <div class="qr-box" data-qr="${esc(lienQR(v.qr_code))}"></div>
              <p class="muted">${esc(v.plaque)} · ${MODES[v.mode]}</p>
              <div class="row">
                <button class="btn petit imprimer" data-id="${v.id}" data-plaque="${esc(v.plaque)}" data-mode="${MODES[v.mode]}">🖨️ Imprimer la fiche</button>
                <a class="btn petit ligne" href="#/verifier?v=${encodeURIComponent(v.qr_code)}">Tester le scan</a>
              </div>
            </div></li>`;
        }).join("") || '<li class="muted">Aucun véhicule.</li>'}</ul>
      </div>`;

    $("#fveh").addEventListener("submit", async (e) => {
      e.preventDefault();
      const plaque = $("#vplaque").value.trim().toUpperCase().replace(/\s+/g, "");
      const { data: v, error } = await sb.from("vehicules")
        .insert({ plaque, mode: $("#vmode").value, proprietaire_id: $("#vprop").value, agree: $("#vagree").checked })
        .select("id").single();
      if (error) return erreur(error.code === "23505" ? { message: "Cette plaque est déjà enregistrée." } : error);
      if ($("#vchauf").value) {
        const r = await sb.from("affectations").insert({ vehicule_id: v.id, chauffeur_id: $("#vchauf").value });
        if (r.error) erreur(r.error);
      }
      journaliser("véhicule enregistré", plaque);
      toast("Véhicule enregistré, QR code créé.");
      await adminVehicules(zone);
      const z = zone.querySelector(`#qr-${v.id}`);
      if (z) { z.hidden = false; dessinerQR(z); z.scrollIntoView({ behavior: "smooth", block: "center" }); }
    });
    $("#filtre").addEventListener("input", (e) => {
      const q = e.target.value.toUpperCase().replace(/\s/g, "");
      zone.querySelectorAll("#lv li[data-p]").forEach((li) => (li.hidden = !li.dataset.p.toUpperCase().replace(/\s/g, "").includes(q)));
    });
    zone.querySelectorAll(".agr").forEach((b) => b.addEventListener("click", async () => {
      const { error } = await sb.from("vehicules").update({ agree: b.dataset.a !== "true" }).eq("id", b.dataset.id);
      if (error) return erreur(error);
      adminVehicules(zone);
    }));
    zone.querySelectorAll(".chauf").forEach((s) => s.addEventListener("change", async () => {
      const vid = Number(s.dataset.id);
      const r1 = await sb.from("affectations").update({ actif: false, fin: new Date().toISOString() }).eq("vehicule_id", vid).eq("actif", true);
      if (r1.error) return erreur(r1.error);
      if (s.value) {
        const r2 = await sb.from("affectations").insert({ vehicule_id: vid, chauffeur_id: s.value });
        if (r2.error) return erreur(r2.error);
      }
      toast(s.value ? "Chauffeur affecté." : "Chauffeur retiré.");
    }));
    zone.querySelectorAll(".voirqr").forEach((b) => b.addEventListener("click", () => {
      const z = zone.querySelector(`#qr-${b.dataset.id}`);
      z.hidden = !z.hidden;
      if (!z.hidden) dessinerQR(z);
    }));
    zone.querySelectorAll(".imprimer").forEach((b) => b.addEventListener("click", () => {
      const canvas = zone.querySelector(`#qr-${b.dataset.id} canvas`);
      const img = canvas ? canvas.toDataURL("image/png") : "";
      const w = window.open("", "_blank");
      if (!w) return erreur({ message: "Autorisez les fenêtres pop-up pour imprimer la fiche." });
      w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>QR ${esc(b.dataset.plaque)}</title>
        <style>body{font-family:Arial,sans-serif;text-align:center;padding:30px;color:#10233F}
        .f{border:6px solid #10233F;border-radius:16px;padding:24px;display:inline-block;max-width:340px}
        h1{margin:0 0 4px;font-size:28px}.b{background:#F2B705;padding:6px;border-radius:8px;font-weight:bold;margin:12px 0}
        img{width:260px;height:260px}</style></head><body><div class="f">
        <h1>MOPILA CHECK</h1><div>Le juste prix du transport à Kinshasa</div>
        <div class="b">Scannez pour vérifier ce véhicule</div><img src="${img}" alt="QR code">
        <h2>${esc(b.dataset.plaque)}</h2><div>${esc(b.dataset.mode)}</div></div>
        <script>window.onload=function(){window.print()}<\/script></body></html>`);
      w.document.close();
    }));
  }

  function dessinerQR(z) {
    const el = z.querySelector(".qr-box");
    if (!el || el.dataset.fait) return;
    el.dataset.fait = "1";
    if (window.QRCode) new QRCode(el, { text: el.dataset.qr, width: 200, height: 200 });
    else el.textContent = el.dataset.qr;
  }

  async function adminRecidivistes(zone) {
    const { data, error } = await sb.from("recidivistes").select("*").order("signalements_confirmes", { ascending: false });
    if (error) throw error;
    zone.innerHTML = `<div class="card"><h2>Véhicules avec au moins 2 abus confirmés</h2>
      <ul class="liste">${data.map((r) => `<li><div class="ligne-haut"><b>${esc(r.plaque)}</b><span class="badge ko">${r.signalements_confirmes} abus</span></div>
      <div class="muted">${MODES[r.mode]} · dernier le ${dateFr(r.dernier_signalement)}</div></li>`).join("") || '<li class="muted">Aucun récidiviste.</li>'}</ul></div>`;
  }

  function tuile(n, t, accent = false) {
    return `<div style="background:${accent ? "#10233F" : "#FFFDF7"};color:${accent ? "#F6F3EA" : "#10233F"};border:1px solid #E2DCCB;border-top:5px solid #F2B705;border-radius:12px;padding:12px">
      <div style="font-family:'Oswald',Arial,sans-serif;font-size:28px;font-weight:600;line-height:1.1">${n ?? 0}</div>
      <div style="font-size:13px;color:${accent ? "#C9D3E3" : "#4A5568"}">${t}</div></div>`;
  }
  const grille2 = (html) => `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px">${html}</div>`;

  async function adminTableau(zone) {
    const { data: s, error } = await sb.rpc("stats_admin");
    if (error) throw error;
    const roles = s.par_role || {};
    const jours = s.activite_14j || [];
    const max = Math.max(1, ...jours.map((j) => j.n));
    zone.innerHTML = `
      <h2>Utilisateurs</h2>
      ${grille2(tuile(s.utilisateurs, "comptes au total", true) + tuile(s.actifs_24h, "connectés ces 24 h") + tuile(s.actifs_7j, "actifs ces 7 jours") + tuile(s.nouveaux_7j, "nouveaux ces 7 jours"))}
      <div class="card"><h3>Répartition par accès</h3>
        <ul class="liste">${Object.entries(ROLES).map(([k, v]) => `<li><div class="ligne-haut"><span>${v}</span><b>${roles[k] || 0}</b></div></li>`).join("")}
        <li><div class="ligne-haut"><span>E-mail non confirmé</span><b>${s.non_confirmes}</b></div></li></ul>
        <a class="btn ligne" href="#/admin?o=utilisateurs">Voir tous les utilisateurs</a>
      </div>
      <div class="card"><h3>Utilisateurs actifs par jour (14 derniers jours)</h3>
        ${jours.length ? `<div style="display:flex;align-items:flex-end;gap:4px;height:120px;margin-top:8px">${jours.map((j) => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%" title="${j.jour} : ${j.n}">
            <span style="font-size:11px;color:#4A5568">${j.n}</span>
            <div style="width:100%;background:#F2B705;border-radius:4px 4px 0 0;height:${Math.max(4, (j.n / max) * 90)}px"></div>
            <span style="font-size:10px;color:#4A5568">${j.jour.slice(8, 10)}</span></div>`).join("")}</div>`
        : '<p class="muted">Pas encore d’activité enregistrée.</p>'}
      </div>
      <h2>Transport</h2>
      ${grille2(tuile(s.trajets, "trajets avec prix officiel", true) + tuile(s.lieux, "lieux enregistrés") + tuile(`${s.vehicules_agrees}/${s.vehicules}`, "véhicules agréés") + tuile(`${s.chauffeurs_conformes}/${s.chauffeurs}`, "chauffeurs conformes"))}
      <h2>Contrôle</h2>
      ${grille2(tuile(s.signalements_a_traiter, "signalements à traiter", true) + tuile(s.signalements_confirmes, "abus confirmés") + tuile(s.documents_en_attente, "documents à vérifier") + tuile(s.courses_7j, "courses ces 7 jours"))}
      <p class="muted">Chiffres mis à jour à l’ouverture de cet onglet.</p>`;
  }

  async function adminGrille(zone) {
    const { data: arretes, error } = await sb.from("arretes").select("*").order("date_effet", { ascending: false });
    if (error) throw error;
    await chargerGrille();
    const optCommunes = '<option value="">— Commune —</option>' + etat.communes.map((c) => `<option value="${c.id}">${esc(c.nom)}</option>`).join("");
    const listeLieux = [...new Set(etat.lieux.map((l) => l.nom))].map((n) => `<option value="${esc(n)}">`).join("");
    zone.innerHTML = `
      <form class="card accent" id="ftrajet">
        <h2>Ajouter un trajet et son prix</h2>
        <p class="muted">Tapez le nom du lieu : s’il n’existe pas encore, il est créé automatiquement.</p>
        <datalist id="dl-lieux">${listeLieux}</datalist>
        <label for="tdep">Départ</label>
        <div class="row"><input id="tdep" list="dl-lieux" required placeholder="Ex. Rond-point Victoire"><select id="tcdep">${optCommunes}</select></div>
        <label for="tarr">Arrivée</label>
        <div class="row"><input id="tarr" list="dl-lieux" required placeholder="Ex. Gare centrale"><select id="tcarr">${optCommunes}</select></div>
        <div class="row">
          <div><label for="tmode">Type de véhicule</label><select id="tmode">${optionsModes("taxi_bus")}</select></div>
          <div><label for="tprix">Prix (FC)</label><input id="tprix" type="number" min="50" step="50" required inputmode="numeric"></div>
        </div>
        <label for="tar">Arrêté</label>
        <select id="tar">${arretes.map((a) => `<option value="${a.id}">${esc(a.reference)} (${jourFr(a.date_effet)})${a.actif ? "" : " — inactif"}</option>`).join("")}</select>
        <label style="font-weight:400"><input type="checkbox" id="tar2" checked style="width:auto"> Même prix dans le sens inverse</label>
        <button class="btn jaune">Enregistrer le trajet</button>
      </form>

      <div class="card">
        <h2>Trajets en vigueur (${etat.tarifs.length})</h2>
        <input id="ftri" placeholder="Rechercher un lieu">
        <ul class="liste" id="ltar">${etat.tarifs.slice().sort((a, b) => a.depart.localeCompare(b.depart)).map((t) => `
          <li data-q="${esc((t.depart + " " + t.arrivee).toLowerCase())}">
            <div class="ligne-haut"><span>${esc(t.depart)} → ${esc(t.arrivee)}</span><b>${fc(t.prix_fc)}</b></div>
            <div class="muted">${MODES[t.mode]} · ${esc(t.arrete)}
              <button class="btn petit ligne modif" data-id="${t.id}" data-p="${t.prix_fc}" style="margin-left:6px">Modifier le prix</button>
              <button class="btn petit ligne suppr" data-id="${t.id}">Supprimer</button></div></li>`).join("") || '<li class="muted">Aucun trajet.</li>'}</ul>
      </div>

      <details class="card"><summary><b>Enregistrer un nouvel arrêté</b></summary>
        <form id="farrete">
          <label for="aref">Référence</label><input id="aref" required placeholder="Ex. Arrêté n° … du …">
          <div class="row">
            <div><label for="asig">Signé le</label><input id="asig" type="date"></div>
            <div><label for="aeff">En vigueur le</label><input id="aeff" type="date" required></div>
          </div>
          <button class="btn ligne">Enregistrer l’arrêté</button>
          <p class="muted" style="margin-top:8px">Les trajets d’un nouvel arrêté remplacent les anciens à sa date d’entrée en vigueur.</p>
        </form>
      </details>`;

    $("#ftrajet").addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = e.submitter; if (b) b.disabled = true;
      const { data, error } = await sb.rpc("ajouter_trajet", {
        p_depart: $("#tdep").value, p_commune_depart: $("#tcdep").value ? Number($("#tcdep").value) : null,
        p_arrivee: $("#tarr").value, p_commune_arrivee: $("#tcarr").value ? Number($("#tcarr").value) : null,
        p_mode: $("#tmode").value, p_prix: Number($("#tprix").value),
        p_aller_retour: $("#tar2").checked, p_arrete: $("#tar").value ? Number($("#tar").value) : null
      });
      if (b) b.disabled = false;
      if (error) return erreur(error);
      journaliser("trajet ajouté", `${$("#tdep").value} – ${$("#tarr").value} : ${$("#tprix").value} FC`);
      toast(`Trajet enregistré (${data} sens).`); adminGrille(zone);
    });
    $("#ftri").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      zone.querySelectorAll("#ltar li[data-q]").forEach((li) => (li.hidden = !li.dataset.q.includes(q)));
    });
    $("#farrete").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await sb.from("arretes").insert({ reference: $("#aref").value.trim(), date_signature: $("#asig").value || null, date_effet: $("#aeff").value });
      if (error) return erreur(error);
      toast("Arrêté enregistré."); adminGrille(zone);
    });
    zone.querySelectorAll(".modif").forEach((b) => b.addEventListener("click", async () => {
      const v = prompt("Nouveau prix (FC) :", b.dataset.p);
      if (v === null) return;
      const p = Number(v);
      if (!(p > 0)) return erreur({ message: "Prix invalide." });
      const { error } = await sb.from("tarifs").update({ prix_fc: p }).eq("id", b.dataset.id);
      if (error) return erreur(error);
      toast("Prix modifié."); adminGrille(zone);
    }));
    zone.querySelectorAll(".suppr").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Supprimer ce trajet ?")) return;
      const { error } = await sb.from("tarifs").delete().eq("id", b.dataset.id);
      if (error) return erreur(error);
      adminGrille(zone);
    }));
  }

  async function adminUtilisateurs(zone) {
    const { data, error } = await sb.rpc("utilisateurs_admin");
    if (error) throw error;
    zone.innerHTML = `<div class="card"><h2>Utilisateurs (${data.length})</h2>
      <div class="row"><input id="fu" placeholder="Nom, e-mail ou téléphone"><select id="fr"><option value="">Tous les accès</option>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <ul class="liste" id="lu" style="margin-top:8px">${data.map((u) => `
      <li data-q="${esc(((u.nom || "") + " " + (u.email || "") + " " + (u.telephone || "")).toLowerCase())}" data-r="${u.role}">
        <div class="ligne-haut"><b>${esc(u.nom || "Sans nom")}</b>${u.email_confirme ? "" : '<span class="badge att">E-mail non confirmé</span>'}</div>
        <div class="muted">${esc(u.email || "")}${u.telephone ? " · " + esc(u.telephone) : ""}</div>
        <div class="muted">Inscrit le ${dateFr(u.inscrit_le)} · dernière connexion : ${u.derniere_connexion ? dateFr(u.derniere_connexion) : "jamais"}</div>
        <div class="muted">${u.actions_7j} action(s) ces 7 jours${u.dernier_ecran ? " · dernière : " + esc(u.dernier_ecran) : ""}</div>
        <select class="role" data-id="${u.id}" ${u.id === etat.session.user.id ? "disabled" : ""} style="margin-top:6px">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      </li>`).join("")}</ul></div>`;
    const filtrer = () => {
      const q = $("#fu").value.toLowerCase(), r = $("#fr").value;
      zone.querySelectorAll("#lu li").forEach((li) => (li.hidden = !(li.dataset.q.includes(q) && (!r || li.dataset.r === r))));
    };
    $("#fu").addEventListener("input", filtrer);
    $("#fr").addEventListener("change", filtrer);
    zone.querySelectorAll(".role").forEach((s) => s.addEventListener("change", async () => {
      const { error } = await sb.from("profils").update({ role: s.value }).eq("id", s.dataset.id);
      if (error) return erreur(error);
      if (s.value === "chauffeur") await sb.from("chauffeurs").upsert({ id: s.dataset.id }, { onConflict: "id", ignoreDuplicates: true });
      s.closest("li").dataset.r = s.value;
      journaliser("rôle modifié", ROLES[s.value]);
      toast("Accès mis à jour.");
    }));
  }

  async function adminJournal(zone) {
    const { data, error } = await sb.from("journal_activite")
      .select("action, detail, date_heure, profils(nom, role)").order("date_heure", { ascending: false }).limit(200);
    if (error) throw error;
    zone.innerHTML = `<div class="card"><h2>Journal d’activité</h2><p class="muted">Les 200 dernières actions des utilisateurs.</p>
      <ul class="liste">${data.map((j) => `<li><div class="ligne-haut"><b>${esc(j.profils?.nom || "Utilisateur")}</b><span class="muted">${dateFr(j.date_heure)}</span></div>
      <div class="muted">${ROLES[j.profils?.role] || ""} · ${esc(j.action)}${j.detail ? " : " + esc(j.detail) : ""}</div></li>`).join("") || '<li class="muted">Aucune activité.</li>'}</ul></div>`;
  }

  /* ---------- Journal ---------- */
  const NOMS_ECRANS = { prix: "Prix", verifier: "Vérification QR", signaler: "Signalement", compte: "Compte", chauffeur: "Espace chauffeur", proprietaire: "Mes véhicules", admin: "Administration" };
  function journaliser(action, detail) {
    if (!etat.session) return;
    sb.from("journal_activite").insert({ action, detail: detail ? String(detail).slice(0, 200) : null }).then(() => {}, () => {});
  }

  /* ---------- Barre de navigation ---------- */
  function majTabbar() {
    const bar = document.querySelector(".tabbar");
    bar.hidden = !etat.session;
    const verif = bar.querySelector('[data-tab="verifier"]');
    if (verif && bar.firstElementChild !== verif) bar.prepend(verif);
    // Onglet propre au rôle affiché
    const special = [
      ["chauffeur", "#/chauffeur", "🚖", "Chauffeur", aRole("chauffeur")],
      ["proprietaire", "#/proprietaire", "🚌", "Véhicules", aRole("proprietaire")],
      ["admin", "#/admin", "🛡️", "Admin", aRole("agent", "admin")]
    ];
    special.forEach(([tab, href, ico, lib, montrer]) => {
      let a = bar.querySelector(`[data-tab="${tab}"]`);
      if (montrer && !a) {
        a = document.createElement("a");
        a.href = href; a.dataset.tab = tab;
        a.innerHTML = `<span>${ico}</span>${lib}`;
        bar.appendChild(a);
      } else if (!montrer && a) a.remove();
    });
    majSelecteurTest();
  }

  // Sélecteur « Mode test » dans la barre du haut, visible seulement pour l’administrateur
  function majSelecteurTest() {
    const top = document.querySelector(".topbar");
    let sel = document.getElementById("mode-test");
    if (!estVraiAdmin()) { if (sel) sel.remove(); return; }
    if (!sel) {
      sel = document.createElement("select");
      sel.id = "mode-test";
      sel.title = "Mode test : voir l’application comme…";
      sel.style.cssText = "width:auto;padding:6px 8px;font-size:13px;font-weight:700;border-radius:8px;border:2px solid #F2B705;background:#10233F;color:#F6F3EA";
      sel.innerHTML = [["admin", "👑 Administrateur"], ["agent", "🛡️ Agent"], ["proprietaire", "🚌 Propriétaire"], ["chauffeur", "🚖 Chauffeur"], ["client", "🧍 Client"]]
        .map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
      sel.addEventListener("change", () => {
        try { localStorage.setItem(PERSONA_KEY, sel.value); } catch (_) { /* stockage indisponible */ }
        journaliser("mode test", ROLES[sel.value]);
        toast("Vous voyez maintenant l’application comme : " + ROLES[sel.value]);
        const cible = { chauffeur: "#/chauffeur", proprietaire: "#/proprietaire", admin: "#/admin", agent: "#/admin", client: "#/verifier" }[sel.value];
        if (location.hash === cible) route(); else location.hash = cible;
      });
      top.appendChild(sel);
    }
    sel.value = roleVue();
  }

  /* ---------- Routeur ---------- */
  const VUES = { prix: vuePrix, verifier: vueVerifier, signaler: vueSignaler, compte: vueCompte, chauffeur: vueChauffeur, proprietaire: vueProprietaire, admin: vueAdmin };

  async function route() {
    await arreterScanner();
    majTabbar();
    const demande = location.hash.replace(/^#\//, "").split("?")[0];
    // Personne non identifiée : la première page est toujours l’identification.
    if (!etat.session && demande !== "compte") {
      const retour = demande ? "?retour=" + encodeURIComponent(location.hash) : "";
      location.replace("#/compte" + retour);
      return;
    }
    // Personne connectée : la première page est la vérification du QR code.
    const nom = VUES[demande] ? demande : "verifier";
    document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("actif", a.dataset.tab === nom));
    try { await VUES[nom](); } catch (e) { erreur(e); }
    if (etat.session) journaliser("écran", NOMS_ECRANS[nom]);
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
      if (evt === "SIGNED_IN" || evt === "SIGNED_OUT") { await chargerProfil(); majTabbar(); if (evt === "SIGNED_OUT") route(); }
    });
    window.addEventListener("hashchange", route);
    route();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  demarrer();
})();
