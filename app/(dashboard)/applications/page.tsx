"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import type { Application } from "@/lib/types";

export default function ApplicationsPage() {
  const { apiFetch } = useApi();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    try {
      const apps = await apiFetch("/api/data?type=applications");
      setApplications(apps ?? []);
    } catch {
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [apiFetch]);

  useEffect(() => {
    const hasActive = applications.some(
      (a) => a.status === "applying" || a.status === "draft"
    );
    if (!hasActive) return;
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [applications, load]);

  const appliedCount = applications.filter((a) => a.status === "applied").length;

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Applications</h1>
        <p className="mt-1 text-sm text-zinc-500 sm:text-base">
          {appliedCount} submitted · Apply from the Jobs page — cover letters and
          form answers are generated when you click Apply.
        </p>
      </div>

      {loading ? (
        <p className="text-zinc-500">Loading applications...</p>
      ) : applications.length === 0 ? (
        <Card>
          <p className="text-zinc-500">
            No applications yet. Open Jobs and click Apply on a role to generate a
            tailored cover letter and let AI fill the application form.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <Card key={app.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="break-words">{app.jobTitle}</CardTitle>
                  <p className="text-sm text-zinc-500">{app.company}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:shrink-0">
                  <span className="text-sm text-zinc-500">Fit: {app.fitScore}</span>
                  <StatusBadge status={app.status} />
                </div>
              </div>
              {app.error && (
                <p className="mt-2 text-sm text-red-600">{app.error}</p>
              )}
              {app.materials.coverLetter && (
                <Button
                  variant="ghost"
                  className="mt-3 text-sm"
                  onClick={() =>
                    setExpanded(expanded === app.id ? null : app.id)
                  }
                >
                  {expanded === app.id ? "Hide materials" : "View materials"}
                </Button>
              )}
              {expanded === app.id && (
                <div className="mt-4 space-y-4 border-t border-zinc-100 pt-4 text-sm">
                  <div>
                    <h4 className="font-medium">Cover letter</h4>
                    <p className="mt-1 whitespace-pre-wrap text-zinc-600">
                      {app.materials.coverLetter}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium">Resume summary</h4>
                    <p className="mt-1 whitespace-pre-wrap text-zinc-600">
                      {app.materials.resumeSummary}
                    </p>
                  </div>
                  {app.materials.customAnswers.map((qa) => (
                    <div key={qa.question}>
                      <h4 className="font-medium">{qa.question}</h4>
                      <p className="mt-1 whitespace-pre-wrap text-zinc-600">
                        {qa.answer}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
