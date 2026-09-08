# Scan and Send

Application de photo vers PDF, en français et en anglais, avec thèmes clair et sombre. Une ou plusieurs photos par document, rendus couleur et noir et blanc, rotation, export A4, téléchargement et partage du fichier PDF.

**Ajouter une page** permet de prendre une autre photo ou d’importer plusieurs images dans le même PDF. Les boutons **Page 1, Page 2…** sélectionnent la page à modifier. Chaque page conserve son rendu, son contraste, sa rotation et son recadrage. **Reprendre** et **Remplacer** changent seulement la page sélectionnée, à sa position actuelle. L’export et le partage contiennent toutes les pages dans l’ordre affiché ; les miniatures et les boutons **Avant / Après** permettent de réorganiser les pages. Un import multiple échoué ou annulé conserve le document précédent sans ajouter de pages partielles.

**Rogner** ouvre un cadre ajustable au doigt, à la souris ou au clavier. La largeur ou la hauteur en pixels se règle en conservant les proportions, jusqu’à 2200 px sur le plus grand côté. **Appliquer** met à jour l’aperçu et le PDF ; **Annuler** conserve le document précédent. **Image entière** rétablit le cadre et les dimensions initiaux. Le recadrage reste modifiable à partir de la photo de travail complète et suit les rotations.

Dans **Rogner → 4 coins libres**, chaque coin se place indépendamment sur la feuille, y compris en biais. Une correction de perspective redresse le quadrilatère dans l’aperçu et le PDF. Les coins se déplacent au doigt, à la souris ou avec les flèches du clavier (Maj pour accélérer). Les croisements et les cadres aplatis sont empêchés. Les dimensions sont estimées à partir des longueurs des côtés opposés ; elles restent ajustables avec les proportions conservées. Tout le traitement reste local et peut être annulé ou effacé.

En noir et blanc, le curseur **Contraste** ajuste le rendu de 0 (plus clair) à 100 (plus marqué). La valeur 50 conserve le rendu initial. Le réglage agit sur l’aperçu et le PDF ; un bouton permet de le réinitialiser. Il est conservé lors du passage couleur/noir et blanc et remis à 50 pour une nouvelle photo. Les changements rapides sont regroupés et l’enregistrement attend le dernier rendu choisi.

Les photos sont décodées et transformées dans le navigateur, sans envoi au serveur. Le PDF reste en mémoire jusqu’au téléchargement ou au partage. Un seul brouillon est sauvegardé automatiquement dans IndexedDB : photos de travail PNG, réglages de chaque page, ordre et nom du document. Après rechargement, une boîte de dialogue propose de le reprendre ou de l’effacer. Un brouillon de plus de 7 jours depuis sa dernière sauvegarde est effacé à la prochaine ouverture (aucune suppression en arrière-plan lorsque le site est fermé). Le navigateur peut évincer ces données ; en cas de stockage indisponible, l’app indique que le document est temporaire. Le PDF exporté reste la copie durable.

**Effacer** retire la page sélectionnée et met à jour le PDF. Retirer la dernière page revient à la prise de photo et réinitialise le document. Pendant un import, **Annuler** interrompt l’ajout ou le remplacement sans retirer les pages existantes. Seule la page active reste décodée en canvas ; les autres originaux de travail sont conservés sous forme de blobs PNG en mémoire, avec une copie dans le brouillon local, sans envoi au serveur. Une action permet d’annuler la dernière suppression ou le dernier remplacement pendant la session. Effacer toutes les pages efface aussi le brouillon persistant ; l’annulation reste disponible en mémoire jusqu’à la fermeture ou la prochaine suppression/remplacement.

## Utilisation

Prendre une photo ou importer une image, choisir le rendu et le nom, puis enregistrer le PDF. Sur iPhone, si Safari ouvre le fichier, utiliser Partager → Enregistrer dans Fichiers. Le bouton **Partager le PDF** utilise le partage natif de fichiers : choisir Mail ou Gmail et le destinataire. Si cette capacité manque, une boîte de dialogue guide le téléchargement puis l’ajout manuel de la pièce jointe. L’application ne prétend jamais qu’un fichier a été enregistré ou qu’un email a été envoyé.

## Développement

- `npm install`
- `npm run dev`
- `npm test`
- `npx tsc --noEmit --incremental false`
- `npm run build`

## GitHub et Vercel

