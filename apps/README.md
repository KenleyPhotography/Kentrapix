# KentraPix : applications ordinateur et mobile

Les deux applications chargent le site en ligne (`https://kentrapix.kenleyelysee.com`) : chaque mise à jour du site est
visible tout de suite, sans republier l'application.

## Ordinateur (Windows / Mac / Linux) : Electron
```
cd apps/desktop
npm install
npm start              # tester (si erè « requestSingleInstanceLock » : lancer depuis PowerShell, pas depuis VS Code)
npm run build:win      # crée dist/KentraPix Setup.exe  (build:mac sur un Mac, build:linux sur Linux)
```

## Téléphone (Android / iOS) : Capacitor
```
cd apps/mobile
npm install
npx cap add android    # (Android Studio requis)  ou : npx cap add ios  (Mac + Xcode requis)
npx cap open android   # puis Build > Build APK / Generate Signed Bundle
```
Publication : Google Play (compte 25 $ une fois) / App Store (99 $ par an). Pour un test rapide sans boutique,
l'installation PWA reste possible : Chrome > menu > « Installer l'application ».
