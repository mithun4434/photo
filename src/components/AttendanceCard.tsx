import { useState, useEffect } from "react";
import { useAuth } from "../hooks/use-auth";
import { supabase } from "../lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Clock, CalendarDays } from "lucide-react";
import * as motion from "motion/react-client";
import { format } from "date-fns";
import { toast } from "sonner";

export function AttendanceCard() {
  const { user } = useAuth();
  const [markedToday, setMarkedToday] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const todayStr = format(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    if (!user) return;
    const checkAttendance = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return;

        const res = await fetch(`/api/attendance/me`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.attendance) {
          setMarkedToday(!!data.attendance[todayStr]);
        }
      } catch (err) {
        console.error("Failed to fetch attendance", err);
      } finally {
        setLoading(false);
      }
    };
    checkAttendance();
  }, [user, todayStr]);

  const markAttendance = async () => {
    try {
      setLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      
      const res = await fetch(`/api/attendance`, {
        method: 'POST',
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ date: todayStr })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to mark attendance");
      
      setMarkedToday(true);
      toast.success("Attendance marked successfully for today!");
    } catch (err: any) {
      toast.error(err.message || "Failed to mark attendance");
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
      <Card className={`border-l-4 ${markedToday ? 'border-emerald-500 bg-emerald-500/10' : 'border-amber-500 bg-amber-500/10'} shadow-none h-full`}>
        <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-full ${markedToday ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
              {markedToday ? <CheckCircle2 className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
            </div>
            <div>
              <h3 className={`font-semibold ${markedToday ? 'text-emerald-500' : 'text-amber-500'}`}>
                {markedToday ? "Attendance Logged" : "Daily Attendance Required"}
              </h3>
              <p className="text-sm text-neutral-400 mt-1 flex items-center gap-1">
                <CalendarDays className="w-3 h-3" />
                {format(new Date(), "EEEE, MMMM do, yyyy")}
              </p>
            </div>
          </div>
          
          <Button 
            onClick={markAttendance} 
            disabled={markedToday || loading}
            className={markedToday ? 'bg-emerald-600 hover:bg-emerald-700 text-white opacity-100 disabled:opacity-70 disabled:cursor-not-allowed' : 'bg-amber-500 hover:bg-amber-600 text-white'}
          >
            {markedToday ? "Present Today" : "Mark Present"}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
