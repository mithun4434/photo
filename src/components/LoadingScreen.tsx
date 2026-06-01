import { useEffect, useState } from "react";
import * as motion from "motion/react-client";

export function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onComplete();
    }, 3000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div 
      className="fixed inset-0 bg-neutral-950 flex flex-col items-center justify-center z-50 text-white"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="flex flex-col items-center gap-6"
      >
        <img 
          src="/logo.png" 
          alt="Neural Sharks Logo" 
          className="w-48 h-auto object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]"
          onError={(e) => {
            // Fallback if logo not yet uploaded
            e.currentTarget.style.display = 'none';
          }}
        />
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </motion.div>
    </motion.div>
  );
}
