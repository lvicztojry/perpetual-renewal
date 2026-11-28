import type { Metadata } from "next";
import { EchoesGallery } from "@/components/echoes-gallery";

export const metadata: Metadata = { title: "回响录 · 生生不息" };
export default function EchoesPage() { return <EchoesGallery />; }
