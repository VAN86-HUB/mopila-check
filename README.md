# MOPILA CHECK

**Le juste prix du transport à Kinshasa**, selon la grille tarifaire officielle de l’État.

Conçu par **Ingénieur Van MUFWAR** · +243 825 000 164

## Ce que fait l’application

| Qui | Ce qu’il peut faire |
|---|---|
| Tout le monde (sans compte) | Voir le prix officiel d’un trajet (même hors ligne), vérifier un véhicule par son QR code |
| Client | Signaler un abus (prix demandé, photo), suivre ses signalements |
| Chauffeur | Déposer ses documents, voir s’il est « conforme », obtenir son code chauffeur, noter ses courses et sa recette |
| Propriétaire | Enregistrer ses véhicules, imprimer leur QR code, affecter un chauffeur |
| Agent de contrôle | Traiter les signalements, valider les documents, agréer les véhicules, voir les récidivistes |
| Administrateur | Tout ce que fait l’agent, plus la grille tarifaire (lieux, arrêtés, tarifs) et les rôles des utilisateurs |

## Mise en ligne sur GitHub Pages

1. Créez un dépôt public sur GitHub, par exemple `mopila-check`.
2. Envoyez tous les fichiers de ce dossier à la racine du dépôt (bouton **Add file → Upload files**).
3. Allez dans **Settings → Pages**, choisissez **Deploy from a branch**, branche `main`, dossier `/ (root)`, puis **Save**.
4. Après une ou deux minutes, l’application est en ligne à l’adresse :
   `https://VAN86-HUB.github.io/mopila-check/`

## Réglage à faire dans Supabase (une seule fois)

Dans le projet **mopila-check** sur supabase.com :
**Authentication → URL Configuration**

- **Site URL** : `https://VAN86-HUB.github.io/mopila-check/`
- **Redirect URLs** : ajoutez la même adresse.

Sans ce réglage, le lien de l’e-mail de confirmation renvoie vers une mauvaise adresse.

## Devenir administrateur

1. Créez votre compte dans l’application (onglet **Compte**).
2. Dans Supabase, ouvrez **SQL Editor** et lancez (en remplaçant l’e-mail) :

```sql
update public.profils set role = 'admin'
where id = (select id from auth.users where email = 'votre-email@exemple.com');
```

3. Déconnectez-vous puis reconnectez-vous : l’espace **Contrôle et administration** apparaît dans **Compte**.
   Vous pouvez ensuite nommer les agents depuis l’onglet **Utilisateurs**.

## Les QR codes des véhicules

Chaque véhicule a un QR code qui contient l’adresse `…/mopila-check/?v=CODE`.
Le client peut le scanner avec l’appareil photo de n’importe quel téléphone : la fiche du véhicule s’ouvre directement.

## Fichiers

```
index.html            page unique de l’application
css/style.css         couleurs et mise en page
js/config.js          adresse et clé publique Supabase
js/app.js             toute la logique (écrans, connexion, base de données)
sw.js                 fonctionnement hors ligne
manifest.webmanifest  installation sur l’écran d’accueil du téléphone
icon.svg              icône de l’application
```

La clé dans `js/config.js` est une clé **publique** : elle peut être publiée sur GitHub.
La sécurité est assurée par les règles (RLS) de la base de données Supabase.
