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
import fs from "fs";
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

async function getDriveClient(accessToken?: string) {
  if (accessToken) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    return google.drive({ version: "v3", auth: oauth2Client });
  }

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
    throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT_JSON format.");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({ version: "v3", auth });
}

async function getAllFolderIds(drive: any, parentId: string): Promise<string[]> {
  const folders: string[] = [parentId];
  let pageToken: string | undefined = undefined;

  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "nextPageToken, files(id)",
      pageToken: pageToken,
    });
    
    const children = res.data.files || [];
    for (const child of children) {
      if (child.id) {
        folders.push(child.id);
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return folders;
}

async function getDriveFileCount(drive: any, folderIds: string[]) {
  let totalCount = 0;
  
  // We process folders in batches to avoid overwhelming the API
  for (const folderId of folderIds) {
    let pageToken: string | undefined = undefined;
    do {
      const res = await drive.files.list({
        // Do NOT count folders themselves, only files
        q: `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
        fields: "nextPageToken, files(id)",
        pageToken: pageToken,
        pageSize: 1000,
      });

      totalCount += (res.data.files || []).length;
      pageToken = res.data.nextPageToken;
    } while (pageToken);
  }
  
  return totalCount;
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

async function getSupabaseStorageCount(userId: string) {
  let count = 0;
  try {
    const { count: dbCount } = await supabase.from('uploads').select('*', { count: 'exact', head: true }).eq('userId', userId);
    if (dbCount !== null) count = dbCount;
  } catch(e) {}
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
  await ensureBucket();
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

      let createdCount = 0;

      // Verify all configs
      for (const userConfig of predefinedUsers) {
        if (!userConfig.email || !userConfig.password) {
          return res.status(400).json({ error: `Missing config (email, password) for ${userConfig.name}` });
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
      const driveToken = req.headers["x-google-auth"] as string | undefined;
      
      if (callerId !== targetUserId) {
        const { data: caller } = await supabase.from('users').select('role').eq('id', callerId).single();
        if (!caller || (caller.role !== 'leader' && caller.role !== 'co-leader' && caller.role !== 'co-lead')) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const { data: userData } = await supabase.from('users').select('*').eq('id', targetUserId).single();
      if (!userData) return res.status(404).json({ error: "User not found" });

      const driveFolderId = userData.driveFolderId;
      if (!driveFolderId) {
        return res.status(400).json({ error: "No Drive folder linked to this user." });
      }

      const drive = await getDriveClient(driveToken);
      const allFolderIds = await getAllFolderIds(drive, driveFolderId);
      const count = await getDriveFileCount(drive, allFolderIds);

      const now = Date.now();
      
      const { error: updateError } = await supabase.from('users').update({ 
        uploadedCount: count,
        lastSyncedAt: now
      }).eq('id', targetUserId);
      
      if (updateError) {
        await supabase.from('users').update({ 
          uploaded_count: count,
          last_synced_at: now
        }).eq('id', targetUserId);
      }

      await recalculateTeamTotal();
      res.json({ success: true, count, lastSyncedAt: now });
    } catch (e: any) {
      if (e.message?.includes("Invalid Credentials")) {
        return res.status(401).json({ error: "Google Drive authentication failed or expired." });
      }
      res.status(500).json({ error: e.message || "Sync failed" });
    }
  });

  // Fetch photos
  app.get("/api/photos/:userId", verifyAuth, async (req, res) => {
    try {
      const targetUserId = req.params.userId;
      const callerId = (req as any).user.id;
      const driveToken = req.headers["x-google-auth"] as string | undefined;
      
      if (callerId !== targetUserId) {
        const { data: caller } = await supabase.from('users').select('role').eq('id', callerId).single();
        if (!caller || (caller.role !== 'leader' && caller.role !== 'co-leader' && caller.role !== 'co-lead')) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const { data: userData } = await supabase.from('users').select('*').eq('id', targetUserId).single();
      if (!userData || !userData.driveFolderId) {
        return res.status(400).json({ error: "No Drive folder mapped" });
      }

      const drive = await getDriveClient(driveToken);
      const allFolderIds = await getAllFolderIds(drive, userData.driveFolderId);
      
      let queryStr = `(${allFolderIds.map(id => `'${id}' in parents`).join(" or ")}) and mimeType contains 'image/' and trashed=false`;
      
      const driveRes = await drive.files.list({
        q: queryStr,
        fields: "nextPageToken, files(id, name, webViewLink, webContentLink, thumbnailLink, createdTime, size, mimeType)",
        orderBy: "createdTime desc",
        pageSize: 50,
        pageToken: req.query.pageToken as string | undefined,
      });

      res.json({ files: driveRes.data.files, nextPageToken: driveRes.data.nextPageToken });
    } catch (e: any) {
      if (e.message?.includes("Invalid Credentials")) {
        return res.status(401).json({ error: "Google Drive authentication failed or expired." });
      }
      res.status(500).json({ error: e.message || "Fetch failed" });
    }
  });

  // Get My Attendance
  app.get("/api/attendance/me", verifyAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      
      const { data: { user }, error } = await supabase.auth.admin.getUserById(userId);
      if (error || !user) throw new Error("User not found");
      
      res.json({ success: true, attendance: user.user_metadata?.attendance || {} });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to get my attendance" });
    }
  });

  // Mark Attendance (Every User)
  app.post("/api/attendance", verifyAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const { date } = req.body; // format 'YYYY-MM-DD'
      
      if (!date) return res.status(400).json({ error: "Date is required" });
      
      const { data: { user }, error } = await supabase.auth.admin.getUserById(userId);
      if (error || !user) throw new Error("User not found");
      
      const currentAttendance = user.user_metadata?.attendance || {};
      currentAttendance[date] = true;
      
      const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: { ...user.user_metadata, attendance: currentAttendance }
      });
      if (updateError) throw updateError;
      
      res.json({ success: true, attendance: currentAttendance });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to mark attendance" });
    }
  });

  // Get All Attendance (Leader/Co-Leader)
  app.get("/api/attendance/all", verifyAuth, async (req, res) => {
    try {
      const callerId = (req as any).user.id;
      const { data: caller } = await supabase.from('users').select('role').eq('id', callerId).single();
      
      if (!caller || !['leader', 'co-leader', 'co-lead'].includes(caller.role)) {
        return res.status(403).json({ error: "Forbidden. Leaders only." });
      }

      const { data: { users }, error } = await supabase.auth.admin.listUsers();
      if (error) throw error;
      
      const attendanceData = users.map(u => ({
        userId: u.id,
        name: u.user_metadata?.name || 'Unknown',
        role: u.user_metadata?.role || 'member',
        attendance: u.user_metadata?.attendance || {}
      }));
      
      res.json({ success: true, data: attendanceData });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to get all attendance" });
    }
  });

  // Proxy to just redirect to the public URL for images
  app.get("/api/drive-file/:fileId(*)", verifyAuth, async (req, res) => {
    try {
       const driveToken = req.headers["x-google-auth"] as string | undefined;
       const drive = await getDriveClient(driveToken);
       
       const fileResponse = await drive.files.get(
        { fileId: req.params.fileId, alt: "media" },
        { responseType: "stream" }
       );

       const ct = fileResponse.headers["content-type"];
       if (ct) res.setHeader("Content-Type", ct);
       
       fileResponse.data.on("end", () => res.end()).on("error", (err) => res.status(500).send(err)).pipe(res);
    } catch (e) {
       res.status(500).send("File fetch error");
    }
  });

  app.get("/api/folders", verifyAuth, async (req, res) => {
    try {
      const driveToken = req.headers["x-google-auth"] as string | undefined;
      const uid = (req as any).user.id;
      
      const { data: userData } = await supabase.from('users').select('*').eq('id', uid).single();
      if (!userData || !userData.driveFolderId) {
        return res.json({ folders: [] });
      }

      const drive = await getDriveClient(driveToken);
      
      const driveRes = await drive.files.list({
        q: `'${userData.driveFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id, name)",
        orderBy: "name",
      });

      res.json({ folders: driveRes.data.files || [] });
    } catch(e: any) {
      if (e.message?.includes("Invalid Credentials")) {
        return res.status(401).json({ error: "Google Drive authentication failed or expired." });
      }
      res.status(500).json({ error: e.message || "Failed to fetch folders" });
    }
  });

  app.post("/api/folders", verifyAuth, express.json(), async (req, res) => {
    try {
       const driveToken = req.headers["x-google-auth"] as string | undefined;
       const uid = (req as any).user.id;
       const { name } = req.body;
       
       if (!name) return res.status(400).json({ error: "Folder name required" });

       const { data: userData } = await supabase.from('users').select('*').eq('id', uid).single();
       if (!userData || !userData.driveFolderId) {
         return res.status(400).json({ error: "User has no root folder linked." });
       }

       const drive = await getDriveClient(driveToken);

       const fileMetadata = {
         name: name,
         mimeType: 'application/vnd.google-apps.folder',
         parents: [userData.driveFolderId]
       };

       const folder = await drive.files.create({
         requestBody: fileMetadata,
         fields: 'id, name',
       });
       
       res.json({ success: true, folder: folder.data });
    } catch(e: any) {
       res.status(500).json({ error: e.message || "Failed to create folder" });
    }
  });

  app.post("/api/upload", verifyAuth, upload.array("photos", 50), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      const { folderId } = req.body;
      const uid = (req as any).user.id;
      const driveToken = req.headers["x-google-auth"] as string | undefined;
      
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded." });
      }

      const { data: userData } = await supabase.from('users').select('*').eq('id', uid).single();
      if (!userData || !userData.driveFolderId) {
        return res.status(400).json({ error: "User has no root folder linked." });
      }

      const uploadFolder = folderId || userData.driveFolderId;
      const drive = await getDriveClient(driveToken);

      let uploadedIds = [];
      let uploadCount = 0;
      
      for (const file of files) {
        const bufferStream = new stream.PassThrough();
        bufferStream.end(file.buffer);

        try {
          const driveRes = await drive.files.create({
            requestBody: {
              name: file.originalname,
              parents: [uploadFolder],
            },
            media: {
              mimeType: file.mimetype,
              body: bufferStream,
            },
            fields: "id",
          });
          
          if (driveRes.data?.id) {
            uploadCount++;
            uploadedIds.push(driveRes.data.id);
          }
        } catch(uploadErr: any) {
          console.error("Single file upload err:", uploadErr);
        }
      }

      if (uploadCount > 0) {
        // Increment the user's uploadedCount
        const currentCount = userData.uploadedCount || userData.uploaded_count || 0;
        await supabase.from('users').update({ 
           uploadedCount: currentCount + uploadCount,
           uploaded_count: currentCount + uploadCount
        }).eq('id', uid);
        
        await recalculateTeamTotal();
      }

      res.json({ success: true, count: uploadCount, uploadedIds });
    } catch (error: any) {
      if (error.message?.includes("Invalid Credentials")) {
        return res.status(401).json({ error: "Google Drive authentication failed or expired." });
      }
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
