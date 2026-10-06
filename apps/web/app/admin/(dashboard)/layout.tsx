import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminSessionFromCookieStore } from "@/lib/admin-session";

// Server-side auth gate, checked once here rather than repeated client-side
// in every admin page (the pattern every other page in this app uses, via
// a fetch-then-401 check after mount). Every page under app/admin/(dashboard)
// is automatically gated; app/admin/login sits one route-group level up,
// outside this layout, so the login page itself never redirect-loops.
export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = await verifyAdminSessionFromCookieStore(cookieStore);

  if (!session) {
    redirect("/admin/login");
  }

  return <div className="min-h-screen bg-bg">{children}</div>;
}
