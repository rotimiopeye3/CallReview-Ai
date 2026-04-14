import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";

const app = express();
const PORT = 3000;

app.use(express.json());

// --- Google Sheets Integration ---

const getOauth2Client = (origin: string) => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${origin}/auth/callback`
  );
};

app.get("/api/auth/google/url", (req, res) => {
  const origin = req.headers.origin || `https://${req.headers.host}`;
  const oauth2Client = getOauth2Client(origin);
  
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/userinfo.email"
    ],
    prompt: "consent"
  });
  
  res.json({ url });
});

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  const origin = `https://${req.headers.host}`;
  const oauth2Client = getOauth2Client(origin);

  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    // In a real app, you'd store these tokens in a database associated with the user.
    // For this demo, we'll pass them back to the frontend to store in state (less secure but works for demo).
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'OAUTH_AUTH_SUCCESS',
                tokens: ${JSON.stringify(tokens)}
              }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error exchanging code:", error);
    res.status(500).send("Authentication failed");
  }
});

app.post("/api/sheets/append", async (req, res) => {
  const { tokens, spreadsheetId, values } = req.body;
  
  if (!tokens || !spreadsheetId || !values) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials(tokens);

  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      requestBody: {
        values: [values]
      }
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Sheets API Error:", error);
    res.status(500).json({ error: "Failed to append to sheet" });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
