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
  // Le lien « mot de passe oublié » revient avec #…type=recovery dans l’adresse
  const RETOUR_RECUPERATION = /type=recovery/.test(location.hash);

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
  const ERREURS_FR = [
    [/invalid login credentials/i, "E-mail ou mot de passe incorrect. Vérifiez les majuscules, ou touchez « Mot de passe oublié ? »."],
    [/email not confirmed/i, "Votre e-mail n’est pas encore confirmé : ouvrez le lien reçu par e-mail (regardez aussi dans les spams), ou demandez à l’administrateur de le confirmer."],
    [/rate limit|too many requests|security purposes/i, "Trop d’essais ou d’e-mails envoyés. Patientez un moment (jusqu’à une heure) avant de réessayer, ou contactez l’administrateur."],
    [/already registered|already been registered|user already exists/i, "Un compte existe déjà avec cet e-mail : connectez-vous, ou touchez « Mot de passe oublié ? »."],
    [/password should be at least|password.*(short|weak)/i, "Le mot de passe doit contenir au moins 6 caractères."],
    [/unable to validate email|invalid email|email address .* is invalid/i, "Cette adresse e-mail n’est pas valide."],
    [/same password|different from the old/i, "Choisissez un mot de passe différent de l’ancien."],
    [/failed to fetch|network/i, "Pas de connexion internet. Réessayez quand le réseau revient."]
  ];
  function erreur(e) {
    console.error(e);
    const m = e?.message || "";
    const fr = ERREURS_FR.find(([re]) => re.test(m));
    toast(fr ? fr[1] : m || "Une erreur est survenue.", true);
  }

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

  /* ---------- Langue : français / lingala ---------- */
  // Les traductions en lingala sont à relire par un locuteur natif : modifiez-les ici librement.
  const LANG_KEY = "mopila_langue";
  const TXT = {
    fr: {
      tab_avis: "Mes avis", noter_eyebrow: "Avis sur la course", noter_titre: "Notez votre course",
      noter_course: "Noter cette course", scan_requis: "Pour noter une course, scannez le QR code collé dans le véhicule. C’est la seule façon d’identifier votre taxi.",
      votre_trajet: "Votre trajet", note_prix: "Respect du prix", note_chauffeur: "Le chauffeur", choisir: "Choisir",
      excellent: "Excellent", mediocre: "Médiocre", excellent_prix: "il a respecté le prix officiel", mediocre_prix: "il a majoré le prix",
      excellent_chauffeur: "poli, prudent, honnête", mediocre_chauffeur: "impoli, imprudent ou malhonnête",
      prix_demande: "Prix demandé (FC)", photo: "Photo (facultatif)", commentaire: "Commentaire (facultatif)",
      commentaire_ph: "Ce qui s’est bien ou mal passé…", envoyer_avis: "Envoyer mon avis", trajet_requis: "Choisissez votre départ et votre arrivée dans la liste.",
      merci_avis: "Merci pour votre avis !", merci_excellent: "Votre avis aide les bons chauffeurs à être reconnus.",
      merci_mediocre: "La majoration a été transmise aux agents de contrôle. Vous serez informé de la suite.",
      mes_avis_titre: "Mes avis sur les courses", suivi_signalement: "Suivi du contrôle", aucun_avis: "Vous n’avez encore noté aucune course.",
      avis: "avis", avis_prix: "prix respecté", avis_chauffeur: "chauffeur apprécié",
      tab_prix: "Prix", tab_signaler: "Signaler", tab_scanner: "Scanner", tab_compte: "Compte",
      tab_chauffeur: "Chauffeur", tab_vehicules: "Véhicules", tab_admin: "Admin",
      prix_eyebrow: "Grille tarifaire officielle", prix_titre: "Quel est le bon prix ?",
      prix_intro: "Tapez votre départ et votre arrivée : le tarif officiel s’affiche, même sans connexion.",
      depart: "Départ", arrivee: "Arrivée", type_vehicule: "Type de véhicule", tapez_lieu: "Tapez un lieu…",
      inverser: "⇅ Inverser", recents: "Trajets récents", favoris: "⭐ Mes favoris",
      prix_officiel: "Prix officiel", plus_cher: "📷 Scanner le véhicule pour noter la course", ajouter_favori: "☆ Ajouter aux favoris",
      retirer_favori: "⭐ Retirer des favoris", partager: "Partager sur WhatsApp", pas_de_tarif: "Trajet pas encore dans la grille",
      pas_de_tarif_txt: "Ce trajet n’a pas encore de prix officiel. Essayez un autre type de véhicule ou un trajet proche.",
      classement: "🏆 Chauffeurs exemplaires du mois", classement_vide: "Pas encore de chauffeur classé ce mois-ci.",
      courses: "course(s)", partager_classement: "Partager le classement",
      verif_eyebrow: "Contrôle du véhicule", verif_titre: "Ce véhicule est-il en règle ?",
      verif_intro: "Scannez le QR code collé dans le véhicule, ou saisissez son code.",
      scanner_qr: "📷 Scanner le QR code", code_vehicule: "Code du véhicule", ok_titre: "Véhicule en règle",
      ko_titre: "Attention !", inconnu_titre: "Code inconnu", inconnu_txt: "Ce QR code n’est pas enregistré dans MOPILA CHECK. Soyez prudent.",
      agree: "Véhicule agréé", non_agree: "Véhicule non agréé", conforme: "Chauffeur conforme", non_conforme: "Chauffeur non conforme",
      deja_signale: "abus confirmé(s) sur ce véhicule", signaler_vehicule: "Signaler ce véhicule", fermer: "Fermer",
      voir_prix: "Voir les prix officiels",
      sig_titre: "On vous a demandé plus que le tarif officiel ?",
      connexion: "Se connecter", inscription: "Créer un compte",
      merci_confirme: "Merci ! Votre signalement sur {p} a été confirmé par un agent.",
      sig_rejete: "Votre signalement sur {p} a été examiné et n’a pas été retenu.",
      intro1_t: "Le juste prix", intro1_p: "Connaissez le prix officiel de votre trajet avant de monter, selon la grille de l’État.",
      intro2_t: "Scannez le véhicule", intro2_p: "Le QR code dans le véhicule vous dit s’il est agréé et si le chauffeur est en règle.",
      intro3_t: "Signalez les abus", intro3_p: "On vous demande plus ? Signalez-le en un clic : les agents de contrôle s’en occupent.",
      suivant: "Suivant", commencer: "Commencer", passer: "Passer", langue: "Langue"
    },
    ln: {
      tab_avis: "Makanisi na ngai", noter_eyebrow: "Likanisi na mobembo", noter_titre: "Pesa likanisi na mobembo na yo",
      noter_course: "Pesa likanisi", scan_requis: "Mpo na kopesa likanisi, scanner QR code oyo ezali na kati ya motuka. Ezali nzela kaka moko ya koyeba taxi na yo.",
      votre_trajet: "Mobembo na yo", note_prix: "Kotosa ntalo", note_chauffeur: "Shofɛ́lɛ", choisir: "Pona",
      excellent: "Malamu mingi", mediocre: "Mabe", excellent_prix: "atosaki ntalo ya Leta", mediocre_prix: "abakisaki ntalo",
      excellent_chauffeur: "na limemya, akebi, sembo", mediocre_chauffeur: "limemya te, akebi te to sembo te",
      prix_demande: "Ntalo basengaki (FC)", photo: "Foto (soki olingi)", commentaire: "Maloba (soki olingi)",
      commentaire_ph: "Nini elekaki malamu to mabe…", envoyer_avis: "Tinda likanisi na ngai", trajet_requis: "Pona esika ya kolongwa mpe ya kokende na liste.",
      merci_avis: "Matɔndi mpo na likanisi na yo !", merci_excellent: "Likanisi na yo esalisi bashofɛ́lɛ ya malamu bayebana.",
      merci_mediocre: "Ntalo oyo babakisaki etindami epai ya ba agents. Okoyebisama nsima.",
      mes_avis_titre: "Makanisi na ngai na mibembo", suivi_signalement: "Bolandi ya contrôle", aucun_avis: "Opesi naino likanisi te.",
      avis: "makanisi", avis_prix: "ntalo etosamaki", avis_chauffeur: "shofɛ́lɛ alingami",
      tab_prix: "Ntalo", tab_signaler: "Kofunda", tab_scanner: "Scanner", tab_compte: "Ngai",
      tab_chauffeur: "Shofɛ́lɛ", tab_vehicules: "Mituka", tab_admin: "Admin",
      prix_eyebrow: "Ntalo ya Leta", prix_titre: "Ntalo ya solo ezali boni ?",
      prix_intro: "Koma esika okolongwa mpe esika okokende : ntalo ya Leta ekobima, ata soki internet ezali te.",
      depart: "Esika ya kolongwa", arrivee: "Esika ya kokende", type_vehicule: "Lolenge ya motuka", tapez_lieu: "Koma kombo ya esika…",
      inverser: "⇅ Kobongola", recents: "Mibembo ya sika", favoris: "⭐ Mibembo nalingi",
      prix_officiel: "Ntalo ya Leta", plus_cher: "📷 Scanner motuka mpo na kopesa likanisi", ajouter_favori: "☆ Kobakisa na oyo nalingi",
      retirer_favori: "⭐ Kolongola", partager: "Kokabola na WhatsApp", pas_de_tarif: "Mobembo oyo ezali naino te",
      pas_de_tarif_txt: "Mobembo oyo ezali naino na ntalo ya Leta te. Meka lolenge mosusu ya motuka.",
      classement: "🏆 Bashofɛ́lɛ ya malamu ya sanza oyo", classement_vide: "Shofɛ́lɛ moko te naino na sanza oyo.",
      courses: "mobembo", partager_classement: "Kokabola",
      verif_eyebrow: "Kotala motuka", verif_titre: "Motuka oyo ezali na mibeko ?",
      verif_intro: "Scanner QR code oyo ezali na kati ya motuka, to koma code na yango.",
      scanner_qr: "📷 Scanner QR code", code_vehicule: "Code ya motuka", ok_titre: "Motuka ezali malamu",
      ko_titre: "Keba !", inconnu_titre: "Code eyebani te", inconnu_txt: "QR code oyo ekomami na MOPILA CHECK te. Keba.",
      agree: "Motuka endimami", non_agree: "Motuka endimami te", conforme: "Shofɛ́lɛ azali na mibeko", non_conforme: "Shofɛ́lɛ azali na mibeko te",
      deja_signale: "mbeba endimami na motuka oyo", signaler_vehicule: "Funda motuka oyo", fermer: "Kokanga",
      voir_prix: "Tala ntalo ya Leta",
      sig_titre: "Basengi yo mbongo koleka ntalo ya Leta ?",
      connexion: "Kokɔta", inscription: "Kosala compte",
      merci_confirme: "Matɔndi ! Bafundi na yo na {p} endimami na agent.",
      sig_rejete: "Bafundi na yo na {p} etalelami kasi endimami te.",
      intro1_t: "Ntalo ya solo", intro1_p: "Yeba ntalo ya Leta ya mobembo na yo liboso ya komata.",
      intro2_t: "Scanner motuka", intro2_p: "QR code ya motuka elakisi soki motuka endimami mpe soki shofɛ́lɛ azali na mibeko.",
      intro3_t: "Funda mabe", intro3_p: "Basengi yo mbongo mingi ? Funda yango : ba agents bakosala likambo.",
      suivant: "Oyo elandi", commencer: "Kobanda", passer: "Kotika", langue: "Monoko"
    }
  };
  let langue = "fr";
  try { langue = localStorage.getItem(LANG_KEY) === "ln" ? "ln" : "fr"; } catch (_) { /* stockage indisponible */ }
  function t(k, vars) {
    let s = TXT[langue][k] ?? TXT.fr[k] ?? k;
    if (vars) Object.entries(vars).forEach(([a, b]) => (s = s.replace("{" + a + "}", b)));
    return s;
  }
  function changerLangue(l) {
    langue = l === "ln" ? "ln" : "fr";
    try { localStorage.setItem(LANG_KEY, langue); } catch (_) { /* stockage indisponible */ }
    document.documentElement.lang = langue === "ln" ? "ln" : "fr";
    majTabbar(); route();
  }

  /* ---------- Stockage local (favoris, récents) ---------- */
  function lireLocal(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch (_) { return def; } }
  function ecrireLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* stockage indisponible */ } }
  const sansAccent = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

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

  /* ---------- Champ de recherche de lieu ---------- */
  function champLieu(id, label, selId) {
    const l = etat.lieux.find((x) => x.id === Number(selId));
    return `<label for="${id}">${label}</label>
      <div class="ac"><input id="${id}" autocomplete="off" placeholder="${t("tapez_lieu")}" value="${esc(l?.nom || "")}" data-id="${l ? l.id : ""}">
      <div class="ac-liste" id="${id}-l" hidden></div></div>`;
  }
  function activerChamp(id, onChange) {
    const inp = $("#" + id), liste = $("#" + id + "-l");
    const montrer = () => {
      const q = sansAccent(inp.value.trim());
      const res = etat.lieux.filter((l) => !q || sansAccent(l.nom + " " + (l.commune || "")).includes(q)).slice(0, 8);
      liste.innerHTML = res.map((l) => `<button type="button" data-id="${l.id}">${esc(l.nom)}<small>${esc(l.commune || "")}</small></button>`).join("")
        || `<div class="ac-vide">—</div>`;
      liste.hidden = false;
    };
    inp.addEventListener("focus", montrer);
    inp.addEventListener("input", () => {
      const exact = etat.lieux.find((l) => sansAccent(l.nom) === sansAccent(inp.value.trim()));
      inp.dataset.id = exact ? exact.id : "";
      montrer(); onChange();
    });
    inp.addEventListener("blur", () => setTimeout(() => (liste.hidden = true), 200));
    liste.addEventListener("mousedown", (e) => e.preventDefault());
    liste.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b) return;
      const l = etat.lieux.find((x) => x.id === Number(b.dataset.id));
      inp.value = l.nom; inp.dataset.id = l.id; liste.hidden = true; inp.blur(); onChange();
    });
  }

  /* ---------- Vue : Prix ---------- */
  const FAV_KEY = "mopila_favoris", REC_KEY = "mopila_recents";
  const cleTrajet = (x) => `${x.dep}-${x.arr}-${x.mode}`;
  const libTrajet = (x) => `${lieuNom(x.dep)} → ${lieuNom(x.arr)} · ${MODES[x.mode]}`;

  function vuePrix() {
    const p = params();
    let mode = MODES[p.mode] ? p.mode : "taxi_bus";
    const puces = (liste) => liste.filter((x) => prixLocal(x.dep, x.arr, x.mode))
      .map((x) => `<button type="button" class="puce" data-t='${esc(JSON.stringify(x))}'>${esc(libTrajet(x))}</button>`).join("");
    const fav = lireLocal(FAV_KEY, []), rec = lireLocal(REC_KEY, []);
    app.innerHTML = `
      <p class="eyebrow">${t("prix_eyebrow")}</p>
      <h1>${t("prix_titre")}</h1>
      <p class="muted">${t("prix_intro")}</p>
      ${fav.length ? `<p class="mini-titre">${t("favoris")}</p><div class="puces">${puces(fav)}</div>` : ""}
      ${rec.length ? `<p class="mini-titre">${t("recents")}</p><div class="puces">${puces(rec)}</div>` : ""}
      <div class="card">
        <label>${t("type_vehicule")}</label>
        <div class="choix-mode">${Object.entries(MODES).map(([k, v]) => `<button type="button" data-mode="${k}" class="${k === mode ? "actif" : ""}">${{ taxi_bus: "🚌", taxi: "🚕", taxi_moto: "🏍️" }[k]} ${v}</button>`).join("")}</div>
        ${champLieu("dep", t("depart"), p.dep)}
        ${champLieu("arr", t("arrivee"), p.arr)}
        <button class="btn ligne" id="inverser" type="button">${t("inverser")}</button>
      </div>
      <div id="resultat"></div>
      <div class="card" id="classement"><h3>${t("classement")}</h3><p class="muted">…</p></div>
      <p class="footer-note">${etat.tarifs.length} · ${etat.lieux.length}</p>`;

    const maj = () => {
      const dep = $("#dep").dataset.id, arr = $("#arr").dataset.id;
      const r = $("#resultat");
      if (!dep || !arr) { r.innerHTML = ""; return; }
      const tr = prixLocal(dep, arr, mode);
      if (!tr) { r.innerHTML = `<div class="card accent"><h3>${t("pas_de_tarif")}</h3><p class="muted">${t("pas_de_tarif_txt")}</p></div>`; return; }
      const x = { dep: Number(dep), arr: Number(arr), mode };
      ecrireLocal(REC_KEY, [x, ...lireLocal(REC_KEY, []).filter((y) => cleTrajet(y) !== cleTrajet(x))].slice(0, 5));
      const estFav = lireLocal(FAV_KEY, []).some((y) => cleTrajet(y) === cleTrajet(x));
      const lien = location.origin + location.pathname;
      const msg = `🚖 ${t("prix_officiel")} ${lieuNom(dep)} → ${lieuNom(arr)} (${MODES[mode]}) : ${fc(tr.prix_fc)}. MOPILA CHECK : ${lien}`;
      r.innerHTML = `
        <div class="card dark apparition">
          <p class="muted">${esc(lieuNom(dep))} → ${esc(lieuNom(arr))} · ${MODES[mode]}</p>
          <div class="prix-grand">${fc(tr.prix_fc)}</div>
          <p class="muted">${esc(tr.arrete)} · ${jourFr(tr.date_effet)}</p>
          <div class="row">
            <button class="btn petit ligne-claire" id="fav" type="button">${estFav ? t("retirer_favori") : t("ajouter_favori")}</button>
            <a class="btn petit whatsapp" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${t("partager")}</a>
          </div>
          <a class="btn jaune" href="#/verifier?scan=1">${t("plus_cher")}</a>
        </div>`;
      $("#fav").addEventListener("click", () => {
        const liste = lireLocal(FAV_KEY, []);
        const deja = liste.some((y) => cleTrajet(y) === cleTrajet(x));
        ecrireLocal(FAV_KEY, deja ? liste.filter((y) => cleTrajet(y) !== cleTrajet(x)) : [x, ...liste].slice(0, 10));
        $("#fav").textContent = deja ? t("ajouter_favori") : t("retirer_favori");
      });
    };
    activerChamp("dep", maj);
    activerChamp("arr", maj);
    app.querySelectorAll(".choix-mode button").forEach((b) => b.addEventListener("click", () => {
      mode = b.dataset.mode;
      app.querySelectorAll(".choix-mode button").forEach((x) => x.classList.toggle("actif", x === b));
      maj();
    }));
    app.querySelectorAll(".puce").forEach((b) => b.addEventListener("click", () => {
      const x = JSON.parse(b.dataset.t);
      mode = x.mode;
      app.querySelectorAll(".choix-mode button").forEach((y) => y.classList.toggle("actif", y.dataset.mode === mode));
      $("#dep").value = lieuNom(x.dep); $("#dep").dataset.id = x.dep;
      $("#arr").value = lieuNom(x.arr); $("#arr").dataset.id = x.arr;
      maj();
      $("#resultat").scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    $("#inverser").addEventListener("click", () => {
      const d = $("#dep"), a = $("#arr");
      [d.value, a.value] = [a.value, d.value];
      [d.dataset.id, a.dataset.id] = [a.dataset.id, d.dataset.id];
      maj();
    });
    maj();
    chargerClassement();
  }

  async function chargerClassement() {
    const z = $("#classement");
    if (!z) return;
    const { data, error } = await sb.rpc("classement_chauffeurs", { p_limite: 5 });
    if (!$("#classement")) return;
    if (error || !data?.length) { z.innerHTML = `<h3>${t("classement")}</h3><p class="muted">${t("classement_vide")}</p>`; return; }
    const medailles = ["🥇", "🥈", "🥉", "4.", "5."];
    const texte = `${t("classement")}\n` + data.map((c, i) => `${medailles[i]} ${c.nom} (👍 ${c.excellents} ${t("avis")})`).join("\n") + `\nMOPILA CHECK : ${location.origin + location.pathname}`;
    z.innerHTML = `<h3>${t("classement")}</h3>
      <ul class="liste">${data.map((c, i) => `<li><div class="ligne-haut"><span>${medailles[i]} <b>${esc(c.nom)}</b></span><span class="badge ok">👍 ${c.excellents} / ${c.avis} ${t("avis")}</span></div></li>`).join("")}</ul>
      <a class="btn petit whatsapp" style="margin-top:10px" href="https://wa.me/?text=${encodeURIComponent(texte)}" target="_blank" rel="noopener">${t("partager_classement")}</a>`;
  }

  /* ---------- Vue : Vérifier un véhicule ---------- */
  function extraireCode(texte) {
    try { const u = new URL(texte); return u.searchParams.get("v") || texte.trim(); } catch (_) { return texte.trim(); }
  }

  function fermerVerdict() { document.getElementById("verdict")?.remove(); }

  function afficherVerdict(v, code) {
    fermerVerdict();
    const ok = v && v.agree && v.chauffeur_conforme && v.signalements_confirmes < 2;
    try { navigator.vibrate?.(ok ? 80 : [200, 100, 200]); } catch (_) { /* vibration indisponible */ }
    const d = document.createElement("div");
    d.id = "verdict";
    d.className = "verdict " + (ok ? "ok" : "ko");
    d.setAttribute("role", "dialog");
    d.innerHTML = v ? `
      <div class="verdict-icone">${ok ? "✅" : "⚠️"}</div>
      <h1>${ok ? t("ok_titre") : t("ko_titre")}</h1>
      <div class="verdict-plaque">${esc(v.plaque)}</div>
      <p>${MODES[v.mode]}${v.chauffeur_nom ? " · " + esc(v.chauffeur_nom) : ""}</p>
      <ul class="verdict-liste">
        <li>${v.agree ? "✔" : "✖"} ${v.agree ? t("agree") : t("non_agree")}</li>
        <li>${v.chauffeur_conforme ? "✔" : "✖"} ${v.chauffeur_conforme ? t("conforme") : t("non_conforme")}</li>
        ${v.signalements_confirmes ? `<li>✖ ${v.signalements_confirmes} ${t("deja_signale")}</li>` : ""}
        ${v.nb_avis ? `<li>⭐ ${v.nb_avis} ${t("avis")} : ${v.pct_prix_excellent} % ${t("avis_prix")}, ${v.pct_chauffeur_excellent} % ${t("avis_chauffeur")}</li>` : ""}
      </ul>
      ${code && etat.session ? `<a class="btn jaune gros" href="#/signaler?v=${encodeURIComponent(code)}">⭐ ${t("noter_course")}</a>` : ""}
      <a class="btn ligne-claire" id="v-prix" href="#/prix?mode=${v.mode}">${t("voir_prix")}</a>
      <button class="btn ligne-claire" id="v-fermer" type="button">${t("fermer")}</button>`
      : `<div class="verdict-icone">❓</div><h1>${t("inconnu_titre")}</h1><p>${t("inconnu_txt")}</p>
      <button class="btn jaune" id="v-fermer" type="button">${t("fermer")}</button>`;
    document.body.appendChild(d);
    d.querySelector("#v-fermer").addEventListener("click", fermerVerdict);
    d.querySelectorAll("a").forEach((a) => a.addEventListener("click", fermerVerdict));
  }

  async function vueVerifier() {
    const p = params();
    app.innerHTML = `
      <p class="eyebrow">${t("verif_eyebrow")}</p>
      <h1>${t("verif_titre")}</h1>
      <p class="muted">${t("verif_intro")}</p>
      <div class="card">
        <div id="lecteur"></div>
        <button class="btn jaune gros" id="scanner" type="button">${t("scanner_qr")}</button>
        <label for="code">${t("code_vehicule")}</label>
        <div class="row"><input id="code" placeholder="Code" value="${esc(p.v || "")}"><button class="btn petit" id="chercher" type="button">OK</button></div>
      </div>
      <a class="btn ligne" href="#/prix">${t("voir_prix")}</a>`;

    const verifier = async (code) => {
      code = extraireCode(code || "");
      if (!code) return;
      $("#code").value = code;
      const { data, error } = await sb.rpc("verifier_vehicule", { p_qr: code });
      if (error) return erreur(error);
      afficherVerdict(data?.[0] || null, code);
      journaliser("scan", data?.[0]?.plaque || "code inconnu");
    };

    $("#chercher").addEventListener("click", () => verifier($("#code").value));
    $("#code").addEventListener("keydown", (e) => { if (e.key === "Enter") verifier($("#code").value); });
    const lancer = async () => {
      if (!window.Html5Qrcode) return toast("Le scanner n’a pas pu se charger. Saisissez le code.", true);
      try {
        await arreterScanner();
        etat.scanner = new Html5Qrcode("lecteur");
        await etat.scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, async (texte) => {
          await arreterScanner();
          verifier(texte);
        });
      } catch (e) { erreur({ message: "Impossible d’ouvrir la caméra : " + (e?.message || e) }); }
    };
    $("#scanner").addEventListener("click", lancer);
    if (p.v) verifier(p.v);
    else if (p.scan) lancer();
  }

  async function arreterScanner() {
    if (etat.scanner) {
      try { await etat.scanner.stop(); etat.scanner.clear(); } catch (_) { /* déjà arrêté */ }
      etat.scanner = null;
    }
  }

  /* ---------- Vue : Noter une course (uniquement après un scan) ---------- */
  function besoinConnexion(titre) {
    app.innerHTML = `
      <h1>${titre}</h1>
      <div class="card accent"><p>Connectez-vous pour continuer. C’est gratuit et rapide.</p>
      <a class="btn" href="#/compte?retour=${encodeURIComponent(location.hash)}">Se connecter ou créer un compte</a></div>`;
  }

  const NOTE_LIB = () => ({ excellent: t("excellent"), mediocre: t("mediocre") });
  const badgeNote = (n) => `<span class="badge ${n === "excellent" ? "ok" : "ko"}">${n === "excellent" ? "👍 " : "👎 "}${NOTE_LIB()[n]}</span>`;

  async function vueNoter() {
    if (!etat.session) return besoinConnexion(t("noter_titre"));
    const p = params();
    if (!p.v) {
      app.innerHTML = `
        <p class="eyebrow">${t("tab_avis")}</p>
        <h1>${t("noter_titre")}</h1>
        <div class="card accent"><div style="font-size:56px;text-align:center">📷</div>
          <p style="text-align:center">${t("scan_requis")}</p>
          <a class="btn jaune gros" href="#/verifier?scan=1">${t("scanner_qr")}</a></div>`;
      return;
    }
    const { data, error } = await sb.rpc("verifier_vehicule", { p_qr: p.v });
    if (error) return erreur(error);
    const v = data?.[0];
    if (!v) { afficherVerdict(null); location.hash = "#/verifier"; return; }

    app.innerHTML = `
      <p class="eyebrow">${t("noter_eyebrow")}</p>
      <h1>${t("noter_titre")}</h1>
      <div class="card dark" style="display:flex;align-items:center;gap:14px">
        <div class="verdict-plaque" style="font-size:24px;margin:0">${esc(v.plaque)}</div>
        <div><b>${MODES[v.mode]}</b><div class="muted">${esc(v.chauffeur_nom || "—")}</div></div>
      </div>
      <form class="card" id="form">
        <h3>1. ${t("votre_trajet")}</h3>
        ${champLieu("dep", t("depart"), p.dep)}
        ${champLieu("arr", t("arrivee"), p.arr)}
        <div id="officiel" class="officiel"></div>

        <h3 style="margin-top:18px">2. ${t("note_prix")}</h3>
        <select id="note_prix" required>
          <option value="">— ${t("choisir")} —</option>
          <option value="excellent">👍 ${t("excellent")} : ${t("excellent_prix")}</option>
          <option value="mediocre">👎 ${t("mediocre")} : ${t("mediocre_prix")}</option>
        </select>
        <div id="bloc-majore" hidden>
          <label for="prix">${t("prix_demande")}</label>
          <input id="prix" type="number" min="50" step="50" inputmode="numeric">
          <p id="ecart" class="muted"></p>
          <label for="photo">${t("photo")}</label>
          <input id="photo" type="file" accept="image/*" capture="environment">
        </div>

        <h3 style="margin-top:18px">3. ${t("note_chauffeur")}</h3>
        <select id="note_chauffeur" required>
          <option value="">— ${t("choisir")} —</option>
          <option value="excellent">👍 ${t("excellent")} : ${t("excellent_chauffeur")}</option>
          <option value="mediocre">👎 ${t("mediocre")} : ${t("mediocre_chauffeur")}</option>
        </select>

        <label for="com">${t("commentaire")}</label>
        <textarea id="com" maxlength="500" placeholder="${t("commentaire_ph")}"></textarea>
        <button class="btn jaune gros" id="envoyer">${t("envoyer_avis")}</button>
      </form>`;

    const majPrix = () => {
      const tr = prixLocal($("#dep").dataset.id, $("#arr").dataset.id, v.mode);
      $("#officiel").innerHTML = tr ? `${t("prix_officiel")} : <b>${fc(tr.prix_fc)}</b>` : "";
      const d = Number($("#prix").value);
      $("#ecart").innerHTML = tr && d > tr.prix_fc ? `+${fc(d - tr.prix_fc)} (${Math.round((d / tr.prix_fc - 1) * 100)} %)` : "";
    };
    activerChamp("dep", majPrix);
    activerChamp("arr", majPrix);
    $("#prix").addEventListener("input", majPrix);
    $("#note_prix").addEventListener("change", () => {
      const m = $("#note_prix").value === "mediocre";
      $("#bloc-majore").hidden = !m;
      $("#prix").required = m;
    });
    majPrix();

    $("#form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = $("#envoyer"); b.disabled = true;
      try {
        if (!$("#dep").dataset.id || !$("#arr").dataset.id) throw new Error(t("trajet_requis"));
        const mediocre = $("#note_prix").value === "mediocre";
        let photo = null;
        const f = mediocre ? $("#photo").files[0] : null;
        if (f) {
          if (f.size > 5 * 1024 * 1024) throw new Error("La photo dépasse 5 Mo.");
          const ext = (f.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
          photo = `${etat.session.user.id}/${Date.now()}.${ext}`;
          const up = await sb.storage.from("photos").upload(photo, f, { contentType: f.type });
          if (up.error) throw up.error;
        }
        const { error } = await sb.rpc("noter_course", {
          p_qr: p.v, p_depart: Number($("#dep").dataset.id), p_arrivee: Number($("#arr").dataset.id),
          p_note_prix: $("#note_prix").value, p_prix_demande: mediocre ? Number($("#prix").value) : null,
          p_note_chauffeur: $("#note_chauffeur").value, p_commentaire: $("#com").value.trim() || null, p_photo: photo
        });
        if (error) throw error;
        journaliser("avis", `${v.plaque} : prix ${$("#note_prix").value}, chauffeur ${$("#note_chauffeur").value}`);
        app.innerHTML = `
          <div class="card ${mediocre ? "accent" : "dark"} apparition" style="text-align:center">
            <div style="font-size:72px">${mediocre ? "🛡️" : "🙏"}</div>
            <h1>${t("merci_avis")}</h1>
            <p class="muted">${mediocre ? t("merci_mediocre") : t("merci_excellent")}</p>
            <a class="btn jaune" href="#/avis">${t("tab_avis")}</a>
            <a class="btn ligne${mediocre ? "" : "-claire"}" href="#/verifier">${t("fermer")}</a>
          </div>`;
      } catch (err) { erreur(err); b.disabled = false; }
    });
  }

  /* ---------- Vue : Mes avis ---------- */
  async function vueMesAvis() {
    if (!etat.session) return besoinConnexion(t("tab_avis"));
    sb.from("signalements").select("id").eq("client_id", etat.session.user.id).in("statut", ["confirme", "rejete"])
      .then(({ data }) => { if (data) { marquerVu("mesavis", data.map((x) => x.id)); majBadges(); } });
    const { data, error } = await sb.from("evaluations")
      .select("id, note_prix, note_chauffeur, prix_officiel_fc, prix_demande_fc, mode, depart_id, arrivee_id, commentaire, date_heure, signalements(statut)")
      .eq("client_id", etat.session.user.id).order("date_heure", { ascending: false }).limit(50);
    if (error) return erreur(error);
    app.innerHTML = `
      <p class="eyebrow">${t("tab_avis")}</p>
      <h1>${t("mes_avis_titre")}</h1>
      <a class="btn jaune gros" href="#/verifier?scan=1" style="margin-bottom:16px">⭐ ${t("noter_course")}</a>
      ${data.length ? data.map((a) => `
        <div class="card">
          <div class="ligne-haut" style="display:flex;justify-content:space-between;gap:8px"><b>${esc(lieuNom(a.depart_id))} → ${esc(lieuNom(a.arrivee_id))}</b><span class="muted">${dateFr(a.date_heure)}</span></div>
          <p class="muted">${MODES[a.mode]} · ${t("prix_officiel")} ${fc(a.prix_officiel_fc)}${a.prix_demande_fc ? ` · ${t("prix_demande")} ${fc(a.prix_demande_fc)}` : ""}</p>
          <p>${t("note_prix")} : ${badgeNote(a.note_prix)}<br>${t("note_chauffeur")} : ${badgeNote(a.note_chauffeur)}</p>
          ${a.signalements ? `<p>${t("suivi_signalement")} : ${badgeStatut(a.signalements.statut)}</p>` : ""}
          ${a.commentaire ? `<p class="muted">« ${esc(a.commentaire)} »</p>` : ""}
        </div>`).join("") : `<div class="card"><p class="muted">${t("aucun_avis")}</p></div>`}`;
  }

  /* ---------- Vue : Compte ---------- */
  async function vueCompte() {
    if (!etat.session) return vueConnexion();
    const p = etat.profil || {};
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
      <a class="btn ligne" href="#/avis" style="margin-top:16px">⭐ ${t("tab_avis")}</a>
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

  const champMdp = (id, label, auto) => `<label for="${id}">${label}</label>
    <div class="mdp-zone"><input id="${id}" type="password" required minlength="6" autocomplete="${auto}" autocapitalize="off" autocorrect="off" spellcheck="false">
    <button type="button" class="oeil" data-pour="${id}" aria-label="Afficher le mot de passe">👁️</button></div>`;
  function activerYeux() {
    app.querySelectorAll(".oeil").forEach((b) => b.addEventListener("click", () => {
      const i = $("#" + b.dataset.pour);
      const voir = i.type === "password";
      i.type = voir ? "text" : "password";
      b.textContent = voir ? "🙈" : "👁️";
    }));
  }

  function vueConnexion() {
    const p = params();
    if (p.mode === "oubli") return vueMotDePasseOublie();
    if (p.mode === "nouveau") return vueNouveauMotDePasse();
    const inscription = p.mode === "inscription";
    app.innerHTML = `
      <p class="eyebrow">Mon compte</p>
      <h1>${inscription ? t("inscription") : t("connexion")}</h1>
      <form class="card" id="form">
        ${inscription ? `
          <label for="nom">Nom complet</label><input id="nom" required>
          <label for="tel">Téléphone</label><input id="tel" inputmode="tel" placeholder="+243…">
          <label for="role">Je suis</label>
          <select id="role"><option value="client">Client (passager)</option><option value="chauffeur">Chauffeur</option><option value="proprietaire">Propriétaire de véhicules</option></select>` : ""}
        <label for="email">E-mail</label><input id="email" type="email" required autocomplete="email" autocapitalize="off" inputmode="email">
        ${champMdp("mdp", "Mot de passe", inscription ? "new-password" : "current-password")}
        ${inscription ? `<p class="muted" style="margin-top:6px">Au moins 6 caractères. Touchez 👁️ pour voir ce que vous tapez.</p>
          ${champMdp("mdp2", "Retapez le mot de passe", "new-password")}` : ""}
        <button class="btn" id="valider">${inscription ? "Créer mon compte" : "Se connecter"}</button>
        ${inscription ? "" : `<p style="text-align:center;margin:14px 0 0"><a href="#/compte?mode=oubli">Mot de passe oublié ?</a></p>`}
      </form>
      <p style="text-align:center">${inscription
        ? `Déjà inscrit ? <a href="#/compte">Se connecter</a>`
        : `Pas encore de compte ? <a href="#/compte?mode=inscription">Créer un compte</a>`}</p>`;
    activerYeux();

    $("#form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = $("#valider"); b.disabled = true;
      try {
        const email = $("#email").value.trim().toLowerCase(), password = $("#mdp").value;
        if (inscription) {
          if (password !== $("#mdp2").value) throw new Error("Les deux mots de passe ne sont pas identiques.");
          const { data, error } = await sb.auth.signUp({
            email, password,
            options: {
              emailRedirectTo: location.origin + location.pathname,
              data: { nom: $("#nom").value.trim(), telephone: $("#tel").value.trim(), role: $("#role").value }
            }
          });
          if (error) throw error;
          if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error("User already registered");
          if (!data.session) {
            app.innerHTML = `<div class="card accent apparition" style="text-align:center">
              <div style="font-size:64px">📧</div><h1>Compte créé !</h1>
              <p>Un e-mail de confirmation a été envoyé à <b>${esc(email)}</b>.</p>
              <p class="muted">Ouvrez-le et touchez le lien, puis revenez vous connecter. Regardez aussi dans les <b>spams</b>.
              Si rien n’arrive, demandez à l’administrateur de confirmer votre compte.</p>
              <a class="btn" href="#/compte">Se connecter</a></div>`;
            return;
          }
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
        await chargerProfil();
        journaliser(inscription ? "inscription" : "connexion");
        verifierNouvelles();
        const cible = p.retour ? decodeURIComponent(p.retour) : "#/verifier";
        if (location.hash === cible) route(); else location.hash = cible;
      } catch (err) { erreur(err); } finally { b.disabled = false; }
    });
  }

  function vueMotDePasseOublie() {
    app.innerHTML = `
      <p class="eyebrow">Mon compte</p>
      <h1>Mot de passe oublié</h1>
      <form class="card" id="form">
        <p class="muted">Entrez l’e-mail de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
        <label for="email">E-mail</label><input id="email" type="email" required autocomplete="email" autocapitalize="off" inputmode="email">
        <button class="btn" id="valider">Recevoir le lien</button>
      </form>
      <p style="text-align:center"><a href="#/compte">← Retour à la connexion</a></p>`;
    $("#form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = $("#valider"); b.disabled = true;
      const email = $("#email").value.trim().toLowerCase();
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      b.disabled = false;
      if (error) return erreur(error);
      app.innerHTML = `<div class="card accent apparition" style="text-align:center">
        <div style="font-size:64px">📧</div><h1>E-mail envoyé</h1>
        <p>Si un compte existe pour <b>${esc(email)}</b>, un lien vient d’être envoyé.</p>
        <p class="muted">Ouvrez-le sur ce téléphone et choisissez votre nouveau mot de passe. Regardez aussi dans les spams.</p>
        <a class="btn ligne" href="#/compte">Retour à la connexion</a></div>`;
    });
  }

  function vueNouveauMotDePasse() {
    if (!etat.session) { toast("Le lien a expiré : demandez-en un nouveau.", true); location.hash = "#/compte?mode=oubli"; return; }
    app.innerHTML = `
      <p class="eyebrow">Mon compte</p>
      <h1>Nouveau mot de passe</h1>
      <form class="card" id="form">
        ${champMdp("mdp", "Nouveau mot de passe", "new-password")}
        ${champMdp("mdp2", "Retapez le nouveau mot de passe", "new-password")}
        <button class="btn jaune" id="valider">Enregistrer</button>
      </form>`;
    activerYeux();
    $("#form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if ($("#mdp").value !== $("#mdp2").value) return erreur({ message: "Les deux mots de passe ne sont pas identiques." });
      const b = $("#valider"); b.disabled = true;
      const { error } = await sb.auth.updateUser({ password: $("#mdp").value });
      b.disabled = false;
      if (error) return erreur(error);
      journaliser("mot de passe changé");
      toast("Mot de passe enregistré. Vous êtes connecté.");
      location.hash = "#/verifier";
    });
  }

  /* ---------- Vue : Chauffeur ---------- */
  async function vueChauffeur() {
    if (!etat.session) return besoinConnexion("Espace chauffeur");
    if (!aRole("chauffeur")) { app.innerHTML = `<div class="card">Cet espace est réservé aux chauffeurs.</div>`; return; }
    const uid = etat.session.user.id;
    if (estVraiAdmin()) await sb.from("chauffeurs").upsert({ id: uid }, { onConflict: "id", ignoreDuplicates: true });
    const aujourdhui = new Date(); aujourdhui.setHours(0, 0, 0, 0);
    const [conf, docs, aff, courses, avis] = await Promise.all([
      sb.rpc("chauffeur_est_conforme", { p_chauffeur: uid }),
      sb.from("documents_chauffeur").select("*").eq("chauffeur_id", uid).order("created_at", { ascending: false }),
      sb.from("affectations").select("vehicule_id, vehicules(plaque, mode, agree)").eq("chauffeur_id", uid).eq("actif", true).maybeSingle(),
      sb.from("courses").select("*").eq("chauffeur_id", uid).order("date_heure", { ascending: false }).limit(30),
      sb.from("evaluations").select("note_prix, note_chauffeur, commentaire, date_heure").eq("chauffeur_id", uid).order("date_heure", { ascending: false }).limit(200)
    ]);
    const av = avis.data || [];
    const pct = (k) => (av.length ? Math.round((100 * av.filter((a) => a[k] === "excellent").length) / av.length) : 0);
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
        <div class="row" style="margin-top:12px">
          <button class="btn petit ligne" id="copier" type="button">📋 Copier le code</button>
          <a class="btn petit whatsapp" target="_blank" rel="noopener"
             href="https://wa.me/?text=${encodeURIComponent(`Bonjour, voici mon code chauffeur MOPILA CHECK pour m’affecter à votre véhicule :\n\n${uid}\n\nCollez-le dans l’application (bouton Véhicules › Affecter un chauffeur).\n— ${etat.profil?.nom || "Chauffeur"}`)}">Envoyer par WhatsApp</a>
        </div>
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
        <h2>⭐ Avis des clients</h2>
        ${av.length ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            ${tuile(pct("note_prix") + " %", "prix respecté (Excellent)", true)}${tuile(pct("note_chauffeur") + " %", "conduite appréciée")}
          </div>
          <p class="muted">${av.length} avis au total</p>
          <ul class="liste">${av.filter((a) => a.commentaire).slice(0, 5).map((a) => `<li>${badgeNote(a.note_prix)} ${badgeNote(a.note_chauffeur)}
            <div class="muted">« ${esc(a.commentaire)} » · ${dateFr(a.date_heure)}</div></li>`).join("")}</ul>`
        : '<p class="muted">Aucun avis pour l’instant. Les clients notent la course en scannant le QR code du véhicule.</p>'}
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
  const pctTxt = (n) => (n == null ? "—" : n + " %");

  async function vueProprietaire() {
    if (!etat.session) return besoinConnexion("Mes véhicules");
    if (!aRole("proprietaire", "admin")) { app.innerHTML = `<div class="card">Cet espace est réservé aux propriétaires de véhicules.</div>`; return; }
    const p = params();
    if (p.v) return vueSuiviVehicule(Number(p.v));
    const uid = etat.session.user.id;
    const { data: flotte, error } = await sb.rpc("suivi_flotte");
    if (error) return erreur(error);
    const somme = (k) => flotte.reduce((s, v) => s + Number(v[k] || 0), 0);
    const alertes = flotte.filter((v) => v.plaintes_ouvertes > 0 || v.doc_alerte || (v.chauffeur_id && !v.chauffeur_conforme) || !v.chauffeur_id);

    app.innerHTML = `
      <p class="eyebrow">Propriétaire</p>
      <h1>Ma flotte</h1>
      ${grille2(tuile(flotte.length, "véhicule(s)", true) + tuile(fc(somme("recette_jour")), "recette du jour")
        + tuile(fc(somme("recette_mois")), "recette du mois") + tuile(somme("plaintes_ouvertes"), "plainte(s) en cours"))}
      ${alertes.length ? `<div class="card accent"><h3>⚠️ À surveiller</h3><ul class="liste">${alertes.map((v) => `
        <li><b>${esc(v.plaque)}</b> · <span class="muted">${[
          !v.chauffeur_id ? "aucun chauffeur affecté" : "",
          v.chauffeur_id && !v.chauffeur_conforme ? "chauffeur non conforme" : "",
          v.doc_alerte ? "document du chauffeur bientôt expiré" : "",
          v.plaintes_ouvertes ? v.plaintes_ouvertes + " plainte(s) en cours" : ""].filter(Boolean).join(" · ")}</span></li>`).join("")}</ul></div>` : ""}
      ${flotte.map((v) => `
        <div class="card">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <div><h2 style="margin:0">${esc(v.plaque)}</h2><span class="muted">${MODES[v.mode]}</span></div>
            <span class="badge ${v.agree ? "ok" : "att"}">${v.agree ? "Agréé" : "En attente d’agrément"}</span>
          </div>
          <p style="margin-top:10px">🚖 ${v.chauffeur_nom ? `<b>${esc(v.chauffeur_nom)}</b> <span class="badge ${v.chauffeur_conforme ? "ok" : "ko"}">${v.chauffeur_conforme ? "Conforme" : "Non conforme"}</span>` : '<span class="muted">Aucun chauffeur</span>'}</p>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;text-align:center;margin:8px 0">
            <div><b>${fc(v.recette_jour)}</b><div class="muted" style="font-size:12px">aujourd’hui</div></div>
            <div><b>${fc(v.recette_mois)}</b><div class="muted" style="font-size:12px">ce mois</div></div>
            <div><b>${pctTxt(v.pct_prix_excellent)}</b><div class="muted" style="font-size:12px">prix respecté (${v.nb_avis} avis)</div></div>
          </div>
          ${v.plaintes_ouvertes || v.plaintes_confirmees ? `<p><span class="badge ko">${v.plaintes_ouvertes} plainte(s) en cours · ${v.plaintes_confirmees} confirmée(s)</span></p>` : ""}
          <a class="btn" href="#/proprietaire?v=${v.vehicule_id}">📊 Voir le suivi complet</a>
        </div>`).join("") || '<div class="card"><p class="muted">Aucun véhicule enregistré.</p></div>'}
      ${flotte.length ? `<button class="btn ligne" id="exp-flotte" type="button">📊 Exporter ma flotte (Excel)</button>` : ""}
      <details class="card" style="margin-top:16px" ${flotte.length ? "" : "open"}><summary><b>➕ Enregistrer un véhicule</b></summary>
        <form id="ajout">
          <div class="row">
            <div><label for="plaque">Plaque</label><input id="plaque" required></div>
            <div><label for="mode">Type</label><select id="mode">${optionsModes("taxi_bus")}</select></div>
          </div>
          <button class="btn">Enregistrer</button>
          <p class="muted" style="margin-top:8px">Le QR code est créé aussitôt. Un agent devra ensuite agréer le véhicule.</p>
        </form>
      </details>`;

    $("#ajout").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { data, error } = await sb.from("vehicules").insert({ plaque: $("#plaque").value.trim().toUpperCase().replace(/\s+/g, ""), mode: $("#mode").value, proprietaire_id: uid }).select("id").single();
      if (error) return erreur(error.code === "23505" ? { message: "Cette plaque est déjà enregistrée." } : error);
      toast("Véhicule enregistré.");
      location.hash = "#/proprietaire?v=" + data.id;
    });
    $("#exp-flotte")?.addEventListener("click", () => telechargerCSV("ma_flotte", [
      ["Plaque", "Mode", "Agréé", "Chauffeur", "Chauffeur conforme", "Recette du jour (FC)", "Recette 7 jours (FC)", "Recette du mois (FC)", "Courses du mois", "Avis", "Prix respecté (%)", "Chauffeur apprécié (%)", "Plaintes en cours", "Plaintes confirmées"],
      ...flotte.map((v) => [v.plaque, MODES[v.mode], v.agree ? "oui" : "non", v.chauffeur_nom || "", v.chauffeur_conforme ? "oui" : "non", v.recette_jour, v.recette_semaine, v.recette_mois, v.courses_mois, v.nb_avis, v.pct_prix_excellent ?? "", v.pct_chauffeur_excellent ?? "", v.plaintes_ouvertes, v.plaintes_confirmees])]));
  }

  async function vueSuiviVehicule(id) {
    const { data: s, error } = await sb.rpc("suivi_vehicule", { p_vehicule: id });
    if (error) { erreur(error); location.hash = "#/proprietaire"; return; }
    const v = s.vehicule, ch = s.chauffeur, r = s.recette, av = s.avis;
    const auj = new Date().toISOString().slice(0, 10);
    // Recette des 14 derniers jours, jours sans course compris
    const jours = [];
    for (let k = 13; k >= 0; k--) {
      const d = new Date(); d.setDate(d.getDate() - k);
      const cle = d.toISOString().slice(0, 10);
      const x = (r.par_jour || []).find((j) => j.jour === cle);
      jours.push({ jour: cle, montant: x ? Number(x.montant) : 0, courses: x ? x.courses : 0 });
    }
    const max = Math.max(1, ...jours.map((j) => j.montant));
    const pc = (n) => (av.total ? Math.round((100 * n) / av.total) + " %" : "—");

    app.innerHTML = `
      <a href="#/proprietaire" class="muted" style="text-decoration:none">← Ma flotte</a>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px">
        <div><p class="eyebrow">${MODES[v.mode]}</p><div class="verdict-plaque" style="display:inline-block;font-size:28px;margin:0">${esc(v.plaque)}</div></div>
        <span class="badge ${v.agree ? "ok" : "att"}">${v.agree ? "Agréé" : "En attente d’agrément"}</span>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>1. Le chauffeur</h2>
        ${ch ? `
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <div><b>${esc(ch.nom || "Chauffeur")}</b>${ch.telephone ? `<div class="muted">📞 ${esc(ch.telephone)}</div>` : ""}</div>
            <span class="badge ${ch.conforme ? "ok" : "ko"}">${ch.conforme ? "Conforme" : "Non conforme"}</span>
          </div>
          <ul class="liste" style="margin-top:8px">${Object.entries(DOCS).filter(([k]) => k !== "vignette").map(([k, lib]) => {
            const d = (ch.documents || []).filter((x) => x.type === k).sort((a, b) => (a.expiration < b.expiration ? 1 : -1))[0];
            const etatDoc = !d ? '<span class="badge ko">Manquant</span>'
              : d.statut !== "verifie" ? `<span class="badge att">${d.statut === "rejete" ? "Rejeté" : "En attente"}</span>`
              : d.expiration < auj ? '<span class="badge ko">Expiré</span>'
              : (new Date(d.expiration) - new Date()) / 86400000 < 30 ? `<span class="badge att">Expire le ${jourFr(d.expiration)}</span>`
              : `<span class="badge ok">Valide</span>`;
            return `<li><div class="ligne-haut"><span>${lib}</span>${etatDoc}</div></li>`;
          }).join("")}</ul>`
        : '<p class="muted">Aucun chauffeur affecté à ce véhicule.</p>'}
        <form id="affecter" style="margin-top:10px">
          <label>${ch ? "Changer de chauffeur" : "Affecter un chauffeur"} (code chauffeur)</label>
          <div class="row"><input name="code" required placeholder="Code donné par le chauffeur"><button class="btn petit">Affecter</button></div>
        </form>
        ${s.historique.length > 1 ? `<details style="margin-top:10px"><summary class="muted">Historique des chauffeurs (${s.historique.length})</summary>
          <ul class="liste">${s.historique.map((h) => `<li>${esc(h.nom || "—")} <span class="muted">· du ${dateFr(h.debut)}${h.fin ? " au " + dateFr(h.fin) : " à aujourd’hui"}</span></li>`).join("")}</ul></details>` : ""}
      </div>

      <div class="card">
        <h2>2. La recette</h2>
        ${grille2(tuile(fc(r.jour), "aujourd’hui", true) + tuile(fc(r.semaine), "7 derniers jours") + tuile(fc(r.mois), "ce mois") + tuile(r.courses_mois, "courses ce mois"))}
        <h3>14 derniers jours</h3>
        <div style="display:flex;align-items:flex-end;gap:3px;height:130px;margin-top:6px">${jours.map((j) => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%" title="${jourFr(j.jour)} : ${fc(j.montant)} (${j.courses} course(s))">
            <div style="width:100%;background:${j.montant ? "#F2B705" : "#E2DCCB"};border-radius:3px 3px 0 0;height:${Math.max(3, (j.montant / max) * 100)}px"></div>
            <span style="font-size:10px;color:#4A5568">${j.jour.slice(8, 10)}</span></div>`).join("")}</div>
        <p class="muted" style="margin-top:8px">Recette déclarée par le chauffeur quand il note ses courses (prix × passagers).</p>
      </div>

      <div class="card">
        <h2>3. Les avis des clients</h2>
        ${av.total ? `
          ${grille2(tuile(pc(av.prix_excellent), "prix respecté (Excellent)", true) + tuile(pc(av.chauffeur_excellent), "chauffeur apprécié"))}
          <p class="muted">${av.total} avis au total</p>
          <ul class="liste">${av.derniers.map((a) => `<li>${badgeNote(a.note_prix)} ${badgeNote(a.note_chauffeur)}
            <div class="muted">${a.commentaire ? "« " + esc(a.commentaire) + " » · " : ""}${dateFr(a.date_heure)}</div></li>`).join("")}</ul>`
        : '<p class="muted">Aucun avis pour l’instant.</p>'}
      </div>

      <div class="card">
        <h2>4. Les plaintes</h2>
        ${s.plaintes.length ? `<ul class="liste">${s.plaintes.map((x) => `
          <li><div class="ligne-haut"><span>${esc(x.depart || "—")} → ${esc(x.arrivee || "—")}</span>${badgeStatut(x.statut)}</div>
          <div class="muted">${dateFr(x.date_heure)} · demandé ${fc(x.prix_demande_fc)} · officiel ${fc(x.prix_officiel_fc)}${x.prix_officiel_fc ? ` · <b>+${fc(x.prix_demande_fc - x.prix_officiel_fc)}</b>` : ""}</div>
          ${x.note_agent ? `<div class="muted">Note de l’agent : ${esc(x.note_agent)}</div>` : ""}</li>`).join("")}</ul>`
        : '<p class="muted">Aucune plainte sur ce véhicule. 👏</p>'}
      </div>

      <div class="card" style="text-align:center">
        <h2>5. QR code du véhicule</h2>
        <div class="qr-box" data-qr="${esc(lienQR(v.qr_code))}"></div>
        <p class="muted">À imprimer et coller dans le véhicule.</p>
      </div>`;

    app.querySelectorAll(".qr-box").forEach((el) => {
      if (window.QRCode) new QRCode(el, { text: el.dataset.qr, width: 180, height: 180 });
      else el.textContent = el.dataset.qr;
    });
    $("#affecter").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = e.target.code.value.trim();
      const r1 = await sb.from("affectations").update({ actif: false, fin: new Date().toISOString() }).eq("vehicule_id", v.id).eq("actif", true);
      if (r1.error) return erreur(r1.error);
      const r2 = await sb.from("affectations").insert({ vehicule_id: v.id, chauffeur_id: code });
      if (r2.error) return erreur({ message: "Code chauffeur invalide ou inconnu." });
      journaliser("chauffeur affecté", v.plaque);
      toast("Chauffeur affecté."); vueSuiviVehicule(v.id);
    });
  }

  /* ---------- Vue : Contrôle et administration ---------- */
  async function vueAdmin() {
    if (!etat.session) return besoinConnexion("Espace contrôle");
    if (!aRole("agent", "admin")) { app.innerHTML = `<div class="card">Cet espace est réservé aux agents de contrôle et aux administrateurs.</div>`; return; }
    const onglets = aRole("admin")
      ? { tableau: "Tableau de bord", avis: "Avis", trajets: "Trajets et prix", utilisateurs: "Utilisateurs", journal: "Journal", signalements: "Signalements", documents: "Documents", vehicules: "Véhicules", recidivistes: "Récidivistes" }
      : { signalements: "Signalements", avis: "Avis", documents: "Documents", vehicules: "Véhicules", recidivistes: "Récidivistes" };
    const onglet = onglets[params().o] ? params().o : Object.keys(onglets)[0];

    app.innerHTML = `
      <p class="eyebrow">${ROLES[etat.profil.role]}</p>
      <h1>Contrôle et administration</h1>
      <div class="onglets">${Object.entries(onglets).map(([k, v]) => `<button data-o="${k}" class="${k === onglet ? "actif" : ""}">${v}</button>`).join("")}</div>
      <div id="contenu"><div class="card">Chargement…</div></div>`;
    app.querySelectorAll(".onglets button").forEach((b) => b.addEventListener("click", () => (location.hash = "#/admin?o=" + b.dataset.o)));

    const zone = $("#contenu");
    try {
      afficherBadges();
      if (onglet === "avis") marquerVu("avis");
      if (onglet === "utilisateurs") marquerVu("utilisateurs");
      if (onglet === "signalements") await adminSignalements(zone);
      else if (onglet === "documents") await adminDocuments(zone);
      else if (onglet === "vehicules") await adminVehicules(zone);
      else if (onglet === "recidivistes") await adminRecidivistes(zone);
      else if (onglet === "tableau") await adminTableau(zone);
      else if (onglet === "trajets") await adminGrille(zone);
      else if (onglet === "utilisateurs") await adminUtilisateurs(zone);
      else if (onglet === "journal") await adminJournal(zone);
      else if (onglet === "avis") await adminAvis(zone);
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
      <div style="font-family:'Oswald',Arial,sans-serif;font-size:${String(n ?? 0).length > 8 ? 21 : 28}px;font-weight:600;line-height:1.1;white-space:nowrap">${n ?? 0}</div>
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
      <div class="card"><h3>📊 Exporter vers Excel</h3>
        <p class="muted">Fichiers CSV qui s’ouvrent directement dans Excel.</p>
        <div class="row"><button class="btn petit export" data-t="signalements">Signalements</button><button class="btn petit export" data-t="utilisateurs">Utilisateurs</button></div>
        <div class="row" style="margin-top:8px"><button class="btn petit ligne export" data-t="trajets">Trajets et prix</button><button class="btn petit ligne export" data-t="vehicules">Véhicules</button></div>
      </div>
      <p class="muted">Chiffres mis à jour à l’ouverture de cet onglet.</p>`;
    zone.querySelectorAll(".export").forEach((b) => b.addEventListener("click", () => exporter(b.dataset.t)));
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
      </details>
      <div class="card"><h3>🧪 Données de démonstration</h3>
        <p class="muted">Les lieux marqués « (démo) », leurs prix fictifs et les véhicules DEMO-001 à 003 servent aux présentations. Supprimez-les avant la mise en service réelle.</p>
        <button class="btn ligne" id="suppr-demo" type="button">Supprimer les données de démonstration</button>
      </div>`;
    $("#suppr-demo").addEventListener("click", async () => {
      if (!confirm("Supprimer toutes les données de démonstration ?")) return;
      const { data, error } = await sb.rpc("supprimer_donnees_demo");
      if (error) return erreur(error);
      toast(data); adminGrille(zone);
    });

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
        <div class="ligne-haut"><b>${esc(u.nom || "Sans nom")}</b>${u.email_confirme ? "" : `<button class="btn petit jaune confirmer" data-id="${u.id}" type="button">✔ Confirmer l’e-mail</button>`}</div>
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
    zone.querySelectorAll(".confirmer").forEach((b) => b.addEventListener("click", async () => {
      const { error } = await sb.rpc("confirmer_email", { p_utilisateur: b.dataset.id });
      if (error) return erreur(error);
      journaliser("e-mail confirmé par l’administrateur");
      b.outerHTML = '<span class="badge ok">E-mail confirmé</span>';
      toast("E-mail confirmé : la personne peut maintenant se connecter.");
    }));
    zone.querySelectorAll(".role").forEach((s) => s.addEventListener("change", async () => {
      const { error } = await sb.from("profils").update({ role: s.value }).eq("id", s.dataset.id);
      if (error) return erreur(error);
      if (s.value === "chauffeur") await sb.from("chauffeurs").upsert({ id: s.dataset.id }, { onConflict: "id", ignoreDuplicates: true });
      s.closest("li").dataset.r = s.value;
      journaliser("rôle modifié", ROLES[s.value]);
      toast("Accès mis à jour.");
    }));
  }

  async function adminAvis(zone) {
    const [st, li] = await Promise.all([
      sb.rpc("stats_avis"),
      sb.from("evaluations").select("id, note_prix, note_chauffeur, prix_officiel_fc, prix_demande_fc, mode, depart_id, arrivee_id, commentaire, date_heure, vehicules(plaque), chauffeurs(profils(nom)), client:profils!evaluations_client_id_fkey(nom)")
        .order("date_heure", { ascending: false }).limit(100)
    ]);
    if (st.error) throw st.error;
    if (li.error) throw li.error;
    const s = st.data, pc = (a, b) => (a + b ? Math.round((100 * a) / (a + b)) : 0);
    zone.innerHTML = `
      ${grille2(tuile(s.total, "avis au total", true) + tuile(s.semaine, "avis ces 7 jours") + tuile(pc(s.prix_excellent, s.prix_mediocre) + " %", "prix respecté (Excellent)") + tuile(pc(s.chauffeur_excellent, s.chauffeur_mediocre) + " %", "chauffeurs appréciés"))}
      <div class="card"><h2>Derniers avis</h2>
        <div class="row"><select id="fa"><option value="">Tous les avis</option><option value="mediocre">Prix : Médiocre seulement</option><option value="excellent">Prix : Excellent seulement</option></select>
        <button class="btn petit ligne" id="exp-avis" type="button">📊 Excel</button></div>
        <ul class="liste" id="la" style="margin-top:8px">${li.data.map((a) => `
          <li data-n="${a.note_prix}"><div class="ligne-haut"><b>${esc(a.vehicules?.plaque || "—")}</b><span class="muted">${dateFr(a.date_heure)}</span></div>
          <div class="muted">${MODES[a.mode]} · ${esc(lieuNom(a.depart_id))} → ${esc(lieuNom(a.arrivee_id))} · chauffeur : ${esc(a.chauffeurs?.profils?.nom || "—")} · client : ${esc(a.client?.nom || "—")}</div>
          <div>Prix ${badgeNote(a.note_prix)} Chauffeur ${badgeNote(a.note_chauffeur)}</div>
          ${a.prix_demande_fc ? `<div class="muted">Demandé ${fc(a.prix_demande_fc)} · officiel ${fc(a.prix_officiel_fc)}</div>` : ""}
          ${a.commentaire ? `<div class="muted">« ${esc(a.commentaire)} »</div>` : ""}</li>`).join("") || '<li class="muted">Aucun avis.</li>'}</ul>
      </div>`;
    $("#fa").addEventListener("change", (e) => zone.querySelectorAll("#la li[data-n]").forEach((x) => (x.hidden = !!e.target.value && x.dataset.n !== e.target.value)));
    $("#exp-avis").addEventListener("click", () => telechargerCSV("avis", [["Date", "Plaque", "Mode", "Départ", "Arrivée", "Chauffeur", "Client", "Note prix", "Note chauffeur", "Prix officiel (FC)", "Prix demandé (FC)", "Commentaire"],
      ...li.data.map((a) => [dateFr(a.date_heure), a.vehicules?.plaque, MODES[a.mode], lieuNom(a.depart_id), lieuNom(a.arrivee_id), a.chauffeurs?.profils?.nom, a.client?.nom, a.note_prix === "excellent" ? "Excellent" : "Médiocre", a.note_chauffeur === "excellent" ? "Excellent" : "Médiocre", a.prix_officiel_fc, a.prix_demande_fc, a.commentaire])]));
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
  const NOMS_ECRANS = { prix: "Prix", verifier: "Vérification QR", signaler: "Noter une course", avis: "Mes avis", compte: "Compte", chauffeur: "Espace chauffeur", proprietaire: "Mes véhicules", admin: "Administration" };
  function journaliser(action, detail) {
    if (!etat.session) return;
    sb.from("journal_activite").insert({ action, detail: detail ? String(detail).slice(0, 200) : null }).then(() => {}, () => {});
  }

  /* ---------- Barre de navigation ---------- */
  function majTabbar() {
    const bar = document.querySelector(".tabbar");
    bar.hidden = !etat.session;
    const role = aRole("chauffeur") ? ["chauffeur", "#/chauffeur", "🚖", t("tab_chauffeur")]
      : aRole("proprietaire") ? ["proprietaire", "#/proprietaire", "🚌", t("tab_vehicules")]
      : aRole("agent", "admin") ? ["admin", "#/admin", "🛡️", t("tab_admin")] : null;
    const items = [
      ["prix", "#/prix", "💰", t("tab_prix")],
      ["avis", "#/avis", "⭐", t("tab_avis")],
      ["verifier", "#/verifier?scan=1", "📷", t("tab_scanner"), true],
      ["compte", "#/compte", "👤", t("tab_compte")]
    ];
    if (role) items.push(role);
    const actif = location.hash.replace(/^#\//, "").split("?")[0] || "verifier";
    bar.innerHTML = items.map(([tab, href, ico, lib, centre]) =>
      `<a href="${href}" data-tab="${tab}" class="${centre ? "tab-scan" : ""} ${tab === actif ? "actif" : ""}"><span class="${centre ? "rond" : ""}">${ico}</span>${lib}</a>`).join("");
    bar.querySelector(".tab-scan")?.addEventListener("click", (e) => {
      if (location.hash === "#/verifier?scan=1") { e.preventDefault(); route(); }
    });
    majSelecteurTest();
    majBoutonLangue();
    if (etat.badges) afficherBadges();
  }

  function majBoutonLangue() {
    const top = document.querySelector(".topbar");
    let b = document.getElementById("btn-langue");
    if (!b) {
      b = document.createElement("button");
      b.id = "btn-langue"; b.type = "button";
      b.style.cssText = "white-space:nowrap;margin-left:auto;margin-right:8px;font:inherit;font-size:13px;font-weight:700;padding:6px 10px;border-radius:8px;border:2px solid #F2B705;background:transparent;color:#F6F3EA;cursor:pointer";
      b.addEventListener("click", () => changerLangue(langue === "fr" ? "ln" : "fr"));
      top.insertBefore(b, document.getElementById("net"));
    }
    b.textContent = langue === "fr" ? "🌐 LN" : "🌐 FR";
    b.title = t("langue");
  }

  /* ---------- Accueil : visite guidée en 3 écrans ---------- */
  const INTRO_KEY = "mopila_intro_vue";
  function montrerIntro() {
    return new Promise((fin) => {
      if (lireLocal(INTRO_KEY, false)) return fin();
      let i = 0;
      const ecrans = [["🚖", "intro1_t", "intro1_p"], ["📷", "intro2_t", "intro2_p"], ["⚠️", "intro3_t", "intro3_p"]];
      const d = document.createElement("div");
      d.className = "intro";
      document.body.appendChild(d);
      const dessiner = () => {
        const [ico, ti, tp] = ecrans[i];
        d.innerHTML = `
          <div class="intro-langue">
            <button type="button" data-l="fr" class="${langue === "fr" ? "actif" : ""}">Français</button>
            <button type="button" data-l="ln" class="${langue === "ln" ? "actif" : ""}">Lingala</button>
          </div>
          <div class="intro-corps apparition">
            <div class="intro-icone">${ico}</div>
            <h1>${t(ti)}</h1>
            <p>${t(tp)}</p>
          </div>
          <div class="intro-points">${ecrans.map((_, k) => `<span class="${k === i ? "actif" : ""}"></span>`).join("")}</div>
          <button type="button" class="btn jaune" id="i-suiv">${i < ecrans.length - 1 ? t("suivant") : t("commencer")}</button>
          ${i < ecrans.length - 1 ? `<button type="button" class="btn ligne-claire" id="i-passer">${t("passer")}</button>` : ""}`;
        d.querySelectorAll("[data-l]").forEach((b) => b.addEventListener("click", () => {
          langue = b.dataset.l;
          try { localStorage.setItem(LANG_KEY, langue); } catch (_) { /* stockage indisponible */ }
          dessiner();
        }));
        const terminer = () => { ecrireLocal(INTRO_KEY, true); d.remove(); fin(); };
        d.querySelector("#i-suiv").addEventListener("click", () => (i < ecrans.length - 1 ? (i++, dessiner()) : terminer()));
        d.querySelector("#i-passer")?.addEventListener("click", terminer);
      };
      dessiner();
    });
  }

  /* ---------- Retour au client sur ses signalements ---------- */
  async function verifierNouvelles() {
    if (!etat.session) return;
    const uid = etat.session.user.id;
    const { data } = await sb.from("signalements").select("id, plaque_saisie, statut")
      .eq("client_id", uid).in("statut", ["confirme", "rejete"]);
    if (!data) return;
    const vus = lireVu("notifiees", lireLocal("mopila_vus_" + uid, null));
    marquerVu("notifiees", data.map((s) => s.id));
    if (vus === null) return; // premier passage : rien à annoncer
    const nouveaux = data.filter((s) => !vus.includes(s.id));
    if (!nouveaux.length) return;
    const s = nouveaux[0];
    const msg = t(s.statut === "confirme" ? "merci_confirme" : "sig_rejete", { p: s.plaque_saisie || "—" });
    toast(nouveaux.length > 1 ? `${msg} (+${nouveaux.length - 1})` : msg);
  }

  /* ---------- Export Excel (CSV) ---------- */
  function telechargerCSV(nom, lignes) {
    const cellule = (v) => {
      const s = v == null ? "" : String(v);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "﻿" + lignes.map((l) => l.map(cellule).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${nom}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    journaliser("export Excel", nom);
  }

  async function exporter(type) {
    if (type === "signalements") {
      const { data, error } = await sb.from("signalements").select("id, date_heure, plaque_saisie, mode, depart_id, arrivee_id, prix_officiel_fc, prix_demande_fc, statut, commentaire, note_agent").order("date_heure", { ascending: false });
      if (error) return erreur(error);
      telechargerCSV("signalements", [["N°", "Date", "Plaque", "Mode", "Départ", "Arrivée", "Prix officiel (FC)", "Prix demandé (FC)", "Écart (FC)", "Statut", "Commentaire", "Note de l’agent"],
        ...data.map((s) => [s.id, dateFr(s.date_heure), s.plaque_saisie, MODES[s.mode], lieuNom(s.depart_id), lieuNom(s.arrivee_id), s.prix_officiel_fc, s.prix_demande_fc,
          s.prix_officiel_fc ? s.prix_demande_fc - s.prix_officiel_fc : "", STATUTS_SIG[s.statut], s.commentaire, s.note_agent])]);
    } else if (type === "utilisateurs") {
      const { data, error } = await sb.rpc("utilisateurs_admin");
      if (error) return erreur(error);
      telechargerCSV("utilisateurs", [["Nom", "E-mail", "Téléphone", "Accès", "Inscrit le", "Dernière connexion", "E-mail confirmé", "Actions (7 jours)"],
        ...data.map((u) => [u.nom, u.email, u.telephone, ROLES[u.role], dateFr(u.inscrit_le), u.derniere_connexion ? dateFr(u.derniere_connexion) : "", u.email_confirme ? "oui" : "non", u.actions_7j])]);
    } else if (type === "trajets") {
      await chargerGrille();
      telechargerCSV("trajets", [["Départ", "Arrivée", "Mode", "Prix officiel (FC)", "Arrêté", "En vigueur depuis"],
        ...etat.tarifs.map((x) => [x.depart, x.arrivee, MODES[x.mode], x.prix_fc, x.arrete, jourFr(x.date_effet)])]);
    } else if (type === "vehicules") {
      const { data, error } = await sb.from("vehicules").select("plaque, mode, agree, qr_code, created_at, proprietaire:profils!vehicules_proprietaire_id_fkey(nom)").order("plaque");
      if (error) return erreur(error);
      telechargerCSV("vehicules", [["Plaque", "Mode", "Agréé", "Propriétaire", "Enregistré le", "Lien du QR code"],
        ...data.map((v) => [v.plaque, MODES[v.mode], v.agree ? "oui" : "non", v.proprietaire?.nom, dateFr(v.created_at), lienQR(v.qr_code)])]);
    }
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
      sel.innerHTML = [["admin", "👑 Admin"], ["agent", "🛡️ Agent"], ["proprietaire", "🚌 Propriét."], ["chauffeur", "🚖 Chauffeur"], ["client", "🧍 Client"]]
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

  /* ---------- Pastilles de notification (chiffres rouges) ---------- */
  etat.badges = { tabs: {}, onglets: {} };
  // Ce qui a été « vu » est gardé dans le compte de l’utilisateur (sur le serveur Supabase),
  // donc identique sur tous ses téléphones. Une copie locale sert de secours hors ligne.
  const cleVu = (nom) => `mopila_vu_${nom}_${etat.session?.user?.id || ""}`;
  function lireVu(nom, defaut) {
    const serveur = etat.session?.user?.user_metadata?.vus?.[nom];
    if (serveur !== undefined) return serveur;
    return lireLocal(cleVu(nom), defaut);
  }
  async function marquerVu(nom, valeur) {
    const v = valeur ?? new Date().toISOString();
    ecrireLocal(cleVu(nom), v);
    if (!etat.session) return;
    const vus = { ...(etat.session.user.user_metadata?.vus || {}), [nom]: Array.isArray(v) ? v.slice(-300) : v };
    if (JSON.stringify(etat.session.user.user_metadata?.vus?.[nom]) === JSON.stringify(vus[nom])) return;
    try {
      const { data, error } = await sb.auth.updateUser({ data: { vus } });
      if (!error && data?.user) etat.session.user = data.user;
    } catch (_) { /* hors ligne : la copie locale suffit, le serveur sera mis à jour à la prochaine visite */ }
  }

  (function injecterStylePastilles() {
    const st = document.createElement("style");
    st.textContent = `.pastille{display:inline-grid;place-items:center;min-width:19px;height:19px;padding:0 5px;border-radius:99px;background:#D92D20;color:#fff;font:700 11px/1 'Public Sans',Arial,sans-serif;box-shadow:0 0 0 2px #FFFDF7}
      .tabbar a .pastille{position:absolute;top:2px;left:calc(50% + 6px)}
      .tabbar a.tab-scan .pastille{display:none}
      .onglets button .pastille{margin-left:6px;box-shadow:none}
      .onglets button.actif .pastille{box-shadow:0 0 0 2px #10233F}
      .mdp-zone{position:relative}.mdp-zone input{padding-right:52px}
      .oeil{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:44px;height:40px;border:none;background:none;font-size:20px;cursor:pointer}`;
    document.head.appendChild(st);
  })();

  async function compter(table, filtre) {
    let q = sb.from(table).select("id", { count: "exact", head: true });
    q = filtre(q);
    const { count, error } = await q;
    return error ? 0 : count || 0;
  }

  async function majBadges() {
    if (!etat.session || !etat.profil) return;
    const uid = etat.session.user.id;
    const tabs = {}, onglets = {};
    try {
      // Client : plaintes traitées (confirmées ou rejetées) que l’utilisateur n’a pas encore vues
      const { data: traites } = await sb.from("signalements").select("id").eq("client_id", uid).in("statut", ["confirme", "rejete"]);
      const ids = (traites || []).map((s) => s.id);
      let vus = lireVu("mesavis", null);
      if (vus === null) { marquerVu("mesavis", ids); vus = ids; }
      tabs.avis = ids.filter((i) => !vus.includes(i)).length;

      if (aRole("agent", "admin")) {
        const depuisAvis = lireVu("avis", new Date(0).toISOString());
        const [sig, docs, veh, avis, recid] = await Promise.all([
          compter("signalements", (q) => q.in("statut", ["nouveau", "en_verification"])),
          compter("documents_chauffeur", (q) => q.eq("statut", "en_attente")),
          compter("vehicules", (q) => q.eq("agree", false)),
          compter("evaluations", (q) => q.gt("date_heure", depuisAvis)),
          sb.from("recidivistes").select("vehicule_id", { count: "exact", head: true }).then((r) => r.count || 0, () => 0)
        ]);
        Object.assign(onglets, { signalements: sig, documents: docs, vehicules: veh, avis, recidivistes: recid });
        if (aRole("admin")) {
          const depuisUsers = lireVu("utilisateurs", new Date(0).toISOString());
          onglets.utilisateurs = await compter("profils", (q) => q.gt("created_at", depuisUsers));
        }
        tabs.admin = Object.values(onglets).reduce((a, b) => a + b, 0) - (onglets.recidivistes || 0);
      }

      if (aRole("chauffeur")) {
        const { data: d } = await sb.from("documents_chauffeur").select("type, statut, date_expiration").eq("chauffeur_id", uid);
        const limite = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
        // Le document le plus récent de chaque type : rejeté, expiré ou qui expire dans 30 jours
        const parType = {};
        (d || []).forEach((x) => { if (!parType[x.type] || x.date_expiration > parType[x.type].date_expiration) parType[x.type] = x; });
        tabs.chauffeur = Object.values(parType).filter((x) => x.statut === "rejete" || x.date_expiration < limite).length;
      }

      if (aRole("proprietaire")) {
        const { data: f } = await sb.rpc("suivi_flotte");
        tabs.proprietaire = (f || []).reduce((n, v) => n + (v.plaintes_ouvertes || 0) + (v.doc_alerte ? 1 : 0) + (v.chauffeur_id && !v.chauffeur_conforme ? 1 : 0), 0);
      }
    } catch (_) { /* pas de pastille si une requête échoue */ }
    etat.badges = { tabs, onglets };
    afficherBadges();
  }

  const pastille = (n) => (n > 0 ? `<span class="pastille">${n > 99 ? "99+" : n}</span>` : "");
  function afficherBadges() {
    document.querySelectorAll(".tabbar a[data-tab]").forEach((a) => {
      a.querySelector(".pastille")?.remove();
      const n = etat.badges.tabs[a.dataset.tab];
      if (n > 0) a.insertAdjacentHTML("beforeend", pastille(n));
    });
    document.querySelectorAll(".onglets button[data-o]").forEach((b) => {
      b.querySelector(".pastille")?.remove();
      const n = etat.badges.onglets[b.dataset.o];
      if (n > 0) b.insertAdjacentHTML("beforeend", pastille(n));
    });
  }
  setInterval(() => { if (document.visibilityState === "visible") majBadges(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") majBadges(); });

  /* ---------- Routeur ---------- */
  const VUES = { prix: vuePrix, verifier: vueVerifier, signaler: vueNoter, avis: vueMesAvis, compte: vueCompte, chauffeur: vueChauffeur, proprietaire: vueProprietaire, admin: vueAdmin };

  async function route() {
    fermerVerdict();
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
    if (etat.session && demande === "compte" && params().mode === "nouveau") { try { await vueNouveauMotDePasse(); } catch (e) { erreur(e); } return; }
    const nom = VUES[demande] ? demande : "verifier";
    document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("actif", a.dataset.tab === nom));
    try { await VUES[nom](); } catch (e) { erreur(e); }
    afficherBadges();
    majBadges();
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
    app.innerHTML = `<div class="splash"><div class="splash-logo">M</div><div class="splash-nom">MOPILA CHECK</div><div class="muted">Le juste prix du transport à Kinshasa</div></div>`;
    await Promise.all([chargerGrille(), chargerProfil(), new Promise((r) => setTimeout(r, 900))]);
    await montrerIntro();
    sb.auth.onAuthStateChange(async (evt) => {
      if (evt === "PASSWORD_RECOVERY") { await chargerProfil(); location.hash = "#/compte?mode=nouveau"; return; }
      if (evt === "SIGNED_IN" || evt === "SIGNED_OUT") { await chargerProfil(); majTabbar(); if (evt === "SIGNED_OUT") route(); }
    });
    window.addEventListener("hashchange", route);
    if (RETOUR_RECUPERATION && etat.session) location.replace("#/compte?mode=nouveau");
    route();
    verifierNouvelles();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  demarrer();
})();
