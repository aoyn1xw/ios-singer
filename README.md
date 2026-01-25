# iOS Singer

**iOS Singer** is a fast, web-based and API-enabled iOS IPA file signing server. Upload an IPA file, your signing certificate (**.p12**) and provisioning profile (**.mobileprovision**), and receive a signed IPA ready for installation via an OTA link—all in your browser or programmatically via HTTP.

---

## Features

- **Sign iOS IPAs online:** Simple form or API for signing your iOS apps.
- **OTA install links:** Get an iOS-friendly install link for your re-signed IPA.
- **No account required:** No user authentication on the public deployment.
- **Fast and stable:** Uses `zsign` in a worker thread for performance.
- **Large file support:** Accepts uploads up to 500MB.
- **Modern UI:** Responsive, dark/light mode, mobile compatible.
- **Automated cleanup:** Old uploads are deleted periodically.
- **API ready:** Integrate programmatically with a single HTTP request.
- **Advanced IPA tweaks:** Optional name/version/bundle id edits and common cleanup toggles before signing.

---

## Live Demo

Try it at: **[https://sign.ayon1xw.me/](https://sign.ayon1xw.me/)**

---

## Getting Started

### 1. Requirements (for self-hosting)

- Node.js 16+
- `zsign` binary available in `$PATH` or in the project folder
- `cyan` (pyzule-rw) CLI in `$PATH` if you want advanced IPA tweaks before signing
- Unix-like system recommended

### 2. Install & Run

Clone the repository:

```bash
git clone https://github.com/aoyn1xw/ios-singer.git
cd ios-singer
npm install
```

Set up your environment variables (optional):

- `PORT` : HTTP port to listen on (default: `3000`)
- `RATE_LIMIT_WINDOW_MS` : Rate limiting interval (default: 900,000ms)
- `RATE_LIMIT_MAX` : Max requests per interval (default: 100)
- `CYAN_CMD` : Path/name for the `cyan` CLI (default: `cyan`)

Start the server:

```bash
node app.js
```

The server will be accessible at [http://localhost:3000](http://localhost:3000).

---

## Using the Web Interface

1. **Open** the web UI in your browser.
2. **Upload**:
   - IPA file (.ipa)
   - P12 certificate (.p12)
   - Provisioning profile (.mobileprovision)
   - Optionally, provide your P12 password (if set).
   - Optionally, expand Advanced to tweak the app before signing.
3. **Click** "Sign IPA". Wait for processing.
4. **Receive**:
   - Page with iOS install link.
   - `itms-services` direct link for device installation.

---

## Using the API

You can sign IPAs programmatically using the `/sign` API endpoint.

### Endpoint

- **URL:** `/sign`
- **Method:** `POST`
- **Content-Type:** `multipart/form-data`
- **Required fields:** `ipa`, `p12`, `mobileprovision`
- **Optional fields:** `p12_password`, advanced tweak fields (see below)

Advanced tweak fields:
- `adv_name`, `adv_version`, `adv_bundle_id`, `adv_min_os`
- `adv_remove_supported_devices`, `adv_no_watch`, `adv_fakesign`, `adv_thin`
- `adv_remove_extensions`, `adv_remove_encrypted`

#### Example using `curl`:

```bash
curl -X POST https://sign.ayon1xw.me/sign \
  -F "ipa=@your/app.ipa" \
  -F "p12=@your/certificate.p12" \
  -F "mobileprovision=@your/profile.mobileprovision" \
  -F "p12_password=yourpassword" \
  -F "adv_name=New Name" \
  -F "adv_bundle_id=com.example.app" \
  -F "adv_remove_supported_devices=on"
```

#### Success Response

```json
{
  "installLink": "https://sign.ayon1xw.me/install/XXXXXXXXXXXXXXXXX",
  "directInstallLink": "itms-services://?action=download-manifest&url=https://sign.ayon1xw.me/plist/APP_xxxxxxx.plist"
}
```

---

## Project Structure

- `app.js` — Node.js server, Express API, file handling, main logic
- `zsign-worker.js` — Worker thread to run `zsign` binary for IPA signing
- `index.html` — Modern web UI
- `style.css` — Interface styling
- `/uploads` — (auto-created) Temporary file storage

---

## Security Notes

- **Files and links expire** after roughly 1 hour.
- Inputs are validated by file type and size.
- Rate limiting is enforced.
- For sensitive use/self-hosting: run securely (behind HTTPS, with authentication; current public version is for demo/low-trust use).

---

## License

*(Specify your license here, e.g. MIT, GPL, or "proprietary/private")*

---

## Credits

- [zsign](https://github.com/zhlynn/zsign): Fast IPA resigning used under the hood.

---

**Enjoy one of the fastest, simplest iOS signing pipelines available!**
