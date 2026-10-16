// Génère les clés VAPID des notifications sur téléphone : à copier dans les variables d'environnement (Render + server/.env).
// Usage : npm run push:keys   — à faire UNE seule fois ; changer les clés désabonne tous les appareils.
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log('\nAjoutez ces 3 variables sur Render (Environment) et dans server/.env :\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:votre-adresse@exemple.com\n');
console.log('La clé privée est secrète : ne la partagez pas et ne la mettez jamais dans le code.\n');
