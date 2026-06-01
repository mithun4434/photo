import "dotenv/config";
import fs from "fs";
import dotenv from "dotenv";

try {
  const envConfig = dotenv.parse(fs.readFileSync('.env'));
  for (const k in envConfig) {
    if (envConfig[k]) {
       process.env[k] = envConfig[k];
    }
  }
} catch(e) {}

import express from "express";
import path from "path";
import multer from "multer";
import cors from "cors";
import { google } from "googleapis";
import stream from "stream";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase fallback (for server logic)
let supabaseUrl = process.env.VITE_SUPABASE_URL || '';
if (supabaseUrl && !supabaseUrl.startsWith('http')) {
  supabaseUrl = `https://${supabaseUrl}.supabase.co`;
}
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; // Must have service_role key here to update tables as admin!
const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseServiceKey || 'placeholder');

// Multer parsing configuration
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

async function getDriveClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON inside environment");
  }
  
  let credentials;
  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim().startsWith('{')) {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } else {
      const buff = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, 'base64');
      credentials = JSON.parse(buff.toString('utf8'));
    }
    
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("Missing client_email or private_key in the loaded JSON.");
    }
  } catch(e) {
    throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT_JSON: You provided an invalid format (possibly just the private key). Please go to Google Cloud Console > IAM & Admin > Service Accounts, create a new 'JSON' key, and paste the ENTIRE downloaded file contents (which starts with {\"type\": \"service_account\"...}) into the GOOGLE_SERVICE_ACCOUNT_JSON environment variable.");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({ version: "v3", auth });
}

async function recalculateTeamTotal() {
  const { data: users, error } = await supabase.from('users').select('uploadedCount, uploaded_count, id');
  if (error || !users) return;
  let total = 0;
  for (const u of users) {
    total += (u.uploadedCount || u.uploaded_count || 0);
  }
  
  const { data: teamData } = await supabase.from('teamSettings').select('*').eq('id', 'info').single();
  if (teamData) {
      await supabase.from('teamSettings').update({ 
         totalUploaded: total,
         updatedAt: Date.now()
      }).eq('id', 'info');
  } else {
      await supabase.from('teamSettings').insert({ 
         id: 'info',
         totalUploaded: total,
         updatedAt: Date.now()
      });
  }
}

async function getAllFolderIds(drive: any, parentId: string): Promise<string[]> {
  let ids = [parentId];
  try {
    let pageToken: string | undefined = undefined;
    const q = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    do {
      const res = await drive.files.list({ q, fields: 'nextPageToken, files(id)', pageToken, pageSize: 1000 });
      for (const f of res.data.files || []) {
        if (f.id) {
          ids = ids.concat(await getAllFolderIds(drive, f.id));
        }
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);
  } catch(e) {}
  return ids;
}

async function getDriveFileCount(folderId: string, userId?: string) {
  const drive = await getDriveClient();
  const folderIds = await getAllFolderIds(drive, folderId);
  const parentQuery = folderIds.map(id => `'${id}' in parents`).join(' or ');
  const q = `(${parentQuery}) and mimeType contains 'image/' and trashed = false`;
  let count = 0;
  let pageToken: string | undefined = undefined;
  
  if (userId) {
    await supabase.from('uploads').delete().eq('userId', userId);
  }

  do {
    const response = await drive.files.list({
      q,
      pageSize: 1000,
      pageToken,
      fields: 'nextPageToken, files(id, name, createdTime)'
    });
    
    const files = response.data.files || [];
    count += files.length;
    
    if (userId && files.length > 0) {
      const uploadRecords = files.map(f => ({
        userId,
        fileName: f.name || 'Untitled',
        driveFileId: f.id || '',
        uploadedAt: f.createdTime ? new Date(f.createdTime).getTime() : Date.now()
      }));
      await supabase.from('uploads').insert(uploadRecords);
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);
  
  return count;
}

async function verifyAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.split("Bearer ")[1] || (req.query.token as string);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    (req as any).user = user;
    next();
  } catch (error) {
    console.error("Auth verification failed", error);
    return res.status(401).json({ error: "Unauthorized" });
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Get Service Account Email endpoint
  app.get("/api/service-account", (req, res) => {
    try {
      if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        let credentials;
        if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim().startsWith('{')) {
          credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        } else {
          const buff = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, 'base64');
          credentials = JSON.parse(buff.toString('utf8'));
        }
        return res.json({ email: credentials.client_email });
      }
      return res.json({ email: null });
    } catch (e) {
      return res.json({ email: null });
    }
  });

  // Seed endpoint to create predefined accounts
  app.post("/api/seed", async (req, res) => {
    try {
      const payloadUsers = req.body?.users;
      const predefinedUsers = payloadUsers?.length ? payloadUsers : [
        { name: 'Yogesh', role: 'leader', email: process.env.YOGESH_EMAIL, password: process.env.YOGESH_PASSWORD, driveFolderId: process.env.YOGESH_DRIVE_FOLDER_ID },
        { name: 'Mithun', role: 'co-lead', email: process.env.MITHUN_EMAIL, password: process.env.MITHUN_PASSWORD, driveFolderId: process.env.MITHUN_DRIVE_FOLDER_ID },
        { name: 'Nishanth', role: 'member', email: process.env.NISHANTH_EMAIL, password: process.env.NISHANTH_PASSWORD, driveFolderId: process.env.NISHANTH_DRIVE_FOLDER_ID },
        { name: 'Farhan', role: 'member', email: process.env.FARHAN_EMAIL, password: process.env.FARHAN_PASSWORD, driveFolderId: process.env.FARHAN_DRIVE_FOLDER_ID },
        { name: 'Renuga', role: 'member', email: process.env.RENUGA_EMAIL, password: process.env.RENUGA_PASSWORD, driveFolderId: process.env.RENUGA_DRIVE_FOLDER_ID },
        { name: 'Gokul', role: 'member', email: process.env.GOKUL_EMAIL, password: process.env.GOKUL_PASSWORD, driveFolderId: process.env.GOKUL_DRIVE_FOLDER_ID },
      ];

      const drive = await getDriveClient();
      console.log('Seed API Drive Auth Email: ', (drive as any)._options?.auth?.credentials?.client_email || 'unknown');
      let createdCount = 0;

      // First verify all folders
      for (const userConfig of predefinedUsers) {
        if (!userConfig.email || !userConfig.password || !userConfig.driveFolderId) {
          return res.status(400).json({ error: `Missing config (email, password, or folder ID) for ${userConfig.name}` });
        }

        // Verify folder is accessible
        try {
          await drive.files.get({
            fileId: userConfig.driveFolderId,
            fields: "id, name"
          });
        } catch (e: any) {
          const email = (drive as any)._options?.auth?.credentials?.client_email || 'unknown';
          return res.status(400).json({ error: `Using: ${email} -> Folder ID ${userConfig.driveFolderId} not accessible. Error: ${e.message}` });
        }
      }

      // Then insert/update users
      for (const userConfig of predefinedUsers) {

        // 1. Check if user exists in auth
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        let authUser = users?.find((u: any) => u.email === userConfig.email);

        if (!authUser) {
          console.log(`Creating auth user for ${userConfig.name}...`);
          const { data: newAuthData, error: createError } = await supabase.auth.admin.createUser({
            email: userConfig.email,
            password: userConfig.password,
            email_confirm: true,
            user_metadata: { name: userConfig.name, role: userConfig.role }
          });
          if (createError) throw createError;
          authUser = newAuthData.user;
        }

        if (!authUser) continue;

        // 2. Add to public.users if not exists
        const { data: publicUser } = await supabase.from('users').select('*').eq('id', authUser.id).single();

        if (!publicUser) {
          console.log(`Inserting into public.users for ${userConfig.name}...`);
          await supabase.from('users').insert({
            id: authUser.id,
            email: userConfig.email,
            name: userConfig.name,
            role: userConfig.role,
            createdAt: Date.now(),
            driveFolderId: userConfig.driveFolderId,
            uploadedCount: 0
          });
          createdCount++;
        } else {
           await supabase.from('users').update({ 
               driveFolderId: userConfig.driveFolderId,
               role: userConfig.role,
               name: userConfig.name 
            }).eq('id', authUser.id);
           await supabase.auth.admin.updateUserById(authUser.id, {
             user_metadata: { name: userConfig.name, role: userConfig.role }
           });
        }
      }

      res.json({ success: true, message: `Completed setup. Inserted/Updated ${createdCount} users.` });
    } catch (e: any) {
      console.error('Seed error:', e);
      res.status(500).json({ error: e.message || "Seeding failed" });
    }
  });

  // Update teamSettings endpoint
  app.put("/api/teamSettings", verifyAuth, async (req, res) => {
    try {
      const callerId = (req as any).user.id;
      const { data: caller } = await supabase.from('users').select('role').eq('id', callerId).single();
      
      if (!caller || !['leader', 'co-leader', 'co-lead'].includes(caller.role)) {
        return res.status(403).json({ error: "Forbidden. Leaders only." });
      }

      const { overallTarget } = req.body;
      if (typeof overallTarget !== 'number') {
        return res.status(400).json({ error: "Invalid target value" });
      }

      const { data, error } = await supabase.from('teamSettings').upsert({
        id: 'info',
        overallTarget: overallTarget,
        updatedAt: Date.now()
      }).select();

      if (error) throw error;
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to update team settings" });
    }
  });

  // Update user endpoint
  app.put("/api/users/:userId", verifyAuth, async (req, res) => {
    try {
      const targetUserId = req.params.userId;
      const callerId = (req as any).user.id;
      
      const { data: caller } = await supabase.from('users').select('role').eq('id', callerId).single();
      
      if (!caller || !['leader', 'co-leader', 'co-lead'].includes(caller.role)) {
        return res.status(403).json({ error: "Forbidden. Leaders only." });
      }

      const { personalTarget, role } = req.body;
      const updateData: any = {};
      if (personalTarget !== undefined) updateData.personalTarget = personalTarget;
      if (role !== undefined) updateData.role = role;

      const { data, error } = await supabase.from('users').update(updateData).eq('id', targetUserId).select();

      if (error) throw error;
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to update user" });
    }
  });

  // Sync Folder
  app.post("/api/sync/:userId", verifyAuth, async (req, res) => {
    try {
      const targetUserId = req.params.userId;
      const callerId = (req as any).user.id;
      
      if (callerId !== targetUserId) {
        const { data: caller } = await supabase.from('users').select('role').eq('id', callerId).single();
        if (!caller || (caller.role !== 'leader' && caller.role !== 'co-leader' && caller.role !== 'co-lead')) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const { data: userData } = await supabase.from('users').select('*').eq('id', targetUserId).single();
      if (!userData) return res.status(404).json({ error: "User not found" });

      const folderId = userData.driveFolderId || userData.drive_folder_id;
      let count = 0;
      if (folderId) {
        count = await getDriveFileCount(folderId, targetUserId);
      }

      const now = Date.now();
      
      const { error: updateError } = await supabase.from('users').update({ 
        uploadedCount: count,
        lastSyncedAt: now
      }).eq('id', targetUserId);
      
      if (updateError) {
        // Fallback to snake_case if custom column omitted in camelCase
        await supabase.from('users').update({ 
          uploaded_count: count,
          last_synced_at: now
        }).eq('id', targetUserId);
      }

      await recalculateTeamTotal();
      res.json({ success: true, count, lastSyncedAt: now });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Sync failed" });
    }
  });

  // Fetch photos
  app.get("/api/photos/:userId", verifyAuth, async (req, res) => {
    try {
      const targetUserId = req.params.userId;
      const callerId = (req as any).user.id;
      
      if (callerId !== targetUserId) {
        const { data: caller } = await supabase.from('users').select('role').eq('id', callerId).single();
        if (!caller || (caller.role !== 'leader' && caller.role !== 'co-leader' && caller.role !== 'co-lead')) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const { data: userData } = await supabase.from('users').select('*').eq('id', targetUserId).single();
      const folderId = userData?.driveFolderId || userData?.drive_folder_id;
      
      if (!folderId) return res.json({ files: [] });

      const drive = await getDriveClient();
      const pageToken = req.query.pageToken as string | undefined;
      
      const folderIds = await getAllFolderIds(drive, folderId);
      const parentQuery = folderIds.map(id => `'${id}' in parents`).join(' or ');
      const q = `(${parentQuery}) and mimeType contains 'image/' and trashed = false`;
      
      const response = await drive.files.list({
        q,
        pageSize: parseInt(req.query.pageSize as string || "50"),
        pageToken,
        fields: 'nextPageToken, files(id, name, mimeType, thumbnailLink, webViewLink, webContentLink, createdTime, size)',
        orderBy: 'createdTime desc'
      });
      
      res.json({ files: response.data.files || [], nextPageToken: response.data.nextPageToken });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Fetch failed" });
    }
  });

  // Stream drive proxy (for full download)
  app.get("/api/drive-file/:fileId", verifyAuth, async (req, res) => {
    try {
       const drive = await getDriveClient();
       const response = await drive.files.get({ fileId: req.params.fileId, alt: 'media' }, { responseType: 'stream' });
       if (response.headers['content-type']) {
          res.setHeader('Content-Type', response.headers['content-type']);
       }
       response.data.pipe(res);
    } catch (e) {
       res.status(500).send("File fetch error");
    }
  });

  app.get("/api/folders", verifyAuth, async (req, res) => {
    try {
      const uid = (req as any).user.id;
      const { data: userData } = await supabase.from('users').select('*').eq('id', uid).single();
      if (!userData) return res.status(404).json({ error: "User not found." });
      
      let parentId = userData.driveFolderId || userData.drive_folder_id;
      if (!parentId) return res.status(400).json({ error: "No primary folder configured." });

      const drive = await getDriveClient();
      
      let allFolders: any[] = [];
      const fetchFolders = async (pid: string, parentPath: string) => {
        let pageToken: string | undefined = undefined;
        const q = `'${pid}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        do {
          const fsRes = await drive.files.list({ q, fields: 'nextPageToken, files(id, name)', pageToken, pageSize: 1000 });
          for (const f of fsRes.data.files || []) {
            if (f.id && f.name) {
              const fullPath = parentPath ? `${parentPath}/${f.name}` : f.name;
              allFolders.push({ id: f.id, name: fullPath });
              await fetchFolders(f.id, fullPath);
            }
          }
          pageToken = fsRes.data.nextPageToken || undefined;
        } while (pageToken);
      };
      
      allFolders.push({ id: parentId, name: 'Root Folder' });
      await fetchFolders(parentId, '');

      res.json({ folders: allFolders });
    } catch(e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/folders", verifyAuth, express.json(), async (req, res) => {
    try {
       const { name, parentId: requestParentId } = req.body;
       if (!name) return res.status(400).json({ error: "Name is required" });
       
       const uid = (req as any).user.id;
       const { data: userData } = await supabase.from('users').select('*').eq('id', uid).single();
       if (!userData) return res.status(404).json({ error: "User not found." });
       
       let rootId = userData.driveFolderId || userData.drive_folder_id;
       if (!rootId) return res.status(400).json({ error: "No primary folder configured." });
       
       const actualParentId = requestParentId || rootId;
       
       const drive = await getDriveClient();
       const fileMetadata = {
         name: name,
         mimeType: 'application/vnd.google-apps.folder',
         parents: [actualParentId]
       };
       const folderRes = await drive.files.create({
         requestBody: fileMetadata,
         fields: 'id, name'
       });
       
       res.json({ success: true, folder: folderRes.data });
    } catch(e: any) {
       res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/upload", verifyAuth, upload.array("photos", 50), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      const uid = (req as any).user.id;
      
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded." });
      }

      // 1. Get user document from Supabase to find Drive Folder ID
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', uid)
        .single();
      
      if (userError || !userData) {
        return res.status(404).json({ error: "User not found." });
      }
      
      let baseFolderId = userData.driveFolderId || userData.drive_folder_id;
      let targetFolderId = req.body.targetFolderId || baseFolderId;

      const drive = await getDriveClient();

      if (!baseFolderId) {
        return res.status(400).json({ error: "No Google Drive folder configured for this user." });
      }

      // 3. Upload all files
      let uploadedIds = [];
      let uploadCount = 0;
      
      for (const file of files) {
        const bufferStream = new stream.PassThrough();
        bufferStream.end(file.buffer);

        const media = {
          mimeType: file.mimetype,
          body: bufferStream,
        };

        const fileMetadata = {
          name: file.originalname,
          parents: [targetFolderId]
        };

        const uploadRes = await drive.files.create({
          requestBody: fileMetadata,
          media,
          fields: "id"
        });
        
        const fileId = uploadRes.data.id;
        
        // 4. Create Uploads database record
        if (fileId) {
          const { error: insertError } = await supabase.from('uploads').insert({
            userId: uid,
            fileName: file.originalname,
            driveFileId: fileId,
            uploadedAt: Date.now()
          });
          if (!insertError) {
             uploadCount++;
             uploadedIds.push(fileId);
          } else {
             console.error(insertError);
          }
        }
      }

      if (uploadCount > 0) {
        // Increment the user's uploadedCount
        const currentCount = userData.uploadedCount || userData.uploaded_count || 0;
        await supabase.from('users').update({ 
           uploadedCount: currentCount + uploadCount,
           uploaded_count: currentCount + uploadCount
        }).eq('id', uid);
        
        // Just run recalculate directly to ensure consistency
        await recalculateTeamTotal();
      }

      res.json({ success: true, count: uploadCount, uploadedIds });
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ status: "error", message: error.message || "Upload failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
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
