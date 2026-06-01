import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../hooks/use-auth";
import { supabase } from "../lib/supabase";
import Navbar from "@/components/layout/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, LineChart, Line, YAxis, CartesianGrid } from "recharts";
import { Settings, Users, Target, Activity, Image as ImageIcon, RefreshCw, CalendarDays, Clock, Flag, Plus, Calendar as CalendarIcon } from "lucide-react";
import { format, startOfWeek, subWeeks, isSameWeek, differenceInDays, isSameDay } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AttendanceCard } from "@/components/AttendanceCard";
import { TeamAttendance } from "@/components/TeamAttendance";

export default function LeaderDashboard() {
  const { user } = useAuth();
  const [globalStats, setGlobalStats] = useState({ totalUploaded: 0, overallTarget: 0 });
  const [members, setMembers] = useState<any[]>([]);
  const [uploads, setUploads] = useState<any[]>([]);
  
  const [overallTargetInput, setOverallTargetInput] = useState("");
  const [isUpdatingTarget, setIsUpdatingTarget] = useState(false);
  
  const [editingMember, setEditingMember] = useState<any | null>(null);
  const [memberTarget, setMemberTarget] = useState("");
  const [memberRole, setMemberRole] = useState("member");

  // Jobs & Phases state
  const [jobs, setJobs] = useState<any[]>([]);
  const [phases, setPhases] = useState<any[]>([]);
  const [isCreatingPhase, setIsCreatingPhase] = useState(false);
  const [editingPhase, setEditingPhase] = useState<any | null>(null);
  const [newPhase, setNewPhase] = useState({
    name: "",
    description: "",
    startDate: undefined as Date | undefined,
    endDate: undefined as Date | undefined
  });
  const [activeDate, setActiveDate] = useState<Date | undefined>(new Date());
  
  const [isCreatingJob, setIsCreatingJob] = useState(false);
  const [newJob, setNewJob] = useState({
    title: "",
    description: "",
    assignedTo: "",
    dueDate: "",
    priority: "medium"
  });

  useEffect(() => {
    const fetchGlobalStats = async () => {
      const { data } = await supabase.from('teamSettings').select('*').eq('id', 'info').single();
      if (data) {
         setGlobalStats({
           totalUploaded: data.totalUploaded || data.total_uploaded || 0,
           overallTarget: data.overallTarget || data.overall_target || 0
         });
         setOverallTargetInput((data.overallTarget || data.overall_target || 0).toString());
      }
    };
    
    const fetchMembers = async () => {
      const { data } = await supabase
        .from('users')
        .select('*')
        .order('uploadedCount', { ascending: false, nullsFirst: false });
      if (data) setMembers(data);
    };

    const fetchJobs = async () => {
      const { data } = await supabase
        .from('jobs')
        .select('*, users!assignedTo(name, email)')
        .order('createdAt', { ascending: false });
      if (data) setJobs(data);
    };

    const fetchPhases = async () => {
      const { data } = await supabase
        .from('phases')
        .select('*')
        .order('startDate', { ascending: true });
      if (data) setPhases(data);
    };

    const fetchUploads = async () => {
      const { data } = await supabase
        .from('uploads')
        .select('uploadedAt, userId');
      if (data) setUploads(data);
    };

    fetchGlobalStats();
    fetchMembers();
    fetchJobs();
    fetchPhases();
    fetchUploads();

    // Listen to real-time changes
    const leaderChannel = supabase.channel('schema-db-changes-leader')
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
        fetchMembers(); // Refresh to maintain order
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, (payload) => {
        fetchJobs();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'phases' }, (payload) => {
        fetchPhases();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'uploads' }, (payload) => {
        fetchUploads();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(leaderChannel);
    };
  }, []);

  const handleUpdateOverallTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingTarget(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      
      const res = await fetch("/api/teamSettings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ overallTarget: parseInt(overallTargetInput) })
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to update target");
      }
      
      toast.success("Team target updated successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to update target");
    } finally {
      setIsUpdatingTarget(false);
    }
  };

  const handleUpdateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      
      const res = await fetch(`/api/users/${editingMember.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ 
          personalTarget: parseInt(memberTarget),
          role: memberRole
        })
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to update member");
      }
      
      toast.success(`${editingMember.name || editingMember.email}'s profile updated`);
      setEditingMember(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to update member");
    }
  };

  const handleSyncUser = async (userId: string) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      
      const headers: Record<string, string> = {
        "Authorization": `Bearer ${token}`
      };

      const res = await fetch(`/api/sync/${userId}`, {
        method: "POST",
        headers
      });
      if (!res.ok) throw new Error("Sync failed");
      toast.success("User synced successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to sync user");
    }
  };

  const handleSyncAll = async () => {
    toast.promise(
      Promise.all(members.map(m => handleSyncUser(m.id))), 
      {
        loading: 'Syncing all active users...',
        success: 'All users synced',
        error: 'Some users failed to sync'
      }
    );
  };

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJob.title || !newJob.assignedTo) {
      toast.error("Title and Assignee are required");
      return;
    }
    
    try {
      const { error } = await supabase.from('jobs').insert({
        title: newJob.title,
        description: newJob.description,
        assignedTo: newJob.assignedTo,
        dueDate: newJob.dueDate ? new Date(newJob.dueDate).getTime() : null,
        priority: newJob.priority,
        createdBy: user?.id,
        createdAt: Date.now()
      });
      if (error) throw error;
      toast.success("Task assigned successfully");
      setIsCreatingJob(false);
      setNewJob({ title: "", description: "", assignedTo: "", dueDate: "", priority: "medium" });
    } catch (err: any) {
      toast.error(err.message || "Failed to create task");
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      const { error } = await supabase.from('jobs').delete().eq('id', jobId);
      if (error) throw error;
      toast.success("Task deleted");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete task");
    }
  };

  const handleCreatePhase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhase.name || !newPhase.startDate || !newPhase.endDate) {
      toast.error("Name, Start Date, and End Date are required");
      return;
    }
    
    try {
      const { error } = await supabase.from('phases').insert({
        name: newPhase.name,
        description: newPhase.description,
        startDate: newPhase.startDate.getTime(),
        endDate: newPhase.endDate.getTime(),
        createdBy: user?.id,
        createdAt: Date.now()
      });
      if (error) throw error;
      toast.success("Phase created successfully");
      setIsCreatingPhase(false);
      setNewPhase({ name: "", description: "", startDate: undefined, endDate: undefined });
    } catch (err: any) {
      toast.error(err.message || "Failed to create phase");
    }
  };

  const handleDeletePhase = async (phaseId: string) => {
    try {
      const { error } = await supabase.from('phases').delete().eq('id', phaseId);
      if (error) throw error;
      toast.success("Phase deleted");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete phase");
    }
  };

  const handleUpdatePhase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPhase?.name || !editingPhase?.startDate || !editingPhase?.endDate) {
      toast.error("Name, Start Date, and End Date are required");
      return;
    }
    
    try {
      const { error } = await supabase.from('phases').update({
        name: editingPhase.name,
        description: editingPhase.description,
        startDate: editingPhase.startDate.getTime(),
        endDate: editingPhase.endDate.getTime(),
      }).eq('id', editingPhase.id);
      if (error) throw error;
      toast.success("Phase updated successfully");
      setEditingPhase(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to update phase");
    }
  };

  const computedTotalUploaded = members.reduce((acc, m) => acc + (m.uploadedCount || m.uploaded_count || 0), 0);
  const teamProgress = globalStats.overallTarget > 0 ? Math.min((computedTotalUploaded / globalStats.overallTarget) * 100, 100) : 0;
  
  const chartData = members.map(m => ({
    name: m.name || m.email?.split("@")[0] || "User",
    photos: m.uploadedCount || m.uploaded_count || 0
  })).sort((a, b) => b.photos - a.photos).slice(0, 10);

  const weeklyChartData = useMemo(() => {
    // Generate last 6 weeks
    const weeks = [];
    for (let i = 5; i >= 0; i--) {
      const d = subWeeks(new Date(), i);
      const start = startOfWeek(d, { weekStartsOn: 1 });
      weeks.push({
        start: start,
        label: format(start, "MMM d"),
        count: 0
      });
    }
    
    uploads.forEach(u => {
      const d = new Date(u.uploadedAt);
      weeks.forEach(w => {
        if (isSameWeek(d, w.start, { weekStartsOn: 1 })) {
          w.count++;
        }
      });
    });
    
    return weeks;
  }, [uploads]);

  const weeklyMemberData = useMemo(() => {
    const thisWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    
    // Count uploads per user for this week
    const counts: Record<string, number> = {};
    uploads.forEach(u => {
      const d = new Date(u.uploadedAt);
      if (isSameWeek(d, thisWeekStart, { weekStartsOn: 1 })) {
        counts[u.userId] = (counts[u.userId] || 0) + 1;
      }
    });

    // Map to members
    return members.map(m => ({
      ...m,
      thisWeekCount: counts[m.id] || 0
    })).sort((a, b) => b.thisWeekCount - a.thisWeekCount);
  }, [uploads, members]);

  return (
    <>
      <Navbar />
      <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
        
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Leader Dashboard</h1>
            <p className="text-white/70 mt-1">Manage team targets and view insights.</p>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Settings className="w-4 h-4" />
                Team Settings
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Team Settings</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleUpdateOverallTarget} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Overall Team Target</Label>
                  <Input 
                    type="number" 
                    min="0"
                    value={overallTargetInput} 
                    onChange={(e) => setOverallTargetInput(e.target.value)} 
                    required 
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isUpdatingTarget}>
                  {isUpdatingTarget ? "Saving..." : "Save Target"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </header>

        <AttendanceCard />
        <TeamAttendance />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Uploaded</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{computedTotalUploaded.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">Photos from all team members</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Overall Target</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{globalStats.overallTarget.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {Math.max(globalStats.overallTarget - computedTotalUploaded, 0).toLocaleString()} remaining
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Members</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{members.length}</div>
              <p className="text-xs text-muted-foreground mt-1">Registered accounts</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
           <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle>Team Member Progress</CardTitle>
              <Button variant="outline" size="sm" onClick={handleSyncAll}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Sync All
              </Button>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => {
                      const uploaded = member.uploadedCount || member.uploaded_count || 0;
                      const target = member.personalTarget || member.personal_target || 100;
                      const perc = target > 0 ? Math.min((uploaded / target) * 100, 100) : 0;
                      const syncDate = member.lastSyncedAt || member.last_synced_at;
                      
                      return (
                        <TableRow key={member.id}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col">
                              <span>
                                {member.name || "No Name"}
                                {member.role !== 'member' && (
                                   <span className="ml-2 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">
                                     {member.role}
                                   </span>
                                )}
                              </span>
                              <span className="text-xs text-neutral-500 font-normal">{member.email}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1 min-w-[120px]">
                              <div className="flex justify-between text-xs font-medium">
                                <span>{uploaded} files</span>
                                <span className="text-neutral-400">Target: {target}</span>
                              </div>
                              <Progress value={perc} className="h-1.5 w-full" />
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-xs text-neutral-500 flex flex-col">
                              <span>Supabase: {uploaded}</span>
                              {syncDate ? (
                                <span className="text-[10px] text-neutral-400">Synced: {new Date(syncDate).toLocaleDateString()}</span>
                              ) : (
                                <span className="text-[10px] text-amber-500">Not synced</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="icon" onClick={() => handleSyncUser(member.id)} title="Sync Cloud">
                                <RefreshCw className="w-4 h-4 text-neutral-500" />
                              </Button>
                              <Button variant="ghost" size="icon" asChild title="View Gallery">
                                <Link to={`/gallery/${member.id}`}>
                                  <ImageIcon className="w-4 h-4 text-primary" />
                                </Link>
                              </Button>
                              <Dialog open={editingMember?.id === member.id} onOpenChange={(open) => {
                                if(open) {
                                  setEditingMember(member);
                                  setMemberTarget((member.personalTarget || member.personal_target || 100).toString());
                                  setMemberRole(member.role);
                                } else {
                                  setEditingMember(null);
                                }
                              }}>
                                <DialogTrigger asChild>
                                  <Button variant="ghost" size="sm">Edit</Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Edit Member</DialogTitle>
                                  </DialogHeader>
                                  <form onSubmit={handleUpdateMember} className="space-y-4 pt-4">
                                    <div className="space-y-2">
                                      <Label>Name</Label>
                                      <Input disabled value={member.name || member.email} />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Personal Target</Label>
                                      <Input 
                                        type="number" 
                                        min="0"
                                        value={memberTarget} 
                                        onChange={(e) => setMemberTarget(e.target.value)} 
                                        required 
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Role</Label>
                                      <Select value={memberRole} onValueChange={setMemberRole}>
                                        <SelectTrigger>
                                          <SelectValue placeholder="Select a role" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="member">Member</SelectItem>
                                          <SelectItem value="co-lead">Co-Lead</SelectItem>
                                          {user?.role === 'leader' && (
                                            <SelectItem value="leader">Leader</SelectItem>
                                          )}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <Button type="submit" className="w-full">Save Changes</Button>
                                  </form>
                                </DialogContent>
                              </Dialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Top Contributors</CardTitle>
              </CardHeader>
              <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)' }} contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: '#000' }} itemStyle={{ color: '#000' }} labelStyle={{ color: '#000' }} />
                    <Bar dataKey="photos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="glass-card text-white border-white/20">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <Target className="w-5 h-5 text-white/70" />
                  <span className="text-white">Team Progress</span>
                </h3>
                <div className="text-4xl font-bold tracking-tight mb-2 text-white">
                  {Math.round(teamProgress)}%
                </div>
                <Progress value={teamProgress} className="h-2 bg-white/20 [&>div]:bg-white mb-4" />
                <p className="text-sm text-white/80">
                  You are {teamProgress >= 100 ? "done!" : "on track to reach the team target."}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="glass-card text-white border-white/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-white/70" />
                Weekly Trend
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyChartData} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
                  <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} stroke="rgba(255,255,255,0.5)" />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} stroke="rgba(255,255,255,0.5)" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }} 
                  />
                  <Line type="monotone" dataKey="count" stroke="#fff" strokeWidth={3} dot={{ r: 4, fill: '#000', stroke: '#fff', strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="glass-card text-white border-white/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-white/70" />
                This Week's Contributors
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader className="border-white/10">
                  <TableRow className="border-white/10 hover:bg-white/5">
                    <TableHead className="text-white/70">Member</TableHead>
                    <TableHead className="text-right text-white/70">Uploaded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeklyMemberData.slice(0, 5).map((member) => (
                    <TableRow key={member.id} className="border-white/10 hover:bg-white/5">
                      <TableCell className="font-medium text-white">{member.name || member.email?.split('@')[0]}</TableCell>
                      <TableCell className="text-right text-white">{member.thisWeekCount}</TableCell>
                    </TableRow>
                  ))}
                  {weeklyMemberData.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-white/50 py-4">No uploads this week</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="glass-card text-white border-white/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-white/70" />
                Calendar & Upcoming
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6">
                <div className="bg-white/5 rounded-xl border border-white/10 p-2 w-fit h-fit">
                  <Calendar
                    mode="single"
                    selected={activeDate}
                    onSelect={setActiveDate}
                    className="text-white"
                    modifiers={{
                      hasTask: (date) => jobs.some(j => j.dueDate && isSameDay(new Date(j.dueDate), date)),
                      hasPhase: (date) => phases.some(p => p.startDate && p.endDate && date.getTime() >= p.startDate && date.getTime() <= p.endDate)
                    }}
                    modifiersClassNames={{
                      hasTask: "bg-blue-500/20 text-blue-200 font-bold",
                      hasPhase: "underline decoration-amber-500 decoration-2 underline-offset-4"
                    }}
                  />
                </div>
                <div className="space-y-4">
                  <h4 className="font-medium text-white/90">Events for {activeDate ? format(activeDate, "MMM d, yyyy") : "Selected Date"}</h4>
                  
                  <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                    {/* Active Phases */}
                    {phases.filter(p => activeDate && p.startDate && p.endDate && activeDate.getTime() >= p.startDate && activeDate.getTime() <= p.endDate).map(p => {
                      const daysLeft = differenceInDays(new Date(p.endDate), activeDate || new Date());
                      return (
                        <div key={p.id} className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 flex flex-col gap-2">
                          <div className="flex justify-between items-start">
                            <h5 className="font-semibold text-amber-200">{p.name}</h5>
                            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 whitespace-nowrap">
                              {daysLeft >= 0 ? `${daysLeft} days left` : "Ended"}
                            </span>
                          </div>
                          {p.description && <p className="text-xs text-amber-100/70">{p.description}</p>}
                          <div className="text-[10px] text-amber-200/50">
                            {format(new Date(p.startDate), "MMM d")} - {format(new Date(p.endDate), "MMM d, yyyy")}
                          </div>
                        </div>
                      )
                    })}

                    {/* Jobs due */}
                    {jobs.filter(j => activeDate && j.dueDate && isSameDay(new Date(j.dueDate), activeDate)).map(j => (
                      <div key={j.id} className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/10 flex flex-col gap-1">
                        <div className="flex justify-between items-start">
                          <h5 className="font-semibold text-blue-200">{j.title}</h5>
                          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                            {j.status}
                          </span>
                        </div>
                        <p className="text-xs text-blue-100/70">Assignee: {j.users?.name || j.users?.email}</p>
                      </div>
                    ))}

                    {phases.filter(p => activeDate && p.startDate && p.endDate && activeDate.getTime() >= p.startDate && activeDate.getTime() <= p.endDate).length === 0 &&
                     jobs.filter(j => activeDate && j.dueDate && isSameDay(new Date(j.dueDate), activeDate)).length === 0 && (
                      <div className="text-white/50 text-sm text-center py-4">No events on this day.</div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Phases Management Section */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b mb-4">
            <div className="space-y-1">
              <CardTitle className="text-xl flex items-center gap-2"><Flag className="w-5 h-5 text-primary" /> Phases Management</CardTitle>
              <p className="text-sm text-neutral-500">Manage project phases and timelines.</p>
            </div>
            <Dialog open={isCreatingPhase} onOpenChange={setIsCreatingPhase}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus className="w-4 h-4"/> Add Phase</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Phase</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreatePhase} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>Phase Name</Label>
                    <Input 
                      value={newPhase.name} 
                      onChange={(e) => setNewPhase({...newPhase, name: e.target.value})} 
                      required 
                      placeholder="e.g. Phase 1: Planning"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description (Optional)</Label>
                    <Input 
                      value={newPhase.description} 
                      onChange={(e) => setNewPhase({...newPhase, description: e.target.value})} 
                      placeholder="Phase details..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 flex flex-col">
                      <Label>Start Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !newPhase.startDate && "text-muted-foreground"
                            )}
                          >
                            {newPhase.startDate ? format(newPhase.startDate, "PPP") : <span>Pick a date</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={newPhase.startDate}
                            onSelect={(d) => setNewPhase({...newPhase, startDate: d})}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2 flex flex-col">
                      <Label>End Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !newPhase.endDate && "text-muted-foreground"
                            )}
                          >
                            {newPhase.endDate ? format(newPhase.endDate, "PPP") : <span>Pick a date</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={newPhase.endDate}
                            onSelect={(d) => setNewPhase({...newPhase, endDate: d})}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                  <Button type="submit" className="w-full">Create Phase</Button>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {phases.length === 0 ? (
              <div className="text-center py-8 text-neutral-500 italic">No phases established yet.</div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {phases.map(phase => {
                  const now = Date.now();
                  const isPast = now > phase.endDate;
                  const isActive = now >= phase.startDate && now <= phase.endDate;
                  const daysLeft = differenceInDays(new Date(phase.endDate), new Date());
                  const totalDays = differenceInDays(new Date(phase.endDate), new Date(phase.startDate)) || 1;
                  const passedDays = differenceInDays(new Date(), new Date(phase.startDate));
                  const progress = Math.min(Math.max((passedDays / totalDays) * 100, 0), 100);

                  return (
                    <Card key={phase.id} className={cn("relative overflow-hidden", isActive ? "border-primary" : "border-neutral-200")}>
                      {isActive && <div className="absolute top-0 right-0 w-2 h-full bg-primary" />}
                      <CardHeader className="pb-3">
                        <div className="flex justify-between items-start">
                          <CardTitle className="text-base">{phase.name}</CardTitle>
                          <div className="flex items-center gap-1">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-6 px-2 text-xs text-blue-500 hover:text-blue-600 hover:bg-blue-50" 
                              onClick={() => {
                                setEditingPhase({
                                  ...phase,
                                  startDate: new Date(phase.startDate),
                                  endDate: new Date(phase.endDate)
                                });
                              }}
                            >
                              Edit
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDeletePhase(phase.id)}>
                              &times;
                            </Button>
                          </div>
                        </div>
                        {phase.description && <p className="text-xs text-neutral-500">{phase.description}</p>}
                      </CardHeader>
                      <CardContent className="space-y-3 pb-4">
                        <div className="flex items-center text-xs text-neutral-500 gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{format(new Date(phase.startDate), "MMM d")} - {format(new Date(phase.endDate), "MMM d, yyyy")}</span>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs font-medium">
                            <span className={cn(isActive ? "text-primary" : "text-neutral-500")}>
                              {isActive ? `${daysLeft} days remaining` : isPast ? "Completed" : "Upcoming"}
                            </span>
                            <span className="text-neutral-400">{Math.round(progress)}%</span>
                          </div>
                          <Progress value={progress} className="h-1.5" />
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}

            <Dialog open={!!editingPhase} onOpenChange={(open) => !open && setEditingPhase(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Phase</DialogTitle>
                </DialogHeader>
                {editingPhase && (
                  <form onSubmit={handleUpdatePhase} className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label>Phase Name</Label>
                      <Input 
                        value={editingPhase.name || ""} 
                        onChange={(e) => setEditingPhase({...editingPhase, name: e.target.value})} 
                        required 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Input 
                        value={editingPhase.description || ""} 
                        onChange={(e) => setEditingPhase({...editingPhase, description: e.target.value})} 
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2 flex flex-col">
                        <Label>Start Date</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !editingPhase.startDate && "text-muted-foreground"
                              )}
                            >
                              {editingPhase.startDate ? format(new Date(editingPhase.startDate), "PPP") : <span>Pick a date</span>}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={editingPhase.startDate ? new Date(editingPhase.startDate) : undefined}
                              onSelect={(d) => setEditingPhase({...editingPhase, startDate: d})}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="space-y-2 flex flex-col">
                        <Label>End Date</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !editingPhase.endDate && "text-muted-foreground"
                              )}
                            >
                              {editingPhase.endDate ? format(new Date(editingPhase.endDate), "PPP") : <span>Pick a date</span>}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={editingPhase.endDate ? new Date(editingPhase.endDate) : undefined}
                              onSelect={(d) => setEditingPhase({...editingPhase, endDate: d})}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                    <Button type="submit" className="w-full">Update Phase</Button>
                  </form>
                )}
              </DialogContent>
            </Dialog>            
          </CardContent>
        </Card>

        {/* Task Management Section */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b mb-4">
            <div className="space-y-1">
              <CardTitle className="text-xl">Task Management</CardTitle>
              <p className="text-sm text-neutral-500">Create and assign tasks to team members.</p>
            </div>
            <Dialog open={isCreatingJob} onOpenChange={setIsCreatingJob}>
              <DialogTrigger asChild>
                <Button>Assign New Task</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign Task</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreateJob} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>Task Title</Label>
                    <Input 
                      value={newJob.title} 
                      onChange={(e) => setNewJob({...newJob, title: e.target.value})} 
                      required 
                      placeholder="e.g. Upload 50 nature photos"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Assignee</Label>
                    <Select value={newJob.assignedTo} onValueChange={(val) => setNewJob({...newJob, assignedTo: val})}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select team member" />
                      </SelectTrigger>
                      <SelectContent>
                        {members.map(m => (
                          <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Description (Optional)</Label>
                    <Input 
                      value={newJob.description} 
                      onChange={(e) => setNewJob({...newJob, description: e.target.value})} 
                      placeholder="Additional details..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <Select value={newJob.priority} onValueChange={(val) => setNewJob({...newJob, priority: val})}>
                        <SelectTrigger>
                          <SelectValue placeholder="Priority" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Due Date</Label>
                      <Input 
                        type="date"
                        value={newJob.dueDate} 
                        onChange={(e) => setNewJob({...newJob, dueDate: e.target.value})} 
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-full">Create Task</Button>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <div className="text-center py-8 text-neutral-500 italic">No tasks created yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task Title</TableHead>
                      <TableHead>Assignee</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map(job => (
                      <TableRow key={job.id}>
                        <TableCell>
                          <p className="font-medium">{job.title}</p>
                          {job.description && <p className="text-xs text-neutral-500">{job.description}</p>}
                        </TableCell>
                        <TableCell>{job.users?.name || job.users?.email || "Unknown"}</TableCell>
                        <TableCell>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide border whitespace-nowrap h-fit ${
                            job.priority === 'high' ? 'bg-red-50 text-red-600 border-red-200' : 
                            job.priority === 'low' ? 'bg-neutral-100 text-neutral-600 border-neutral-200' : 
                            'bg-blue-50 text-blue-600 border-blue-200'
                          }`}>
                            {job.priority}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide border whitespace-nowrap h-fit ${
                            job.status === 'completed' ? 'bg-green-50 text-green-600 border-green-200' : 'bg-amber-50 text-amber-600 border-amber-200'
                          }`}>
                            {job.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-neutral-500 text-xs text-nowrap">
                          {job.dueDate ? new Date(job.dueDate).toLocaleDateString() : 'None'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDeleteJob(job.id)}>
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

      </main>
    </>
  );
}