Le dépôt est `PersonneE07/scan-and-send`. Vercel utilise `npm run build:vercel` et publie le dossier statique `dist/client`, sans serveur applicatif ni clé API. Le nom affiché dans l’application et dans les propriétés des PDF est **Scan and Send**.

La configuration Vercel est dans `vercel.json`. Le déploiement statique désactive uniquement pour cette compilation les adaptateurs d’hébergement Workers ; le développement local reste disponible avec `npm run dev`.

## Compatibilité et vérification

Le choix de caméra dépend du navigateur et du système. Le partage de fichiers nécessite HTTPS et la disponibilité de `navigator.canShare({ files })`. Une image HEIC est acceptée si le navigateur peut la décoder ; sinon un message propose de reprendre la photo ou d’utiliser JPEG/PNG. Les photos sont limitées à 40 Mo et leur plus grand côté de travail à 2200 px.

Les tests vérifient le contenu réel d’un PDF rouvert, les couleurs, le noir et blanc sous éclairage irrégulier, le recadrage et le redimensionnement sur un véritable canvas, les quatre rotations, la mise en page A4, les noms de fichiers et les entrées invalides. Des tests du hook vérifient l’ordre des pages, les réglages individuels, le remplacement, la suppression, l’annulation des imports, la libération des URLs et le fichier complet transmis au partage natif simulé. La caméra physique, les gestes tactiles, le dossier final sur iPhone/Android et la messagerie nécessitent une vérification sur ces appareils ; ils n’ont pas été testés physiquement ici.

Un outil WebMCP optionnel `prepare_current_pdf` est disponible si `document.modelContext` est pris en charge. Aucun contexte WebMCP compatible n’était disponible pour vérifier son contrat pendant la création ; ce point reste non vérifié.

## Qualité, performances et architecture

`npm run check` lance le lint, TypeScript et les tests. Le workflow GitHub **Quality** exécute ces vérifications sur chaque pull request et chaque push sur `main`, puis compile l’export et contrôle son budget JavaScript. Il utilise Node 24, un jeton en lecture seule et des versions d’actions fixées par SHA. Vercel exécute les mêmes étapes avant de déployer : un contrôle en échec bloque la nouvelle version. Cela suit le parcours [`setup-node` / `npm ci` documenté par GitHub](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs).

Le seuil et le redressement par perspective s’exécutent dans un Worker distinct, démarré à la demande et arrêté après résultat, erreur ou annulation. Les données restent locales. Sans Worker utilisable, le traitement revient sur le fil principal avec des pauses entre blocs pour permettre l’annulation. Le décodage initial, les opérations canvas et l’assemblage PDF restent sur le fil principal. La création du Worker suit [la syntaxe recommandée par Vite](https://vite.dev/guide/features#web-workers).

L’éditeur et sa feuille de styles sont chargés à l’ouverture du recadrage. La bibliothèque PDF reste chargée à la première préparation. Les contrôles de contraste et de rendu n’importent plus leurs anciennes primitives génériques. Les 54 composants inutilisés du modèle initial et leurs dépendances ont été supprimés. Le JavaScript initial est passé d’environ 194 à 177,5 kB gzip ; `npm run check:bundle` impose un plafond de 185 kB et vérifie que l’éditeur/PDF ne sont pas dans le chargement initial. Cette mesure porte sur les fichiers nécessaires au premier écran, pas sur tous les fichiers différés ni sur un score mobile réel.

Responsabilités :
- `hooks/use-scanner.ts` : orchestration des imports, du rendu et des annulations.
- `hooks/use-page-collection.ts` : pages, ordre, suppression et annulation.
- `hooks/use-local-draft.ts` et `lib/draft.ts` : sauvegarde et reprise IndexedDB.
- `hooks/use-pdf-export.ts` et `lib/pdf.ts` : assemblage, URLs, téléchargement et partage.
- `lib/image-geometry.ts`, `lib/image-pixels.ts` et `workers/image.worker.ts` : géométrie et calculs d’image.
- `lib/document.ts` : décodage, canvas et façade compatible avec les tests existants.

Les exceptions de lint sont limitées et commentées : images privées sous forme d’URL blob (pas d’optimiseur serveur), initialisation du thème avant affichage, suppression volontaire des caractères de contrôle dans les noms de fichiers et faux positifs sur les doubles de navigateur des tests. Les règles de production restent actives.
