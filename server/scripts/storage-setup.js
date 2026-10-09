// Vérifie la connexion au bucket (Backblaze B2 / S3) et autorise le site à y envoyer et lire
// les photos depuis le navigateur (règles CORS). Usage : npm run storage:setup
import { S3Client, ListObjectsV2Command, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { config } from '../src/config.js';

const s3cfg = config.s3;
if (!s3cfg) {
  console.error('Stockage en ligne non configuré : ajoutez B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET et B2_ENDPOINT dans server/.env');
  process.exit(1);
}
const origins = [...new Set([config.appUrl, 'http://localhost:3000'])];
console.log(`Bucket « ${s3cfg.bucket} » sur ${s3cfg.endpoint} (région ${s3cfg.region})`);

const s3 = new S3Client({
  endpoint: s3cfg.endpoint, region: s3cfg.region, forcePathStyle: true,
  credentials: { accessKeyId: s3cfg.keyId, secretAccessKey: s3cfg.secret },
});

// 1. Connexion
try {
  const list = await s3.send(new ListObjectsV2Command({ Bucket: s3cfg.bucket, MaxKeys: 5 }));
  console.log(`Connexion OK (${list.KeyCount ?? 0} fichier(s) visibles au début du bucket).`);
} catch (err) {
  console.error(`Connexion impossible : ${err.name} — ${err.message}`);
  console.error('Vérifiez B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET et B2_ENDPOINT.');
  process.exit(1);
}

// 2. CORS : d'abord par l'API S3, sinon par l'API native Backblaze.
const rule = { origins, methods: ['GET', 'HEAD', 'PUT'] };
async function corsViaS3() {
  await s3.send(new PutBucketCorsCommand({
    Bucket: s3cfg.bucket,
    CORSConfiguration: {
      CORSRules: [{ AllowedOrigins: rule.origins, AllowedMethods: rule.methods, AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }],
    },
  }));
}
async function corsViaB2() {
  const auth = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
    headers: { Authorization: `Basic ${Buffer.from(`${s3cfg.keyId}:${s3cfg.secret}`).toString('base64')}` },
  }).then((r) => r.json());
  if (!auth.accountId) throw new Error(auth.message || 'autorisation refusée');
  const api = auth.apiInfo.storageApi;
  const call = (name, body) => fetch(`${api.apiUrl}/b2api/v3/${name}`, {
    method: 'POST', headers: { Authorization: auth.authorizationToken }, body: JSON.stringify(body),
  }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.message || r.status); return j; });
  let bucketId = (api.allowed?.buckets || []).find((b) => b.name === s3cfg.bucket)?.id;
  if (!bucketId) bucketId = (await call('b2_list_buckets', { accountId: auth.accountId, bucketName: s3cfg.bucket })).buckets?.[0]?.bucketId;
  if (!bucketId) throw new Error('bucket introuvable');
  await call('b2_update_bucket', {
    accountId: auth.accountId, bucketId,
    corsRules: [{
      corsRuleName: 'kentrapix', allowedOrigins: rule.origins,
      allowedOperations: ['s3_get', 's3_head', 's3_put', 'b2_download_file_by_name', 'b2_download_file_by_id'],
      allowedHeaders: ['*'], exposeHeaders: ['ETag'], maxAgeSeconds: 3600,
    }],
  });
}
try {
  await corsViaS3();
  console.log(`CORS OK (API S3) pour : ${origins.join(', ')}`);
} catch (e1) {
  try {
    await corsViaB2();
    console.log(`CORS OK (API Backblaze) pour : ${origins.join(', ')}`);
  } catch (e2) {
    console.error(`CORS non configuré (S3 : ${e1.name || e1.message} ; B2 : ${e2.message}).`);
    console.error('Créez une clé avec le droit « writeBuckets » (ou la clé principale), relancez, puis remettez la clé limitée.');
    process.exit(1);
  }
}
console.log('Stockage en ligne prêt.');
