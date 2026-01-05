require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Worker } = require('worker_threads');
const AdmZip = require('adm-zip');
const plist = require('plist');
const bplistParser = require('bplist-parser');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const winston = require('winston');

const {
  PORT = 3000,
  RATE_LIMIT_WINDOW_MS = 900000,
  RATE_LIMIT_MAX = 100,
  LOG_LEVEL = 'info',
} = process.env;

const PUBLIC_DOMAIN = 'https://sign.ayon1xw.me/'; // always use this domain

const WORK_DIR = path.join(__dirname, 'uploads');
const REQUIRED_DIRS = ['p12', 'mp', 'temp', 'signed', 'plist'];
const logDir = path.join(__dirname, 'logs');

if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
  ],
});
logger.add(new winston.transports.Console({ format: winston.format.simple() }));

const app = express();
app.use(express.urlencoded({ extended: true, limit: '5gb' }));
app.use(express.json({ limit: '5gb' }));
app.use(cors());

const limiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MS, 10),
  max: parseInt(RATE_LIMIT_MAX, 10),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Create required directories
for (const dir of REQUIRED_DIRS) {
  const dirPath = path.join(WORK_DIR, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.use('/signed', express.static(path.join(WORK_DIR, 'signed')));
app.use('/plist', express.static(path.join(WORK_DIR, 'plist')));

app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const upload = multer({
  dest: path.join(WORK_DIR, 'temp'),
  limits: { fileSize: 5 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.ipa', '.p12', '.mobileprovision'];
    const ext = path.extname(file.originalname).toLowerCase();
    allowedTypes.includes(ext) ? cb(null, true) : cb(new Error('Invalid file type'));
  },
});

function generateRandomSuffix() {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '');
}

function generateManifestPlist(ipaUrl, bundleId, bundleVersion, displayName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${ipaUrl}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${bundleId || 'com.example.app'}</string>
        <key>bundle-version</key>
        <string>${bundleVersion}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${displayName}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;
}

function signIpaInWorker({ p12Path, p12Password, mpPath, ipaPath, signedIpaPath }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'zsign-worker.js'), {
      workerData: { p12Path, p12Password, mpPath, ipaPath, signedIpaPath }
    });
    worker.on('message', (msg) => msg.status === 'ok' ? resolve(msg) : reject(new Error(msg.error)));
    worker.on('error', reject);
    worker.on('exit', (code) => code !== 0 && reject(new Error(`Worker exit code ${code}`)));
  });
}

