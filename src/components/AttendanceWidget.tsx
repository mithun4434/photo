import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from "date-fns";
import { CheckCircle2, Clock } from "lucide-react";

export function AttendanceWidget({ userId }: { userId: string }) {
  const [markedToday, setMarkedToday] = useState(false);
  const [loading, setLoading] = useState(true);
  const todayStr = format(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    const checkAttendance = async () => {
      try {
        const { data, error } = await supabase
          .from("attendance")
          .select("id")
          .eq("userId", userId)
          .eq("date", todayStr)
          .maybeSingle();

        if (error && error.code !== 'PGRST116') {
          console.error("Attendance check error", error);
        }
        
        if (data) {
          setMarkedToday(true);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    checkAttendance();
  }, [userId, todayStr]);

  const markAttendance = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.from("attendance").insert({
        userId,
        date: todayStr,
        status: "present",
        recordedAt: Date.now(),
      });

      if (error) {
         // handle relation does not exist yet gracefully
         if (error.code === '42P01') {
             throw new Error("Attendance table not created yet. Check setup instructions.");
         }
         throw error;
      }
      setMarkedToday(true);
      toast.success("Attendance marked for today!");
    } catch (err: any) {
      toast.error(err.message || "Failed to mark attendance.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="bg-neutral-50/50">
        <CardContent className="p-4 flex items-center justify-center">
          <Clock className="w-5 h-5 animate-spin text-neutral-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={markedToday ? "bg-green-50 border-green-200" : "bg-neutral-50"}>
      <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            {markedToday ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <Clock className="w-5 h-5 text-neutral-500" />}
            {markedToday ? "Attendance Marked" : "Daily Attendance"}
          </h3>
          <p className="text-sm text-neutral-600 mt-1">
            {markedToday
              ? `You are present for today (${format(new Date(), "MMM d, yyyy")}).`
              : `Don't forget to mark your attendance for today (${format(new Date(), "MMM d, yyyy")}).`}
          </p>
        </div>
        {!markedToday && (
          <Button onClick={markAttendance} disabled={loading}>
            Mark Present
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
