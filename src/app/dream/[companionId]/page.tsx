import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth/session";
import { DreamWorkspace } from "@/components/dream-workspace";

export const metadata: Metadata = { title: "入梦 · 生生不息" };

export default async function DreamPage({ params }: { params: Promise<{ companionId: string }> }) {
  if (!await getOptionalSession()) redirect("/login");
  const { companionId } = await params;
  return <DreamWorkspace companionId={companionId} />;
}
