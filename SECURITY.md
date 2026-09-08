# Revue de sécurité — 8 septembre 2026

Périmètre : code de l’application, imports d’images, PDF et partage, dépendances
npm, export statique et configuration Vercel. Les photos sont traitées dans le
navigateur ; le déploiement ne comporte ni API d’import ni fonction serveur.

## Corrections

- Mise à jour coordonnée de React, Vinext, Vite et des outils Cloudflare :
  `npm audit` passe de 11 paquets signalés (8 high, 2 moderate, 1 low) à zéro.
  Les alertes ne représentaient pas toutes des failles exploitables sur le site
  statique. Par exemple, l’[avis React sur les Server Functions](https://github.com/advisories/GHSA-wx67-qw84-cm4g)
  concerne des points d’entrée serveur absents du déploiement.
- CSP insérée avant les scripts dans chaque HTML exporté, avec empreintes SHA-256
  recalculées à chaque compilation. Scripts externes limités à la même origine,
  gestionnaires HTML inline et `eval` interdits. Les styles inline restent autorisés
  pour les contrôles et le recadrage ; les images locales `blob:` restent permises.
- En-têtes Vercel : interdiction d’intégration en iframe, `nosniff`, absence de
  référent, restrictions des permissions. La caméra, le partage et la copie restent
  autorisés pour l’app. La protection contre les iframes est définie en en-tête,
  car cette directive ne fonctionne pas dans une balise meta.
  Voir les [protections HTTP de Vercel](https://vercel.com/docs/cdn-security/security-headers).
- Vérification des signatures raster avant décodage, sans faire confiance au nom
  ou au type MIME fourni. Les SVG et HTML déguisés sont refusés. Le décodeur du
  navigateur reste responsable de la validation complète des images.
- Limites : 40 Mo par fichier, 100 Mo par import, 20 pages par document et budget
  de stockage des pages lors de l’import. Les images décodées de plus de 80 MP
  sont refusées avant le traitement canvas. Les imports refusés conservent le PDF
  précédent. Ces limites réduisent la pression mémoire sans garantir qu’un téléphone
  disposant de peu de mémoire puisse traiter tous les documents autorisés.
- Nettoyage des contrôles Unicode de direction dans les noms de fichiers ; le
  sujet du lien mail utilise également le nom nettoyé.

## Vérifications et limites

Tests automatisés sur les pixels, le recadrage, la perspective, les PDF multipages,
les annulations, les imports refusés et la CSP ; compilation statique et contrôle
TypeScript. Vérification des empreintes sur les HTML réellement générés.

Le lint global présente 50 diagnostics préexistants, sans nouveau diagnostic dans
cette modification. La revue heuristique relève surtout des questions de longueur
et de structure du code ; ce n’est pas une preuve de vulnérabilité.

La recherche de motifs de secrets dans l’historique, réalisée avant publication
du dépôt, n’a trouvé aucun motif connu parmi 145 blobs inspectés. Les fichiers
`.env*` restent exclus du dépôt et de l’export public.

Cette revue n’est pas un test d’intrusion ni une garantie d’absence de failles.
Le coût du décodage initial dépend du navigateur, notamment pour HEIC/AVIF ; la
limite de pixels intervient après ce décodage. Les dépendances devront continuer
à être mises à jour. Aucun test sur téléphone physique n’a été effectué ici.
