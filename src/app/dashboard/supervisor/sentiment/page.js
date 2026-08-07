"use client";

import SupervisorGuard from "@/components/SupervisorGuard";
import SentimentView from "@/components/SentimentView";

export default function Page() {
  return (
    <SupervisorGuard>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Public Sentiment</h1>
          <p className="text-gray-500 mt-2 font-medium">Distribution of caller-reported sentiment across all logged calls.</p>
        </div>
        <SentimentView />
      </div>
    </SupervisorGuard>
  );
}
