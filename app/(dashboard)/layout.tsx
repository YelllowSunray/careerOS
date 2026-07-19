import { DashboardNav } from "@/components/layout/dashboard-nav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <DashboardNav />
      <main className="mx-auto w-full min-w-0 flex-1 overflow-x-hidden px-4 py-5 pb-24 sm:px-6 sm:py-6 md:overflow-auto md:p-8 md:pb-8">
        {children}
      </main>
    </div>
  );
}
