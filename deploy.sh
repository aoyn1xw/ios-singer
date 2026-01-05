#!/bin/bash

# Navigate to your project
cd /mnt/data/ios-signer || exit

# Pull latest changes
git reset --hard   # optional: discard local changes
git clean -fd      # optional: remove untracked files
git pull origin main

# Start or restart the app with PM2
if pm2 list | grep -q "ios-signer"; then
  pm2 restart ios-signer
else
  pm2 start app.js --name ios-signer
fi

# Save PM2 process list for automatic startup after reboot
pm2 save

echo "Deployment done at $(date)"