// --- SIGN ENDPOINT ---
app.post('/sign',
  upload.fields([
    { name: 'ipa', maxCount: 1 },
    { name: 'p12', maxCount: 1 },
    { name: 'mobileprovision', maxCount: 1 },
  ]),
  async (req, res) => {
    logger.info('Sign request received');
    let uniqueSuffix, ipaPath, p12Path, mpPath, signedIpaPath, metadataPath;

    try {
      if (!req.files?.p12 || !req.files?.mobileprovision) return res.status(400).json({ error: 'P12 and MobileProvision required' });

      uniqueSuffix = generateRandomSuffix();

      // Handle IPA upload or URL
      if (req.body.ipa_url && !req.files.ipa) {
        const https = require('https');
        const http = require('http');
        ipaPath = path.join(WORK_DIR, 'temp', `input_${uniqueSuffix}.ipa`);
        const fileStream = fs.createWriteStream(ipaPath);
        const protocol = req.body.ipa_url.startsWith('https') ? https : http;

        await new Promise((resolve, reject) => {
          protocol.get(req.body.ipa_url, (response) => {
            response.pipe(fileStream);
            fileStream.on('finish', () => fileStream.close(resolve));
          }).on('error', (err) => {
            fs.unlink(ipaPath, () => {});
            reject(new Error('Failed to download IPA: ' + err.message));
          });
        });
      } else if (req.files.ipa) {
        ipaPath = path.join(WORK_DIR, 'temp', `input_${uniqueSuffix}.ipa`);
        await fsp.rename(req.files.ipa[0].path, ipaPath);
      } else return res.status(400).json({ error: 'IPA file or ipa_url required' });

      const p12Password = (req.body.p12_password || '').trim();
      p12Path = path.join(WORK_DIR, 'p12', `cert_${uniqueSuffix}.p12`);
      mpPath = path.join(WORK_DIR, 'mp', `app_${uniqueSuffix}.mobileprovision`);

      await fsp.rename(req.files.p12[0].path, p12Path);
      await fsp.rename(req.files.mobileprovision[0].path, mpPath);

      signedIpaPath = path.join(WORK_DIR, 'signed', `signed_${uniqueSuffix}.ipa`);
      await signIpaInWorker({ p12Path, p12Password, mpPath, ipaPath, signedIpaPath });
      logger.info(`Signed IPA created: ${signedIpaPath}`);

      const zipSigned = new AdmZip(signedIpaPath);
      let appFolderName = '';
      for (const entry of zipSigned.getEntries()) {
        const parts = entry.entryName.split('/');
        if (parts.length > 1 && parts[1].endsWith('.app')) {
          appFolderName = parts[1];
          break;
        }
      }
      if (!appFolderName) return res.status(500).json({ error: 'No .app found in IPA' });

      const plistEntry = zipSigned.getEntry(`Payload/${appFolderName}/Info.plist`);
      if (!plistEntry) return res.status(500).json({ error: 'Info.plist not found' });

      let plistData;
      const plistBuffer = plistEntry.getData();
      try { plistData = plist.parse(plistBuffer.toString('utf8')); }
      catch {
        try { const parsed = await bplistParser.parseBuffer(plistBuffer); plistData = parsed?.[0] || {}; }
        catch { return res.status(500).json({ error: 'Failed to parse Info.plist' }); }
      }

      const bundleId = plistData.CFBundleIdentifier || 'com.example.app';
      const bundleVersion = plistData.CFBundleVersion || '1.0.0';
      const displayName = plistData.CFBundleDisplayName || plistData.CFBundleName || 'App';

      const ipaUrl = `${PUBLIC_DOMAIN}signed/${path.basename(signedIpaPath)}`;
      const manifest = generateManifestPlist(ipaUrl, bundleId, bundleVersion, displayName);
      const plistFilename = `${sanitizeFilename(displayName)}_${uniqueSuffix}.plist`;
      const plistSavePath = path.join(WORK_DIR, 'plist', plistFilename);
      await fsp.writeFile(plistSavePath, manifest, 'utf8');

      const manifestUrl = `${PUBLIC_DOMAIN}plist/${plistFilename}`;
      const directInstallLink = `itms-services://?action=download-manifest&url=${manifestUrl}`;
      const installPageUrl = `${PUBLIC_DOMAIN}install/${uniqueSuffix}`;

      metadataPath = path.join(WORK_DIR, 'temp', `${uniqueSuffix}.json`);
      const metadata = {
        displayName,
        bundleId,
        bundleVersion,
        installLink: directInstallLink,
        expiresAt: Date.now() + 3600000
      };
      await fsp.writeFile(metadataPath, JSON.stringify(metadata), 'utf8');

      res.json({ installLink: installPageUrl, directInstallLink });

      setTimeout(async () => {
        try {
          if (fs.existsSync(signedIpaPath)) await fsp.unlink(signedIpaPath);
          if (fs.existsSync(plistSavePath)) await fsp.unlink(plistSavePath);
          if (fs.existsSync(metadataPath)) await fsp.unlink(metadataPath);
        } catch (e) {}
      }, 3600000);

    } catch (err) {
      logger.error(`Signing error: ${err}`);
      return res.status(500).json({ error: 'Signing failed', details: err.message });
    } finally {
      try { if (ipaPath && fs.existsSync(ipaPath)) await fsp.unlink(ipaPath);
            if (p12Path && fs.existsSync(p12Path)) await fsp.unlink(p12Path);
            if (mpPath && fs.existsSync(mpPath)) await fsp.unlink(mpPath);
      } catch {}
    }
  }
);

// --- INSTALL PAGE ---
app.get('/install/:id', async (req, res) => {
  const id = req.params.id;
  const metadataPath = path.join(WORK_DIR, 'temp', `${id}.json`);

  if (!fs.existsSync(metadataPath)) return res.status(404).send('Install link expired or not found.');

  const data = JSON.parse(await fsp.readFile(metadataPath, 'utf8'));

  if (Date.now() > data.expiresAt) {
    await fsp.unlink(metadataPath);
    return res.status(410).send('This install link has expired.');
  }

  res.send(`
    <html>
      <head>
        <title>Install ${data.displayName}</title>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        <h1>${data.displayName}</h1>
        <p>Version: ${data.bundleVersion}</p>
        <p>Bundle ID: ${data.bundleId}</p>
        <a href="${data.installLink}" class="install-button">Install on iOS</a>
      </body>
    </html>
  `);
});

if (!global.serverStarted) {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Public domain: ${PUBLIC_DOMAIN}`);
    global.serverStarted = true;
  });
}

