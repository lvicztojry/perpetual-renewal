import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth/session";
import { GroupWorkspace } from "@/components/group-workspace";

export const metadata: Metadata = { title: "围坐 · 生生不息" };

export default async function GroupsPage() {
  if (!await getOptionalSession()) redirect("/login");
  return <GroupWorkspace />;
}
