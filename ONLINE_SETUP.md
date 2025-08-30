# How to Play Online with Friends

## Option 1: ngrok (Quick Testing - Free)

1. **Install ngrok:**
   ```bash
   # On macOS
   brew install ngrok/ngrok/ngrok
   
   # Or download from https://ngrok.com/download
   ```

2. **Sign up for free ngrok account:**
   - Go to https://ngrok.com/signup
   - Get your auth token from dashboard

3. **Configure ngrok:**
   ```bash
   ngrok config add-authtoken YOUR_AUTH_TOKEN
   ```

4. **Expose your game:**
   ```bash
   # In terminal 1 - Start game server
   python3 nocache_server.py
   
   # In terminal 2 - Start multiplayer server  
   npm start
   
   # In terminal 3 - Expose game server
   ngrok http 3001
   
   # In terminal 4 - Expose multiplayer server
   ngrok http 3002
   ```

5. **Update multiplayer.js:**
   - Replace `serverUrl` with your ngrok URL for port 3002
   - Example: `https://abc123.ngrok.io` (without port)

6. **Share the game URL** (port 3001 ngrok URL) with friends!

## Option 2: Deploy to Cloud (Permanent Solution)

### Using Railway.app (Recommended - Easy)

1. **Prepare for deployment:**
   ```bash
   # Create a start script that runs both servers
   echo 'node server.js & python3 -m http.server 3001' > start.sh
   chmod +x start.sh
   ```

2. **Update multiplayer.js for production:**
   ```javascript
   // Change this line in multiplayer.js
   const serverUrl = window.location.hostname === 'localhost' 
     ? 'http://localhost:3002' 
     : 'https://your-app.railway.app';
   ```

3. **Deploy to Railway:**
   - Go to https://railway.app
   - Connect GitHub repo
   - Deploy with one click
   - Set PORT environment variable to 3002

### Using Render.com (Free tier available)

1. **Create render.yaml:**
   ```yaml
   services:
     - type: web
       name: demonlist-guesser
       env: node
       buildCommand: npm install
       startCommand: npm start
       envVars:
         - key: PORT
           value: 3002
   ```

2. **Deploy:**
   - Push to GitHub
   - Connect to Render.com
   - Deploy automatically

## Option 3: Use Your Computer as Server (Free but Complex)

1. **Port Forward on Router:**
   - Access router admin (usually 192.168.1.1)
   - Forward ports 3001 and 3002 to your computer
   - Find your public IP: https://whatismyipaddress.com

2. **Update multiplayer.js:**
   ```javascript
   const serverUrl = 'http://YOUR_PUBLIC_IP:3002';
   ```

3. **Share link:** `http://YOUR_PUBLIC_IP:3001`

⚠️ **Security Warning:** This exposes your computer to the internet!

## Quick Local Network Testing (Same WiFi)

If your friend is on the same network:

1. **Find your local IP:**
   ```bash
   # On macOS
   ipconfig getifaddr en0
   ```

2. **Share this URL with friend:**
   - Game: `http://YOUR_LOCAL_IP:3001`
   - They can join your multiplayer games directly!

## Current Server Status

To check if servers are running:
```bash
# Check game server
curl http://localhost:3001

# Check multiplayer server  
curl http://localhost:3002/socket.io/
```

## Troubleshooting

- **CORS errors:** Update `server.js` to allow your domain
- **Connection failed:** Check firewall settings
- **Slow performance:** Consider upgrading hosting plan
- **Can't create party:** Ensure multiplayer server is accessible

## Recommended for Testing

Use **ngrok** for quick testing - it's free and takes 5 minutes to set up!

For permanent solution, use **Railway.app** or **Render.com** - both have free tiers.