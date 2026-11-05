// 熊寶小資訊 原生專案調整：版本號、狀態列顏色、圖示、啟動畫面
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const A = 'android/app';
const RES = `${A}/src/main/res`;
const ICON = 'assets/icon.png';
const VERSION_CODE = 8;
const VERSION_NAME = "1.0.7";
const BAR = '#0369a1';
const BG = '#e0f2fe';

const edit = (file, fn) => { const s = fs.readFileSync(file, 'utf8'); const t = fn(s); if (t === s) throw new Error(`未修改：${file}`); fs.writeFileSync(file, t); };

// 1. 版本號
edit(`${A}/build.gradle`, s => s.replace(/versionCode \d+/, `versionCode ${VERSION_CODE}`).replace(/versionName "[^"]*"/, `versionName "${VERSION_NAME}"`));

// 2. 狀態列顏色，內容不延伸到狀態列底下
const styles = (v35) => `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">${BAR}</item>
        <item name="colorPrimaryDark">${BAR}</item>
        <item name="colorAccent">${BAR}</item>
    </style>
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.Light.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:statusBarColor">${BAR}</item>
        <item name="android:navigationBarColor">#FFFFFF</item>${v35 ? '\n        <item name="android:windowOptOutEdgeToEdgeEnforcement">true</item>' : ''}
    </style>
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <item name="windowSplashScreenBackground">${BG}</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>
</resources>
`;
fs.writeFileSync(`${RES}/values/styles.xml`, styles(false));
fs.mkdirSync(`${RES}/values-v35`, { recursive: true });
fs.writeFileSync(`${RES}/values-v35/styles.xml`, styles(true));

// 3. 圖示
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENS)) {
  const dir = `${RES}/mipmap-${d}`;
  fs.mkdirSync(dir, { recursive: true });
  const legacy = Math.round(48 * k), fg = Math.round(108 * k);
  const radius = Math.round(legacy * 0.18);
  await sharp(ICON).resize(legacy, legacy).composite([{ input: Buffer.from(`<svg width="${legacy}" height="${legacy}"><rect width="${legacy}" height="${legacy}" rx="${radius}" ry="${radius}"/></svg>`), blend: 'dest-in' }]).png().toFile(`${dir}/ic_launcher.png`);
  await sharp(ICON).resize(legacy, legacy).composite([{ input: Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`), blend: 'dest-in' }]).png().toFile(`${dir}/ic_launcher_round.png`);
  const inner = Math.round(72 * k);   /* 整張圖完整落在可見範圍內 */
  const pic = await sharp(ICON).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: fg, height: fg, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: pic, gravity: 'center' }]).png().toFile(`${dir}/ic_launcher_foreground.png`);
  await sharp(ICON).resize(fg, fg).blur(Math.max(1, 6 * k)).png().toFile(`${dir}/ic_launcher_bg.png`);
}
fs.rmSync(`${RES}/drawable-v24/ic_launcher_foreground.xml`, { force: true });
fs.writeFileSync(`${RES}/drawable/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="${BG}"/></shape>\n`);
fs.rmSync(`${RES}/values/ic_launcher_background.xml`, { force: true });
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_bg"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
fs.writeFileSync(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`, adaptive);
fs.writeFileSync(`${RES}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive);

// 4. 啟動畫面：淺藍底＋圖示
for (const dir of fs.readdirSync(RES).filter(n => n.startsWith('drawable'))) {
  const f = path.join(RES, dir, 'splash.png');
  if (!fs.existsSync(f)) continue;
  const { width, height } = await sharp(f).metadata();
  const size = Math.round(Math.min(width, height) * 0.4);
  const r = Math.round(size * 0.18);
  const icon = await sharp(ICON).resize(size, size).composite([{ input: Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
  await sharp({ create: { width, height, channels: 3, background: BG } }).composite([{ input: icon, gravity: 'center' }]).png().toFile(f + '.tmp');
  fs.renameSync(f + '.tmp', f);
}
console.log('原生專案調整完成');
