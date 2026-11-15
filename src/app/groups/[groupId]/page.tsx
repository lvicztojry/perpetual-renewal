import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth/session";
import { GroupWorkspace } from "@/components/group-workspace";

export const metadata: Metadata = { title: "群聊 · 生生不息" };

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  if (!await getOptionalSession()) redirect("/login");
  const { groupId } = await params;
  return <GroupWorkspace key={groupId} groupId={groupId} />;
}
