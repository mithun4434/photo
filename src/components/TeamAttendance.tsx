import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, CalendarDays } from "lucide-react";
import { format } from "date-fns";

export function TeamAttendance() {
  const [attendanceData, setAttendanceData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const todayStr = format(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    const fetchAttendance = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return;

        const res = await fetch(`/api/attendance/all`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.data) {
          setAttendanceData(data.data);
        }
      } catch (err) {
        console.error("Failed to fetch team attendance", err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchAttendance();
    const interval = setInterval(fetchAttendance, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (loading && attendanceData.length === 0) {
    return (
      <Card className="bg-neutral-900 border-neutral-800 text-white">
        <CardHeader>
          <CardTitle className="text-xl">Daily Team Attendance</CardTitle>
          <CardDescription className="text-neutral-400">Loading attendance data...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const attendedCount = attendanceData.filter(u => u.attendance && u.attendance[todayStr]).length;
  const allAttended = attendedCount === attendanceData.length && attendanceData.length > 0;

  return (
    <Card className="bg-neutral-900 border-neutral-800 text-white">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xl flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-indigo-400" />
            Daily Team Attendance
          </CardTitle>
          <CardDescription className="text-neutral-400 mt-1">
            Status for {format(new Date(), "EEEE, MMMM do, yyyy")}
          </CardDescription>
        </div>
        <Badge variant="outline" className={allAttended ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}>
          {attendedCount} / {attendanceData.length} Filled
        </Badge>
      </CardHeader>
      
      <CardContent>
        <div className="rounded-md border border-neutral-800 overflow-hidden">
          <Table>
            <TableHeader className="bg-neutral-800/50">
              <TableRow className="border-neutral-800 hover:bg-neutral-800/50 pointer-events-none">
                <TableHead className="text-neutral-400">Team Member</TableHead>
                <TableHead className="text-neutral-400">Role</TableHead>
                <TableHead className="text-neutral-400 text-right">Today's Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attendanceData.map((member) => {
                const isPresent = member.attendance && member.attendance[todayStr];
                
                return (
                  <TableRow key={member.userId} className="border-neutral-800 hover:bg-neutral-800/50">
                    <TableCell className="font-medium text-white">{member.name}</TableCell>
                    <TableCell className="text-neutral-400 capitalize">{member.role}</TableCell>
                    <TableCell className="text-right">
                      {isPresent ? (
                        <div className="inline-flex items-center gap-1.5 text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full text-xs font-medium">
                          <CheckCircle2 className="w-4 h-4" />
                          Present
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 text-rose-400 bg-rose-400/10 px-2 py-1 rounded-full text-xs font-medium">
                          <XCircle className="w-4 h-4" />
                          Pending
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {attendanceData.length === 0 && (
                <TableRow className="border-neutral-800">
                  <TableCell colSpan={3} className="text-center py-6 text-neutral-500">
                    No team members found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
