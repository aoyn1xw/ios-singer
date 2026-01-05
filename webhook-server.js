const express = require('express');
const { exec } = require('child_process');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Optional: secret verification
const SECRET = 'your_webhook_secret';

app.post('/deploy', (req, res) => {
  // verify secret (optional)
  if (SECRET && req.headers['x-hub-signature-256']) {
    // implement verification if needed
  }

  exec('/mnt/data/ios-signer/deploy.sh', (err, stdout, stderr) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Deploy failed');
    }
    console.log(stdout);
    res.send('Deploy triggered');
  });
});

app.listen(3001, () => console.log('Webhook server running on port 3000'));
