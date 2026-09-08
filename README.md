# Pochette

Application de photo vers PDF, en français. Une photo par document, rendus couleur et noir et blanc, rotation, export A4, téléchargement et partage du fichier PDF.

Les photos sont décodées et transformées dans le navigateur, sans envoi au serveur. Le PDF reste en mémoire jusqu’au téléchargement ou au partage. Il n’y a pas d’historique persistant dans l’application.

## Utilisation

Prendre une photo ou importer une image, choisir le rendu et le nom, puis enregistrer le PDF. Sur iPhone, si Safari ouvre le fichier, utiliser Partager → Enregistrer dans Fichiers. Le bouton d’envoi utilise le partage natif de fichiers : choisir Mail ou Gmail et le destinataire. Si cette capacité manque, une boîte de dialogue guide le téléchargement puis l’ajout manuel de la pièce jointe. L’application ne prétend jamais qu’un fichier a été enregistré ou qu’un email a été envoyé.

## Développement

- `npm install`
- `npm run dev`
- `npm test`
- `npx tsc --noEmit --incremental false`
- `npm run build`

## Compatibilité et vérification

Le choix de caméra dépend du navigateur et du système. Le partage de fichiers nécessite HTTPS et la disponibilité de `navigator.canShare({ files })`. Une image HEIC est acceptée si le navigateur peut la décoder ; sinon un message propose de reprendre la photo ou d’utiliser JPEG/PNG. Les photos sont limitées à 40 Mo et leur plus grand côté de travail à 2200 px.

Les tests vérifient le contenu réel d’un PDF rouvert, les couleurs, le noir et blanc sous éclairage irrégulier, la mise en page A4, les noms de fichiers et les entrées invalides. La caméra physique, le dossier final sur iPhone/Android et la messagerie nécessitent une vérification sur ces appareils ; ils n’ont pas été testés physiquement ici.

Un outil WebMCP optionnel `prepare_current_pdf` est disponible si `document.modelContext` est pris en charge. Aucun contexte WebMCP compatible n’était disponible pour vérifier son contrat pendant la création ; ce point reste non vérifié.
