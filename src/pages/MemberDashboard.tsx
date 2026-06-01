import { useState, useEffect, useRef } from "react";
import { useAuth } from "../hooks/use-auth";
import { supabase } from "../lib/supabase";
import Navbar from "@/components/layout/Navbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { UploadCloud, FileImage, Target, Trophy, Info, RefreshCw, Image as ImageIcon, CheckCircle2, Circle, CalendarDays, Flag, Clock } from "lucide-react";
import * as motion from "motion/react-client";
import { Link } from "react-router";
import { AuthImage } from "@/components/AuthImage";

import { AttendanceCard } from "@/components/AttendanceCard";

export default function MemberDashboard() {
  const { user } = useAuth();
  const [folders, setFolders] = useState<{id: string, name: string}[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [globalStats, setGlobalStats] = useState({ totalUploaded: 0, overallTarget: 0 });
  const [members, setMembers] = useState<any[]>([]);
  const [myUploads, setMyUploads] = useState<any[]>([]);
  const [myJobs, setMyJobs] = useState<any[]>([]);
  const [phases, setPhases] = useState<any[]>([]);
  const [activeDate, setActiveDate] = useState<Date | undefined>(new Date());
  const [isUploading, setIsUploading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;

    // Fetch initial data
    const fetchGlobalStats = async () => {
      const { data, error } = await supabase.from('teamSettings').select('*').eq('id', 'info').single();
      const { data: usersData } = await supabase.from('users').select('*').order('name');
      const total = (usersData || []).reduce((acc, u) => acc + (u.uploadedCount || u.uploaded_count || 0), 0);
      
      if (usersData) setMembers(usersData);

      setGlobalStats(prev => ({
        totalUploaded: total,
        overallTarget: data ? (data.overallTarget || data.overall_target || 0) : prev.overallTarget
      }));
    };
    
    const fetchMyUploads = async () => {
      const { data, error } = await supabase
        .from('uploads')
        .select('*')
        .eq('userId', user.id)
        .order('uploadedAt', { ascending: false })
        .limit(10);
      if (data) setMyUploads(data);
    };

    const fetchMyJobs = async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('assignedTo', user.id)
        .order('createdAt', { ascending: false });
      if (data) setMyJobs(data);
    };

    const fetchFolders = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const res = await fetch('/api/folders', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const json = await res.json();
        if (res.ok) {
           setFolders(json.folders || []);
           if (json.folders?.length > 0) {
              setSelectedFolderId(json.folders[0].id);
           }
        }
      } catch (e) {
        console.error("Failed to fetch folders", e);
      }
    };

    const fetchPhases = async () => {
      const { data } = await supabase.from('phases').select('*').order('startDate', { ascending: true });
      if (data) setPhases(data);
    };

    fetchGlobalStats();
    fetchMyUploads();
    fetchMyJobs();
    fetchPhases();
    fetchFolders();

    // Listen to real-time changes
    const teamChannel = supabase.channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teamSettings' }, (payload) => {
        if (payload.new && (payload.new as any).id === 'info') {
          const newData = payload.new as any;
          setGlobalStats(prev => ({
             ...prev,
             overallTarget: newData.overallTarget || newData.overall_target || prev.overallTarget
          }));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) => {
        fetchGlobalStats();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'uploads', filter: `userId=eq.${user?.id}` }, (payload) => {
        fetchMyUploads(); // Refresh to maintain order and limit
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'phases' }, (payload) => {
        fetchPhases();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `assignedTo=eq.${user.id}` }, (payload) => {
        fetchMyJobs();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(teamChannel);
    };
  }, [user]);

  const handleMarkJobComplete = async (jobId: string) => {
    try {
      const { error } = await supabase.from('jobs').update({ status: 'completed' }).eq('id', jobId);
      if (error) throw error;
      toast.success("Task marked as completed!");
    } catch (e: any) {
      toast.error(e.message || "Failed to complete task");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    await uploadFiles(e.target.files);
  };

  const syncWithDrive = async () => {
    if (!user) return;
    setIsSyncing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      
      const headers: Record<string, string> = {
        "Authorization": `Bearer ${token}`
      };

      const res = await fetch(`/api/sync/${user.id}`, {
        method: "POST",
        headers
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      toast.success(`Synced successfully. Total photos: ${data.count}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to sync");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !user) return;
    setIsCreatingFolder(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: newFolderName, parentId: selectedFolderId })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create folder");
      
      toast.success("Folder created!");
      
      const currentParent = folders.find(f => f.id === selectedFolderId);
      const parentPrefix = currentParent && currentParent.name !== 'Root Folder' ? `${currentParent.name}/` : '';
      
      const newFolderObj = { id: data.folder.id, name: `${parentPrefix}${data.folder.name}` };
      setFolders(prev => [...prev, newFolderObj]);
      setSelectedFolderId(data.folder.id);
      setNewFolderName("");
      
    } catch (err: any) {
      toast.error(err.message || "Failed to create folder");
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const uploadFiles = async (files: FileList) => {
    if (!user) return;
    setIsUploading(true);
    
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("photos", files[i]);
      }
      
      if (selectedFolderId) {
        formData.append("targetFolderId", selectedFolderId);
      }

      const headers: Record<string, string> = {
        "Authorization": `Bearer ${token}`
      };

      const res = await fetch("/api/upload", {
        method: "POST",
        headers,
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || "Upload failed");
      }

      toast.success(`Successfully uploaded ${data.count} photos!`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      toast.error(err.message || "Failed to upload photos");
    } finally {
      setIsUploading(false);
    }
  };

  if (!user) return null;

  const me = members.find(m => m.id === user.id) || user;
  const myUploadedCount = me.uploadedCount || me.uploaded_count || 0;
  const myPersonalTarget = me.personalTarget || me.personal_target || 100;
  const myLastSyncedAt = me.lastSyncedAt || me.last_synced_at;
  const isLeader = user.role === "leader" || user.role === "co-leader" || user.role === "co-lead";

  const targetProgress = myPersonalTarget > 0 ? Math.min((myUploadedCount / myPersonalTarget) * 100, 100) : 0;
  const remaining = Math.max(myPersonalTarget - myUploadedCount, 0);

  const teamProgress = globalStats.overallTarget > 0 ? Math.min((globalStats.totalUploaded / globalStats.overallTarget) * 100, 100) : 0;

  return (
    <>
      <Navbar />
      <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        
        <header className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Welcome back, {user.name || "Member"}</h1>
            <p className="text-white/70 mt-1">Track your progress and upload new photos here.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={syncWithDrive} disabled={isSyncing} variant="outline" className="gap-2 text-black bg-white hover:bg-neutral-100">
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              Sync Uploads
            </Button>
          </div>
        </header>

        <AttendanceCard />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            
            {/* Upload Area */}
            <Card className="border-dashed border-2 bg-neutral-50/50">
              <CardContent className="p-8 flex flex-col items-center justify-center text-center">
                <div className="bg-primary/10 p-4 rounded-full mb-4">
                  <UploadCloud className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-1">Upload Team Photos</h3>
                <p className="text-sm text-neutral-500 mb-6 max-w-sm">
                  Drag and drop your photos here, or click to select files. JPG, PNG, HEIC are supported up to 50MB each.
                </p>
                <div className="w-full max-w-sm mb-4 text-left">
                  <label className="text-sm font-medium mb-1 block">Upload Destination</label>
                  <select 
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={selectedFolderId}
                    onChange={(e) => setSelectedFolderId(e.target.value)}
                  >
                    {folders.map((f, idx) => <option key={`${f.id}-${idx}`} value={f.id}>{f.name}</option>)}
                  </select>
                  <div className="flex gap-2 mt-2">
                    <Input 
                      placeholder="New sub-folder name" 
                      value={newFolderName} 
                      onChange={e => setNewFolderName(e.target.value)}
                      className="h-8 text-sm"
                    />
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8" 
                      onClick={handleCreateFolder}
                      disabled={isCreatingFolder || !newFolderName.trim()}
                    >
                      {isCreatingFolder ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-4">
                  <Input 
                    type="file" 
                    multiple 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    disabled={isUploading}
                  />
                  <Button 
                    size="lg" 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    {isUploading ? "Uploading..." : "Select Files"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-neutral-400" />
                  My Tasks
                </CardTitle>
              </CardHeader>
              <CardContent>
                {myJobs.length === 0 ? (
                  <p className="text-sm text-neutral-500 italic py-4 text-center">No assigned tasks.</p>
                ) : (
                  <div className="space-y-3">
                    {myJobs.map((job) => (
                      <div key={job.id} className={`p-3 rounded-lg border flex flex-col gap-2 ${job.status === 'completed' ? 'bg-green-50 border-green-100' : 'bg-neutral-50 border-neutral-100'}`}>
                        <div className="flex justify-between gap-2">
                          <h4 className={`font-medium text-sm ${job.status === 'completed' ? 'line-through text-neutral-500' : 'text-neutral-900'}`}>{job.title}</h4>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-sm uppercase tracking-wide border whitespace-nowrap h-fit ${
                            job.priority === 'high' ? 'bg-red-50 text-red-600 border-red-200' : 
                            job.priority === 'low' ? 'bg-neutral-100 text-neutral-600 border-neutral-200' : 
                            'bg-blue-50 text-blue-600 border-blue-200'
                          }`}>
                            {job.priority}
                          </span>
                        </div>
                        {job.description && (
                          <p className={`text-xs ${job.status === 'completed' ? 'text-neutral-400' : 'text-neutral-600'}`}>{job.description}</p>
                        )}
                        <div className="flex justify-between items-center mt-1">
                          <p className="text-xs text-neutral-400">
                            {job.dueDate ? `Due: ${new Date(job.dueDate).toLocaleDateString()}` : "No due date"}
                          </p>
                          {job.status !== 'completed' ? (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleMarkJobComplete(job.id)}>
                              Complete
                            </Button>
                          ) : (
                            <span className="text-xs text-green-600 font-medium">Completed</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Uploads */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileImage className="w-5 h-5 text-neutral-400" />
                  Recent Uploads
                </CardTitle>
              </CardHeader>
              <CardContent>
                {myUploads.length === 0 ? (
                  <p className="text-sm text-neutral-500 italic py-4 text-center">No uploads yet.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {myUploads.map((upload, idx) => (
                      <motion.div 
                        key={upload.id} 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: idx * 0.05 }}
                        className="group relative aspect-square rounded-xl overflow-hidden bg-neutral-100 border border-neutral-200"
                      >
                        <AuthImage fileId={upload.driveFileId} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 pointer-events-none">
                          <span className="text-white text-xs font-medium truncate">{upload.fileName}</span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            
            {/* Personal Stats */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center justify-between">
                  My Target
                  <Target className="w-5 h-5 text-neutral-400" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold tracking-tight mb-2">
                  {myUploadedCount} <span className="text-xl font-normal text-neutral-400">/ {myPersonalTarget}</span>
                </div>
                <Progress value={targetProgress} className="h-2 mb-2" />
                <p className="text-sm text-neutral-500 mb-4">
                  {remaining > 0 ? `${remaining} photos remaining` : "Target achieved! 🎉"}
                </p>
                <div className="text-xs text-neutral-400 mb-4">
                  Last synced: {myLastSyncedAt ? new Date(myLastSyncedAt).toLocaleString() : 'Never'}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={syncWithDrive} disabled={isSyncing}>
                    <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
                    Sync Drive
                  </Button>
                  <Button variant="secondary" className="flex-1" asChild>
                    <Link to="/gallery">
                      <ImageIcon className="w-4 h-4 mr-2" />
                      Gallery
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Team Stats */}
            <Card className="glass-card text-white border-white/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center justify-between">
                  Team Progress
                  <Trophy className="w-5 h-5 text-white/70" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold tracking-tight mb-2">
                  {globalStats.totalUploaded} <span className="text-xl font-normal text-white/70">/ {globalStats.overallTarget}</span>
                </div>
                <Progress value={teamProgress} className="h-2 bg-white/20 [&>div]:bg-white mb-2" />
                <p className="text-sm text-white/80">
                  {globalStats.overallTarget - globalStats.totalUploaded > 0 
                    ? `${globalStats.overallTarget - globalStats.totalUploaded} team photos remaining` 
                    : "Team target achieved! 🎉"}
                </p>
              </CardContent>
            </Card>

            {isLeader && (
              <Card>
                <CardHeader className="flex flex-row justify-between items-center pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Target className="w-5 h-5 text-neutral-400" />
                    Team Member Progress
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Member</TableHead>
                          <TableHead>Progress</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {members.map((member) => {
                          const uploaded = member.uploadedCount || member.uploaded_count || 0;
                          const target = member.personalTarget || member.personal_target || 100;
                          const perc = target > 0 ? Math.min((uploaded / target) * 100, 100) : 0;
                          
                          return (
                            <TableRow key={member.id}>
                              <TableCell className="font-medium whitespace-nowrap">
                                <div className="flex flex-col">
                                  <span>
                                    {member.name || "No Name"}
                                    {member.role !== 'member' && (
                                       <span className="ml-2 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">
                                         {member.role}
                                       </span>
                                    )}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="w-[150px] sm:w-[200px]">
                                <div className="flex flex-col gap-1.5">
                                  <span className="text-xs text-neutral-500 whitespace-nowrap">{uploaded} / {target} photos</span>
                                  <Progress value={perc} className="h-1.5" />
                                </div>
                              </TableCell>
                              <TableCell>
                                {perc >= 100 ? (
                                  <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded font-medium whitespace-nowrap">Target hit</span>
                                ) : (
                                  <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded font-medium whitespace-nowrap">Uploading</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Calendar View */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center justify-between">
                  Calendar
                  <CalendarDays className="w-5 h-5 text-neutral-400" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6">
                  <div className="flex justify-center border rounded-lg p-2 w-fit h-fit overflow-x-auto">
                    <Calendar
                      mode="single"
                      selected={activeDate}
                      onSelect={setActiveDate}
                      modifiers={{
                        hasTask: (date) => myJobs.some(j => j.dueDate && isSameDay(new Date(j.dueDate), date)),
                        hasPhase: (date) => phases.some(p => p.startDate && p.endDate && date.getTime() >= p.startDate && date.getTime() <= p.endDate)
                      }}
                      modifiersClassNames={{
                        hasTask: "bg-blue-100 text-blue-700 font-bold",
                        hasPhase: "underline decoration-amber-500 decoration-2 underline-offset-4"
                      }}
                    />
                  </div>
                  {activeDate && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-neutral-700">{format(activeDate, "MMM d, yyyy")}</h4>
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                        {phases.filter(p => p.startDate && p.endDate && activeDate.getTime() >= p.startDate && activeDate.getTime() <= p.endDate).map(p => (
                          <div key={p.id} className="text-xs p-2 rounded bg-amber-50 border border-amber-100">
                            <span className="font-semibold text-amber-800">{p.name}</span>
                            <p className="text-amber-700 whitespace-pre-wrap mt-1">{p.description}</p>
                          </div>
                        ))}
                        {myJobs.filter(j => j.dueDate && isSameDay(new Date(j.dueDate), activeDate)).map(j => (
                          <div key={j.id} className="text-xs p-2 rounded bg-blue-50 border border-blue-100 flex items-start justify-between gap-2">
                            <div>
                              <span className="font-semibold text-blue-800 block">{j.title}</span>
                              <span className="uppercase text-[9px] px-1 py-0.5 rounded bg-blue-200 text-blue-700 inline-block mt-1">{j.status}</span>
                            </div>
                            {j.status !== 'completed' && (
                              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 whitespace-nowrap" onClick={() => handleMarkJobComplete(j.id)}>Done</Button>
                            )}
                          </div>
                        ))}
                        {phases.filter(p => p.startDate && p.endDate && activeDate.getTime() >= p.startDate && activeDate.getTime() <= p.endDate).length === 0 &&
                         myJobs.filter(j => j.dueDate && isSameDay(new Date(j.dueDate), activeDate)).length === 0 && (
                          <div className="text-neutral-400 text-xs italic">No events or tasks.</div>
                         )}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-amber-50 border-amber-200">
              <CardContent className="p-4 flex gap-3 text-sm text-amber-800">
                <Info className="w-5 h-5 flex-shrink-0" />
                <p>Photos are securely stored in Supabase Storage and count towards your personal and team targets automatically.</p>
              </CardContent>
            </Card>

          </div>
        </div>
      </main>
    </>
  );
}
